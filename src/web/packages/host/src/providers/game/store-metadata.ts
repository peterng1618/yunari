import fs from "node:fs/promises";
import path from "node:path";
import { MAX_BOX_ART_BYTES } from "./box-art.js";
import { matchStoreGame, normalizeGameName } from "./name-match.js";

/**
 * Steam store metadata for a game with no local manifest (decision 0109).
 *
 * Two keyless requests resolve a name to an app id, and the answer — including
 * "no match" and a 10-minute backoff after a failure — is cached under the
 * caller's own directory. Cover bytes are cached only when their magic number
 * says JPEG or PNG; the route that serves them is host-relative, so no display
 * ever talks to Valve's CDN itself.
 */

const STORE_ORIGIN = "https://store.steampowered.com";
const PORTRAIT_ORIGIN = "https://cdn.akamai.steamstatic.com";
const ARTWORK_ROUTE = "/api/game/artwork/";
const CACHE_FILE = "game-metadata.json";
const BACKOFF_MS = 10 * 60_000;
const MAX_CACHE_ENTRIES = 500;
const COVER_EXTENSIONS = ["jpg", "png"] as const;

type ImageExtension = (typeof COVER_EXTENSIONS)[number];

interface MatchEntry {
  readonly id: number;
  readonly name: string;
  /** The spelling actually searched; another spelling may match anew. */
  readonly term: string;
  readonly at: number;
}

interface NoneEntry {
  readonly none: true;
  readonly term: string;
  readonly at: number;
}

type CacheEntry = MatchEntry | NoneEntry;
type StoreCache = Record<string, CacheEntry>;

/**
 * `none` is the store's answer: it replied and no candidate survived the
 * matcher. `unavailable` is no answer — a failed or timed-out request, or a
 * suppression window — and must not be reported as "no such game".
 */
export type StoreLookupResult =
  | { readonly kind: "match"; readonly id: number; readonly name: string }
  | { readonly kind: "none" }
  | { readonly kind: "unavailable" };

interface AppDetails {
  readonly name: string | undefined;
  readonly headerImage: string | undefined;
}

export interface SteamStoreOptions {
  /** Injected so no test performs a real request. */
  readonly fetchImpl: typeof fetch;
  readonly cacheDir: string;
  readonly nowMs?: () => number;
  /**
   * One origin for the search, details and portrait requests; absent is Valve's
   * store and CDN. A browser proof points it at a fixture that plays all three.
   */
  readonly baseUrl?: string;
}

