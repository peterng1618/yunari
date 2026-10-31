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
    ]);
    expect(withMedia[1]?.fields.map((field) => field.id)).toEqual([
      "background.bounds",
      "background.offsetX-offsetY",
      "background.flipX",
      "background.flipY",
    ]);
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
