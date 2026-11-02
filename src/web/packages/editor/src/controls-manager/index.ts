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
  Textbox,
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

  InteractiveFabricObject.ownDefaults.snapAngle = 1;
}
