import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type CatalogueOrigin,
  DASHBOARD_THEME_KIND,
  isStoreItemKind,
  type StoreItemKind,
} from "@yunari/renderer-core";

/**
 * Where each catalogue item installed on this machine came from, for every
 * kind the store carries.
 *
 * "Installed" is a fact about this machine's copy, not about the catalogue
 * item: the item is the same for everyone, while this record exists only where
 * someone installed it. So it is consumer state, like `active-theme.json` and
 * `theme-answers.json`, and it lives beside them in `catalogue-origins.json`
 * holding `{ "<kind>:<installedId>": { … } }`.
 *
 * One register rather than one file per kind: the Library's state filter and
 * its update check read one fact, and a kind is a field on the row rather than
 * a directory it has to know about.
 */

export interface CatalogueOriginsStore {
  /** Every entry, keyed by `<kind>:<installedId>`. */
  read(): Promise<Readonly<Record<string, CatalogueOrigin>>>;
  write(
    kind: StoreItemKind,
    installedId: string,
    origin: CatalogueOrigin,
  ): Promise<void>;
  /** One item's entry, for a copy that has been deleted. */
  remove(kind: StoreItemKind, installedId: string): Promise<void>;
}

const FILE = "catalogue-origins.json";
/** The register this file replaced. Read as dashboard-theme rows so an
 *  existing machine keeps its origins; never written and never deleted. */
const LEGACY_FILE = "theme-origins.json";

/**
 * One installed id: letters, digits, `-` and `_`, plus the single `/` a plugin
 * key carries between its publisher and its id. A path-preset pack id may be
 * longer than a library id, so the bound is the pack reader's 200.
 *
 * A `:` is not an installed id's to hold: the register's key puts one between
 * the kind and the id.
 */
const INSTALLED_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}(?:\/[A-Za-z0-9_-]{1,64})?$/;

/** The register's key. One owner, because a consumer that re-spells this would
 *  keep reading an empty row after the day the format moved. */
export function catalogueOriginKey(
  kind: StoreItemKind,
  installedId: string,
): string {
  return `${kind}:${installedId}`;
}

/** The origin a kind's installed copy holds, or nothing when it has none.
 *  `Object.hasOwn` keeps a key such as `__proto__` from answering the map's
 *  prototype instead of the entry. */
export function catalogueOriginOf(
  origins: Readonly<Record<string, CatalogueOrigin>>,
  kind: StoreItemKind,
  installedId: string,
): CatalogueOrigin | undefined {
  const key = catalogueOriginKey(kind, installedId);
  return Object.hasOwn(origins, key) ? origins[key] : undefined;
}

/** The installed ids of one kind whose rows name this catalogue item. Callers
 *  that need to find, forget or update a kind's copies should ask here rather
 *  than slice keys themselves: the key format stays this module's. */
export function catalogueInstalledIds(
  origins: Readonly<Record<string, CatalogueOrigin>>,
  kind: StoreItemKind,
  catalogueId: string,
): readonly string[] {
  const prefix = catalogueOriginKey(kind, "");
  return Object.entries(origins)
    .filter(
      ([key, origin]) =>
        key.startsWith(prefix) && origin.catalogueId === catalogueId,
    )
    .map(([key]) => key.slice(prefix.length));
}

/** One installed row of a catalogue item, with the installed id the key holds. */
export interface CatalogueOriginRow {
  readonly kind: StoreItemKind;
  readonly installedId: string;
  readonly origin: CatalogueOrigin;
}

/**
 * Every row naming this catalogue item, whatever its kind.
 *
 * A collection member is decided from the register alone before its listing is
 * fetched, and the collection request names no member kind, so the lookup
 * cannot start from one. Keeping the key slice here is what stops a caller
 * from re-spelling `<kind>:<installedId>` to answer the same question.
 */
