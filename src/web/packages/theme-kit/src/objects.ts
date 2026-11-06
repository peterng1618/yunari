import {
  artboardGradientLine,
  artboardSolidColor,
  type FabricPalette,
  isArtboardGradient,
} from "@yunari/renderer-core";
import {
  charSpacingPx,
  STARTER_LINE_HEIGHT,
  type StarterTypeRole,
  starterPalette,
  starterRoleForSize,
  starterTypeTokens,
} from "./globals.js";
import type { PathCommand } from "./icons.js";

/**
 * The palette a scene primitive resolves its paints against.
 *
 * The starter palette is the default so existing callers keep their signatures;
 * a draft passes its own palette, which is what lets a token declared with
 * `set_palette` paint an object.
 */
type Palette = FabricPalette;

/**
 * Resolve one palette token to the paint Fabric persists.
 *
 * A token is not always a solid colour: `storageFill`, `sparkArea` and
 * `frostArea` are gradients, and writing `null` beside a gradient reference
 * would leave the persisted Fabric field disagreeing with the reference the
 * renderer reads. The box is passed because a gradient's line is measured in
 * the object's own pixels.
 *
 * The gradient is written as the JSON Fabric's `Gradient.toObject()` persists,
 * built from renderer-core's pure geometry. Constructing a live `Gradient`
 * here would put Fabric in this Node-only package and in the MCP bundle.
 */
export function paintOfToken(
  token: string,
  width: number,
  height: number,
  palette: Palette,
): unknown {
  const value = palette[token]?.value;
  const solid = artboardSolidColor(value);
  if (solid !== undefined) return solid;
  if (!isArtboardGradient(value)) {
    throw new Error(`"${token}" is not a paint this build can resolve.`);
  }
  return {
    type: "linear",
    coords: artboardGradientLine(value, width, height),
    colorStops: value.stops.map((stop) => ({
      offset: stop.offset,
      color: stop.color,
    })),
    offsetX: 0,
    offsetY: 0,
    gradientUnits: "pixels",
  };
}

/**
 * The scene primitives the starter's cards are written in.
 *
 * Every colour is named by its palette token, never by a hex literal at the call
 * site: the reference is what the validator checks, the resolved colour is what
 * Fabric draws, and one token owns both.
 */

export type ObjectJson = Readonly<Record<string, unknown>>;

// Authored positions are artboard top-left coordinates, never Fabric's centred defaults.
const positioned = { originX: "left", originY: "top" } as const;

/** One run's palette token and size; the type token defaults from its size. */
export interface Run {
  readonly kind: "literal" | "value";
  /** The binding this run reads; literal runs have none. */
  readonly bindingId?: string;
  readonly text?: string;
  readonly token: string;
  readonly size: number;
  /** The role token this run names; sized inference is only the fallback. */
  readonly typeToken?: StarterTypeRole;
  /**
   * The run's own tracking, in px. Decorative spacing belongs to the label that
   * asked for it, so an arbitrary text at a starter label's size stays untracked.
   */
  readonly letterSpacing?: number;
  readonly precision?: number;
  /** `"none"` when a later literal run writes the unit instead. */
  readonly unitDisplay?: "none" | "short" | "long";
}

/** The type token a run names, or the starter role its size belonged to. */
function roleOf(run: Run): StarterTypeRole {
  return run.typeToken ?? starterRoleForSize(run.size);
}

/**
 * How a run is worn: size, leading and its own measured tracking, authored on
 * the run rather than on the token it names.
 */
function runStyle(run: Run): Record<string, unknown> {
  const letterSpacing = run.letterSpacing;
  return {
    color: { ref: `palette.${run.token}` },
    fontSize: { value: run.size },
    lineHeight: { value: STARTER_LINE_HEIGHT },
    ...(letterSpacing === undefined
      ? {}
      : { letterSpacing: { value: letterSpacing } }),
  };
}

/**
 * A text object built from its runs.
 *
 * The first run carries the object's own resolved Fabric fields, because that
 * is the run whose preset Fabric measures: the same rule
 * `applyObjectTypeTokens` follows, and the reason a mixed-size label still
 * opens at the right size.
 *
 * `left`, `top`, `width` and `height` are the author's box, not a measurement:
 * a value run is a different length every frame, and a box that followed it
 * would move everything beside it. Each height is the single line Fabric
 * measures for that object's own type, so the fixed box holds exactly the text
 * the reference shows.
 */
