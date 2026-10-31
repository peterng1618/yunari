import { DEFAULT_DISPLAY } from "./displays.js";
import { createJsonFile } from "./json-file.js";

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
function normalizeMap(parsed: unknown): Record<string, unknown> {
  const map = asMap(parsed);

  if (map === undefined) {
    throw new Error("the file does not hold an object");
  }

  return map;
}

export function createActiveThemeStore(directory: string): ActiveThemeStore {
  const stored = createJsonFile<Record<string, unknown>>(directory, FILE, {
    normalize: normalizeMap,
    empty: () => ({}),
  });

  return {
    async read(display, exists) {
      const id = (await stored.read())[display];

      if (typeof id !== "string" || !THEME_ID.test(id)) {
        return undefined;
      }

      // A theme deleted since it was chosen must not keep winning; the caller
      // decides what to show instead.
      return (await exists(id)) ? id : undefined;
    },

    async readAll(exists) {
      const chosen: Record<string, string> = {};

      for (const [display, id] of Object.entries(await stored.read())) {
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
      await stored.mutate((map) => ({
        next: { ...map, [display]: id },
        result: undefined,
      }));
    },

    async clear(display) {
      await stored.mutate((map) => {
        delete map[display];
        return { next: map, result: undefined };
      });
    },
  };
}
