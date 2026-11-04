import type {
  AssetReference,
  Background,
  FabricGlobals,
} from "@yunari/renderer-core";
import { describe, expect, it } from "vitest";
import { backgroundColumn, writeBackgroundField } from "./background-column.js";

/**
 * The background's column, as values. The background is not a Fabric object and
 * never reaches `perKindColumn`, so its two sections are asserted here rather
 * than through the per-kind examples.
 */

describe("backgroundColumn", () => {
  it("asks Content for colour and media, and adds Position once media exists", () => {
    const bare = backgroundColumn({
      background: undefined,
      assets: [],
      globals: undefined,
    });

    // No media, no position: a picture is what a position places, and the
    // first write would refuse, so the section is absent rather than refused.
    expect(bare.map((section) => section.id)).toEqual(["content"]);
    expect(bare[0]?.fields.map((field) => field.id)).toEqual([
      "background.color",
      "background.fill",
      "background.media",
    ]);

    const withMedia = backgroundColumn({
      background: { media: { assetId: "a", bounds: "theme" } },
      assets: [],
      globals: undefined,
    });

    expect(withMedia.map((section) => section.id)).toEqual([
      "content",
      "position",
      "composition",
    ]);
    expect(withMedia[1]?.fields.map((field) => field.id)).toEqual([
      "background.bounds",
      "background.scale",
      "background.offsetX-offsetY",
      "background.flipX",
      "background.flipY",
    ]);
    expect(
      withMedia[1]?.fields.find((field) => field.id === "background.scale"),
    ).toMatchObject({
      control: "slider",
      value: 1,
      min: 1,
      max: 5,
      percent: true,
    });
    expect(
      withMedia[1]?.fields.find(
        (field) => field.id === "background.offsetX-offsetY",
      ),
    ).toMatchObject({
      control: "pair",
      halves: [{ id: "background.offsetX" }, { id: "background.offsetY" }],
    });
  });

  it("shows offsets as percentages and the flips as switches", () => {
    const sections = backgroundColumn({
      background: {
        media: {
          assetId: "a",
          bounds: "theme",
          scale: 2.5,
          offsetX: 0.25,
          flipX: true,
        },
      },
      assets: [],
      globals: undefined,
    });

    const flips = (id: string) =>
      sections[1]?.fields.find((field) => field.id === id);
    expect(flips("background.flipX")).toMatchObject({
      control: "toggle",
      checked: true,
    });
    expect(flips("background.flipY")).toMatchObject({
      control: "toggle",
      checked: false,
    });
    expect(flips("background.scale")).toMatchObject({
      control: "slider",
      value: 2.5,
      min: 1,
      max: 5,
      percent: true,
    });

    const offsets = sections[1]?.fields.find(
      (field) => field.id === "background.offsetX-offsetY",
    );
    expect(offsets).toMatchObject({
      control: "pair",
      halves: [
        { id: "background.offsetX", value: 0.25, percent: true },
        { id: "background.offsetY", value: 0, percent: true },
      ],
    });
  });

  it("reads an unset background as the model's defaults", () => {
    const sections = backgroundColumn({
      background: undefined,
      assets: [],
      globals: undefined,
    });
    const field = (id: string) =>
      sections
        .flatMap((section) => section.fields)
        .find((entry) => entry.id === id);

    expect(field("background.color")).toMatchObject({
      value: "",
      colour: "transparent",
    });
    expect(field("background.media")).toMatchObject({
      control: "select",
      value: "",
    });
    // The position fields are not here: the section waits for a media.
    expect(field("background.bounds")).toBeUndefined();
    expect(field("background.flipX")).toBeUndefined();
  });

  it("paints the stored palette reference and offers the document's tokens", () => {
    const globals = {
      palette: {
        ink: { name: "Ink", value: { kind: "solid", color: "#e8ecf3" } },
      },
    } as unknown as FabricGlobals;
    const sections = backgroundColumn({
      background: { color: { ref: "palette.ink" } },
      assets: [],
      globals,
    });

    expect(
      sections[0]?.fields.find((field) => field.id === "background.color"),
    ).toMatchObject({
      control: "swatch",
      value: "palette.ink",
      colour: "#e8ecf3",
      options: [
        { id: "", name: "not set" },
        { id: "palette.ink", name: "Ink" },
      ],
    });
  });

  it("offers a fallback frame only while the picture is a video", () => {
    const video = backgroundColumn({
      background: {
        media: { assetId: "loop", bounds: "theme", fallbackFrame: 42 },
      },
      assets: [{ id: "loop", kind: "video", path: "assets/loop.mp4" }],
      globals: undefined,
    });
    expect(video[0]?.fields.map((field) => field.id)).toEqual([
      "background.color",
      "background.fill",
      "background.media",
      "background.fallbackFrame",
    ]);
    expect(video[0]?.fields.at(-1)).toMatchObject({
      control: "number",
      value: 42,
      min: 0,
      integer: true,
    });

    const image = backgroundColumn({
      background: { media: { assetId: "photo", bounds: "theme" } },
      assets: [{ id: "photo", kind: "image", path: "assets/photo.png" }],
      globals: undefined,
    });
    expect(image[0]?.fields.map((field) => field.id)).not.toContain(
      "background.fallbackFrame",
    );
  });

  it("asks Content for a fill after the colour, and a composition once media exists", () => {
    const sections = backgroundColumn({
      background: {
        media: {
          assetId: "a",
          bounds: "theme",
          region: {
            left: 0.65,
            blend: { shape: "linear", edge: "left", length: 0.12 },
          },
        },
      },
      assets: [],
      globals: undefined,
    });

    // A fill is content: it is what the uncovered area is painted with.
    expect(sections[0]?.fields.map((field) => field.id)).toEqual([
      "background.color",
      "background.fill",
      "background.media",
    ]);
    expect(sections.map((section) => section.id)).toEqual([
      "content",
      "position",
      "composition",
    ]);
    expect(sections[2]?.fields.map((field) => field.id)).toEqual([
      "background.inset",
      "background.insetAmount",
      "background.blendEdges",
      "background.blendLength",
      "background.blendShape",
    ]);
    expect(
      sections[2]?.fields.find((field) => field.id === "background.inset"),
    ).toMatchObject({ control: "segmented", value: "left" });
    expect(
      sections[2]?.fields.find(
        (field) => field.id === "background.insetAmount",
      ),
    ).toMatchObject({
      control: "slider",
      value: 0.35,
      min: 0.1,
      max: 0.9,
      percent: true,
    });
    expect(
      sections[2]?.fields.find((field) => field.id === "background.blendEdges"),
    ).toMatchObject({ control: "select", value: "left" });
    expect(
      sections[2]?.fields.find(
        (field) => field.id === "background.blendLength",
      ),
    ).toMatchObject({
      control: "slider",
      value: 0.12,
      min: 0.01,
      max: 0.5,
      percent: true,
    });
    expect(
      sections[2]?.fields.find((field) => field.id === "background.blendShape"),
    ).toMatchObject({ control: "segmented", value: "linear" });

    // A composition places a picture, so it waits for one.
    expect(
      backgroundColumn({
        background: undefined,
        assets: [],
        globals: undefined,
      }).map((section) => section.id),
    ).toEqual(["content"]);
  });

  it("offers only the assets a background can be", () => {
    const sections = backgroundColumn({
      background: undefined,
      assets: [
        { id: "photo", kind: "image", path: "assets/photo.png" },
        { id: "mark", kind: "svg", path: "assets/mark.svg" },
        { id: "loop", kind: "video", path: "assets/loop.mp4" },
        { id: "body", kind: "font", path: "assets/body.woff2" },
      ],
      globals: undefined,
    });

    expect(
      sections[0]?.fields.find((field) => field.id === "background.media"),
    ).toMatchObject({
      options: [
        { id: "", name: "None" },
        { id: "photo", name: "photo" },
        { id: "mark", name: "mark" },
        { id: "loop", name: "loop" },
      ],
    });
  });
});

