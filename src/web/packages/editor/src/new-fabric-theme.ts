import type { FabricThemeEnvelope } from "@yunari/renderer-core";
import type { ArtboardSize } from "./artboard-presets.js";
import {
  clockCard,
  cpuCard,
  gpuCard,
  networkCard,
  ramCard,
  storageCard,
  trendsCard,
  vramCard,
} from "./new-fabric-theme-cards.js";
import {
  type StarterPaletteId,
  starterPalette,
  starterTypePresets,
} from "./new-fabric-theme-globals.js";
import { label } from "./new-fabric-theme-objects.js";
import { starterBackdrop } from "./starter-backdrop.js";

/**
 * The starter as the library offers it: a template the product ships.
 *
 * A template is not a theme the author made, so it is not in the host's
 * library store — it has no file, no id in a themes directory and nothing to
 * delete, which is what "your themes" is counted over. It is offered from the
 * editor, which already holds `createNewFabricTheme`, rather than fetched over
 * the library API the way an author's own themes are.
 */
export const STARTER_TEMPLATE = {
  id: "yunari-starter-template",
  name: "Starter — System dashboard",
} as const;

/** The id the reference theme was saved under while documents carried shared
    literals. Documents now mint their own; this records the retired name. */
export const STARTER_ENVELOPE_ID = "yunari-demo-dashboard";

/**
 * The reference composition, kept whole so it can be reached as what it now is
 * — a template, offered by `New from starter` and listed in the library as one.
 * It is not what `New` means; see `createBlankFabricTheme`.
 */
export function createNewFabricTheme(): FabricThemeEnvelope {
  return {
    schemaVersion: 2,
    fabricVersion: "7.4.0",
    id: crypto.randomUUID(),
    metadata: {
      name: "System dashboard",
      author: "Yunari",
      description:
        "The reference composition: a clock, two usage cards, two memory rings, a performance chart and stacked storage and network panels.",
      // The editor's own copy is English, so a new theme starts where its
      // author does rather than guessing from the browser.
      themeLanguage: "en",
    },
    artboard: {
      width: 1672,
      height: 941,
    },
    // The backdrop is a media layer mounted *below* the canvas: an opaque
    // artboard paint is exactly what would hide it. The colour is transparent
    // because the letterbox is this same paint, so the bars are not painted
    // either and the stage shows through them.
    background: {
      color: { ref: "palette.none" },
      media: { assetId: starterBackdrop.id, bounds: "theme" },
    },
    globals: {
      palette: starterPalette,
      typePresets: starterTypePresets,
    },
    assets: [starterBackdrop],
    bindings: {
      time: [{ id: "clock-time", semanticKey: "time.now", format: "hh:mm" }],
      "time-period": [
        { id: "clock-period", semanticKey: "time.now", format: "A" },
      ],
      date: [
        {
          id: "clock-date",
          semanticKey: "date.today",
          format: "ddd, MMM DD, YYYY",
        },
      ],
      "cpu-card-value": [
        { id: "cpu-card-load", semanticKey: "cpu.load", precision: 0 },
      ],
      "cpu-card-sparkline": [{ id: "cpu-card-spark", semanticKey: "cpu.load" }],
      // Three captions, each bound to the device the card's figures describe.
      // `cpu.brand` rather than `cpu.model`: the library reports all three and
      // the brand is the one that reads as a product name on a caption.
      "cpu-card-caption": [{ id: "cpu-card-model", semanticKey: "cpu.brand" }],
      // The reference writes GHz; the key reports MHz, so the binding scales and
      // the author writes the unit. A conversion of a real reading, not a unit
      // the provider cannot produce.
      "cpu-card-freq": [
        {
          id: "cpu-card-clock",
          semanticKey: "cpu.clock",
          scale: 0.001,
          precision: 1,
        },
      ],
      "gpu-card-value": [
        { id: "gpu-card-load", semanticKey: "gpu.load", precision: 0 },
      ],
      "gpu-card-sparkline": [{ id: "gpu-card-spark", semanticKey: "gpu.load" }],
      "gpu-card-caption": [{ id: "gpu-card-model", semanticKey: "gpu.name" }],
      "gpu-card-freq": [
        {
          id: "gpu-card-clock",
          semanticKey: "gpu.clock",
          scale: 0.001,
          precision: 1,
        },
      ],
      "gpu-card-temp": [
        { id: "gpu-card-temp", semanticKey: "gpu.temp", precision: 0 },
      ],
      "ram-gauge": [
        { id: "ram-gauge-percent", semanticKey: "ram.used.percent" },
      ],
      "ram-value": [{ id: "ram-percent", semanticKey: "ram.used.percent" }],
      "ram-capacity": [
        {
          id: "ram-used",
          semanticKey: "ram.used",
          precision: 1,
          unitDisplay: "none",
        },
        {
          id: "ram-total",
          semanticKey: "ram.total",
          precision: 0,
          unitDisplay: "none",
        },
      ],
      "vram-gauge": [
        { id: "vram-gauge-percent", semanticKey: "vram.used.percent" },
      ],
      "vram-value": [{ id: "vram-percent", semanticKey: "vram.used.percent" }],
      "vram-capacity": [
        {
          id: "vram-used",
          semanticKey: "vram.used",
          precision: 1,
          unitDisplay: "none",
        },
        {
          id: "vram-total",
          semanticKey: "vram.total",
          precision: 0,
          unitDisplay: "none",
        },
      ],
      "trends-chart": [
        { id: "trends-cpu", semanticKey: "cpu.load" },
        { id: "trends-gpu", semanticKey: "gpu.load" },
        { id: "trends-ram", semanticKey: "ram.used.percent" },
      ],
      "storage-card-value": [
        { id: "storage-percent", semanticKey: "disk.used.percent" },
      ],
      "storage-bar": [{ id: "storage-used", semanticKey: "disk.used.percent" }],
      "storage-card-name": [
        { id: "storage-card-volume", semanticKey: "disk.name" },
      ],
      "network-down": [
        {
          id: "network-download-label",
          semanticKey: "network.download",
          precision: 1,
        },
      ],
      "network-up": [
        {
          id: "network-upload-label",
          semanticKey: "network.upload",
          precision: 1,
        },
      ],
      "network-chart": [
        { id: "net-download", semanticKey: "network.download" },
        { id: "net-upload", semanticKey: "network.upload" },
      ],
    },
    scene: {
      version: "7.4.0",
      objects: [
        // The wordmark is tracked by its preset, not by spaces between the
        // letters: a space is a fixed width the font chooses, and it survives
        // into the text the author edits and the reading a screen reader gets.
        // Neither is a card, and making everything a group would be the cage
        // this document is written to avoid.
        label("wordmark", 118, 56, 460, 40.68, "YUNARI", 36, "text", "500"),
        label(
          "strapline",
          120,
          100,
          460,
          19.21,
          "SYSTEM INSIGHTS",
          17,
          "dim",
          "400",
        ),
        clockCard(),
        cpuCard(),
        gpuCard(),
        ramCard(),
        vramCard(),
        trendsCard(),
        storageCard(),
        networkCard(),
      ],
    },
  };
}

