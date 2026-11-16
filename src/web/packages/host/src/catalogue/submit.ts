import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import {
  type CatalogueEntry,
  parseCatalogueIndex,
  STORE_ITEM_KINDS,
} from "@yunari/renderer-core";
import {
  bumpVersion,
  collectionManifest,
  readCollectionDraft,
  validateCollectionIncludes,
} from "@yunari/theme-package";
import { isForeignOrigin, isLoopbackRemote, readBody } from "../server.js";
import type { StoreSessionStore } from "../settings/store-session.js";
import type { ThemeStore } from "../themes/store.js";
import type { StoreClient, VersionPlan } from "../themes/store-client.js";
import { createStoreClient, StoreClientError } from "../themes/store-client.js";
import { submissionFiles } from "../themes/submission.js";
import type { ThumbnailStore } from "../themes/thumbnails.js";

/**
 * The submission route, kept out of `server.ts` for the reason the store
 * sign-in routes are: that file is already past the size a reader can hold.
 *
 * The browser sends either one id or one collection draft; the host does the
 * rest — read the library theme, bump it against the Worker's baseline, request
 * a version, PUT the package through the Worker's upload route and finalize with
 * the thumbnail. A collection is packaged here rather than in the browser, so
 * the format has one writer and the store token never leaves this process.
 * **The session token reaches this module and the `Authorization` header, and
 * nothing else.**
 */

export const SUBMIT_PATH = "/api/themes/submit";

/** The one refusal a body over the limit gets. */
const TOO_LARGE = "That submission request is too large.";
const NOT_JSON = "That submission request is not JSON.";
const NO_ID = "A submission needs the id of a library theme.";
const NO_SESSION = "Sign in to the store before submitting.";
const NO_STORE = "This host has no store to submit to.";
const CATALOGUE_UNREADABLE =
  "The store's catalogue could not be read, so this collection was not submitted.";
/** A collection publication starts at the first release; a name that matches an
 *  existing collection adds a version instead. */
const FIRST_COLLECTION_VERSION = "1.0.0";

export interface SubmitRouteDeps {
  /** The Worker's origin. Absent when this host has no store to submit to. */
  readonly origin: string | undefined;
  readonly sessionStore: StoreSessionStore | undefined;
  readonly themeStore: ThemeStore;
  readonly thumbnails: ThumbnailStore | undefined;
  readonly fetch: typeof fetch;
  readonly now: () => Date;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function text(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/** The status a thrown store refusal deserves: the session's own refusal is a
 *  sign-in problem, a 4xx is the author's submission being refused, and
 *  everything else is the store being unreachable. A 401 from an authenticated
 *  call spends the stored session, so the next press asks for a sign-in rather
 *  than repeating it. Every call here is authenticated, the upload included. */
async function refusal(
  error: unknown,
  store: StoreSessionStore | undefined,
  authenticatedCall: boolean,
): Promise<Response> {
  if (error instanceof StoreClientError) {
    if (authenticatedCall && error.status === 401) await store?.clear();
    const status =
      error.status === 401 || error.status === 403
        ? 401
        : error.status >= 400 && error.status < 500
          ? 400
          : 502;
    return json(status, { ok: false, message: error.message });
  }
  return json(502, {
    ok: false,
    message: "The store could not be reached; submit again when it is.",
  });
}

export async function handleSubmitRoute(
  request: IncomingMessage,
  url: URL,
  deps: SubmitRouteDeps,
): Promise<Response | undefined> {
  if (url.pathname !== SUBMIT_PATH) return undefined;

  if (request.method !== "POST") return text(405, "Only POST is supported.");
  // It acts as the author's store account, so it carries the sign-in routes'
  // guards in their order: loopback, origin, Host.
  if (!isLoopbackRemote(request.socket.remoteAddress)) {
    return text(403, "Theme submission is local to this PC only.");
  }
  if (isForeignOrigin(request)) {
    return text(403, "That request is from another origin.");
  }

  const origin = deps.origin;
  if (origin === undefined) return text(503, NO_STORE);

  const session =
    deps.sessionStore === undefined
      ? undefined
      : await deps.sessionStore.read();
  if (session === undefined) {
    return json(401, { ok: false, message: NO_SESSION });
  }

  let raw: string;
  try {
    raw = await readBody(request);
  } catch {
    return text(413, TOO_LARGE);
  }

  let body: Readonly<Record<string, unknown>> | undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    body =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Readonly<Record<string, unknown>>)
        : undefined;
  } catch {
    return text(400, NOT_JSON);
  }

  const client = createStoreClient({
    origin,
    token: session.token,
    fetch: deps.fetch,
  });

  if (body?.["kind"] === "collection") {
    return submitCollection(body, client, deps, origin);
  }

  const value = body?.["id"];
  const id = typeof value === "string" && value !== "" ? value : undefined;
  if (id === undefined) return text(400, NO_ID);

  let plan: Awaited<ReturnType<typeof submissionFiles>>;
  try {
    plan = await submissionFiles(id, deps.themeStore, {
      ...(deps.thumbnails === undefined ? {} : { thumbnails: deps.thumbnails }),
      now: () => deps.now(),
      client,
    });
  } catch (error) {
    return refusal(error, deps.sessionStore, true);
  }
  if (!plan.ok) {
    return json(400, { ok: false, message: plan.message });
  }

  // The upload is the Worker's own authenticated route, so its 401 is the
  // same session refusal every other call's is.
  try {
    await client.upload(plan.files.uploadUrl, plan.files.packageBytes);
  } catch (error) {
    return refusal(error, deps.sessionStore, true);
  }

