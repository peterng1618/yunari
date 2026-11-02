import { type Canvas, FabricImage, type FabricObject, Rect } from "fabric/es";
import type { ErrorManager } from "../error-manager/index.js";

interface CropRect {
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly top: number;
}

/** The frame's own gesture events: a drag and a handle resize both repaint the
 *  live clip, and `modified` catches the settled value. */
const FRAME_EVENTS = ["moving", "scaling", "modified"] as const;

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
 * The rectangle an image currently shows: its bounds, narrowed by a crop this
 * manager wrote earlier.
 *
 * A crop is a `Rect` clip centred on the image in unscaled units, so the scene
 * rectangle it leaves is the image's centre moved by the clip's offset and sized
 * by the clip times the image's own scale. Starting the next session from the
 * full bounds instead would frame the discarded pixels and silently restore
 * them on apply.
 */
function visibleBounds(image: FabricImage): {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
} {
  const full = image.getBoundingRect();
  const clip = image.clipPath;
  if (
    !(clip instanceof Rect) ||
    clip.originX !== "center" ||
    clip.originY !== "center"
  ) {
    return full;
  }
  const scaleX = image.scaleX;
  const scaleY = image.scaleY;
  const width = (clip.width ?? 0) * Math.abs(scaleX);
  const height = (clip.height ?? 0) * Math.abs(scaleY);
  if (!(width > 0) || !(height > 0)) return full;
  const centreX = full.left + full.width / 2 + (clip.left ?? 0) * scaleX;
  const centreY = full.top + full.height / 2 + (clip.top ?? 0) * scaleY;
  return {
    left: centreX - width / 2,
    top: centreY - height / 2,
    width,
    height,
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

  const end = (): void => {
    if (frame !== undefined) {
      for (const event of FRAME_EVENTS) frame.off(event, clipToFrame);
      canvas.remove(frame);
      // A locally-constructed transient that was never a document object, so
      // disposing it is correct — and with the scene adapter no longer
      // disposing whatever anyone removes (`vg-486`), it has to be
      // said here or nothing says it.
      frame.dispose();
    }
    frame = undefined;
    image = undefined;
    preview = undefined;
    release?.();
    release = undefined;
    canvas.requestRenderAll();
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
      const bounds = visibleBounds(target);
      image = target;
      previousClip = target.clipPath;
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
        excludeFromExport: true,
        hasRotatingPoint: false,
        lockRotation: true,
      });
      for (const event of FRAME_EVENTS) frame.on(event, clipToFrame);
      release = options.suspend();
      canvas.add(frame);
      canvas.setActiveObject(frame);
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
      // Object space, not getScaledWidth: the stroke-free width is the honest base.
      frame.set({ scaleY: 1, scaleX: 1, height: frame.width / ratio });
      frame.setCoords();
      clipToFrame();
    },

    apply(): void {
      if (frame === undefined || image === undefined) return;
      clipToFrame();
      const cropped = image;
      previousClip = undefined;
      end();
      canvas.setActiveObject(cropped);
      // Committing is the only point a crop enters undo history.
      save();
    },

    cancel(): void {
      const cancelled = image;
      const prior = previousClip;
      end();
      if (cancelled !== undefined) {
        cancelled.set("clipPath", prior);
        cancelled.set("dirty", true);
        canvas.setActiveObject(cancelled);
        canvas.requestRenderAll();
      }
    },
  };
}
