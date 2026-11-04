import {
  type AssetReference,
  BACKGROUND_EDGES,
  BACKGROUND_MEDIA_BOUNDS,
  BACKGROUND_MEDIA_DEFAULTS,
  BACKGROUND_MODES,
  type Background,
  type BackgroundBlend,
  type BackgroundEdge,
  type BackgroundMedia,
  type BackgroundMode,
  type BackgroundRegion,
  type FabricGlobals,
  type GlobalRef,
  MAX_BACKGROUND_OFFSET,
  MAX_BACKGROUND_SCALE,
  MIN_BACKGROUND_BLEND_LENGTH,
  MIN_BACKGROUND_OFFSET,
  MIN_BACKGROUND_SCALE,
  paletteTokenOptions,
} from "@yunari/renderer-core";
import { uiCopy } from "../ui-copy.js";
import { resolveToken } from "./appearance.js";
import { sectionView } from "./per-kind-column.js";
import type {
  ColumnSectionView,
  FieldOption,
  FieldView,
  PairHalfView,
} from "./view.js";

/** The area a first region keeps, and the span its size slider offers. The
 *  stored fraction is the area, not the inset: 0.35 leaves a third of the box. */
const MIN_INSET_AMOUNT = 0.1;
const MAX_INSET_AMOUNT = 0.9;
const DEFAULT_INSET_AMOUNT = 0.5;
/** A first fade's length, and the longest one the editor offers. The model's
 *  floor is 0.01, but a fade over half the box is a wash rather than a ramp. */
const DEFAULT_BLEND_LENGTH = 0.1;
const MAX_BLEND_LENGTH = 0.5;

type RegionMode = "full" | "left" | "right" | "top" | "bottom" | "inset";

/**
 * The background's column, as values.
 *
 * The background is a selected subject that is no Fabric object, so it never
 * reaches `perKindColumn`: it answers the same two questions — what it shows,
 * and where its picture sits — and its sections cross the boundary as the same
 * `ColumnSectionView`s, so the column renders them unchanged. Lock is not a
 * question here: the background carries no lock to withhold the rows for.
 */

/** The palette reference the stored colour carries, or `""`. A literal is not a
    token this control offers, so it reads as no colour at all. */
function colourRef(background: Background | undefined): string {
  const colour = background?.color;
  return colour !== undefined &&
    "ref" in colour &&
    colour.ref.startsWith("palette.")
    ? colour.ref
    : "";
}

/** The model the background is authored under. Basic is the full-cover media
 *  every theme predates composition; advanced is the opt-in that unlocks the
 *  fill and the media's region. */
function modeField(background: Background | undefined): FieldView {
  return {
    id: "background.mode",
    control: "segmented",
    label: uiCopy.panels.backgroundMode,
    value: background?.mode ?? "basic",
    options: BACKGROUND_MODES.map((mode) => ({
      id: mode,
      name: uiCopy.backgroundModes[mode],
    })),
    data: { "data-yunari-background-mode": "" },
  };
}

function colourField(
  background: Background | undefined,
  globals: FabricGlobals | undefined,
): FieldView {
  const ref = colourRef(background);
  return {
    id: "background.color",
    control: "swatch",
    label: uiCopy.panels.background,
    value: ref,
    options: [
      { id: "", name: uiCopy.inspectorFields.notSet },
      ...paletteTokenOptions(globals?.palette),
    ],
    // The picture is the resolved token, never a second resolver: `resolveToken`
    // is the palette's own answer, and a blank reads as nothing painted.
    colour: resolveToken(globals, ref) ?? "transparent",
    data: { "data-yunari-background": "" },
  };
}

/** The declared pictures a background can be, plus the blank reading that
    removes the media. A font is not a picture. */
function mediaOptions(
  assets: readonly AssetReference[],
): readonly FieldOption[] {
  return [
    { id: "", name: uiCopy.panels.none },
    ...assets
      .filter(
        (asset) =>
          asset.kind === "image" ||
          asset.kind === "svg" ||
          asset.kind === "video",
      )
      .map((asset) => ({ id: asset.id, name: asset.id })),
  ];
}

function mediaField(
  media: BackgroundMedia | undefined,
  assets: readonly AssetReference[],
): FieldView {
  return {
    id: "background.media",
    control: "select",
    label: uiCopy.panels.backgroundMedia,
    value: media?.assetId ?? "",
    options: mediaOptions(assets),
    data: { "data-yunari-background-asset": "" },
  };
}

/** The box the media is clipped to; a background with no media reads the model's
    default box so the row still says what a first picture would fill. */
