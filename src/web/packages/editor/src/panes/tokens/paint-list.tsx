import type { FabricPalette, PalettePaint } from "@yunari/renderer-core";
import { plainButtonClasses } from "../../components/ui/control-well.js";
import { gradientCss } from "../../components/ui/gradient-css.js";
import {
  type TokenSelectionStore,
  useTokenSelection,
} from "../../editor-shell/shell-stores.js";
import { newTokenPaint } from "../../new-fabric-theme-globals.js";
import type { PaletteTokenUse } from "../../palette-manager/panel.js";
import { paletteTokenIds } from "../../palette-manager/token-list.js";
import { uiCopy } from "../../ui-copy.js";

/**
 * The Tokens pane's paint library as a list: every token as one pressable row,
 * with its swatch, its name and its usage figure, and a new-paint action.
 *
 * **A row is a selector, not a control.** Pressing it selects the token for the
 * inspector, where the fields live; nothing here edits the document. The row's
 * shape is unchanged from the pane's field-set days — the spec keeps paint rows
 * as they were — and what left is the chooser, the fields and the users list.
 *
 * **The membership is not re-derived here.** The list is `paletteTokenIds`,
 * which the pane's title-bar count also reads, so the rows drawn and the number
 * beside the title are one list rather than two that must agree; the figure
 * beside a token is the caller's `usage` walk, read per draw. The count the
 * author reads and the set a deletion moves therefore come from one owner
 * (`paletteTokenUsage`), which is what stops a token being reported unused while
 * an object is painted with it.
 *
 * **`none` is not listed.** It is the reserved transparent token, with a fixed
 * value and no paint kind of its own, so a row for it would be a control that
 * opens a field set refusing every edit. It stays a reassignment target, which
 * is the one thing an author has it for — "stop painting this" is a real answer
 * to the question the delete asks.
 */
export interface PaintListProps {
  readonly palette: FabricPalette;
  /** The objects each token is linked to, or `undefined` when the pane has no
   *  scene to read. A function, not a record: the scene changes under the pane,
   *  so the figure is re-read on every draw rather than frozen at construction. */
  readonly usage:
    | (() => Readonly<Record<string, readonly PaletteTokenUse[]>>)
    | undefined;
  readonly onChange: (palette: FabricPalette) => void;
  /** The settled boundary of the one discrete edit left in the pane: adding a
   *  token has no gesture to settle behind it, and without the entry a later
   *  undo's globals restore silently removes it. */
  readonly onSettled?: (() => void) | undefined;
  /** The token selection the rows set and state. Absent reads as none: a list
   *  mounted with no session behind it selects nothing. */
  readonly tokenSelection: TokenSelectionStore | undefined;
}

export function PaintList(props: PaintListProps): React.JSX.Element {
  const { palette, usage, onChange, onSettled, tokenSelection } = props;
  const selectedToken = useTokenSelection(tokenSelection);
  // Read once per draw, so the figure beside a token and the set a deletion
  // moves are one walk of one scene.
  const uses = usage?.();
  // The pane's own list, from the module the bridge's count also reads, so the
  // rows drawn and the number in the title bar cannot disagree (§7.3).
  const ids = paletteTokenIds(palette);
  // A preset ref is not this list's selection: `aria-pressed` would otherwise
  // mark a paint row whose id happened to match.
  const selected =
    selectedToken?.kind === "paint" ? selectedToken.id : undefined;

  const add = (): void => {
    const id = nextId(palette);
    onChange({
      ...palette,
      [id]: {
        name: uiCopy.panels.newColour,
        value: { kind: "solid", color: newTokenPaint },
      },
    });
    // Selected here so the new token's fields open beside the list; a list with
    // no session behind it still adds.
    tokenSelection?.set({ kind: "paint", id });
    onSettled?.();
  };

  return (
    <div className="flex flex-col gap-[var(--space-8)]">
      <ul className="flex flex-col gap-[var(--space-4)]">
        {ids.map((id) => {
          const token = palette[id];
          if (token === undefined) return null;
          return (
            <li key={id}>
              <button
                type="button"
                data-yunari-palette-token-row={id}
                aria-pressed={id === selected}
                onClick={() => tokenSelection?.set({ kind: "paint", id })}
                className="flex min-h-[26px] w-full items-center gap-[var(--space-6)] rounded-md border border-edge bg-panel-2 px-[var(--space-6)] text-left text-sm text-text hover:border-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent aria-pressed:border-accent"
              >
                <span
                  aria-hidden={true}
                  className="size-[14px] flex-none rounded-sm border border-edge"
                  style={{ background: paintCss(token.value) }}
                />
                <span className="truncate">{token.name}</span>
                <span
                  data-yunari-palette-usage=""
                  className="ml-auto flex-none text-xs text-muted tabular-nums"
                >
                  {figureFor(id, uses)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        data-yunari-palette-add=""
        onClick={add}
        className={plainButtonClasses}
      >
        {uiCopy.panels.addColour}
      </button>
    </div>
  );
}

/** The figure beside a token. A missing reading is stated, never a default: with
 *  no scene to read the pane says so rather than fabricating a zero (§97). */
function figureFor(
  id: string,
  uses: Readonly<Record<string, readonly PaletteTokenUse[]>> | undefined,
): string {
  if (uses === undefined) return uiCopy.panels.notSet;
  return String((uses[id] ?? []).length);
}

/** The paint as a CSS background: the colour itself, or the sweep a gradient
 *  describes — the same `GradientEditor` draws on its own track. */
function paintCss(value: PalettePaint): string {
  if (value.kind === "solid") return value.color;
  return gradientCss(value.stops, value.angle);
}

/** The first free `colour`, `colour-2`, … — the ids are stable keys references
 *  are written against, so a new token never reuses a deleted one's name. */
function nextId(palette: FabricPalette): string {
  for (let suffix = 1; ; suffix += 1) {
    const id = suffix === 1 ? "colour" : `colour-${suffix}`;
    if (palette[id] === undefined) return id;
  }
}
