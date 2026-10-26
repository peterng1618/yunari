import { afterEach, describe, expect, it } from "vitest";
import {
  activePreviewLenses,
  activePreviewRatioTokens,
  DEFAULT_PREVIEW_RATIO_TOKENS,
  defaultPreviewLens,
  displayLensGroups,
  lensBox,
  lensMatching,
  normalisePreviewRatioTokens,
  parsePreviewRatio,
  previewCatalogueKey,
  previewLenses,
  readPreviewRatioTokens,
  resolveLens,
  screenRect,
  setActivePreviewRatios,
  subscribeLenses,
} from "./display-lens.js";

const storageReturning = (value: string): Storage =>
  ({ getItem: () => value }) as unknown as Storage;

/** The live list is module state, so a test that changes it puts the defaults
 *  back rather than leaving a later test reading a catalogue it did not set. */
afterEach(() => setActivePreviewRatios(DEFAULT_PREVIEW_RATIO_TOKENS));

describe("a preview ratio is a token in a closed vocabulary", () => {
  it("parses integer pairs into a reduced id", () => {
    expect(parsePreviewRatio("32:18")).toMatchObject({
      id: "16:9",
      width: 16,
      height: 9,
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
    expect(parsePreviewRatio("Circle")).toEqual({
      id: "Circle",
      width: 1,
      height: 1,
      shape: "circle",
    });
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
    setActivePreviewRatios(["9:16"]);
    expect(defaultPreviewLens()).toBeUndefined();
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

  it("opens on the first landscape lens and finds a lens by id", () => {
    setActivePreviewRatios(["1:1", "19.5:9"]);
    expect(defaultPreviewLens()?.id).toBe("1:1");
    expect(resolveLens("9:19.5")?.aspect).toBeCloseTo(9 / 19.5, 12);
    expect(resolveLens("nope")).toBeUndefined();
    expect(activePreviewRatioTokens()).toEqual(["1:1", "19.5:9"]);
    expect(activePreviewLenses().length).toBe(3);
  });

  it("finds a rect lens for an artboard shape, or nothing", () => {
    setActivePreviewRatios(["16:9", "Circle"]);
    expect(lensMatching({ ratio: "16:9", orientation: "portrait" })?.id).toBe(
      "9:16",
    );
    expect(
      lensMatching({ ratio: "4:3", orientation: "landscape" }),
    ).toBeUndefined();
  });

  it("groups the lenses by orientation, leading with the given one", () => {
    setActivePreviewRatios(["16:9", "4:3"]);
    expect(
      displayLensGroups("portrait").map((group) => group.orientation),
    ).toEqual(["portrait", "landscape"]);
    setActivePreviewRatios(["1:1"]);
    expect(displayLensGroups("portrait")).toEqual([
      {
        orientation: "landscape",
        lenses: [expect.objectContaining({ id: "1:1" })],
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