function boundsField(media: BackgroundMedia | undefined): FieldView {
  return {
    id: "background.bounds",
    control: "select",
    label: uiCopy.panels.backgroundBounds,
    value: media?.bounds ?? "theme",
    options: BACKGROUND_MEDIA_BOUNDS.map((bounds) => ({
      id: bounds,
      name: uiCopy.backgroundBounds[bounds],
    })),
    data: { "data-yunari-background-bounds": "" },
  };
}

/** The scale and fit are gone: the media always covers, its zoom is the one
    scalar the author sets, and the only other geometry is a translation plus
    the two paint-time mirrors. */
function flipField(
  media: BackgroundMedia | undefined,
  axis: "flipX" | "flipY",
): FieldView {
  return axis === "flipX"
    ? {
        id: "background.flipX",
        control: "toggle",
        label: uiCopy.panels.backgroundFlipX,
        checked: media?.flipX === true,
        data: { "data-yunari-background-flip-x": "" },
      }
    : {
        id: "background.flipY",
        control: "toggle",
        label: uiCopy.panels.backgroundFlipY,
        checked: media?.flipY === true,
        data: { "data-yunari-background-flip-y": "" },
      };
}

/** The zoom over the cover fit, shown as 100–500%. The stored value is the
    fraction the renderer multiplies by, and the slider is the bound the author
    cannot cross: the track's own range is the model's range. */
function scaleField(media: BackgroundMedia | undefined): FieldView {
  return {
    id: "background.scale",
    control: "slider",
    label: uiCopy.panels.backgroundScale,
    value: media?.scale ?? BACKGROUND_MEDIA_DEFAULTS.scale,
    min: MIN_BACKGROUND_SCALE,
    max: MAX_BACKGROUND_SCALE,
    percent: true,
    data: { "data-yunari-background-scale": "" },
  };
}

/** Both offsets on one line. The halves carry no bounds — a half has none — so
    the range refusal stays at the write boundary. */
function offsetField(media: BackgroundMedia | undefined): FieldView {
  const halves: readonly PairHalfView[] = [
    {
      id: "background.offsetX",
      label: uiCopy.inspectorFields.x,
      value: media?.offsetX ?? BACKGROUND_MEDIA_DEFAULTS.offsetX,
      percent: true,
      data: { "data-yunari-background-offset-x": "" },
    },
    {
      id: "background.offsetY",
      label: uiCopy.inspectorFields.y,
      value: media?.offsetY ?? BACKGROUND_MEDIA_DEFAULTS.offsetY,
      percent: true,
      data: { "data-yunari-background-offset-y": "" },
    },
  ];
  return {
    id: "background.offsetX-offsetY",
    control: "pair",
    label: uiCopy.panels.backgroundOffset,
    halves,
    data: {},
  };
}

/** The frame a video stands on when motion is unavailable, and the still the
    glass material samples. Only a video has frames, so the row exists only for
    one. */
function fallbackFrameField(media: BackgroundMedia | undefined): FieldView {
  return {
    id: "background.fallbackFrame",
    control: "number",
    label: uiCopy.panels.backgroundFallbackFrame,
    value: media?.fallbackFrame ?? 0,
    min: 0,
    integer: true,
    data: { "data-yunari-background-fallback-frame": "" },
  };
}

/** The kind of the selected media, which decides whether a frame row exists. */
function mediaKind(
  media: BackgroundMedia | undefined,
  assets: readonly AssetReference[],
): string | undefined {
  return assets.find((asset) => asset.id === media?.assetId)?.kind;
}

/**
 * What the region control reads: the edge the media is pinned to (or `full`),
 * and the area that edge leaves.
 *
 * The mode and the size are projections of one stored region rather than two
 * fields, so switching edges keeps the size the author already set. A region
 * authored elsewhere may inset several sides unequally; the first edge with an
 * inset is the one the control shows, which is the one a further edit keeps.
 */
function regionReading(region: BackgroundRegion | undefined): {
  readonly mode: RegionMode;
  readonly amount: number;
} {
  const insets = {
    left: region?.left ?? 0,
    right: region?.right ?? 0,
    top: region?.top ?? 0,
    bottom: region?.bottom ?? 0,
  };
  const edged = BACKGROUND_EDGES.filter((edge) => insets[edge] > 0);
  if (edged.length === 0) {
    return { mode: "full", amount: DEFAULT_INSET_AMOUNT };
  }
  if (
    edged.length === BACKGROUND_EDGES.length &&
    insets.left === insets.right &&
    insets.left === insets.top &&
    insets.left === insets.bottom
  ) {
    // Both sides of each axis carry the same inset, so the size is what two of
    // them leave rather than one.
    return { mode: "inset", amount: 1 - 2 * insets.left };
  }
  const edge = edged[0] as BackgroundEdge;
  return { mode: edge, amount: 1 - insets[edge] };
}

