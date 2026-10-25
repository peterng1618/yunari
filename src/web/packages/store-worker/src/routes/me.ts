import type {
  CatalogueStatus,
  FabricThemeEnvelope,
  MineEntry,
} from "@yunari/renderer-core";
import {
  DASHBOARD_THEME_KIND,
  facetRecordOf,
  migrateFabricThemeEnvelope,
  validateFabricThemeEnvelope,
} from "@yunari/renderer-core";
import { MAX_ARCHIVE_BYTES } from "@yunari/theme-package";
import { type Session, sessionOf } from "../auth/session.js";
import { entryOf } from "../catalogue/entry.js";
import {
  countsByItem,
  favoriteCount,
  toggleFavorite,
} from "../db/favorites.js";
import {
  insertVersion,
  itemById,
  latestVersion,
  markFinalized,
  presignEventOf,
  setStatus,
  versionOf,
} from "../db/items.js";
import {
  authorQuotaExceeded,
  MAX_AUTHOR_BYTES,
  MAX_AUTHOR_ITEMS,
  presignAllowed,
  UPLOAD_RESERVATION_TTL_MS,
} from "../db/quota.js";
import type { ItemRow, UploadRow } from "../db/types.js";
import { markUploadFinalized, uploadsForVersion } from "../db/uploads.js";
import type { Env } from "../env.js";
import { pendingKey, thumbnailKey } from "../storage/keys.js";
import { inspectObject } from "../storage/objects.js";
import { planVersion } from "../version/plan.js";

const ITEMS_PREFIX = "/api/me/items/";
const UPLOADS_PREFIX = "/api/me/uploads/";
/** The thumbnail is rewritten on every version, so it is kept small. */
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * The author's own half of the store. Returns `undefined` for a path this
 * module does not own, leaving the Worker's default 404 in place.
 *
 * A version request never names an R2 key: the key is derived from the
 * envelope's id and the version the Worker computed from the stored baseline.
 */