export function text(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
  runs: readonly Run[],
  options?: {
    readonly align?: "left" | "center" | "right";
    readonly verticalAlign?: "top" | "middle" | "bottom";
    readonly overflow?: "clip" | "ellipsis" | "visible";
  },
  palette: Palette = starterPalette,
): ObjectJson {
  const first = runs[0] as Run;
  const firstToken = starterTypeTokens[roleOf(first)];
  const spacing = charSpacingPx(first.letterSpacing, first.size);
  // A reading that outgrows its box is truncated rather than clipped to
  // nothing, so an author can see that it did not fit. A prose label has no
  // reading to truncate and keeps the default clip.
  const overflow =
    options?.overflow ??
    (runs.some((run) => run.kind === "value") ? "ellipsis" : undefined);
  return {
    type: "Textbox",
    id,
    name: id,
    left,
    top,
    width,
    text: plain(runs),
    fontFamily: firstToken.family,
    fontSize: first.size,
    // Alignment lives in the authored content and is written to Fabric on every
    // live refresh, which leaves the *first* paint of a revived document showing
    // the text from the box's left edge. Writing it here as well makes the
    // document correct before the first sample ever arrives.
    ...(options?.align === undefined ? {} : { textAlign: options.align }),
    fontWeight: firstToken.weight,
    fill: paintOfToken(first.token, width, height, palette),
    lineHeight: STARTER_LINE_HEIGHT,
    ...(spacing === undefined ? {} : { charSpacing: spacing }),
    yunariPaint: { fill: `palette.${first.token}` },
    yunariText: {
      // The Fabric `type` is `Textbox`, and the class is the whole width mode:
      // its width is the authored box, its height the authored box height, and
      // `updateText` restores that width on every refresh. That is the
      // difference between a centred reading landing in its card and rendering
      // flush-left and overflowing out of it.
      // The author's box, and the copy that survives a save.
      box: { width, height },
      ...(options?.align === undefined ? {} : { align: options.align }),
      ...(options?.verticalAlign === undefined
        ? {}
        : { verticalAlign: options.verticalAlign }),
      // A reading that outgrows its box is truncated, not clipped to nothing:
      // an author has to be able to see that it did not fit. A prose label has
      // no reading to truncate and keeps the default clip.
      ...(overflow === undefined ? {} : { overflow }),
      runs: runs.map((run) =>
        run.kind === "literal"
          ? {
              kind: "literal",
              text: run.text ?? "",
              typeToken: `typeTokens.${roleOf(run)}`,
              style: runStyle(run),
            }
          : {
              kind: "value",
              bindingId: run.bindingId ?? "",
              ...(run.precision === undefined
                ? {}
                : { precision: run.precision }),
              ...(run.unitDisplay === undefined
                ? {}
                : { unitDisplay: run.unitDisplay }),
              typeToken: `typeTokens.${roleOf(run)}`,
              style: runStyle(run),
            },
      ),
    },
    ...positioned,
  };
}

/**
 * The Fabric `text` field's own copy, so a document reads before its first
 * sample. A value run previews as the em dash the renderer substitutes for a
 * reading it does not have — the same marker, so the authored text and the
 * first live text agree rather than the card starting blank.
 */
function plain(runs: readonly Run[]): string {
  return runs
    .map((run) => (run.kind === "literal" ? (run.text ?? "") : "—"))
    .join("");
}

export function label(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
  value: string,
  size: number,
  token: string,
  palette: Palette = starterPalette,
  run?: {
    readonly letterSpacing?: number;
    readonly typeToken?: StarterTypeRole;
  },
): ObjectJson {
  return text(
    id,
    left,
    top,
    width,
    height,
    [
      {
        kind: "literal",
        text: value,
        token,
        size,
        ...(run?.letterSpacing === undefined
          ? {}
          : { letterSpacing: run.letterSpacing }),
        ...(run?.typeToken === undefined ? {} : { typeToken: run.typeToken }),
      },
    ],
    undefined,
    palette,
  );
}

/** A label whose whole text is one reading. */
export function valueLabel(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
  size: number,
  token: string,
  bindingId: string,
  palette: Palette = starterPalette,
): ObjectJson {
  return text(
    id,
    left,
    top,
    width,
    height,
    [{ kind: "value", bindingId, token, size }],
    undefined,
    palette,
  );
}

export function path(
  id: string,
  left: number,
  top: number,
  points: readonly PathCommand[],
  token: string,
  strokeWidth: number,
  palette: Palette = starterPalette,
): ObjectJson {
  return {
    type: "Path",
    id,
    name: id,
    left,
    top,
    path: points,
    fill: null,
    stroke: paintOfToken(token, 1, 1, palette),
    strokeWidth,
    strokeLineCap: "round",
    strokeLineJoin: "round",
    yunariPaint: { stroke: `palette.${token}` },
    ...positioned,
  };
}

export function chart(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
  family: string,
  settings: unknown,
): ObjectJson {
  return {
    type: "YunariChart",
    id,
    name: id,
    left,
    top,
    width,
    height,
    family,
    settings,
    // Every compose tool places its box from the top-left; a chart is no
    // exception, so its `left`/`top` mean the same corner as a text or shape.
    ...positioned,
  };
}
