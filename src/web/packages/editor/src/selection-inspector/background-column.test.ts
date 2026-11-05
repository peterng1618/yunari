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
      "background.mode",
      "background.color",
      "background.media",
    ]);

    const withMedia = backgroundColumn({
      background: {
        mode: "advanced",
        media: { assetId: "a", bounds: "theme" },
      },
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
      "background.mode",
      "background.color",
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

  it("asks Content for the colour, and a composition once media exists", () => {
    const sections = backgroundColumn({
      background: {
        mode: "advanced",
        media: {
          assetId: "a",
          bounds: "theme",
          composition: { anchor: "left", extent: 0.35, fade: 0.12 },
        },
      },
      assets: [],
      globals: undefined,
    });

    // The colour is content: it is what the uncovered area is painted with.
    expect(sections[0]?.fields.map((field) => field.id)).toEqual([
      "background.mode",
      "background.color",
      "background.media",
    ]);
    expect(sections.map((section) => section.id)).toEqual([
      "content",
      "position",
      "composition",
    ]);
    expect(sections[2]?.fields.map((field) => field.id)).toEqual([
      "background.anchor",
      "background.extent",
      "background.fade",
    ]);
    expect(
      sections[2]?.fields.find((field) => field.id === "background.anchor"),
    ).toMatchObject({ control: "select", value: "left" });
    expect(
      sections[2]?.fields.find((field) => field.id === "background.extent"),
    ).toMatchObject({
      control: "slider",
      value: 0.35,
      min: 0.1,
      max: 1,
      percent: true,
    });
    expect(
      sections[2]?.fields.find((field) => field.id === "background.fade"),
    ).toMatchObject({
      control: "slider",
      value: 0.12,
      min: 0,
      max: 1,
      percent: true,
    });

    // A composition places a picture, so it waits for one.
    expect(
      backgroundColumn({
        background: undefined,
        assets: [],
        globals: undefined,
      }).map((section) => section.id),
    ).toEqual(["content"]);
  });

  it("reads a full cover as no anchor, and a centred band as no size", () => {
    const plain = backgroundColumn({
      background: {
        mode: "advanced",
        media: { assetId: "a", bounds: "theme" },
      },
      assets: [],
      globals: undefined,
    });
    expect(plain[2]?.fields.map((field) => field.id)).toEqual([
      "background.anchor",
    ]);
    expect(
      plain[2]?.fields.find((field) => field.id === "background.anchor"),
    ).toMatchObject({ value: "full" });

    const centred = backgroundColumn({
      background: {
        mode: "advanced",
        media: {
          assetId: "a",
          bounds: "theme",
          composition: { fade: 0.1 },
        },
      },
      assets: [],
      globals: undefined,
    });
    // The picture sizes a centred band, so it has no size row; the absent fade
    // reads 0 because zero is how the ramp is switched off.
    expect(centred[2]?.fields.map((field) => field.id)).toEqual([
      "background.anchor",
      "background.fade",
    ]);
    expect(
      centred[2]?.fields.find((field) => field.id === "background.anchor"),
    ).toMatchObject({ value: "center" });
    expect(
      centred[2]?.fields.find((field) => field.id === "background.fade"),
    ).toMatchObject({ value: 0.1 });
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
    mode: "advanced",
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

  it("writes an anchor, keeping the size and fade already authored", () => {
    const composed: Background = {
      mode: "advanced",
      media: {
        assetId: "a",
        bounds: "theme",
        composition: { anchor: "left", extent: 0.35, fade: 0.12 },
      },
    };
    expect(
      writeBackgroundField(composed, "background.anchor", "right"),
    ).toMatchObject({
      media: { composition: { anchor: "right", extent: 0.35, fade: 0.12 } },
    });
    // `full` is the cover: no composition at all, so the media maps the whole
    // box and the fill never shows.
    expect(
      writeBackgroundField(composed, "background.anchor", "full")?.media,
    ).not.toHaveProperty("composition");
    expect(
      writeBackgroundField(composed, "background.anchor", "bogus"),
    ).toBeUndefined();
    // A picture with no composition yet starts at the centre: an advanced
    // background always composes once an anchor is chosen.
    expect(
      writeBackgroundField(background, "background.anchor", "center"),
    ).toMatchObject({ media: { composition: { anchor: "center" } } });
  });

  it("writes the size only on an edge anchor and refuses it out of range", () => {
    const edged: Background = {
      mode: "advanced",
      media: {
        assetId: "a",
        bounds: "theme",
        composition: { anchor: "right" },
      },
    };
    expect(writeBackgroundField(edged, "background.extent", 0.4)).toMatchObject(
      { media: { composition: { anchor: "right", extent: 0.4 } } },
    );
    expect(writeBackgroundField(edged, "background.extent", 1)).toMatchObject({
      media: { composition: { anchor: "right", extent: 1 } },
    });
    for (const value of [0.05, 1.01, Number.NaN]) {
      expect(
        writeBackgroundField(edged, "background.extent", value),
      ).toBeUndefined();
    }
    // A centred band is sized by its picture's aspect, so it stores no size.
    const centred: Background = {
      mode: "advanced",
      media: {
        assetId: "a",
        bounds: "theme",
        composition: { anchor: "center" },
      },
    };
    expect(
      writeBackgroundField(centred, "background.extent", 0.4),
    ).toBeUndefined();
  });

  it("writes the fade, and stores zero as no ramp", () => {
    const composed: Background = {
      mode: "advanced",
      media: {
        assetId: "a",
        bounds: "theme",
        composition: { anchor: "top" },
      },
    };
    expect(
      writeBackgroundField(composed, "background.fade", 0.2),
    ).toMatchObject({ media: { composition: { anchor: "top", fade: 0.2 } } });
    const none = writeBackgroundField(composed, "background.fade", 0)?.media;
    expect(none?.composition).not.toHaveProperty("fade");
    // The ramp may span the whole box; the model's range is the only limit.
    expect(writeBackgroundField(composed, "background.fade", 1)).toMatchObject({
      media: { composition: { anchor: "top", fade: 1 } },
    });
    for (const value of [-0.1, 1.01, Number.NaN]) {
      expect(
        writeBackgroundField(composed, "background.fade", value),
      ).toBeUndefined();
    }
    // There is no seam without a composition, so there is nothing to fade.
    expect(
      writeBackgroundField(background, "background.fade", 0.2),
    ).toBeUndefined();
  });

  it("leaves the media and mode ids to the document's switch seam", () => {
    const assets: readonly AssetReference[] = [
      { id: "loop", kind: "video", path: "assets/loop.mp4" },
      { id: "photo", kind: "image", path: "assets/photo.png" },
    ];
    const background: Background = {
      media: { assetId: "loop", bounds: "theme" },
    };
    // Which asset is shown and which model is in force are the document's to
    // decide: a whole-background replacement here cannot see the geometry the
    // outgoing asset must keep.
    expect(
      writeBackgroundField(background, "background.media", "photo", assets),
    ).toBeUndefined();
    expect(
      writeBackgroundField(background, "background.media", ""),
    ).toBeUndefined();
    expect(
      writeBackgroundField(background, "background.mode", "advanced"),
    ).toBeUndefined();
  });
});

describe("background modes", () => {
  it("starts simple: no fill row and no composition section", () => {
    const sections = backgroundColumn({
      background: { media: { assetId: "a", bounds: "theme" } },
      assets: [],
      globals: undefined,
    });
    expect(sections.map((section) => section.id)).toEqual([
      "content",
      "position",
    ]);
    expect(sections[0]?.fields.map((field) => field.id)).toEqual([
      "background.mode",
      "background.color",
      "background.media",
    ]);
    expect(
      sections[0]?.fields.find((field) => field.id === "background.mode"),
    ).toMatchObject({ control: "segmented", value: "simple" });
  });

  it("offers the composition once advanced", () => {
    const sections = backgroundColumn({
      background: {
        mode: "advanced",
        media: { assetId: "a", bounds: "theme" },
      },
      assets: [],
      globals: undefined,
    });
    expect(sections.map((section) => section.id)).toEqual([
      "content",
      "position",
      "composition",
    ]);
    expect(
      sections[0]?.fields.find((field) => field.id === "background.mode"),
    ).toMatchObject({ control: "segmented", value: "advanced" });
  });

  it("refuses a composition write while simple", () => {
    const plain: Background = {
      media: { assetId: "a", bounds: "theme" },
    };
    expect(
      writeBackgroundField(plain, "background.anchor", "left"),
    ).toBeUndefined();
    expect(writeBackgroundField(plain, "background.fade", 0.2)).toBeUndefined();
  });

  it("still writes the media's own geometry while simple", () => {
    const plain: Background = {
      media: { assetId: "a", bounds: "theme" },
    };
    expect(writeBackgroundField(plain, "background.bounds", "display")).toEqual(
      {
        media: { assetId: "a", bounds: "display" },
      },
    );
    expect(writeBackgroundField(plain, "background.scale", 2)).toMatchObject({
      media: { scale: 2 },
    });
  });
});