  try {
    const finalized = await client.finalize(
      id,
      plan.files.version,
      plan.files.thumbnailBytes,
      plan.files.thumbnailLuminance,
    );
    return json(200, {
      ok: true,
      status: finalized.status,
      version: {
        from: plan.files.from ?? null,
        to: plan.files.version,
        level: plan.files.level,
      },
    });
  } catch (error) {
    return refusal(error, deps.sessionStore, true);
  }
}

/**
 * One collection submission: the draft the builder posted, packaged here.
 *
 * The header is revalidated rather than trusted — every include must be a
 * catalogue id the store currently lists as published, and the shared rule
 * refuses a self-reference or another collection by name before a version row
 * exists. The bytes, their digest and their size are built from the draft with
 * the format's one writer, so what the Worker validates is what this host read.
 *
 * **A name that matches one of this author's collections publishes a version of
 * it**, so a retry after a lost answer, or a membership change, reaches the
 * listing that already exists instead of minting a second public collection. A
 * name that matches nothing mints an id — nothing in the pack route does.
 *
 * **The cover is the published picture of the collection's first member** (the
 * first required include, else the first optional one). The store never invents
 * an image: when that picture cannot be fetched the submission is refused and
 * the member is named.
 */
async function submitCollection(
  body: Readonly<Record<string, unknown>>,
  client: StoreClient,
  deps: SubmitRouteDeps,
  origin: string,
): Promise<Response> {
  const read = readCollectionDraft(body);
  if (!read.ok) return json(400, { ok: false, message: read.message });
  const draft = read.draft;

  const entries = await catalogueEntries(origin, deps.fetch);
  if (entries === undefined) {
    return json(502, { ok: false, message: CATALOGUE_UNREADABLE });
  }

  let existing: { readonly id: string; readonly version: string } | undefined;
  try {
    const mine = await client.mine();
    const match = mine.entries.find(
      (entry) => entry.kind === "collection" && entry.name === draft.name,
    );
    if (match !== undefined && match.status !== "removed") {
      existing = { id: match.id, version: match.version };
    }
  } catch (error) {
    return refusal(error, deps.sessionStore, true);
  }

  const id = existing?.id ?? randomUUID();
  const published = new Map(
    [...entries].map(([entryId, entry]) => [entryId, entry.kind]),
  );
  const membership = validateCollectionIncludes(draft.includes, published, id);
  if (!membership.ok)
    return json(400, { ok: false, message: membership.message });

  const version =
    existing === undefined
      ? FIRST_COLLECTION_VERSION
      : bumpVersion(existing.version, "minor");
  if (version === undefined) {
    return json(400, {
      ok: false,
      message: `The store's copy of "${draft.name}" records version "${existing?.version ?? ""}", which cannot be bumped.`,
    });
  }

  // The first required include, or the first optional one when every member is
  // optional. Membership just proved it is listed, so the entry is present.
  const coverMember =
    draft.includes.find((include) => !include.optional) ?? draft.includes[0];
  const coverEntry =
    coverMember === undefined ? undefined : entries.get(coverMember.id);
  const cover =
    coverEntry === undefined
      ? undefined
      : await fetchBytes(coverEntry.thumbnail, origin, deps.fetch);
  if (
    coverMember === undefined ||
    coverEntry === undefined ||
    cover === undefined
  ) {
    return json(502, {
      ok: false,
      message: `The collection's cover could not be fetched from "${coverEntry?.name ?? coverMember?.id ?? draft.name}", so this collection was not submitted.`,
    });
  }

  const bytes = collectionManifest(draft);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  let plan: VersionPlan;
  try {
    plan = await client.createPackVersion(id, {
      kind: "collection",
      name: draft.name,
      version,
      metadata: {
        name: draft.name,
        description: draft.description,
        includes: draft.includes,
      },
      sha256,
      bytes: bytes.byteLength,
    });
  } catch (error) {
    return refusal(error, deps.sessionStore, true);
  }

  try {
    await client.upload(plan.uploadUrl, bytes);
  } catch (error) {
    return refusal(error, deps.sessionStore, true);
  }

  try {
    const finalized = await client.finalize(id, plan.version, cover, undefined);
    return json(200, {
      ok: true,
      status: finalized.status,
      version: {
        from: existing?.version ?? null,
        to: plan.version,
        level: existing === undefined ? "initial" : "minor",
      },
    });
  } catch (error) {
    return refusal(error, deps.sessionStore, true);
  }
}

/**
 * The published catalogue by id. Only published entries are listed, and an
 * entry this build cannot read is left out, so an include that cannot be
 * confirmed is refused. Undefined is a catalogue that could not be read.
 */
async function catalogueEntries(
  origin: string,
  doFetch: typeof fetch,
): Promise<Map<string, CatalogueEntry> | undefined> {
  let response: Response;
  try {
    response = await doFetch(new URL("/index.json", origin));
  } catch {
    return undefined;
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(await response.text());
  } catch {
    return undefined;
  }
  const index = parseCatalogueIndex(value, STORE_ITEM_KINDS);
  return new Map(index.entries.map((entry) => [entry.id, entry]));
}

/** One published file's bytes, or undefined when the store could not serve it.
 *  The path is the catalogue entry's own; no client-supplied URL is fetched. */
async function fetchBytes(
  path: string,
  origin: string,
  doFetch: typeof fetch,
): Promise<Uint8Array | undefined> {
  const url = `${origin.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  let response: Response;
  try {
    response = await doFetch(url);
  } catch {
    return undefined;
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return undefined;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes.byteLength === 0 ? undefined : bytes;
}
