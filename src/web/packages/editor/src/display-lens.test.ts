import { afterEach, describe, expect, it } from "vitest";
import {
  activePreviewLenses,
  activePreviewRatioTokens,
  addPreviewRatioToken,
  DEFAULT_PREVIEW_RATIO_TOKENS,
  displayLensGroups,
  lensBox,
  matchingPreviewLens,
  nearestPreviewLens,
  normalisePreviewRatioTokens,
  parsePreviewRatio,
  previewCatalogueKey,
  previewLenses,
  previewRatioKey,
  previewRatioTokenFor,
  readPreviewRatioTokens,
  resolveLens,
  screenRect,
  setActivePreviewRatios,
  sortPreviewTokens,
  subscribeLenses,
} from "./display-lens.js";

const storageReturning = (value: string): Storage =>
  ({ getItem: () => value }) as unknown as Storage;

/** The live list is module state, so a test that changes it puts the defaults
 *  back rather than leaving a later test reading a catalogue it did not set. */
afterEach(() => setActivePreviewRatios(DEFAULT_PREVIEW_RATIO_TOKENS));

describe("a preview ratio is a token in a closed vocabulary", () => {
  it("keeps the spelling the author entered", () => {
    // `21:9` is the name people recognise; reducing it to `7:3` would be a
    // rename nobody asked for.
    expect(parsePreviewRatio("21:9")).toMatchObject({
      id: "21:9",
      width: 21,
      height: 9,
    });
    expect(parsePreviewRatio("7:3")).toMatchObject({
      id: "7:3",
      width: 7,
      height: 3,
    });
    expect(parsePreviewRatio("32:18")).toMatchObject({
      id: "32:18",
      width: 32,
      height: 18,
    });
  });

  it("keeps a decimal edge as typed", () => {
    expect(parsePreviewRatio(" 19.5:9 ")).toMatchObject({
      id: "19.5:9",
      width: 19.5,
      height: 9,
    });
  });

  it("parses Circle as a 1:1 disc", () => {
    expect(parsePreviewRatio("circle")).toEqual({
      id: "Circle",
      width: 1,
      height: 1,
      shape: "circle",
    });
  });

  it("keys a rect by its long-over-short aspect, whichever the orientation", () => {
    expect(previewRatioKey(parsePreviewRatio("21:9"))).toBe(
      previewRatioKey(parsePreviewRatio("7:3")),
    );
    expect(previewRatioKey(parsePreviewRatio("16:9"))).toBe(
      previewRatioKey(parsePreviewRatio("9:16")),
    );
  });

  it("keeps Circle and 1:1 apart", () => {
    // A disc crops the corners; a 1:1 rect lens shows them, so the two are
    // different pictures and neither refuses the other.
    expect(normalisePreviewRatioTokens(["1:1", "Circle"])).toEqual([
      "1:1",
      "Circle",
    ]);
    expect(normalisePreviewRatioTokens(["Circle", "1:1"])).toEqual([
      "Circle",
      "1:1",
    ]);
  });

  it("drops invalid entries and keeps the first equivalent token", () => {
    expect(
      normalisePreviewRatioTokens(["16:9", "nope", "16:9", "Circle", 7]),
    ).toEqual(["16:9", "Circle"]);
    expect(normalisePreviewRatioTokens(["21:9", "7:3"])).toEqual(["21:9"]);
  });

  it("writes one token when an equivalent shape is added", () => {
    setActivePreviewRatios(["16:9", "32:18"]);
    expect(activePreviewRatioTokens()).toEqual(["16:9"]);
  });

  it("sorts landscape widest first, then 1:1 and Circle, then portrait near square first", () => {
    expect(
      sortPreviewTokens(["Circle", "4:3", "16:9", "1:1", "9:16", "21:9"]),
    ).toEqual(["21:9", "16:9", "4:3", "1:1", "Circle", "9:16"]);
    expect(sortPreviewTokens(["9:19.5", "3:4", "19.5:9"])).toEqual([
      "19.5:9",
      "3:4",
      "9:19.5",
    ]);
  });

  it.each([
    "",
    "16",
    "16:0",
    "-1:9",
    "a:b",
    "1:2:3",
    "NaN:9",
    "16:9:extra",
    "0x10:9",
    "1e2:9",
    "+16:9",
    "1".repeat(400) + ":9",
  ])("refuses %s", (input) =>
    expect(() => parsePreviewRatio(input)).toThrow(RangeError),
  );

  it("drops invalid entries and keeps the first duplicate", () => {
    expect(
      normalisePreviewRatioTokens(["16:9", "nope", "16:9", "Circle", 7]),
    ).toEqual(["16:9", "Circle"]);
  });

  it("reads defaults when the key is absent or unreadable", () => {
    expect(readPreviewRatioTokens(undefined)).toEqual(
      DEFAULT_PREVIEW_RATIO_TOKENS,
    );
    expect(readPreviewRatioTokens(storageReturning("not json"))).toEqual(
      DEFAULT_PREVIEW_RATIO_TOKENS,
    );
  });

  it("keeps an authored empty list as empty", () => {
    expect(readPreviewRatioTokens(storageReturning("[]"))).toEqual([]);
  });
});

