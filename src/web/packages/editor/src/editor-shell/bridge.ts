import {
  type Binding,
  type FabricPalette,
  isObjectName,
} from "@yunari/renderer-core";
import { isLocked, YunariChart } from "@yunari/scene-fabric";
import { ActiveSelection, type FabricObject, Group } from "fabric/es";
import { type ArrangeAction, applyArrange, canArrange } from "../arrange.js";
import type { EditorInteraction } from "../editor-interaction.js";
import { GROUP_CONTEXT_EVENT } from "../grouping-manager/index.js";
import {
  actionEnabled,
  constructedShape,
  isConstructionAction,
  type ObjectActionId,
  type ObjectTarget,
} from "../object-actions.js";
import { paletteTokenIds } from "../palette-manager/token-list.js";
import { typePresetOf } from "../selection-inspector/appearance.js";
import {
  BACKGROUND_LAYER_ID,
  backgroundRow,
  findById,
  type LayerRow,
  ownerOf,
  pathTo,
  projectLayers,
} from "./layer-tree.js";

import type { EditorActionFacade } from "./session-facade.js";

/** Selection-kind routing for menu/tab eligibility. Transient, never persisted.
 *  `background` is a layer selection rather than a Fabric one: it is outside
 *  every object action's kind, so those are ineligible by construction. */
export type ActiveKind = "none" | "object" | "group" | "chart" | "background";

/** The object actions the shell can run; the registry owns the ids. */
type ShellAction = ObjectActionId;

export interface EditorShellSnapshot {
  /** The scene's own object total — §7.6's left readout, and the one fact the
   *  strip carries that is not a message. The scene is the canvas, so this is
   *  counted there rather than held here.
   *
   *  `undefined` where there is no scene to count. A strip reading `0 objects`
   *  over a canvas that has not mounted its document is a claim the product
   *  does not have (DESIGN.md §9), and the absence is what says so — the same
   *  shape `documentName` takes for the document it names. A document that
   *  really holds nothing reports `0`, which is a reading rather than a
   *  default, and the two are different answers. */
  readonly objectCount: number | undefined;
  /** The Tokens pane's own list, as §7.3's title bar counts it: the theme's
   *  paints, minus the reserved `none` (`paletteTokenIds`, the same module
   *  `PaintList` draws its rows from — one membership rule, so the number beside
   *  the title and the rows under it cannot disagree).
   *
   *  A number rather than `number | undefined` wherever a bridge exists: the
   *  bridge is only built over an open document, and a document whose globals
   *  declare no palette really holds none — `0 tokens` there is a reading, the
   *  same way `0 objects` is for an empty document. The `undefined` case is the
   *  shell's own no-document state, stated by `SelectionStore` before a bridge
   *  is set, where the pane draws no count at all (DESIGN.md §9). */
  readonly tokenCount: number | undefined;
  readonly selectedCount: number;
  readonly locked: boolean;
  readonly activeKind: ActiveKind;
  /** The document's identity, as the session reports it (§7.5): the theme's own
   *  name, or its id where the theme carries no name. `undefined` only while no
   *  document is open — never `""`, because a chip that named nothing is a
   *  claim the product does not have. The reading is `documentNameOf`, the same
   *  one the status line takes, so the two cannot disagree (vg-218). */
  readonly documentName: string | undefined;
  /** The open document's release version (`ThemeMetadata.version`), or
   *  `undefined` where it carries none. The same fact the Document pane's
   *  `releaseVersion` row reads, pulled through this one projection so the
   *  About tab and the pane cannot disagree. Optional because there is no
   *  document and no version to read before a bridge is set, and the
   *  no-document snapshot below states only the facts it has. */
  readonly releaseVersion?: string | undefined;
  /** The library key the selection's own first run is set in, or nothing when
   *  it carries no preset — a shape, a group, a run with no reference — which
   *  is a different answer from `""` and from the first declared preset. The
   *  Tokens pane reads this so its chooser opens on what the selection is
   *  actually set in rather than on `Object.keys(presets)[0]` (`vg-094`). */
  readonly selectionPresetId: string | undefined;
}

/**
 * Where a drop lands. The anchor names the container when the anchor *is* the
 * container — a group with nothing in it, whose row is the whole of its
 * representation; otherwise the anchor names a sibling slot beside it.
 */
