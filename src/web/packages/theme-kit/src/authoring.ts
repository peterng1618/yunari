import {
  type AssetKind,
  type Binding,
  defaultBarSettings,
  defaultGaugeSettings,
  defaultLineSettings,
  type FabricPalette,
} from "@yunari/renderer-core";
import { starterPalette } from "./globals.js";
import { type PathCommand, starterIcons } from "./icons.js";
import {
  chart,
  label,
  type ObjectJson,
  paintOfToken,
  path,
  type Run,
  text,
} from "./objects.js";
import {
  contentPaletteToken,
  SURFACE_TOKENS,
  surfacePaletteToken,
} from "./palette-role.js";

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

/**
 * The Fabric paint a palette token resolves to at the box it will fill.
 *
 * The box is passed because a gradient's line is measured in the object's own
 * pixels. One resolver serves both this module and the scene primitives, so the
 * gradient serialisation rule lives in one place.
 */
function paintOf(
  token: string,
  width: number,
  height: number,
  palette: FabricPalette = starterPalette,
): unknown {
  return paintOfToken(token, width, height, palette);
}

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
  /** The theme palette runs resolve their tokens against. */
  readonly palette?: FabricPalette;
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
    input.palette,
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
  readonly token?: string;
  readonly radius?: number;
  /** Required for a path, ignored by the other kinds. */
  readonly points?: readonly PathCommand[];
  readonly strokeWidth?: number;
  /** The theme palette shapes resolve their tokens against. */
  readonly palette?: FabricPalette;
}

export function addShapeObject(input: AddShapeObjectInput): ObjectJson {
  if (input.kind === "path") {
    if (input.points === undefined) {
      throw new Error(`The path "${input.id}" needs its own commands.`);
    }
    const token = input.token ?? "rule";
    return {
      ...path(
        input.id,
        input.left,
        input.top,
        input.points,
        token,
        input.strokeWidth ?? 2,
        input.palette,
      ),
      stroke: paintOf(token, input.width, input.height, input.palette),
    };
  }
  const token = input.token ?? "panel";
  const fill = paintOf(token, input.width, input.height, input.palette);
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
  readonly token?: string;
  /** The theme palette the icon resolves its token against. */
  readonly palette?: FabricPalette;
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
    fill: paintOf(token, input.size, input.size, input.palette),
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
  /** Family settings; palette-backed defaults when omitted. */
  readonly settings?: unknown;
  readonly bindings: readonly Binding[];
  /** The theme palette a default chart resolves its paint against. */
  readonly palette?: FabricPalette;
}

/**
 * A new chart's settings, painted with the theme's own tokens.
 *
 * The renderer's defaults carry literal hex colours, and the envelope validator
 * refuses a persisted chart paint that is not a palette reference. A caller who
 * composes a chart and validates must not inherit that refusal, so the default
 * is built from the document's palette the same way the editor's new-chart
 * defaults are.
 */
function defaultChartSettings(
  family: AuthoringChartFamily,
  palette: FabricPalette = starterPalette,
): unknown {
  const ink = contentPaletteToken(palette)?.[0];
  const surface = surfacePaletteToken(palette, SURFACE_TOKENS)?.[0];
  if (ink === undefined || surface === undefined) {
    throw new Error(
      "A chart needs a palette token to paint its value and its track.",
    );
  }
  const inkRef = { ref: `palette.${ink}` } as const;
  const surfaceRef = { ref: `palette.${surface}` } as const;
  if (family === "line") {
    const { area: _area, ...settings } = defaultLineSettings;
    return { ...settings, stroke: inkRef, palette: [inkRef] };
  }
  if (family === "bar") {
    return { ...defaultBarSettings, fill: inkRef, track: surfaceRef };
  }
  return { ...defaultGaugeSettings, track: surfaceRef, progress: inkRef };
}

export function addChartObject(input: AddChartObjectInput): {
  readonly object: ObjectJson;
  readonly bindings: readonly Binding[];
} {
  const settings =
    input.settings ?? defaultChartSettings(input.family, input.palette);
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
  readonly token?: string;
  /** The theme palette the label resolves its token against. */
  readonly palette?: FabricPalette;
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
    input.palette,
  );
}
