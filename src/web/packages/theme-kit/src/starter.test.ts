// @vitest-environment node

import { validateFabricThemeEnvelope } from "@yunari/renderer-core";
import { describe, expect, it } from "vitest";
import { starterPalette } from "./globals.js";
import { createBlankTheme } from "./starter.js";

const createBlankFabricTheme = (artboard: {
  width: number;
  height: number;
  shape?: "rect" | "circle";
  contentFit?: "contain" | "cover";
}) => createBlankTheme({ artboard });

describe("the blank Fabric document", () => {
  /** The eight ids the product decision names: what a blank theme can paint
      with, plus `none`, which the validator requires of any palette. */
  const BLANK_PALETTE_IDS = [
    "none",
    "text",
    "dim",
    "panel",
    "frost",
    "panelStroke",
    "rule",
    "chartTrack",
  ] as const;
  /** What the decision rules out: the reference composition's device colours
      are not a starting vocabulary, and neither are the chart inks only its
      glass cards use. */
  const BLANK_PALETTE_ABSENT = [
    "cpu",
    "gpu",
    "ram",
    "vram",
    "down",
    "sparkArea",
    "storageFill",
    "bars",
    "background",
    "frostInk",
    "frostArea",
  ] as const;

  it("is a valid document at the artboard it was given", () => {
    const blank = createBlankFabricTheme({ width: 1920, height: 1080 });

    expect(validateFabricThemeEnvelope(blank)).toEqual({
      ok: true,
      envelope: blank,
    });
    expect(blank.artboard).toMatchObject({ width: 1920, height: 1080 });
  });

  it("carries a circle artboard's shape into the document", () => {
    const blank = createBlankFabricTheme({
      width: 1080,
      height: 1080,
      shape: "circle",
    });

    expect(blank.artboard.shape).toBe("circle");
    expect(blank.artboard.width).toBe(blank.artboard.height);
  });

  it("omits the shape key for a rect artboard, because absence means rect", () => {
    const blank = createBlankFabricTheme({ width: 1080, height: 1080 });

    expect(blank.artboard).not.toHaveProperty("shape");
  });

  it("writes only cover for content fit, because absence means contain", () => {
    expect(
      createBlankFabricTheme({ width: 800, height: 480 }).artboard,
    ).not.toHaveProperty("contentFit");
    expect(
      createBlankFabricTheme({
        width: 800,
        height: 480,
        contentFit: "cover",
      }).artboard,
    ).toMatchObject({ contentFit: "cover" });
  });

  it("is empty: no scene objects, no assets, no bindings, no media", () => {
    const blank = createBlankFabricTheme({ width: 1920, height: 1080 });

    expect(blank.scene["objects"]).toEqual([]);
    expect(blank.assets).toEqual([]);
    expect(blank.bindings).toEqual({});
    expect(blank.background?.media).toBeUndefined();
  });

  it("starts from exactly the minimal token set", () => {
    const blank = createBlankFabricTheme({ width: 1920, height: 1080 });
    const palette = blank.globals?.palette ?? {};

    expect(Object.keys(palette).sort()).toEqual([...BLANK_PALETTE_IDS].sort());
    for (const absent of BLANK_PALETTE_ABSENT) {
      expect(palette[absent], absent).toBeUndefined();
    }
    // Narrowed by id, never restated: the entries are the palette's own, so a
    // change to the starter's tint reaches a blank theme instead of leaving a
    // second literal behind to drift.
    for (const id of BLANK_PALETTE_IDS) {
      expect(palette[id], id).toBe(starterPalette[id]);
    }
  });

  it("carries the three type-token roles", () => {
    const blank = createBlankFabricTheme({ width: 800, height: 480 });

    expect(Object.keys(blank.globals?.typeTokens ?? {})).toEqual([
      "body",
      "heading",
      "mono",
    ]);
  });

  it("paints its artboard from tokens the blank palette actually has", () => {
    const blank = createBlankFabricTheme({ width: 1920, height: 1080 });
    const palette = blank.globals?.palette ?? {};
    const ids = (value: unknown): string[] =>
      value === undefined ? [] : [String((value as { ref: string }).ref)];

    for (const ref of ids(blank.background?.color)) {
      expect(ref.startsWith("palette."), ref).toBe(true);
      expect(palette[ref.slice("palette.".length)], ref).toBeDefined();
    }
  });

  it("names the document, and names no author nobody gave", () => {
    const unnamed = createBlankFabricTheme({ width: 800, height: 480 });
    expect(unnamed.metadata).toMatchObject({
      name: "New theme",
      description: "",
      themeLanguage: "en",
    });
    expect(unnamed.metadata).not.toHaveProperty("author");

    const authored = createBlankTheme({
      artboard: { width: 800, height: 480 },
      name: "Mine",
      author: "Ada",
      themeLanguage: "fr",
    });
    expect(authored.metadata).toMatchObject({
      name: "Mine",
      author: "Ada",
      themeLanguage: "fr",
    });
  });
});

describe("document identity", () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  it("mints a fresh id for every new document", () => {
    const first = createBlankFabricTheme({ width: 800, height: 480 });
    const second = createBlankFabricTheme({ width: 800, height: 480 });

    expect(first.id).toMatch(UUID);
    expect(second.id).toMatch(UUID);
    expect(first.id).not.toBe(second.id);
  });
});
