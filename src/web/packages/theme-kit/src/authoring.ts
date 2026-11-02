import {
  type AssetKind,
  type Binding,
  defaultBarSettings,
  defaultGaugeSettings,
  defaultLineSettings,
} from "@yunari/renderer-core";
import { type StarterPaletteId, solidOf } from "./globals.js";
import { type PathCommand, starterIcons } from "./icons.js";
import {
  chart,
  label,
  type ObjectJson,
  path,
  type Run,
  text,
} from "./objects.js";

/**
 * The compose vocabulary an agent, or any non-canvas author, builds a theme
 * from.
 *
 * Every function composes the moved primitives in `objects.ts`; none of them
 * constructs a Fabric object. The result is the plain JSON the envelope
 * persists, so the same values a card is authored with are available to a
 * caller with no browser.
 */

const POSITIONED = { originX: "left", originY: "top" } as const;

/** A text box. Its runs decide its readings; bindings travel beside it. */
export interface AddTextObjectInput {
  readonly id: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly runs: readonly Run[];
  readonly align?: "left" | "center" | "right";
  readonly verticalAlign?: "top" | "middle" | "bottom";
  readonly overflow?: "clip" | "ellipsis" | "visible";
  /** The semantic readings the value runs name. */
  readonly bindings?: readonly Binding[];
}

export function addTextObject(input: AddTextObjectInput): {
  readonly object: ObjectJson;
  readonly bindings?: readonly Binding[];
} {
  const object = text(
    input.id,
    input.left,
    input.top,
    input.width,
    input.height,
    input.runs,
    {
      ...(input.align === undefined ? {} : { align: input.align }),
      ...(input.verticalAlign === undefined
        ? {}
        : { verticalAlign: input.verticalAlign }),
      ...(input.overflow === undefined ? {} : { overflow: input.overflow }),
    },
  );
  return {
    object,
    ...(input.bindings === undefined ? {} : { bindings: input.bindings }),
  };
}

export type ShapeObjectKind = "rect" | "ellipse" | "path";

/** A basic geometry. A path needs its own commands; the others fill their box. */
export interface AddShapeObjectInput {
  readonly id: string;
  readonly kind: ShapeObjectKind;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly token?: StarterPaletteId;
  readonly radius?: number;
  /** Required for a path, ignored by the other kinds. */
  readonly points?: readonly PathCommand[];
  readonly strokeWidth?: number;
}

export function addShapeObject(input: AddShapeObjectInput): ObjectJson {
  if (input.kind === "path") {
    if (input.points === undefined) {
      throw new Error(`The path "${input.id}" needs its own commands.`);
    }
    return path(
      input.id,
      input.left,
      input.top,
      input.points,
      input.token ?? "rule",
      input.strokeWidth ?? 2,
    );
  }
  const token = input.token ?? "panel";
  const fill = solidOf[token] ?? null;
  const common = {
    id: input.id,
    name: input.id,
    left: input.left,
    top: input.top,
    width: input.width,
    height: input.height,
    fill,
    yunariPaint: { fill: `palette.${token}` },
    ...POSITIONED,
  };
  if (input.kind === "rect") {
    return {
      type: "Rect",
      ...common,
      rx: input.radius ?? 0,
      ry: input.radius ?? 0,
    };
  }
  return {
    type: "Ellipse",
    ...common,
    rx: input.width / 2,
    ry: input.height / 2,
  };
}

/** A declared asset placed in the scene. */
export interface AddImageObjectInput {
  readonly id: string;
  readonly assetId: string;
  readonly kind: AssetKind;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly src?: string;
}

export function addImageObject(input: AddImageObjectInput): ObjectJson {
  return {
    type: "Image",
    id: input.id,
    name: input.id,
    left: input.left,
    top: input.top,
    width: input.width,
    height: input.height,
    ...(input.src === undefined ? {} : { src: input.src }),
    yunariAsset: { assetId: input.assetId, kind: input.kind },
    ...POSITIONED,
  };
}

/** One glyph from the starter set, as a filled path. */
export interface AddIconObjectInput {
  readonly id: string;
  readonly icon: keyof typeof starterIcons;
  readonly left: number;
  readonly top: number;
  readonly size: number;
  readonly token?: StarterPaletteId;
}

export function addIconObject(input: AddIconObjectInput): ObjectJson {
  const token = input.token ?? "text";
  return {
    type: "Path",
    id: input.id,
    name: input.id,
    left: input.left,
    top: input.top,
    path: starterIcons[input.icon](input.size),
    fill: solidOf[token] ?? null,
    stroke: null,
    yunariPaint: { fill: `palette.${token}` },
    ...POSITIONED,
  };
}

export type AuthoringChartFamily = "line" | "bar" | "gauge";

/** A chart and the semantic readings its series name. */
export interface AddChartObjectInput {
  readonly id: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly family: AuthoringChartFamily;
  /** Family settings; the renderer's defaults when omitted. */
  readonly settings?: unknown;
  readonly bindings: readonly Binding[];
}

export function addChartObject(input: AddChartObjectInput): {
  readonly object: ObjectJson;
  readonly bindings: readonly Binding[];
} {
  const settings =
    input.settings ??
    (input.family === "line"
      ? defaultLineSettings
      : input.family === "bar"
        ? defaultBarSettings
        : defaultGaugeSettings);
  return {
    object: chart(
      input.id,
      input.left,
      input.top,
      input.width,
      input.height,
      input.family,
      settings,
    ),
    bindings: input.bindings,
  };
}

/** A one-run literal text object, the simplest label an author can place. */
export function addLabelObject(input: {
  readonly id: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly text: string;
  readonly size: number;
  readonly token?: StarterPaletteId;
}): ObjectJson {
  return label(
    input.id,
    input.left,
    input.top,
    input.width,
    input.height,
    input.text,
    input.size,
    input.token ?? "text",
  );
}
