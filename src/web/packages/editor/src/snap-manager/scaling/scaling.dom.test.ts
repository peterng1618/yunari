// @vitest-environment jsdom
import { Canvas, Group, Rect } from "fabric/es";
import { describe, expect, it, vi } from "vitest";
import { createSnapManager } from "../index.js";

/** The raw width multiplier whose moved right edge lands inside SNAP_THRESHOLD
 * of the anchor's left edge. Task 8 imports it, so it lives here, defined once. */
export const SNAPPING_MULTIPLIER = 1.53;

function setup({
  controlKey = "mr",
  grouped = false,
  replacedControl = false,
  uniformScaling,
}: {
  controlKey?: "br" | "mr";
  grouped?: boolean;
  replacedControl?: boolean;
  uniformScaling?: boolean;
} = {}) {
  const canvas = new Canvas(document.createElement("canvas"));
  if (uniformScaling !== undefined) {
    canvas.uniformScaling = uniformScaling;
    canvas.uniScaleKey = "shiftKey";
  }
  const snapped = createSnapManager({
    canvas,
    bounds: () => ({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      centerX: 400,
      centerY: 300,
    }),
    errors: { error: vi.fn(), warn: vi.fn() } as never,
  });
  // strokeWidth 0: `getObjectExactBounds` reads `getBoundingRect()`, which
  // includes a non-uniform stroke, so a default 1px stroke would make the
  // geometry 201x81 and every expected number below wrong.
  // The anchor's left edge is 270; the resized object's right edge starts at 160.
  const anchor = new Rect({
    id: "a",
    left: 300,
    top: 40,
    width: 60,
    height: 60,
    strokeWidth: 0,
  });
  const resized = new Rect({
    id: "b",
    left: 60,
    top: 300,
    width: 200,
    height: 80,
    strokeWidth: 0,
  });
  if (grouped) {
    // Wrapping the same rectangle in a group leaves its world geometry
    // unchanged, so the only difference from the root case is the plane its
    // `left`/`top` live in.
    canvas.add(
      anchor,
      new Group([resized], { subTargetCheck: true, interactive: true }),
    );
  } else {
    canvas.add(anchor, resized);
    canvas.setActiveObject(resized);
  }
  if (replacedControl) {
    // Swapping the action handler is the smallest edit that makes a control
    // non-standard, and it is the one the fork's guard tests for by reference.
    // The geometry is left alone on purpose: only the behaviour differs, so a
    // controller that only looked at numbers would still snap this one.
    // Mutated in place — replacing the control would drop Fabric's `Control`
    // prototype and break rendering rather than model a custom handle.
    const control = resized.controls[controlKey];
    if (control === undefined) throw new Error(`no ${controlKey} control`);
    control.actionHandler = () => false;
  }

  const transform = {
    target: resized,
    action: controlKey === "mr" ? "scaleX" : "scale",
    corner: controlKey,
    // Fabric's own _getOriginFromCorner forces "left"/"center" for `mr`.
    originX: controlKey === "mr" ? "left" : "left",
    originY: controlKey === "mr" ? "center" : "top",
    original: { scaleX: 1, scaleY: 1, originX: "left", originY: "center" },
  };
  // Fabric fires `object:scaling` only after it has already resized the object,
  // so the gesture's start geometry comes from `mouse:down`, which carries the
  // transform Fabric built there. One pointerdown, then the resize steps.
  // `scenePoint`, not `pointer`: Fabric's `_handleEvent` builds the payload
  // from `getEventPoints` (scenePoint/viewportPoint), and only `object:scaling`
  // gets a `pointer`. Sending `pointer` here would test a payload Fabric never
  // sends, and a controller reading only `pointer` would never start a session.
  const down = (): void => {
    canvas.fire(
      "mouse:down" as never,
      {
        e: {},
        target: resized,
        scenePoint: { x: 160, y: 300 },
        transform,
      } as never,
    );
  };
  /** One handle step. Returns raw width Fabric would have produced. */
  const resize = (e: object, widthScale: number): number => {
    // Mirror Fabric's pre-transform result so controller sees state it would
    // really see. This is setup, not behaviour under test.
    resized.set({
      scaleX: widthScale,
      scaleY: controlKey === "mr" ? 1 : widthScale,
    });
    resized.setCoords();
    canvas.fire(
      "object:scaling" as never,
      {
        e,
        target: resized,
        pointer: { x: 160, y: 300 },
        transform,
      } as never,
    );
    return 200 * widthScale;
  };
  return { canvas, snapped, resized, down, resize };
}

