import type { Artboard } from "@yunari/renderer-core";
import type { BackdropMedia } from "@yunari/scene-fabric";
import { type Canvas, Circle } from "fabric/es";

/**
 * A PNG of the artboard, for the theme library to show.
 *
 * Rendered from the editor's own canvas, which already has the theme on screen
 * with its fonts loaded: the picture is this machine's rendering, which is what
 * a consumer choosing a look wants to see. No second renderer is involved (§31).
 *
 * The artboard's background media is a DOM sibling the canvas cannot see, so it
 * is composited underneath through the same `BackdropMedia.paint` contract the
 * glass sampler already uses.
 */

/** Longest edge of the stored picture; a library card needs no more. */
const MAX_EDGE = 640;

export function captureCanvas(
  canvas: Canvas,
  backdrop: BackdropMedia | undefined,
  maxEdge = MAX_EDGE,
  /**
   * Suspends the canvas's view state — the entered-group dim — for the shot and
   * restores it after. **A capture reads the document, not the screen**,
   * and lifting the view state is the canvas's own mechanism rather than a
   * second renderer's: the caller passes the suspension it wants, and the
   * default no-op is what a canvas with no view state to lift needs.
   */
  suspendViewState: () => () => void = () => () => {},
  /**
   * A circle theme ships as the disc inscribed in its artboard, so its picture
   * must be that disc: a card showing the square would advertise a picture the
   * panel never shows, whatever lens the author was using at the time.
   */
  artboard?: Pick<Artboard, "width" | "height" | "shape">,
): HTMLCanvasElement | undefined {
  const width = canvas.width;
  const height = canvas.height;

  if (!(width > 0) || !(height > 0)) {
    // Nothing has been laid out yet; a picture would be blank.
    return undefined;
  }

  // **The picture is the artboard, not the camera's window.** The export crop
  // is the board's own screen rect, so the PNG carries the theme's ratio and
  // nothing of the stage around it; a caller without an artboard keeps the
  // whole-canvas crop.
  const view = canvas.viewportTransform;
  const frame =
    artboard === undefined
      ? { left: 0, top: 0, width, height }
      : {
          left: view[4],
          top: view[5],
          width: artboard.width * view[0],
          height: artboard.height * view[3],
        };
  if (!(frame.width > 0) || !(frame.height > 0)) return undefined;
  const scale = Math.min(1, maxEdge / Math.max(frame.width, frame.height));
  const previousClip = canvas.clipPath;
  let release: () => void = () => {};
  let scene: HTMLCanvasElement;
  try {
    if (artboard?.shape === "circle") {
      // `canvas.clipPath` is drawn after the viewport transform, so it lives in
      // scene units, not canvas pixels: the disc is built from the artboard's
      // own size, exactly as the editor's `artboardClip` does. `absolutePositioned`
      // is inert for a canvas-level clip (it positions an *object's* clip), but
      // the disc is stated in scene units either way.
      canvas.clipPath = new Circle({
        radius: Math.min(artboard.width, artboard.height) / 2,
        left: artboard.width / 2,
        top: artboard.height / 2,
        originX: "center",
        originY: "center",
        absolutePositioned: true,
        excludeFromExport: true,
      });
    }
    // Only the shot is taken with the view state lifted: everything below is the
    // media the canvas cannot see, which carries no view state of its own.
    release = suspendViewState();
    scene = canvas.toCanvasElement(scale, frame);
  } finally {
    try {
      release();
    } finally {
      // The author's canvas keeps its own clip, whatever the shot needed. A
      // canvas that had none gets none back rather than an explicit `undefined`.
      if (previousClip === undefined) delete canvas.clipPath;
      else canvas.clipPath = previousClip;
    }
  }
  if (backdrop === undefined) return scene;

  const context = scene.getContext("2d");
  if (context === null) return scene;
  // `toCanvasElement` disables retina scaling and multiplies the viewport by
  // the export scale, so the scene plane in the picture is the live
  // transform times that scale — the same plane `glass.ts` reads.
  if (!(view[0] > 0) || !(view[3] > 0)) return scene;

  const under = document.createElement("canvas");
  under.width = scene.width;
  under.height = scene.height;
  const backdropContext = under.getContext("2d");
  if (backdropContext === null) return scene;
  // The board's shape is the picture's shape: a round theme's corners are
  // outside the theme, so the paint, the media and the scene are all clipped
  // to the disc. Without this the paint fills the square the panel never shows.
  backdropContext.save();
  if (artboard?.shape === "circle") {
    backdropContext.beginPath();
    backdropContext.arc(
      under.width / 2,
      under.height / 2,
      Math.min(under.width, under.height) / 2,
      0,
      Math.PI * 2,
    );
    backdropContext.clip();
  }
  backdrop.paint(
    backdropContext,
    { left: 0, top: 0, width: under.width, height: under.height },
    {
      left:
        (view[4] - frame.left) * scale + backdrop.rect.left * view[0] * scale,
      top: (view[5] - frame.top) * scale + backdrop.rect.top * view[3] * scale,
      width: backdrop.rect.width * view[0] * scale,
      height: backdrop.rect.height * view[3] * scale,
    },
    // An export is one instant, so it takes the picture the scene shows then.
    "dynamic",
  );
  // Media down first, the scene over it: a media layer that is not in the
  // picture at all is the gap this closes.
  backdropContext.drawImage(scene, 0, 0);
  backdropContext.restore();
  return under;
}

export async function captureThumbnail(
  canvas: Canvas,
  maxEdge = MAX_EDGE,
  backdrop?: BackdropMedia,
  suspendViewState: () => () => void = () => () => {},
  artboard?: Pick<Artboard, "width" | "height" | "shape">,
): Promise<Uint8Array | undefined> {
  const source = captureCanvas(
    canvas,
    backdrop,
    maxEdge,
    suspendViewState,
    artboard,
  );
  if (source === undefined) {
    return undefined;
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    source.toBlob((result) => resolve(result), "image/png"),
  );

  if (blob === null) {
    return undefined;
  }

  return new Uint8Array(await blob.arrayBuffer());
}