export function catalogueOriginRows(
  origins: Readonly<Record<string, CatalogueOrigin>>,
  catalogueId: string,
): readonly CatalogueOriginRow[] {
  const rows: CatalogueOriginRow[] = [];
  for (const [key, origin] of Object.entries(origins)) {
    if (origin.catalogueId !== catalogueId) continue;
    const prefix = catalogueOriginKey(origin.kind, "");
    if (!key.startsWith(prefix)) continue;
    rows.push({
      kind: origin.kind,
      installedId: key.slice(prefix.length),
      origin,
    });
  }
  return rows;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInstalledId(value: string): boolean {
  return INSTALLED_ID_PATTERN.test(value);
}

function asStringArray(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

/**
 * One entry, or nothing when it is not the strings a row needs with the kind
 * its key names.
 *
 * A hand-edited file must not blank the whole map, so a bad row is dropped
 * rather than failing the read.
 */
function asOrigin(
  value: unknown,
  kind: StoreItemKind,
): CatalogueOrigin | undefined {
  if (!isObject(value)) return undefined;

  const {
    kind: rowKind,
    catalogueId,
    version,
    installedAt,
    collections,
  } = value;

  if (
    rowKind !== kind ||
    typeof catalogueId !== "string" ||
    typeof version !== "string" ||
    typeof installedAt !== "string"
  ) {
    return undefined;
  }

  if (collections === undefined) {
    return { kind, catalogueId, version, installedAt };
  }

  const named = asStringArray(collections);
  if (named === undefined) return undefined;

  return { kind, catalogueId, version, installedAt, collections: named };
}

/**
 * The file's contents, with every key held to `<kind>:<installedId>` and every
 * row validated.
 *
 * Built through `Object.fromEntries` rather than by assignment: `__proto__` is
 * a legal installed id, and `origins[key] = entry` would reach the map's
 * prototype and lose the entry instead of storing it.
 */
function normalizeOrigins(input: unknown): Record<string, CatalogueOrigin> {
  if (!isObject(input)) return {};

  const pairs: [string, CatalogueOrigin][] = [];

  for (const [key, raw] of Object.entries(input)) {
    const separator = key.indexOf(":");
    if (separator <= 0) continue;

    const kind = key.slice(0, separator);
    const installedId = key.slice(separator + 1);

    if (!isStoreItemKind(kind) || !isInstalledId(installedId)) continue;

    const entry = asOrigin(raw, kind);
    if (entry) pairs.push([key, entry]);
  }

  return Object.fromEntries(pairs);
}

/** The rows `theme-origins.json` holds, framed as the dashboard theme's. */
function normalizeLegacyOrigins(
  input: unknown,
): Record<string, CatalogueOrigin> {
  if (!isObject(input)) return {};

  const pairs: [string, CatalogueOrigin][] = [];

  for (const [installedId, raw] of Object.entries(input)) {
    if (!isInstalledId(installedId)) continue;
    if (!isObject(raw)) continue;

    const { catalogueId, version, installedAt } = raw;
    if (
      typeof catalogueId !== "string" ||
      typeof version !== "string" ||
      typeof installedAt !== "string"
    ) {
      continue;
    }

    pairs.push([
      catalogueOriginKey(DASHBOARD_THEME_KIND, installedId),
      {
        kind: DASHBOARD_THEME_KIND,
        catalogueId,
        version,
        installedAt,
      },
    ]);
  }

  return Object.fromEntries(pairs);
}

/** A file the caller may not read is this machine's fault and is thrown: an
 *  empty answer would read as "nothing installed". A missing file is the one
 *  absence that means exactly that. A file that is present but not JSON is
 *  dropped the same way a malformed row is. */
async function readJson(file: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function createCatalogueOriginsStore(
  directory: string,
): CatalogueOriginsStore {
  const file = path.join(directory, FILE);
  const legacy = path.join(directory, LEGACY_FILE);

  // Written beside the target and renamed over it, so a crash mid-write loses
  // the write rather than the whole map. Readers go through the queue below:
  // on Windows a rename over a file another handle holds open fails with
  // EPERM instead of waiting, so the two must never overlap.
  const temporary = `${file}.tmp`;

  const save = async (all: Record<string, CatalogueOrigin>): Promise<void> => {
    await mkdir(directory, { recursive: true });
    await writeFile(temporary, `${JSON.stringify(all, null, 2)}\n`, "utf8");
    await rename(temporary, file);
  };

  // Two mutators can overlap now — an install's write beside a delete's
  // removal — and both are read-modify-write over one file. Interleaved reads
  // lose an entry or resurrect a removed one, so mutations queue; a rejection
  // is swallowed for the queue's sake and still reaches its own caller.
  let writing: Promise<unknown> = Promise.resolve();
  const writeExclusively = <T>(work: () => Promise<T>): Promise<T> => {
    const next = writing.then(work, work);
    writing = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  /**
   * The whole register.
   *
   * The legacy file is read only while this one is absent: it is the register's
   * predecessor, and the first write snapshots every legacy row into this file.
   * Merging it into every read instead would resurrect a legacy row this
   * register has since removed, and the legacy file is never rewritten.
   */
  const readOrigins = async (): Promise<Record<string, CatalogueOrigin>> => {
    const current = await readJson(file);
    if (isObject(current)) return normalizeOrigins(current);
    return normalizeLegacyOrigins(await readJson(legacy));
  };

  return {
    async read() {
      // Behind the same queue as the mutators: a read landing inside a save
      // would otherwise read the file before the write it is racing lands, and
      // a listing would drop every origin for that answer.
      return writeExclusively(readOrigins);
    },

    async write(kind, installedId, origin) {
      await writeExclusively(async () => {
        if (!isStoreItemKind(kind) || !isInstalledId(installedId)) {
          throw new Error(`Invalid catalogue item id "${installedId}".`);
        }

        const all = await readOrigins();
        // Both halves of a write: a row the reader dropped does not survive
        // beside a good one, and a file the reader could not read at all is
        // replaced by this one entry rather than kept. The kind the caller
        // wrote the key by is the row's kind, so the two cannot disagree.
        await save(
          normalizeOrigins({
            ...all,
            [catalogueOriginKey(kind, installedId)]: { ...origin, kind },
          }),
        );
      });
    },

    async remove(kind, installedId) {
      await writeExclusively(async () => {
        if (!isStoreItemKind(kind) || !isInstalledId(installedId)) return;

        const all = await readOrigins();
        const key = catalogueOriginKey(kind, installedId);
        // Nothing to remove is no write: a file that could not be read reads as
        // `{}`, and saving that would replace the file that is actually there.
        if (!Object.hasOwn(all, key)) return;

        delete all[key];
        await save(all);
      });
    },
  };
}
