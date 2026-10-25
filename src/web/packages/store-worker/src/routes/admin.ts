import { isOwner } from "../auth/owner.js";
import { sessionOf } from "../auth/session.js";
import type { QueueListing } from "../db/items.js";
import { itemById, queueListings, setStatus } from "../db/items.js";
import type { Env } from "../env.js";
import { MAX_JSON_BODY, readJsonBody } from "./body.js";

const ADMIN_PREFIX = "/api/admin/";
const QUEUE = "/api/admin/queue";
const MAX_REASON_LENGTH = 500;

/** One pending item as the owner's queue shows it. */
export interface QueueEntry {
  readonly id: string;
  readonly name: string;
  /** `item.author_user_id`; the id Better Auth issued. */
  readonly authorUserId: string;
  /** Better Auth's `"user".email`, or `null` when the account is gone. */
  readonly authorEmail: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** The latest `item_version.version`, or `null` before a first finalize. */
  readonly version: string | null;
  readonly status: string;
}

/**
 * The owner's half of the store: the pending queue, the status transitions and
 * author verification.
 *
 * A session is resolved before any route work, and a signed-in non-owner is
 * answered 404 exactly like a missing path — the admin surface must not tell an
 * author it exists. The queue answers `{ entries: QueueEntry[] }`, oldest first.
 * An unmatched path returns `undefined`, leaving the Worker's default 404.
 */
export async function handleAdmin(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response | undefined> {
  if (!url.pathname.startsWith(ADMIN_PREFIX)) return undefined;

  const route = matchRoute(request.method, url.pathname);
  if (route === undefined) return undefined;

  const session = await sessionOf(request, env);
  if (session === undefined) return unauthorized();
  if (!isOwner(session, env.OWNER_EMAILS)) return notFound();

  return dispatch(route, request, env);
}

type Route =
  | { readonly kind: "queue" }
  | {
      readonly kind: "item";
      readonly itemId: string;
      readonly action: "approve" | "reject" | "remove" | "restore";
    }
  | {
      readonly kind: "author";
      readonly userId: string;
      readonly verified: boolean;
    };

function matchRoute(method: string, pathname: string): Route | undefined {
  if (method === "GET" && pathname === QUEUE) return { kind: "queue" };
  if (method !== "POST") return undefined;

  const parts = pathname.slice(ADMIN_PREFIX.length).split("/");
  const [head, subject, action, ...rest] = parts;
  if (rest.length > 0 || action === undefined) return undefined;

  if (head === "items" && subject !== undefined && subject.length > 0) {
    if (
      action === "approve" ||
      action === "reject" ||
      action === "remove" ||
      action === "restore"
    )
      return { kind: "item", itemId: subject, action };
    return undefined;
  }
  if (head === "authors" && subject !== undefined && subject.length > 0) {
    if (action === "verify")
      return { kind: "author", userId: subject, verified: true };
    if (action === "unverify")
      return { kind: "author", userId: subject, verified: false };
  }
  return undefined;
}

async function dispatch(
  route: Route,
  request: Request,
  env: Env,
): Promise<Response> {
  if (route.kind === "queue") return queue(env);
  if (route.kind === "author")
    return setVerified(env, route.userId, route.verified);
  return itemAction(route.action, route.itemId, request, env);
}

async function queue(env: Env): Promise<Response> {
  // One statement: the item, its latest version and its author's email.
  const rows = await queueListings(env.DB);
  return Response.json({ entries: rows.map(queueEntryOf) });
}

function queueEntryOf(row: QueueListing): QueueEntry {
  const { item, version, authorEmail } = row;
  return {
    id: item.id,
    name: item.name,
    authorUserId: item.author_user_id,
    authorEmail,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    version: version?.version ?? null,
    status: item.status,
  };
}

/** The `from` sets and reason rules the status machine spells out. */
const TRANSITIONS = {
  approve: { from: ["pending"], to: "published", needsReason: false },
  reject: { from: ["pending"], to: "rejected", needsReason: true },
  remove: {
    from: ["published", "unpublished", "pending"],
    to: "removed",
    needsReason: true,
  },
  restore: { from: ["removed"], to: "published", needsReason: false },
} as const;

async function itemAction(
  action: keyof typeof TRANSITIONS,
  itemId: string,
  request: Request,
  env: Env,
): Promise<Response> {
  const transition = TRANSITIONS[action];
  const item = await itemById(env.DB, itemId);
  if (item === undefined) return notFound();

  let reason: string | null = null;
  if (transition.needsReason) {
    const read = await readReason(request);
    if (typeof read !== "string") return read;
    reason = read;
  }

  const changed = await setStatus(
    env.DB,
    itemId,
    transition.from,
    transition.to,
    new Date().toISOString(),
    reason,
  );
  if (!changed) {
    return new Response(
      `Item "${itemId}" is ${item.status}; this action needs ${transition.from.join(" or ")}.`,
      { status: 409 },
    );
  }
  return Response.json({ ok: true, status: transition.to });
}

/** A verdict sentence: trimmed, non-empty and bounded. */
async function readReason(request: Request): Promise<string | Response> {
  const read = await readJsonBody(request, MAX_JSON_BODY);
  if (!read.ok) return read.response;
  const value = read.body["reason"];
  if (typeof value !== "string" || value.trim().length === 0)
    return badRequest("A reason is required.");
  const reason = value.trim();
  if (reason.length > MAX_REASON_LENGTH)
    return badRequest(
      `A reason may be at most ${MAX_REASON_LENGTH} characters.`,
    );
  return reason;
}

/**
 * An unknown user id is allowed: the owner may verify ahead of a first sign-in.
 * `display_name` is left out of the insert so the conflict update keeps it.
 */
async function setVerified(
  env: Env,
  userId: string,
  verified: boolean,
): Promise<Response> {
  await env.DB.prepare(
    `INSERT INTO author_profile (user_id, verified) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET verified = excluded.verified`,
  )
    .bind(userId, verified ? 1 : 0)
    .run();
  return Response.json({ ok: true, userId, verified });
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
