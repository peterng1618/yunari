import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { publisherOf } from "@yunari/extension-api";

/** One killed plugin: the key is `publisher/id`, and a link is where the host
 *  sends its owner to read why. */
export interface KillListEntry {
  readonly advisory?: string;
}

/** The document the store serves and the host caches. */
export interface KillList {
  readonly version: 1;
  readonly generatedAt: string;
  readonly plugins: Readonly<Record<string, KillListEntry>>;
}

export interface KillListStore {
  /** The cached list, or the fetched one when nothing is cached yet. A host
   *  that has never reached the store kills nothing. */
  load(): Promise<KillList>;
  isKilled(pluginKey: string): Promise<boolean>;
  /** Fetches and caches the store's list. A failed fetch leaves the cached
   *  list in force; it never replaces one. */
  refresh(): Promise<void>;
}

const FILE = "kill-list.json";
const VERSION = 1;
const MAX_ADVISORY_LENGTH = 2048;

/**
 * The wire document, read into the shape the host trusts.
 *
 * A field this build does not know is ignored, so a newer list still revokes
 * the plugins both builds agree on. An entry with a malformed advisory link is
 * dropped whole: a link the browser cannot safely follow is not a fact worth
 * half-keeping.
 *
 * Throws for a document that is not a kill list at all, which is what lets the
 * store treat an unreadable download or cache as "no list here" rather than
 * as an empty one.
 */
export function readKillList(value: unknown): KillList {
  const record = asRecord(value);
  if (record === undefined || record["version"] !== VERSION) {
    throw new Error("A kill list needs version 1.");
  }
  const generatedAt = record["generatedAt"];
  if (typeof generatedAt !== "string" || generatedAt === "") {
    throw new Error("A kill list needs a generatedAt instant.");
  }

  const plugins: Record<string, KillListEntry> = {};
  const raw = asRecord(record["plugins"]);
  if (raw !== undefined) {
    for (const [key, value] of Object.entries(raw)) {
      if (publisherOf(key) === undefined) continue;
      const entry = asRecord(value);
      if (entry === undefined) continue;
      const advisory = entry["advisory"];
      if (advisory === undefined) {
        plugins[key] = {};
        continue;
      }
      if (!isAdvisoryUrl(advisory)) continue;
      plugins[key] = { advisory };
    }
  }

  return { version: VERSION, generatedAt, plugins };
}

/**
 * The host's copy of the revoke list: fetched from the store, cached beside
 * the plugins it kills, and read from the cache when the store cannot be
 * reached.
 */
export function createKillListStore(options: {
  readonly directory: string;
  readonly origin: string | undefined;
  readonly fetch: typeof fetch;
  readonly now: () => string;
}): KillListStore {
  const cacheFile = path.join(options.directory, FILE);

  async function readCache(): Promise<KillList | undefined> {
    try {
      return readKillList(JSON.parse(await readFile(cacheFile, "utf8")));
    } catch {
      return undefined;
    }
  }

  async function refresh(): Promise<void> {
    if (options.origin === undefined) return;
    try {
      const response = await options.fetch(
        new URL("/kill-list.json", options.origin),
      );
      if (!response.ok) return;
      const list = readKillList(await response.json());
      await mkdir(options.directory, { recursive: true });
      await writeFile(cacheFile, JSON.stringify(list), "utf8");
    } catch {
      // A store that could not answer keeps the cached list; a cache that
      // could not be written costs the next fetch, not this one.
    }
  }

  return {
    async load() {
      // Reading never fetches: the startup, install and update checks are the
      // moments the list is refreshed, so a load failure here costs nothing.
      return (
        (await readCache()) ?? {
          version: VERSION,
          generatedAt: options.now(),
          plugins: {},
        }
      );
    },

    async isKilled(pluginKey) {
      const list = await readCache();
      // An unreadable or missing cache is no list, so nothing is killed.
      return list !== undefined && Object.hasOwn(list.plugins, pluginKey);
    },

    refresh,
  };
}

function isAdvisoryUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_ADVISORY_LENGTH) {
    return false;
  }
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