describe("a ratio derives its lenses", () => {
  it("derives one landscape lens and a portrait twin only for a wide ratio", () => {
    const lenses = previewLenses(["16:9", "1:1", "Circle"]);
    expect(lenses.map((lens) => lens.id)).toEqual([
      "16:9",
      "9:16",
      "1:1",
      "Circle",
    ]);
  });

  it("marks only Circle as a disc", () => {
    expect(previewLenses(["1:1", "Circle"]).map((lens) => lens.shape)).toEqual([
      "rect",
      "circle",
    ]);
  });

  it("derives a portrait-only lens for a tall token", () => {
    expect(previewLenses(["9:16"])).toEqual([
      { id: "9:16", aspect: 9 / 16, orientation: "portrait", shape: "rect" },
    ]);
  });

  it("emits a derived lens id once", () => {
    expect(previewLenses(["16:9", "9:16"]).map((lens) => lens.id)).toEqual([
      "16:9",
      "9:16",
    ]);
  });
});

describe("the live catalogue is module state with a revision", () => {
  it("notifies once per real change and not for a repeated list", () => {
    let calls = 0;
    const unsubscribe = subscribeLenses(() => {
      calls += 1;
    });

    setActivePreviewRatios(["16:9"]);
    const changed = previewCatalogueKey();
    setActivePreviewRatios(["16:9"]);
    expect(calls).toBe(1);
    expect(previewCatalogueKey()).toBe(changed);

    setActivePreviewRatios(["Circle"]);
    expect(calls).toBe(2);
    expect(previewCatalogueKey()).not.toBe(changed);

    unsubscribe();
    setActivePreviewRatios([]);
    expect(calls).toBe(2);
  });

  it("finds a lens by id", () => {
    setActivePreviewRatios(["1:1", "19.5:9"]);
    expect(resolveLens("9:19.5")?.aspect).toBeCloseTo(9 / 19.5, 12);
    expect(resolveLens("nope")).toBeUndefined();
    expect(activePreviewRatioTokens()).toEqual(["1:1", "19.5:9"]);
    expect(activePreviewLenses().length).toBe(3);
  });

  it("opens on the catalogue lens nearest the artboard's aspect", () => {
    setActivePreviewRatios(["16:9", "19.5:9", "4:3", "1:1", "Circle"]);
    expect(nearestPreviewLens({ width: 1920, height: 1080 })?.id).toBe("16:9");
    expect(nearestPreviewLens({ width: 1280, height: 960 })?.id).toBe("4:3");
    // A portrait artboard takes the portrait twin the catalogue derives.
    expect(nearestPreviewLens({ width: 1080, height: 2340 })?.id).toBe(
      "9:19.5",
    );
    // Closest, not exact: a shape no token names takes the near one.
    expect(nearestPreviewLens({ width: 1000, height: 1000 })?.id).toBe("1:1");
    expect(nearestPreviewLens({ width: 2000, height: 1000 })?.id).toBe(
      "19.5:9",
    );
  });

  it("keeps a disc and a rect apart, and answers Fit when none fits", () => {
    setActivePreviewRatios(["16:9", "Circle"]);
    expect(
      nearestPreviewLens({ width: 1080, height: 1080, shape: "circle" })?.id,
    ).toBe("Circle");
    setActivePreviewRatios(["Circle"]);
    expect(nearestPreviewLens({ width: 1920, height: 1080 })).toBeUndefined();
    expect(nearestPreviewLens({ width: 0, height: 0 })).toBeUndefined();
  });

  it("groups the lenses in the fixed order, each group widest first", () => {
    setActivePreviewRatios(["16:9", "4:3", "Circle", "1:1"]);
    expect(displayLensGroups()).toEqual([
      {
        kind: "landscape",
        lenses: [
          expect.objectContaining({ id: "16:9" }),
          expect.objectContaining({ id: "4:3" }),
        ],
      },
      {
        kind: "square",
        lenses: [
          expect.objectContaining({ id: "1:1" }),
          expect.objectContaining({ id: "Circle" }),
        ],
      },
      {
        kind: "portrait",
        lenses: [
          expect.objectContaining({ id: "3:4" }),
          expect.objectContaining({ id: "9:16" }),
        ],
      },
    ]);
    setActivePreviewRatios(["9:19.5"]);
    expect(displayLensGroups()).toEqual([
      {
        kind: "portrait",
        lenses: [expect.objectContaining({ id: "9:19.5" })],
      },
    ]);
  });
});

