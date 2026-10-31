import {
  type Artboard,
  type ArtboardTransform,
  type AssetReference,
  type Background,
  computeArtboardTransform,
  type DisplayPresentation,
  type DisplayShape,
  type GlassSampling,
  type SceneHandle,
  type ScenePlan,
} from "@yunari/renderer-core";
import { StaticCanvas } from "fabric/es";
import {
  createSceneAdapter,
  type SceneAdapter,
  type SceneAdapterOptions,
} from "./adapter.js";
import { artboardBackdrop } from "./artboard-backdrop.js";
import { cssArtboardPaint } from "./artboard-paint.js";
import {
  type BackgroundMediaHandle,
  type BackgroundMediaSource,
  type MediaBox,
  mountBackgroundMedia,
} from "./background-media.js";
import { createGlass } from "./glass.js";
import { clampRenderScale } from "./render-scale.js";

/**
 * Owns the canvas element, viewport/artboard fit and DPR. `adapter.ts` owns plan
 * reconciliation. Detached charts receive artboard scale × Fabric retina scale.
 */

/**
 * The part of a document artboard this scene applies: its geometry and how its
 * content fits.
 *
 * **Never its paint or its media.** The background is its own envelope section,
 * so a document-level artboard change and a background change are two different
 * events: the artboard arrives here, the background through `updateBackground`.
 * `planArtboard` owns resolving either through `globals`, so this scene takes
 * the resolved paint from the plan and the media bag as it was authored.
 */
export type SceneArtboard = Pick<Artboard, "width" | "height" | "contentFit">;

export interface FabricSceneOptions
  extends Omit<SceneAdapterOptions, "canvas"> {
  readonly host: HTMLElement;
  readonly plan: ScenePlan;
  readonly artboard?: SceneArtboard;
  /** The authored background bag, beside the plan rather than inside it: the
   * plan carries its resolved colour, while the media is a DOM layer the scene
   * mounts and re-places itself. */
  readonly background?: Background;
  readonly assets?: readonly AssetReference[];
  readonly resolveAsset?: (
    assetId: string,
  ) => BackgroundMediaSource | undefined;
  /** Reports an unresolvable declared background; distinct from the adapter's
   * per-node `onAssetError`. */
  readonly onMediaError?: (message: string) => void;
  /** Reports a glass panel this renderer cannot composite, such as a browser
   * without `ctx.filter` or a cross-origin asset that taints the surface. */
  readonly onGlassError?: (message: string) => void;
  /** The sampling a glass panel gets when its treatment names none. Absent is
   * `"dynamic"`; a hardware panel sets `"static"`, because the page it renders
   * never shows the live frames its glass would otherwise follow. */
  readonly defaultSampling?: GlassSampling;
  /** The display's shape and mounting angle. Absent is a rectangular, upright
   * display, which is the scene's behaviour before a record was known. */
  readonly presentation?: DisplayPresentation;
}

export interface FabricSceneHandle extends SceneHandle {
  readonly canvas: StaticCanvas;
  readonly adapter: SceneAdapter;
  /**
   * The artboard's geometry changes. `ScenePlan` cannot carry a document-level
   * change, so this is how one arrives.
   *
   * **A geometry change, so everything geometry drives follows it.** The
   * viewport is re-fitted and the render scale re-derived, not only the media
   * layer; `contentFit` comes from the artboard passed in rather than from the
   * plan's; and it is no longer a no-op on a scene mounted without an asset
   * resolver. The background is not part of it — see `SceneArtboard`.
   */
  updateArtboard(artboard: SceneArtboard): void;
  /**
   * The background's media changes. The colour is the plan's (only `planArtboard`
   * can resolve a palette reference), so it arrives through `update()`; this is
   * the authored bag, and the layer re-places rather than restarts a video.
   */
  updateBackground(background: Background | undefined): void;
  /**
   * The display's shape or mounting angle changes. A presentation change is a
   * geometry change: the viewport, the disc and the media bounds are re-derived
   * from it together, so the composition and its background cannot disagree.
   *
   * An angle the shape cannot hold is refused by `computeArtboardTransform`, and
   * the previous presentation is kept rather than half-applied.
   */
  updatePresentation(next: DisplayPresentation): void;
  /**
   * Stops the background video decoding and following frames while the page is
   * not visible. A media-less scene has nothing to pause.
   */
  pauseMedia(): void;
  /** Resumes the media pause: decoding, and frames if a glass panel samples it. */
  resumeMedia(): void;
}

