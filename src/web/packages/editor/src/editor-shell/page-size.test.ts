// @vitest-environment jsdom
/**
 * The page-size preference: what a viewer chose survives a reload, and nothing
 * else does.
 *
 * It is the second preference the shell stores, so it takes the three facts
 * `editor-shell/palette.ts` establishes — the namespaced key, the read that
 * answers the default rather than throwing, and the write that persists only the
 * size — and adds the one a page size has and a palette does not: a **default**
 * a viewer who has never chosen reads, including when the value in the way is
 * corrupt, absent or refused.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  createPageSizePreference,
  DEFAULT_PAGE_SIZE,
  type PageSize,
  pageSizes,
} from "./page-size.js";

/** The key the trio is namespaced by. Spelled here rather than read from the
 *  module, because a rename is a viewer's choice silently forgotten and the
 *  assertion that would catch it is this literal. */
const KEY = "yunari.editor.store-page-size";

/** A `Storage` that refuses every call, which is what a browser in a blocked
 *  third-party context hands back — an access that throws rather than one that
 *  answers `null`. */
function blocked(): Storage {
  const refuse = (): never => {
    throw new Error("storage is blocked");
  };
  return {
    getItem: refuse,
    setItem: refuse,
    removeItem: refuse,
  } as unknown as Storage;
}

/** A preference over a storage of one's own, so a case can prove what a *new*
 *  preference reads rather than what one object remembers. */
function preferenceOver(
  storage: Storage,
): ReturnType<typeof createPageSizePreference> {
  return createPageSizePreference(storage);
}

describe("page size preference", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  /** The plan's own case: a size written by one preference is read by the next
   *  one over the same storage, and nothing else is written. */
  it("remembers the size and forgets nothing else", () => {
    preferenceOver(localStorage).write(24);

    expect(preferenceOver(localStorage).read()).toBe(24);
    expect(localStorage.getItem(KEY)).toBe("24");
    // One key, one value: a preference that also stored a page number, a filter
    // or a timestamp would be storing a query the surface keeps in memory.
    expect(localStorage.length).toBe(1);
  });

  /** `all` is a size like any other, so it round-trips as one — a reader that
   *  only understood numbers would answer the default for the whole library. */
  it("round-trips every size it offers", () => {
    for (const size of pageSizes) {
      preferenceOver(localStorage).write(size);
      expect(preferenceOver(localStorage).read(), String(size)).toBe(size);
    }
  });

  it("answers the default when nothing has been chosen", () => {
    expect(preferenceOver(localStorage).read()).toBe(DEFAULT_PAGE_SIZE);
    // The default is the drawing's own size, and a separate fact from the
    // reader's answer above.
    expect(DEFAULT_PAGE_SIZE).toBe(12);
  });

  /** An unreadable value is the default rather than a throw: the key is one a
   *  viewer's own browser wrote, so a value this build cannot use is a value
   *  this build replaces, not an error the surface has to render. */
  it("answers the default for a value it cannot read", () => {
    const unreadable: readonly string[] = [
      "",
      "abc",
      "0",
      "13",
      "12.5",
      "ALL",
      "all ",
      "null",
    ];
    for (const stored of unreadable) {
      localStorage.setItem(KEY, stored);
      expect(preferenceOver(localStorage).read(), stored).toBe(
        DEFAULT_PAGE_SIZE,
      );
    }
  });

  it("clears back to the default", () => {
    const preference = preferenceOver(localStorage);
    preference.write(48);

    preference.clear();

    expect(preference.read()).toBe(DEFAULT_PAGE_SIZE);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  /** No storage at all is not a failure: a viewer with one reads the default,
   *  and a write is dropped rather than raised into the render that made it. */
  it("reads the default and drops the write with no storage", () => {
    const preference = createPageSizePreference();

    expect(preference.read()).toBe(DEFAULT_PAGE_SIZE);
    expect(() => {
      preference.write(24);
      preference.clear();
    }).not.toThrow();
  });

  it("reads the default and drops the write when storage refuses", () => {
    const preference = preferenceOver(blocked());

    expect(preference.read()).toBe(DEFAULT_PAGE_SIZE);
    expect(() => {
      preference.write(24);
      preference.clear();
    }).not.toThrow();
  });

  /** The four sizes, in the order the well lists them, and the
   *  union is what the well, the reader and the pager all agree by. */
  it("offers the four sizes in the drawing's order", () => {
    const offered: readonly PageSize[] = pageSizes;
    expect(offered).toEqual([12, 24, 48, "all"]);
  });
});
