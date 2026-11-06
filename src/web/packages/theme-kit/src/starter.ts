import {
  type Artboard,
  type FabricThemeEnvelope,
  newThemeId,
  SUPPORTED_SCHEMA_VERSION,
} from "@yunari/renderer-core";
import {
  type StarterPaletteId,
  starterPalette,
  starterTypeTokens,
} from "./globals.js";

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
 * A new document: the ink, the panel materials and the two chart surfaces, at
 * the artboard the author chose.
 *
 * Written as a literal rather than derived from a starter composition: the
 * composition is committed data now (`bundled/starter.theme.zip` in the
 * editor), and a blank document is not that document with parts removed. The
 * envelope shape and the schema version are still stated here, once, because
 * this is the only place a new document is authored.
 *
 * The palette is narrowed **by token id**, never by restating a colour. A
 * second copy of `#ecf5ff` is how the frosted tint once reached three literals;
 * taking the starter's own entry means a change to the palette reaches a blank
 * theme and there is no copy left to forget.
 */
export function createBlankTheme(input: {
  readonly artboard: Artboard;
  readonly name?: string;
  readonly author?: string;
  readonly themeLanguage?: string;
}): FabricThemeEnvelope {
  const palette = Object.fromEntries(
    BLANK_PALETTE_IDS.map((id) => [id, starterPalette[id]]),
  ) as NonNullable<NonNullable<FabricThemeEnvelope["globals"]>["palette"]>;

  return {
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    fabricVersion: "7.4.0",
    // A new document is its own document, not a template: keeping a template's
    // id would overwrite that template the first time this saved.
    id: newThemeId(),
    metadata: {
      name: input.name ?? "New theme",
      // An author nobody named stays absent: filling in the product's name is
      // an attribution the author never made.
      ...(input.author === undefined ? {} : { author: input.author }),
      description: "",
      themeLanguage: input.themeLanguage ?? "en",
    },
    artboard: {
      width: input.artboard.width,
      height: input.artboard.height,
      // Absence means rect, so a rectangular artboard omits the key rather
      // than writing the default it was read as.
      ...(input.artboard.shape === "circle"
        ? { shape: "circle" as const }
        : {}),
      // Same rule for fit: absence means contain, so only cover is written.
      ...(input.artboard.contentFit === "cover"
        ? { contentFit: "cover" as const }
        : {}),
    },
    // A blank theme has no backdrop, so the background layer paints its board
    // instead, and the page it paints is a choice the palette has to earn.
    // Measured against the stage the canvas sits on (#26241f), `chartTrack` is
    // the only token in the minimal set that reads as a page *and* keeps every
    // ink legible on it: `text` 12.1:1, `dim` 6.9:1, `rule` 6.5:1, `frostInk`
    // 10.9:1. `panel` is a card material and makes a card on the page 1.02:1 —
    // invisible; `dim` puts `text` on the page at 1.74:1, unreadable.
    //
    // This one paint is also the letterbox around the board. There is no media
    // declaration here: a declaration pointing at bytes this document does not
    // carry is a theme the validator refuses and the player renders nothing
    // behind.
    background: { color: { ref: "palette.chartTrack" } },
    globals: {
      palette,
      typeTokens: starterTypeTokens,
    },
    assets: [],
    bindings: {},
    scene: { version: "7.4.0", objects: [] },
  };
}