/** The region a mode and an area store, with the blend that sits inside it. */
function regionOf(
  mode: RegionMode,
  amount: number,
  blend: BackgroundBlend | undefined,
): BackgroundRegion | undefined {
  if (mode === "full") return blend === undefined ? undefined : { blend };
  const inset = mode === "inset" ? (1 - amount) / 2 : 1 - amount;
  const region =
    mode === "inset"
      ? { left: inset, right: inset, top: inset, bottom: inset }
      : { [mode]: inset };
  return blend === undefined ? region : { ...region, blend };
}

/** The media's region with one key replaced, or dropped when it would be empty. */
function replaceRegion(
  media: BackgroundMedia,
  region: BackgroundRegion | undefined,
): BackgroundMedia {
  if (region === undefined) {
    const { region: _region, ...without } = media;
    return without;
  }
  return { ...media, region };
}

/** Which of the three fade shapes the control shows. */
function blendEdgeReading(blend: BackgroundBlend | undefined): string {
  if (blend === undefined) return "none";
  return blend.shape === "radial" ? "all" : blend.edge;
}

function fillField(
  background: Background | undefined,
  globals: FabricGlobals | undefined,
): FieldView {
  const fill = background?.fill;
  const ref =
    fill !== undefined && "ref" in fill && fill.ref.startsWith("palette.")
      ? fill.ref
      : "";
  return {
    id: "background.fill",
    control: "swatch",
    label: uiCopy.panels.backgroundFill,
    value: ref,
    options: [
      { id: "", name: uiCopy.inspectorFields.notSet },
      ...paletteTokenOptions(globals?.palette),
    ],
    colour: resolveToken(globals, ref) ?? "transparent",
    data: { "data-yunari-background-fill": "" },
  };
}

/** The region and fade rows. They describe where a picture sits inside its box,
    so they exist only with a picture. */
function compositionFields(media: BackgroundMedia): readonly FieldView[] {
  const reading = regionReading(media.region);
  const blend = media.region?.blend;
  return [
    {
      id: "background.inset",
      control: "select",
      label: uiCopy.panels.backgroundInset,
      value: reading.mode,
      options: (
        ["full", "left", "right", "top", "bottom", "inset"] as const
      ).map((mode) => ({
        id: mode,
        name: uiCopy.backgroundInsetModes[mode],
      })),
      data: { "data-yunari-background-inset": "" },
    },
    {
      id: "background.insetAmount",
      control: "slider",
      label: uiCopy.panels.backgroundInsetAmount,
      value: reading.amount,
      min: MIN_INSET_AMOUNT,
      max: MAX_INSET_AMOUNT,
      percent: true,
      data: { "data-yunari-background-inset-amount": "" },
    },
    {
      id: "background.blendEdges",
      control: "select",
      label: uiCopy.panels.backgroundBlendEdges,
      value: blendEdgeReading(blend),
      options: (["none", "left", "right", "top", "bottom", "all"] as const).map(
        (edge) => ({
          id: edge,
          name: uiCopy.backgroundBlendEdges[edge],
        }),
      ),
      data: { "data-yunari-background-blend-edges": "" },
    },
    {
      id: "background.blendLength",
      control: "slider",
      label: uiCopy.panels.backgroundBlendLength,
      value: blend?.length ?? DEFAULT_BLEND_LENGTH,
      min: MIN_BACKGROUND_BLEND_LENGTH,
      max: MAX_BLEND_LENGTH,
      percent: true,
      data: { "data-yunari-background-blend-length": "" },
    },
    {
      id: "background.blendShape",
      control: "segmented",
      label: uiCopy.panels.backgroundBlendShape,
      value: blend?.shape ?? "linear",
      options: (["linear", "radial"] as const).map((shape) => ({
        id: shape,
        name: uiCopy.backgroundBlendShapes[shape],
      })),
      data: { "data-yunari-background-blend-shape": "" },
    },
  ];
}

