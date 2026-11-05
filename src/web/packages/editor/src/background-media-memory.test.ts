import type { BackgroundMedia } from "@yunari/renderer-core";
import { describe, expect, it } from "vitest";
import {
  BACKGROUND_MEDIA_MEMORY_VERSION,
  type BackgroundMediaMemory,
  encodeBackgroundMedia,
  filterBackgroundMedia,
  readBackgroundMediaMemory,
  rememberBackgroundMedia,
  restoreBackgroundMedia,
} from "./background-media-memory.js";

describe("readBackgroundMediaMemory", () => {
  it("reads an absent sidecar as empty", () => {
    expect(readBackgroundMediaMemory(undefined)).toEqual({});
  });

  it("drops the file when the version or media member is wrong", () => {
    expect(readBackgroundMediaMemory({ version: 2, media: {} })).toEqual({});
    expect(readBackgroundMediaMemory({ version: 1, media: [] })).toEqual({});
    expect(readBackgroundMediaMemory({ version: 1, media: "x" })).toEqual({});
    expect(readBackgroundMediaMemory("x")).toEqual({});
  });

  it("drops one entry whose field is outside the schema bounds", () => {
    expect(
      readBackgroundMediaMemory({
        version: 1,
        media: {
          bad: { bounds: "theme", offsetX: 9 },
          good: { bounds: "display", scale: 2 },
        },
      }),
    ).toEqual({ good: { bounds: "display", scale: 2 } });
  });

  it("drops an entry with a malformed composition or frame", () => {
    expect(
      readBackgroundMediaMemory({
        version: 1,
        media: {
          band: { bounds: "theme", composition: { anchor: "middle" } },
          ramp: { bounds: "theme", composition: { fade: 2 } },
          frame: { bounds: "theme", fallbackFrame: 1.5 },
          still: {
            bounds: "theme",
            fallbackFrame: 0,
            flipX: "yes",
          },
        },
      }),
    ).toEqual({});
  });

  it("keeps only the known fields of a valid entry", () => {
    expect(
      readBackgroundMediaMemory({
        version: 1,
        media: {
          a: {
            bounds: "display",
            offsetY: -0.5,
            flipY: true,
            composition: { anchor: "bottom", extent: 0.4, fade: 0.2 },
            extra: "dropped",
          },
        },
      }),
    ).toEqual({
      a: {
        bounds: "display",
        offsetY: -0.5,
        flipY: true,
        composition: { anchor: "bottom", extent: 0.4, fade: 0.2 },
      },
    });
  });
});

describe("rememberBackgroundMedia", () => {
  it("captures every field except the asset id", () => {
    const media: BackgroundMedia = {
      assetId: "a",
      bounds: "display",
      offsetX: 0.25,
      scale: 2,
      flipX: true,
      fallbackFrame: 42,
      composition: { anchor: "left", extent: 0.4 },
    };
    expect(rememberBackgroundMedia({}, media, "advanced")).toEqual({
      a: {
        bounds: "display",
        offsetX: 0.25,
        scale: 2,
        flipX: true,
        fallbackFrame: 42,
        composition: { anchor: "left", extent: 0.4 },
      },
    });
  });

  it("keeps the hidden composition while simple", () => {
    const memory: BackgroundMediaMemory = {
      a: { bounds: "theme", composition: { anchor: "left" } },
    };
    const next = rememberBackgroundMedia(
      memory,
      { assetId: "a", bounds: "theme", scale: 2 },
      "simple",
    );
    expect(next.a).toEqual({
      bounds: "theme",
      scale: 2,
      composition: { anchor: "left" },
    });
  });

  it("lets advanced clear a composition", () => {
    const memory: BackgroundMediaMemory = {
      a: { bounds: "theme", composition: { anchor: "left" } },
    };
    const next = rememberBackgroundMedia(
      memory,
      { assetId: "a", bounds: "theme" },
      "advanced",
    );
    expect(next.a).toEqual({ bounds: "theme" });
  });

  it("keeps the rest of the map", () => {
    const memory: BackgroundMediaMemory = { b: { bounds: "display" } };
    const next = rememberBackgroundMedia(
      memory,
      { assetId: "a", bounds: "theme" },
      "simple",
    );
    expect(next.b).toEqual({ bounds: "display" });
  });
});

describe("restoreBackgroundMedia", () => {
  const entry = {
    bounds: "display",
    offsetX: 0.2,
    scale: 3,
    flipX: true,
    fallbackFrame: 42,
    composition: { anchor: "left" },
  } as const;

  it("defaults an unseen asset to the theme bounds", () => {
    expect(restoreBackgroundMedia(undefined, "b", "image", "advanced")).toEqual(
      { assetId: "b", bounds: "theme" },
    );
  });

  it("restores the remembered composition only in advanced", () => {
    expect(
      restoreBackgroundMedia(entry, "a", "image", "advanced"),
    ).toMatchObject({ composition: { anchor: "left" } });
    expect(
      restoreBackgroundMedia(entry, "a", "image", "simple"),
    ).not.toHaveProperty("composition");
  });

  it("restores a fallback frame only for a video", () => {
    expect(restoreBackgroundMedia(entry, "a", "video", "simple")).toMatchObject(
      { fallbackFrame: 42 },
    );
    expect(
      restoreBackgroundMedia(entry, "a", "image", "simple"),
    ).not.toHaveProperty("fallbackFrame");
  });

  it("keeps the geometry in every mode", () => {
    expect(restoreBackgroundMedia(entry, "a", "image", "simple")).toMatchObject(
      {
        assetId: "a",
        bounds: "display",
        offsetX: 0.2,
        scale: 3,
        flipX: true,
      },
    );
  });
});

describe("filterBackgroundMedia", () => {
  it("keeps only the assets the document still declares", () => {
    expect(
      filterBackgroundMedia(
        { a: { bounds: "theme" }, b: { bounds: "display" } },
        new Set(["b"]),
      ),
    ).toEqual({ b: { bounds: "display" } });
  });
});

describe("encodeBackgroundMedia", () => {
  it("writes the versioned member the sidecar holds", () => {
    expect(encodeBackgroundMedia({ a: { bounds: "theme" } })).toEqual({
      version: BACKGROUND_MEDIA_MEMORY_VERSION,
      media: { a: { bounds: "theme" } },
    });
  });

  it("keeps an empty map, which is how a save clears stale entries", () => {
    expect(encodeBackgroundMedia({})).toEqual({
      version: BACKGROUND_MEDIA_MEMORY_VERSION,
      media: {},
    });
  });
});