export function mountFabricScene(
  options: FabricSceneOptions,
): FabricSceneHandle {
  const { host } = options;
  let plan = options.plan;

  host.textContent = "";
  host.style.overflow = "hidden";

  // Preserve hosts already positioned by their own layout.
  if (getComputedStyle(host).position === "static") {
    host.style.position = "relative";
  }

  const element = document.createElement("canvas");
  element.dataset["yunari"] = "artboard";
  element.style.position = "absolute";
  element.style.top = "0";
  element.style.left = "0";
  host.append(element);

  const canvas = new StaticCanvas(element, {
    width: Math.max(1, host.clientWidth),
    height: Math.max(1, host.clientHeight),
    renderOnAddRemove: false,
  });

  const adapter = createSceneAdapter({
    canvas,
    ...withoutHostAndPlan(options),
  });
  let currentArtboard = options.artboard;
  let presentation: DisplayPresentation = options.presentation ?? {
    shape: "rect",
  };
  /** The disc's own DOM element, created on the first circle presentation and
   *  reused after: it is the disc's paint, behind the media layer. */
  let disc: HTMLDivElement | undefined;
  let disposed = false;
  // **Each reaches the other through a closure, and neither can be passed by
  // value.** The handle is built first with a `backdrop` that reads this, and
  // the media layer is assigned after it so its `onFrame` can read the handle
  // (R64).
  let media: BackgroundMediaHandle | undefined;
  /** The host size and pixel ratio the last fit was for, so `resize()` can tell
   *  a layout change from a pixel change. A `ResizeObserver` fires for both, and
   *  moving the window between monitors changes the ratio at the same size. */
  let fitted:
    | {
        readonly width: number;
        readonly height: number;
        readonly ratio: number;
      }
    | undefined;

  // Glass is not a plan feature: it is a property on revived Fabric objects, so
  // the owner re-resolves them from the canvas rather than from `update()`.
  //
  // **The backdrop carries the board's paint as well as the media.** It
  // is wired whether or not a media layer exists, because the paint is the whole
  // backdrop for a theme that declares none, and the canvas is no longer allowed
  // to hold it: a fill there sits above the media and hides it.
  const glass = createGlass({
    canvas,
    backdrop: () =>
      artboardBackdrop({
        background: plan.artboard.background,
        width: currentArtboard?.width ?? plan.artboard.width,
        height: currentArtboard?.height ?? plan.artboard.height,
        media: media?.backdrop(),
        // The media turns with the composition; the display's own surface does
        // not. Without this the paint a panel sees where the media is absent
        // would be the turned board rather than the host or the disc.
        angle: presentation.rotation ?? 0,
        surface: {
          shape: presentation.shape,
          box: displayBox(
            host.clientWidth,
            host.clientHeight,
            presentation.shape,
          ),
        },
      }),
    ...(options.onGlassError === undefined
      ? {}
      : { onGlassError: options.onGlassError }),
    ...(options.defaultSampling === undefined
      ? {}
      : { defaultSampling: options.defaultSampling }),
  });

  if (options.resolveAsset !== undefined && currentArtboard !== undefined) {
    media = mountBackgroundMedia({
      host,
      background: options.background,
      artboard: currentArtboard,
      assets: options.assets,
      resolveAsset: options.resolveAsset,
      // Nothing has rendered, so no panel has a surface yet. Passing the count
      // rather than syncing after the mount keeps a panel that arrives later
      // from costing one frame callback before it exists.
      glassSurfaces: glass.samplingSurfaces(),
      // The video is not a Fabric object, so nothing else would repaint — but
      // only a glass panel reads the backdrop. The media layer already gates
      // *arming* (see `syncGlassSurfaces`); this is the per-frame half, for a
      // callback already queued when the last panel left.
      onFrame: () => {
        if (glass.liveSurfaces() > 0) canvas.requestRenderAll();
      },
      ...(options.onMediaError === undefined
        ? {}
        : { onMediaError: options.onMediaError }),
    });
  }

  /** A panel's scratch surface is allocated during a render, so the render is
   *  where the count changes. The mount's own render is the first opportunity,
   *  which is why this is not a decision taken at mount time. */
  const syncGlassSurfaces = (): void => {
    media?.setGlassSurfaces(glass.samplingSurfaces());
  };
  canvas.on("after:render", syncGlassSurfaces);

  let currentTransform = fit();

  /**
   * The display's shape as DOM: the disc's own paint, and the clip that makes
   * the canvas show it. A Fabric canvas is a rectangle whose painted content is
   * the composition, so `border-radius` would round the element and leave the
   * plate's corners inside it; the disc has to be the clip.
   */
  function applyPresentation(paint: string): void {
    const width = host.clientWidth;
    const height = host.clientHeight;
    const box = displayBox(width, height, presentation.shape);
    if (presentation.shape === "circle") {
      // Outside the disc is outside the screen, so the host is black and the
      // disc itself carries the theme's paint.
      host.style.background = "#000";
      const discElement = presentationDisc();
      discElement.style.display = "";
      discElement.style.left = `${box.left}px`;
      discElement.style.top = `${box.top}px`;
      discElement.style.width = `${box.width}px`;
      discElement.style.height = `${box.height}px`;
      discElement.style.borderRadius = "50%";
      discElement.style.background = paint;
      element.style.clipPath = `circle(${box.width / 2}px at ${width / 2}px ${height / 2}px)`;
      return;
    }
    // Rect: the host is the board's paint and its letterbox, exactly as before a
    // record existed, and the disc is not part of the composition.
    host.style.background = paint;
    element.style.clipPath = "";
    if (disc !== undefined) disc.style.display = "none";
  }

  function presentationDisc(): HTMLDivElement {
    if (disc !== undefined) return disc;
    const made = document.createElement("div");
    made.dataset["yunariDisplayDisc"] = "";
    made.style.position = "absolute";
    made.style.pointerEvents = "none";
    disc = made;
    // First child, so the media layer — a sibling below the canvas — paints over
    // the disc's colour rather than being covered by it.
    host.prepend(made);
    return made;
  }

  function fit(): ArtboardTransform {
    // The document's artboard when there is one, because it is the only source
    // that moves: `ScenePlan` cannot carry a document-level change, and
    // `updateArtboard` is how one arrives. Its paint is not read from here — a
    // document artboard's `background` may still be a palette reference, which
    // only the plan builder can resolve.
    const geometry = currentArtboard ?? plan.artboard;
    const transform = computeArtboardTransform({
      artboard: { width: geometry.width, height: geometry.height },
      viewport: { width: host.clientWidth, height: host.clientHeight },
      contentFit: geometry.contentFit ?? "contain",
      shape: presentation.shape,
      ...(presentation.rotation === undefined
        ? {}
        : { rotation: presentation.rotation }),
    });
    // **After the transform, not before.** A refused angle throws above, and a
    // size recorded for a fit that never happened would make the next `resize()`
    // early-return on a host size this scene has not been fitted to.
    fitted = {
      width: host.clientWidth,
      height: host.clientHeight,
      ratio: window.devicePixelRatio,
    };

    // The one artboard paint is the board's fill and the bars behind it (§53).
    // It is the **host's**, which puts it behind the media layer, so a
    // `"theme"`-fitted layer covers the board and the host's colour is what the
    // reader sees in the letterbox.
    applyPresentation(cssArtboardPaint(plan.artboard.background) ?? "#000");
    // **The canvas paints nothing at all.** It sits above the media layer, so a
    // fill on it hides the media completely; what a glass panel samples instead
    // is the backdrop, which carries the paint. Cleared rather than left
    // alone, because a revived document can bring a fill of its own.
    canvas.backgroundColor = "";
    element.style.visibility = transform.isDegenerate ? "hidden" : "visible";
    if (!transform.isDegenerate) {
      // The display box is the disc for a round panel: a display-bounded media
      // layer fills the screen there and is clipped to the disc by `place`.
      media?.setBounds({
        artboard: {
          left: transform.offsetX,
          top: transform.offsetY,
          width: geometry.width * transform.scale,
          height: geometry.height * transform.scale,
          angle: transform.rotation,
        },
        display: displayBox(
          host.clientWidth,
          host.clientHeight,
          presentation.shape,
          transform.rotation,
        ),
      });
    }

    if (transform.isDegenerate) {
      return transform;
    }

    canvas.setDimensions({
      width: Math.max(1, host.clientWidth),
      height: Math.max(1, host.clientHeight),
    });

    canvas.setViewportTransform([...transform.matrix]);

    adapter.setRenderScale(
      clampRenderScale(transform.scale * canvas.getRetinaScaling(), 1, 1),
    );

    return transform;
  }

  adapter.apply(plan);
  canvas.requestRenderAll();

  return {
    canvas,
    adapter,
    artboard: element,

    transform(): ArtboardTransform {
      return currentTransform;
    },

    update(next: ScenePlan): void {
      if (disposed) return;
      plan = next;
      currentTransform = fit();
      adapter.apply(next);
    },

    updateArtboard(artboard: SceneArtboard): void {
      if (disposed) return;
      currentArtboard = artboard;
      // The size reaches the media, and `fit()` below re-places it against the
      // bounds the new geometry produces: `setArtboardSize` alone would place
      // the layer against the box the board no longer has, which is what
      // `bounds: "theme"` means.
      media?.setArtboardSize(artboard);
      currentTransform = fit();
      canvas.requestRenderAll();
    },

    updateBackground(background: Background | undefined): void {
      if (disposed) return;
      // Same asset re-places the mounted element; a different one remounts,
      // because a remount is what restarts a video (Task 5's handle).
      media?.setBackground(background);
      canvas.requestRenderAll();
    },

    updatePresentation(next: DisplayPresentation): void {
      if (disposed) return;
      const previous = presentation;
      presentation = next;
      try {
        currentTransform = fit();
      } catch (error) {
        // A refused angle must not leave the scene claiming the shape it could
        // not present; `computeArtboardTransform` throws before any DOM write.
        presentation = previous;
        throw error;
      }
      canvas.requestRenderAll();
    },

    resize(): void {
      // A `ResizeObserver` and an `orientationchange` handler both outlive a
      // teardown, and the player's `pagehide` is not the only way a mount ends.
      if (disposed) return;
      // The observer fires for layout changes that leave the pixel size alone,
      // and re-fitting those is a canvas resize and a full repaint for nothing.
      // The ratio is part of the fit: moving between monitors changes the
      // backing store at the same CSS size.
      if (
        fitted !== undefined &&
        fitted.width === host.clientWidth &&
        fitted.height === host.clientHeight &&
        fitted.ratio === window.devicePixelRatio
      ) {
        return;
      }
      currentTransform = fit();
      canvas.requestRenderAll();
    },

    pauseMedia(): void {
      if (disposed) return;
      media?.pause();
    },

    resumeMedia(): void {
      if (disposed) return;
      media?.resume();
    },

    dispose(): void {
      // Fabric's own `destroy()` throws on a second call, and a teardown path
      // is exactly where a handle gets disposed twice.
      if (disposed) return;
      disposed = true;
      adapter.dispose();
      // Before the media: the glass sampler reads the media layer.
      glass.dispose();
      media?.destroy();
      canvas.off("after:render", syncGlassSurfaces);
      // `destroy()` also disposes remaining Fabric objects.
      void canvas.destroy();
      host.textContent = "";
    },
  };
}
/** The display's own box in host pixels: the host rect for a rect display, the
 *  centred disc (`min(width, height)`) for a circle.
 *
 *  **A media layer sized to it turns with the mount angle, about its centre.**
 *  The screen's own surface — the disc and the letterbox — does not move: only
 *  the content inside it turns. A turned rect layer is sized to the viewport
 *  with its edges swapped, so after the quarter turn it still covers the glass;
 *  the corners it gains fall outside the host's clip. */