describe("scale snapping", () => {
  it("snaps a resize onto a neighbour's edge", () => {
    const { snapped, resized, down, resize } = setup();
    down();

    // The raw right edge lands at 266, four short of the anchor's 270 left edge,
    // so the raw width (306) and the snapped width (310) differ — the assertion
    // can fail when the controller does nothing.
    const raw = resize({}, SNAPPING_MULTIPLIER);
    expect(raw).toBe(306);
    expect(resized.getScaledWidth()).toBe(310);
    snapped.destroy();
  });

  it("re-plans on every scaling step, not once per gesture", () => {
    const { snapped, resized, down, resize } = setup();
    down();
    // Far from the neighbour, so the first step resolves to itself and the raw
    // value stands — this is the assertion that would catch a controller that
    // snapped unconditionally.
    expect(resize({}, 0.6)).toBe(120);
    expect(resized.getScaledWidth()).toBe(120);
    // The second step must be planned, not rejected as a duplicate.
    resize({}, SNAPPING_MULTIPLIER);
    expect(resized.getScaledWidth()).toBe(310);
    snapped.destroy();
  });

  it("leaves the raw size alone while Ctrl is held", () => {
    const { resized, snapped, down, resize } = setup();
    down();

    const raw = resize({ ctrlKey: true }, SNAPPING_MULTIPLIER);
    expect(raw).toBe(200 * SNAPPING_MULTIPLIER);
    expect(resized.getScaledWidth()).toBe(raw);
    snapped.destroy();
  });

  it("snaps the same step when Ctrl is not held", () => {
    const { resized, snapped, down, resize } = setup();
    down();

    const raw = resize({}, SNAPPING_MULTIPLIER);
    expect(raw).toBe(200 * SNAPPING_MULTIPLIER);
    expect(resized.getScaledWidth()).not.toBe(raw);
    snapped.destroy();
  });

  it("uses Shift to constrain a corner resize", () => {
    const { resized, snapped, down, resize } = setup({
      controlKey: "br",
      uniformScaling: false,
    });
    down();

    const raw = resize({ shiftKey: true }, SNAPPING_MULTIPLIER);
    expect(raw).toBe(200 * SNAPPING_MULTIPLIER);
    expect(resized.getScaledWidth()).toBe(310);
    expect(resized.getScaledHeight()).toBe(124);
    snapped.destroy();
  });

  it("snaps a group child at the same width as the same rectangle at the root", () => {
    const root = setup();
    root.down();
    expect(root.resize({}, SNAPPING_MULTIPLIER)).toBe(306);
    const rootWidth = root.resized.getScaledWidth();
    root.snapped.destroy();

    const grouped = setup({ grouped: true });
    grouped.down();
    expect(grouped.resize({}, SNAPPING_MULTIPLIER)).toBe(306);
    // The projection is in the canvas plane and the applied anchor is converted
    // into the child's own plane, so the group's transform does not change the
    // distance at which the same raw step snaps.
    expect(grouped.resized.getScaledWidth()).toBe(rootWidth);
    expect(rootWidth).toBe(310);
    grouped.snapped.destroy();
  });

  it("refuses a handle whose behaviour was replaced", () => {
    const { snapped, resized, down, resize } = setup({ replacedControl: true });
    down();

    // Identical to the first case but for the control's action handler. A
    // control that resizes its own way is not the gesture the plan was derived
    // from, so applying the plan would move the object somewhere the author
    // never dragged it. The step that snaps at 310 must stay at the raw 306.
    expect(resize({}, SNAPPING_MULTIPLIER)).toBe(306);
    expect(resized.getScaledWidth()).toBe(306);
    snapped.destroy();
  });

  it("abandons the plan when the side handle becomes a skew", () => {
    const { snapped, resized, down, resize } = setup();
    down();

    // Shift is Fabric's alt-action key (`altActionKey` defaults to "shiftKey"),
    // and holding it turns a side handle from a resize into a skew inside
    // Fabric's own action handler. The plan no longer describes the gesture, so
    // the step must leave the raw width rather than apply a stale scale plan.
    expect(resize({ shiftKey: true }, SNAPPING_MULTIPLIER)).toBe(306);
    expect(resized.getScaledWidth()).toBe(306);
    snapped.destroy();
  });
});
