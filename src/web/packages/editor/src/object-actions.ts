import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Copy,
  CopyPlus,
  Group,
  Lock,
  type LucideIcon,
  Scissors,
  Trash2,
  Ungroup,
  Unlock,
} from "lucide-react";
import { type ArrangeAction, applyArrange, arrangeMinimum } from "./arrange.js";
import type { EditorInteraction } from "./editor-interaction.js";
import { KIND_GLYPHS, SHAPE_GLYPHS } from "./editor-shell/icons.js";
import { SHAPE_KINDS, type ShapeKind } from "./new-object-defaults.js";
import type { ProductShortcutId } from "./shortcut-manager/index.js";
import { uiCopy } from "./ui-copy.js";

/** What a surface may render an action against. Serializable, Fabric-free.
 *  `locked` is the shared predicate's answer — `scene-fabric`'s `isLocked`,
 *  asked once by the bridge against the live object — so nothing here tests the
 *  flag or re-derives the vocabulary. */
export interface ObjectTarget {
  readonly kind: "none" | "object" | "group" | "chart";
  readonly locked: boolean;
  readonly memberCount: number;
  /** True when the active object is a Group (ungroup), false for a bare selection. */
  readonly isGroup: boolean;
}

export type ObjectActionId = ObjectCommandId | ConstructionActionId;

/** An object command: it acts on the selection, from a projection of what the
 *  selection is. */
export type ObjectCommandId =
  | "duplicate"
  | "copy"
  | "cut"
  | "delete"
  | "front"
  | "bring-forward"
  | "send-backward"
  | "back"
  | "lock"
  | "unlock"
  | "group"
  | "ungroup"
  | `arrange:${ArrangeAction}`;

/** A construction: it needs no subject, and the id names what it makes — the
 *  kind rides in the id's tail exactly as an arrange verb rides in its own, so
 *  one dispatch carries the whole question. */
export type ConstructionActionId = "new-text" | `new-shape:${ShapeKind}`;

/** What every entry carries, whichever half of the registry it is in: the word
 *  it is called, the glyph it wears, and the mark. */
interface ActionIdentity {
  readonly id: ObjectActionId;
  readonly label: string;
  readonly icon: LucideIcon;
  /** The product binding this action answers to, when there is one. A
   *  *reference*, never a chord: `shortcut-manager/display.ts` decides how a
   *  chord reads, so a `"Ctrl+D"` written here would be a second owner of the
   *  chord and would not follow the platform. Omitted rather than `undefined`,
   *  per `exactOptionalPropertyTypes`; the absence is the fact that the product
   *  binds nothing. */
  readonly shortcut?: ProductShortcutId;
  /** the palette: this action destroys, so a surface marks its control `--hot`. Omitted
   *  rather than `false`, per `exactOptionalPropertyTypes`; the absence is the
   *  fact that it does not, and the registry is the one owner of the decision. */
  readonly destructive?: true;
}

interface ObjectAction extends ActionIdentity {
  readonly id: ObjectCommandId;
  readonly eligible: (target: ObjectTarget) => boolean;
  readonly run: (editor: EditorInteraction) => void;
}

/**
 * An action that needs no selection: it constructs rather than commands, so it
 * is not gated on a subject (`vg-460`).
 *
 * **It carries no `eligible` and no `run`, and both absences are the fact.**
 * There is no rule to state, because the whole of this action's eligibility is
 * that a subject is not needed. And there is no executor here, because
 * constructing needs the document's theme and bindings — `new-object-panel.ts`
 * owns `insertNewText`/`insertNewShape`, which take `FabricGlobals` — and the
 * shell's façade is what holds them. So a surface dispatches the id through
 * `bridge.run`, and this registry states the verb rather than carrying a
 * second, poorer construction beside the one owner of it.
 */
export interface ConstructionAction extends ActionIdentity {
  readonly id: ConstructionActionId;
}

/** Whether there is a subject at all: the floor `hasUnlockedSelection` and
 *  `hasLockedSelection` are built on, and the question the layer footer asks
 *  before it draws the registry greyed (`vg-570`). */
export const hasSelection = (target: ObjectTarget): boolean =>
  target.kind !== "none";

/** Eligibility's own question: is there a selection this control may offer
 *  itself against. The lock term is the shared `locked` fact the projection
 *  carries, so the refusal `ClipboardManager` and `DeletionManager` each make
 *  is theirs and is not restated from outside them; `lock` reads the same term
 *  because a second lock is a no-op the control should not offer. */
const hasUnlockedSelection = (target: ObjectTarget): boolean =>
  hasSelection(target) && !target.locked;

/** `unlock`'s mirror. No manager refuses an unlocked object — there is simply
 *  nothing to unlock. */
const hasLockedSelection = (target: ObjectTarget): boolean =>
  hasSelection(target) && target.locked;

/**
 * What an action surface needs to know about itself to gate a control.
 * Deliberately no per-id `can`: eligibility carries the whole rule, so a `can`
 * here would only ever re-enter `actionEnabled`.
 */