function displayBox(
  width: number,
  height: number,
  shape: DisplayShape,
  rotation = 0,
): MediaBox {
  const turn: Pick<MediaBox, "angle" | "angleOrigin"> =
    rotation === 0 ? {} : { angle: rotation, angleOrigin: "centre" };
  if (shape === "rect") {
    if (rotation === 90 || rotation === 270) {
      return {
        left: (width - height) / 2,
        top: (height - width) / 2,
        width: height,
        height: width,
        ...turn,
      };
    }
    return { left: 0, top: 0, width, height, ...turn };
  }
  const diameter = Math.min(width, height);
  return {
    left: (width - diameter) / 2,
    top: (height - diameter) / 2,
    width: diameter,
    height: diameter,
    radius: "circle",
    ...turn,
  };
}

/** Forward adapter options explicitly so scene-only options cannot leak through later. */
function withoutHostAndPlan(
  options: FabricSceneOptions,
): Omit<SceneAdapterOptions, "canvas"> {
  return {
    ...(options.renderScale === undefined
      ? {}
      : { renderScale: options.renderScale }),
    ...(options.onAssetError === undefined
      ? {}
      : { onAssetError: options.onAssetError }),
    ...(options.onUnsupported === undefined
      ? {}
      : { onUnsupported: options.onUnsupported }),
  };
}
