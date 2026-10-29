import {
  applyAuthoredText,
  isLocked,
  writeAuthoredBoxDimension,
} from "@yunari/scene-fabric";
import {
  Control,
  controlsUtils,
  InteractiveFabricObject,
  IText,
  Line,
  Point,
  Textbox,
  util,
} from "fabric/es";
import {
  HORIZONTAL_HEIGHT,
  HORIZONTAL_WIDTH,
  PILL_RADIUS,
  ROTATE_DIAMETER,
  renderRotationHandle,
  roundedHandle,
  SQUARE_RADIUS,
  SQUARE_SIZE,
  VERTICAL_HEIGHT,
  VERTICAL_WIDTH,
} from "./renderers.js";

const CORNER = {
  render: roundedHandle(SQUARE_SIZE, SQUARE_SIZE, SQUARE_RADIUS),
  sizeX: SQUARE_SIZE,
  sizeY: SQUARE_SIZE,
  offsetX: 0,
  offsetY: 0,
} as const satisfies Partial<Control>;

const VERTICAL_EDGE = {
  render: roundedHandle(VERTICAL_WIDTH, VERTICAL_HEIGHT, PILL_RADIUS),
  sizeX: VERTICAL_WIDTH,
  sizeY: VERTICAL_HEIGHT,
  offsetX: 0,
  offsetY: 0,
} as const satisfies Partial<Control>;

const HORIZONTAL_EDGE = {
  render: roundedHandle(HORIZONTAL_WIDTH, HORIZONTAL_HEIGHT, PILL_RADIUS),
  sizeX: HORIZONTAL_WIDTH,
  sizeY: HORIZONTAL_HEIGHT,
  offsetX: 0,
  offsetY: 0,
} as const satisfies Partial<Control>;

const ROTATION = {
  render: renderRotationHandle,
  sizeX: ROTATE_DIAMETER,
  sizeY: ROTATE_DIAMETER,
  offsetX: 0,
  offsetY: -ROTATE_DIAMETER,
  cursorStyle: "grab",
} as const satisfies Partial<Control>;

const OVERRIDES: Readonly<Record<string, Partial<Control>>> = {
  tl: CORNER,
  tr: CORNER,
  bl: CORNER,
  br: CORNER,
  ml: VERTICAL_EDGE,
  mr: VERTICAL_EDGE,
  mt: HORIZONTAL_EDGE,
  mb: HORIZONTAL_EDGE,
  mtr: ROTATION,
};

function applyOverrides(controls: Record<string, Control>): void {
  for (const [key, override] of Object.entries(OVERRIDES)) {
    const control = controls[key];
    if (control === undefined) continue;
    Object.assign(control, override);
  }
  const rotate = controls["mtr"];
  if (rotate === undefined) return;
  rotate.mouseDownHandler = (_eventData, transform) => {
    const { target } = transform;
    if (!isLocked(target) && !target.lockRotation) {
      target.canvas?.setCursor("grabbing");
    }
    return true;
  };
}

/** Degrees an endpoint snaps to while Shift is held, as the familiar 15° step. */
const SHIFT_ANGLE_STEP = 15;

/**
 * A line's own transform set: one handle on each end, and rotation.
 *
 * The bounding box is the wrong shape for a line. Its corners sit at the ends
 * only by luck — `width` and `height` are absolute, so a line drawn
 * right-to-left has its first endpoint at the bottom-left — and the six other
 * handles do nothing for a shape with two points. More to the point, a box
 * around a diagonal makes alignment and snapping meaningless, because the
 * object's own box is a rectangle that is not the object.
 *
 * Each endpoint therefore reads its own corner rather than assuming one, and
 * the action handler writes the four scalars `Line` keeps. Fabric's polyline
 * controls solve the same problem for a class this editor does not use, and
 * records the search that settled on this instead.
 */