export function backgroundColumn(input: {
  readonly background: Background | undefined;
  readonly assets: readonly AssetReference[];
  readonly globals: FabricGlobals | undefined;
}): readonly ColumnSectionView[] {
  const media = input.background?.media;
  const advanced = input.background?.mode === "advanced";
  return [
    sectionView("content", [
      modeField(input.background),
      colourField(input.background, input.globals),
      // The fill is the paint behind the media, so it waits for one: with no
      // media it would be stored and never paint.
      ...(advanced && media !== undefined
        ? [fillField(input.background, input.globals)]
        : []),
      mediaField(media, input.assets),
      ...(mediaKind(media, input.assets) === "video"
        ? [fallbackFrameField(media)]
        : []),
    ]),
    // A position with no picture to place has nothing to describe, and the
    // write below refuses it anyway: the section appears with the media rather
    // than offering controls whose first use is an error (`vg-703`).
    ...(media === undefined
      ? []
      : [
          sectionView("position", [
            boundsField(media),
            scaleField(media),
            offsetField(media),
            flipField(media, "flipX"),
            flipField(media, "flipY"),
          ]),
          // The region and fade describe how the media composes with the fill,
          // which only an advanced background has.
          ...(advanced
            ? [sectionView("composition", compositionFields(media))]
            : []),
        ]),
  ];
}

/**
 * One background field, written as a whole new `Background`.
 *
 * The layer has one owner — the document's envelope — so a field is not a
 * property write but a replacement of the value the document stores. The file
 * that projects a field knows how its value is stored, so the rule lives beside
 * it; `index.ts` routes the id and hands the result to the document.
 *
 * `undefined` is a value the model would refuse: the paired offsets carry no
 * bounds in the view, and a media field has no media to write without a picture.
 */
