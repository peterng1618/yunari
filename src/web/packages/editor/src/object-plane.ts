import { type FabricObject, Point, util } from "fabric/es";

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
