/**
 * The `?` reference, as rows rather than as a surface.
 *
 * The sheet and the tooltip read one projection of one table, so a chord cannot
 * be right in one and wrong in the other. Nothing here decides *which* actions
 * exist — `index.ts` owns that — and nothing here owns a chord.
 */
import { uiCopy } from "../ui-copy.js";
import {
  type ShortcutPrefix,
  shortcutLabel,
  shortcutSpokenLabel,
} from "./display.js";
import { type ProductShortcutId, productShortcutIds } from "./index.js";

interface ShortcutReferenceRow {
  /** The action this row is about. A reader that edits a binding — the Keyboard
   *  tab — needs the id to write back, and a row that carried only its label
   *  would force that reader to match on words. */
  readonly action: ProductShortcutId;
  readonly label: string;
  /** The platform's own mark, as the sheet prints it (`⌘Z`). */
  readonly chord: string;
  /** What that mark is called (`Command Z`), which is the chip's `aria-label`:
   *  a screen reader reads `⌘` as "place of interest sign". */
  readonly spoken: string;
}

interface ShortcutReferenceGroup {
  readonly label: string;
  readonly rows: readonly ShortcutReferenceRow[];
}

/**
 * One word per action, reusing `uiCopy`'s existing names rather than writing a
 * second vocabulary for the same things: `Redo` is `uiCopy.actions.redo` in the
 * Edit menu, in the context menu and here. The `satisfies` is load-bearing — a
 * `ProductShortcutId` added to the table with no word fails to compile, which is
 * the only thing standing between a new binding and a silently shorter sheet.
 */
export const SHORTCUT_LABELS = {
  "file.new": uiCopy.file.newDocument,
  // The chord the File menu prints beside its *Import package* row, and the
  // word is the row's own: `file.open` names the chord the action is bound to,
  // and the row it is printed beside is what a person reads.
  "file.open": uiCopy.file.importPackage,
  "file.save": uiCopy.file.saveLibrary,
  "file.findAssets": uiCopy.file.findAssets,
  "edit.undo": uiCopy.actions.undo,
  "edit.redo": uiCopy.actions.redo,
  "edit.delete": uiCopy.actions.delete,
  "edit.copy": uiCopy.actions.copy,
  "edit.cut": uiCopy.actions.cut,
  "edit.duplicate": uiCopy.actions.duplicate,
  "edit.group": uiCopy.actions.group,
  "edit.ungroup": uiCopy.actions.ungroup,
  // `canvas.select-all` and the four nudges have no label anywhere else, because
  // no menu offers them and no control draws them. These are the only words for
  // them and they live here rather than being invented per surface.
  "canvas.select-all": "Select all",
  "canvas.nudge-left": "Nudge left",
  "canvas.nudge-right": "Nudge right",
  "canvas.nudge-up": "Nudge up",
  "canvas.nudge-down": "Nudge down",
  "canvas.front": uiCopy.actions.front,
  "canvas.back": uiCopy.actions.back,
  // The header's own chord. It opens the publish surface; the host switch
  // inside it is a different act, so the row names the opening rather than
  // borrowing the switch's own words.
  "publish.surface": uiCopy.publish.open,
  // `view.exit-group` is a `ProductShortcutId` with **no product binding** — it is
  // bound on `Escape` in `CONTEXT_SHORTCUTS` and the file's own comment says it is
  // never displayed. It needs a word all the same, because `satisfies` below is
  // total over the *union* and the compiler refuses a member with no entry; the word
  // is one `uiCopy` already has for this exact act (`layer-panel.tsx:718` pairs
  // `panels.leave`/`panels.enter` with `bridge.exitGroup()`/`enterGroup()`).
  // It never reaches the sheet: `shortcutReferenceGroups()` iterates
  // `productShortcutIds()`, which is a projection of the table and so excludes it.
  "view.exit-group": uiCopy.panels.leave,
  // The sheet's own name, which is `uiCopy.shortcuts.reference` — the same word
  // the sheet's heading prints and the `aria-label` on its Dialog carries, so the
  // row and the surface cannot disagree.
  // Exported for the one reader that has to name another action in a sentence:
  // the Keyboard tab's refusal, when a captured chord belongs to somebody else.
  // A second vocabulary for the same acts is what this table exists to prevent.
  "help.shortcuts": uiCopy.shortcuts.reference,
} as const satisfies Record<ProductShortcutId, string>;

/** The group an id belongs to: the part of its name before its first dot. */
function prefixOf(action: ProductShortcutId): ShortcutPrefix {
  return action.slice(0, action.indexOf(".")) as ShortcutPrefix;
}

/**
 * The table as directions an author reads, grouped by where the action lives,
 * in the table's own order — the same order `shortcutLabel` renders chords in,
 * so the sheet and a tooltip can never disagree about what a key is.
 */
export function shortcutReferenceGroups(): readonly ShortcutReferenceGroup[] {
  const groups = new Map<string, ShortcutReferenceRow[]>();
  for (const action of productShortcutIds()) {
    const prefix = prefixOf(action);
    const rows = groups.get(prefix) ?? [];
    rows.push({
      action,
      label: SHORTCUT_LABELS[action],
      chord: shortcutLabel(action),
      spoken: shortcutSpokenLabel(action),
    });
    groups.set(prefix, rows);
  }
  return [...groups].map(([prefix, rows]) => ({
    label: uiCopy.shortcuts.groups[prefix as ShortcutPrefix],
    rows,
  }));
}
