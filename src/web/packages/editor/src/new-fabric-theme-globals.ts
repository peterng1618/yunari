import type { FabricPalette, TypeToken } from "@yunari/renderer-core";

/**
 * The starter theme's palette, type presets and the two lookups the scene
 * helpers need from them.
 *
 * Its own module because `new-fabric-theme.ts` outgrew `AGENTS.md`'s 800-line
 * stop, and the globals are a separable responsibility: they are the document's
 * vocabulary, and every object in the scene is written against them rather than
 * against the scene body.
 */

/**
 * The tint a *frosted* panel carries, which is not the tint an opaque one does.
 *
 * Measured from both ends, because it is a floor set by what is behind the glass
 * rather than a look:
 *
 * - **Down.** The frosted card's own `panel` fill is 85% opaque, and a backdrop
 *   behind it reaches the eye at 2.4/255 of contrast — 16.02 blurred backdrop
 *   times (1 − 0.851) = 2.39, which is what the browser reported. A blur applied
 *   under an almost-opaque panel is a blur of nothing.
 * - **Up.** This card sits on the photograph's bright horizon, and the panel's
 *   field is that photograph at (1 − alpha) plus the tint. At 18% the field
 *   measures 0.1874 WCAG luminance and `#ecf5ff` reads **4.02:1** against it —
 *   under AA's 4.5. At 24% it reads 4.49, which passes and is not a floor worth
 *   having on a threshold that moves with the photograph; at 30% the field is
 *   0.135 and the caption reads **5.1:1**.
 *
 * 30% is therefore the floor the contrast requirement sets, not a preference,
 * and the photograph still reads through it: the panel's carried backdrop
 * structure falls from 1.27 to about 1.08 against a 0.6 floor.
 */
export const frost = "#0815234d";

/**
 * The paint a token added from the Tokens pane is seeded with.
 *
 * Authored data rather than a design decision — the author's next edit replaces
 * it — so it sits with the theme's other default paints and not in a surface
 * that is gated against colour literals (`scripts/design-tokens.gated.json`).
 */
export const newTokenPaint = "#ffffff";

/**
 * The type a preset added from the Tokens pane is seeded with.
 *
 * Authored data rather than a design decision — the author's next edit replaces
 * it — so it sits with the starter presets' own family, and the surface that
 * seeds it carries no authored value of its own.
 */
export const newPresetType: TypeToken = {
  family: "Segoe UI, sans-serif",
  weight: "400",
};

/**
 * The palette is the single place a colour is named. `solidOf` below repeats
 * the solid ones because a scene object also carries Fabric's own resolved
 * colour beside its `yunariPaint` reference — one authored fact, two
 * representations, not two authored facts.
 *
 * The artboard's own paint is `none`, because the backdrop is a packaged media
 * layer mounted below the canvas and an opaque artboard paint would hide it; the
 * letterbox bars outside it are `bars`. `background` survives that change as
 * the **surface token new objects take** — see the note on its entry.
 */
export const starterPalette = {
  none: { name: "None", value: { kind: "solid", color: "transparent" } },
  // Not the artboard's paint any more — that is `none`, because the backdrop is
  // a media layer below the canvas. This is the **surface token new objects
  // take**: `new-object-defaults.ts` picks the first of
  // `background | bars | scene | surface | track` the palette actually has, so
  // deleting it silently repainted every inserted panel and chart track with
  // `bars` — pure black. The artboard and the surface are two different jobs
  // that happened to share a token.
  background: {
    name: "Background",
    value: { kind: "solid", color: "#0c0e13" },
  },
  bars: { name: "Letterbox bars", value: { kind: "solid", color: "#000000" } },
  text: { name: "Text", value: { kind: "solid", color: "#ecf5ff" } },
  dim: { name: "Muted text", value: { kind: "solid", color: "#a8bed0" } },
  panel: { name: "Panel", value: { kind: "solid", color: "#081523d9" } },
  frost: {
    name: "Frosted panel",
    value: { kind: "solid", color: frost },
  },
  panelStroke: {
    name: "Panel outline",
    value: { kind: "solid", color: "#9fc7e52b" },
  },
  rule: { name: "Rule", value: { kind: "solid", color: "#7dbde0" } },
  cpu: { name: "CPU", value: { kind: "solid", color: "#4da3ff" } },
  gpu: { name: "GPU", value: { kind: "solid", color: "#a98bff" } },
  ram: { name: "RAM", value: { kind: "solid", color: "#2ee6a8" } },
  vram: { name: "VRAM", value: { kind: "solid", color: "#c964e8" } },
  down: { name: "Download", value: { kind: "solid", color: "#22d3ee" } },
  chartTrack: {
    name: "Chart track",
    value: { kind: "solid", color: "#223047" },
  },
  sparkArea: {
    name: "Sparkline area",
    value: {
      kind: "gradient",
      angle: 90,
      stops: [
        { offset: 0, color: "#4da3ff66" },
        { offset: 1, color: "#4da3ff00" },
      ],
    },
  },
  // The frosted cards' chart ink, and the reason it is a separate token from
  // `cpu`/`gpu`/`sparkArea` above: those are mid-luma blues measured for a
  // near-opaque panel, and a card that transmits is a *mid-luma photographic*
  // field. Measured across this card row the field averages 55, but the CPU
  // card sits on the photograph's bright horizon at 114 — and `#4da3ff` is
  // luma 151, only 37 away from it, which is under the one-pixel edge floor
  // and reads as a soft grey line. A light ink separates from both ends of
  // that range: 232 is 177 from the bright card and 177 from the dark one.
  frostInk: {
    name: "Chart ink on glass",
    value: { kind: "solid", color: "#dbeafe" },
  },
  frostArea: {
    name: "Chart area on glass",
    value: {
      kind: "gradient",
      angle: 90,
      stops: [
        { offset: 0, color: "#dbeafe59" },
        { offset: 1, color: "#dbeafe00" },
      ],
    },
  },
  storageFill: {
    name: "Storage fill",
    value: {
      kind: "gradient",
      angle: 0,
      stops: [
        { offset: 0, color: "#3f7fe0" },
        { offset: 1, color: "#5ea2ff" },
      ],
    },
  },
} as const satisfies FabricPalette;

