import type { FabricPalette } from "@yunari/renderer-core";
import { newTokenPaint, newTypeToken } from "@yunari/theme-kit";
import type { EditorDocument } from "./editor-document.js";
import type {
  TokenRef,
  TokenSelectionStore,
} from "./editor-shell/shell-stores.js";
import type { TokenInspectorActions } from "./panes/tokens/token-inspector.js";
import type { DesignTokenPort } from "./selection-inspector/design-token-editor.js";
import { freePresetId } from "./type-preset-apply.js";
import type { TypeTokens } from "./type-preset-manager/index.js";
import { tokenIdOfFace } from "./type-token-manager/name.js";
import { uiCopy } from "./ui-copy.js";

/**
 * The first free `colour`, `colour-2`, … — the ids are stable keys references
 * are written against, so a new token never reuses a deleted one's name.
 */
function nextPaintId(palette: FabricPalette): string {
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

/**
 * Everything the token inspector and the run rows' token edit need from the
 * session. The inputs are closures, not the session itself, so this module
 * owns the write and selection routes without depending back on the class.
 */
export interface TokenEditorDeps {
  readonly document: EditorDocument;
  readonly history: {
    readonly saveState: () => void;
    readonly suspend: () => () => void;
  };
  readonly selection: TokenSelectionStore | undefined;
  readonly facesOf: TokenInspectorActions["facesOf"];
  readonly familiesOf: () => readonly string[];
  readonly importLocalFont: () => void;
  readonly openFontFinder: (() => void) | undefined;
  readonly onRevealLayer: ((objectId: string) => void) | undefined;
  readonly typeUsage: TokenInspectorActions["typeUsage"];
  readonly paletteUsage: NonNullable<TokenInspectorActions["paints"]>["usage"];
  readonly onShowTokens: (() => void) | undefined;
}

/**
 * The one token-editing surface the session builds: the inspector's actions and
 * the run rows' design-token port, sharing one actions object so both surfaces
 * take the same write, delete and history route.
 *
 * Creation and the run's reference are one suspended history gesture: a throw
 * from either write still lifts the suspension and settles the entry it got.
 */
export function createTokenEditor(deps: TokenEditorDeps): {
  readonly actions: TokenInspectorActions;
  readonly designTokens: DesignTokenPort;
} {
  const { document, history, selection } = deps;
  const actions: TokenInspectorActions = {
    onChange: (presets) => document.setTypes(presets),
    // The same port the preset library is handed: one delete route, so the
    // reference reassignment and the token clear cannot disagree.
    onDelete: (id, replacement) =>
      deleteType(document, selection, id, replacement),
    unbindFace: (id) => document.unbindPresetFace(id),
    ...(deps.facesOf === undefined ? {} : { facesOf: deps.facesOf }),
    // The package's families for the family list, and the two action rows:
    // each is drawn only where its port exists.
    familiesOf: deps.familiesOf,
    importLocalFont: deps.importLocalFont,
    ...(deps.openFontFinder === undefined
      ? {}
      : { openFontFinder: deps.openFontFinder }),
    // The paint half: the selected paint token's fields write through the
    // same document and history ports as the pane's rows once did.
    paints: {
      palette: () => document.envelope.globals?.palette ?? {},
      onChange: (palette) => document.setPalette(palette),
      onSettled: () => history.saveState(),
      onDelete: (id, replacement) =>
        deletePalette(document, selection, id, replacement),
      background: () => document.envelope.background,
      usage: deps.paletteUsage,
    },
    // The type half: the same one walk, so the users list under the preset
    // fields agrees with the figure beside the pane's row.
    typeUsage: deps.typeUsage,
    ...(deps.onRevealLayer === undefined
      ? {}
      : { onRevealLayer: deps.onRevealLayer }),
  };
  const designTokens: DesignTokenPort = {
    actions,
    // Getters, not copies: the document is the one owner of its globals, so
    // a snapshot taken here would show a token the first write replaced.
    typeTokens: () =>
      (document.envelope.globals?.typeTokens ?? {}) as TypeTokens,
    palette: () => document.envelope.globals?.palette ?? {},
    create: (kind, apply) => {
      const release = history.suspend();
      let ref: TokenRef | undefined;
      let applied = false;
      try {
        ref =
          kind === "paint"
            ? (() => {
                const added = addPaintToken(
                  document.envelope.globals?.palette ?? {},
                );
                document.setPalette(added.palette);
                return { kind: "paint", id: added.id } as const;
              })()
            : (() => {
                const added = addTypeToken(
                  (document.envelope.globals?.typeTokens ?? {}) as TypeTokens,
                );
                if (added.created) document.setTypes(added.presets);
                return { kind: "preset", id: added.id } as const;
              })();
        applied = apply(ref);
      } finally {
        // The suspension lifts even when a creation write throws, so a failed
        // gesture cannot leave history deaf to every later edit.
        release();
        // The entry is settled after the suspension lifts, so it captures
        // both writes; a refused apply leaves the creation itself undoable.
        history.saveState();
      }
      return applied ? ref : undefined;
    },
    reveal: (ref) => {
      // Show the pane first, then select: the token inspector is the pane's
      // own surface, and selecting the token is what the store owns.
      deps.onShowTokens?.();
      selection?.set(ref);
    },
  };
  return { actions, designTokens };
}