export interface ActionGate {
  readonly target: () => ObjectTarget;
  readonly canArrange: (action: ArrangeAction) => boolean;
}

/** The one predicate both action surfaces use, so they cannot drift. */
export function actionEnabled(gate: ActionGate, id: ObjectCommandId): boolean {
  if (!objectAction(id).eligible(gate.target())) return false;
  return (
    !id.startsWith("arrange:") ||
    gate.canArrange(id.slice("arrange:".length) as ArrangeAction)
  );
}

/**
 * Every object command this gate can run, in registry order — the dock, the
 * canvas context menu and the layer footer all render this rather than
 * re-filtering, so a surface cannot advertise an action its selection refuses.
 * The eight arrange actions are *not* here: they grey rather than disappear, so
 * they come from `arrangeActions()`, which the selection inspector's lead
 * draws. Neither are the constructions: they need no selection, so a filter
 * over what a selection can run has nothing to say about them, and
 * `CONSTRUCTION_ACTIONS` is where they are read.
 */
export function objectActionsFor(gate: ActionGate): readonly ObjectAction[] {
  return OBJECT_ACTIONS.filter((action) => actionEnabled(gate, action.id));
}

/**
 * The destructive mark, as the attributes a surface spreads onto the control
 * it draws for an action: `data-yunari-destructive` when the registry says the
 * action destroys, and nothing otherwise. One owner for the attribute name and
 * the decision, so a surface that renders the registry cannot re-decide which
 * actions destroy — the mark reads the same on every one of them.
 */
export function destructiveMarker(action: {
  readonly destructive?: true;
}): Readonly<Record<`data-${string}`, string>> {
  return action.destructive === true ? { "data-yunari-destructive": "" } : {};
}

/** One owner for object actions: what each is, when it applies, how it runs. */
export const OBJECT_ACTIONS: readonly ObjectAction[] = [
  {
    id: "duplicate",
    label: uiCopy.actions.duplicate,
    icon: CopyPlus,
    shortcut: "edit.duplicate",
    eligible: hasUnlockedSelection,
    run: (e) => void e.clipboardManager.duplicate(),
  },
  {
    id: "copy",
    label: uiCopy.actions.copy,
    icon: Copy,
    shortcut: "edit.copy",
    eligible: hasUnlockedSelection,
    run: (e) => void e.clipboardManager.copy(),
  },
  {
    id: "cut",
    label: uiCopy.actions.cut,
    icon: Scissors,
    shortcut: "edit.cut",
    eligible: hasUnlockedSelection,
    run: (e) => void e.clipboardManager.cut(),
  },
  // No manager refuses on lock for the ordering actions, so they stay on bare
  // hasSelection: narrowing further would advertise a refusal that never happens.
  {
    id: "front",
    label: uiCopy.actions.front,
    icon: ArrowUpToLine,
    shortcut: "canvas.front",
    eligible: hasSelection,
    run: (e) => e.layerManager.bringToFront(),
  },
  // `bring-forward`, `send-backward`, `lock` and `unlock` carry no `shortcut`:
  // the product binds no chord for them, and the field's absence is that fact.
  {
    id: "bring-forward",
    label: uiCopy.actions.bringForward,
    icon: ArrowUp,
    eligible: hasSelection,
    run: (e) => e.layerManager.bringForward(),
  },
  {
    id: "send-backward",
    label: uiCopy.actions.sendBackward,
    icon: ArrowDown,
    eligible: hasSelection,
    run: (e) => e.layerManager.sendBackwards(),
  },
  {
    id: "back",
    label: uiCopy.actions.back,
    icon: ArrowDownToLine,
    shortcut: "canvas.back",
    eligible: hasSelection,
    run: (e) => e.layerManager.sendToBack(),
  },
  {
    id: "lock",
    label: uiCopy.actions.lock,
    icon: Lock,
    eligible: hasUnlockedSelection,
    run: (e) => e.objectLockManager.lockObject(),
  },
  {
    id: "unlock",
    label: uiCopy.actions.unlock,
    icon: Unlock,
    eligible: hasLockedSelection,
    run: (e) => e.objectLockManager.unlockObject(),
  },
  // GroupingManager reads no lock, so grouping stays on bare selection too.
  {
    id: "group",
    label: uiCopy.actions.group,
    icon: Group,
    shortcut: "edit.group",
    eligible: (t) => t.kind === "group" && t.memberCount > 1 && !t.isGroup,
    run: (e) => e.groupingManager.group(),
  },
  {
    id: "ungroup",
    label: uiCopy.actions.ungroup,
    icon: Ungroup,
    shortcut: "edit.ungroup",
    eligible: (t) => t.isGroup,
    run: (e) => e.groupingManager.ungroup(),
  },
  {
    id: "delete",
    label: uiCopy.actions.delete,
    icon: Trash2,
    shortcut: "edit.delete",
    destructive: true,
    eligible: hasUnlockedSelection,
    run: (e) => e.deletionManager.deleteActive(),
  },
];