export type LayerDrop =
  | { readonly kind: "slot"; readonly before: string }
  | { readonly kind: "into"; readonly container: string };

export interface EditorShellBridge {
  snapshot(): EditorShellSnapshot;
  /** The registry's view of the selection. Serializable; never a FabricObject. */
  target(): ObjectTarget;
  can(action: ShellAction): boolean;
  canArrange(action: ArrangeAction): boolean;
  /** The layer tree, projected from Fabric on demand (§172), plus the
   *  background's synthetic bottom row. */
  layers(): readonly LayerRow[];
  /** Whether the background is selected. Mutually exclusive with a Fabric
   *  selection: selecting one always clears the other. */
  backgroundSelected(): boolean;
  /** Ids of the entered group, as the panel reads them — never Fabric objects.
   * The group's descendants are inside the context too, which the panel derives
   * from the projection's own parent links. */
  groupContext(): readonly string[];
  /** Selects the rows named, replacing the selection. Ids the tree no longer
   * holds are ignored, and a row that resolves through its owning group selects
   * that group, exactly as `selectLayer` does. An empty list clears; a list
   * that resolves to nothing is a refusal, which is what `selectLayer` has
   * always done with an id it cannot resolve. */
  selectLayers(ids: readonly string[]): void;
  /** Selects a row's object: directly inside the entered group, else through the
   * group that owns it. One row is a set of one, so this is `selectLayers`
   * itself. */
  selectLayer(id: string): void;
  /** Enters the group a row names, so its descendants become the reachable rows
   * the panel stops dimming. A row that is not a group, and an id the tree no
   * longer holds, change nothing. */
  enterGroup(id: string): void;
  /** Steps back out of the entered group. Nothing entered leaves everything
   * alone. */
  exitGroup(): void;
  /** Hiding leaves the selection alone; showing reveals the whole ancestor path. */
  setLayerVisible(id: string, visible: boolean): void;
  setLayerLocked(id: string, locked: boolean): void;
  /** Transient view state: never authored history, never a Fabric write (§67).
   * A group with children is shut until this opens it. */
  setCollapsed(id: string, collapsed: boolean): void;
  /** Editor-only display state: never authored history, never a Fabric write. */
  renameLayer(id: string, name: string): void;
  /** What a drop of `id` on `anchorId` would do, or `undefined` when it is
   * refused. The panel asks this to mark what it draws, so the mark and the
   * move come from one comparison rather than two that must agree. */
  layerDrop(id: string, anchorId: string): LayerDrop | undefined;
  /** Performs the drop `layerDrop` just answered for. `true` when the move
   * happened; a refusal changes nothing. */
  moveLayer(id: string, anchorId: string): boolean;
  subscribe(listener: () => void): () => void;
  run(action: ShellAction): void;
  /**
   * The product's own library picture, as a data URL. e2e measures this rather
   * than re-deriving `toCanvasElement`, which is how a change to the capture
   * would otherwise stop being measured (0007).
   */
  capture(): string | undefined;
  readonly session: EditorActionFacade;
  readonly editor: EditorInteraction;
  destroy(): void;
}

/** Fabric's runtime `type` getter lowercases the class tag, so identity is the
 * reliable chart discriminator; the persisted envelope keeps "YunariChart". */
function activeKindOf(active: FabricObject | undefined): ActiveKind {
  if (active === undefined) return "none";
  if (active instanceof ActiveSelection || active instanceof Group)
    return "group";
  return active instanceof YunariChart ? "chart" : "object";
}

/**
 * The document's name, else its id — the one reading of what a document is
 * called.
 *
 * Spelled out at each reader it drifted: the identity chip took the fallback on
 * an empty name and the status line did not, so an unnamed theme showed its id
 * in the chip and a blank `Opened ` in the status line — and the publish
 * control's `Showing …` line kept the empty name too. Every reader in
 * `packages/editor/src` calls this one (vg-218). `||`, not `??`: an empty stored
 * name is a name the document does not have, and the id behind it is what the
 * schema guarantees is there.
 */
export function documentNameOf(identity: {
  readonly name: string | undefined;
  readonly id: string;
}): string {
  return identity.name || identity.id;
}

