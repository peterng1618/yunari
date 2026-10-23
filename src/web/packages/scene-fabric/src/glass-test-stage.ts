// @vitest-environment jsdom

/**
 * The shared glass test stage.
 *
 * Its own file because both the composition suite and the lifecycle suite need
 * it, and duplicating it would put each of them over the size the project
 * treats as a stop. It is a test fixture, not a module: nothing outside
 * `*.dom.test.ts` imports it.
 */

import { Group, Point, Rect, StaticCanvas } from "fabric/es";
import { afterEach } from "vitest";
import {
  type ArtboardRect,
  type BackdropMedia,
  createGlass,
  type DeviceRect,
  type GlassHandle,
} from "./glass.js";

/**
 * What these tests can and cannot prove.
 *
 * `node-canvas` accepts `ctx.filter` and silently ignores it, so no test here
 * can show that a blur happened. They pin the composition around it — what is
 * sampled, what is excluded, what is clipped, what the radius converts to —
 * and the real blurred pixels are proved in the browser.
 *
 * The alpha Fabric has set **is** observable here, and a real `Group` is the
 * way to observe it. What is easy to get wrong is reading it from a *cached*
 * panel: Fabric renders a cached object into its own cache, whose context
 * carries no ancestor alpha, so the reading is 1 whatever the group's opacity
 * is. The glass handle switches that caching off, which is what makes the
 * grouped cases measurable — an earlier note here claimed the context itself
 * was unreachable, which was wrong.
 */

export interface Draw {
  readonly alpha: number;
  readonly filter: string;
  readonly args: readonly number[];
}

export interface Stage {
  readonly canvas: StaticCanvas;
  readonly draws: Draw[];
  readonly errors: string[];
  readonly glass: GlassHandle;
  regions: DeviceRect[];
  paints: PaintCall[];
  /** The transform in force at each `ctx.clip()`, flattened as
   *  `a, b, c, d, e, f`. This is where a panel's own box is mapped onto the
   *  surface, and `node-canvas` honours it exactly as a browser does — so a
   *  mis-composed panel transform is observable here even though the blur it
   *  carries is not. */
  clips: number[];
  /** Writes to `ctx.filter` of the probe's own value, which is how many times
   *  the capability was actually asked. */
  filterProbes: number;
  /** Makes the next glass composite throw, as a tainting draw would. */
  failNextComposite: boolean;
  pixel(x: number, y: number): readonly [number, number, number, number];
  destroy(): void;
}

const stages: Stage[] = [];

/** Vertical bars every `step` px, so a column identifies what is behind it. */
export function bars(
  width: number,
  height: number,
  step: number,
  on: string,
  off: string,
): Rect[] {
  const result: Rect[] = [];
  for (let x = 0; x < width; x += step)
    for (const [index, y] of [0, height / 2].entries())
      result.push(
        new Rect({
          left: x,
          top: y,
          width: step,
          height: height / 2,
          originX: "left",
          originY: "top",
          fill: (x / step) % 2 === index % 2 ? on : off,
          selectable: false,
          evented: false,
        }),
      );
  return result;
}

/** Records the rect the sampler hands the media, so a test can assert where
 *  the media was told to sit rather than only what it drew. */
export interface PaintCall {
  readonly region: DeviceRect;
  readonly device: DeviceRect;
}

