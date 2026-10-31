// @vitest-environment jsdom

import type { FontAssetReference } from "@yunari/renderer-core";
import { Gradient, Group, Path, Textbox } from "fabric/es";
import { describe, expect, it, vi } from "vitest";
import {
  type OutlineFontParser,
  type OutlineGlyph,
  textToOutlines,
} from "./text-outlines.js";
import { uiCopy } from "./ui-copy.js";

const FACE: FontAssetReference = {
  id: "inter-400",
  kind: "font",
  path: "assets/inter-400.woff2",
  family: "Inter",
  weight: 400,
  style: "normal",
  format: "woff2",
};

/** A glyph whose transform is recorded, so the placement can be asserted
 *  without a real font's units getting in the way. */
function parserOf(calls: number[][]): OutlineFontParser {
  return () => ({
    unitsPerEm: 1000,
    glyph(char: string): OutlineGlyph | undefined {
      if (char === "Z") return undefined;
      return {
        transform(...matrix: number[]) {
          calls.push(matrix);
          return { toSVG: () => "M0 0L10 0L10 10L0 10Z" };
        },
      };
    },
  });
}

function target(text = "AB"): Textbox {
  const object = new Textbox(text, {
    id: "title",
    left: 40,
    top: 30,
    fontSize: 100,
    fontFamily: "Inter",
    fontWeight: 400,
    fill: "#ffffff",
  });
  object.set({ name: "Heading" });
  return object;
}

function convert(text = "AB", calls: number[][] = []) {
  return textToOutlines(
    target(text),
    { declarations: [FACE], bytes: { [FACE.path]: new Uint8Array([1]) } },
    parserOf(calls),
  );
}

describe("textToOutlines", () => {
  it("draws one path per visible glyph and keeps the object's identity", () => {
    const result = convert();
    expect(result.kind).toBe("outlined");
    if (result.kind !== "outlined") return;
    expect(result.group).toBeInstanceOf(Group);
    expect(result.group.get("id")).toBe("title");
    expect(result.group.get("name")).toBe("Heading");
    expect(result.group.getObjects()).toHaveLength(2);
    for (const path of result.group.getObjects())
      expect(path).toBeInstanceOf(Path);
    expect(result.group.getObjects()[0]?.get("fill")).toBe("#ffffff");
  });

  it("scales font units and flips the glyph's y axis through the object matrix", () => {
    const calls: number[][] = [];
    convert("A", calls);
    expect(calls).toHaveLength(1);
    const [a, b, c, d] = calls[0]!;
    // fontSize 100 over 1000 units per em.
    expect(a!).toBeCloseTo(0.1, 10);
    expect(b!).toBeCloseTo(0, 10);
    expect(c!).toBeCloseTo(0, 10);
    expect(d!).toBeCloseTo(-0.1, 10);
  });

  it("advances a second glyph along the line", () => {
    const calls: number[][] = [];
    convert("AB", calls);
    expect(calls).toHaveLength(2);
    expect(calls[1]![4]!).toBeGreaterThan(calls[0]![4]!);
  });

  it("refuses a face the theme does not declare", () => {
    const result = textToOutlines(
      target(),
      { declarations: [], bytes: {} },
      parserOf([]),
    );
    expect(result).toEqual({
      kind: "refused",
      reason: uiCopy.outline.noFont,
    });
  });

  it("refuses a character the declared face cannot draw", () => {
    const result = convert("Z");
    expect(result).toEqual({
      kind: "refused",
      reason: uiCopy.outline.missingGlyph,
    });
  });

  it("refuses bytes no parser can read", () => {
    const result = textToOutlines(
      target(),
      { declarations: [FACE], bytes: { [FACE.path]: new Uint8Array([1]) } },
      () => {
        throw new Error("not a font");
      },
    );
    expect(result).toEqual({
      kind: "refused",
      reason: uiCopy.outline.badFont,
    });
  });

  it("refuses a gradient fill rather than freezing one colour", () => {
    const object = target();
    object.set(
      "fill",
      new Gradient({
        type: "linear",
        coords: { x1: 0, y1: 0, x2: 1, y2: 0 },
        colorStops: [
          { offset: 0, color: "#fff" },
          { offset: 1, color: "#000" },
        ],
      }),
    );
    const result = textToOutlines(
      object,
      { declarations: [FACE], bytes: { [FACE.path]: new Uint8Array([1]) } },
      parserOf([]),
    );
    expect(result).toEqual({ kind: "refused", reason: uiCopy.outline.fill });
  });

  it("refuses whitespace alone — there is no geometry to freeze", () => {
    const result = convert("   ");
    expect(result).toEqual({ kind: "refused", reason: uiCopy.outline.empty });
  });

  it("parses each face once however many glyphs name it", () => {
    const parse = vi.fn(parserOf([]));
    textToOutlines(
      target("ABA"),
      { declarations: [FACE], bytes: { [FACE.path]: new Uint8Array([1]) } },
      parse,
    );
    expect(parse).toHaveBeenCalledTimes(1);
  });
});