const ARRANGE_ICONS: Readonly<Record<ArrangeAction, LucideIcon>> = {
  "align-left": AlignStartVertical,
  "align-center-x": AlignCenterVertical,
  "align-right": AlignEndVertical,
  "align-top": AlignStartHorizontal,
  "align-center-y": AlignCenterHorizontal,
  "align-bottom": AlignEndHorizontal,
  "distribute-x": AlignHorizontalDistributeCenter,
  "distribute-y": AlignVerticalDistributeCenter,
};

/**
 * Arrange's eligibility, as two numbers rather than a target: the toolbar
 * reads it from the shell snapshot's `selectedCount`, not from `target()`,
 * which is undefined until a bridge is set. The threshold comes from
 * `canArrange`'s own owner, so a control cannot advertise an action it refuses.
 */
function arrangeEligible(
  count: number,
  locked: boolean,
  id: ObjectActionId,
): boolean {
  return count >= arrangeMinimum(arrangeVerb(id)) && !locked;
}

/** The verb behind an `arrange:<verb>` id; this module owns that id format. */
function arrangeVerb(id: ObjectActionId): ArrangeAction {
  return id.slice("arrange:".length) as ArrangeAction;
}

/** Arrange is its own group: it needs two or more objects and its own owner. */
export function arrangeActions(): readonly ObjectAction[] {
  return (Object.keys(ARRANGE_ICONS) as ArrangeAction[]).map((action) => {
    const id = `arrange:${action}` as const;
    return {
      id,
      label: uiCopy.arrangeLabels[action],
      icon: ARRANGE_ICONS[action],
      // canArrange also refuses a locked member, so eligibility has to agree.
      eligible: (target) =>
        arrangeEligible(target.memberCount, target.locked, id),
      run: (editor) => void applyArrange(editor, action),
    };
  });
}

/**
 * The constructions, in the Add pane's own order: text, then one entry per
 * primitive. **No surface draws these** — the layer footer did, and the user
 * ruled that answer wrong on 2026-10-17 (`vg-570`): `vg-460` asked only that the
 * footer always show, and with nothing selected it draws the registry's commands
 * disabled instead. What is left is the id list `isConstructionAction` answers
 * from, so a construction reaching `bridge.can`/`bridge.run` still takes the
 * session façade's own route rather than the selection gate.
 *
 * **The set is the Add pane's primitives, and the words are the Add pane's own**
 * (`uiCopy.shapeKinds`, `uiCopy.panels.text` — the labels `insertGroups()` hands
 * its tiles), so a shape's id names the pane's own kind rather than a second
 * spelling of it, and a test pins the two lists equal. Cards and charts are
 * deliberately not here, and not for size: a chart family's word collides with a
 * shape's ("Line" is both) and the flat row these were built for had no heading
 * to tell them apart — the Add pane's own rule is that a heading is what makes
 * "Line" unambiguous. A card unit's mark is a hand-drawn diagram the Add pane
 * owns, and inserting one needs the document's bindings.
 */
export const CONSTRUCTION_ACTIONS: readonly ConstructionAction[] = [
  { id: "new-text", label: uiCopy.panels.text, icon: KIND_GLYPHS.text },
  ...SHAPE_KINDS.map((shape) => ({
    id: `new-shape:${shape}` as const,
    label: uiCopy.shapeKinds[shape],
    icon: SHAPE_GLYPHS[shape],
  })),
];

/** Whether an id names a construction rather than a command — the question
 *  `bridge.can` and `bridge.run` have to ask before the selection gate. */
export function isConstructionAction(
  id: ObjectActionId,
): id is ConstructionActionId {
  return CONSTRUCTION_ACTIONS.some((action) => action.id === id);
}

/** The primitive behind a `new-shape:<kind>` id, or `undefined` for the text
 *  one. This module owns that id format, so this is its one reader. */
export function constructedShape(
  id: ConstructionActionId,
): ShapeKind | undefined {
  return id === "new-text"
    ? undefined
    : (id.slice("new-shape:".length) as ShapeKind);
}

/**
 * One command by id: the object actions and the arrange verbs in one lookup.
 *
 * **The parameter is the whole id union, and the command half is what it
 * answers for.** Askers hold an `ObjectActionId` — the selection inspector's
 * arrange row and the lead that draws it both do — so narrowing the parameter
 * to `ObjectCommandId` would push a cast onto every caller asking a question
 * that is not about constructions at all. A construction id arriving here is
 * refused *by name* instead: it has no `run` (the shell's façade is the one
 * owner of building a new object, `ConstructionAction`), and a silent no-op or
 * a vague "unknown action" would be the failure an author cannot diagnose.
 */
export function objectAction(id: ObjectActionId): ObjectAction {
  if (isConstructionAction(id))
    throw new Error(
      `objectAction(): ${id} is a construction, not a command — it has no executor here, so the shell's run() is its route.`,
    );
  const found =
    OBJECT_ACTIONS.find((action) => action.id === id) ??
    arrangeActions().find((action) => action.id === id);
  if (found === undefined) throw new Error(`Unknown object action: ${id}`);
  return found;
}
