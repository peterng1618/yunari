import {
  type FontAssetReference,
  objectName,
  YUNARI_NAME_PROPERTY,
} from "@yunari/renderer-core";
import type { PlanTextObject } from "@yunari/scene-fabric";
import { Group, Path } from "fabric/es";
import * as fontkit from "fontkit";
import { uiCopy } from "./ui-copy.js";

/**
 * A text object frozen into vector paths.
 *
 * **The canvas is already the layout.** Fabric measures and wraps the text the
 * author sees, and exposes the result per line (`_textLines`, `__charBounds`)
 * and per grapheme (`getCompleteStyleDeclaration`). Re-running a layout engine
 * here would be a second owner of line breaks, alignment, tracking and scale,
 * and the two would disagree the first time a font's metrics moved. So the
 * conversion reads the object's own laid-out boxes and only asks the font file
 * for glyph outlines.
 *
 * **Bindings end because the geometry is the reading.** The object holds the
 * resolved reading when the action runs, so what is frozen is what the author
 * saw. A value that changes later cannot move a path, which is the point of the
 * action.
 *
 * A refusal is whole-object: a missing face, unparseable bytes or a character
 * the face has no glyph for refuses the conversion rather than emitting
 * partial geometry that silently drops a word.
 */

export interface OutlineFontSource {
  readonly declarations: readonly FontAssetReference[];
  readonly bytes: Readonly<Record<string, Uint8Array>>;
}

/** The slice of a parsed font the conversion needs. The seam exists so the
 *  layout can be tested with a known glyph rather than a real font file. */
export interface OutlineGlyph {
  transform(
    m0: number,
    m1: number,
    m2: number,
    m3: number,
    m4: number,
    m5: number,
  ): { toSVG(): string };
}

export interface OutlineFont {
  readonly unitsPerEm: number;
  glyph(char: string): OutlineGlyph | undefined;
}

export type OutlineFontParser = (bytes: Uint8Array) => OutlineFont;

export type OutlineResult =
  | { readonly kind: "outlined"; readonly group: Group }
  | { readonly kind: "refused"; readonly reason: string };

/** The Fabric text state the conversion reads. Fabric declares most of it
 *  private but computes all of it on every measurement, and re-deriving it
 *  would be the second layout owner this module exists to avoid. */
type OutlineableText = {
  readonly _textLines: readonly (readonly string[])[];
  readonly __charBounds: readonly (readonly OutlineCharBox[])[];
  readonly _fontSizeFraction: number;
  readonly direction: "ltr" | "rtl";
  initDimensions(): void;
  calcTransformMatrix(): number[];
  _getLeftOffset(): number;
  _getTopOffset(): number;
  _getLineLeftOffset(lineIndex: number): number;
  getHeightOfLine(lineIndex: number): number;
  getHeightOfLineImpl(lineIndex: number): number;
  getCompleteStyleDeclaration(
    lineIndex: number,
    charIndex: number,
  ): OutlineStyle;
};

interface OutlineCharBox {
  readonly kernedWidth: number;
}

interface OutlineStyle {
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly fontWeight: string | number;
  readonly fontStyle: string;
  readonly fill: unknown;
  readonly stroke: unknown;
  readonly strokeWidth: number;
}

/** Fontkit's `create` accepts a Node buffer; it reads the bytes in a browser
 *  build too. A collection is refused rather than picking a face silently. */
const defaultParser: OutlineFontParser = (bytes) => {
  const parsed = fontkit.create(bytes as unknown as Buffer);
  if ("fonts" in parsed) throw new Error("font collections are refused");
  return {
    unitsPerEm: parsed.unitsPerEm,
    glyph(char) {
      const codePoint = char.codePointAt(0);
      if (codePoint === undefined) return undefined;
      if (!parsed.hasGlyphForCodePoint(codePoint)) return undefined;
      return parsed.glyphForCodePoint(codePoint).path;
    },
  };
};

/** CSS weight names the presets may carry, as the numbers a declaration
 *  stores. */
const WEIGHT_NUMBERS: Readonly<Record<string, string>> = {
  normal: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
};

function weightOf(weight: string | number): string {
  const value = String(weight).toLowerCase();
  return WEIGHT_NUMBERS[value] ?? value;
}

/** The declared faces a style names. Subsets of one face are kept in
 *  declaration order, and a character is looked up through each in turn, so a
 *  latin-ext character finds the file that actually carries it. */
