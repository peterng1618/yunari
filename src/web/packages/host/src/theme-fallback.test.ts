import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { themeForDisplay } from "../public/theme-fallback.js";
import { shownTheme } from "../public/theme-list.js";
import {
  type ActiveThemeStore,
  assignedThemeFor,
} from "./settings/active-theme.js";
import { DEFAULT_DISPLAY } from "./settings/displays.js";

/**
 * The host resolves "this display's theme, else the default's" in its route
 * code and its pages both. Both now call `public/theme-fallback.js`, and this
 * drives the two adapters over the same cases so a re-spelling of either is
 * caught by behaviour rather than by prose.
 */

const yes = async () => true;

function storeOf(map: Readonly<Record<string, string>>): ActiveThemeStore {
  return {
    read: async (display) => map[display],
    readAll: async () => ({ ...map }),
    write: async () => undefined,
    clear: async () => undefined,
  };
}

interface Case {
  readonly name: string;
  readonly display: string;
  readonly own: string | null;
  readonly defaultTheme: string | null;
  readonly expected: string | null;
}

const CASES: readonly Case[] = [
  {
    name: "the default display shows the default's theme",
    display: DEFAULT_DISPLAY,
    own: null,
    defaultTheme: "living-room",
    expected: "living-room",
  },
  {
    name: "a display's own choice beats the default",
    display: "this-pc",
    own: "attic-wall",
    defaultTheme: "living-room",
    expected: "attic-wall",
  },
  {
    name: "a display with no choice falls back to the default",
    display: "this-pc",
    own: null,
    defaultTheme: "living-room",
    expected: "living-room",
  },
  {
    name: "nothing chosen anywhere is no theme",
    display: "this-pc",
    own: null,
    defaultTheme: null,
    expected: null,
  },
];

function displaysFor(one: Case) {
  return one.display === DEFAULT_DISPLAY
    ? []
    : [{ id: one.display, theme: one.own }];
}

function storeFor(one: Case): ActiveThemeStore {
  const map: Record<string, string> = {};
  if (one.own !== null) map[one.display] = one.own;
  if (one.defaultTheme !== null) map[DEFAULT_DISPLAY] = one.defaultTheme;
  return storeOf(map);
}

describe("the per-display theme fallback", () => {
  for (const one of CASES) {
    it(one.name, async () => {
      const chosen = await assignedThemeFor(storeFor(one), one.display, yes);
      const shown = shownTheme(one.display, displaysFor(one), one.defaultTheme);
      const rule = themeForDisplay(one.own, one.defaultTheme);

      expect(chosen).toBe(one.expected ?? undefined);
      expect(shown).toBe(one.expected);
      expect(rule).toBe(one.expected ?? undefined);
      expect(chosen ?? null).toBe(shown);
    });
  }

  it("is imported by both the route code and the page module", () => {
    const root = join(import.meta.dirname, "..");

    // A copy would pass every case above; only the import proves one owner.
    expect(
      readFileSync(join(root, "src/settings/active-theme.ts"), "utf8"),
    ).toContain('from "../../public/theme-fallback.js"');
    expect(readFileSync(join(root, "public/theme-list.js"), "utf8")).toContain(
      'from "./theme-fallback.js"',
    );
  });
});
