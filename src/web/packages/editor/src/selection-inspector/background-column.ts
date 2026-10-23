import {
  type AssetReference,
  BACKGROUND_MEDIA_BOUNDS,
  BACKGROUND_MEDIA_DEFAULTS,
  type Background,
  type BackgroundMedia,
  type FabricGlobals,
  type GlobalRef,
  MAX_BACKGROUND_OFFSET,
  MIN_BACKGROUND_OFFSET,
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

/** The scale and fit are gone: the media always covers, and the only geometry
    an author sets is a translation plus the two paint-time mirrors. */
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

/** Both offsets on one line. The halves carry no bounds — a half has none — so
    the `-1..1` refusal stays at the write boundary. */
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

export function backgroundColumn(input: {
  readonly background: Background | undefined;
  readonly assets: readonly AssetReference[];
  readonly globals: FabricGlobals | undefined;
}): readonly ColumnSectionView[] {
  const media = input.background?.media;
  return [
    sectionView("content", [
      colourField(input.background, input.globals),
      mediaField(media, input.assets),
    ]),
    sectionView("position", [
      boundsField(media),
      offsetField(media),
      flipField(media, "flipX"),
      flipField(media, "flipY"),
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
): Background | undefined {
  const current = background ?? {};
  const media = current.media;

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
    case "background.media": {
      if (typeof value !== "string") return undefined;
      if (value === "") {
        const { media: _media, ...withoutMedia } = current;
        return withoutMedia;
      }
      // A new picture keeps the box and transform the author set for the last
      // one: changing which picture is shown is not a reset of how.
      return {
        ...current,
        media: { ...(media ?? { bounds: "theme" }), assetId: value },
      };
    }
    case "background.bounds": {
      if (media === undefined || typeof value !== "string") return undefined;
      const bounds = BACKGROUND_MEDIA_BOUNDS.find((mode) => mode === value);
      if (bounds === undefined) return undefined;
      return { ...current, media: { ...media, bounds } };
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