function facesOf(
  style: OutlineStyle,
  declarations: readonly FontAssetReference[],
): readonly FontAssetReference[] {
  const family = (style.fontFamily.split(",")[0] ?? "")
    .trim()
    .replace(/^["']|["']$/g, "");
  const weight = weightOf(style.fontWeight);
  const slant = style.fontStyle === "italic" ? "italic" : "normal";
  return declarations.filter(
    (entry) =>
      entry.kind === "font" &&
      entry.family === family &&
      weightOf(entry.weight) === weight &&
      entry.style === slant,
  );
}

/** One path per glyph, placed in the object's canvas coordinates. */
export function textToOutlines(
  object: PlanTextObject,
  source: OutlineFontSource,
  parse: OutlineFontParser = defaultParser,
): OutlineResult {
  const text = object as unknown as OutlineableText;
  text.initDimensions();
  const lines = text._textLines;
  if (lines.every((line) => line.length === 0)) {
    return { kind: "refused", reason: uiCopy.outline.empty };
  }

  const fonts = new Map<string, OutlineFont | null>();
  const fontFor = (face: FontAssetReference): OutlineFont | undefined => {
    if (fonts.has(face.id)) return fonts.get(face.id) ?? undefined;
    const bytes = source.bytes[face.path];
    let parsed: OutlineFont | undefined;
    if (bytes !== undefined) {
      try {
        parsed = parse(bytes);
      } catch {
        parsed = undefined;
      }
    }
    fonts.set(face.id, parsed ?? null);
    return parsed;
  };

  const matrix = text.calcTransformMatrix();
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = matrix;
  const sign = text.direction === "rtl" ? -1 : 1;
  const paths: Path[] = [];
  let lineTop = text._getTopOffset();

  for (const [lineIndex, graphemes] of lines.entries()) {
    const baseline =
      lineTop +
      text.getHeightOfLineImpl(lineIndex) * (1 - text._fontSizeFraction);
    const lineLeft = text._getLeftOffset() + text._getLineLeftOffset(lineIndex);
    let offset = 0;
    for (const [charIndex, char] of graphemes.entries()) {
      const box = text.__charBounds[lineIndex]?.[charIndex];
      if (box === undefined) continue;
      if (char.trim() !== "") {
        const style = text.getCompleteStyleDeclaration(lineIndex, charIndex);
        if (typeof style.fill !== "string") {
          return { kind: "refused", reason: uiCopy.outline.fill };
        }
        const faces = facesOf(style, source.declarations);
        if (faces.length === 0) {
          return { kind: "refused", reason: uiCopy.outline.noFont };
        }
        let glyph: OutlineGlyph | undefined;
        let scale = 0;
        for (const face of faces) {
          const font = fontFor(face);
          if (font === undefined) continue;
          glyph = font.glyph(char);
          if (glyph !== undefined) {
            scale = style.fontSize / font.unitsPerEm;
            break;
          }
        }
        if (glyph === undefined) {
          // Distinguish bytes nobody can read from a face that simply carries
          // no such character: the first is a broken package, the second is a
          // face that needs extending.
          const readable = faces.some((face) => fontFor(face) !== undefined);
          return {
            kind: "refused",
            reason: readable
              ? uiCopy.outline.missingGlyph
              : uiCopy.outline.badFont,
          };
        }
        const gx = lineLeft + sign * offset;
        const placed = glyph.transform(
          a * scale,
          b * scale,
          -c * scale,
          -d * scale,
          a * gx + c * baseline + e,
          b * gx + d * baseline + f,
        );
        paths.push(
          new Path(placed.toSVG(), {
            fill: style.fill,
            ...(typeof style.stroke === "string" && style.strokeWidth > 0
              ? { stroke: style.stroke, strokeWidth: style.strokeWidth }
              : {}),
            objectCaching: false,
          }),
        );
      }
      offset += box.kernedWidth;
    }
    lineTop += text.getHeightOfLine(lineIndex);
  }

  if (paths.length === 0) {
    return { kind: "refused", reason: uiCopy.outline.empty };
  }

  const name = objectName(object);
  const id = object.get("id");
  const group = new Group(paths, {
    ...(typeof id === "string" ? { id } : {}),
    ...(name === undefined ? {} : { [YUNARI_NAME_PROPERTY]: name }),
    opacity: object.opacity,
    visible: object.visible,
  });
  return { kind: "outlined", group };
}
