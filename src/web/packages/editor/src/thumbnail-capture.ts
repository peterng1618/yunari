import type { BackdropMedia } from "@yunari/scene-fabric";
import type { Canvas } from "fabric/es";

/**
 * A PNG of the artboard, for the theme library to show.
 *
 * Rendered from the editor's own canvas, which already has the theme on screen
 * with its fonts loaded: the picture is this machine's rendering, which is what
 * a consumer choosing a look wants to see. No second renderer is involved (§31).
 *
 * The artboard's background media is a DOM sibling the canvas cannot see, so it
 * is composited underneath through the same `BackdropMedia.paint` contract the
 * glass sampler already uses (0007).
 */

/** Longest edge of the stored picture; a library card needs no more. */
const MAX_EDGE = 640;

export function captureCanvas(
  canvas: Canvas,
  backdrop: BackdropMedia | undefined,
  maxEdge = MAX_EDGE,
  /**
   * Suspends the canvas's view state — the entered-group dim — for the shot and
   * restores it after. **A capture reads the document, not the screen** (0053),
   * and lifting the view state is the canvas's own mechanism rather than a
   * second renderer's: the caller passes the suspension it wants, and the
   * default no-op is what a canvas with no view state to lift needs.
   */
  suspendViewState: () => () => void = () => () => {},
): HTMLCanvasElement | undefined {
  const width = canvas.width;
  const height = canvas.height;

  if (!(width > 0) || !(height > 0)) {
    // Nothing has been laid out yet; a picture would be blank.
    return undefined;
  }

  const scale = Math.min(1, maxEdge / Math.max(width, height));
  // Only the shot is taken with the view state lifted: everything below is the
  // media the canvas cannot see, which carries no view state of its own.
  const release = suspendViewState();
  let scene: HTMLCanvasElement;
  try {
    scene = canvas.toCanvasElement(scale);
  } finally {
    release();
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
): Promise<Uint8Array | undefined> {
  const source = captureCanvas(canvas, backdrop, maxEdge, suspendViewState);
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
