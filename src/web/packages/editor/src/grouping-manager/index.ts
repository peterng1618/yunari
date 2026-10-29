import {
  ActiveSelection,
  type Canvas,
  type FabricObject,
  Group,
  type Point,
} from "fabric/es";
import { findById } from "../editor-shell/layer-tree.js";
import { newObjectName } from "../new-object-defaults.js";

export interface GroupingManager {
  group(): Group | undefined;
  ungroup(): readonly FabricObject[] | undefined;
  /** Enters the group that owns `object`, or `object` itself, and selects it.
   * `scenePoint` picks the deepest child under the pointer instead: the flags
   * that make a group transparent to a pointer are only set here, so Fabric's
   * own hit test for the entering gesture still resolves to the group. */
  enterGroup(options?: {
    readonly object?: FabricObject;
    readonly scenePoint?: Point;
  }): FabricObject | undefined;
  /** Steps back out one level, clearing the through-selection flags. */
  exitGroup(): readonly FabricObject[] | undefined;
  /**
   * Lifts the artboard's dim for the duration of a capture and puts it back.
   * The dim is a view state, and a capture is the one reader that outlives the
   * view: it reads the document, not the screen.
   */
  suspendDim(): () => void;
  readonly groupContext: () => readonly FabricObject[];
  /** Releases the canvas listeners and the transient state they maintain. */
  destroy(): void;
}

interface GroupingManagerOptions {
  readonly canvas: Canvas;
  readonly save: () => void;
  readonly suspend: () => () => void;
}