export interface SteamStore {
  lookup(name: string, signal?: AbortSignal): Promise<StoreLookupResult>;
  /** The host-relative route that serves this app's cached cover. */
  cover(appId: number, signal?: AbortSignal): Promise<string | undefined>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requestInit(signal: AbortSignal | undefined): RequestInit {
  return signal === undefined ? {} : { signal };
}

function searchUrl(base: string | undefined, name: string): string {
  return `${base ?? STORE_ORIGIN}/api/storesearch/?term=${encodeURIComponent(name)}&cc=us&l=en`;
}

function detailsUrl(base: string | undefined, appId: number): string {
  return `${base ?? STORE_ORIGIN}/api/appdetails?appids=${appId}&filters=basic`;
}

function portraitUrl(base: string | undefined, appId: number): string {
  return `${base ?? PORTRAIT_ORIGIN}/steam/apps/${appId}/library_600x900.jpg`;
}

/** The `items` of a storesearch answer, ignoring anything not shaped like one. */
function candidatesOf(body: unknown): readonly { id: number; name: string }[] {
  if (!isRecord(body)) return [];
  const items = body["items"];
  if (!Array.isArray(items)) return [];

  const candidates: { id: number; name: string }[] = [];

  for (const item of items) {
    if (!isRecord(item)) continue;
    // Only an app carries the id this cache stores; a bundle or sub result
    // would become a game's appid and route a wrong cover.
    if (item["type"] !== "app") continue;
    const id = item["id"];
    const name = item["name"];

    if (
      typeof id === "number" &&
      Number.isInteger(id) &&
      typeof name === "string" &&
      name.trim() !== ""
    ) {
      candidates.push({ id, name });
    }
  }

  return candidates;
}

function detailsOf(body: unknown, appId: number): AppDetails | undefined {
  if (!isRecord(body)) return undefined;

  const record = body[String(appId)];
  if (!isRecord(record) || record["success"] !== true) return undefined;

  const data = record["data"];
  if (!isRecord(data)) return undefined;

  const name = data["name"];
  const headerImage = data["header_image"];

  return {
    name: typeof name === "string" && name.trim() !== "" ? name : undefined,
    headerImage: typeof headerImage === "string" ? headerImage : undefined,
  };
}

function sniffImage(bytes: Uint8Array): ImageExtension | undefined {
  const at = (index: number): number => bytes[index] ?? -1;

  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpg";
  if (
    at(0) === 0x89 &&
    at(1) === 0x50 &&
    at(2) === 0x4e &&
    at(3) === 0x47 &&
    at(4) === 0x0d &&
    at(5) === 0x0a &&
    at(6) === 0x1a &&
    at(7) === 0x0a
  ) {
    return "png";
  }

  return undefined;
}

/**
 * A null-prototype map: a normalised name such as `constructor` must read as
 * absent, not as something inherited from `Object.prototype`.
 */
function emptyCache(): StoreCache {
  return Object.create(null) as StoreCache;
}

/** Keep the newest entries; `at` is the only age the cache records. */
function pruneCache(cache: StoreCache): void {
  const entries = Object.entries(cache);
  if (entries.length <= MAX_CACHE_ENTRIES) return;

  entries.sort((left, right) => left[1].at - right[1].at);

  for (const [key] of entries.slice(0, entries.length - MAX_CACHE_ENTRIES)) {
    delete cache[key];
  }
}

function parseCache(text: string): StoreCache {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return emptyCache();
  }

  if (!isRecord(parsed)) return emptyCache();

  const cache = emptyCache();

  for (const [key, value] of Object.entries(parsed)) {
    if (key === "" || !isRecord(value)) continue;

    const at = value["at"];
    if (typeof at !== "number" || !Number.isFinite(at)) continue;

    const term = value["term"];
    if (typeof term !== "string" || term.trim() === "") continue;

    if (value["none"] === true) {
      cache[key] = { none: true, term, at };
      continue;
    }

    const id = value["id"];
    const name = value["name"];

    if (
      typeof id === "number" &&
      Number.isInteger(id) &&
      typeof name === "string" &&
      name !== ""
    ) {
      cache[key] = { id, name, term, at };
    }
  }

  pruneCache(cache);
  return cache;
}

/** Write beside the target and rename, so a reader never sees half the file. */
async function writeAtomic(
  directory: string,
  file: string,
  data: string | Uint8Array,
  scratch: string,
): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(scratch, data);
  await fs.rename(scratch, file);
}

/** Enough bytes for either magic number. */
const MAGIC_BYTES = 8;

