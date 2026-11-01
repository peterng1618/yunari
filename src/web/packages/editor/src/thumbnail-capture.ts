import type { ArtboardShape } from "@yunari/renderer-core";
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
  shape: ArtboardShape = "rect",
): HTMLCanvasElement | undefined {
  const width = canvas.width;
  const height = canvas.height;

  if (!(width > 0) || !(height > 0)) {
    // Nothing has been laid out yet; a picture would be blank.
    return undefined;
  }

  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const previousClip = canvas.clipPath;
  if (shape === "circle") {
    // Absolute, so the export's own multiplier scales it with the scene rather
    // than placing it in the author's camera.
    canvas.clipPath = new Circle({
      radius: Math.min(width, height) / 2,
      left: width / 2,
      top: height / 2,
      originX: "center",
      originY: "center",
      absolutePositioned: true,
      excludeFromExport: true,
    });
  }
  // Only the shot is taken with the view state lifted: everything below is the
  // media the canvas cannot see, which carries no view state of its own.
  const release = suspendViewState();
  let scene: HTMLCanvasElement;
  try {
    scene = canvas.toCanvasElement(scale);
  } finally {
    release();
    // The author's canvas keeps its own clip, whatever the shot needed. A
    // canvas that had none gets none back rather than an explicit `undefined`.
    if (previousClip === undefined) delete canvas.clipPath;
    else canvas.clipPath = previousClip;
  }
  if (backdrop === undefined) return scene;

  const context = scene.getContext("2d");
  if (context === null) return scene;
  // `toCanvasElement` disables retina scaling and multiplies the viewport by
  // the export scale, so the scene plane in the picture is the live
  // transform times that scale — the same plane `glass.ts` reads.
  const view = canvas.viewportTransform;
  if (!(view[0] > 0) || !(view[3] > 0)) return scene;

  const under = document.createElement("canvas");
  under.width = scene.width;
  under.height = scene.height;
  const backdropContext = under.getContext("2d");
  if (backdropContext === null) return scene;
  backdrop.paint(
    backdropContext,
    { left: 0, top: 0, width: under.width, height: under.height },
    {
      left: view[4] * scale + backdrop.rect.left * view[0] * scale,
      top: view[5] * scale + backdrop.rect.top * view[3] * scale,
      width: backdrop.rect.width * view[0] * scale,
      height: backdrop.rect.height * view[3] * scale,
    },
    // An export is one instant, so it takes the picture the scene shows then.
    "dynamic",
  );
  // Media down first, the scene over it: a media layer that is not in the
  // picture at all is the gap this closes.
  backdropContext.drawImage(scene, 0, 0);
  return under;
}

export async function captureThumbnail(
  canvas: Canvas,
  maxEdge = MAX_EDGE,
  backdrop?: BackdropMedia,
  suspendViewState: () => () => void = () => () => {},
  shape: ArtboardShape = "rect",
): Promise<Uint8Array | undefined> {
  const source = captureCanvas(
    canvas,
    backdrop,
    maxEdge,
    suspendViewState,
    shape,
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
