import { isLocked } from "@yunari/scene-fabric";
import { ActiveSelection, type FabricObject } from "fabric/es";
import type { EditorInteraction } from "./editor-interaction.js";
import { moveObjectByCanvasDelta } from "./object-plane.js";

export type ArrangeAction =
  | "align-left"
  | "align-center-x"
  | "align-right"
  | "align-top"
  | "align-center-y"
  | "align-bottom"
  | "distribute-x"
  | "distribute-y";

interface ArrangeObject extends FabricObject {
  readonly locked?: boolean;
}

/** Moves the current Fabric selection without introducing a separate geometry model. */
export function applyArrange(
  editor: EditorInteraction,
  action: ArrangeAction,
): boolean {
  const active = editor.canvas.getActiveObject();
  if (!(active instanceof ActiveSelection) || !canArrange(editor, action))
    return false;
  const objects = active.getObjects() as ArrangeObject[];

  editor.canvas.discardActiveObject();
  if (action === "distribute-x" || action === "distribute-y")
    distribute(objects, action === "distribute-x" ? "x" : "y");
  else align(objects, action);

  editor.canvas.setActiveObject(
    new ActiveSelection(objects, {
      canvas: editor.canvas,
      multiSelectionStacking: "selection-order",
    }),
  );
  editor.canvas.requestRenderAll();
  editor.historyManager.saveState();
  return true;
}

/** Mirrors command eligibility so controls cannot advertise an invalid action. */
export function canArrange(
  editor: EditorInteraction,
  action: ArrangeAction,
): boolean {
  const active = editor.canvas.getActiveObject();
  if (!(active instanceof ActiveSelection)) return false;
  const objects = active.getObjects() as ArrangeObject[];
  return (
    !objects.some((object) => isLocked(object)) &&
    objects.length >= arrangeMinimum(action)
  );
}

/** How many objects an action needs. The one owner of the threshold, so a
    surface that gates a control cannot advertise an action this one refuses. */
export function arrangeMinimum(action: ArrangeAction): number {
  return action === "distribute-x" || action === "distribute-y" ? 3 : 2;
}

function align(
  objects: readonly ArrangeObject[],
  action: Exclude<ArrangeAction, "distribute-x" | "distribute-y">,
): void {
  const anchor = objects[0]!;
  const bounds = anchor.getBoundingRect();
  const horizontal =
    action === "align-left" ||
    action === "align-center-x" ||
    action === "align-right";
  const target = horizontal
    ? action === "align-left"
      ? bounds.left
      : action === "align-right"
        ? bounds.left + bounds.width
        : bounds.left + bounds.width / 2
    : action === "align-top"
      ? bounds.top
      : action === "align-bottom"
        ? bounds.top + bounds.height
        : bounds.top + bounds.height / 2;

  for (const object of objects) {
    const current = object.getBoundingRect();
    const position = horizontal
      ? action === "align-left"
        ? current.left
        : action === "align-right"
          ? current.left + current.width
          : current.left + current.width / 2
      : action === "align-top"
        ? current.top
        : action === "align-bottom"
          ? current.top + current.height
          : current.top + current.height / 2;
    moveObjectByCanvasDelta({
      object,
      delta: {
        x: horizontal ? target - position : 0,
        y: horizontal ? 0 : target - position,
      },
    });
  }
}

function distribute(objects: readonly ArrangeObject[], axis: "x" | "y"): void {
  const ordered = objects
    .slice()
    .sort((left, right) => start(left, axis) - start(right, axis));
  const first = ordered[0]!;
  const last = ordered.at(-1)!;
  const inner = ordered.slice(1, -1);
  const gap =
    (start(last, axis) -
      end(first, axis) -
      inner.reduce((sum, object) => sum + size(object, axis), 0)) /
    (ordered.length - 1);
  let next = end(first, axis) + gap;

  for (const object of inner) {
    moveObjectByCanvasDelta({
      object,
      delta: {
        x: axis === "x" ? next - start(object, axis) : 0,
        y: axis === "y" ? next - start(object, axis) : 0,
      },
    });
    next += size(object, axis) + gap;
  }
}

function start(object: ArrangeObject, axis: "x" | "y"): number {
  const bounds = object.getBoundingRect();
  return axis === "x" ? bounds.left : bounds.top;
}

function end(object: ArrangeObject, axis: "x" | "y"): number {
  return start(object, axis) + size(object, axis);
}

function size(object: ArrangeObject, axis: "x" | "y"): number {
  const bounds = object.getBoundingRect();
  return axis === "x" ? bounds.width : bounds.height;
}
