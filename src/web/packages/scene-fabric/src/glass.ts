import { glassTreatment } from "@yunari/renderer-core";
import {
  Circle,
  Ellipse,
  type FabricObject,
  Group,
  Polygon,
  Rect,
  type StaticCanvas,
  Triangle,
} from "fabric/es";
import type { MediaBox } from "./background-media.js";
import { Arc, sectorPath, Wedge } from "./sector-object.js";

/**
 * Backdrop blur for authored glass panels. A panel samples the surface Fabric is
 * painting during its own `before:render`, so one path serves the live editor
 * canvas, the player's `StaticCanvas` and `toCanvasElement` capture — the panel
 * sees whatever was painted before it, which is what "behind this panel" means.
 *
 * The authored property and its validation belong to `renderer-core`; only the
 * lifecycle lives here.
 */

/** A region of the surface being painted, in that surface's own pixels. */
export interface DeviceRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** A rectangle in **artboard units** — the space the document is authored in,
 *  which the plane matrix maps onto a surface. Named because the shape is
 *  identical to `DeviceRect` and the two are not interchangeable. */
export interface ArtboardRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The artboard background media. It is a DOM sibling below the canvas, so the
 * canvas never contains it and a panel has to be handed it separately.
 *
 * The rect it covers is stated in **artboard units**, not screen pixels: a
 * `"theme"`-fitted layer covers exactly the artboard, while a `"display"`-fitted
 * one covers more and may start outside it. Mapping the rect the layer actually
 * painted with the plane matrix the sampler already uses for object bounds is
 * exact, survives a `toCanvasElement` capture, and cannot disagree with what the
 * caller happened to measure in CSS.
 */
/** The surface behind the canvas — what a panel sees wherever the media is
 *  absent or transparent. It is the display's own paint: the host rect for a
 *  rect display, the disc for a circle, in host CSS pixels. Both are DOM
 *  surfaces, so **neither turns with the composition**. */
export interface BackdropPlate {
  /** The surface's own box, in host CSS pixels. */
  readonly screenRect: MediaBox;
  /** Paints it across `region`, behind whatever is already there; `device` is
   *  `screenRect` in the context's pixels. The caller sets `destination-over`,
   *  so a kept media frame is never overwritten. */
  paint(
    ctx: CanvasRenderingContext2D,
    region: DeviceRect,
    device: DeviceRect,
  ): void;
}

export interface BackdropMedia {
  /** The media layer's rect, in artboard units. */
  readonly rect: ArtboardRect;
  /** Whole degrees clockwise the composition is turned, when this media turns
   *  with it. Omitted is upright. */
  readonly angle?: number;
  /** A display-bounded layer's own box, in host CSS pixels. Present only for a
   *  layer that fills the display: it does not turn with the composition, so its
   *  device rect is this box rather than a mapping of `rect`. */
  readonly screenRect?: MediaBox;
  /** The display's own surface, painted under the media. Absent when the media
   *  is the whole backdrop, as in the glass tests' stubs. */
  readonly plate?: BackdropPlate;
  /** Paints the media over `region` of `ctx`, with `device` its rect in `ctx`'s
   *  own pixels. False when the source has decoded no pixels yet. */
  paint(
    ctx: CanvasRenderingContext2D,
    region: DeviceRect,
    device: DeviceRect,
  ): boolean;
}

export interface GlassOptions {
  readonly canvas: StaticCanvas;
  /** Read per render: the media handle is replaced when the artboard changes. */
  readonly backdrop?: () => BackdropMedia | undefined;
  /** Reports a panel that cannot be composited. Deduped per cause, because a
   *  panel that fails the same way on every frame must not flood the host. */
  readonly onGlassError?: (message: string) => void;
}

export interface GlassHandle {
  /** Re-resolves every glass object in the tree. Called automatically when the
   *  canvas gains or loses an object, which is how revival and history undo —
   *  both of which replace object identity — get their listeners back. */
  sync(): void;
  /** Scratch canvases still allocated. Zero after `dispose`. */
  liveSurfaces(): number;
  dispose(): void;
}

/**
 * The ceiling on the **sample region**, per panel, not a scene-wide total. It
 * bounds the scratch surface and the blurred area; it does not bound blur cost,
 * which Task 1 measured as flat across a radius sweep at a fixed size. Task 1
 * measured a 1672x941 artboard peaking near 0.9 Mpx for one panel, and the
 * browser accepted far more, so this is our own ceiling, not a platform one.
 *
 * The radius cap is a different thing and lives in `renderer-core`, in artboard
 * units. Its cost argument was measured in *device* pixels at DPR 1, where the
 * two coincide, so an authored 48 is a 96 px blur at DPR 2 - past the band it
 * was chosen inside. This ceiling does not rescue that: a panel's region grows
 * with its radius by twice the radius on each side, and a 96 px blur is simply
 * more work than a 48 px one.
 */
const MAX_BACKDROP_PIXELS = 4_194_304;

