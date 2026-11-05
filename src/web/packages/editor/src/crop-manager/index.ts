import { setObjectCropped } from "@yunari/scene-fabric";
import {
  type Canvas,
  Control,
  controlsUtils,
  FabricImage,
  type FabricObject,
  Rect,
} from "fabric/es";
import type { ErrorManager } from "../error-manager/index.js";

interface CropRect {
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly top: number;
}

/** The frame's own gesture events: resizing repaints the live clip and the
 *  settled value is the commit. Moving is not one of them — the frame is fixed
 *  in crop mode, and a drag inside it moves the image instead. */
const FRAME_EVENTS = ["scaling", "modified"] as const;

/**
 * A crop handle, drawn as an L bracket at a corner and as a short bar at an
 * edge. The transform handles are filled squares; a crop session has to look
 * different from a transform, so the author reads which of the two gestures
 * the box is offering before touching it.
 */
const renderCropHandle = function (
  this: Control,
  ctx: Parameters<Control["render"]>[0],
  left: number,
  top: number,
  styleOverride: Parameters<Control["render"]>[3],
  fabricObject: Parameters<Control["render"]>[4],
) {
  ctx.save();
  this.commonRenderProps(ctx, left, top, fabricObject, styleOverride);
  ctx.strokeStyle = "#3b82f6";
  ctx.lineWidth = 2;
  ctx.lineCap = "butt";
  const arm = 9;
  ctx.beginPath();
  if (this.x === 0) {
    ctx.moveTo(-arm, 0);
    ctx.lineTo(arm, 0);
  } else if (this.y === 0) {
    ctx.moveTo(0, -arm);
    ctx.lineTo(0, arm);
  } else {
    // The arms point into the box, which is the bracket every crop tool draws.
    const x = this.x < 0 ? arm : -arm;
    const y = this.y < 0 ? arm : -arm;
    ctx.moveTo(0, 0);
    ctx.lineTo(x, 0);
    ctx.moveTo(0, 0);
    ctx.lineTo(0, y);
  }
  ctx.stroke();
  ctx.restore();
};

/** The transform controls' own action handlers, with the rotation handle
 *  removed and the square render replaced. Reusing the handlers keeps scaling,
 *  cursors and the fixed anchor exactly as Fabric defines them. */
function cropControls(): Record<string, Control> {
  const controls = controlsUtils.createObjectDefaultControls() as Record<
    string,
    Control
  >;
  delete controls.mtr;
  for (const control of Object.values(controls)) {
    control.render = renderCropHandle;
    control.sizeX = 24;
    control.sizeY = 24;
  }
  return controls;
}

export interface CropManager {
  readonly active: boolean;
  /**
   * The image an open session is cropping, or undefined when none is.
   *
   * A session makes its frame the active object, so a panel that follows the
   * selection alone would describe the frame rather than the image the author
   * is cropping. The session is the only thing that knows which image that is.
   */
  readonly target: FabricObject | undefined;
  /** False when the active object cannot host a crop session. */
  begin(image?: FabricObject): boolean;
  setAspect(ratio: number | undefined): void;
  apply(): void;
  cancel(): void;
}

/**
 * Whether this object can host a crop session, narrowing it to the image a
 * session would then take.
 *
 * The control that offers a crop and the session that refuses one read the same
 * two conditions from here, so the button cannot appear for a selection the
 * session would then turn away.
 */
export function canCrop(target: object | undefined): target is FabricImage {
  return target instanceof FabricImage && (target.angle ?? 0) === 0;
}

interface CropManagerOptions {
  readonly canvas: Canvas;
  readonly save: () => void;
  readonly suspend: () => () => void;
  readonly errors: ErrorManager;
}

/**
 * Fabric positions a non-absolute clipPath from the object's centre in unscaled
 * image units, the same convention `fitImage`'s cover branch uses. A flipped
 * image carries a negative scale on that axis, so the centre offset follows its
 * sign while the clip's own size is always positive.
 */
