import type { WidgetProvenance } from "@yunari/renderer-core";
import {
  charSpacingPx,
  frost,
  type StarterPaletteId,
  solidOf,
} from "./new-fabric-theme-globals.js";
import type { PathCommand } from "./new-fabric-theme-icons.js";

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
function rect(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
  fill: unknown,
  radius: number,
  interaction: ObjectJson = positioned,
  token?: StarterPaletteId,
): ObjectJson {
  return {
    type: "Rect",
    id,
    // The id is already a readable label and the layer list falls back to it,
    // so promoting it here is what turns the fallback into authored state.
    name: id,
    left,
    top,
    width,
    height,
    fill,
    rx: radius,
    ry: radius,
    yunariPaint: { fill: `palette.${token ?? "panel"}` },
    ...interaction,
  };
}

/**
 * The card, and the only place that says a panel is made of glass.
 *
 * The box and the outline are measured off the reference theme, not chosen: its
 * card border occupies two pixels and first appears ten pixels in from the
 * top-left corner on both axes. The outline token is already the right value —
 * a translucent cool line of that alpha composites to about the border the
 * reference shows.
 *
 * The fill is `frost` and the treatment is what makes the panel transmit what
 * is behind it, because at `panel`'s 85 % alpha a blur is a blur of nothing.
 * The authored radius is the one the theme's cards share, and it is inside both
 * the published bound of 48 and Task 1's measured-flat 0-64 px band.
 */
const FROST_RADIUS = 40;

export function frostedCard(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
): ObjectJson {
  return {
    ...rect(id, left, top, width, height, frost, 10),
    stroke: "#9fc7e52b",
    strokeWidth: 2,
    yunariPaint: { fill: "palette.frost", stroke: "palette.panelStroke" },
    yunariGlass: { blurRadius: FROST_RADIUS },
  };
}

/**
 * A card as one Fabric group: the frosted panel and the parts that sit on it.
 *
 * Fabric puts a child's `left`/`top` in its parent's plane and composes the
 * parent's transform on top (§57), so a part authored in artboard coordinates
 * has to be measured from the group's own centre before it goes in. Wrapping
 * without that step double-applies the group the first time the card moves,
 * and again the first time it is inserted from the card library — which is the
 * whole reason a card is a group rather than a naming convention.
 *
 * The panel's box is the group's box: the frosted rectangle *is* the card, and
 * reading it from there is what keeps the two from being stated twice and
 * drifting apart.
 *
 * The card's own identity is stamped on the group and nowhere else: the unit's
 * word arrives as a parameter so its one owner stays `uiCopy.cardLibrary`, and
 * `provenance` is the document's own authored key for it — the same pair a copy
 * carries (`card-library.ts` `instantiateCard`), written where the card's other
 * authored state is written.
 */
export function cardGroup(
  id: string,
  unit: string,
  panel: ObjectJson,
  parts: readonly ObjectJson[],
): ObjectJson {
  const left = authored(panel, "left");
  const top = authored(panel, "top");
  const width = authored(panel, "width");
  const height = authored(panel, "height");
  const centre = { x: left + width / 2, y: top + height / 2 };
  const provenance: WidgetProvenance = { widgetId: id, widgetName: unit };
  return {
    type: "Group",
    id,
    name: id,
    provenance,
    left,
    top,
    width,
    height,
    // The same top-left anchoring every other object here uses, so the group's
    // own `left`/`top` in the document are the card's measured corner.
    ...positioned,
    objects: [panel, ...parts].map((part) => toGroupPlane(part, centre)),
  };
}

/** One authored number, or a refusal: a card part with no box has no place. */
function authored(
  object: ObjectJson,
  key: "left" | "top" | "width" | "height",
): number {
  const value = object[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(
      `Card part "${String(object["id"])}" has no authored ${key}.`,
    );
  }
  return value;
}

/**
 * A part's position measured from the group's centre.
 *
 * The same subtraction for every part whatever its own `originX`/`originY`,
 * because Fabric resolves an origin against the box on both sides of the
 * move — the offset cancels and only the anchor point travels.
 */
function toGroupPlane(
  part: ObjectJson,
  centre: { readonly x: number; readonly y: number },
): ObjectJson {
  return {
    ...part,
    left: authored(part, "left") - centre.x,
    top: authored(part, "top") - centre.y,
  };
}

/** One run's palette token and type; the size and weight pick the preset. */
export interface Run {
  readonly kind: "literal" | "value";
  /** The binding this run reads; literal runs have none. */
  readonly bindingId?: string;
  readonly text?: string;
  readonly token: StarterPaletteId;
  readonly size: number;
  readonly weight: string;
  readonly precision?: number;
  /** `"none"` when a later literal run writes the unit instead. */
  readonly unitDisplay?: "none" | "short" | "long";
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
): ObjectJson {
  const first = runs[0] as Run;
  const presetId = `${first.size}-${first.weight}`;
  const spacing = charSpacingPx(presetId, first.size);
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
    fontFamily: "Segoe UI, sans-serif",
    fontSize: first.size,
    // Alignment lives in the authored content and is written to Fabric on every
    // live refresh, which leaves the *first* paint of a revived document showing
    // the text from the box's left edge. Writing it here as well makes the
    // document correct before the first sample ever arrives.
    ...(options?.align === undefined ? {} : { textAlign: options.align }),
    fontWeight: first.weight,
    fill: solidOf[first.token],
    lineHeight: 1.18,
    ...(spacing === undefined ? {} : { charSpacing: spacing }),
    yunariPaint: { fill: `palette.${first.token}` },
    yunariText: {
      // The Fabric `type` is `Textbox`, and the class is the whole width mode:
      // its width is the authored box, its height the authored box height, and
      // `updateText` restores that width on every refresh. That is the
      // difference between a centred reading landing in its card and rendering
      // flush-left and overflowing out of it.
      // The author's box, and the copy that survives a save. See
      // `docs/decisions/0003`.
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
              typeToken: `typeTokens.${run.size}-${run.weight}`,
              style: { color: { ref: `palette.${run.token}` } },
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
              typeToken: `typeTokens.${run.size}-${run.weight}`,
              style: { color: { ref: `palette.${run.token}` } },
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
  token: StarterPaletteId,
  weight = "400",
): ObjectJson {
  return text(id, left, top, width, height, [
    { kind: "literal", text: value, token, size, weight },
  ]);
}

/** A label whose whole text is one reading. */
export function valueLabel(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
  size: number,
  token: StarterPaletteId,
  weight: string,
  bindingId: string,
): ObjectJson {
  return text(id, left, top, width, height, [
    { kind: "value", bindingId, token, size, weight },
  ]);
}

export function path(
  id: string,
  left: number,
  top: number,
  points: readonly PathCommand[],
  token: StarterPaletteId,
  strokeWidth: number,
): ObjectJson {
  return {
    type: "Path",
    id,
    name: id,
    left,
    top,
    path: points,
    fill: null,
    stroke: solidOf[token],
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
    originX: "center",
    originY: "center",
  };
}