/** Below this a region is a sliver and the blur has nothing to show. */
const MIN_REGION_PX = 2;

/**
 * The surface grain, composited `overlay` rather than laid on as a haze: a flat
 * translucent grey reads as a layer *over* the panel, while an overlay blend
 * scatters light the way etched glass does. Its job is to kill the banding a
 * heavy blur lays over a smooth gradient.
 *
 * **1.5 %, not the 8 % two canvas recipes name.** Measured here: at 8 % the
 * grain raised a blurred band's column-to-column step to 1.4 against a sharp
 * 1.6, which is the noise swamping the blur it sits on — and at 3 % it still
 * cut the blur's own 5.9x drop in fine detail to 1.6x. A surface noise that
 * hides the diffusion is worse than none, because the eye reads noise as
 * "not blurred". The tile is the same; the level comes from the reading.
 *
 * Not a dial. Grain is a property of the material — see
 * `docs/decisions/0013-frost-is-diffusion-grain-saturation-and-an-edge.md`.
 */
const GRAIN_ALPHA = 0.015;

/**
 * How far the glass pushes the backdrop's colour back out.
 *
 * A Gaussian blur is an average, and an average moves towards grey — that is
 * arithmetic, not taste: every channel is pulled towards its neighbours' mean,
 * so a saturated backdrop arrives desaturated. Compounding the blur with
 * `saturate()` is the correction, and the ecosystem calls it the difference
 * between amateur glass and Apple's. 1.6 is the middle of the 140–180 % band
 * those sources converge on.
 *
 * `ctx.filter` is a filter *list*, so this composes with the blur in the one
 * pass rather than costing a second one.
 */
const GLASS_SATURATION = 1.6;

/** Grain reads as grain at any density; the tile is stretched, not regenerated. */
const GRAIN_TILE_PX = 128;

interface Panel {
  readonly object: FabricObject;
  readonly onBeforeRender: (event: {
    readonly ctx: CanvasRenderingContext2D;
  }) => void;
  surface: HTMLCanvasElement | undefined;
  context: CanvasRenderingContext2D | undefined;
  /** The media **alone**, as it last painted, kept apart from the scratch so a
   *  frame the media cannot paint reuses it instead of compositing the panel
   *  over transparency (0079). */
  backdrop: HTMLCanvasElement | undefined;
  backdropContext: CanvasRenderingContext2D | undefined;
  /** The region `backdrop` was painted for. A region that has moved puts the
   *  backdrop at the wrong offset, which is worse than having none. */
  backdropRegion: DeviceRect | undefined;
}

