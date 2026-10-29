import { type Canvas, FabricImage, type FabricObject, Rect } from "fabric/es";
import type { ErrorManager } from "../error-manager/index.js";

interface CropRect {
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly top: number;
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
 * image units, the same convention `fitImage`'s cover branch uses.
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
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error("A crop needs finite, positive image scales.");
    }
  }
  return {
    width: input.frame.width / scaleX,
    height: input.frame.height / scaleY,
    left: (input.frame.centreX - input.imageCentreX) / scaleX,
    top: (input.frame.centreY - input.imageCentreY) / scaleY,
  };
}

export function createCropManager(options: CropManagerOptions): CropManager {
  const { canvas, save, errors } = options;
  let image: FabricImage | undefined;
  let frame: Rect | undefined;
  let release: (() => void) | undefined;

  const end = (): void => {
    if (frame !== undefined) {
      canvas.remove(frame);
      // A locally-constructed transient that was never a document object, so
      // disposing it is correct — and with the scene adapter no longer
      // disposing whatever anyone removes (`vg-486`), it has to be
      // said here or nothing says it.
      frame.dispose();
    }
    frame = undefined;
    image = undefined;
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
      const bounds = target.getBoundingRect();
      image = target;
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
      canvas.requestRenderAll();
    },

    apply(): void {
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
      image.set(
        "clipPath",
        new Rect({ ...rect, originX: "center", originY: "center" }),
      );
      image.set("dirty", true);
      const cropped = image;
      end();
      canvas.setActiveObject(cropped);
      // Committing is the only point a crop enters undo history.
      save();
    },

    cancel(): void {
      const cancelled = image;
      end();
      if (cancelled !== undefined) canvas.setActiveObject(cancelled);
    },
  };
}