export async function handleMe(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response | undefined> {
  // Before the item routes, and before the Worker's generic `/api/me` handler
  // ever sees it: a proxied upload's body goes straight to R2.
  if (url.pathname.startsWith(UPLOADS_PREFIX)) {
    if (request.method !== "PUT")
      return new Response("Method not allowed", {
        status: 405,
        headers: { allow: "PUT" },
      });
    return putUpload(request, env, url.pathname.slice(UPLOADS_PREFIX.length));
  }

  // The listing itself, beside the item routes that all carry a trailing id.
  if (url.pathname === "/api/me/items" && request.method === "GET")
    return mine(request, env, url);

  if (!url.pathname.startsWith(ITEMS_PREFIX)) return undefined;
  const parts = url.pathname.slice(ITEMS_PREFIX.length).split("/");
  const itemId = parts[0];
  if (itemId === undefined || itemId.length === 0) return undefined;

  // `:id/versions/:version/finalize`, beside the version request that signed it.
  const version = parts[2];
  if (
    parts.length === 4 &&
    parts[1] === "versions" &&
    parts[3] === "finalize" &&
    version !== undefined &&
    version.length > 0 &&
    request.method === "POST"
  )
    return finalizeVersion(request, env, itemId, version);

  if (parts.length !== 2) return undefined;
  const action = parts[1];
  if (action === undefined) return undefined;

  if (action === "baseline" && request.method === "GET")
    return baseline(request, env, itemId);
  if (action === "versions" && request.method === "POST")
    return requestVersion(request, env, itemId);
  if (action === "unpublish" && request.method === "POST")
    return unpublish(request, env, itemId);
  if (action === "publish" && request.method === "POST")
    return publish(request, env, itemId);
  if (
    action === "favorite" &&
    (request.method === "PUT" || request.method === "DELETE")
  )
    return favorite(request, env, itemId);
  return undefined;
}

/**
 * The author's own rows, in every state a finalize has reached — a `draft`
 * with no version is a presign leftover and is not an item yet. Newest first,
 * with the id as the tiebreak so two requests never disagree about the order.
 */
async function mine(request: Request, env: Env, url: URL): Promise<Response> {
  const session = await sessionOf(request, env);
  if (session === undefined) return unauthorized();

  const items = await env.DB.prepare(
    `SELECT * FROM item WHERE author_user_id = ?
       AND EXISTS (SELECT 1 FROM item_version v WHERE v.item_id = item.id)
     ORDER BY updated_at DESC, id ASC`,
  )
    .bind(session.userId)
    .all<ItemRow>();

  // One count query for the whole listing, as the public index does.
  const counts = await countsByItem(
    env.DB,
    items.results.map((item) => item.id),
  );

  const entries: MineEntry[] = [];
  for (const item of items.results) {
    // The same latest-version selection `publishedListings` and the public
    // item read use, so one item is shown at one version everywhere. One read
    // per item; the 20-item quota bounds this — batch it if the limit rises.
    const version = await latestVersion(env.DB, item.id);
    if (version === undefined) continue;
    entries.push({
      ...entryOf(
        item,
        version,
        counts.get(item.id) ?? 0,
        `${url.origin}/catalogue/${item.id}/${version.version}.zip`,
        `catalogue/${item.id}/thumbnail.png`,
      ),
      status: item.status,
      ...(item.status_reason === null
        ? {}
        : { statusReason: item.status_reason }),
    });
  }

  return Response.json({ entries });
}

/**
 * Any signed-in account's toggle, not only the author's. The answer is the
 * item's total after the write, which is what the public listing will show.
 */
async function favorite(
  request: Request,
  env: Env,
  itemId: string,
): Promise<Response> {
  const session = await sessionOf(request, env);
  if (session === undefined) return unauthorized();

  const result = await toggleFavorite(
    env.DB,
    session.userId,
    itemId,
    request.method === "PUT",
  );
  if (result === "not-found") return notFound();

  return Response.json({
    ok: true,
    favorites: await favoriteCount(env.DB, itemId),
  });
}

/**
 * Withdraws the item from every public read. The record, its versions, its
 * counters, its favourites and its objects all stay: only the status moves.
 */
async function unpublish(
  request: Request,
  env: Env,
  itemId: string,
): Promise<Response> {
  const session = await sessionOf(request, env);
  if (session === undefined) return unauthorized();

  const item = await ownedItem(env, session, itemId);
  if (item === undefined) return notFound();

  const now = new Date().toISOString();
  if (!(await setStatus(env.DB, itemId, ["published"], "unpublished", now)))
    return conflict(await currentStatus(env, itemId, item), "published");

  return Response.json({ ok: true, status: "unpublished" });
}

/**
 * The author's own way back. `removed` is the owner's verdict and is refused
 * with the reason; every other state is not a republish, so it is a 409.
 */
async function publish(
  request: Request,
  env: Env,
  itemId: string,
): Promise<Response> {
  const session = await sessionOf(request, env);
  if (session === undefined) return unauthorized();

  const item = await ownedItem(env, session, itemId);
  if (item === undefined) return notFound();
  if (item.status === "removed") {
    return new Response(
      item.status_reason ?? "This item was removed from the store.",
      { status: 403 },
    );
  }
  if (item.status !== "unpublished")
    return conflict(item.status, "unpublished");

  const now = new Date().toISOString();
  if (!(await setStatus(env.DB, itemId, ["unpublished"], "published", now)))
    return conflict(await currentStatus(env, itemId, item), "unpublished");

  return Response.json({ ok: true, status: "published" });
}

/** A guarded write that changed no row raced another actor; name what won. */
async function currentStatus(
  env: Env,
  itemId: string,
  read: ItemRow,
): Promise<string> {
  return (await itemById(env.DB, itemId))?.status ?? read.status;
}

/** `{ version, createdAt, envelope, status }` for any state, or 404. */
async function baseline(
  request: Request,
  env: Env,
  itemId: string,
): Promise<Response> {
  const session = await sessionOf(request, env);
  if (session === undefined) return unauthorized();

  const item = await ownedItem(env, session, itemId);
  if (item === undefined) return notFound();
  const version = await latestVersion(env.DB, itemId);
  if (version === undefined) return notFound();

  return Response.json({
    version: version.version,
    createdAt: version.created_at,
    envelope: parseEnvelope(version),
    status: item.status,
  });
}

/** `{ version, status, uploadUrl }`: the validated version and its upload route. */
async function requestVersion(
  request: Request,
  env: Env,
  itemId: string,
): Promise<Response> {
  const session = await sessionOf(request, env);
  if (session === undefined) return unauthorized();

  const body = await readBody(request);
  if (body === undefined)
    return badRequest("A JSON body with an envelope and a name is required.");

  const validated = validateFabricThemeEnvelope(body["envelope"]);
  if (!validated.ok)
    return badRequest(validated.issues.map((issue) => issue.message).join(" "));
  const envelope = validated.envelope;

  // The path is not authority: a mismatch would let a client sign one item's
  // key while naming another item in the request.
  if (envelope.id !== itemId) {
    return badRequest(
      `The path names item "${itemId}" but the envelope's id is "${envelope.id}".`,
    );
  }

  const item = await itemById(env.DB, envelope.id);
  if (item !== undefined && item.author_user_id !== session.userId)
    return notFound();
  if (item?.status === "removed") {
    return new Response(
      item.status_reason ?? "This item was removed from the store.",
      { status: 409 },
    );
  }

  const name = body["name"];
  let newItemName: string | undefined;
  if (item === undefined) {
    if (!isNonEmptyString(name))
      return badRequest("A name is required for a new item.");
    newItemName = name;
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const plan = planVersion({
    previous: await previousEnvelope(env, envelope.id),
    candidate: envelope,
    now: nowIso,
  });
  if (!plan.ok) return badRequest(plan.message);

  // Cheapest refusal first, and the presign count is only spent once the
  // version plan has passed.
  if (!(await presignAllowed(env.DB, session.userId, now)))
    return tooMany("Too many upload requests; try again in an hour.");

  // The reservation is written before the answer and before the ownership race
  // below, in one statement that also re-checks the quota: a burst of requests
  // that all passed an earlier check must not all reserve past the ceiling, and
  // only the database can decide that atomically. A losing race deletes its row.
  const uploadId = crypto.randomUUID();
  const creatingNewItem = item === undefined;
  const reserved = await reserveUpload(env, {
    uploadId,
    userId: session.userId,
    itemId: envelope.id,
    version: plan.version,
    envelopeJson: JSON.stringify(envelope),
    now,
    nowIso,
    creatingNewItem,
  });
  if (!reserved) {
    // Name what the guard refused. A reservation that expired between the
    // insert and this read leaves the answer undefined, so the fallback is a
    // quota sentence true of both arms rather than the rate refusal, which is
    // answered above this reservation ever exists.
    const exceeded = await authorQuotaExceeded(
      env.DB,
      session.userId,
      MAX_ARCHIVE_BYTES,
      creatingNewItem,
      now,
    );
    if (exceeded === "items")
      return tooMany("An account may own at most 20 items.");
    if (exceeded === "bytes")
      return tooMany("An author's stored packages may total at most 1 GiB.");
    return tooMany(
      "Your account has no room for another package; try again later.",
    );
  }

  // A parallel first submission may win the insert; that loser is ignored
  // rather than failing on the PRIMARY KEY, then reads the row it shares. An
  // item another account created in the race is not ours to write.
  //
  // Everything after the reservation may still throw, and a URL the author
  // never received must not hold their budget for an hour: the catch deletes
  // the row. The two refusals below delete it as part of their own answer.
  let stored = item;
  try {
    if (newItemName !== undefined) {
      const wrote = await createDraft(
        env,
        envelope,
        session.userId,
        newItemName,
        nowIso,
      );
      stored = await itemById(env.DB, envelope.id);
      if (stored === undefined && !wrote) {
        // The draft insert's count arm refused: a parallel first submission
        // took the last of the 20 items between this request's reservation and
        // its insert. 0 rows and no row for the id is that arm by construction;
        // a PK conflict would have left the row this read finds.
        await env.DB.prepare("DELETE FROM upload WHERE id = ?")
          .bind(uploadId)
          .run();
        return tooMany("An account may own at most 20 items.");
      }
      if (stored === undefined || stored.author_user_id !== session.userId) {
        // The loser takes its reservation with it: a URL they cannot write must
        // not count against the author for the reservation's lifetime.
        await env.DB.prepare("DELETE FROM upload WHERE id = ?")
          .bind(uploadId)
          .run();
        return notFound();
      }
    }

    // The route's own origin, so a custom domain keeps answering with itself.
    const uploadUrl = `${new URL(request.url).origin}${UPLOADS_PREFIX}${uploadId}`;

    await env.DB.prepare(
      `INSERT INTO presign_event (user_id, at, item_id, version, envelope_json)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(
        session.userId,
        nowIso,
        envelope.id,
        plan.version,
        JSON.stringify(envelope),
      )
      .run();

    // A rejected item's new version goes back in the owner's queue whatever the
    // author's state (status machine: `rejected -> pending`); otherwise a
    // verified author publishes and an unverified one queues.
    const status =
      stored?.status === "rejected"
        ? "pending"
        : (await isVerified(env.DB, session.userId))
          ? "published"
          : "pending";

    return Response.json({ version: plan.version, status, uploadUrl });
  } catch (error) {
    try {
      await env.DB.prepare("DELETE FROM upload WHERE id = ?")
        .bind(uploadId)
        .run();
    } catch {
      // A failed delete must not replace the original failure.
    }
    throw error;
  }
}

/**
 * Writes one reservation only if the author's byte budget still has room.
 *
 * The check and the insert are one statement, because two requests that each
 * passed `authorQuotaExceeded` can otherwise both insert and overrun the byte
 * ceiling; D1 has no transaction to wrap the pair in. The pending side repeats
 * `pendingBytes`' predicate, cutoff included, so both read the same rows.
 *
 * The item arm here is a fast path only: a new item's row is written later by
 * `createDraft`, so the count in this statement is stale by construction and
 * that insert is the item ceiling's atomic gate. Answers whether the row was
 * written.
 */
async function reserveUpload(
  env: Env,
  input: {
    readonly uploadId: string;
    readonly userId: string;
    readonly itemId: string;
    readonly version: string;
    readonly envelopeJson: string;
    readonly now: Date;
    readonly nowIso: string;
    readonly creatingNewItem: boolean;
  },
): Promise<boolean> {
  const cutoff = new Date(
    input.now.getTime() - UPLOAD_RESERVATION_TTL_MS,
  ).toISOString();
  const result = await env.DB.prepare(
    `INSERT INTO upload (id, user_id, item_id, version, envelope_json, key,
       reserved_bytes, created_at, finalized_at, bytes)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL
     WHERE (
       (SELECT COALESCE(SUM(v.bytes), 0) FROM item_version v
          JOIN item i ON i.id = v.item_id WHERE i.author_user_id = ?)
       + (SELECT COALESCE(SUM(reserved_bytes), 0) FROM upload
          WHERE user_id = ? AND finalized_at IS NULL AND created_at > ?)
       + ? <= ?)
     AND (? = 0 OR
       (SELECT COUNT(*) FROM item WHERE author_user_id = ?) < ?)`,
  )
    .bind(
      input.uploadId,
      input.userId,
      input.itemId,
      input.version,
      input.envelopeJson,
      pendingKey(input.uploadId),
      MAX_ARCHIVE_BYTES,
      input.nowIso,
      input.userId,
      input.userId,
      cutoff,
      MAX_ARCHIVE_BYTES,
      MAX_AUTHOR_BYTES,
      input.creatingNewItem ? 1 : 0,
      input.userId,
      MAX_AUTHOR_ITEMS,
    )
    .run();
  return result.meta.changes > 0;
}

/**
 * Streams one reserved upload to R2 under its pending key.
 *
 * The declared length is checked before the body is touched, so an over-cap
 * package costs neither a read nor an object. It is then the length the stream
 * is pinned to: a body that sends more (or fewer) bytes errors the pump instead
 * of writing them, which is what makes an understated header harmless. The
 * stored size is checked again afterwards as the second gate.
 */
async function putUpload(
  request: Request,
  env: Env,
  uploadId: string,
): Promise<Response> {
  const session = await sessionOf(request, env);
  if (session === undefined) return unauthorized();
  if (uploadId.length === 0 || uploadId.includes("/")) return notFound();

  // A foreign id is indistinguishable from a missing one.
  const row = await env.DB.prepare(
    "SELECT finalized_at FROM upload WHERE id = ? AND user_id = ?",
  )
    .bind(uploadId, session.userId)
    .first<{ finalized_at: string | null }>();
  if (row === null) return notFound();
  if (row.finalized_at !== null) {
    return new Response("This upload is already finalized.", { status: 409 });
  }

  // Decimal digits only: `Number` would take `1e3`, `0x10`, `""` and padded
  // forms as lengths.
  const declared = request.headers.get("content-length");
  if (declared === null || !/^\d+$/.test(declared)) {
    return new Response("A content-length is required.", { status: 411 });
  }
  const length = Number(declared);
  if (!Number.isSafeInteger(length)) {
    return new Response("A content-length is required.", { status: 411 });
  }
  if (length > MAX_ARCHIVE_BYTES) {
    return new Response(
      `The uploaded package exceeds the ${MAX_ARCHIVE_BYTES / (1024 * 1024)} MiB limit.`,
      { status: 413 },
    );
  }

  const key = pendingKey(uploadId);
  const body = request.body;
  if (body === null) return badRequest("The upload has no body.");

  // The pinned sink makes the stored size exactly the declared length, so a
  // body that overruns or stops short is refused before R2 keeps any of it.
  const sink = new FixedLengthStream(length);
  // The pump owns its own rejection handling and never rejects, so nothing is
  // left floating once the response is sent. Its answer separates a body that
  // broke the pinned length from a store that failed to keep it.
  const pumped = pumpInto(body, sink, length);
  let stored: R2Object | null;
  try {
    // The conditional put makes this request the first writer, atomically: a
    // second PUT of the same URL cannot overwrite the winner, which is the one
    // thing a head-then-put cannot promise.
    stored = await env.BUCKET.put(key, sink.readable, {
      onlyIf: { etagDoesNotMatch: "*" },
    });
  } catch {
    if (await pumped)
      return badRequest("The upload's size does not match its content-length.");
    return new Response("The upload could not be stored.", { status: 500 });
  }
  if (stored === null) {
    // A winner already holds the key. Releasing the unread sink lets the pump
    // settle; a pending write is not a rejection, so nothing goes unhandled.
    await sink.readable.cancel().catch(() => undefined);
    return new Response("This upload URL has already been written.", {
      status: 409,
    });
  }
  await pumped;
  return new Response(null, { status: 201 });
}

/**
 * Feeds the request body into the length-pinned sink, one chunk at a time.
 *
 * The pump enforces the pinned length itself: a chunk that would cross it is
 * never offered to the sink, and a short body aborts rather than closes it. So
 * the sink only ever sees at most `length` bytes, and the one thing asked of it
 * is an abort — which lets a store that stopped reading settle here instead of
 * leaving a rejected promise behind the response.
 *
 * Answers whether the body was at fault, which is what separates a client
 * error from the store's: a throwing reader, more than `length` bytes, or a
 * body that ends short is `true`; a write or close that fails with no more
 * than `length` bytes offered is `false`.
 *
 * Exported for its unit tests; the route is its only caller.
 */
export async function pumpInto(
  source: ReadableStream<Uint8Array>,
  sink: {
    readonly writable: WritableStream<ArrayBuffer | ArrayBufferView>;
  },
  length: number,
): Promise<boolean> {
  const reader = source.getReader();
  const writer = sink.writable.getWriter();
  const answer = async (bodyAtFault: boolean): Promise<boolean> => {
    await writer.abort().catch(() => undefined);
    return bodyAtFault;
  };
  let produced = 0;
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        return await answer(true);
      }
      if (chunk.done) break;
      produced += chunk.value.byteLength;
      // The chunk that crosses the pinned length is never offered to the sink.
      if (produced > length) return await answer(true);
      try {
        await writer.write(chunk.value);
      } catch {
        // Nothing beyond `length` was offered, so the sink itself failed.
        return await answer(false);
      }
    }
    if (produced < length) return await answer(true);
    try {
      await writer.close();
    } catch {
      // The body was exactly `length` bytes, so the sink itself failed.
      return await answer(false);
    }
    return false;
  } finally {
    try {
      reader.releaseLock();
      writer.releaseLock();
    } catch {
      // A locked stream is being torn down anyway; nothing to report.
    }
  }
}

/**
 * The uploaded object becomes a version only here: the envelope is the one the
 * version request validated, the bytes and hash are read from the reservation's
 * own R2 key, and the status transition is applied last. The reservation is
 * released with the actual size once the version row is settled. A finalize of
 * the same bytes is a no-op so a retried request cannot double-write.
 */
async function finalizeVersion(
  request: Request,
  env: Env,
  itemId: string,
  version: string,
): Promise<Response> {
  const session = await sessionOf(request, env);
  if (session === undefined) return unauthorized();

  const item = await ownedItem(env, session, itemId);
  if (item === undefined) return notFound();
  if (item.status === "removed") {
    return new Response(
      item.status_reason ?? "This item was removed from the store.",
      { status: 409 },
    );
  }

  const presign = await presignEventOf(env.DB, session.userId, itemId, version);
  if (presign === undefined) return noUploadRequested(version);
  const uploads = await uploadsForVersion(
    env.DB,
    session.userId,
    itemId,
    version,
  );
  if (uploads.length === 0) return noUploadRequested(version);

  const body = await readBody(request);
  if (body === undefined)
    return badRequest("A JSON body with a thumbnail is required.");
  const thumbnail = decodeThumbnail(body["thumbnail"]);
  if (!thumbnail.ok) return unprocessable(thumbnail.message);

  // Newest first: a second version request after a failed PUT mints a later
  // row, so the newest row with an object is the one the author wrote. A row
  // whose PUT never landed has no object and is skipped, not chosen.
  let stored: UploadRow | undefined;
  let size = 0;
  for (const upload of uploads) {
    const head = await env.BUCKET.head(upload.key);
    if (head === null) continue;
    stored = upload;
    size = head.size;
    break;
  }
  if (stored === undefined) return notFound();
  // The size is refused from HEAD, before the package is hashed.
  if (size > MAX_ARCHIVE_BYTES)
    return unprocessable(
      `The uploaded package exceeds the ${MAX_ARCHIVE_BYTES / (1024 * 1024)} MiB limit.`,
    );

  const inspected = await inspectObject(env.BUCKET, stored.key);
  if (inspected === undefined) return notFound();

  const now = new Date().toISOString();
  const existing = await versionOf(env.DB, itemId, version);
  if (existing !== undefined) {
    if (
      existing.sha256 !== inspected.sha256 ||
      existing.bytes !== inspected.bytes
    )
      return differentBytes(version);

    // A retry whose first attempt landed the version row but not the release
    // heals here; a finished replay is a no-op on the predicate. The release
    // also runs on the equal-instant replay path, where the row is already
    // finalized and the UPDATE changes nothing.
    await markUploadFinalized(env.DB, stored.id, inspected.bytes, now);

    // A retry whose first attempt was interrupted between the two writes has
    // not moved the item since the version row landed, so it re-applies the
    // transition. A replay after any later transition must not: `unpublished`,
    // `rejected` and a demotion are the author's or the owner's, and the
    // presigned address outlives the request that minted it.
    //
    // The version row and the status write in one finalize share one instant,
    // which is why this is a strict `<`: an equal instant may be a write that
    // landed, and treating it as one refuses a replay instead of undoing a
    // later state. The limit is the same millisecond — a transition that lands
    // within the version's own millisecond is indistinguishable here.
    if (item.updated_at < existing.created_at)
      return await settle(env, session, item, version, now);
    return Response.json({ ok: true, status: item.status, version });
  }

  await env.BUCKET.put(thumbnailKey(itemId), thumbnail.bytes, {
    httpMetadata: { contentType: "image/png" },
  });
  const wrote = await insertVersion(env.DB, {
    item_id: itemId,
    version,
    envelope_json: presign.envelope_json,
    facets_json: JSON.stringify(facetRecordOf(parseEnvelope(presign))),
    package_key: stored.key,
    thumbnail_key: thumbnailKey(itemId),
    bytes: inspected.bytes,
    sha256: inspected.sha256,
    created_at: now,
  });
  // A parallel finalize of the same version won the insert. The comparison the
  // serial path made above is the same one, so both requests give one answer.
  if (!wrote) {
    const won = await versionOf(env.DB, itemId, version);
    if (
      won === undefined ||
      won.sha256 !== inspected.sha256 ||
      won.bytes !== inspected.bytes
    )
      return differentBytes(version);
  }

  // The version row lands before the reservation is released, never after: for
  // a few milliseconds both count against the author, which can only refuse a
  // concurrent version request conservatively. The reverse would count neither.
  await markUploadFinalized(env.DB, stored.id, inspected.bytes, now);
  return await settle(env, session, item, version, now);
}

/** No reservation and a reservation with no row answer the same 409. */
function noUploadRequested(version: string): Response {
  return new Response(`No upload was requested for version "${version}".`, {
    status: 409,
  });
}

/**
 * Applies the finalize's status transition and answers the settled version.
 * The guarded write answers `false` when a takedown raced the route's read; it
 * is the owner's verdict, so the version row stays and the answer is a conflict.
 */
async function settle(
  env: Env,
  session: Session,
  item: ItemRow,
  version: string,
  now: string,
): Promise<Response> {
  const status = nextStatus(
    item.status,
    await isVerified(env.DB, session.userId),
  );
  if (!(await markFinalized(env.DB, item.id, status, now)))
    return await takenDown(env, item.id);
  return Response.json({ ok: true, status, version });
}

/** The one refusal a second finalize of one version with other bytes gets. */
export function differentBytes(version: string): Response {
  return new Response(
    `Version "${version}" already exists with different bytes.`,
    { status: 409 },
  );
}

/** The reason a guarded finalize write changed no row: the item was removed. */
export async function takenDown(env: Env, itemId: string): Promise<Response> {
  const item = await itemById(env.DB, itemId);
  return new Response(
    item?.status_reason ?? "This item is no longer available.",
    {
      status: 409,
    },
  );
}

/**
 * `rejected -> pending` outranks the verified author's publish rule: the owner
 * re-approves a resubmission. Every other state publishes for a verified author
 * and queues for an unverified one, `published` included.
 */
function nextStatus(
  current: CatalogueStatus,
  verified: boolean,
): CatalogueStatus {
  if (current === "rejected") return "pending";
  return verified ? "published" : "pending";
}

type Thumbnail =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly message: string };

function decodeThumbnail(value: unknown): Thumbnail {
  if (typeof value !== "string" || value.length === 0)
    return { ok: false, message: "A base64 PNG thumbnail is required." };

  let binary: string;
  try {
    binary = atob(value);
  } catch {
    return { ok: false, message: "The thumbnail is not valid base64." };
  }
  if (binary.length > MAX_THUMBNAIL_BYTES)
    return {
      ok: false,
      message: "The thumbnail exceeds the 2 MiB limit.",
    };

  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (
    bytes.length < PNG_SIGNATURE.length ||
    PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)
  )
    return { ok: false, message: "The thumbnail is not a PNG." };
  return { ok: true, bytes };
}

/** A foreign item is indistinguishable from a missing one. */
async function ownedItem(
  env: Env,
  session: Session,
  itemId: string,
): Promise<ItemRow | undefined> {
  const item = await itemById(env.DB, itemId);
  if (item === undefined || item.author_user_id !== session.userId)
    return undefined;
  return item;
}

/** The latest stored version in any state is the ladder's baseline. */
async function previousEnvelope(
  env: Env,
  itemId: string,
): Promise<
  | { readonly version: string; readonly envelope: FabricThemeEnvelope }
  | undefined
> {
  const row = await latestVersion(env.DB, itemId);
  return row === undefined
    ? undefined
    : { version: row.version, envelope: parseEnvelope(row) };
}

/**
 * A row this Worker wrote was validated before it was stored, so the only read
 * work left is the schema migration: a row from before the semver switch still
 * carries the legacy integer `2`, and feeding that to the version ladder reports
 * a schema change where none happened. A row that will not migrate is
 * corruption, not an old format, so it fails loudly rather than being served.
 */
function parseEnvelope(row: {
  readonly envelope_json: string;
}): FabricThemeEnvelope {
  const migrated = migrateFabricThemeEnvelope(JSON.parse(row.envelope_json));
  if (!migrated.ok) throw new Error(migrated.issue.message);
  return migrated.document as unknown as FabricThemeEnvelope;
}

/**
 * Draft is invisible to the public routes until a finalize applies a status.
 *
 * This insert is the item ceiling's atomic gate: the count and the write are
 * one statement, so two parallel first submissions cannot both make a 21st
 * item. `OR IGNORE` because two parallel first submissions of one id both reach
 * here, which also makes 0 rows ambiguous — the caller distinguishes the two by
 * re-reading the row: present means the conflict, absent means the count arm
 * refused. Answers whether this call wrote the row.
 */
async function createDraft(
  env: Env,
  envelope: FabricThemeEnvelope,
  userId: string,
  name: string,
  now: string,
): Promise<boolean> {
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO item (id, kind, author_user_id, name, status,
       status_reason, created_at, updated_at, published_at, unpublished_at,
       removed_at, downloads, remix_of_id)
     SELECT ?, ?, ?, ?, 'draft', NULL, ?, ?, NULL, NULL, NULL, 0, ?
     WHERE (SELECT COUNT(*) FROM item WHERE author_user_id = ?) < ?`,
  )
    .bind(
      envelope.id,
      DASHBOARD_THEME_KIND,
      userId,
      name,
      now,
      now,
      envelope.metadata?.remixOf?.catalogueId ?? null,
      userId,
      MAX_AUTHOR_ITEMS,
    )
    .run();
  return result.meta.changes > 0;
}

async function isVerified(db: D1Database, userId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT verified FROM author_profile WHERE user_id = ?")
    .bind(userId)
    .first<{ verified: number }>();
  return row?.verified === 1;
}

async function readBody(
  request: Request,
): Promise<Record<string, unknown> | undefined> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return undefined;
  }
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function unauthorized(): Response {
  return new Response("Unauthorized", { status: 401 });
}

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

function badRequest(message: string): Response {
  return new Response(message, { status: 400 });
}

function tooMany(message: string): Response {
  return new Response(message, { status: 429 });
}

function conflict(status: string, needs: string): Response {
  return new Response(`Item is ${status}; this action needs ${needs}.`, {
    status: 409,
  });
}

function unprocessable(message: string): Response {
  return new Response(message, { status: 422 });
}