/** The status line's wording for the document that just opened. */
export function openedStatusText(identity: {
  readonly name: string | undefined;
  readonly id: string;
}): string {
  return `Opened ${documentNameOf(identity)}`;
}

/** Product panels depend only on the editor mechanics they exercise. */
export function createEditorShellBridge(input: {
  readonly editor: EditorInteraction;
  readonly session: EditorActionFacade;
  /** The document's semantic bindings, keyed by Fabric object id. Envelope
   * state the session owns; a layer row reads it so the key it prints is the
   * document's rather than a string the panel wrote. Optional, and absent reads
   * as no bindings — a bridge with no document behind it says so rather than
   * refusing to project. */
  readonly bindings?: () => Readonly<Record<string, readonly Binding[]>>;
  /** The open document's identity, pulled the way `bindings` is: the session
   *  owns both facts. Absent reads as no document open. `version` is the theme's
   *  own `metadata.version`, the release fact the About tab shows; absent where
   *  the document carries none. */
  readonly documentIdentity?: () => {
    readonly name: string | undefined;
    readonly id: string;
    readonly version: string | undefined;
  };
  /** The theme's palette, pulled the way `bindings` and `documentIdentity` are:
   *  the session owns the document, so the Tokens pane's count reads the live
   *  palette rather than a copy this bridge was built with — a token added,
   *  renamed or deleted afterwards moves the number. Absent reads as no theme,
   *  which is no palette and so no tokens. */
  readonly palette?: () => FabricPalette | undefined;
  /** The product's own library capture; see `EditorShellBridge.capture`. */
  readonly capture: () => string | undefined;
}): EditorShellBridge {
  const { canvas } = input.editor;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  // The background is not a Fabric object, so its selection lives beside the
  // canvas's. The two are mutually exclusive; the events below enforce it.
  let backgroundSelected = false;
  // The projection reads object state — the display name lives on the object
  // beside the id — so a change to an object republishes the rows. Selection
  // alone is not enough: renaming from the inspector moves no selection, and a
  // stale row would leave the layer list disagreeing with the field that
  // changed it.
  // A Fabric selection always clears the background: the two are never mixed
  // into one set, whichever surface raised the selection.
  const settleSelection = (): void => {
    backgroundSelected = false;
    notify();
  };
  const selectionEvents = [
    "selection:created",
    "selection:updated",
    "selection:cleared",
  ] as const;
  const events = [
    "object:modified",
    // A deleted object fires no selection event, so the layer list kept
    // showing a row for something the canvas no longer had — and the inspector
    // went on reading its geometry. Deletion is the one edit that most needs the
    // projection to move, because the row it removes is the proof it happened.
    "object:removed",
    "object:added",
    // Entering or leaving a group moves no selection, so Fabric fires nothing
    // for it — the panel would repaint only when something unrelated did.
    GROUP_CONTEXT_EVENT,
  ] as const;
  for (const event of selectionEvents)
    canvas.on(event as never, settleSelection);
  for (const event of events) canvas.on(event as never, notify);
  // A rename moves no object, so none of the canvas events above fire for it —
  // the session's own document change is the only signal that the name it
  // reports has moved. Without it a snapshot keeps the name the bridge was
  // built with for as long as the document is open.
  const offDocumentChange = input.session.subscribeDocumentChange(notify);
  const activeObject = ():
    | (FabricObject & { readonly locked?: boolean })
    | undefined =>
    canvas.getActiveObject() as
      | (FabricObject & { readonly locked?: boolean })
      | undefined;
  const snapshot = (): EditorShellSnapshot => {
    const active = activeObject();
    const identity = input.documentIdentity?.();
    // The reference `typePresetOf` owns; the pane's keys are its tail, so the
    // prefix is dropped once here rather than at every reader of the field.
    const presetRef = active === undefined ? undefined : typePresetOf(active);
    return {
      // Counted here, off the canvas, so the strip and the layer list read one
      // scene. The bridge only exists over a mounted document, so this reading
      // is always a number; the snapshot's `undefined` is the shell's own
      // no-scene state, stated by `SelectionStore` before a bridge is set.
      objectCount: canvas.getObjects().length,
      // Counted through the palette's own membership rule, so the pane's title
      // bar and its rows are one list rather than two that must agree.
      tokenCount: paletteTokenIds(input.palette?.() ?? {}).length,
      selectedCount: backgroundSelected
        ? 1
        : active instanceof ActiveSelection
          ? active.getObjects().length
          : active === undefined
            ? 0
            : 1,
      locked: backgroundSelected
        ? false
        : active !== undefined && isLocked(active),
      activeKind: backgroundSelected ? "background" : activeKindOf(active),
      // The fallback is taken on `""` as well as on an absent name: the schema
      // now refuses an empty one and the loader supplies a name (`vg-221`), but
      // this is a reading of whatever the document holds, by the one reading the
      // status line takes as well.
      documentName:
        identity === undefined ? undefined : documentNameOf(identity),
      releaseVersion: identity?.version,
      selectionPresetId: presetRef?.slice("typePresets.".length),
    };
  };
  const target = (): ObjectTarget => {
    const base = snapshot();
    const active = canvas.getActiveObject();
    return {
      // The background has no Fabric subject, so the action gate sees none and
      // every object action is refused by construction.
      kind: base.activeKind === "background" ? "none" : base.activeKind,
      locked: base.locked,
      memberCount: base.selectedCount,
      // ActiveSelection extends Group, so the negative case has to be explicit:
      // a bare multi-selection is not a Group for ungroup/group eligibility.
      isGroup: active instanceof Group && !(active instanceof ActiveSelection),
    };
  };
  const canArrangeAction = (action: ArrangeAction): boolean =>
    canArrange(input.editor, action);
  const gate = { target, canArrange: canArrangeAction };
  /** Eligibility is owned by the registry; all this adds is the selection gate —
   * and the one exemption from it. A construction needs no subject, so it is
   * available with nothing selected, which is the whole of what `vg-460` asks
   * for; every other action still has to have one. */
  const can = (action: ShellAction): boolean =>
    isConstructionAction(action) ||
    (activeObject() !== undefined && actionEnabled(gate, action));
  /** The entered group, as objects — the manager's own transient state (§67). */
  const enteredContext = (): readonly FabricObject[] =>
    input.editor.groupingManager.groupContext();
  const groupContext = (): readonly string[] =>
    enteredContext()
      .map((object) => (object as { id?: unknown }).id)
      .filter((id): id is string => typeof id === "string");
  // View state lives here, not in the panel: the projection reads it, so a
  // remount keeps the groups the author opened. It holds the *open* groups
  // rather than the shut ones, so a group is shut by default — an eight-card
  // starter opens as ten rows rather than sixty — without this shell having to
  // enumerate groups to seed anything, and a group created later is shut too.
  const openedGroups = new Set<string>();
  /**
   * What the panel is shown: the author's own openings, plus whatever the
   * canvas has entered.
   *
   * **Derived, not recorded.** A double-click that enters a card makes the
   * author inside it, and a tree still showing that card shut with an *Expand*
   * button is telling them they are somewhere they are not — the one place the
   * panel could contradict the canvas outright. Reading the context here rather
   * than writing to `openedGroups` from `grouping-manager` is what keeps the two
   * surfaces on one path: leaving the group shuts it again because the context
   * no longer names it, and a group the author had opened themselves stays open,
   * which a recorded expansion would have shut behind them.
   *
   * The ancestor path is included because a group is entered by one hop from
   * whatever was selected, so a nested entry whose parent is shut would
   * otherwise expand a row the panel never shows.
   */
  const expansionFor = (): ReadonlySet<string> => {
    const entered = groupContext();
    if (entered.length === 0) return openedGroups;
    const expanded = new Set(openedGroups);
    const root = canvas.getObjects();
    for (const id of entered)
      for (const ancestor of pathTo(root, id)) {
        const ancestorId = (ancestor as { id?: unknown }).id;
        if (typeof ancestorId === "string") expanded.add(ancestorId);
      }
    return expanded;
  };
  const layers = (): readonly LayerRow[] => {
    const active = canvas.getActiveObject();
    const selected =
      active instanceof ActiveSelection
        ? active.getObjects()
        : active === undefined
          ? []
          : [active];
    return [
      ...projectLayers({
        root: canvas.getObjects(),
        selected,
        expanded: expansionFor(),
        // Pulled, never held: bindings are envelope state the session owns, and
        // a row whose bound key went stale after an edit would name a key the
        // document no longer declares.
        ...(input.bindings === undefined ? {} : { bindings: input.bindings() }),
      }),
      // Appended, not projected: the background is structurally last, so no
      // restack or drop path can move it below or above an object.
      backgroundRow({ selected: backgroundSelected }),
    ];
  };
  /**
   * The rows named, as one selection.
   *
   * Gesture-neutral on purpose: "extend" is a fact about a list the composition
   * pane is rendering, and this is the editor's Fabric boundary rather than a
   * gesture interpreter — the pane decides *which* ids, this decides what they
   * select.
   */
  const selectLayers = (ids: readonly string[]): void => {
    // The background is a selection of its own, never a set member: a shift or
    // ctrl gesture that would include it selects it alone.
    if (ids.includes(BACKGROUND_LAYER_ID)) {
      // Ordered after the discard: Fabric fires `selection:cleared` from it,
      // and `settleSelection` would otherwise clear the flag just set.
      canvas.discardActiveObject();
      backgroundSelected = true;
      canvas.requestRenderAll();
      notify();
      return;
    }
    // Every other selection — including the empty clear gesture — puts the
    // background down, so the two are never both selected.
    backgroundSelected = false;
    const root = canvas.getObjects();
    // An empty list is the clear gesture, and it is the only route to one: the
    // pane sends `[]` when a toggle takes the last row out.
    if (ids.length === 0) {
      canvas.discardActiveObject();
      canvas.requestRenderAll();
      notify();
      return;
    }
    const entered = enteredContext();
    const subjects: FabricObject[] = [];
    for (const id of ids) {
      const target = findById(root, id);
      if (target === undefined) continue;
      const owner = ownerOf(root, id);
      // Inside the entered group its children are reachable in their own right,
      // so a tree click selects one directly; anywhere else a group child is
      // selected through its owning group, since a bare child has no transform
      // controls.
      const subject =
        owner !== undefined && entered.includes(owner)
          ? target
          : (owner ?? target);
      // **After resolution, not before.** Two rows inside one group both resolve
      // to that group when it is not entered, and a range across them must not
      // select it twice.
      if (!subjects.includes(subject)) subjects.push(subject);
    }
    if (subjects.length === 0) return;
    // Three cases, three shapes, and the single one matters: wrapping one object
    // in an `ActiveSelection` would change the selection inspector's kind from
    // the object's own to `activeSelection` and lose the per-kind column.
    canvas.setActiveObject(
      subjects.length === 1
        ? subjects[0]!
        : new ActiveSelection(subjects, {
            canvas,
            multiSelectionStacking: "selection-order",
          }),
    );
    canvas.requestRenderAll();
    notify();
  };
  /** One row is a set of one, so the group-resolution rule above exists once. */
  const selectLayer = (id: string): void => selectLayers([id]);
  const enterGroup = (id: string): void => {
    const root = canvas.getObjects();
    const target = findById(root, id);
    // A non-group row is something to select, not somewhere to go: handed
    // straight to the manager it would resolve to whatever group owns it — an
    // entry the author never asked for.
    if (!(target instanceof Group)) return;
    // `enterGroup` enters the group *around* the object it is handed, one hop up
    // `ownerGroup`. A group inside another therefore has to be reached through
    // one of its own children: handing over the group itself would enter its
    // owner, and the panel would dim the rows around the parent the author did
    // not press while the row they did press named something else. A nested
    // group with no children has nothing to reach it through, so it stays shut.
    const entry =
      target.parent instanceof Group ? target.getObjects()[0] : target;
    if (entry === undefined) return;
    input.editor.groupingManager.enterGroup({ object: entry });
    // Unconditional, as in `selectLayer`: the manager announces a context change
    // only when there is one, so an entry the projection already agreed with
    // would otherwise leave the panel rendering the context it had.
    notify();
  };
  const exitGroup = (): void => {
    input.editor.groupingManager.exitGroup();
    notify();
  };
  const setLayerVisible = (id: string, visible: boolean): void => {
    const target = findById(canvas.getObjects(), id);
    if (target === undefined) return;
    // Showing a descendant whose ancestor is hidden would show nothing, so the
    // whole path is revealed; hiding touches only the requested object.
    if (visible)
      for (const entry of pathTo(canvas.getObjects(), id))
        entry.set("visible", true);
    else target.set("visible", false);
    target.setCoords();
    canvas.requestRenderAll();
    input.editor.historyManager.saveState();
    notify();
  };
  const setLayerLocked = (id: string, locked: boolean): void => {
    const root = canvas.getObjects();
    const target = findById(root, id);
    if (target === undefined) return;
    // Locks go through the owning group for the same reason selection does.
    const subject = ownerOf(root, id) ?? target;
    if (locked) input.editor.objectLockManager.lockObject({ object: subject });
    else input.editor.objectLockManager.unlockObject({ object: subject });
    notify();
  };
  const setCollapsed = (id: string, collapsed: boolean): void => {
    if (collapsed) openedGroups.delete(id);
    else openedGroups.add(id);
    notify();
  };
  const renameLayer = (id: string, name: string): void => {
    const target = findById(canvas.getObjects(), id);
    if (target === undefined) return;
    const trimmed = name.trim();
    if (trimmed === "") target.set("name", undefined);
    else if (isObjectName(trimmed)) target.set("name", trimmed);
    // Anything else is refused rather than written: clearing on a too-long
    // name would make an author's typing vanish. The caller re-reads the
    // projection afterwards, so a refused rename reverts the row to the name
    // the object actually carries.
    else return;
    // The name is authored document state on the object, so this is a
    // committed edit like any other: one history entry (§67).
    canvas.requestRenderAll();
    input.editor.historyManager.saveState();
    notify();
  };
  /**
   * The structural shape of a drop, or `undefined` when it cannot land — one
   * owner for the question, because two askers have to agree: the panel marks
   * only what `layerDrop` answers for, and a plan that said "slot" to one and
   * "refusal" to the other is the failure `vg-099` is about.
   *
   * `anchorId` names both the container (its own parent) and the position
   * (directly above it), which is what lets one anchor express entering a
   * group, leaving one, and restacking inside one. **An empty group is the
   * exception, and it is a container rather than a slot.** Not because it draws
   * no interior row — a *shut* group with children draws none either
   * (`layer-tree.ts:342`) — but because it has no rows to open: expanding is
   * the route to a group's interior, and a group with nothing in it has nothing
   * to expand, so its own row is the only thing that can ever name it. Without
   * that, a group emptied by dragging its last child out could never be filled
   * again by drag. A group with children keeps its row as a slot — which is
   * what makes dragging a row out of a group work — and its interior is
   * reachable through the child rows it draws.
   *
   * The cycle is refused here, in the tree's own terms, rather than left to
   * Fabric: its `canEnterGroup` *logs* a circular tree and drops the add, so an
   * author would get a move that silently did nothing (`vg-461`).
   */
  const layerMove = (
    id: string,
    anchorId: string,
  ):
    | {
        readonly moved: FabricObject;
        readonly from: Group | undefined;
        readonly to: Group | undefined;
        readonly target: number;
        readonly drop: LayerDrop;
      }
    | undefined => {
    const root = canvas.getObjects();
    const moved = findById(root, id);
    const anchor = findById(root, anchorId);
    if (moved === undefined || anchor === undefined || moved === anchor)
      return undefined;
    // The anchor inside the moved object: a group dropped on its own descendant
    // would be a container inside itself.
    if (pathTo(root, anchorId).includes(moved)) return undefined;
    const into = anchor instanceof Group && anchor.getObjects().length === 0;
    // Never `object.group`: an active selection temporarily repoints it at the
    // selection itself.
    const from = ownerOf(root, id);
    const to = into ? anchor : ownerOf(root, anchorId);
    const destination = to === undefined ? root : to.getObjects();
    // An empty container has one position and it is the first: there is nothing
    // to sit beside inside it.
    const anchorAt = into ? destination.length : destination.indexOf(anchor);
    if (anchorAt < 0) return undefined;
    // `anchorId` means directly above that row in the panel, and the panel paints
    // topmost-first, so in Fabric's bottom-first paint order the target is one
    // past the anchor. Fabric's `moveObjectTo` removes the object and then
    // splices at `index` in the *post-removal* array, so a move within one
    // collection from above the anchor shifts down by one — a move between two
    // collections does not, because nothing leaves the destination.
    let target = into ? anchorAt : anchorAt + 1;
    if (!into && from === to && destination.indexOf(moved) < target)
      target -= 1;
    return {
      moved,
      from,
      to,
      target,
      drop: into
        ? { kind: "into", container: anchorId }
        : { kind: "slot", before: anchorId },
    };
  };
  const layerDrop = (id: string, anchorId: string): LayerDrop | undefined =>
    layerMove(id, anchorId)?.drop;
  /**
   * Takes `object` out of the canvas root **without firing `object:removed`**.
   *
   * That event is the scene adapter's "this node left the scene", and it
   * disposes the object there (`scene-fabric/src/adapter.ts:62`): a chart's
   * ECharts instance and backing pixels are released while the object is about
   * to be inserted into a group and still serializes — a save that looks right
   * reloads wrong. A reparent is not a deletion, so every write a mover still
   * needs is reproduced and the event is not fired. Two owners write them and
   * this is which is which: the splice is `Collection.remove`'s, and everything
   * below is the removal hook it calls, `Canvas._onObjectRemoved`
   * (`fabric/src/canvas/SelectableCanvas.ts:356`) — the cached render list
   * (`:357`, which `add`, `remove` and the stack methods clear and the render
   * path reads at `:409`), the active object's deselection (`:359`), which is
   * why a live selection must not keep pointing at a row that has left its
   * plane, and the hovered target's release (`:367`). Only `super`'s tail is
   * skipped: the null `canvas`, the `object:removed` fire, and the object's own
   * `removed` — the object keeps its `canvas`, which is right, since its new
   * owner is a group on the same canvas.
   *
   * The deselection is Fabric's own `discardActiveObject`, so listeners hear
   * the selection events a real removal fires. The rest is written here because
   * Fabric reaches it nowhere outside the method that fires the event — and
   * that fire is the whole reason this function exists. Measured against the
   * removal path it stands in for, not inferred: `bridge.dom.test.ts`'s
   * "leaves the canvas in the state a removal leaves" compares the two states.
   *
   * The transform bake is deliberately *not* reproduced here: it is
   * `Group._enterGroup`'s, reached by the `insertAt` that follows.
   */
  const detachFromRoot = (object: FabricObject): boolean => {
    const at = canvas._objects.indexOf(object);
    if (at < 0) return false;
    canvas._objects.splice(at, 1);
    // `delete` rather than an `undefined` write: the field is optional under
    // `exactOptionalPropertyTypes`, and the render path tests it by truth.
    delete canvas._objectsToRender;
    if (canvas.getActiveObject() === object) canvas.discardActiveObject();
    if (canvas._hoveredTarget === object) {
      // `delete` for the reason above: Fabric writes `void 0` here, and this
      // field is declared optional too.
      delete canvas._hoveredTarget;
      canvas._hoveredTargets = [];
    }
    return true;
  };
  /**
   * Recomputes `object`'s cached box, and everything nested under it, deepest
   * first.
   *
   * A cached box is not a transform: Fabric's layout rebases a destination's
   * children when the membership changes (`FitContentLayout.shouldPerformLayout`
   * always answers true), but neither `Group.setCoords` nor the layout pass
   * cascades while `subTargetCheck` is false, so the rows' `left`/`top` move
   * under a cached box nothing recomputed — and `sceneBoxesOf` reads those
   * caches, so the artboard reported a box the document does not have.
   * `grouping-manager` refreshes its members for the same reason.
   */
  const refreshCoords = (object: FabricObject): void => {
    if (object instanceof Group)
      for (const child of object.getObjects()) refreshCoords(child);
    object.setCoords();
  };
  const moveLayer = (id: string, anchorId: string): boolean => {
    const move = layerMove(id, anchorId);
    if (move === undefined) return false;
    const { moved, from, to, target } = move;
    // A live `ActiveSelection` repoints each member's `group` at the selection
    // itself, so a `remove` issued against the tree's own parent would bake the
    // child against a matrix it no longer belongs to (0044, rung 6). Releasing
    // the selection puts every member back under its real parent first.
    const active = canvas.getActiveObject();
    if (active instanceof ActiveSelection && active.contains(moved))
      canvas.discardActiveObject();
    if (from === to) {
      // The receiver must be the collection `target` was measured against.
      // `moveObjectTo` is `createCollectionMixin`'s and exists on `Group` too
      // (`index.mjs:1162`, `:9132`), but it splices `this._objects` — so calling
      // it on the canvas while indexing the group's array would insert into the
      // root and leave the child inside the group, giving Fabric's paint and
      // serialization arrays one object each.
      if (!(from ?? canvas).moveObjectTo(moved, target)) return false;
    } else {
      // The two structural writes are Fabric's, and they are the point of 0044:
      // `remove` bakes the child out of the plane it leaves (`exitGroup`),
      // `insertAt` bakes it into the plane it enters (`enterGroup`) — the
      // symmetric pair Fabric's own `loadFromJSON` depends on. Nothing moves on
      // screen, and the container's box follows its membership. Only the root is
      // left silently, because only its removal is announced to the renderer.
      if (from === undefined) {
        if (!detachFromRoot(moved)) return false;
      } else from.remove(moved);
      (to ?? canvas).insertAt(target, moved);
      // The whole tree rather than the two collections this branch happens to
      // name. Which caches a reparent invalidated is a question about nesting,
      // not about which side of the drag a row is on: an ancestor's box is the
      // fit of its subtree, and the ancestor's *other* children read their own
      // box through the ancestor's matrix — so `outer[inner[a, b], peer]` leaves
      // `peer` stale, and neither collection named here is where `peer` lives.
      // `ponytail:` O(objects) per drop; narrow it to the ancestors if a
      // document ever makes that measurable.
      for (const object of canvas.getObjects()) refreshCoords(object);
    }
    canvas.requestRenderAll();
    input.editor.historyManager.saveState();
    notify();
    return true;
  };
  return {
    snapshot,
    target,
    can,
    canArrange: canArrangeAction,
    layers,
    backgroundSelected: () => backgroundSelected,
    groupContext,
    selectLayers,
    selectLayer,
    enterGroup,
    exitGroup,
    setLayerVisible,
    setLayerLocked,
    setCollapsed,
    renameLayer,
    layerDrop,
    moveLayer,
    session: input.session,
    editor: input.editor,
    capture: input.capture,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    run(action) {
      if (!can(action)) return;
      if (isConstructionAction(action)) {
        // The façade's own two routes, which pull the document's theme the way
        // the Add pane's tiles do — so the footer cannot build a poorer object
        // than the pane one gesture away. The new object's own `object:added` is
        // what republishes the tree, so this closes without a second notify.
        //
        // **A refusal is reported by the façade, not here** (`vg-484`): both
        // routes are wrapped in `new-object-panel.ts`'s `constructing`, the one
        // owner of a construction's refusal, so a theme with no usable token
        // says why instead of throwing out of this arm into a click handler.
        // This call is the footer's only route to a construction; the canvas
        // context menu's is the same façade method.
        const shape = constructedShape(action);
        if (shape === undefined) input.session.addText();
        else input.session.addShape(shape);
        return;
      }
      if (action.startsWith("arrange:")) {
        applyArrange(
          input.editor,
          action.slice("arrange:".length) as ArrangeAction,
        );
        notify();
        return;
      }
      if (action === "duplicate")
        void input.editor.clipboardManager.duplicate();
      else if (action === "copy") void input.editor.clipboardManager.copy();
      else if (action === "cut") void input.editor.clipboardManager.cut();
      else if (action === "delete") input.editor.deletionManager.deleteActive();
      else if (action === "front") input.editor.layerManager.bringToFront();
      else if (action === "bring-forward")
        input.editor.layerManager.bringForward();
      else if (action === "send-backward")
        input.editor.layerManager.sendBackwards();
      else if (action === "back") input.editor.layerManager.sendToBack();
      else if (action === "lock") input.editor.objectLockManager.lockObject();
      else if (action === "unlock")
        input.editor.objectLockManager.unlockObject();
      else if (action === "group") input.editor.groupingManager.group();
      else if (action === "ungroup") input.editor.groupingManager.ungroup();
      notify();
    },
    destroy() {
      for (const event of selectionEvents)
        canvas.off(event as never, settleSelection);
      for (const event of events) canvas.off(event as never, notify);
      offDocumentChange();
      listeners.clear();
    },
  };
}