export function cropClipRect(input: {
  readonly imageCentreX: number;
  readonly imageCentreY: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly frame: {
    readonly centreX: number;
    readonly centreY: number;
    readonly width: number;
    readonly height: number;
  };
}): CropRect {
  const { scaleX, scaleY } = input;
  for (const value of [scaleX, scaleY]) {
    if (!Number.isFinite(value) || value === 0) {
      throw new Error("A crop needs finite, non-zero image scales.");
    }
  }
  return {
    width: input.frame.width / Math.abs(scaleX),
    height: input.frame.height / Math.abs(scaleY),
    left: (input.frame.centreX - input.imageCentreX) / scaleX,
    top: (input.frame.centreY - input.imageCentreY) / scaleY,
  };
}

/**
 * The frame's visible box without its 1px stroke. `getBoundingRect` includes
 * the stroke, and every clamp below is about the picture and the crop, not the
 * line the author sees.
 */
function frameBox(frame: Rect): {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
} {
  return {
    left: frame.left,
    top: frame.top,
    width: frame.width * Math.abs(frame.scaleX),
    height: frame.height * Math.abs(frame.scaleY),
  };
}

function imageBox(image: FabricImage): {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
} {
  const bounds = image.getBoundingRect();
  return {
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height,
  };
}

export function createCropManager(options: CropManagerOptions): CropManager {
  const { canvas, save, errors } = options;
  let image: FabricImage | undefined;
  let frame: Rect | undefined;
  let release: (() => void) | undefined;
  /** The clip the image had before this session, restored by cancel. */
  let previousClip: FabricImage["clipPath"];
  /** The one clip this session paints; moving the frame mutates it. */
  let preview: Rect | undefined;
  /** Where the image sat when the session began. A drag inside the crop box
   *  moves the picture; cancel puts it back exactly where it was. */
  let originalPosition:
    | { readonly left: number; readonly top: number }
    | undefined;
  /** A drag inside the frame: the picture follows the pointer while the frame
   *  stays put. Fabric still reports the gesture, but the frame is locked. */
  let pan:
    | {
        readonly pointerX: number;
        readonly pointerY: number;
        readonly imageLeft: number;
        readonly imageTop: number;
        readonly image: ReturnType<typeof imageBox>;
        readonly frame: ReturnType<typeof frameBox>;
      }
    | undefined;

  /**
   * Paints the image as the frame currently cuts it.
   *
   * The frame is the box the author drags, so the picture must follow it while
   * the drag is happening. Waiting for apply left the whole picture staring back
   * out of a shrunken box, which is what an author reads as crop doing nothing.
   */
  const clipToFrame = (): void => {
    if (frame === undefined || image === undefined) return;
    const frameBounds = frame.getBoundingRect();
    const imageBounds = image.getBoundingRect();
    const rect = cropClipRect({
      imageCentreX: imageBounds.left + imageBounds.width / 2,
      imageCentreY: imageBounds.top + imageBounds.height / 2,
      scaleX: image.scaleX,
      scaleY: image.scaleY,
      frame: {
        centreX: frameBounds.left + frameBounds.width / 2,
        centreY: frameBounds.top + frameBounds.height / 2,
        width: frameBounds.width,
        height: frameBounds.height,
      },
    });
    preview ??= new Rect({ originX: "center", originY: "center" });
    preview.set(rect);
    image.set("clipPath", preview);
    image.set("dirty", true);
    canvas.requestRenderAll();
  };

  /**
   * Keeps the crop box on the picture. A handle dragged outwards — or past an
   * edge — is stopped at the image, so the box can never frame empty canvas and
   * a crop can only narrow the picture, never invent another.
   */
  const clampFrame = (): void => {
    if (frame === undefined || image === undefined) return;
    const picture = imageBox(image);
    const box = frameBox(frame);
    const left = Math.max(box.left, picture.left);
    const top = Math.max(box.top, picture.top);
    const right = Math.min(box.left + box.width, picture.left + picture.width);
    const bottom = Math.min(box.top + box.height, picture.top + picture.height);
    const width = Math.max(1, right - left);
    const height = Math.max(1, bottom - top);
    if (
      left === box.left &&
      top === box.top &&
      width === box.width &&
      height === box.height
    ) {
      return;
    }
    frame.set({
      left,
      top,
      width,
      height,
      scaleX: 1,
      scaleY: 1,
    });
    frame.setCoords();
    clipToFrame();
  };

  /** A press inside the frame (not on a handle) starts panning the picture. */
  const startPan = (event: {
    readonly target?: FabricObject;
    readonly transform?: { readonly action?: string } | null;
    readonly scenePoint?: { readonly x: number; readonly y: number };
  }): void => {
    if (frame === undefined || image === undefined) return;
    if (event.target !== frame) return;
    if (event.transform?.action !== "drag") return;
    const point = event.scenePoint;
    if (point === undefined) return;
    pan = {
      pointerX: point.x,
      pointerY: point.y,
      imageLeft: image.left,
      imageTop: image.top,
      image: imageBox(image),
      frame: frameBox(frame),
    };
  };

  /**
   * The picture follows the pointer, clamped so the fixed crop box stays over
   * it. The box is the thing being composed, so it does not move; the picture
   * does. That is the gesture every crop tool offers and the opposite of
   * dragging the box across a still picture.
   */
  const movePan = (event: {
    readonly scenePoint?: { readonly x: number; readonly y: number };
  }): void => {
    if (pan === undefined || image === undefined) return;
    const point = event.scenePoint;
    if (point === undefined) return;
    // The allowed image origins are the ones that still cover the frame.
    const minX =
      pan.frame.left + pan.frame.width - (pan.image.left + pan.image.width);
    const maxX = pan.frame.left - pan.image.left;
    const minY =
      pan.frame.top + pan.frame.height - (pan.image.top + pan.image.height);
    const maxY = pan.frame.top - pan.image.top;
    const dx = Math.min(maxX, Math.max(minX, point.x - pan.pointerX));
    const dy = Math.min(maxY, Math.max(minY, point.y - pan.pointerY));
    image.set({ left: pan.imageLeft + dx, top: pan.imageTop + dy });
    image.setCoords();
    clipToFrame();
  };

  const endPan = (): void => {
    pan = undefined;
  };

  const apply = (): void => {
    if (frame === undefined || image === undefined) return;
    clipToFrame();
    const cropped = image;
    // The clip is not yet destructive: the source image still holds every
    // hidden pixel. Publishing or exporting bakes the visible crop into a new
    // asset, and this marker is how that pass finds the images to bake.
    setObjectCropped(cropped, true);
    previousClip = undefined;
    end();
    canvas.setActiveObject(cropped);
    // Committing is the only point a crop enters undo history.
    save();
  };

  const cancel = (): void => {
    const cancelled = image;
    const prior = previousClip;
    const position = originalPosition;
    end();
    if (cancelled !== undefined) {
      cancelled.set("clipPath", prior);
      if (position !== undefined) {
        cancelled.set({ left: position.left, top: position.top });
      }
      cancelled.setCoords();
      cancelled.set("dirty", true);
      canvas.setActiveObject(cancelled);
      canvas.requestRenderAll();
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (frame === undefined) return;
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      apply();
      return;
    }
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    cancel();
  };

  const end = (): void => {
    if (frame !== undefined) {
      for (const event of FRAME_EVENTS) frame.off(event, onFrameChanged);
      canvas.remove(frame);
      // A locally-constructed transient that was never a document object, so
      // disposing it is correct — and with the scene adapter no longer
      // disposing whatever anyone removes, it has to be
      // said here or nothing says it.
      frame.dispose();
    }
    frame = undefined;
    image = undefined;
    preview = undefined;
    pan = undefined;
    originalPosition = undefined;
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("mouseup", endPan);
    canvas.off("mouse:down" as never, startPan as never);
    canvas.off("mouse:move" as never, movePan as never);
    canvas.off("mouse:up" as never, endPan as never);
    release?.();
    release = undefined;
    canvas.requestRenderAll();
  };

  /** The live clip plus the bound: a resize can never leave the picture. */
  const onFrameChanged = (): void => {
    clampFrame();
    clipToFrame();
  };

  return {
    get active(): boolean {
      return frame !== undefined;
    },

    get target(): FabricObject | undefined {
      return image;
    },

    begin(target = canvas.getActiveObject() ?? undefined): boolean {
      if (frame !== undefined) return false;
      if (!canCrop(target)) {
        errors.warn(
          "crop",
          target instanceof FabricImage
            ? "A rotated image cannot be cropped yet."
            : "Select an image before starting a crop.",
        );
        return false;
      }
      const bounds = target.getBoundingRect();
      image = target;
      previousClip = target.clipPath;
      originalPosition = { left: target.left, top: target.top };
      preview = undefined;
      frame = new Rect({
        // `getBoundingRect` reports a corner and a `Rect` is anchored at its
        // centre, so without these the frame drew a whole image up and to the
        // left of the image, three of its four crop edges off the canvas.
        originX: "left",
        originY: "top",
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
        fill: "rgba(0,0,0,0)",
        stroke: "#3b82f6",
        strokeWidth: 1,
        strokeUniform: true,
        borderColor: "#3b82f6",
        borderDashArray: [4, 4],
        excludeFromExport: true,
        // The box is the composed frame, so it does not travel: a drag inside
        // moves the picture underneath it.
        lockMovementX: true,
        lockMovementY: true,
        lockRotation: true,
        lockScalingFlip: true,
        hoverCursor: "grab",
        moveCursor: "grabbing",
        controls: cropControls(),
      });
      for (const event of FRAME_EVENTS) frame.on(event, onFrameChanged);
      release = options.suspend();
      canvas.add(frame);
      canvas.setActiveObject(frame);
      window.addEventListener("keydown", onKeyDown, true);
      window.addEventListener("mouseup", endPan);
      canvas.on("mouse:down" as never, startPan as never);
      canvas.on("mouse:move" as never, movePan as never);
      canvas.on("mouse:up" as never, endPan as never);
      // The full picture is the crop's source. Framing only what an earlier
      // crop left would make the box equal to the picture, with nowhere to pan
      // and no way to read the crop box against the whole image.
      clipToFrame();
      canvas.requestRenderAll();
      return true;
    },

    setAspect(ratio): void {
      if (frame === undefined) return;
      if (ratio === undefined) return;
      if (!Number.isFinite(ratio) || ratio <= 0) {
        errors.warn("crop", "A crop aspect ratio must be finite and positive.");
        return;
      }
      // Object space, not getScaledWidth: the stroke-free width is the honest
      // base. The ratio is fitted inside the picture rather than against the
      // frame's current width, so a square on a landscape image becomes the
      // largest square the image can hold instead of overflowing its height.
      frame.set({ scaleX: 1, scaleY: 1 });
      const box = frameBox(frame);
      const picture = imageBox(image as FabricImage);
      let width = picture.width;
      let height = width / ratio;
      if (height > picture.height) {
        height = picture.height;
        width = height * ratio;
      }
      const centreX = box.left + box.width / 2;
      const centreY = box.top + box.height / 2;
      const left = Math.min(
        Math.max(centreX - width / 2, picture.left),
        picture.left + picture.width - width,
      );
      const top = Math.min(
        Math.max(centreY - height / 2, picture.top),
        picture.top + picture.height - height,
      );
      frame.set({ left, top, width, height });
      frame.setCoords();
      onFrameChanged();
    },

    apply,

    cancel,
  };
}
