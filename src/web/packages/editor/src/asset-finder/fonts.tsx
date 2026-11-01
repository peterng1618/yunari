import type { FontCut, FontTrioInfo } from "@yunari/renderer-core";
import type * as React from "react";
import type { TypeTokens } from "../type-preset-manager/panel.js";
import { uiCopy } from "../ui-copy.js";
import { type FinderAction, FinderSegmented } from "./finder-controls.js";
import {
  type FontResult,
  type FontRole,
  familyCutsOf,
  leadCutOf,
} from "./font-preview-panel.js";
import type { FinderRow } from "./tab-data.js";

/** What the session offers a font result. A callback the session does not wire
 *  drops its action rather than drawing a button that cannot act. */
export interface FontActions {
  readonly presets?: TypeTokens;
  readonly onApplyTrio?: (trio: FontTrioInfo) => void;
  readonly onAddTrioPresets?: (trio: FontTrioInfo) => void;
  readonly onAddPreset?: (
    cut: FontCut,
    role: FontRole,
    family: readonly FontCut[],
  ) => void;
  readonly onApplyToSelected?: (
    cut: FontCut,
    family: readonly FontCut[],
  ) => void;
  /** The author's favourite trios live on the host, so the pane reads and
   *  writes them through the session's client rather than holding a second
   *  list. Both ports are absent when this host keeps no favourites store. */
  readonly listFavorites?: () => Promise<readonly string[]>;
  readonly saveFavorites?: (
    ids: readonly string[],
  ) => Promise<readonly string[]>;
}

export interface FontFilterState {
  readonly kind: "all" | "trio" | "family";
  readonly sort: "name" | "provider";
}

export interface FontPreviewState {
  readonly sample: string;
  readonly cutId: string | undefined;
  readonly role: FontRole;
}

function isTrio(row: FinderRow): boolean {
  return row.result.font?.trio !== undefined;
}

/** The tab's filter: it narrows what is drawn, never what is asked. Sort by
 *  name is A–Z; provider keeps the mixed grid's listing order. */
export function fontRows(
  rows: readonly FinderRow[],
  filter: FontFilterState,
): readonly FinderRow[] {
  const kept = rows.filter(
    (row) =>
      filter.kind === "all" ||
      (filter.kind === "trio" ? isTrio(row) : !isTrio(row)),
  );
  return filter.sort === "name"
    ? [...kept].sort((left, right) =>
        left.result.name.localeCompare(right.result.name),
      )
    : kept;
}

function copy(): typeof uiCopy.assets {
  return uiCopy.assets;
}

/** The footer sentence for a successful font action. A trio writes three roles,
 *  so the single-token sentence belongs to the face action alone. */
export function fontDoneMessage(actionId: string): string {
  const done = uiCopy.assets.done;
  if (actionId === "apply-trio") return uiCopy.assets.fontTrioDone;
  return actionId.startsWith("add") ? done.colour : done.font;
}

/** The footer's actions for the chosen font: a trio applies or adds its three
 *  roles, a family applies or adds the chosen cut. */
export function fontActionsOf(
  selection: FinderRow,
  _filter: FontFilterState,
  preview: FontPreviewState,
  actions: FontActions | undefined,
): readonly FinderAction[] {
  if (actions === undefined) return [];
  const words = copy();
  const font = selection.result.font;
  if (font === undefined) return [];

  const trio = font.trio;
  if (trio !== undefined) {
    const list: FinderAction[] = [];
    const apply = actions.onApplyTrio;
    if (apply !== undefined) {
      list.push({
        id: "apply-trio",
        label: words.fontApplyTrio,
        busyLabel: words.fontApplyBusy,
        tone: "accent",
        disabled: false,
        run: () => {
          apply(trio);
          return { ok: true };
        },
      });
    }
    const add = actions.onAddTrioPresets;
    if (add !== undefined) {
      list.push({
        id: "add-trio",
        label: words.fontAddPresets,
        busyLabel: words.fontAddBusy,
        tone: "plain",
        disabled: false,
        run: () => {
          add(trio);
          return { ok: true };
        },
      });
    }
    return list;
  }

  const chosen =
    font.cuts.find((entry) => entry.id === preview.cutId) ??
    leadCutOf(selection.result);
  if (chosen === undefined) return [];
  const family = familyCutsOf(selection.result as FontResult, chosen);
  const addPreset = actions.onAddPreset;
  const applySelected = actions.onApplyToSelected;
  // Apply falls back to a preset write when the document has no selected
  // token to rewrite: adopting the face is still the author's outcome.
  const apply =
    applySelected !== undefined
      ? () => {
          applySelected(chosen, family);
        }
      : addPreset !== undefined
        ? () => {
            addPreset(chosen, preview.role, family);
          }
        : undefined;

  const list: FinderAction[] = [];
  if (apply !== undefined) {
    list.push({
      id: "apply-cut",
      label: words.fontApplyToken,
      busyLabel: words.fontApplyBusy,
      tone: "accent",
      disabled: false,
      run: () => {
        apply();
        return { ok: true };
      },
    });
  }
  if (addPreset !== undefined) {
    list.push({
      id: "add-cut",
      label: words.fontAddPresets,
      busyLabel: words.fontAddBusy,
      tone: "plain",
      disabled: false,
      run: () => {
        addPreset(chosen, preview.role, family);
        return { ok: true };
      },
    });
  }
  return list;
}

/** The Fonts toolbar's two filters, in the shared segmented shape. */
export function FontsFilter(props: {
  readonly filter: FontFilterState;
  readonly onChange: (next: FontFilterState) => void;
}): React.JSX.Element {
  const words = copy();
  return (
    <>
      <FinderSegmented
        label={words.fontFilterLabel}
        value={props.filter.kind}
        options={(["all", "trio", "family"] as const).map((kind) => ({
          id: kind,
          label: words.fontFilter[kind],
          data: { "data-yunari-font-filter": kind },
        }))}
        onChange={(kind) => {
          props.onChange({ ...props.filter, kind });
        }}
      />
      <FinderSegmented
        label={words.fontSortLabel}
        value={props.filter.sort}
        options={(["name", "provider"] as const).map((sort) => ({
          id: sort,
          label: words.fontSort[sort],
          data: { "data-yunari-font-sort": sort },
        }))}
        onChange={(sort) => {
          props.onChange({ ...props.filter, sort });
        }}
      />
    </>
  );
}