function createLineControls(): Record<string, Control> {
  const endpoint = (which: "x1" | "x2"): Control => {
    // The gesture's own frame, taken once. Writing `x2` makes `Line` re-derive
    // `left`/`top`, so reading the matrix back per move maps each step through a
    // frame the previous step already moved — measured, the handle landed about
    // 1.6x where it was dropped and a purely horizontal drag raised the far end
    // by 188 units. The pointer is in the frame the drag began in.
    let frame: ReturnType<typeof util.invertTransform> | undefined;
    const control = new Control({
      ...CORNER,
      cursorStyle: "move",
      positionHandler: (_dim, _matrix, fabricObject) =>
        endpointPoint(fabricObject, which),
      mouseDownHandler: (_eventData, transform) => {
        frame = util.invertTransform(
          (transform.target as Line).calcTransformMatrix(),
        );
        return true;
      },
      mouseUpHandler: () => {
        frame = undefined;
        return false;
      },
      actionHandler: (eventData, transform, x, y) => {
        const line = transform.target as Line;
        const point = util.transformPoint(
          new Point(x, y),
          frame ?? util.invertTransform(line.calcTransformMatrix()),
        );
        // Both of the endpoint's scalars are written: `x2` alone leaves `y2`
        // where it was and the handle stops following the pointer on the other
        // axis. One `set` for the pair, because `Line._set` recomputes
        // `left`/`top` from `x1`..`y2` on every coordinate write, so a split
        // pair re-derives the box twice.
        line.set({
          [which]: point.x,
          [which === "x1" ? "y1" : "y2"]: point.y,
        });
        if ((eventData as { shiftKey?: boolean }).shiftKey === true) {
          constrainAngle(line);
        }
        line.setCoords();
        return true;
      },
    });
    return control;
  };

  const rotate = new Control({ ...ROTATION });
  rotate.mouseDownHandler = (_eventData, transform) => {
    const { target } = transform;
    if (!isLocked(target) && !target.lockRotation) {
      target.canvas?.setCursor("grabbing");
    }
    return true;
  };

  return {
    endpointA: endpoint("x1"),
    endpointB: endpoint("x2"),
    mtr: rotate,
  };
}

/** The endpoint's position on the canvas, in the space Fabric asks for. */
function endpointPoint(object: unknown, which: "x1" | "x2"): Point {
  const line = object as Line;
  const atStart = which === "x1";
  // `width` and `height` are absolute, so the fraction is what says which
  // corner this end sits in — read from the coordinates, never assumed.
  const x = atStart === line.x2 >= line.x1 ? 0 : line.width;
  const y = atStart === line.y2 >= line.y1 ? 0 : line.height;
  return util.transformPoint(
    new Point(x, y),
    util.multiplyTransformMatrices(
      line.getViewportTransform(),
      line.calcTransformMatrix(),
    ),
  );
}

/** Snap the far end so the line runs at a multiple of the step. */
function constrainAngle(line: Line): void {
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  if (dx === 0 && dy === 0) return;
  const length = Math.hypot(dx, dy);
  const step = util.degreesToRadians(SHIFT_ANGLE_STEP);
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  line.set("x2", line.x1 + Math.cos(angle) * length);
  line.set("y2", line.y1 + Math.sin(angle) * length);
}

let applied = false;

/**
 * A textbox's vertical edge, which records the authored box rather than
 * Fabric's own height.
 *
 * `createTextboxDefaultControls` already replaces `ml`/`mr` with Fabric's
 * `changeWidth`, because a textbox's width *is* its box. The vertical half is
 * the same statement, and it was not made here for a reason that turned out to
 * be half true: `Textbox.initDimensions` does end in
 * `this.height = this.calcTextHeight()` (`fabric/dist/index.mjs:18452`), so
 * Fabric's height is a measurement of the rendered text and a handle that
 * stopped there would be overwritten by the next text pass — and until that
 * pass, `placeInBox` would put the glyphs at a vertical alignment the clip does
 * not have. That is the disagreement vg-089 records, produced by the handle
 * rather than by a type preset.
 *
 * So the edge is an ordinary handle while the pointer is down — `changeHeight`,
 * the exact mirror of the width path — and on release it records the box, which
 * is what persists and what the clip and the line capacity are computed from.
 * The text pass then runs, so the object agrees with its box on the frame the
 * author lets go rather than at the next telemetry tick.
 */
