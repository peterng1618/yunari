import type { Background, FabricGlobals } from "@yunari/renderer-core";
import { describe, expect, it } from "vitest";
import { backgroundColumn, writeBackgroundField } from "./background-column.js";

/**
 * The background's column, as values. The background is not a Fabric object and
 * never reaches `perKindColumn`, so its two sections are asserted here rather
 * than through the per-kind examples.
 */

describe("backgroundColumn", () => {
  it("asks Content for colour and media, and Position for bounds, offsets and flips", () => {
    const sections = backgroundColumn({
      background: undefined,
      assets: [],
      globals: undefined,
    });

    expect(sections.map((section) => section.id)).toEqual([
      "content",
      "position",
    ]);
    expect(sections[0]?.fields.map((field) => field.id)).toEqual([
      "background.color",
      "background.media",
    ]);
    expect(sections[1]?.fields.map((field) => field.id)).toEqual([
      "background.bounds",
      "background.offsetX-offsetY",
      "background.flipX",
      "background.flipY",
    ]);
    expect(
      sections[1]?.fields.find(
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
      [...(sections[0]?.fields ?? []), ...(sections[1]?.fields ?? [])].find(
        (entry) => entry.id === id,
      );

    expect(field("background.color")).toMatchObject({
      value: "",
      colour: "transparent",
    });
    expect(field("background.media")).toMatchObject({
      control: "select",
      value: "",
    });
    expect(field("background.bounds")).toMatchObject({ value: "theme" });
    expect(field("background.offsetX-offsetY")).toMatchObject({
      halves: [{ value: 0 }, { value: 0 }],
    });
    expect(field("background.flipX")).toMatchObject({ checked: false });
    expect(field("background.flipY")).toMatchObject({ checked: false });
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
});
