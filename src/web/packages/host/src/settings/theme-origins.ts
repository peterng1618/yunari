import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ThemeOrigin } from "@yunari/theme-package";

/**
 * Where each library theme came from, kept in the host's settings directory.
 *
 * "Installed" is a fact about this machine's copy, not about the catalogue item:
 * the item is the same for everyone, while this record exists only where someone
 * installed it. So it is consumer state, like `active-theme.json` and
 * `theme-answers.json`, and it lives beside them rather than beside the themes,
 * as `theme-origins.json` holding
 * `{ "<theme id>": { "catalogueId": …, "version": …, "installedAt": … } }`.
 *
 * The shape itself is `@yunari/theme-package`'s, because the editor reads the
 * same record over `/api/themes` and cannot import this package.
 */

export type { ThemeOrigin };

export interface ThemeOriginsStore {
  /** Every entry, keyed by library theme id. */
  read(): Promise<Readonly<Record<string, ThemeOrigin>>>;
  write(themeId: string, origin: ThemeOrigin): Promise<void>;
  /** One theme's entry, for a theme that has been deleted. */
  removeTheme(themeId: string): Promise<void>;
}

const FILE = "theme-origins.json";
const THEME_ID = /^[A-Za-z0-9_-]{1,64}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One entry, or nothing when it is not three usable strings.
 *
 * A hand-edited file must not blank the whole map, so a bad entry is dropped
 * rather than failing the read.
 */
function asOrigin(value: unknown): ThemeOrigin | undefined {
  if (!isObject(value)) return undefined;

  const { catalogueId, version, installedAt } = value;

  if (
    typeof catalogueId !== "string" ||
    typeof version !== "string" ||
    typeof installedAt !== "string"
  ) {
    return undefined;
  }

  return { catalogueId, version, installedAt };
}

/**
 * The file's contents, with every key held to `THEME_ID` and every entry validated.
 *
 * Built through `Object.fromEntries` rather than by assignment: `__proto__` is a
 * legal theme id, and `origins[id] = entry` would reach the map's prototype and
 * lose the entry instead of storing it.
 */
function normalizeOrigins(input: unknown): Record<string, ThemeOrigin> {
  if (!isObject(input)) return {};

  const pairs: [string, ThemeOrigin][] = [];

  for (const [id, raw] of Object.entries(input)) {
    if (!THEME_ID.test(id)) continue;

    const entry = asOrigin(raw);
    if (entry) pairs.push([id, entry]);
  }

  return Object.fromEntries(pairs);
}

async function readOrigins(file: string): Promise<Record<string, ThemeOrigin>> {
  try {
    return normalizeOrigins(JSON.parse(await readFile(file, "utf8")));
  } catch {
    // No file, or an unreadable one: nothing was installed from the catalogue.
    return {};
  }
}

export function createThemeOriginsStore(directory: string): ThemeOriginsStore {
  const file = path.join(directory, FILE);

  // Written beside the target and renamed over it, so a crash mid-write loses
  // the write rather than the whole map. Readers go through the queue below:
  // on Windows a rename over a file another handle holds open fails with
  // EPERM instead of waiting, so the two must never overlap.
  const temporary = `${file}.tmp`;

  const save = async (all: Record<string, ThemeOrigin>): Promise<void> => {
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

  return {
    async read() {
      // Behind the same queue as the mutators: a read landing inside a save
      // would otherwise read the file before the write it is racing lands, and
      // `/api/themes` would drop every origin for that answer.
      return writeExclusively(() => readOrigins(file));
    },

    async write(themeId, origin) {
      await writeExclusively(async () => {
        if (!THEME_ID.test(themeId)) {
          throw new Error(`Invalid theme id "${themeId}".`);
        }

        const all = await readOrigins(file);
        // Both halves of a write: a key or an entry the reader dropped does not
        // survive beside a good one, and a file the reader could not read at all
        // is replaced by this one entry rather than kept.
        await save(normalizeOrigins({ ...all, [themeId]: origin }));
      });
    },

    async removeTheme(themeId) {
      await writeExclusively(async () => {
        if (!THEME_ID.test(themeId)) return;

        const all = await readOrigins(file);
        // Nothing to remove is no write: a file that could not be read reads as
        // `{}`, and saving that would replace the file that is actually there.
        // `Object.hasOwn`, not `in`: `constructor` is a legal theme id, and `in`
        // walks the prototype chain, so `removeTheme("constructor")` would find an
        // entry that is not there and rewrite a file it should have left alone.
        if (!Object.hasOwn(all, themeId)) return;

        delete all[themeId];
        await save(all);
      });
    },
  };
}
