import { type FabricGlobals, isTypeTokenRole } from "@yunari/renderer-core";
import { useCallback, useSyncExternalStore } from "react";
import { plainButtonClasses } from "../../components/ui/control-well.js";
import type { ActiveKind } from "../../editor-shell/bridge.js";
import {
  type TokenSelectionStore,
  useTokenSelection,
} from "../../editor-shell/shell-stores.js";
import { resolveTypeToken } from "../../selection-inspector/appearance.js";
import type { TypeTokens } from "../../type-preset-manager/panel.js";
import { uiCopy } from "../../ui-copy.js";

/**
 * The Tokens pane's preset library as a list: every preset as one pressable
 * row, the readout that says what the canvas selection is set in, and a
 * new-preset action.
 *
 * **A row is a selector, not a control.** Pressing it selects the token for the
 * inspector; nothing here edits the document. The row shows the specimen `Aa`
 * in the preset's own family (packaged faces are already in `document.fonts`, so
 * nothing is fetched), its name, its role badge where it has one, and its
 * resolution line.
 *
 * **A resolution is not a control.** The line beside a preset is a mono value
 * with no well, because a border means editable (DESIGN.md §5.1).
 * `resolveTypeToken` is the one owner of what a preset resolves to, so this
 * file reads the rule rather than restating the "family weight sizepx" it
 * composes.
 *
 * **Nothing is re-derived here (R33).** The membership is `Object.keys(presets)`
 * and the resolved value is the selection-inspector's resolver.
 */
export interface PresetListProps {
  readonly presets: TypeTokens;
  /** The host's add port. The id is minted here, because this list owns the
   *  stable ids references are written against. */
  readonly onAdd: (id: string) => void;
  /** Where the canvas selection's own preset is read from. Absent reads as
   *  nothing selected — a list mounted with no shell behind it says so rather
   *  than inventing a selection. */
  readonly selection: PresetSelection | undefined;
  /** The token selection the rows set and state. Absent reads as none. */
  readonly tokenSelection: TokenSelectionStore | undefined;
}

/**
 * The stage's answer to "what is the selection set in", as the pane reads it.
 *
 * The pane is a persistent React tree and the selection is Fabric's, so the id
 * is pulled through a subscription rather than handed over once. The shape is
 * the shell's own projection (`EditorShellSnapshot`), which is the one owner of
 * what is selected — this file never walks the scene itself (R33).
 */
export interface PresetSelection {
  subscribe(listener: () => void): () => void;
  get(): {
    readonly selectedCount: number;
    /** Routing for a selection that *contains* others — a group, or a
     *  multi-selection. The shell already projects it, and the pane needs it
     *  because a container's type presets belong to its children: the same
     *  case `selection-inspector` reads through `childrenAppearance`. */
    readonly activeKind: ActiveKind;
    readonly selectionPresetId: string | undefined;
  };
}

/** No shell behind the list. A module constant, because
 *  `useSyncExternalStore` compares snapshots by identity. */
const NO_SELECTION: ReturnType<PresetSelection["get"]> = {
  selectedCount: 0,
  activeKind: "none",
  selectionPresetId: undefined,
};

function usePresetSelection(
  source: PresetSelection | undefined,
): ReturnType<PresetSelection["get"]> {
  const subscribe = useCallback(
    (listener: () => void) => source?.subscribe(listener) ?? (() => undefined),
    [source],
  );
  const read = useCallback(() => source?.get() ?? NO_SELECTION, [source]);
  return useSyncExternalStore(subscribe, read, read);
}

/**
 * What the pane says the **selection** is set in, as against the token the row
 * list has selected.
 *
 * This is the distinction `vg-094` is about: a default and an answer must not
 * read alike, so five cases read five ways. "The selection is set to …" when
 * the selection carries a preset; a dangling reference reads as unresolved,
 * which is a third answer and collapses into neither empty one; a container —
 * a group or a multi-selection — reads as its children's presets, which is what
 * `selection-inspector`'s own `childrenAppearance` already tells the author, so
 * the two surfaces cannot disagree about one selection; "carries no type
 * preset" when the selection itself is set in none; and "nothing selected" when
 * there is no selection at all.
 *
 * It is the **canvas** selection's readout and not the token selection's: a row
 * press clears the canvas (ruling 2), so the two never claim different things
 * at once.
 */
