import type { FabricPalette } from "@yunari/renderer-core";
import { newTokenPaint, newTypeToken } from "@yunari/theme-kit";
import type { EditorDocument } from "./editor-document.js";
import type {
  TokenRef,
  TokenSelectionStore,
} from "./editor-shell/shell-stores.js";
import { freePresetId } from "./type-preset-apply.js";
import type { TypeTokens } from "./type-preset-manager/index.js";
import { tokenIdOfFace } from "./type-token-manager/name.js";
import { uiCopy } from "./ui-copy.js";

/**
 * The first free `colour`, `colour-2`, … — the ids are stable keys references
 * are written against, so a new token never reuses a deleted one's name.
 */
export function nextPaintId(palette: FabricPalette): string {
  for (let suffix = 1; ; suffix += 1) {
    const id = suffix === 1 ? "colour" : `colour-${suffix}`;
    if (palette[id] === undefined) return id;
  }
}

/**
 * The one paint-token creation: the Tokens pane's add button and a run's token
 * list both add through this, so the id rule and the seeded paint have one
 * owner. The caller writes the returned palette and settles history.
 */
export function addPaintToken(palette: FabricPalette): {
  readonly palette: FabricPalette;
  readonly id: string;
} {
  const id = nextPaintId(palette);
  return {
    id,
    palette: {
      ...palette,
      [id]: {
        name: uiCopy.panels.newColour,
        value: { kind: "solid", color: newTokenPaint },
      },
    },
  };
}

/**
 * The one type-token creation. A face the theme already holds is not duplicated
 * — the existing token is named instead, which is what the pane's add has
 * always done. `created` tells the caller whether there is a palette to write.
 */
export function addTypeToken(presets: TypeTokens): {
  readonly presets: TypeTokens;
  readonly id: string;
  readonly created: boolean;
} {
  const existing = tokenIdOfFace(
    presets,
    newTypeToken.family,
    newTypeToken.weight,
  );
  if (existing !== undefined) {
    return { presets, id: existing, created: false };
  }
  const id = freePresetId(presets);
  return { presets: { ...presets, [id]: newTypeToken }, id, created: true };
}

/**
 * Whether the document still declares the token a ref names.
 *
 * Read at render time rather than tracked: the document is the one owner of
 * its globals, and an undo, a load or a panel write can drop an entry without
 * either delete route running.
 */
export function tokenExists(
  document: EditorDocument,
  token: TokenRef,
): boolean {
  if (token.kind === "preset") {
    const presets = (document.envelope.globals?.typeTokens ?? {}) as TypeTokens;
    return presets[token.id] !== undefined;
  }
  return document.envelope.globals?.palette?.[token.id] !== undefined;
}

/**
 * The one type-preset delete route, handed to both the preset library and the
 * token inspector.
 *
 * The document re-points the references; a token selection still naming the
 * deleted preset is cleared here, so the object column comes back rather than
 * the right column staying suppressed over a token that no longer exists.
 */
export function deleteType(
  document: EditorDocument,
  selection: TokenSelectionStore | undefined,
  id: string,
  replacement: string | undefined,
): void {
  document.deleteType(id, replacement);
  clearDeletedToken(selection, "preset", id);
}

/**
 * The one paint-token delete route, handed to the palette pane and the token
 * inspector.
 */
export function deletePalette(
  document: EditorDocument,
  selection: TokenSelectionStore | undefined,
  id: string,
  replacement: string | undefined,
): void {
  document.deletePalette(id, replacement);
  clearDeletedToken(selection, "paint", id);
}

/**
 * A token still selected in the inspector when it is deleted is cleared, so
 * the object column comes back rather than the right column staying
 * suppressed over a token that no longer exists.
 */
function clearDeletedToken(
  selection: TokenSelectionStore | undefined,
  kind: TokenRef["kind"],
  id: string,
): void {
  const token = selection?.get();
  if (token?.kind === kind && token.id === id) selection?.clear();
}
