import {
  objectAssetReference,
  setObjectAssetReference,
} from "@yunari/scene-fabric";
import {
  type Canvas,
  FabricImage,
  type FabricObject,
  Group,
  Path,
  Point,
  Polygon,
  Rect,
} from "fabric/es";
import type { AssetManager } from "./asset-manager/index.js";
import { encodePng } from "./crop-manager/encode-png.js";

export type FlipAxis = "horizontal" | "vertical";

/**
 * Mirrors the selected picture or shape, and writes that mirror into what the
 * theme stores rather than into a Fabric flag.
 *
 * A picture becomes new pixels: the source is drawn mirrored into a canvas,
 * declared as a fresh asset, and the object points at it. A polygon's points
 * and a path's commands are mirrored around their own offset, leaving the
 * object where the author put it. Neither the image nor the shape keeps a
 * `flipX`/`flipY` flag, so no surface has to reconstruct an orientation the
 * document could have carried separately.
 *
 * A gradient fill is not mirrored: only geometry and pixels are.
 */
export async function flipSelection(input: {
  readonly canvas: Canvas;
  readonly assets: AssetManager;
  readonly axis: FlipAxis;
}): Promise<boolean> {
  const object = input.canvas.getActiveObject();
  if (object === undefined || object instanceof Group) return false;
  const horizontal = input.axis === "horizontal";

  if (object instanceof FabricImage) {
    await flipImage(object, input.assets, horizontal);
  } else if (object instanceof Polygon) {
    flipPoints(object, horizontal);
  } else if (object instanceof Path) {
    flipPath(object, horizontal);
  } else {
    // A rectangle, circle or ellipse is mirror-symmetric; its flip would be a
    // no-op, so the action is not offered and never arrives here.
    return false;
  }
  input.canvas.requestRenderAll();
  return true;
}

/** The two mirrors the action asks for, old flags included. A document made
 *  before the action existed can still carry `flipX`/`flipY`; clearing them
 *  while showing the same picture means baking them into the source. */
function mirrors(
  object: FabricObject,
  horizontal: boolean,
): {
  readonly x: boolean;
  readonly y: boolean;
} {
  const vertical = !horizontal;
  return {
    x: Boolean(object.flipX) !== horizontal,
    y: Boolean(object.flipY) !== vertical,
  };
}

async function flipImage(
  object: FabricImage,
  assets: AssetManager,
  horizontal: boolean,
): Promise<void> {
  const mirror = mirrors(object, horizontal);
  if (mirror.x || mirror.y) {
    const source = object.getElement();
    if (
      !(
        source instanceof HTMLImageElement ||
        source instanceof HTMLCanvasElement
      )
    ) {
      throw new Error("The selected picture is not decoded.");
    }
    const width = Math.max(1, Math.round(object.width));
    const height = Math.max(1, Math.round(object.height));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) {
      throw new Error(
        "A 2D canvas context is unavailable to flip the picture.",
      );
    }
    context.translate(mirror.x ? width : 0, mirror.y ? height : 0);
    context.scale(mirror.x ? -1 : 1, mirror.y ? -1 : 1);
    const sourceWidth =
      source instanceof HTMLImageElement
        ? source.naturalWidth || source.width
        : source.width;
    const sourceHeight =
      source instanceof HTMLImageElement
        ? source.naturalHeight || source.height
        : source.height;
    context.drawImage(
      source,
      0,
      0,
      sourceWidth,
      sourceHeight,
      0,
      0,
      width,
      height,
    );

    const reference = objectAssetReference(object);
    if (reference !== undefined) {
      const next = await assets.deriveImage(
        reference.assetId,
        encodePng(canvas),
      );
      setObjectAssetReference(object, { assetId: next.id, kind: "image" });
    }
    object.setElement(canvas);

    // The clip is in image-local units, so mirroring the source mirrors the
    // region it shows. Without this a cover-fitted picture would swap ends.
    const clip = object.clipPath;
    if (clip instanceof Rect) {
      clip.set({
        left: mirror.x ? -clip.left : clip.left,
        top: mirror.y ? -clip.top : clip.top,
      });
    }
  }
  object.set({ flipX: false, flipY: false, dirty: true });
  object.setCoords();
}

function flipPoints(object: Polygon, horizontal: boolean): void {
  const mirror = mirrors(object, horizontal);
  if (mirror.x || mirror.y) {
    const offset = object.pathOffset;
    object.set({
      points: object.points.map(
        (point) =>
          new Point(
            mirror.x ? 2 * offset.x - point.x : point.x,
            mirror.y ? 2 * offset.y - point.y : point.y,
          ),
      ),
    });
    object.setBoundingBox();
  }
  object.set({ flipX: false, flipY: false, dirty: true });
  object.setCoords();
}

function flipPath(object: Path, horizontal: boolean): void {
  const mirror = mirrors(object, horizontal);
  if (mirror.x || mirror.y) {
    const offset = object.pathOffset;
    object.set(
      "path",
      object.path.map((command) =>
        mirrorCommand(command, offset, mirror.x, mirror.y),
      ),
    );
    object.setBoundingBox();
  }
  object.set({ flipX: false, flipY: false, dirty: true });
  object.setCoords();
}

/**
 * One absolute path command, mirrored around the path's own offset.
 *
 * Fabric stores paths in absolute commands after parsing, so a relative
 * command here would mean a second, weaker path reader; it is refused rather
 * than mirrored into the wrong place.
 */
function mirrorCommand(
  command: readonly unknown[],
  offset: Point,
  mirrorX: boolean,
  mirrorY: boolean,
): unknown[] {
  const operator = command[0];
  const x = (index: number): unknown => {
    const value = numberAt(command, index);
    return mirrorX ? 2 * offset.x - value : value;
  };
  const y = (index: number): unknown => {
    const value = numberAt(command, index);
    return mirrorY ? 2 * offset.y - value : value;
  };
  switch (operator) {
    case "M":
    case "L":
    case "T":
      return [operator, x(1), y(2)];
    case "H":
      return [operator, x(1)];
    case "V":
      return [operator, y(1)];
    case "Q":
    case "S":
      return [operator, x(1), y(2), x(3), y(4)];
    case "C":
      return [operator, x(1), y(2), x(3), y(4), x(5), y(6)];
    case "A": {
      const rotation = numberAt(command, 3);
      const sweep = numberAt(command, 5);
      // One mirror reverses the arc's handedness; two mirrors preserve it.
      const single = mirrorX !== mirrorY;
      return [
        operator,
        numberAt(command, 1),
        numberAt(command, 2),
        single ? -rotation : rotation,
        numberAt(command, 4),
        single ? 1 - sweep : sweep,
        x(6),
        y(7),
      ];
    }
    case "Z":
    case "z":
      return [operator];
    default:
      throw new Error(`Cannot flip a path command: ${String(operator)}.`);
  }
}

function numberAt(command: readonly unknown[], index: number): number {
  const value = command[index];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("A path command carries a non-finite coordinate.");
  }
  return value;
}