export function stage(options: {
  readonly size?: number;
  readonly texture?: boolean;
  readonly artboard?: { readonly width: number; readonly height: number };
  /** The rect the media layer covers, in artboard units, when it is not the
   *  artboard itself — a `bounds: "display"` layer is larger than the board and
   *  starts outside it, which is the only way the rect's own left/top are
   *  non-zero. */
  readonly backdropRect?: ArtboardRect;
  /** The media, as the glass sees it. A case that walks the whole wire hands in
   *  a real handle's own `backdrop()`, rect and all; a case about the panel
   *  rather than the media gives only a paint, and the stage synthesises the
   *  rect from `backdropRect`/`artboard`. */
  readonly backdrop?: () =>
    | { readonly rect?: ArtboardRect; readonly paint: BackdropMedia["paint"] }
    | undefined;
}): Stage {
  const size = options.size ?? 200;
  const canvas = new StaticCanvas(undefined, { width: size, height: size });
  const context = canvas.getContext() as CanvasRenderingContext2D;
  const draws: Draw[] = [];
  const clips: number[] = [];
  // `node-canvas` has no `ctx.filter` at all: it is an ordinary data property
  // that starts undefined and echoes whatever is written. The seam reproduces
  // that exactly, and counts the probe by the one value no panel ever asks for.
  let filterProbes = 0;
  let filterValue: unknown = context.filter;
  const originalFilter = Object.getOwnPropertyDescriptor(context, "filter");
  Object.defineProperty(context, "filter", {
    configurable: true,
    get: () => filterValue,
    set: (value: string) => {
      if (value === "blur(1px)") filterProbes += 1;
      filterValue = value;
    },
  });
  const original = context.drawImage.bind(context);
  (context as unknown as { drawImage: typeof original }).drawImage = ((
    ...args: unknown[]
  ) => {
    // Only the five-argument form is the glass composite; Fabric blits every
    // cached object with the two-argument one, and counting those would make
    // the object count look like a panel count.
    if (args.length === 5 && value.failNextComposite) {
      value.failNextComposite = false;
      throw new Error("SecurityError: tainted canvases may not be exported");
    }
    if (args.length === 5)
      draws.push({
        alpha: context.globalAlpha,
        filter: context.filter,
        args: args.slice(1).map((value) => Number(value)),
      });
    return (original as (...a: unknown[]) => unknown)(...args);
  }) as typeof original;
  // The composite clips under the panel's own matrix, so recording the
  // transform at each clip records where the panel decided it is.
  const originalClip = context.clip.bind(context);
  (context as unknown as { clip: typeof originalClip }).clip = ((
    ...args: unknown[]
  ) => {
    const transform = context.getTransform();
    clips.push(
      transform.a,
      transform.b,
      transform.c,
      transform.d,
      transform.e,
      transform.f,
    );
    return (originalClip as (...a: unknown[]) => unknown)(...args);
  }) as typeof originalClip;

  if (options.texture !== false)
    for (const object of bars(size, size, 8, "#ffffff", "#000000"))
      canvas.add(object);

  const errors: string[] = [];
  const regions: Stage["regions"] = [];
  const paints: PaintCall[] = [];
  let destroyed = false;
  const glass = createGlass({
    canvas,
    // Omitted entirely unless asked for, so the "no media" cases really have none.
    ...(options.backdrop === undefined &&
    options.artboard === undefined &&
    options.backdropRect === undefined
      ? {}
      : {
          backdrop: (): BackdropMedia => {
            const stub = options.backdrop?.();
            const artboard = options.artboard ?? { width: size, height: size };
            return {
              rect: stub?.rect ??
                options.backdropRect ?? { left: 0, top: 0, ...artboard },
              paint: (ctx, region, device) => {
                regions.push({ ...region });
                paints.push({ region: { ...region }, device: { ...device } });
                return stub?.paint(ctx, region, device) ?? true;
              },
            };
          },
        }),
    onGlassError: (message) => errors.push(message),
  });

  const value: Stage = {
    canvas,
    draws,
    errors,
    glass,
    regions,
    paints,
    clips,
    get filterProbes() {
      return filterProbes;
    },
    failNextComposite: false,
    pixel(x, y) {
      const d = context.getImageData(x, y, 1, 1).data;
      return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, d[3] ?? 0];
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      glass.dispose();
      void canvas.destroy();
      if (originalFilter === undefined)
        delete (context as unknown as Record<string, unknown>)["filter"];
      else Object.defineProperty(context, "filter", originalFilter);
    },
  };
  stages.push(value);
  return value;
}

afterEach(() => {
  for (const value of stages.splice(0)) value.destroy();
});

/** Spans (left, top) to (left + width, top + height); Fabric's own default
 * origin is centre, which would silently move every probe in these tests. */
export function panel(overrides: Record<string, unknown> = {}): Rect {
  return new Rect({
    left: 80,
    top: 80,
    width: 40,
    height: 40,
    originX: "left",
    originY: "top",
    rx: 0,
    ry: 0,
    fill: "rgba(255, 255, 255, 0.5)",
    yunariGlass: { blurRadius: 24 },
    ...overrides,
  });
}

export { Group, Point, Rect, StaticCanvas };