export function writeBackgroundField(
  background: Background | undefined,
  fieldId: string,
  value: string | number | boolean,
  assets: readonly AssetReference[] = [],
): Background | undefined {
  const current = background ?? {};
  const media = current.media;
  const advanced = current.mode === "advanced";

  switch (fieldId) {
    case "background.mode": {
      const mode = BACKGROUND_MODES.find((candidate) => candidate === value);
      if (mode === undefined) return undefined;
      if (mode === "advanced") {
        return { ...current, mode: "advanced" as BackgroundMode };
      }
      // Basic has no fill and no region, so returning to it drops the keys it
      // cannot express rather than leaving a document that fails its own
      // validator. The media's own geometry stays.
      const { mode: _mode, fill: _fill, ...basic } = current;
      if (basic.media === undefined) return basic;
      const { region: _region, ...plainMedia } = basic.media;
      return { ...basic, media: plainMedia };
    }
    case "background.color": {
      if (typeof value !== "string") return undefined;
      if (value === "") {
        // Omit rather than store undefined, for `exactOptionalPropertyTypes`.
        const { color: _color, ...withoutColor } = current;
        return withoutColor;
      }
      if (!value.startsWith("palette.")) return undefined;
      return { ...current, color: { ref: value as GlobalRef } };
    }
    case "background.media": {
      if (typeof value !== "string") return undefined;
      if (value === "") {
        // The fill sits behind the media, so clearing the media clears it too
        // rather than leaving a document its own validator refuses.
        const { media: _media, fill: _fill, ...withoutMedia } = current;
        return withoutMedia;
      }
      // A new picture keeps the box and transform the author set for the last
      // one: changing which picture is shown is not a reset of how. Its frame
      // is the one exception — only a video has frames.
      const carried: BackgroundMedia = media ?? {
        assetId: value,
        bounds: "theme",
      };
      const { fallbackFrame: _frame, ...withoutFrame } = carried;
      const nextKind = assets.find((asset) => asset.id === value)?.kind;
      return {
        ...current,
        media: {
          ...(nextKind === "video" ? carried : withoutFrame),
          assetId: value,
        },
      };
    }
    case "background.fill": {
      if (typeof value !== "string") return undefined;
      if (value === "") {
        const { fill: _fill, ...withoutFill } = current;
        return withoutFill;
      }
      // A fill is composition, so a basic background refuses it at the write
      // boundary even though the row is not drawn.
      if (!advanced) return undefined;
      if (!value.startsWith("palette.")) return undefined;
      return { ...current, fill: { ref: value as GlobalRef } };
    }
    case "background.bounds": {
      if (media === undefined || typeof value !== "string") return undefined;
      const bounds = BACKGROUND_MEDIA_BOUNDS.find((mode) => mode === value);
      if (bounds === undefined) return undefined;
      return { ...current, media: { ...media, bounds } };
    }
    case "background.inset": {
      if (media === undefined || typeof value !== "string") return undefined;
      if (!advanced) return undefined;
      const mode = (
        ["full", "left", "right", "top", "bottom", "inset"] as const
      ).find((candidate) => candidate === value);
      if (mode === undefined) return undefined;
      // The stored region is the only record of the area's size, so a mode
      // change reads it rather than resetting to the default.
      const { amount } = regionReading(media.region);
      return {
        ...current,
        media: replaceRegion(
          media,
          regionOf(mode, amount, media.region?.blend),
        ),
      };
    }
    case "background.insetAmount": {
      if (
        media === undefined ||
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < MIN_INSET_AMOUNT ||
        value > MAX_INSET_AMOUNT
      )
        return undefined;
      if (!advanced) return undefined;
      // A size with no edge yet becomes the all-sides inset: moving the slider
      // is what first gives the picture a smaller area.
      const { mode } = regionReading(media.region);
      return {
        ...current,
        media: replaceRegion(
          media,
          regionOf(
            mode === "full" ? "inset" : mode,
            value,
            media.region?.blend,
          ),
        ),
      };
    }
    case "background.blendEdges": {
      if (media === undefined || typeof value !== "string") return undefined;
      if (!advanced) return undefined;
      const region = media.region ?? {};
      const { blend: _blend, ...unblended } = region;
      if (value === "none") {
        return {
          ...current,
          media: replaceRegion(
            media,
            Object.keys(unblended).length === 0 ? undefined : unblended,
          ),
        };
      }
      const length = region.blend?.length ?? DEFAULT_BLEND_LENGTH;
      if (value === "all") {
        return {
          ...current,
          media: {
            ...media,
            region: { ...unblended, blend: { shape: "radial", length } },
          },
        };
      }
      const edge = BACKGROUND_EDGES.find((candidate) => candidate === value);
      if (edge === undefined) return undefined;
      return {
        ...current,
        media: {
          ...media,
          region: { ...unblended, blend: { shape: "linear", edge, length } },
        },
      };
    }
    case "background.blendLength": {
      if (
        media === undefined ||
        media.region?.blend === undefined ||
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < MIN_BACKGROUND_BLEND_LENGTH ||
        value > MAX_BLEND_LENGTH
      )
        return undefined;
      if (!advanced) return undefined;
      return {
        ...current,
        media: {
          ...media,
          region: {
            ...media.region,
            blend: { ...media.region.blend, length: value },
          },
        },
      };
    }
    case "background.blendShape": {
      if (
        media === undefined ||
        media.region?.blend === undefined ||
        (value !== "linear" && value !== "radial")
      )
        return undefined;
      if (!advanced) return undefined;
      const blend = media.region.blend;
      // The two shapes do not carry the same keys: a radial ramp has no edge,
      // and returning to linear needs one, so the left edge stands in.
      const next: BackgroundBlend =
        value === "radial"
          ? { shape: "radial", length: blend.length }
          : {
              shape: "linear",
              edge: blend.shape === "linear" ? blend.edge : "left",
              length: blend.length,
            };
      return {
        ...current,
        media: { ...media, region: { ...media.region, blend: next } },
      };
    }
    case "background.flipX":
    case "background.flipY": {
      if (media === undefined || typeof value !== "boolean") return undefined;
      const axis = fieldId === "background.flipX" ? "flipX" : "flipY";
      if (value) return { ...current, media: { ...media, [axis]: true } };
      // `false` is the default, so it is stored by omission rather than as a
      // key a later read would have to interpret.
      const { [axis]: _off, ...without } = media;
      return { ...current, media: without };
    }
    case "background.fallbackFrame": {
      if (
        media === undefined ||
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < 0
      )
        return undefined;
      return { ...current, media: { ...media, fallbackFrame: value } };
    }
    case "background.scale": {
      if (
        media === undefined ||
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < MIN_BACKGROUND_SCALE ||
        value > MAX_BACKGROUND_SCALE
      )
        return undefined;
      // 100% is the default cover, so it is stored by omission rather than as a
      // key a later read would have to interpret.
      if (value === BACKGROUND_MEDIA_DEFAULTS.scale) {
        const { scale: _scale, ...without } = media;
        return { ...current, media: without };
      }
      return { ...current, media: { ...media, scale: value } };
    }
    case "background.offsetX": {
      if (
        media === undefined ||
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < MIN_BACKGROUND_OFFSET ||
        value > MAX_BACKGROUND_OFFSET
      )
        return undefined;
      return { ...current, media: { ...media, offsetX: value } };
    }
    case "background.offsetY": {
      if (
        media === undefined ||
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < MIN_BACKGROUND_OFFSET ||
        value > MAX_BACKGROUND_OFFSET
      )
        return undefined;
      return { ...current, media: { ...media, offsetY: value } };
    }
    default:
      return undefined;
  }
}
