// @vitest-environment jsdom
import type { FontAssetReference } from "@yunari/renderer-core";
import { describe, expect, it, vi } from "vitest";
import { loadFontAssets } from "./font-assets.js";

const asset = {
  id: "inter-400",
  kind: "font" as const,
  path: "assets/inter-400.woff2",
  family: "Inter",
  weight: 400,
  style: "normal" as const,
  format: "woff2" as const,
  sourceUrl:
    "https://cdn.jsdelivr.net/fontsource/fonts/inter@5.1.1/latin-400-normal.woff2",
  license: {
    name: "SIL Open Font License 1.1",
    url: "https://openfontlicense.org/",
  },
};

const LATIN_RANGE =
  "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";
const VIETNAMESE_RANGE =
  "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB";

/** A declaration whose face resolves in a named cut. */
function subsetAsset(
  subset: string,
  overrides: Partial<FontAssetReference> = {},
): FontAssetReference {
  return {
    ...asset,
    id: `inter-${subset}`,
    path: `assets/inter-${subset}.woff2`,
    subset,
    ...overrides,
  };
}

/** A locally imported face: no published cut, so no range. */
function rangelessAsset(id: string): FontAssetReference {
  return { ...asset, id, path: `assets/${id}.woff2` };
}

describe("packaged font assets", () => {
  it("loads declared font bytes before rendering and releases only loaded faces", async () => {
    const face = { load: vi.fn().mockResolvedValue(undefined) };
    const fonts = { add: vi.fn(), delete: vi.fn() };

    const release = await loadFontAssets({
      assets: [asset],
      bytes: { [asset.path]: new Uint8Array([1, 2]) },
      fonts,
      createFontFace: vi.fn(() => face),
      onError: vi.fn(),
    });

    expect(fonts.add).toHaveBeenCalledWith(face);
    release();
    expect(fonts.delete).toHaveBeenCalledWith(face);
  });

  it("reports a failed face without releasing unrelated loaded faces", async () => {
    const first = { load: vi.fn().mockResolvedValue(undefined) };
    const failed = {
      load: vi.fn().mockRejectedValue(new Error("invalid font")),
    };
    const fonts = { add: vi.fn(), delete: vi.fn() };
    const onError = vi.fn();

    const release = await loadFontAssets({
      assets: [
        asset,
        {
          ...asset,
          id: "inter-700",
          path: "assets/inter-700.woff2",
          weight: 700,
        },
      ],
      bytes: {
        [asset.path]: new Uint8Array([1]),
        "assets/inter-700.woff2": new Uint8Array([2]),
      },
      fonts,
      createFontFace: vi
        .fn()
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(failed),
      onError,
    });

    expect(onError).toHaveBeenCalledWith(
      'Could not load packaged font "inter-700": invalid font',
    );
    release();
    expect(fonts.delete).toHaveBeenCalledWith(first);
    expect(fonts.delete).not.toHaveBeenCalledWith(failed);
  });

  it("loads identical bytes once across concurrent mounts", async () => {
    const face = { load: vi.fn().mockResolvedValue(undefined) };
    const fonts = { add: vi.fn(), delete: vi.fn() };
    const createFontFace = vi.fn(() => face);
    const load = {
      assets: [asset],
      bytes: { [asset.path]: new Uint8Array([1, 2]) },
      fonts,
      createFontFace,
      onError: vi.fn(),
    };

    const [releaseA, releaseB] = await Promise.all([
      loadFontAssets(load),
      loadFontAssets(load),
    ]);

    expect(createFontFace).toHaveBeenCalledTimes(1);
    expect(fonts.add).toHaveBeenCalledTimes(1);

    // The face outlives the first release because the second mount still holds it.
    releaseA();
    await Promise.resolve();
    expect(fonts.delete).not.toHaveBeenCalled();

    releaseB();
    await Promise.resolve();
    await Promise.resolve();
    expect(fonts.delete).toHaveBeenCalledWith(face);
  });

  it("registers each subset of one family with its own unicode range", async () => {
    const latin = subsetAsset("latin");
    const vietnamese = subsetAsset("vietnamese");
    const latinFace = { load: vi.fn().mockResolvedValue(undefined) };
    const vietnameseFace = { load: vi.fn().mockResolvedValue(undefined) };
    const fonts = { add: vi.fn(), delete: vi.fn() };
    const createFontFace = vi
      .fn()
      .mockReturnValueOnce(latinFace)
      .mockReturnValueOnce(vietnameseFace);

    await loadFontAssets({
      assets: [latin, vietnamese],
      bytes: {
        [latin.path]: new Uint8Array([1]),
        [vietnamese.path]: new Uint8Array([2]),
      },
      fonts,
      createFontFace,
      onError: vi.fn(),
    });

    expect(fonts.add).toHaveBeenCalledTimes(2);
    expect(createFontFace).toHaveBeenNthCalledWith(
      1,
      "Inter",
      expect.any(ArrayBuffer),
      { weight: "400", style: "normal", unicodeRange: LATIN_RANGE },
    );
    expect(createFontFace).toHaveBeenNthCalledWith(
      2,
      "Inter",
      expect.any(ArrayBuffer),
      { weight: "400", style: "normal", unicodeRange: VIETNAMESE_RANGE },
    );
  });

  it("registers an unknown subset without a unicode range", async () => {
    // A prototype key is the case a plain lookup gets wrong: `"constructor"`
    // reaches an inherited function and would be handed to FontFace as a range.
    for (const subset of ["klingon", "constructor", "__proto__", "toString"]) {
      const unknown = subsetAsset(subset);
      const face = { load: vi.fn().mockResolvedValue(undefined) };
      const fonts = { add: vi.fn(), delete: vi.fn() };
      const createFontFace = vi.fn(
        (
          _family: string,
          _source: ArrayBuffer,
          _descriptors: FontFaceDescriptors,
        ) => face,
      );

      await loadFontAssets({
        assets: [unknown],
        bytes: { [unknown.path]: new Uint8Array([1]) },
        fonts,
        createFontFace,
        onError: vi.fn(),
      });

      expect(fonts.add).toHaveBeenCalledWith(face);
      const descriptors = createFontFace.mock.calls[0]?.[2];
      expect(descriptors).toEqual({ weight: "400", style: "normal" });
      expect(descriptors).not.toHaveProperty("unicodeRange");
    }
  });

  it("registers ranged faces before a rangeless face of the same family", async () => {
    // Declaration order puts the rangeless face first; it must still be added
    // last, or it would cover every codepoint and shadow the ranged faces.
    const rangeless = rangelessAsset("inter-local");
    const latin = subsetAsset("latin");
    const fonts = { add: vi.fn(), delete: vi.fn() };
    const createFontFace = vi.fn(
      (
        _family: string,
        _source: ArrayBuffer,
        descriptors: FontFaceDescriptors,
      ) => ({ load: vi.fn().mockResolvedValue(undefined), descriptors }),
    );

    await loadFontAssets({
      assets: [rangeless, latin],
      bytes: {
        [rangeless.path]: new Uint8Array([1]),
        [latin.path]: new Uint8Array([2]),
      },
      fonts,
      createFontFace,
      onError: vi.fn(),
    });

    const addedRanges = fonts.add.mock.calls.map(
      (call) => (call[0] as { descriptors: FontFaceDescriptors }).descriptors,
    );
    expect(addedRanges.map((descriptors) => descriptors.unicodeRange)).toEqual([
      LATIN_RANGE,
      undefined,
    ]);
  });

  it("registers only the first rangeless face of one family, weight and style", async () => {
    const first = rangelessAsset("inter-local");
    const second = rangelessAsset("inter-other");
    const firstFace = { load: vi.fn().mockResolvedValue(undefined) };
    const secondFace = { load: vi.fn().mockResolvedValue(undefined) };
    const fonts = { add: vi.fn(), delete: vi.fn() };
    const onError = vi.fn();
    const createFontFace = vi
      .fn()
      .mockReturnValueOnce(firstFace)
      .mockReturnValueOnce(secondFace);

    await loadFontAssets({
      assets: [first, second],
      bytes: {
        [first.path]: new Uint8Array([1]),
        [second.path]: new Uint8Array([2]),
      },
      fonts,
      createFontFace,
      onError,
    });

    expect(fonts.add).toHaveBeenCalledTimes(1);
    expect(fonts.add).toHaveBeenCalledWith(firstFace);
    expect(onError).not.toHaveBeenCalled();
  });
});