export function createGlass(options: GlassOptions): GlassHandle {
  const { canvas } = options;
  const panels = new Map<FabricObject, Panel>();
  const reported = new Set<string>();
  // Every ancestor whose caching this handle turned off, so it can hand them
  // back. A set rather than a per-panel list because two panels in one group
  // share that group: whichever leaves first must not restore a cache the other
  // is still sampling through.
  const uncached = new Set<FabricObject>();
  // Groups whose membership this handle is following; see `sync`.
  const watched = new Set<Group>();
  // A browser either has `ctx.filter` or it does not, so this is asked once
  // rather than written and read back for every panel on every frame. Keyed by
  // the context: `toCanvasElement` paints through a different one, and a
  // handle-wide answer would carry the live canvas's verdict into the capture.
  let filterContext: CanvasRenderingContext2D | undefined;
  let filterUsable = false;
  // The grain's `CanvasPattern`, built once per context for the same reason as
  // `filterUsable` above: a pattern is a per-context object, and the capture
  // path does not paint through the live canvas's one. The tile is held
  // alongside it so `dispose` can drop its backing store, which is the release
  // contract the scratch surfaces are held to.
  let grainContext: CanvasRenderingContext2D | undefined;
  let grainPattern: CanvasPattern | null | undefined;
  let grainTileElement: HTMLCanvasElement | undefined;
  let disposed = false;

  /** This context's grain fill, built on first use and then reused. */
  function grainFill(ctx: CanvasRenderingContext2D): CanvasPattern | undefined {
    if (grainContext !== ctx) {
      grainContext = ctx;
      const tile = grainTile();
      grainTileElement = tile;
      grainPattern =
        tile === undefined ? null : ctx.createPattern(tile, "repeat");
    }
    return grainPattern ?? undefined;
  }

  function releaseGrain(): void {
    grainContext = undefined;
    grainPattern = undefined;
    if (grainTileElement !== undefined) {
      grainTileElement.width = 0;
      grainTileElement.height = 0;
      grainTileElement = undefined;
    }
  }

  function report(message: string): void {
    if (reported.has(message)) return;
    reported.add(message);
    options.onGlassError?.(message);
  }

  const release = (panel: Panel): void => {
    panel.object.off("before:render", panel.onBeforeRender);
    // Zeroing the dimensions is what actually releases the backing store;
    // dropping the reference alone leaves it alive until the element is collected.
    if (panel.surface !== undefined) {
      panel.surface.width = 0;
      panel.surface.height = 0;
    }
    panel.surface = undefined;
    panel.context = undefined;
    // The kept backdrop is a second surface per panel, so it is held to the
    // same release contract; a reference dropped without zeroing leaves its
    // backing store alive until the element is collected.
    if (panel.backdrop !== undefined) {
      panel.backdrop.width = 0;
      panel.backdrop.height = 0;
    }
    panel.backdrop = undefined;
    panel.backdropContext = undefined;
    panel.backdropRegion = undefined;
  };

  /** The panel itself and every group above it, nearest first. */
  function chain(object: FabricObject): FabricObject[] {
    const ancestors: FabricObject[] = [];
    for (
      let node: FabricObject | undefined = object;
      node !== undefined;
      node = node.parent
    )
      ancestors.push(node);
    return ancestors;
  }

  /**
   * A cached object paints into its own cache, which has no real backdrop, and
   * a cached group hides its children behind the same empty cache. Idempotent:
   * a second panel in the same group re-reads the chain and finds it already
   * switched off, which is what keeps the shared set in `sync` honest.
   */
  function uncacheChain(object: FabricObject): void {
    for (const ancestor of chain(object)) {
      if (uncached.has(ancestor)) continue;
      if (!ancestor.objectCaching) continue;
      ancestor.objectCaching = false;
      uncached.add(ancestor);
    }
  }

  function attach(object: FabricObject): void {
    if (disposed) return;
    // A panel that is already attached still has its ancestors re-read: a
    // group it has just joined is a new ancestor, and the old one is handed
    // back in `sync` once nothing needs it. Re-attaching the listener would
    // double it, so the panel itself is kept.
    if (panels.has(object)) {
      uncacheChain(object);
      return;
    }
    const treatment = glassTreatment(object);
    if (treatment === undefined) return;
    // Fabric overrides `drawObject` on `Group` and renders its children
    // directly, so a group never fires `before:render` and there is no boundary
    // at which its backdrop could be sampled. Refuse loudly rather than render
    // a panel whose blur silently never appears. Ahead of `uncacheChain`, so a
    // refused group is left exactly as the author set it.
    if (object instanceof Group) {
      report(
        `Glass on "${nameOf(object)}" is a group, which gives no render boundary to sample; put the treatment on the panel rectangle instead.`,
      );
      return;
    }
    uncacheChain(object);

    const panel: Panel = {
      object,
      surface: undefined,
      context: undefined,
      backdrop: undefined,
      backdropContext: undefined,
      backdropRegion: undefined,
      onBeforeRender: ({ ctx }) => {
        render(panel, ctx);
      },
    };
    panels.set(object, panel);
    object.on("before:render", panel.onBeforeRender);
  }

  function detach(object: FabricObject): void {
    const panel = panels.get(object);
    if (panel === undefined) return;
    panels.delete(object);
    release(panel);
  }

  const sync = (): void => {
    if (disposed) return;
    // The property's presence is the whole test. Which object kinds may carry
    // it is `renderer-core`'s vocabulary, enforced at import, and re-deciding
    // it here would put a second owner on that list.
    const live = new Set<FabricObject>();
    const groups = new Set<Group>();
    for (const object of walk(canvas.getObjects())) {
      if (object instanceof Group) groups.add(object);
      if (glassTreatment(object) !== undefined) live.add(object);
    }
    // A group is a collection too, and its own membership events never reach
    // the canvas. Grouping, ungrouping and a delete inside a group are all
    // invisible without this, and each leaves a panel sampling either a cache
    // it should have switched off or a group it should have released.
    for (const group of watched) {
      if (groups.has(group)) continue;
      group.off("object:added", sync);
      group.off("object:removed", sync);
      watched.delete(group);
    }
    for (const group of groups) {
      if (watched.has(group)) continue;
      group.on("object:added", sync);
      group.on("object:removed", sync);
      watched.add(group);
    }
    for (const object of [...panels.keys()])
      if (!live.has(object)) detach(object);
    for (const object of live) attach(object);
    // `attach` re-reads each panel's ancestors, so a panel that just joined a
    // group is covered; an ancestor no panel needs any more is handed back
    // here, once the last panel that wanted it has gone.
    const stillNeeded = new Set<FabricObject>();
    for (const object of live)
      for (const node of chain(object)) stillNeeded.add(node);
    for (const ancestor of [...uncached]) {
      if (stillNeeded.has(ancestor)) continue;
      ancestor.objectCaching = true;
      uncached.delete(ancestor);
    }
  };

  // `loadFromJSON` clears and re-adds, so revival and history undo land here
  // with new object identities; the old listeners died with the old objects.
  canvas.on("object:added", sync);
  canvas.on("object:removed", sync);

  function render(panel: Panel, ctx: CanvasRenderingContext2D): void {
    try {
      composite(panel, ctx);
    } catch (error) {
      // A panel must never break the frame; report and leave the paint intact.
      report(
        `Backdrop blur on "${nameOf(panel.object)}" failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  function composite(panel: Panel, ctx: CanvasRenderingContext2D): void {
    const { object } = panel;
    // `ctx.canvas` is whatever surface Fabric is painting: the live element, a
    // `toCanvasElement` capture, or an ancestor group's cache. Only the group
    // cache lacks a real backdrop, and sampling it would sample this panel's
    // own already-painted pixels.
    for (
      let ancestor: FabricObject | undefined = object.parent;
      ancestor !== undefined;
      ancestor = ancestor.parent
    ) {
      if (ancestor._cacheContext === ctx) {
        report(
          `An ancestor group of "${nameOf(object)}" caches its children, so its backdrop blur was skipped.`,
        );
        return;
      }
    }
    const target = ctx.canvas;
    if (target === undefined || target === null) return;
    if (filterContext !== ctx) {
      filterContext = ctx;
      filterUsable = probeFilter(ctx);
    }
    if (!filterUsable) {
      report(
        "This browser cannot blur a canvas backdrop; glass renders untinted.",
      );
      return;
    }

    // Read every factor live: `toCanvasElement` swaps the viewport transform and
    // the canvas dimensions for the duration of the capture, and the editor's
    // blur-radius control rewrites the authored property on a panel that is
    // already attached. A radius captured at attach time is the one factor here
    // that can go stale, and it is the one an author can change in place.
    const treatment = glassTreatment(object);
    if (treatment === undefined) return;
    const own = deviceMatrix(object, canvas);
    const plane = planeMatrix(canvas);
    // **The equal-area scale of the two axes, not one of them** (0053). A
    // filter takes one length and this draw is at identity, so the panel's two
    // scales have to become one number here; the determinant's root is the only
    // rotation-independent one that is unchanged whenever the scale is uniform.
    // It followed the matrix's x row alone, which is `scaleX`: a 4x1 panel
    // blurred 4x a 1x4 one at one authored value (vg-515).
    const blurRadius =
      treatment.blurRadius *
      Math.sqrt(Math.abs(own[0] * own[3] - own[1] * own[2]));

    const region = sampleRegion(object, plane, blurRadius, target);
    if (region === undefined) return;
    if (region.width * region.height > MAX_BACKDROP_PIXELS) {
      report(
        `The backdrop behind "${nameOf(object)}" is too large to sample and was left untinted.`,
      );
      return;
    }
    const scratch = surfaceFor(panel, region);
    if (scratch === undefined) return;
    const scratchContext = scratch.context;

    // The media is a DOM sibling below the canvas, so the canvas alone misses
    // the wallpaper; it goes down first and the scene composites over it. It
    // lands in a surface of its own rather than straight into the scratch, so
    // that a frame it cannot paint reuses the last one it did (0079). The
    // scratch is still rebuilt from nothing every frame, which is what keeps
    // the canvas half fresh.
    const backdrop = backdropFor(panel, region, options.backdrop?.(), plane);
    if (backdrop !== undefined) {
      scratchContext.drawImage(backdrop, 0, 0);
    }
    scratchContext.drawImage(
      target,
      region.left,
      region.top,
      region.width,
      region.height,
      0,
      0,
      region.width,
      region.height,
    );

    ctx.save();
    try {
      // Fabric has already multiplied this context by every opacity above the
      // panel's own, because a group's opacity belongs to its whole subtree and
      // every other renderer honours it. The backdrop is part of that subtree,
      // so it keeps those factors.
      //
      // The panel's own opacity is the one factor excluded: the backdrop is the
      // scene rather than the panel, and Fabric applies that factor to the
      // panel's fill immediately after this event, so applying it here too
      // would fade the blur twice. It is divided out of the live value rather
      // than recomputed, so the two cannot disagree.
      const panelOpacity = ownOpacity(object);
      if (panelOpacity === undefined) {
        report(
          `"${nameOf(object)}" has an unusable opacity, so its backdrop blur was skipped.`,
        );
        return;
      }
      ctx.globalAlpha = ctx.globalAlpha / panelOpacity;
      ctx.globalCompositeOperation = "source-over";
      ctx.shadowColor = "rgba(0, 0, 0, 0)";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.setTransform(own[0], own[1], own[2], own[3], own[4], own[5]);
      if (!localPath(ctx, object)) {
        // "No closed path", not "no measurable box": a degenerate rectangle and
        // an open path both land here, and only the second has a box.
        report(
          `"${nameOf(object)}" has no closed path to clip, so its backdrop blur was skipped.`,
        );
        return;
      }
      ctx.clip();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      // One filter list, one pass: the blur diffuses and the saturation puts
      // back the colour the blur averaged away. A radius of zero gets no
      // filter at all — there is nothing to desaturate, and grading an
      // undiffused backdrop is a look, not a glass.
      ctx.filter =
        blurRadius > 0
          ? `blur(${blurRadius}px) saturate(${GLASS_SATURATION})`
          : "none";
      ctx.drawImage(
        scratch.element,
        region.left,
        region.top,
        region.width,
        region.height,
      );
      // **Texture, over the diffusion and under the panel's own fill.** The
      // clip is still the panel and the transform is still device space, so the
      // fill lands on the card and nowhere else.
      const grain = grainFill(ctx);
      if (grain !== undefined) {
        ctx.save();
        ctx.filter = "none";
        ctx.globalCompositeOperation = "overlay";
        ctx.globalAlpha *= GRAIN_ALPHA;
        // Anchored to the region's corner, not the viewport's, so panning the
        // camera moves the surface with the panel instead of swimming it.
        ctx.translate(region.left, region.top);
        ctx.fillStyle = grain;
        ctx.fillRect(0, 0, region.width, region.height);
        ctx.restore();
      }
    } finally {
      // Carries the transform, clip, filter and the state above back, even if
      // the clip or the draw threw.
      ctx.restore();
    }
  }

  /** Whether a backdrop painted for `before` still sits where `region` is. */
  function sameRegion(
    before: DeviceRect | undefined,
    region: DeviceRect,
  ): boolean {
    return (
      before !== undefined &&
      before.left === region.left &&
      before.top === region.top &&
      before.width === region.width &&
      before.height === region.height
    );
  }

  /**
   * The media **alone**, painted for `region` — or the last one that painted,
   * when the media has no frame to give. Undefined when neither exists.
   *
   * A video's `readyState` drops below `HAVE_CURRENT_DATA` at every loop wrap,
   * and `drawImage` refuses it there — that is the platform's own precondition,
   * so loosening the check is not open. Clearing the surface first would leave
   * the panel compositing over transparency, which is the one frame the reader
   * sees the raw video through, because the media is a DOM sibling *below* the
   * canvas. The window is 20-35 ms every ~3.6 s, so one surface and no history
   * is enough. The media fills its own layer box whatever its intrinsic size,
   * so painting over the last one cannot leave it showing through.
   */
  function backdropFor(
    panel: Panel,
    region: DeviceRect,
    media: BackdropMedia | undefined,
    plane: Matrix,
  ): HTMLCanvasElement | undefined {
    // No media at all is not the same as media with no frame: a backdrop kept
    // from a previous layer would be a picture of something no longer there.
    if (media === undefined) {
      panel.backdropRegion = undefined;
      return undefined;
    }
    const element = panel.backdrop ?? document.createElement("canvas");
    // Resizing clears the surface, which is the invalidation this wants.
    if (element.width !== region.width) element.width = region.width;
    if (element.height !== region.height) element.height = region.height;
    const context =
      panel.backdropContext ?? element.getContext("2d") ?? undefined;
    if (context === undefined) return undefined;
    panel.backdrop = element;
    panel.backdropContext = context;

    // A region that moved is the one case where the kept pixels sit at the
    // wrong offset, so it is the one case that has to start from nothing.
    const unmoved = sameRegion(panel.backdropRegion, region);
    if (!unmoved) context.clearRect(0, 0, region.width, region.height);

    const screenRect = media.screenRect;
    // A display-bounded layer fills the host box and does not turn with the
    // composition, while a theme-bounded one is the composition's own rect. The
    // uniform scale is the matrix's equal-area root, so it is the scale of a
    // turned plane as well as an upright one.
    const angle = screenRect === undefined ? (media.angle ?? 0) : 0;
    const retina = canvas.getRetinaScaling();
    const device =
      screenRect === undefined
        ? deviceRectOf(media.rect, plane, Math.hypot(plane[0], plane[1]))
        : screenDevice(screenRect, retina);
    // A round display clips its layer to the disc in the DOM
    // (`border-radius: 50%`), so the sampler clips the same box: outside it the
    // reader sees the plate's black, not the media's edge.
    const disc =
      screenRect?.radius === "circle"
        ? screenDevice(screenRect, retina)
        : undefined;
    let painted: boolean;
    if (angle === 0) {
      if (disc === undefined) {
        painted = media.paint(context, region, device);
      } else {
        context.save();
        clipDisc(context, disc, region);
        painted = media.paint(context, region, device);
        context.restore();
      }
    } else {
      // The media draws in its own upright frame; turning the scratch about the
      // rect's mapped centre puts it where the composition actually is. The
      // `save`/`restore` is what keeps the rotation off every later panel.
      const pivotX = device.left + device.width / 2 - region.left;
      const pivotY = device.top + device.height / 2 - region.top;
      context.save();
      context.translate(pivotX, pivotY);
      context.rotate((angle * Math.PI) / 180);
      context.translate(-pivotX, -pivotY);
      painted = media.paint(context, region, device);
      context.restore();
    }
    // **The plate is a different surface from the media** (0125). A media-less
    // theme, or a transparent frame, shows the host's background on a rect
    // display and the disc on a circle — both DOM boxes the composition turns
    // *inside*, never with. It goes under whatever the media painted, so a kept
    // frame is not overwritten, and it is never turned.
    const plate = media.plate;
    if (plate !== undefined) {
      context.save();
      context.globalCompositeOperation = "destination-over";
      plate.paint(context, region, screenDevice(plate.screenRect, retina));
      context.restore();
    }
    if (painted || plate !== undefined) {
      panel.backdropRegion = region;
      return element;
    }
    return unmoved ? element : undefined;
  }

  function surfaceFor(
    panel: Panel,
    region: DeviceRect,
  ):
    | { element: HTMLCanvasElement; context: CanvasRenderingContext2D }
    | undefined {
    // Published only once it is usable, so `liveSurfaces()` cannot over-report.
    const element = panel.surface ?? document.createElement("canvas");
    // Resizing clears the surface, so only do it when the region actually moved.
    if (element.width !== region.width) element.width = region.width;
    if (element.height !== region.height) element.height = region.height;
    const context = panel.context ?? element.getContext("2d") ?? undefined;
    if (context === undefined) return undefined;
    panel.surface = element;
    panel.context = context;
    context.clearRect(0, 0, region.width, region.height);
    return { element, context };
  }

  sync();

  return {
    sync,
    liveSurfaces: () => [...panels.values()].filter((p) => p.surface).length,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      releaseGrain();
      canvas.off("object:added", sync);
      canvas.off("object:removed", sync);
      for (const group of watched) {
        group.off("object:added", sync);
        group.off("object:removed", sync);
      }
      watched.clear();
      for (const object of [...panels.keys()]) detach(object);
      for (const ancestor of uncached) ancestor.objectCaching = true;
      uncached.clear();
    },
  };
}

/**
 * The object's own local units to the painted surface, including retina.
 *
 * The two compose in that order — `view · local`, not `local · view`. The
 * products are transposes of each other, and they agree only while the viewport
 * is an unscaled identity, which is what every earlier proof rendered at. Under
 * a 2x `contain` fit a panel's centre lands at (281, 281) and this derivation
 * put it at (140.5, 140.5), so the clip and the blurred backdrop were drawn
 * beside the panel instead of over it; on the player the band's step measured
 * 156 unsoftened against 3 once composed correctly. `planeMatrix` below is the
 * same composition one factor in, and is what `sampleRegion` already measured
 * with — the region and the panel it was copied for disagreed by exactly this.
 */
function deviceMatrix(object: FabricObject, canvas: StaticCanvas): Matrix {
  const local = object.calcTransformMatrix();
  const view = canvas.viewportTransform;
  const retina = canvas.getRetinaScaling();
  return [
    (local[0] * view[0] + local[1] * view[2]) * retina,
    (local[0] * view[1] + local[1] * view[3]) * retina,
    (local[2] * view[0] + local[3] * view[2]) * retina,
    (local[2] * view[1] + local[3] * view[3]) * retina,
    (local[4] * view[0] + local[5] * view[2] + view[4]) * retina,
    (local[4] * view[1] + local[5] * view[3] + view[5]) * retina,
  ];
}

/** The scene plane to the painted surface. Capture scales ride in here. */
function planeMatrix(canvas: StaticCanvas): Matrix {
  const view = canvas.viewportTransform;
  const retina = canvas.getRetinaScaling();
  return [
    view[0] * retina,
    view[1] * retina,
    view[2] * retina,
    view[3] * retina,
    view[4] * retina,
    view[5] * retina,
  ];
}

/** A box stated in host CSS pixels, in the surface's own pixels. Host pixels
 *  are what the DOM paints, so only the device ratio is missing. */
function screenDevice(rect: DeviceRect, retina: number): DeviceRect {
  return {
    left: rect.left * retina,
    top: rect.top * retina,
    width: rect.width * retina,
    height: rect.height * retina,
  };
}

/** Clips the region-sized surface to a disc stated in surface pixels. */
function clipDisc(
  ctx: CanvasRenderingContext2D,
  disc: DeviceRect,
  region: DeviceRect,
): void {
  ctx.beginPath();
  ctx.arc(
    disc.left + disc.width / 2 - region.left,
    disc.top + disc.height / 2 - region.top,
    Math.min(disc.width, disc.height) / 2,
    0,
    Math.PI * 2,
  );
  ctx.clip();
}

/**
 * A rect in artboard units as the surface's own pixels, **centred on its mapped
 * centre** and scaled by the plane's uniform scale. The centre is what survives
 * a turned plane: an axis-aligned box built from a mapped corner would be the
 * unrotated corner, which is not where the composition put it.
 */
function deviceRectOf(
  rect: ArtboardRect,
  plane: Matrix,
  scale: number,
): DeviceRect {
  const centreX = rect.left + rect.width / 2;
  const centreY = rect.top + rect.height / 2;
  const mappedX = plane[0] * centreX + plane[2] * centreY + plane[4];
  const mappedY = plane[1] * centreX + plane[3] * centreY + plane[5];
  return {
    left: mappedX - (rect.width * scale) / 2,
    top: mappedY - (rect.height * scale) / 2,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}

type Matrix = readonly [number, number, number, number, number, number];

/**
 * The panel's device-space box, padded by twice the blur so the blur has real
 * pixels at its own edges, clamped to the surface and refused when too large.
 * Returns undefined for a region too small to blur.
 */
function sampleRegion(
  object: FabricObject,
  plane: Matrix,
  blurRadius: number,
  target: { readonly width: number; readonly height: number },
): DeviceRect | undefined {
  // `getBoundingRect` memoises, and a moving panel would sample where it used to be.
  object.setCoords();
  const bounds = object.getBoundingRect();
  const corners: readonly (readonly [number, number])[] = [
    [bounds.left, bounds.top],
    [bounds.left + bounds.width, bounds.top],
    [bounds.left + bounds.width, bounds.top + bounds.height],
    [bounds.left, bounds.top + bounds.height],
  ];
  const pad = Math.ceil(blurRadius * 2) + 2;
  const xs = corners.map(([x, y]) => plane[0] * x + plane[2] * y + plane[4]);
  const ys = corners.map(([x, y]) => plane[1] * x + plane[3] * y + plane[5]);
  const left = Math.max(0, Math.floor(Math.min(...xs)) - pad);
  const top = Math.max(0, Math.floor(Math.min(...ys)) - pad);
  const right = Math.min(target.width, Math.ceil(Math.max(...xs)) + pad);
  const bottom = Math.min(target.height, Math.ceil(Math.max(...ys)) + pad);
  // Off-surface, degenerate and hairline panels all land here rather than
  // reaching the sampler with a negative or meaningless extent.
  if (right - left <= MIN_REGION_PX || bottom - top <= MIN_REGION_PX)
    return undefined;
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * The panel's own path in its own local units, origin at the centre, built
 * from the geometry its own paint uses — the clip and the fill have to be the
 * same shape, or the frosted surface reaches where the object is not.
 *
 * One branch per shape the product can prove is closed, and no fallback: the
 * frosted treatment needs a closed path to sample the backdrop through, so a
 * kind with no branch here is refused rather than clipped to a rectangle it
 * does not have. See `docs/decisions/0015-glass-clips-any-closed-path-not-only-rects.md`.
 */
function localPath(
  ctx: CanvasRenderingContext2D,
  object: FabricObject,
): boolean {
  // Before the `Circle` branch `Wedge` extends: that branch clips to the
  // **arc** between two angles, while a wedge paints the **sector** — the arc
  // plus the two radii. `sectorPath` is the shape's own path rather than a
  // second copy of it, so the clip and the fill cannot drift apart.
  if (object instanceof Wedge) {
    const r = positive(object, "radius");
    if (r === undefined) return false;
    sectorPath(
      ctx,
      r,
      number(object, "startAngle") ?? 0,
      number(object, "endAngle") ?? 360,
      object.counterClockwise,
    );
    return true;
  }
  // An arc is refused here rather than reaching the `Circle` arm by inheritance.
  // Clipping it to the arc would be a chord segment and clipping it to the
  // sector would be an interior it does not paint — either way the frost would
  // cover ground the shape does not, which is what this function refuses to do.
  // The treatment is already refused upstream by `supportsGlass`; saying so here
  // makes that a local fact instead of an accident of two other layers agreeing.
  if (object instanceof Arc) return false;
  if (object instanceof Circle) {
    // The authored sweep, not a whole turn: a half-disc's blur must not reach
    // the half it does not paint. Absent angles are Fabric's own 0/360.
    const r = positive(object, "radius");
    const start = number(object, "startAngle") ?? 0;
    const end = number(object, "endAngle") ?? 360;
    if (r === undefined) return false;
    ctx.beginPath();
    ctx.ellipse(
      0,
      0,
      r,
      r,
      0,
      radians(start),
      radians(end),
      object.counterClockwise,
    );
    return true;
  }
  if (object instanceof Ellipse) {
    const rx = positive(object, "rx");
    const ry = positive(object, "ry");
    if (rx === undefined || ry === undefined) return false;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    return true;
  }
  if (object instanceof Triangle) {
    const width = positive(object, "width");
    const height = positive(object, "height");
    if (width === undefined || height === undefined) return false;
    ctx.beginPath();
    ctx.moveTo(-width / 2, height / 2);
    ctx.lineTo(0, -height / 2);
    ctx.lineTo(width / 2, height / 2);
    ctx.closePath();
    return true;
  }
  if (object instanceof Polygon) {
    // A polygon's own corners about its own `pathOffset`, which is the frame
    // Fabric centres them in — the same translation its `_render` applies.
    const offset = object.pathOffset;
    const corners = object.points;
    // Fewer than three corners has no area, whatever `closePath` says.
    if (offset === undefined || corners.length < 3) return false;
    ctx.beginPath();
    for (const [index, point] of corners.entries()) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
      if (index === 0) ctx.moveTo(point.x - offset.x, point.y - offset.y);
      else ctx.lineTo(point.x - offset.x, point.y - offset.y);
    }
    ctx.closePath();
    return true;
  }
  if (!(object instanceof Rect)) return false;
  const width = positive(object, "width");
  const height = positive(object, "height");
  if (width === undefined || height === undefined) return false;
  const left = -width / 2;
  const top = -height / 2;
  const rx = radius(object, "rx", width);
  const ry = radius(object, "ry", height);
  if (rx === undefined || ry === undefined) return false;
  ctx.beginPath();
  if (rx === 0 || ry === 0) {
    ctx.rect(left, top, width, height);
    return true;
  }
  ctx.moveTo(left + rx, top);
  ctx.lineTo(left + width - rx, top);
  corner(ctx, left + width - rx, top + ry, rx, ry, -Math.PI / 2);
  ctx.lineTo(left + width, top + height - ry);
  corner(ctx, left + width - rx, top + height - ry, rx, ry, 0);
  ctx.lineTo(left + rx, top + height);
  corner(ctx, left + rx, top + height - ry, rx, ry, Math.PI / 2);
  ctx.lineTo(left, top + ry);
  corner(ctx, left + rx, top + ry, rx, ry, Math.PI);
  ctx.closePath();
  return true;
}

/** A quarter-ellipse corner, clockwise from the straight edge it follows. */
function corner(
  ctx: CanvasRenderingContext2D,
  centreX: number,
  centreY: number,
  rx: number,
  ry: number,
  from: number,
): void {
  ctx.ellipse(centreX, centreY, rx, ry, 0, from, from + Math.PI / 2, false);
}

function* walk(objects: readonly FabricObject[]): Generator<FabricObject> {
  for (const object of objects) {
    yield object;
    if (object instanceof Group) yield* walk(object.getObjects());
  }
}

/** A revived object carries the persisted id; a plan-built one need not. */
function nameOf(object: FabricObject): string {
  const id = object.get("id");
  return typeof id === "string" && id.length > 0 ? id : object.type;
}

/** Refuse a non-numeric or non-finite dimension rather than coercing it. */
function number(object: FabricObject, key: string): number | undefined {
  const value = (object as unknown as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * A dimension that encloses area. Zero and negative are refused rather than
 * clipped, because a path built from them is empty or wound inside out, and a
 * zero-radius circle is the degenerate case that would otherwise become a
 * hairline the author never drew.
 */
function positive(object: FabricObject, key: string): number | undefined {
  const value = number(object, key);
  return value !== undefined && value > 0 ? value : undefined;
}

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * The panel's own opacity, which the composite divides out of the context's
 * alpha. Zero is refused as well as non-numeric: Fabric's `isNotVisible()`
 * short-circuits an invisible object before `before:render` fires, so a zero
 * here is a hand-edited scene, and dividing by it would put an infinity into
 * the frame rather than the absence the author asked for.
 */
function ownOpacity(object: FabricObject): number | undefined {
  const value = number(object, "opacity");
  return value !== undefined && value > 0 ? value : undefined;
}

/**
 * A corner radius, clamped to half the side as Fabric clamps its own. Absent
 * means square; present-and-unusable is refused rather than read as square,
 * which would clip to a shape nobody authored.
 */
function radius(
  object: FabricObject,
  key: string,
  side: number,
): number | undefined {
  const value = (object as unknown as Record<string, unknown>)[key];
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return undefined;
  return Math.min(value, side / 2);
}

/** `ctx.filter` was reported absent by Safari; a no-op write means unusable. */
function probeFilter(ctx: CanvasRenderingContext2D): boolean {
  const before = ctx.filter;
  try {
    ctx.filter = "blur(1px)";
    const usable = ctx.filter === "blur(1px)";
    ctx.filter = before;
    return usable;
  } catch {
    return false;
  }
}

/**
 * The surface's grain, written straight into an `ImageData` buffer rather than
 * through the shape pipeline, and from a **fixed seed** so the same panel looks
 * the same in the editor, in the player and in a capture — and so the surface
 * does not crawl between frames, which is what an unseeded tile becomes.
 *
 * Mid-grey is the neutral value for the `overlay` blend this is composited
 * with, so the tile spans the full range around it and the panel neither lifts
 * nor darkens on average.
 */
function grainTile(): HTMLCanvasElement | undefined {
  const tile = document.createElement("canvas");
  tile.width = GRAIN_TILE_PX;
  tile.height = GRAIN_TILE_PX;
  const context = tile.getContext("2d");
  if (context === null) return undefined;
  const image = context.createImageData(GRAIN_TILE_PX, GRAIN_TILE_PX);
  const data = image.data;
  let seed = 0x9e3779b9;
  for (let index = 0; index < data.length; index += 4) {
    // xorshift32: a whole generator, so the tile cannot depend on a host.
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const shade = (seed >>> 24) & 0xff;
    data[index] = shade;
    data[index + 1] = shade;
    data[index + 2] = shade;
    data[index + 3] = 0xff;
  }
  context.putImageData(image, 0, 0);
  return tile;
}
