import {
  type AssetReference,
  BACKGROUND_ANCHORS,
  BACKGROUND_MEDIA_BOUNDS,
  BACKGROUND_MEDIA_DEFAULTS,
  BACKGROUND_MODES,
  type Background,
  type BackgroundAnchor,
  type BackgroundMedia,
  type BackgroundMediaComposition,
  DEFAULT_BACKGROUND_EXTENT,
  type FabricGlobals,
  type GlobalRef,
  MAX_BACKGROUND_EXTENT,
  MAX_BACKGROUND_FADE,
  MAX_BACKGROUND_OFFSET,
  MAX_BACKGROUND_SCALE,
  MIN_BACKGROUND_EXTENT,
  MIN_BACKGROUND_FADE,
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

/** The anchor control's reading: the stored point, or `full` for no
 *  composition at all (the picture covers the box). */
type AnchorMode = "full" | BackgroundAnchor;

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

/** The model the background is authored under. Simple is the full-cover media
 *  every theme predates composition; advanced is the opt-in that unlocks the
 *  media's anchor. */
function modeField(background: Background | undefined): FieldView {
  return {
    id: "background.mode",
    control: "segmented",
    label: uiCopy.panels.backgroundMode,
    value: background?.mode ?? "simple",
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
 * What the anchor control reads: the stored point, or `full` when the media
 * carries no composition and so covers the box.
 */
function anchorReading(
  composition: BackgroundMediaComposition | undefined,
): AnchorMode {
  return composition === undefined ? "full" : (composition.anchor ?? "center");
}

/** The media with its composition replaced, or dropped when it would be empty. */
function replaceComposition(
  media: BackgroundMedia,
  composition: BackgroundMediaComposition | undefined,
): BackgroundMedia {
  if (composition === undefined) {
    const { composition: _composition, ...without } = media;
    return without;
  }
  return { ...media, composition };
}

/** The anchor, size and fade rows. They describe where a picture sits inside
    its box and how it meets the background colour, so they exist only with a
    picture. */
function compositionFields(media: BackgroundMedia): readonly FieldView[] {
  const composition = media.composition;
  const anchor = anchorReading(composition);
  const edged =
    anchor === "left" ||
    anchor === "right" ||
    anchor === "top" ||
    anchor === "bottom";
  return [
    {
      id: "background.anchor",
      control: "select",
      label: uiCopy.panels.backgroundAnchor,
      value: anchor,
      options: (["full", ...BACKGROUND_ANCHORS] as const).map((mode) => ({
        id: mode,
        name: uiCopy.backgroundAnchors[mode],
      })),
      data: { "data-yunari-background-anchor": "" },
    },
    // A centred band is sized by its picture's own aspect, so only an edge
    // anchor offers a size.
    ...(edged
      ? [
          {
            id: "background.extent",
            control: "slider",
            label: uiCopy.panels.backgroundExtent,
            value: composition?.extent ?? DEFAULT_BACKGROUND_EXTENT,
            min: MIN_BACKGROUND_EXTENT,
            max: MAX_BACKGROUND_EXTENT,
            percent: true,
            data: { "data-yunari-background-extent": "" },
          } satisfies FieldView,
        ]
      : []),
    // With no composition there is no seam, so nothing to fade.
    ...(composition === undefined
      ? []
      : [
          {
            id: "background.fade",
            control: "slider",
            label: uiCopy.panels.backgroundFade,
            // Zero is the stored absence of a ramp.
            value: composition.fade ?? 0,
            min: 0,
            max: MAX_BACKGROUND_FADE,
            percent: true,
            data: { "data-yunari-background-fade": "" },
          } satisfies FieldView,
        ]),
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
          // The anchor and fade describe how the media composes over the
          // background colour, which only an advanced background has.
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
 * bounds in the view. Which asset is shown, and which model is in force, are
 * the document's own seams and are not fields this writer answers.
 */
export function writeBackgroundField(
  background: Background | undefined,
  fieldId: string,
  value: string | number | boolean,
  _assets: readonly AssetReference[] = [],
): Background | undefined {
  const current = background ?? {};
  const media = current.media;
  const advanced = current.mode === "advanced";

  switch (fieldId) {
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
    case "background.bounds": {
      if (media === undefined || typeof value !== "string") return undefined;
      const bounds = BACKGROUND_MEDIA_BOUNDS.find((mode) => mode === value);
      if (bounds === undefined) return undefined;
      return { ...current, media: { ...media, bounds } };
    }
    case "background.anchor": {
      if (media === undefined || typeof value !== "string") return undefined;
      if (!advanced) return undefined;
      if (value === "full") {
        return { ...current, media: replaceComposition(media, undefined) };
      }
      const anchor = BACKGROUND_ANCHORS.find(
        (candidate) => candidate === value,
      );
      if (anchor === undefined) return undefined;
      // Switching points keeps the size and fade the author already set: the
      // composition is one stored object, not one field per control.
      return {
        ...current,
        media: replaceComposition(media, { ...media.composition, anchor }),
      };
    }
    case "background.extent": {
      if (
        media === undefined ||
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < MIN_BACKGROUND_EXTENT ||
        value > MAX_BACKGROUND_EXTENT
      )
        return undefined;
      if (!advanced) return undefined;
      const composition = media.composition;
      const anchor = composition?.anchor;
      // A centred band is sized by its picture, so it has no authored size.
      if (anchor === undefined || anchor === "center") return undefined;
      return {
        ...current,
        media: replaceComposition(media, { ...composition, extent: value }),
      };
    }
    case "background.fade": {
      if (
        media === undefined ||
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > MAX_BACKGROUND_FADE
      )
        return undefined;
      if (!advanced) return undefined;
      const composition = media.composition;
      if (composition === undefined) return undefined;
      if (value === 0) {
        // Zero is stored by omission: the ramp is derived from a set fade.
        const { fade: _fade, ...withoutFade } = composition;
        return { ...current, media: replaceComposition(media, withoutFade) };
      }
      if (value < MIN_BACKGROUND_FADE) return undefined;
      return {
        ...current,
        media: replaceComposition(media, { ...composition, fade: value }),
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
