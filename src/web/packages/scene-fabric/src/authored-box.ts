import type {
  PlanBox,
  PlanTextLayout,
  TextContent,
} from "@yunari/renderer-core";
import { Rect, Textbox } from "fabric/es";
import type { PlanTextObject } from "./fabric-text.js";

/**
 * The authored box, and the geometry derived from it.
 *
 * **The box is a Text box's, not a Text's.** An `IText` is its own measurement:
 * it has no wrap measure and no clip, so `yunariText.box` on one is tolerated on
 * load and ignored. Everything here is meaningful only for a `Textbox`.
 *
 * A `Textbox` cannot hold one either: `initDimensions` widens it to its longest
 * unbreakable run and never narrows (`fabric/dist/index.mjs:18453`), and
 * `width` is one of its `textLayoutProperties` (`:18760`), so every width write
 * re-enters that. `yunariText.box` is therefore the owner, and everything that
 * reads the box — the width guard, the placement, the line capacity and the clip
 * — lives here rather than in the text pass that drives them.
 * See `docs/decisions/0003`.
 */

/** Marks an object whose `set` has been guarded; a revived object is fresh. */
const BOX_GUARD = Symbol.for("yunari.authoredBox");

export function scaleOf(value: number): number {
  return value === 0 ? 1 : value;
}

/** How far Fabric's `left`/`top` anchor sits from the object's leading edge. */
function anchorOffset(origin: string | number, size: number): number {
  if (origin === "left" || origin === "top") return 0;
  return origin === "right" || origin === "bottom" ? size : size / 2;
}

/**
 * The box a `left`/`top` anchor describes, in parent space.
 *
 * `left`/`top` are the position of whichever origin the object uses, so every
 * box read back off an object — the authored one, a clip's, or the object's own
 * measured edges — goes through here. Reading one through a centre origin moves
 * a corner-anchored object off its corner by half its own size.
 */
export function boxFrom(
  object: PlanTextObject,
  width: number,
  height: number,
  offsetX = 0,
  offsetY = 0,
): PlanBox {
  const scaleX = scaleOf(object.scaleX);
  const scaleY = scaleOf(object.scaleY);
  const scaledWidth = width * scaleX;
  const scaledHeight = height * scaleY;

  return {
    x: object.left - anchorOffset(object.originX, scaledWidth) + offsetX,
    y: object.top - anchorOffset(object.originY, scaledHeight) + offsetY,
    width: scaledWidth,
    height: scaledHeight,
    rotation: object.angle,
    scaleX: object.scaleX,
    scaleY: object.scaleY,
  };
}

/** The object's own coordinate origin, in parent space. */
function objectCentre(object: PlanTextObject): { x: number; y: number } {
  const own = boxFrom(object, object.width, object.height);
  return { x: own.x + own.width / 2, y: own.y + own.height / 2 };
}

/**
 * The box the author wrote, in parent space, or `undefined` for an auto text.
 *
 * `yunariText.box` is scene units; Fabric's `width` is the same box before
 * `scaleX`. The object's `left`/`top` are the box's own corner, so they say
 * where the box is without anything having to measure the text to find out.
 *
 * A `Textbox` alone: an `IText` measures its own edges, and a box left on one by
 * an older document must not become a constraint it never had.
 */
export function authoredBox(
  object: PlanTextObject,
  authored: TextContent,
): PlanBox | undefined {
  if (!(object instanceof Textbox)) return undefined;

  const box = authored.box;
  return box === undefined ? undefined : boxFrom(object, box.width, box.height);
}

/**
 * Keep Fabric's own width writes at the number the caller asked for.
 *
 * Every width decision an author or a renderer makes reaches `set` — Fabric's
 * `changeWidth` control (`index.mjs:6737`), `updateText`, the editor's
 * `applyTextboxWidth` — and `set` re-enters `initDimensions`, which widens the
 * object to its longest run before the call returns. Without this the width an
 * author dragged is gone before `object:resizing` reports it. Fabric's own
 * widening goes through `_set`, which is not overridden.
 *
 * The restore is a box write like any other, so it marks the coordinates the
 * same way: `base` refreshed `aCoords` from the widened width on the way out,
 * and the width put back underneath it is the one the canvas has to report.
 */
