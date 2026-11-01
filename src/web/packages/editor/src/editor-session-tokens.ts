import type { EditorDocument } from "./editor-document.js";
import type {
  TokenRef,
  TokenSelectionStore,
} from "./editor-shell/shell-stores.js";
import type { TypeTokens } from "./type-preset-manager/index.js";

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
  replacement: string,
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
  replacement: string,
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