describe("the display box is measured in artboard units", () => {
  it("boxes the artboard in a lens of the lens aspect", () => {
    expect(
      lensBox({ aspect: 1, shape: "rect" }, { width: 1600, height: 900 }),
    ).toEqual({ left: 0, top: -350, width: 1600, height: 1600 });
  });

  it("boxes a circle lens at the artboard diagonal", () => {
    const side = Math.hypot(1600, 900);
    const box = lensBox(
      { aspect: 1, shape: "circle" },
      { width: 1600, height: 900 },
    );
    expect(box.width).toBeCloseTo(side, 9);
    expect(box.left).toBeCloseTo((1600 - side) / 2, 9);
  });

  it("refuses a non-positive lens aspect", () => {
    expect(() =>
      lensBox({ aspect: 0, shape: "rect" }, { width: 1600, height: 900 }),
    ).toThrow(RangeError);
  });
});

describe("the window rect refuses an impossible aspect", () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses %s",
    (aspect) =>
      expect(() => screenRect({ width: 800, height: 600 }, aspect)).toThrow(
        RangeError,
      ),
  );
});

describe("the catalogue's answer for a new theme's size", () => {
  const DEFAULT_TOKENS = DEFAULT_PREVIEW_RATIO_TOKENS;

  it("spells a size's ratio in lowest terms, and a circle as the disc", () => {
    expect(previewRatioTokenFor({ width: 1920, height: 1080 })).toBe("16:9");
    expect(previewRatioTokenFor({ width: 1080, height: 1920 })).toBe("9:16");
    expect(previewRatioTokenFor({ width: 1920, height: 2000 })).toBe("24:25");
    expect(
      previewRatioTokenFor({ width: 1080, height: 1080, shape: "circle" }),
    ).toBe("Circle");
  });

  it("matches a stored lens by aspect, and names the one this way up", () => {
    setActivePreviewRatios(DEFAULT_TOKENS);

    expect(matchingPreviewLens({ width: 1920, height: 1080 })?.id).toBe("16:9");
    // The turned twin is the lens that names a portrait board, not the
    // landscape token it shares an aspect with.
    expect(matchingPreviewLens({ width: 1080, height: 1920 })?.id).toBe("9:16");
    // `16:10` and `8:5` are one frame.
    setActivePreviewRatios([...DEFAULT_TOKENS, "8:5"]);
    expect(matchingPreviewLens({ width: 1920, height: 1200 })?.id).toBe("8:5");
    // A disc is not a 1:1 rect.
    expect(
      matchingPreviewLens({ width: 1080, height: 1080, shape: "circle" })?.id,
    ).toBe("Circle");
    expect(matchingPreviewLens({ width: 1920, height: 2000 })).toBeUndefined();
  });

  it("adds a ratio to the stored list and the live catalogue", () => {
    const written: string[] = [];
    const storage = {
      getItem: () => null,
      setItem: (_key: string, value: string) => {
        written.push(value);
      },
      removeItem: () => {},
    } as unknown as Storage;
    setActivePreviewRatios(DEFAULT_TOKENS);

    addPreviewRatioToken("8:5", storage);

    expect(activePreviewRatioTokens()).toContain("8:5");
    expect(written).toHaveLength(1);
    expect(JSON.parse(written[0] ?? "[]")).toContain("8:5");
  });

  it("keeps the session's list when the store refuses the write", () => {
    const refusing = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {},
    } as unknown as Storage;
    setActivePreviewRatios(DEFAULT_TOKENS);

    addPreviewRatioToken("8:5", refusing);

    expect(activePreviewRatioTokens()).toContain("8:5");
  });

  it("stores a portrait token wide, so the catalogue offers both orientations", () => {
    const written: string[] = [];
    const storage = {
      getItem: () => null,
      setItem: (_key: string, value: string) => {
        written.push(value);
      },
      removeItem: () => {},
    } as unknown as Storage;
    setActivePreviewRatios([]);

    expect(addPreviewRatioToken("9:16", storage)).toEqual({
      kind: "added",
      persisted: true,
    });
    // One wide token derives the pair; storing the tall spelling would offer
    // only the portrait lens.
    expect(activePreviewRatioTokens()).toEqual(["16:9"]);
    expect(activePreviewLenses().map((lens) => lens.id)).toEqual([
      "16:9",
      "9:16",
    ]);
    expect(JSON.parse(written[0] ?? "[]")).toEqual(["16:9"]);
  });

  it("refuses a duplicate or an equivalent before touching the store", () => {
    const writes: string[] = [];
    const storage = {
      getItem: () => null,
      setItem: (_key: string, value: string) => {
        writes.push(value);
      },
      removeItem: () => {},
    } as unknown as Storage;
    setActivePreviewRatios(["16:9"]);

    // The tall spelling canonicalises to the stored token.
    expect(addPreviewRatioToken("9:16", storage)).toEqual({
      kind: "duplicate",
    });
    // A different spelling of the same shape is the equivalent refusal.
    setActivePreviewRatios(["21:9"]);
    expect(addPreviewRatioToken("7:3", storage)).toEqual({
      kind: "equivalent",
      entered: "7:3",
      existing: "21:9",
    });
    expect(addPreviewRatioToken("not-a-ratio", storage)).toEqual({
      kind: "invalid",
    });
    expect(writes).toEqual([]);
  });
});