export function guardBoxWidth(object: PlanTextObject): void {
  if (!(object instanceof Textbox) || BOX_GUARD in object) {
    return;
  }

  const base = object.set.bind(object);
  object.set = ((
    key: string | Record<string, unknown>,
    value?: unknown,
  ): PlanTextObject => {
    const requested =
      typeof key === "string"
        ? key === "width"
          ? value
          : undefined
        : key["width"];
    const result = base(key, value) as PlanTextObject;
    if (typeof requested === "number" && Number.isFinite(requested)) {
      object.width = requested;
      markBoxWritten(object);
    }
    return result;
  }) as typeof object.set;

  Object.defineProperty(object, BOX_GUARD, { value: true });
}

/**
 * The bookkeeping Fabric's own `set` would have done for a box write.
 *
 * `aCoords` is a second cache of where an object is: `getBoundingRect()` is
 * `makeBoundingBoxFromPoints(this.getCoords())` (`fabric/dist/index.mjs:5281`)
 * and `getCoords()` reads `aCoords` (`:5198`). Only `setCoords()` refreshes it,
 * which is exactly why a box cannot be put back through `set` — and exactly why
 * a direct assignment has to refresh it itself. Without this the readers that
 * go through the canvas, which is the selection frame an author drags by, the
 * snap guides and `arrange`, all read the box Fabric widened to inside the pass.
 *
 * `dirty` is the other half, and the reason this is not just `setCoords()`:
 * `width` and `height` are Fabric `cacheProperties`, so `_set` marks the object
 * dirty when either changes (`:5836`). A direct assignment replaces `_set`, so
 * it owes the same mark — cheap at 0.03 µs, and the difference between the two
 * boxes agreeing everywhere and agreeing on the canvas.
 *
 * At the writer rather than at the reader: the reader set is open-ended and one
 * line away from growing again, while every write to the box is here.
 */
function markBoxWritten(object: PlanTextObject): void {
  object.dirty = true;
  object.setCoords();
}

/**
 * Put the box back after the pass's last `initDimensions`, on both dimensions
 * and with the canvas told.
 *
 * A direct assignment, because `width` is a layout property on a `Textbox` and
 * a restore written as a `set` re-enters `initDimensions` inside its own call —
 * so the assignment is what `set` would have done minus the two caches, and
 * `markBoxWritten` is those two caches. Both dimensions in one function because
 * they are one statement: after it returns the object is *at* the box and
 * *reports* the box, and there is no moment in between where it is at the box
 * and reports something else.
 *
 * Height differs from width in why it cannot go through `set` at all: `height`
 * is not a `textLayoutProperties` member, so a restore written as a `set` would
 * land, and the overwrite comes from `initDimensions` itself, which ends in
 * `this.height = this.calcTextHeight()` (`fabric/dist/index.mjs:18452`). Fabric's
 * height is a *measurement* of the rendered text, and a box the author wrote is
 * not one: without this the object and the clip derived from the box disagree by
 * exactly the overflow, which is what an author sees when a type preset is
 * taller than the box.
 *
 * Only a `Textbox`: an unwrapped object's width and height *are* its
 * measurement, and forcing the box onto it would draw a box the text does not
 * have.
 */
export function assertBox(object: PlanTextObject, box: PlanBox): void {
  if (!(object instanceof Textbox)) return;
  object.width = box.width / scaleOf(object.scaleX);
  object.height = box.height / scaleOf(object.scaleY);
  markBoxWritten(object);
}

/**
 * One dimension of the authored box, written from a number the author chose.
 *
 * The single write every geometry surface shares, so a Size field and a dragged
 * edge cannot disagree about what a box is. Fabric's own floor is 1 — the same
 * `Math.max(newWidth, 1)` `changeWidth` applies (`index.mjs:6737`) — and a value
 * below it, or one that is not a number at all, is refused rather than coerced:
 * a zero-height box clips everything and a `NaN` propagates into the clip.
 *
 * An object with no box yet gets one, both dimensions from its own measured
 * edges. Writing one alone would leave `{ height }` with no width, and
 * `authoredBox` would multiply an `undefined` width by the scale on the next
 * pass — the object loses its width and stops producing a bounding rect.
 */
