import { publisherOf } from "@yunari/extension-api";
import type { Env } from "../env.js";

/** The public document: one row per killed plugin key. */
export interface KillListDocument {
  readonly version: 1;
  readonly generatedAt: string;
  readonly plugins: Readonly<Record<string, { readonly advisory?: string }>>;
}

const KILL_LIST = "/kill-list.json";
const MAX_ADVISORY_LENGTH = 2048;

/**
 * The revoke list the host polls. A killed plugin stops loading on every host
 * that refreshes, whether or not its consent still matches.
 *
 * Only `GET /kill-list.json` lives here; the owner's writes are admin routes,
 * so they pass the one owner guard in `admin.ts`.
 */
export async function handleKillList(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response | undefined> {
  if (request.method !== "GET" || url.pathname !== KILL_LIST) return undefined;
  const document = await killListOf(env.DB);
  return Response.json(document, {
    headers: { "cache-control": "max-age=60" },
  });
}

/** The whole list, newest row's instant as the document's own stamp. An empty
 *  list has no facts to date, so it is stamped now. */
export async function killListOf(db: D1Database): Promise<KillListDocument> {
  const rows = await db
    .prepare(
      "SELECT plugin_key, advisory_url, created_at FROM kill_list ORDER BY plugin_key",
    )
    .all<{
      readonly plugin_key: string;
      readonly advisory_url: string | null;
      readonly created_at: string;
    }>();

  const plugins: Record<string, { advisory?: string }> = {};
  let newest: string | undefined;
  for (const row of rows.results) {
    plugins[row.plugin_key] =
      row.advisory_url === null ? {} : { advisory: row.advisory_url };
    if (newest === undefined || row.created_at > newest) {
      newest = row.created_at;
    }
  }
  return {
    version: 1,
    generatedAt: newest ?? new Date().toISOString(),
    plugins,
  };
}

/** Whether a key is the `publisher/id` shape the host and the plugins use. */
export function isPluginKey(key: string): boolean {
  return publisherOf(key) !== undefined && key.length <= 200;
}

/** An advisory link the browser is sent to; only `https:` leaves this host. */
export function isAdvisoryUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_ADVISORY_LENGTH) {
    return false;
  }
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Inserts or moves a key. The first listing keeps its instant: the document's
 *  `generatedAt` is when the key was killed, not when its link changed. */
export async function setKill(
  db: D1Database,
  key: string,
  advisory: string | undefined,
  now: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO kill_list (plugin_key, advisory_url, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(plugin_key) DO UPDATE SET advisory_url = excluded.advisory_url`,
    )
    .bind(key, advisory ?? null, now)
    .run();
}

/** `false` when the key was not killed, so a repeat DELETE is a 404. */
export async function clearKill(db: D1Database, key: string): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM kill_list WHERE plugin_key = ?")
    .bind(key)
    .run();
  return (result.meta.changes ?? 0) > 0;
}
