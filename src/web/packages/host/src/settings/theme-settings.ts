import {
  ASSIGNABLE_GROUPS,
  type AssignableGroup,
  DEVICE_ID_PATTERN,
} from "./devices.js";
import { DEFAULT_DISPLAY } from "./displays.js";
import { createJsonFile } from "./json-file.js";

/**
 * The answers a particular theme needed, stored per display and per theme.
 *
 * "Which GPU does this dashboard show" is a fact about the theme on this
 * machine, not about the machine, so it lives here rather than beside the global
 * device settings. Only the answers where a theme *differs* from the global
 * choice are recorded, which is what lets a consumer answer a question once and
 * never see it again.
 *
 * The display is part of the key because a screen is not the machine: the
 * kitchen tablet may read a different GPU from this PC for the same theme. The
 * file is `{ "<display>": { "<theme id>": { "<group>": "<device>" } } }`.
 */

type ThemeAnswers = Readonly<Partial<Record<AssignableGroup, string>>>;

/** The file: one level per display, one per theme, then the answers. */
type Levels = Record<string, Record<string, ThemeAnswers>>;

export interface ThemeSettingsStore {
  read(display: string, themeId: string): Promise<ThemeAnswers>;
  write(
    display: string,
    themeId: string,
    answers: unknown,
  ): Promise<ThemeAnswers>;
  /** Every display's answers for a theme that has been deleted. */
  removeTheme(themeId: string): Promise<void>;
  /** One display's answers, across every theme, for a display that has gone. */
  removeDisplay(display: string): Promise<void>;
}

const FILE = "theme-answers.json";
const THEME_ID = /^[A-Za-z0-9_-]{1,64}$/;

function isGroup(value: string): value is AssignableGroup {
  return (ASSIGNABLE_GROUPS as readonly string[]).includes(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keeps only known groups with a usable device id. */
export function normalizeAnswers(input: unknown): ThemeAnswers {
  if (!isObject(input)) {
    return {};
  }

  const answers: Partial<Record<AssignableGroup, string>> = {};

  for (const [key, value] of Object.entries(input)) {
    if (
      isGroup(key) &&
      typeof value === "string" &&
      DEVICE_ID_PATTERN.test(value)
    ) {
      answers[key] = value;
    }
  }

  return answers;
}

/**
 * Whether a value is one display's level rather than one theme's answers.
 *
 * The file's shape before this task was `{ "<theme>": { "<group>": "<device>" } }`,
 * whose values are device ids — strings — so a level is a value holding at least
 * one theme's answers. `wall` is a legal theme id and a legal display id both,
 * which is why the depth tells the two shapes apart rather than the key names.
 *
 * *At least one*, not every: one unusable theme key in an otherwise good level
 * must not make the whole file read as the old shape, which would take every
 * display it holds with it.
 */
function isLevel(value: unknown): boolean {
  return (
    isObject(value) &&
    Object.entries(value).some(
      ([id, answers]) => THEME_ID.test(id) && isObject(answers),
    )
  );
}

/**
 * The file's contents in the shape this task writes.
 *
 * A display key is held to `DEVICE_ID_PATTERN` and a theme key to `THEME_ID`,
 * and a level that normalises to `{}` is dropped rather than written, so a
 * hand-edited file cannot introduce a display or a theme nothing else accepts
 * and no empty level reaches the disk.
 *
 * Both levels are built through `Object.fromEntries` rather than by assignment:
 * `__proto__` is a legal theme id, and `level[id] = answers` would reach the
 * prototype and lose the entry instead of storing it.
 */
function normalizeLevels(input: unknown): Levels {
  if (!isObject(input)) return {};

  const pairs: [string, Record<string, ThemeAnswers>][] = [];

  for (const [display, rawLevel] of Object.entries(input)) {
    if (!DEVICE_ID_PATTERN.test(display) || !isObject(rawLevel)) continue;

    const level: [string, ThemeAnswers][] = [];

    for (const [id, rawAnswers] of Object.entries(rawLevel)) {
      if (!THEME_ID.test(id)) continue;

      const answers = normalizeAnswers(rawAnswers);
      if (Object.keys(answers).length > 0) level.push([id, answers]);
    }

    if (level.length > 0) pairs.push([display, Object.fromEntries(level)]);
  }

  return Object.fromEntries(pairs);
}

/**
 * The parsed file as levels, with the shape it held before this task read as
 * the default display's.
 *
 * `{"wall": {"gpu": "gpu-0"}}` is not the answers it holds: read as levels it is
 * a display named after a theme, holding a theme named after a group. So a file
 * holding **no** level at all is the old one, and it is read as
 * `{ [DEFAULT_DISPLAY]: <old file> }` — the same reading `active-theme.json`
 * was given, because one answer set per theme is the answers of whoever asked,
 * and an unpaired client is served as the default display. The next write
 * persists the new shape.
 *
 * The trigger is deliberately narrow: a file that already holds a display named
 * after a theme id is left alone rather than rewritten, because reading it as
 * the old shape would eat the display it holds.
 */
function asLevels(parsed: unknown): unknown {
  if (!isObject(parsed)) return parsed;

  return Object.values(parsed).every((value) => !isLevel(value))
    ? { [DEFAULT_DISPLAY]: parsed }
    : parsed;
}

export function createThemeSettingsStore(
  directory: string,
): ThemeSettingsStore {
  const levels = createJsonFile<Levels>(directory, FILE, {
    normalize: (parsed) => normalizeLevels(asLevels(parsed)),
    empty: () => ({}),
  });

  return {
    async read(display, themeId) {
      if (!DEVICE_ID_PATTERN.test(display) || !THEME_ID.test(themeId)) {
        return {};
      }

      return (await levels.read())[display]?.[themeId] ?? {};
    },

    async write(display, themeId, answers) {
      if (!DEVICE_ID_PATTERN.test(display)) {
        throw new Error(`Invalid display id "${display}".`);
      }

      if (!THEME_ID.test(themeId)) {
        throw new Error(`Invalid theme id "${themeId}".`);
      }

      const normalized = normalizeAnswers(answers);

      return levels.mutate((all) => ({
        next: normalizeLevels({
          ...all,
          [display]: { ...all[display], [themeId]: normalized },
        }),
        // The whole map is normalized on the way out, so a theme that answered
        // nothing leaves no entry behind and the other displays keep theirs.
        result: normalized,
      }));
    },

    async removeTheme(themeId) {
      if (!THEME_ID.test(themeId)) return;

      // A file that cannot be read is nothing to remove, and must not be
      // replaced by the emptiness the read fell back to. `Object.hasOwn`, not
      // `in`: `constructor` is a legal theme id, and `in` walks the prototype
      // chain, so it would find an entry that is not there.
      const all = await levels.read();
      if (!Object.values(all).some((level) => Object.hasOwn(level, themeId))) {
        return;
      }

      await levels.mutate((current) => {
        for (const level of Object.values(current)) {
          if (Object.hasOwn(level, themeId)) delete level[themeId];
        }

        return { next: normalizeLevels(current), result: undefined };
      });
    },

    async removeDisplay(display) {
      if (!DEVICE_ID_PATTERN.test(display)) return;

      if (!Object.hasOwn(await levels.read(), display)) return;

      await levels.mutate((current) => {
        delete current[display];
        return { next: current, result: undefined };
      });
    },
  };
}