export function writeAuthoredBoxDimension(
  object: PlanTextObject,
  dimension: "width" | "height",
  value: number,
): void {
  if (!Number.isFinite(value) || value < 1) return;

  const authored = object.get("yunariText");
  if (typeof authored !== "object" || authored === null) return;

  const content = authored as Record<string, unknown>;
  const box = (content["box"] ?? {}) as {
    width?: number;
    height?: number;
  };

  // The object's own edges, unscaled: the box is the number Fabric measures
  // against, and `boxFrom` is what puts the scale back on for the clip and the
  // placement. Seeding with the scaled value would grow the box on every pass.
  object.set("yunariText", {
    ...content,
    box: {
      width: box.width ?? object.width,
      height: box.height ?? object.height,
      [dimension]: value,
    },
  });
}

/**
 * Put the object's own edges where the authored alignment puts them.
 *
 * A wrapped object's width is the box, so horizontal alignment is `textAlign`
 * inside it and only the vertical axis moves; an unwrapped one is its own run
 * and moves on both. `anchorOffset` converts the edge back to whichever origin
 * the object uses, which is how a v2 document's left/top-corner text and the
 * plan path's centred text share one owner.
 */
export function placeInBox(
  object: PlanTextObject,
  box: PlanBox,
  layout: PlanTextLayout,
): void {
  const width = object.width * scaleOf(object.scaleX);
  const height = object.height * scaleOf(object.scaleY);
  const left =
    layout.align === "left"
      ? box.x
      : layout.align === "right"
        ? box.x + box.width - width
        : box.x + (box.width - width) / 2;
  const top =
    layout.verticalAlign === "top"
      ? box.y
      : layout.verticalAlign === "bottom"
        ? box.y + box.height - height
        : box.y + (box.height - height) / 2;

  object.set({
    left: left + anchorOffset(object.originX, width),
    top: top + anchorOffset(object.originY, height),
  });
}

/**
 * How many lines the authored box has room for.
 *
 * `maxLines` is documented as unknowable without a resolved font size, and that
 * was true when a box was only ever as tall as the text it held. A fixed box is
 * not: its own height and Fabric's own line height are both numbers the object
 * already has, so the capacity is arithmetic rather than a measurement this
 * renderer never made.
 *
 * At least one line, so a box shorter than its own text clamps to one rather
 * than to none — the clip is what keeps the overflow off whatever is beside the
 * box, and a zero-line capacity would leave nothing to clip against.
 */
export function withLineCapacity(
  object: PlanTextObject,
  box: PlanBox,
  layout: PlanTextLayout,
): PlanTextLayout {
  // A Text is its own measurement, so it has no authored height to fill.
  if (
    !(object instanceof Textbox) ||
    layout.maxLines !== undefined ||
    object.textLines.length === 0
  ) {
    return layout;
  }

  const line = object.getHeightOfLine(0);

  if (!Number.isFinite(line) || line <= 0) {
    return layout;
  }

  return {
    ...layout,
    maxLines: Math.max(
      1,
      Math.floor(box.height / scaleOf(object.scaleY) / line),
    ),
  };
}

/** Relative clip path follows object rotation/scale and is offset for edge alignment. */
export function applyClip(
  object: PlanTextObject,
  layout: PlanTextLayout,
  box: PlanBox,
): void {
  if (layout.overflow === "visible") {
    delete object.clipPath;
    return;
  }

  const scaleX = object.scaleX === 0 ? 1 : object.scaleX;
  const scaleY = object.scaleY === 0 ? 1 : object.scaleY;
  // A clip path is positioned in the object's own coordinate system, whose
  // origin is the object's centre — which is not where `left`/`top` put it
  // unless the origin is centred. Every authored text object is a corner, so
  // this is the difference between clipping the box and clipping half a box away
  // from it.
  const centre = objectCentre(object);

  object.clipPath = new Rect({
    width: box.width / scaleX,
    height: box.height / scaleY,
    left: (box.x + box.width / 2 - centre.x) / scaleX,
    top: (box.y + box.height / 2 - centre.y) / scaleY,
    originX: "center",
    originY: "center",
  });
}
