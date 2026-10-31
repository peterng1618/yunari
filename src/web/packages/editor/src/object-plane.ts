import { type FabricObject, Group, Point, util } from "fabric/es";

/** A point in the canvas plane. */
export type CanvasPlanePoint = Readonly<{
  x: number;
  y: number;
}>;

/** Converts a canvas-plane point into the plane the object's `left`/`top` use.
 *
 * A rasterised point, so the parent's offset is part of the conversion. A group
 * member's `left`/`top` are group-local while `getBoundingRect()` and
 * `getCoords()` are canvas coordinates; writing one into the other moved the
 * object by its group's translation a second time. */
export function canvasPointToParentPlane({
  object,
  point,
}: {
  object: FabricObject;
  point: CanvasPlanePoint;
}): Point {
  const { parent } = object;
  if (parent === undefined) return new Point(point.x, point.y);

  return util.transformPoint(
    new Point(point.x, point.y),
    util.invertTransform(parent.calcTransformMatrix()),
  );
}

/** Converts a point in the object's parent plane into the canvas plane. */
export function parentPlanePointToCanvas({
  object,
  point,
}: {
  object: FabricObject;
  point: CanvasPlanePoint;
}): Point {
  const { parent } = object;
  if (parent === undefined) return new Point(point.x, point.y);

  return util.transformPoint(
    new Point(point.x, point.y),
    parent.calcTransformMatrix(),
  );
}

/** Recomputes an object's cached box, and everything nested under it.
 *
 * A cached box is not a transform, and two Fabric paths leave it stale:
 *
 * - Discarding an `ActiveSelection` re-enters each member into its real group,
 *   and that re-entry applies the inverse matrix but does not refresh the box:
 *   `Group._enterGroup` only cascades `setCoords` while `subTargetCheck` is on,
 *   which an exit turns off first. The member then keeps the corners it had in
 *   the selection's plane, and `getBoundingRect`/`getCoords` — what align,
 *   distribute and the snap paths read — transform those world values through
 *   the group's matrix a second time.
 * - Reparenting rebases a destination's children (Fabric's
 *   `FitContentLayout.shouldPerformLayout` always answers true), but neither
 *   `Group.setCoords` nor the layout pass cascades while `subTargetCheck` is
 *   false, so a nested row's `left`/`top` move under a cached box nothing
 *   recomputed.
 *
 * Deepest first: a child's cached box is in its parent's plane, the parent's in
 * its own parent's.
 */
export function refreshObjectCoords(object: FabricObject): void {
  if (object instanceof Group)
    for (const child of object.getObjects()) refreshObjectCoords(child);
  object.setCoords();
}

/** Moves the object by a canvas-plane delta, expressed in the plane its
 * `left`/`top` live in.
 *
 * The delta is a vector, not a point, so the parent's offset is ignored. Going
 * through `setPositionByOrigin(centre, …)` instead is not equivalent: entering
 * a group bakes the group's angle and scale onto the children, and the centre
 * read is then no longer the exact inverse of the write. */
export function moveObjectByCanvasDelta({
  object,
  delta,
}: {
  object: FabricObject;
  delta: CanvasPlanePoint;
}): void {
  const { parent } = object;
  const localDelta =
    parent === undefined
      ? new Point(delta.x, delta.y)
      : util.transformPoint(
          new Point(delta.x, delta.y),
          util.invertTransform(parent.calcTransformMatrix()),
          true,
        );
  object.set({
    left: object.left + localDelta.x,
    top: object.top + localDelta.y,
  });
  object.setCoords();
}