export type StarterPaletteId = keyof typeof starterPalette;

/**
 * The solid colour behind each token, for the Fabric fields a scene object also
 * writes beside its `yunariPaint` reference.
 *
 * A v2 object carries the resolved colour *and* the reference, so the reference
 * is the thing that has to be right; this is the resolved half, read from the
 * same token rather than restated at every call site.
 */
export const solidOf: Readonly<Record<string, string>> = {
  text: "#ecf5ff",
  dim: "#a8bed0",
  panel: "#081523d9",
  frost,
  background: "#0c0e13",
  rule: "#7dbde0",
  cpu: "#4da3ff",
  gpu: "#a98bff",
  ram: "#2ee6a8",
  vram: "#c964e8",
  down: "#22d3ee",
  chartTrack: "#223047",
  frostInk: "#dbeafe",
};

export const starterTypeTokens = {
  // Body first: `createNewTextDefaults` and the chart defaults take the first
  // preset as a new object's, so the order here is the editor's default face.
  "20-400": {
    family: "Segoe UI, sans-serif",
    size: 20,
    weight: "400",
    lineHeight: 1.18,
    trioRole: "body",
  },
  "17-400": {
    family: "Segoe UI, sans-serif",
    size: 17,
    weight: "400",
    // Measured off the reference's "SYSTEM INSIGHTS": the six glyph advances
    // across "SYSTEM" run 16px apart at a 12px cap height, which is 0.29 em of
    // the 17px face once the letter's own advance is taken out.
    letterSpacing: 6,
    lineHeight: 1.18,
    trioRole: "body",
  },
  "20-500": {
    family: "Segoe UI, sans-serif",
    size: 20,
    weight: "500",
    lineHeight: 1.18,
    trioRole: "body",
  },
  "24-400": {
    family: "Segoe UI, sans-serif",
    size: 24,
    weight: "400",
    lineHeight: 1.18,
    trioRole: "body",
  },
  "24-500": {
    family: "Segoe UI, sans-serif",
    size: 24,
    weight: "500",
    lineHeight: 1.18,
    trioRole: "body",
  },
  "32-400": {
    family: "Segoe UI, sans-serif",
    size: 32,
    weight: "400",
    lineHeight: 1.18,
    trioRole: "body",
  },
  "36-500": {
    family: "Segoe UI, sans-serif",
    size: 36,
    weight: "500",
    // Measured off the reference, not judged by eye: the glyphs of "YUNARI"
    // stand 26px cap height and the five advances between them average 45px
    // at a 36px face, which is 0.78 em once each letter's own advance is out.
    letterSpacing: 28,
    lineHeight: 1.18,
    trioRole: "heading",
  },
  "44-600": {
    family: "Segoe UI, sans-serif",
    size: 44,
    weight: "600",
    lineHeight: 1.18,
    trioRole: "heading",
  },
  "46-600": {
    family: "Segoe UI, sans-serif",
    size: 46,
    weight: "600",
    lineHeight: 1.18,
    trioRole: "heading",
  },
  "60-600": {
    family: "Segoe UI, sans-serif",
    size: 60,
    weight: "600",
    lineHeight: 1.18,
    trioRole: "heading",
  },
  "90-600": {
    family: "Segoe UI, sans-serif",
    size: 90,
    weight: "600",
    // Untracked, for the reason the clock below gives.
    lineHeight: 1.18,
    trioRole: "heading",
  },
  "108-300": {
    family: "Segoe UI, sans-serif",
    size: 108,
    weight: "300",
    // Untracked, and so is every reading: a numeral's advance is a grid cell,
    // and opening it up breaks the column it sits in.
    lineHeight: 1.18,
    trioRole: "heading",
  },
  mono: {
    family: "Segoe UI, sans-serif",
    size: 14,
    weight: "400",
    lineHeight: 1.18,
    trioRole: "mono",
  },
} as const;

/** Fabric's `charSpacing` in 1/1000 em, for the presets that track. */
export function charSpacingPx(
  presetId: string,
  fontSize: number,
): number | undefined {
  // `as const` gives each preset its own literal type, and the untracked ones
  // have no `letterSpacing` key at all, so the lookup is widened to read one.
  const value = (
    starterTypeTokens[presetId as keyof typeof starterTypeTokens] as
      | { readonly letterSpacing?: number }
      | undefined
  )?.letterSpacing;
  return typeof value === "number" ? (value / fontSize) * 1000 : undefined;
}