/**
 * The tokens a blank theme starts from: the ink, the panel materials and the
 * two chart surfaces, and nothing else.
 *
 * The starter palette also carries the reference composition's device colours —
 * `cpu`, `gpu`, `ram`, `vram`, `down` — and those are not a starting set. A
 * theme opened on a machine with no GPU should not arrive holding a GPU token,
 * and one that does says something about the author's display that they never
 * chose. Product decision, recorded 2026-09-29.
 */
const BLANK_PALETTE_IDS = [
  "none",
  "text",
  "dim",
  "panel",
  "frost",
  "panelStroke",
  "rule",
  "chartTrack",
  "frostInk",
  "frostArea",
] as const satisfies readonly StarterPaletteId[];

/**
 * A new document: the starter's envelope with the composition taken out, at the
 * artboard the author chose.
 *
 * Built **from** `createNewFabricTheme` rather than beside it, so the parts a
 * blank document still has — the type presets, the `schemaVersion`, the envelope
 * shape — are one author's decision in one place. A second hand-built envelope
 * would be a second place the schema version and the preset vocabulary are
 * decided, and the two would drift.
 *
 * The palette is narrowed **by token id**, never by restating a colour. A
 * second copy of `#ecf5ff` is how the frosted tint once reached three literals
 * (`docs/decisions/0013`); taking the starter's own entry means a change to the
 * starter's palette reaches a blank theme and there is no copy left to forget.
 */
export function createBlankFabricTheme(
  artboard: ArtboardSize,
): FabricThemeEnvelope {
  const starter = createNewFabricTheme();
  const palette = Object.fromEntries(
    BLANK_PALETTE_IDS.map((id) => [id, starterPalette[id]]),
  ) as NonNullable<NonNullable<FabricThemeEnvelope["globals"]>["palette"]>;

  return {
    ...starter,
    // A blank theme is its own document, not the starter it was built from:
    // keeping that id would overwrite the reference the first time this saved.
    id: crypto.randomUUID(),
    metadata: {
      name: "New theme",
      author: "Yunari",
      description: "",
      themeLanguage: "en",
    },
    artboard: {
      width: artboard.width,
      height: artboard.height,
    },
    // A blank theme has no backdrop, so the background layer paints its board
    // instead, and the page it paints is a choice the palette has to earn.
    // Measured against the stage the canvas sits on (#26241f), `chartTrack` is
    // the only token in the minimal set that reads as a page *and* keeps every
    // ink legible on it: `text` 12.1:1, `dim` 6.9:1, `rule` 6.5:1, `frostInk`
    // 10.9:1. `panel` is a card material and makes a card on the page 1.02:1 —
    // invisible; `dim` puts `text` on the page at 1.74:1, unreadable.
    //
    // This one paint is also the letterbox around the board. The starter's
    // media is dropped with the assets: a declaration pointing at bytes this
    // document does not carry is a theme the validator refuses and the player
    // renders nothing behind. Replacing the whole `background` is also what
    // keeps the starter's backdrop from leaking through the spread.
    background: { color: { ref: "palette.chartTrack" } },
    globals: {
      palette,
      ...(starter.globals?.typePresets === undefined
        ? {}
        : { typePresets: starter.globals.typePresets }),
    },
    assets: [],
    bindings: {},
    scene: { version: starter.scene["version"] ?? "7.4.0", objects: [] },
  };
}
