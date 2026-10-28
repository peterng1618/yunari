import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_DISPLAY } from "./displays.js";

/**
 * Which saved theme each display shows. Consumer state, like the device
 * assignments beside it: a consumer picks a theme once and the dashboard keeps
 * showing it, without a URL parameter to remember.
 *
 * One entry per display, so the screen across the room can hold a different
 * theme from this PC. The file is `{ "<display>": "<theme id>" }`, flat, with
 * `default` an ordinary key — that is what an unpaired client is served as.
 */

export interface ActiveThemeStore {
  /**
   * The display's chosen theme id, or undefined when none is set or the choice
   * is stale.
   */
  read(
    display: string,
    exists: (id: string) => Promise<boolean>,
  ): Promise<string | undefined>;
  /**
   * Every display's chosen theme, keyed by display, holding only the choices
   * that still name a theme the library has — the same rule `read` applies to
   * one display, because a list must not show a theme that is gone.
   *
   * One read of the file rather than one per display: this is the whole map, and
   * a caller drawing a list of every display is what asks for it.
   */
  readAll(
    exists: (id: string) => Promise<boolean>,
  ): Promise<Record<string, string>>;
  write(display: string, id: string): Promise<void>;
  /** Forgets one display's choice; every other display keeps its own. */
  clear(display: string): Promise<void>;
}

const FILE = "active-theme.json";
const THEME_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The theme a display shows: its own choice, else the default's.
 *
 * One function rather than a rule per caller, because the fallback is the whole
 * definition of "assigned" — the player, a panel's video lookup and the display
 * map must not disagree about which theme a display holds.
 */
export async function assignedThemeFor(
  store: ActiveThemeStore,
  display: string,
  exists: (id: string) => Promise<boolean>,
): Promise<string | undefined> {
  const own = await store.read(display, exists);

  return (
    own ??
    (display === DEFAULT_DISPLAY
      ? undefined
      : await store.read(DEFAULT_DISPLAY, exists))
  );
}

/**
 * The map a parsed file holds, or undefined when it holds something else.
 *
 * The single-theme file this replaced, `{ "id": "<theme>" }`, is read as the
 * default display's entry. That is one person's own choice rather than
 * compatibility glue for a superseded internal design: losing it would leave a
 * working dashboard blank. The next write persists the map, so `id` is not
 * written again.
 *
 * Only a file holding nothing else is that old shape. `id` is a legal display
 * id, so a file carrying it beside real entries is a map, and reading it as the
 * old shape would eat the displays it holds.
 */
function asMap(parsed: unknown): Record<string, unknown> | undefined {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }

  const map = parsed as Record<string, unknown>;

  return Object.keys(map).length === 1 && typeof map["id"] === "string"
    ? { [DEFAULT_DISPLAY]: map["id"] }
    : map;
}

/**
 * The stored map, or a refusal when the file is there and unusable.
 *
 * Reads fail closed to nothing chosen, but every mutator is read-modify-write
 * over the whole map, so writing back a file it could not read would persist
 * that failure as the loss of every other display's choice.
 */
type StoredMap =
  | { readonly map: Record<string, unknown> }
  | { readonly failure: string };

async function readMap(file: string): Promise<StoredMap> {
  let raw: string;

  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    // A missing file is a fresh install; anything else — a permission, a
    // directory, a bad sector — is a file we cannot account for.
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return { map: {} };
    }

    return { failure: error instanceof Error ? error.message : String(error) };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    // A present file that does not parse is not an empty one.
    return { failure: error instanceof Error ? error.message : String(error) };
  }

  const map = asMap(parsed);
  return map === undefined
    ? { failure: "the file does not hold an object" }
    : { map };
}

export function createActiveThemeStore(directory: string): ActiveThemeStore {
  const file = path.join(directory, FILE);

  const save = async (map: Record<string, unknown>): Promise<void> => {
    await mkdir(directory, { recursive: true });
    await writeFile(file, `${JSON.stringify(map, null, 2)}\n`, "utf8");
  };

  /** The map to edit, or a refusal: a mutator must not write over what it could not read. */
  const editable = async (): Promise<Record<string, unknown>> => {
    const stored = await readMap(file);

    if ("failure" in stored) {
      throw new Error(
        `${file} could not be read, so it was not written: ${stored.failure}`,
      );
    }

    return stored.map;
  };

  /**
   * One write at a time.
   *
   * Every mutator is read-modify-write over the whole map, so two overlapping
   * ones lose the earlier: the second reads a map the first has not saved yet
   * and writes it back without the first display's entry. A link that rejects
   * must not break the ones behind it.
   */
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
    async read(display, exists) {
      const stored = await readMap(file);
      if ("failure" in stored) return undefined;

      const id = stored.map[display];

      if (typeof id !== "string" || !THEME_ID.test(id)) {
        return undefined;
      }

      // A theme deleted since it was chosen must not keep winning; the caller
      // decides what to show instead.
      return (await exists(id)) ? id : undefined;
    },

    async readAll(exists) {
      const stored = await readMap(file);
      if ("failure" in stored) return {};

      const chosen: Record<string, string> = {};

      for (const [display, id] of Object.entries(stored.map)) {
        if (typeof id === "string" && THEME_ID.test(id) && (await exists(id))) {
          chosen[display] = id;
        }
      }

      return chosen;
    },

    async write(display, id) {
      if (!THEME_ID.test(id)) {
        throw new Error(`Invalid theme id "${id}".`);
      }

      // The map is read first: the other displays' choices are not this write's
      // to drop.
      await writeExclusively(async () => {
        const map = await editable();
        await save({ ...map, [display]: id });
      });
    },

    async clear(display) {
      await writeExclusively(async () => {
        const map = await editable();
        delete map[display];
        await save(map);
      });
    },
  };
}
