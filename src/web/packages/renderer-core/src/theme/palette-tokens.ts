import type { FabricPalette, FabricPaletteEntry } from "./fabric-envelope.js";

/**
 * The reserved transparent token. It is a reassignment target, not a paint a
 * surface offers: it has a fixed value and no paint kind of its own, so a row
 * for it would open a field set that refuses every edit.
 */
const RESERVED_PALETTE_TOKEN = "none";

/**
 * Whether an id names a token a surface may offer or draw with.
 *
 * **`none` is not one of them** — see {@link RESERVED_PALETTE_TOKEN}. Every
 * surface that lists tokens (the paint rows, the bridge's count, the card
 * mapper's candidates, a new object's surface, the run colour and the
 * inspector's material fields) asks this one question, so they share this one
 * predicate rather than a comparison apiece.
 */
export function isOfferedPaletteToken(id: string): boolean {
  return id !== RESERVED_PALETTE_TOKEN;
}

/**
 * The document's offered token ids, in declaration order.
 *
 * The bare-id form exists because two readers key rows or count them and want
 * neither the authored name nor the `palette.` prefix; it is the same
 * membership {@link isOfferedPaletteToken} answers.
 */
export function paletteTokenIds(
  palette: FabricPalette | undefined,
): readonly string[] {
  return Object.keys(palette ?? {}).filter(isOfferedPaletteToken);
}

/** One entry a reference picker offers: the stored reference, and the name the
 *  author reads. */
export interface PaletteTokenOption {
  /** The stored reference, `palette.<id>` — what a control's value carries. */
  readonly id: `palette.${string}`;
  /** The authored name, or the reference when the document declares none. */
  readonly name: string;
}

/**
 * The document's tokens, each under the name its author gave it.
 *
 * **One function**, because the artboard's paint controls, the chart paint rows
 * and the inspector's material fields each offered the same document tokens and
 * each was its own place a label could print as an id. Sharing one function
 * means a token is named one way everywhere. `keep` is the caller's own: what
 * the surfaces differ in is which tokens they offer — the artboard offers every
 * token, the inspector hides `none` and, on a solid-only field, the gradients —
 * never in how a token is named.
 *
 * A token the document no longer declares a name for has nothing left to label
 * it, so **the reference is the label**: the one case a picker is handed a
 * reference where it offered a name, and `palette-tokens.test.ts` pins it.
 */
export function paletteTokenOptions(
  palette: FabricPalette | undefined,
  keep?: (id: string, entry: FabricPaletteEntry) => boolean,
): readonly PaletteTokenOption[] {
  const options: PaletteTokenOption[] = [];
  for (const id of Object.keys(palette ?? {})) {
    const entry = palette?.[id];
    if (entry !== undefined && keep !== undefined && !keep(id, entry)) continue;
    const ref = `palette.${id}` as const;
    options.push({ id: ref, name: entry?.name ?? ref });
  }
  return options;
}