describe("writeBackgroundField", () => {
  const background: Background = {
    media: { assetId: "photo", bounds: "theme" },
  };

  it("refuses a non-finite offset", () => {
    // `NaN` fails every `>`/`<` comparison, so a guard written as a range alone
    // applies no range at all to it.
    for (const value of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(
        writeBackgroundField(background, "background.offsetX", value),
      ).toBeUndefined();
      expect(
        writeBackgroundField(background, "background.offsetY", value),
      ).toBeUndefined();
    }
  });

  it("writes an in-range offset", () => {
    expect(
      writeBackgroundField(background, "background.offsetX", 0.5),
    ).toMatchObject({ media: { offsetX: 0.5 } });
  });

  it("writes a scale in the model's 100–500% range and omits 100%", () => {
    expect(
      writeBackgroundField(background, "background.scale", 2.5),
    ).toMatchObject({ media: { scale: 2.5 } });
    // The default zoom is the absent key, so returning the track to 100% leaves
    // a document that reads as the renderer's original cover.
    const reset = writeBackgroundField(
      { media: { assetId: "photo", bounds: "theme", scale: 3 } },
      "background.scale",
      1,
    )?.media;
    expect(reset).not.toHaveProperty("scale");
    // A scale is refused outside the range, not rounded into it.
    for (const value of [0.5, 5.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        writeBackgroundField(background, "background.scale", value),
      ).toBeUndefined();
    }
  });

  it("writes a flip as a boolean and removes it when switched off", () => {
    // `false` is the default reading, so it is stored by omission: the key's
    // presence is the flip.
    const flipped = writeBackgroundField(background, "background.flipX", true);
    expect(flipped).toMatchObject({ media: { flipX: true } });
    expect(
      writeBackgroundField(flipped, "background.flipY", true),
    ).toMatchObject({ media: { flipX: true, flipY: true } });
    const cleared = writeBackgroundField(
      flipped,
      "background.flipX",
      false,
    )?.media;
    expect(cleared, "the switched-off key is gone").not.toHaveProperty("flipX");
    expect(cleared).toMatchObject({ assetId: "photo", bounds: "theme" });
    expect(
      writeBackgroundField(background, "background.flipX", "yes"),
    ).toBeUndefined();
  });

  it("writes a whole frame number and refuses anything else", () => {
    const video: Background = {
      media: { assetId: "loop", bounds: "theme" },
    };
    expect(
      writeBackgroundField(video, "background.fallbackFrame", 24),
    ).toMatchObject({ media: { fallbackFrame: 24 } });
    // A frame has no index between two, and none before the first.
    for (const value of [-1, 1.5, Number.NaN]) {
      expect(
        writeBackgroundField(video, "background.fallbackFrame", value),
      ).toBeUndefined();
    }
    // Nothing to carry a frame until a picture is chosen.
    expect(
      writeBackgroundField({}, "background.fallbackFrame", 0),
    ).toBeUndefined();
  });

  it("writes a fill as a palette reference and clears it", () => {
    expect(
      writeBackgroundField(background, "background.fill", "palette.ink"),
    ).toMatchObject({ fill: { ref: "palette.ink" } });
    expect(
      writeBackgroundField(
        { fill: { ref: "palette.ink" } },
        "background.fill",
        "",
      ),
    ).toEqual({});
    expect(
      writeBackgroundField(background, "background.fill", "not-a-token"),
    ).toBeUndefined();
  });

  it("turns a region mode into insets at the size already authored", () => {
    // A left inset of 0.65 is an area of 35%, and that size survives a change
    // of edge: the mode says which edge, the existing region says how much.
    const edged: Background = {
      media: {
        assetId: "a",
        bounds: "theme",
        region: { right: 0.65 },
      },
    };
    expect(
      writeBackgroundField(edged, "background.inset", "left"),
    ).toMatchObject({ media: { region: { left: 0.65 } } });
    expect(
      writeBackgroundField(edged, "background.inset", "full")?.media,
    ).not.toHaveProperty("region");
    expect(
      writeBackgroundField(edged, "background.inset", "bogus"),
    ).toBeUndefined();
    // A picture with no region keeps half its box when a mode first appears.
    expect(
      writeBackgroundField(background, "background.inset", "left"),
    ).toMatchObject({ media: { region: { left: 0.5 } } });
    // All four sides split the uncovered half, so each axis keeps the authored
    // size; a full 0.65 inset on both sides of an axis would leave no area.
    expect(
      writeBackgroundField(edged, "background.inset", "inset"),
    ).toMatchObject({
      media: {
        region: {
          left: 0.325,
          right: 0.325,
          top: 0.325,
          bottom: 0.325,
        },
      },
    });
  });

  it("writes the area size on the current mode and refuses it out of range", () => {
    const edged: Background = {
      media: { assetId: "a", bounds: "theme", region: { right: 0.65 } },
    };
    expect(
      writeBackgroundField(edged, "background.insetAmount", 0.4),
    ).toMatchObject({ media: { region: { right: 0.6 } } });
    for (const value of [0.05, 0.95, Number.NaN]) {
      expect(
        writeBackgroundField(edged, "background.insetAmount", value),
      ).toBeUndefined();
    }
  });

  it("writes the blend's edge, length and shape", () => {
    const plain: Background = {
      media: { assetId: "a", bounds: "theme" },
    };
    // "Around" is the radial ramp, and a first fade starts at the default
    // length rather than inventing one per control.
    expect(
      writeBackgroundField(plain, "background.blendEdges", "all"),
    ).toMatchObject({
      media: { region: { blend: { shape: "radial", length: 0.1 } } },
    });
    // Nothing to lengthen until a fade exists.
    expect(
      writeBackgroundField(plain, "background.blendLength", 0.2),
    ).toBeUndefined();

    const blended: Background = {
      media: {
        assetId: "a",
        bounds: "theme",
        region: {
          left: 0.2,
          blend: { shape: "linear", edge: "top", length: 0.2 },
        },
      },
    };
    expect(
      writeBackgroundField(blended, "background.blendLength", 0.4),
    ).toMatchObject({
      media: {
        region: { blend: { shape: "linear", edge: "top", length: 0.4 } },
      },
    });
    expect(
      writeBackgroundField(blended, "background.blendEdges", "right"),
    ).toMatchObject({
      media: {
        region: { blend: { shape: "linear", edge: "right", length: 0.2 } },
      },
    });
    expect(
      writeBackgroundField(blended, "background.blendEdges", "none")?.media,
    ).not.toHaveProperty("blend");
    expect(
      writeBackgroundField(blended, "background.blendShape", "radial"),
    ).toMatchObject({
      media: { region: { blend: { shape: "radial", length: 0.2 } } },
    });
    // A radial ramp has no edge, so going back to linear needs one; the left
    // edge is the least surprising pick.
    expect(
      writeBackgroundField(
        {
          media: {
            assetId: "a",
            bounds: "theme",
            region: { blend: { shape: "radial", length: 0.2 } },
          },
        },
        "background.blendShape",
        "linear",
      ),
    ).toMatchObject({
      media: {
        region: { blend: { shape: "linear", edge: "left", length: 0.2 } },
      },
    });
  });

  it("drops the frame when the picture stops being a video", () => {
    const assets: readonly AssetReference[] = [
      { id: "loop", kind: "video", path: "assets/loop.mp4" },
      { id: "other", kind: "video", path: "assets/other.mp4" },
      { id: "photo", kind: "image", path: "assets/photo.png" },
    ];
    const framed: Background = {
      media: {
        assetId: "loop",
        bounds: "theme",
        fallbackFrame: 5,
        offsetX: 0.2,
      },
    };

    // Both directions of a video change keep the frame and the pan.
    expect(
      writeBackgroundField(framed, "background.media", "other", assets),
    ).toMatchObject({ media: { fallbackFrame: 5, offsetX: 0.2 } });

    const still = writeBackgroundField(
      framed,
      "background.media",
      "photo",
      assets,
    )?.media;
    expect(still, "only a video has frames").toMatchObject({
      assetId: "photo",
      offsetX: 0.2,
    });
    expect(still).not.toHaveProperty("fallbackFrame");
  });
});
