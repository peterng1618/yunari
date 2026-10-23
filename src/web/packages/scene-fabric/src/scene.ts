import {
  type Artboard,
  type ArtboardTransform,
  type AssetReference,
  type Background,
  computeArtboardTransform,
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
  let disposed = false;
  // **Each reaches the other through a closure, and neither can be passed by
  // value.** The handle is built first with a `backdrop` that reads this, and
  // the media layer is assigned after it so its `onFrame` can read the handle
  // (R64).
  let media: BackgroundMediaHandle | undefined;

  // Glass is not a plan feature: it is a property on revived Fabric objects, so
  // the owner re-resolves them from the canvas rather than from `update()`.
  //
  // **The backdrop carries the board's paint as well as the media (0080).** It
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
      }),
    ...(options.onGlassError === undefined
      ? {}
      : { onGlassError: options.onGlassError }),
  });

  if (options.resolveAsset !== undefined && currentArtboard !== undefined) {
    media = mountBackgroundMedia({
      host,
      background: options.background,
      artboard: currentArtboard,
      assets: options.assets,
      resolveAsset: options.resolveAsset,
      // The video is not a Fabric object, so nothing else would repaint — but
      // only a glass panel reads the backdrop, so a video nothing blurs must
      // not repaint the whole canvas per decoded frame. Asked per frame rather
      // than decided here: a panel's surface is allocated *during a render*, and
      // the player revives its objects after the mount, so a decision taken at
      // mount time would be taken before any panel exists. The mount's own
      // render below stays unconditional, or this gate would stall at zero.
      onFrame: () => {
        if (glass.liveSurfaces() > 0) canvas.requestRenderAll();
      },
      ...(options.onMediaError === undefined
        ? {}
        : { onMediaError: options.onMediaError }),
    });
  }

  let currentTransform = fit();

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
    });

    // The one artboard paint is the board's fill and the bars behind it (§53).
    // It is the **host's**, which puts it behind the media layer, so a
    // `"theme"`-fitted layer covers the board and the host's colour is what the
    // reader sees in the letterbox (0080).
    host.style.background =
      cssArtboardPaint(plan.artboard.background) ?? "#000";
    // **The canvas paints nothing at all.** It sits above the media layer, so a
    // fill on it hides the media completely; what a glass panel samples instead
    // is the backdrop, which carries the paint (0080). Cleared rather than left
    // alone, because a revived document can bring a fill of its own.
    canvas.backgroundColor = "";
    element.style.visibility = transform.isDegenerate ? "hidden" : "visible";
    if (!transform.isDegenerate)
      media?.setBounds({
        artboard: {
          left: transform.offsetX,
          top: transform.offsetY,
          width: geometry.width * transform.scale,
          height: geometry.height * transform.scale,
        },
        display: {
          left: 0,
          top: 0,
          width: host.clientWidth,
          height: host.clientHeight,
        },
      });

    if (transform.isDegenerate) {
      return transform;
    }

    canvas.setDimensions({
      width: Math.max(1, host.clientWidth),
      height: Math.max(1, host.clientHeight),
    });

    canvas.setViewportTransform([
      transform.scale,
      0,
      0,
      transform.scale,
      transform.offsetX,
      transform.offsetY,
    ]);

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

    resize(): void {
      // A `ResizeObserver` and an `orientationchange` handler both outlive a
      // teardown, and the player's `pagehide` is not the only way a mount ends.
      if (disposed) return;
      currentTransform = fit();
      canvas.requestRenderAll();
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
      // `destroy()` also disposes remaining Fabric objects.
      void canvas.destroy();
      host.textContent = "";
    },
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
