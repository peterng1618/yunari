import type { FabricObject } from "fabric/es";
import type { FieldHooks, FieldView } from "./view.js";

/**
 * What a panel's pixel measure is bounded by: the box Fabric draws the object
 * in, rather than a number chosen at the field.
 *
 * A border, a blur or a radius past the object's own drawn size is a number
 * nothing on the canvas can show, and a radius is narrower still — it takes half
 * of that edge, because a corner is one of a rectangle's four and two opposite
 * radii meeting is the most a corner can be. Fabric draws
 * `Math.min(rx, w / 2)` at draw time, so a larger stored radius is a field
 * claiming a corner the canvas never draws.
 *
 * **The bound is read at projection time from the object's own width and
 * scale**, so a resized panel re-bounds its own fields; an object that measures
 * nothing has no bound to read, and its field keeps a typed box rather than a
 * guessed ceiling. The chart settings follow the same rule from the same kind of
 * read (`chart-manager/index.ts`'s `drawnEdgeOf`), and neither reads the other's
 * object: a panel is a Fabric primitive and a chart is a generated option.
 */

/**
 * The smaller edge of the box Fabric draws an object in, whole units — or
 * nothing when the object measures nothing, which is a box no bound can be read
 * from.
 */
export function drawnEdge(object: FabricObject): number | undefined {
  const smaller = Math.min(
    object.width * object.scaleX,
    object.height * object.scaleY,
  );
  return Number.isFinite(smaller) && smaller > 0
    ? Math.floor(smaller)
    : undefined;
}

/** Half the drawn edge, for a corner radius. See this module's own note. */
export function radiusBound(edge: number | undefined): number | undefined {
  return edge === undefined ? undefined : Math.floor(edge / 2);
}

/**
 * A whole number on a panel with no ceiling of its own.
 *
 * Still `integer: true`: the pre-plan `numberField` refused a typed fraction
 * unconditionally, and the flag is how the control set says so. The write
 * boundary re-checks it, because a control is a convenience and the boundary is
 * what must hold.
 */
export function integerField(
  id: string,
  label: string,
  value: number,
  data: FieldHooks,
): FieldView {
  return { id, control: "number", label, value, integer: true, data };
}

/**
 * A pixel measure on a panel: the track-and-well pair when there is a box to
 * bound it, and a typed box when there is not.
 *
 * The ceiling is the caller's, read from the object it is about (`drawnEdge`, or
 * `radiusBound` of it), so this function owns the control shape and not the
 * measurement — which is what keeps one rule for "a bounded number is a slider"
 * instead of one per field.
 */
export function boundedIntegerField(
  id: string,
  label: string,
  value: number,
  bound: number | undefined,
  data: FieldHooks,
): FieldView {
  if (bound === undefined) return integerField(id, label, value, data);
  return {
    id,
    control: "slider",
    label,
    value,
    min: 0,
    max: bound,
    integer: true,
    data,
  };
}