const idOf = (object: FabricObject): string | undefined => {
  const id = (object as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
};

/** The nearest `Group` ancestor. Fabric keeps the owning group on `parent` even
 * while an `ActiveSelection` has taken the object off it, so one hop is the
 * whole walk. */
const ownerGroup = (object: FabricObject): Group | undefined => object.parent;

/** Fired on the canvas when the entered group changes; see `setContext`. */
export const GROUP_CONTEXT_EVENT = "editor:group-context-changed";

/**
 * What the artboard dims to outside the entered group, and it is the layer
 * list's own value (`.yunari-layer-row[data-context="false"]`): the two
 * surfaces must not disagree about what the author can currently reach, which is
 * the rule the design states.
 */
const DIM_OPACITY = 0.45;

export function createGroupingManager(
  options: GroupingManagerOptions,
): GroupingManager {
  const { canvas, save } = options;

  /** Selection state, not authored content (§67): never persisted, never history. */
  let context: FabricObject[] = [];

  /**
   * The entered context, announced when it changes.
   *
   * Entering a group does not move the selection — the group was already the
   * active object, so `setActiveObject` is a no-op and Fabric fires nothing.
   * The layer panel reads the context to dim the rows that are no longer
   * reachable, and it republishes only when the bridge is told, so without this
   * the dim appears only once something unrelated happens to re-project the
   * tree. The custom `editor:` event is the convention the other managers use.
   */
  const setContext = (next: readonly FabricObject[]): void => {
    const unchanged =
      context.length === next.length && context.every((o, i) => o === next[i]);
    context = [...next];
    if (!unchanged) canvas.fire(GROUP_CONTEXT_EVENT as never, {} as never);
  };
  /** Which of the two through-selection flags this manager set, so `exitGroup`
   * restores only those and leaves an author's own flags alone. */
  const flagsSet = new Set<Group>();
  /** The reachability this manager took away, with the values it replaced, so
   * leaving restores an author's own locks instead of assuming the defaults.
   * `selectable`/`evented` are not in Fabric's `stateProperties`, so this never
   * reaches a save — unlike `opacity`, which is (§67). */
  const reachabilityTaken = new Map<
    FabricObject,
    { selectable: boolean; evented: boolean }
  >();

  /** What this manager did to one object, or undefined if it did nothing. */
  const previousReachability = (
    object: FabricObject,
  ): { selectable: boolean; evented: boolean } => ({
    selectable: object.selectable,
    evented: object.evented,
  });

  const makeSelectableThrough = (group: Group): void => {
    if (group.subTargetCheck && group.interactive) return;
    flagsSet.add(group);
    group.subTargetCheck = true;
    group.interactive = true;
  };

  const clearThroughFlags = (): void => {
    for (const group of flagsSet) {
      group.subTargetCheck = false;
      group.interactive = false;
    }
    flagsSet.clear();
  };

  /** True when `object` is the entered group or lives inside it. */
  const inside = (object: FabricObject, entry: Group): boolean =>
    object === entry || (object.parent as Group | undefined) === entry;

  /** What the manager is dimming, and the cache each dim has been painted into. */
  const dimmed = new Map<
    FabricObject,
    {
      readonly onBeforeRender: (event: {
        readonly ctx: CanvasRenderingContext2D;
      }) => void;
      cacheContext: CanvasRenderingContext2D | undefined;
    }
  >();

  /**
   * Dims `object` and everything under it, and stops at the entered group: the
   * entry and its descendants are what the author is working inside, so they
   * keep their own alpha.
   *
   * **Two contexts, and they are not interchangeable.** Fabric hands the event
   * whichever surface it is painting on. On the live canvas the object's own
   * opacity has already been multiplied in and Fabric brackets the paint in a
   * `save`/`restore`, so the dim multiplies into it and is gone with the paint.
   * A cache is the object's own and is neither bracketed nor cleared between
   * repaints, so it takes the *value* rather than a multiplication — a
   * multiplication would compound on each repaint and would outlive the exit,
   * because nothing else ever writes that context's alpha.
   *
   * This is why a dimmed object is not forced uncached: a `clipPath` object is
   * cached whatever `objectCaching` says (`needsItsOwnCache` answers for it, and
   * a clip composites with `destination-in`, which needs a cache to happen on),
   * and a cached paint is the paint. `Group` carries no listener at all, because
   * Fabric overrides `Group.drawObject` and a group never fires `before:render`;
   * its children are dimmed individually, one multiplication each.
   */
  const dimOutside = (object: FabricObject, entry: Group): void => {
    if (object === entry) return;
    const children = object instanceof Group ? object.getObjects() : undefined;
    if (children !== undefined)
      for (const child of children) dimOutside(child, entry);
    if (dimmed.has(object)) return;
    const record = {
      cacheContext: undefined as CanvasRenderingContext2D | undefined,
      onBeforeRender: ({ ctx }: { readonly ctx: CanvasRenderingContext2D }) => {
        // Fabric's own private field, which `glass.ts` reads for the same
        // question: which of the two surfaces this paint is landing on.
        if (ctx === (object as { _cacheContext?: unknown })._cacheContext) {
          record.cacheContext = ctx;
          ctx.globalAlpha = DIM_OPACITY;
          return;
        }
        ctx.globalAlpha *= DIM_OPACITY;
      },
    };
    dimmed.set(object, record);
    // An object that paints from its own cache fires nothing while that cache is
    // clean, so the transition is what makes the repaint that carries the dim.
    object.dirty = true;
    // A group takes no listener for the same reason it renders: Fabric never
    // fires this event for one, and its children carry the dim themselves.
    if (children === undefined)
      object.on("before:render", record.onBeforeRender);
  };

  const restoreDim = (): void => {
    for (const [object, record] of dimmed) {
      object.off("before:render", record.onBeforeRender);
      // Back to the alpha a cache context is expected to carry, ahead of the
      // repaint that takes the dim back out of the paint.
      if (record.cacheContext !== undefined)
        record.cacheContext.globalAlpha = 1;
      object.dirty = true;
    }
    dimmed.clear();
  };

  /**
   * Lifts the dim for a capture and puts it back. The dim is *painted* —
   * a cached object carries it in its own cache — so lifting it is a repaint
   * rather than an unsubscribe: `restoreDim` marks the caches dirty, the
   * capture's frame repaints them clean, and the re-apply leaves the next live
   * frame exactly what the author was looking at. Nothing repaints the live
   * canvas in between, because this pair is synchronous.
   */
  const suspendDim = (): (() => void) => {
    if (dimmed.size === 0) return () => {};
    restoreDim();
    return () => {
      const entry = context[0];
      if (entry instanceof Group)
        for (const object of canvas.getObjects()) dimOutside(object, entry);
      canvas.requestRenderAll();
    };
  };

  /**
   * The artboard half of entering a group.
   *
   * The layer panel already dims every row outside the entered group, so the
   * artboard that still selects them is describing a fiction the author has to
   * learn to disbelieve. `selectable`/`evented` is `object-lock-manager`'s own
   * idiom for "not reachable", and neither key is in Fabric's `stateProperties`,
   * so it stays view state (§67) where `opacity` would not.
   *
   * The dim rides this same walk because it has the same lifetime and the same
   * subject: what the entry puts out of reach. Only the subtree predicate
   * differs, and deliberately — the panel marks the entered group and every
   * descendant of it as the context, so an object *under* an outside group is
   * outside too and a group cannot be dimmed as one object.
   */
  const applyReachability = (entry: Group): void => {
    for (const object of canvas.getObjects()) {
      if (inside(object, entry) || reachabilityTaken.has(object)) continue;
      reachabilityTaken.set(object, previousReachability(object));
      object.set({ selectable: false, evented: false });
    }
    for (const object of canvas.getObjects()) dimOutside(object, entry);
    canvas.requestRenderAll();
  };

  const restoreReachability = (render = true): void => {
    for (const [object, previous] of reachabilityTaken) {
      object.set(previous);
    }
    reachabilityTaken.clear();
    restoreDim();
    if (render) canvas.requestRenderAll();
  };

  /** Leaving the group: the whole transient state, in one place. */
  const leave = (render = true): void => {
    clearThroughFlags();
    restoreReachability(render);
  };

  /** An object added to the root while a group is entered is outside it. */
  const onObjectAdded = (event: { target?: unknown }): void => {
    const entry = context[0];
    if (!(entry instanceof Group)) return;
    const object = event.target as FabricObject | undefined;
    if (object === undefined || inside(object, entry)) return;
    dimOutside(object, entry);
    if (reachabilityTaken.has(object)) return;
    reachabilityTaken.set(object, previousReachability(object));
    object.set({ selectable: false, evented: false });
  };
  canvas.on("object:added" as never, onObjectAdded as never);

  /** Restoring history rebuilds the scene (`loadFromJSON`), so the entered
   * group is a *new* instance with the through-selection flags back at their
   * defaults, and the recorded context points at objects no longer on the
   * canvas. Re-resolve by id and re-apply, or `exitGroup` restores nothing. */
  const onHistoryLoaded = (): void => {
    const id = context.map(idOf).find((candidate) => candidate !== undefined);
    const found =
      id === undefined ? undefined : findById(canvas.getObjects(), id);
    if (!(found instanceof Group)) {
      setContext([]);
      leave();
      return;
    }
    setContext([found]);
    leave();
    makeSelectableThrough(found);
    applyReachability(found);
  };
  canvas.on("editor:history-state-loaded" as never, onHistoryLoaded);

  return {
    group(): Group | undefined {
      const active = canvas.getActiveObject();
      if (!(active instanceof ActiveSelection)) return undefined;
      const members = [...active.getObjects()];
      if (members.length < 2) return undefined;

      const release = options.suspend();
      try {
        canvas.discardActiveObject();
        const group = new Group(members);
        // `id` is Yunari's own persisted property, not a Fabric GroupProps key.
        group.set("id", `group-${crypto.randomUUID()}`);
        group.set("name", newObjectName("group"));
        for (const member of members) {
          canvas.remove(member);
          // `new Group(members)` rewrote each member into group-local
          // coordinates and left Fabric's cached box at the pre-grouping one.
          // A reader that does not refresh — `sceneBoxesOf`, and so the
          // artboard crop count — then reads a box nothing moved. `ungroup()`
          // refreshes for the same reason; a Group's own `setCoords` only
          // cascades while `subTargetCheck` is on, which a fresh group never is.
          member.setCoords();
        }
        canvas.add(group);
        canvas.setActiveObject(group);
        canvas.requestRenderAll();
        return group;
      } finally {
        release();
        save();
      }
    },

    ungroup(): readonly FabricObject[] | undefined {
      const active = canvas.getActiveObject();
      if (!(active instanceof Group)) return undefined;

      const release = options.suspend();
      try {
        // `removeAll` bakes the group transform into each child.
        const members = active.removeAll();
        canvas.remove(active);
        // The `Group` object leaves the document, so it is disposed here —
        // the scene adapter no longer disposes whatever anyone removes
        // (`vg-486`). Safe because `removeAll` emptied it first:
        // `Group.dispose` would otherwise cascade into the members below.
        active.dispose();
        for (const member of members) {
          member.setCoords();
          canvas.add(member);
        }
        canvas.setActiveObject(new ActiveSelection(members, { canvas }));
        canvas.requestRenderAll();
        // The entered group is gone, so a later `exitGroup` would otherwise
        // re-select a destroyed object.
        setContext([]);
        leave();
        return members;
      } finally {
        release();
        save();
      }
    },

    enterGroup(input): FabricObject | undefined {
      const object = input?.object ?? canvas.getActiveObject();
      if (object === undefined || object === null) return undefined;
      // The double-click that enters a group resolves to the *group*, because a
      // group is only transparent to a pointer once the flags below are set — and
      // they are set here, after Fabric's own hit test has already run. So the
      // deepest child under the pointer is re-resolved once they are on, or the
      // gesture selects the group it was meant to enter.
      const entry = ownerGroup(object) ?? object;
      // A double-click is also how a text box is edited, and `editor-shell`
      // routes every one of them here. A text box is not a group, so recording
      // it as an entry left the layer panel dimming every other row for a
      // gesture that entered nothing — and nothing but Escape cleared it.
      if (!(entry instanceof Group)) return undefined;
      // Re-entering the group already entered is not a second level: the panel
      // reads the context as "these rows are reachable", and two copies of one
      // group would say so twice.
      if (context[0] !== entry) leave();
      makeSelectableThrough(entry);
      const point = input?.scenePoint;
      const deepest =
        point !== undefined
          ? canvas.searchPossibleTargets([entry], point).target
          : undefined;
      const selected = deepest ?? object;
      // Recorded before `setActiveObject`: that call fires `selection:created`
      // synchronously, and the bridge re-reads the layer tree on it, so the
      // context must already be right when the panel renders.
      setContext([entry]);
      applyReachability(entry);
      canvas.setActiveObject(selected);
      canvas.requestRenderAll();
      return selected;
    },

    exitGroup(): readonly FabricObject[] | undefined {
      // Sliced rather than popped: `setContext` compares against what is still
      // there, and the return value is what was exited, not what remains.
      const before = [...context];
      const target = before.at(-1);
      if (target === undefined) return undefined;
      setContext(before.slice(0, -1));
      leave();
      // An entry can only have been destroyed by an operation that also clears
      // the context (`ungroup`), so `target` is still on the canvas here.
      canvas.setActiveObject(target);
      canvas.requestRenderAll();
      return before;
    },

    groupContext: () => context,

    suspendDim,

    destroy(): void {
      canvas.off("object:added" as never, onObjectAdded as never);
      canvas.off("editor:history-state-loaded" as never, onHistoryLoaded);
      // A direct assignment: teardown announces nothing, for the same reason it
      // repaints nothing.
      context = [];
      leave(false);
    },
  };
}