/** The same size and magic rules the artwork route applies before serving. */
async function matchesExtension(
  file: string,
  extension: ImageExtension,
): Promise<boolean> {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > MAX_BOX_ART_BYTES) return false;

    const handle = await fs.open(file, "r");

    try {
      const head = new Uint8Array(MAGIC_BYTES);
      const { bytesRead } = await handle.read(head, 0, MAGIC_BYTES, 0);
      return sniffImage(head.subarray(0, bytesRead)) === extension;
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

/**
 * A cached cover is advertised only if the route can serve it: within the size
 * cap and with bytes matching the extension in its URL. Advertising a file the
 * route refuses would be a permanent broken image.
 */
async function cachedCover(
  directory: string,
  appId: number,
): Promise<string | undefined> {
  for (const extension of COVER_EXTENSIONS) {
    const file = path.join(directory, `${appId}.${extension}`);

    if (await matchesExtension(file, extension)) {
      return `${ARTWORK_ROUTE}${appId}.${extension}`;
    }
  }

  return undefined;
}

/** Whether a cached miss answered this exact spelling. */
function sameTerm(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export function createSteamStore(options: SteamStoreOptions): SteamStore {
  const { fetchImpl, cacheDir } = options;
  const nowMs = options.nowMs ?? Date.now;
  // A trailing slash would double the one the paths below carry.
  const base = options.baseUrl?.replace(/\/+$/, "");
  const cacheFile = path.join(cacheDir, CACHE_FILE);

  let cache: StoreCache = emptyCache();
  let loading: Promise<void> | undefined;
  let writing: Promise<void> = Promise.resolve();
  let scratchCount = 0;

  // A name whose request failed is not retried for ten minutes. Kept in
  // memory: a failure is this process's problem, not a durable fact.
  const backoffUntil = new Map<string, number>();
  // A cover that failed is the same: the route asks once a second per display,
  // so a permanent miss or an outage would otherwise re-download every sample.
  const coverBackoffUntil = new Map<number, number>();
  const pending = new Map<string, Promise<StoreLookupResult>>();
  // A cover is downloaded once per appid, even when two samples demand it
  // before the first write lands.
  const coverPending = new Map<number, Promise<string | undefined>>();

  function load(): Promise<void> {
    loading ??= (async () => {
      try {
        cache = parseCache(await fs.readFile(cacheFile, "utf8"));
      } catch {
        cache = emptyCache();
      }
    })();

    return loading;
  }

  /** Serialised so two answers cannot interleave their temp files. */
  function persist(): Promise<void> {
    const snapshot = JSON.stringify(cache);

    writing = writing
      .then(() => {
        scratchCount += 1;
        const scratch = path.join(
          cacheDir,
          `.${CACHE_FILE}.${process.pid}.${scratchCount}.tmp`,
        );
        return writeAtomic(cacheDir, cacheFile, snapshot, scratch);
      })
      .catch(() => {
        // A failed cache write leaves the in-memory answer intact; the next
        // successful lookup persists the whole map instead.
      });

    return writing;
  }

  async function store(key: string, entry: CacheEntry): Promise<void> {
    cache[key] = entry;
    pruneCache(cache);
    await persist();
  }

  async function fetchDetails(
    appId: number,
    signal: AbortSignal | undefined,
  ): Promise<AppDetails | undefined> {
    const response = await fetchImpl(
      detailsUrl(base, appId),
      requestInit(signal),
    );
    if (!response.ok) return undefined;

    return detailsOf(await response.json(), appId);
  }

  async function resolveName(
    name: string,
    key: string,
    signal: AbortSignal | undefined,
  ): Promise<StoreLookupResult> {
    try {
      const response = await fetchImpl(
        searchUrl(base, name),
        requestInit(signal),
      );
      if (!response.ok) {
        backoffUntil.set(key, nowMs() + BACKOFF_MS);
        return { kind: "unavailable" };
      }

      const winner = matchStoreGame(name, candidatesOf(await response.json()));

      if (winner === undefined) {
        await store(key, { none: true, term: name, at: nowMs() });
        return { kind: "none" };
      }

      const details = await fetchDetails(winner.id, signal);
      if (details === undefined) {
        backoffUntil.set(key, nowMs() + BACKOFF_MS);
        return { kind: "unavailable" };
      }

      const entry: MatchEntry = {
        id: winner.id,
        name: details.name ?? winner.name,
        term: name,
        at: nowMs(),
      };
      await store(key, entry);

      return { kind: "match", id: entry.id, name: entry.name };
    } catch {
      backoffUntil.set(key, nowMs() + BACKOFF_MS);
      return { kind: "unavailable" };
    }
  }

  async function fetchBytes(
    url: string,
    signal: AbortSignal | undefined,
  ): Promise<Uint8Array | undefined> {
    const response = await fetchImpl(url, requestInit(signal));
    if (!response.ok) return undefined;

    // The route refuses to serve a larger body, so buffering one would cache a
    // cover no display can ever receive.
    const declared = response.headers.get("content-length");
    if (declared !== null && Number(declared) > MAX_BOX_ART_BYTES) {
      return undefined;
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.byteLength > MAX_BOX_ART_BYTES ? undefined : bytes;
  }

  async function fetchCover(
    appId: number,
    signal: AbortSignal | undefined,
  ): Promise<Uint8Array | undefined> {
    const portrait = await fetchBytes(portraitUrl(base, appId), signal).catch(
      () => undefined,
    );
    if (portrait !== undefined) return portrait;

    const details = await fetchDetails(appId, signal).catch(() => undefined);
    const headerImage = details?.headerImage;
    if (headerImage === undefined) return undefined;

    return fetchBytes(headerImage, signal).catch(() => undefined);
  }

  async function downloadCover(
    appId: number,
    signal: AbortSignal | undefined,
  ): Promise<string | undefined> {
    // Every failure below — no bytes, unrecognised bytes, an unwritable file,
    // an aborted request — is suppressed until the window ends.
    const failed = (): undefined => {
      coverBackoffUntil.set(appId, nowMs() + BACKOFF_MS);
      return undefined;
    };

    const bytes = await fetchCover(appId, signal);
    if (bytes === undefined) return failed();

    // The URL extension is not trusted; the bytes decide what this is and
    // anything that is not an image writes nothing.
    const extension = sniffImage(bytes);
    if (extension === undefined) return failed();

    const file = path.join(cacheDir, `${appId}.${extension}`);
    scratchCount += 1;
    const scratch = path.join(
      cacheDir,
      `.${appId}.${extension}.${process.pid}.${scratchCount}.tmp`,
    );

    try {
      await writeAtomic(cacheDir, file, bytes, scratch);
    } catch {
      return failed();
    }

    coverBackoffUntil.delete(appId);
    return `${ARTWORK_ROUTE}${appId}.${extension}`;
  }

  return {
    async lookup(name, signal) {
      const key = normalizeGameName(name);
      // Nothing to search, so nothing can match; the store is not at fault.
      if (key === "") return { kind: "none" };

      await load();

      // `Object.hasOwn`, not a plain read: the map is the only owner of these
      // keys, and an inherited property is not a cached answer.
      const cached = Object.hasOwn(cache, key) ? cache[key] : undefined;
      if (cached !== undefined) {
        if (!("none" in cached)) {
          return { kind: "match", id: cached.id, name: cached.name };
        }

        // A miss for "BioShock Ultimate" must not keep "BioShock" unnamed:
        // only the spelling the store actually answered may stay cached.
        if (sameTerm(cached.term, name)) return { kind: "none" };
      }

      const until = backoffUntil.get(key);
      if (until !== undefined && nowMs() < until) {
        return { kind: "unavailable" };
      }

      let request = pending.get(key);

      if (request === undefined) {
        request = resolveName(name, key, signal).finally(() => {
          pending.delete(key);
        });
        pending.set(key, request);
      }

      return request;
    },

    async cover(appId, signal) {
      if (!Number.isInteger(appId) || appId <= 0) return undefined;

      const cached = await cachedCover(cacheDir, appId);
      if (cached !== undefined) {
        coverBackoffUntil.delete(appId);
        return cached;
      }

      const until = coverBackoffUntil.get(appId);
      if (until !== undefined && nowMs() < until) return undefined;

      const inFlight = coverPending.get(appId);
      if (inFlight !== undefined) return inFlight;

      const request = downloadCover(appId, signal).finally(() => {
        coverPending.delete(appId);
      });
      coverPending.set(appId, request);

      return request;
    },
  };
}
