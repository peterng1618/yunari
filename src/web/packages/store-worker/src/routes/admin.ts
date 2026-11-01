import { isOwner } from "../auth/owner.js";
import { sessionOf } from "../auth/session.js";
import type { QueueListing } from "../db/items.js";
import {
  itemById,
  queueListings,
  setStatus,
  setStatusStatement,
} from "../db/items.js";
import {
  openReports,
  reportStatusOf,
  resolveReportsOnRemovalStatement,
  setReportStatus,
} from "../db/reports.js";
import type { Env } from "../env.js";
import { MAX_JSON_BODY, readJsonBody } from "./body.js";

const ADMIN_PREFIX = "/api/admin/";
const QUEUE = "/api/admin/queue";
const REPORTS = "/api/admin/reports";
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

/** One open report as the owner's triage queue shows it. */
export interface ReportEntry {
  readonly itemId: string;
  readonly itemName: string;
  readonly itemStatus: string;
  readonly reporterUserId: string;
  readonly category: string;
  readonly note: string | null;
  readonly createdAt: string;
  /** Open reports on the same item, tallied from this queue's own rows. */
  readonly openReports: number;
}

/**
 * The owner's half of the store: the pending queue, item status transitions,
 * author verification and report triage.
 *
 * A session is resolved before any route work, and a signed-in non-owner is
 * answered 404 exactly like a missing path — the admin surface must not tell an
 * author it exists. The queues answer `{ entries }`; the pending queue is oldest
 * first, and the report queue is the same order so the oldest complaint leads.
 * An unmatched path returns `undefined`, leaving the Worker's default 404.
 *
 * A report is resolved or dismissed once. `POST .../resolve` and `.../dismiss`
 * name the report by its two-key identity — `reports/<userId>/<itemId>/<action>`
 * — because one account reports one item once. The verdict is `status` plus
 * `resolved_at`; a takedown also writes the removal reason to `outcome`.
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
  | { readonly kind: "reports" }
  | {
      readonly kind: "item";
      readonly itemId: string;
      readonly action: "approve" | "reject" | "remove" | "restore";
    }
  | {
      readonly kind: "report";
      readonly userId: string;
      readonly itemId: string;
      readonly action: "resolve" | "dismiss";
    }
  | {
      readonly kind: "author";
      readonly userId: string;
      readonly verified: boolean;
    };

function matchRoute(method: string, pathname: string): Route | undefined {
  if (method === "GET" && pathname === QUEUE) return { kind: "queue" };
  if (method === "GET" && pathname === REPORTS) return { kind: "reports" };
  if (method !== "POST") return undefined;

  const parts = pathname.slice(ADMIN_PREFIX.length).split("/");
  if (parts[0] === "reports") {
    const [, userId, itemId, action, ...rest] = parts;
    if (
      rest.length === 0 &&
      userId !== undefined &&
      userId.length > 0 &&
      itemId !== undefined &&
      itemId.length > 0 &&
      (action === "resolve" || action === "dismiss")
    )
      return { kind: "report", userId, itemId, action };
    return undefined;
  }

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
  if (route.kind === "reports") return reportQueue(env);
  if (route.kind === "report")
    return reportAction(route.userId, route.itemId, route.action, env);
  if (route.kind === "author")
    return setVerified(env, route.userId, route.verified);
  return itemAction(route.action, route.itemId, request, env);
}

async function reportQueue(env: Env): Promise<Response> {
  // One statement for every open report and its item. The per-item count is
  // tallied from these rows, so the number the owner sees and the rows they act
  // on cannot disagree.
  const rows = await openReports(env.DB);
  const openByItem = new Map<string, number>();
  for (const row of rows) {
    openByItem.set(row.item_id, (openByItem.get(row.item_id) ?? 0) + 1);
  }
  const entries: ReportEntry[] = rows.map((row) => ({
    itemId: row.item_id,
    itemName: row.item_name,
    itemStatus: row.item_status,
    reporterUserId: row.user_id,
    category: row.category,
    note: row.note,
    createdAt: row.created_at,
    openReports: openByItem.get(row.item_id) ?? 0,
  }));
  return Response.json({ entries });
}

async function reportAction(
  userId: string,
  itemId: string,
  action: "resolve" | "dismiss",
  env: Env,
): Promise<Response> {
  const status = action === "resolve" ? "resolved" : "dismissed";
  const changed = await setReportStatus(
    env.DB,
    userId,
    itemId,
    status,
    new Date().toISOString(),
  );
  if (!changed) {
    const current = await reportStatusOf(env.DB, userId, itemId);
    if (current === undefined) return notFound();
    return new Response(
      `Report on item "${itemId}" by user "${userId}" is ${current}; this action needs open.`,
      { status: 409 },
    );
  }
  return Response.json({ ok: true, status });
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

  const at = new Date().toISOString();
  let changed: boolean;
  if (action === "remove") {
    // A removal resolves every open report on the item in the same act, so a
    // crash cannot leave an item taken down with its reports still open. The
    // report statement is guarded by the status write's own `removed_at`: a
    // failed precondition resolves nothing.
    const results = await env.DB.batch([
      setStatusStatement(
        env.DB,
        itemId,
        transition.from,
        transition.to,
        at,
        reason,
      ),
      resolveReportsOnRemovalStatement(env.DB, itemId, reason ?? "", at),
    ]);
    changed = (results[0]?.meta.changes ?? 0) > 0;
  } else {
    changed = await setStatus(
      env.DB,
      itemId,
      transition.from,
      transition.to,
      at,
      reason,
    );
  }
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
