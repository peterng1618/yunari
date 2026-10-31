import {
  ActiveSelection,
  type Canvas,
  type FabricObject,
  Group,
} from "fabric/es";

/**
 * The collection that actually holds `object`. Callers used to spell this two
 * ways — `layer-manager` returning the canvas itself, `deletion-manager`
 * returning `undefined` and making every caller write `?? canvas` — so a caller
 * that forgot the fallback silently acted on nothing.
 *
 * Two Fabric traps are the reason the fact exists rather than the bare test:
 *
 * - `Collection.remove` and the stack methods read and write only their own
 *   `_objects` and never check membership. A move or removal issued on the
 *   canvas to a group child *inserts* it into the root and leaves it in both
 *   arrays — painted and serialised twice.
 * - `parent` is the real owner and `group` is not: Fabric repoints `group` at an
 *   `ActiveSelection` while a multi-selection is live, but leaves `parent` on the
 *   owning group, so discarding the selection re-enters the group rather than
 *   orphaning the child.
 */
export function holderOf(canvas: Canvas, object: FabricObject): Canvas | Group {
  return parentGroupOf(object) ?? canvas;
}

/**
 * The group that owns `object`, or `undefined` when the canvas holds it.
 *
 * The narrower half of `holderOf`, for a caller with no canvas in scope that
 * must decide what a top-level object means. It is the Fabric fact itself, not
 * the projection tree's answer by id — `layer-tree.ownerOf` answers that
 * separate question.
 */
export function parentGroupOf(object: FabricObject): Group | undefined {
  return object.parent instanceof Group ? object.parent : undefined;
}

/**
 * An `ActiveSelection` is not in `canvas._objects` at all, so handing one to a
 * stack method or a removal would act on the selection itself; its members are
 * the things to move or delete.
 */
export function targetsOf(object: FabricObject): FabricObject[] {
  return object instanceof ActiveSelection ? object.getObjects() : [object];
}