function Binding(props: {
  readonly presetId: string | undefined;
  readonly hasSelection: boolean;
  readonly activeKind: ActiveKind;
  readonly presets: TypeTokens;
}): React.JSX.Element | null {
  const { presetId, hasSelection, activeKind, presets } = props;
  const sentence = ((): string => {
    if (!hasSelection) return uiCopy.panels.selectionEmpty;
    if (presetId === undefined) {
      // A container is not a failed lookup: it has no preset of its own because
      // its children carry them. Bounded to the case with no preset to name, so
      // a real reference is never dropped in favour of the container answer.
      return activeKind === "group"
        ? uiCopy.panels.selectionChildrenTypes
        : uiCopy.panels.selectionNoType;
    }
    // The name, because every surface that offers a reference names what it
    // offers; the ref is what is left when the document no longer declares it.
    // ponytail: `[id] family weight` until Task 4.1's computed name lands.
    const token = presets[presetId];
    return token === undefined
      ? uiCopy.panels.selectionUnresolved(`typeTokens.${presetId}`)
      : uiCopy.panels.selectionSetTo(
          `${presetId} ${token.family}${token.weight === undefined ? "" : ` ${token.weight}`}`,
        );
  })();
  // A plain line, not a live region: the pane is rerendered on every selection,
  // and an announcement per canvas click is noise rather than information.
  return (
    <p data-yunari-type-preset-binding="" className="text-xs text-muted">
      {sentence}
    </p>
  );
}

export function PresetList(props: PresetListProps): React.JSX.Element {
  const { presets, onAdd, selection, tokenSelection } = props;
  const ids = Object.keys(presets);
  const stage = usePresetSelection(selection);
  const selectedToken = useTokenSelection(tokenSelection);
  // The resolver reads a `FabricGlobals`, and this list's own record *is* the
  // `typeTokens` of one — so the rule keeps its single owner with no copy.
  const globals: FabricGlobals = { typeTokens: presets };
  // A row's one gesture. The store owns the canvas clear, so this file never
  // reaches Fabric.
  const onSelect = (id: string): void =>
    tokenSelection?.set({ kind: "preset", id });

  return (
    <div
      data-yunari-type-presets=""
      className="flex flex-col gap-[var(--space-8)]"
    >
      <h2 className="text-xs font-semibold tracking-[0.11em] text-muted uppercase">
        {uiCopy.panels.typeTokens}
      </h2>
      {/* What the selection is set in, above the list: the two are separate
          readouts, so selecting a token to edit below never claims to have
          applied it to the selection. */}
      <Binding
        presetId={stage.selectionPresetId}
        // The background is a layer, not an object with a type: it has no
        // preset, so the readout says nothing is selected rather than naming a
        // failed lookup. Equivalent to `target().kind !== "none"`, which is the
        // gate the layer footer uses.
        hasSelection={
          stage.selectedCount > 0 && stage.activeKind !== "background"
        }
        activeKind={stage.activeKind}
        presets={presets}
      />
      <ul className="flex flex-col gap-[var(--space-4)]">
        {ids.map((id) => {
          const token = presets[id];
          if (token === undefined) return null;
          const role = isTypeTokenRole(id) ? id : undefined;
          return (
            <li key={id}>
              <button
                type="button"
                data-yunari-type-preset-row={id}
                aria-pressed={
                  selectedToken?.kind === "preset" && selectedToken.id === id
                }
                onClick={() => onSelect(id)}
                className="flex w-full items-baseline gap-[var(--space-8)] rounded-[var(--radius-sm)] border border-transparent px-[var(--space-6)] py-[var(--space-4)] text-left hover:border-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent aria-pressed:border-accent aria-pressed:bg-panel-2"
              >
                <span
                  data-yunari-type-preset-specimen=""
                  aria-hidden="true"
                  className="text-sm text-text"
                  style={{ fontFamily: token.family }}
                >
                  Aa
                </span>
                <span className="text-xs text-muted">
                  {`${id} ${token.family}${token.weight === undefined ? "" : ` ${token.weight}`}`}
                </span>
                {role === undefined ? null : (
                  <span
                    data-yunari-type-preset-role=""
                    className="rounded-[var(--radius-sm)] border border-edge px-[var(--space-4)] text-2xs text-faint"
                  >
                    {uiCopy.assets.fontPreview.role[role]}
                  </span>
                )}
                <span
                  data-yunari-type-preset-resolution=""
                  className="ml-auto font-mono text-xs text-muted"
                >
                  {resolveTypeToken(globals, `typeTokens.${id}`) ?? ""}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        data-yunari-type-preset-add=""
        onClick={() => onAdd(nextId(presets))}
        className={plainButtonClasses}
      >
        {uiCopy.panels.addType}
      </button>
    </div>
  );
}

/** The first free `type`, `type-2`, … — the ids are stable keys references are
 *  written against, so a new preset never reuses a deleted one's id. */
function nextId(presets: TypeTokens): string {
  for (let index = 1; ; index += 1) {
    const id = index === 1 ? "type" : `type-${index}`;
    if (presets[id] === undefined) return id;
  }
}