function withTextboxHeightControls(
  controls: Record<string, Control>,
  artboardHeight: (() => number) | undefined,
): void {
  // Shared by both edges, as the controls themselves are: one pointer, one drag.
  let atPress: number | undefined;

  for (const key of ["mt", "mb"] as const) {
    const control = controls[key];
    if (control === undefined) continue;

    control.actionHandler = controlsUtils.changeHeight;
    control.cursorStyleHandler = controlsUtils.scaleCursorStyleHandler;
    control.getActionName = () => "resizing";
    control.mouseDownHandler = (_eventData, transform) => {
      atPress =
        transform.target instanceof Textbox
          ? transform.target.height
          : undefined;
      return false;
    };
    control.mouseUpHandler = (_eventData, transform) => {
      const textbox = transform.target;
      const pressed = atPress;
      atPress = undefined;
      // A press with no move is not a resize. The handle sits on the object's
      // own bounds, which for a clipped textbox is the taller of the text and
      // the box — so recording it unconditionally would turn a click into a
      // silent enlargement of a box the author never touched.
      if (!(textbox instanceof Textbox) || textbox.height === pressed)
        return false;

      // Fabric's own height, unscaled. `yunariText.box` is the number the
      // object measures against, and `boxFrom` is what puts the scale back on
      // for the clip and the placement — so scaling here would grow the box by
      // the scale on every drag.
      writeAuthoredBoxDimension(textbox, "height", textbox.height);
      const canvas = textbox.canvas;
      // No globals: the run editor's own writes repaint the same way, and a
      // value run keeps its authored placeholder either way.
      if (canvas === undefined) return false;
      applyAuthoredText(canvas, undefined, {
        ...(artboardHeight === undefined
          ? {}
          : { artboardHeight: artboardHeight() }),
      });
      canvas.requestRenderAll();
      return false;
    };
  }
}

/**
 * Fabric reads `ownDefaults` when an object is constructed, so this runs before
 * the canvas exists. Excludes the fork's ActiveSelection bounds patch and its
 * Textbox width-control wrapping; neither has a Yunari type to serve.
 *
 * `artboardHeight` is read on release, when the artboard exists: the repaint
 * that follows a height drag must paint a run's role default rather than wait
 * for the next runtime tick.
 */
export function applyEditorControls(artboardHeight?: () => number): void {
  if (applied) return;
  applied = true;

  const objectControls = controlsUtils.createObjectDefaultControls();
  applyOverrides(objectControls);
  InteractiveFabricObject.ownDefaults.controls = objectControls;

  const textboxControls = controlsUtils.createTextboxDefaultControls();
  applyOverrides(textboxControls);
  withTextboxHeightControls(textboxControls, artboardHeight);
  Textbox.ownDefaults.controls = textboxControls;

  // A text has no authored box, so a width or height drag has nowhere to write.
  // Corners and rotation remain; the four edge handles are omitted. Built from
  // the object set so the shared overrides still apply, and copied because
  // deleting from `objectControls` itself would take them off every object.
  const {
    ml: _ml,
    mr: _mr,
    mt: _mt,
    mb: _mb,
    ...textControls
  } = objectControls;
  IText.ownDefaults = { ...IText.ownDefaults, controls: textControls };

  // A line gets its own set rather than a narrowed one: the six handles it does
  // not need are the ones that make the box wrong, so hiding them would leave
  // the box.
  //
  // Assigned as a NEW defaults object, not as a property on the inherited one.
  // `Line.ownDefaults` resolves up the prototype chain to the object every
  // Fabric object shares, so writing `controls` onto it took the handles off
  // rectangles and text boxes too — caught by the existing handle-size test,
  // which is the only reason it was caught at all.
  Line.ownDefaults = { ...Line.ownDefaults, controls: createLineControls() };

  InteractiveFabricObject.ownDefaults.snapAngle = 1;
}
