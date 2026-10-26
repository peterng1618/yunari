// @vitest-environment jsdom

import type {
  Background,
  DisplayPresentation,
  ScenePlan,
} from "@yunari/renderer-core";
import { viewportToDocument } from "@yunari/renderer-core";
import { Group, Rect } from "fabric/es";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FabricSceneHandle, mountFabricScene } from "./scene.js";

/** jsdom has no video frame callbacks, and the cases below patch them on the
 *  prototype. Restored after every case, so one case's patch is never the next
 *  case's starting state. */
const videoPrototype = HTMLVideoElement.prototype as unknown as Record<
  string,
  unknown
>;
const originalFrameCallbacks: Readonly<Record<string, unknown>> = {
  requestVideoFrameCallback: videoPrototype["requestVideoFrameCallback"],
  cancelVideoFrameCallback: videoPrototype["cancelVideoFrameCallback"],
};

afterEach(() => {
  for (const [name, original] of Object.entries(originalFrameCallbacks)) {
    if (original === undefined) delete videoPrototype[name];
    else videoPrototype[name] = original;
  }
});

function plan(artboard: Partial<ScenePlan["artboard"]> = {}): ScenePlan {
  return {
    artboard: {
      width: 400,
      height: 300,
      contentFit: "contain",
      background: "#000",
      ...artboard,
    },
    nodes: [],
    issues: [],
  };
}

function host(): HTMLElement {
  const element = document.createElement("div");
  Object.defineProperty(element, "clientWidth", {
    configurable: true,
    value: 400,
  });
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: 300,
  });
  document.body.append(element);
  return element;
}

/** The host's measurable size, which is all `resize()` reads to decide whether
 *  it has anything to do. */
function resizeHost(element: HTMLElement, width: number, height: number): void {
  Object.defineProperty(element, "clientWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: height,
  });
}

/** A background bag naming one media, which is all the scene reads of it. */
function backgroundWith(assetId: string): Background {
  return { media: { assetId, bounds: "theme" } };
}

describe("mountFabricScene's background", () => {
  it("swaps background media without remounting scene", () => {
    const element = host();
    const scene = mountFabricScene({
      host: element,
      plan: plan(),
      artboard: { width: 400, height: 300 },
      background: backgroundWith("a"),
      assets: [
        { id: "a", kind: "image", path: "assets/a.png" },
        { id: "b", kind: "image", path: "assets/b.png" },
      ],
      resolveAsset: (assetId) => ({ url: `blob:${assetId}` }),
    });

    // The background is its own state, so a media change arrives through its
    // own entry and not through the artboard.
    scene.updateBackground(backgroundWith("b"));

    const media = element.querySelector<HTMLImageElement>(
      "[data-yunari-background-media] img",
    );
    expect(media?.src).toBe("blob:b");
    scene.dispose();
    element.remove();
  });

  it("re-fits the media layer when the artboard's own size changes", () => {
    // The host is 400x300, so the 400x300 board mounts at 1:1 and the 200x300
    // one that follows fits at 1:1 too, centred — the layer's box halves.
    // `setArtboardSize` re-places against the bounds the last `fit()` set, so
    // without a re-fit the layer keeps the old box and `bounds: "theme"` means
    // the box the board no longer has.
    const element = host();
    const scene = mountFabricScene({
      host: element,
      plan: plan(),
      artboard: { width: 400, height: 300 },
      background: backgroundWith("b"),
      assets: [{ id: "b", kind: "image", path: "assets/b.png" }],
      resolveAsset: (assetId) => ({ url: `blob:${assetId}` }),
    });
    const layer = element.querySelector<HTMLElement>(
      "[data-yunari-background-media]",
    );

    scene.updateArtboard({ width: 200, height: 300 });

    expect([
      layer?.style.left,
      layer?.style.top,
      layer?.style.width,
      layer?.style.height,
    ]).toEqual(["100px", "0px", "200px", "300px"]);

    scene.dispose();
    element.remove();
  });

  it("is inert when scene mounted without asset resolver", () => {
    const element = host();
    const scene = mountFabricScene({ host: element, plan: plan() });

    expect(() => {
      scene.updateArtboard({ width: 400, height: 300 });
      scene.updateBackground(backgroundWith("b"));
    }).not.toThrow();
    expect(element.querySelector("[data-yunari-background-media]")).toBeNull();

    scene.dispose();
    element.remove();
  });
});

describe("mountFabricScene's artboard paint", () => {
  it("paints the host from the artboard's one background", () => {
    const element = host();
    const scene = mountFabricScene({
      host: element,
      plan: plan({ background: "#101216" }),
    });

    // The board's own fill and the letterbox behind it are one paint. The host
    // is the letterbox, so it must carry the artboard's `background` — there is
    // no second colour to fall back to.
    expect(element.style.background).toBe("rgb(16, 18, 22)");

    scene.dispose();
    element.remove();
  });

  it("leaves the board's paint to the host, with or without media", () => {
    // 0080. The host is behind the media layer, so its paint is the board's fill
    // and the letterbox the reader sees around a `"theme"`-fitted layer; the
    // canvas is *above* the media, so the same paint on it hides the media
    // completely. Both arms are asserted because the rule is the same in both:
    // a fill reappearing here is that defect returning in silence. What a glass
    // panel samples instead is the backdrop, which composes this paint under the
    // media — `artboard-backdrop.dom.test.ts` is where that is proved.
    const plainHost = host();
    const plain = mountFabricScene({
      host: plainHost,
      plan: plan({ background: "#101216" }),
    });
    expect(plain.canvas.backgroundColor, "the canvas never paints it").toBe("");
    expect(
      plainHost.style.background,
      "the host is the board's fill and its letterbox",
    ).toBe("rgb(16, 18, 22)");
    plain.dispose();
    plainHost.remove();

    const mediaHost = host();
    const withMedia = mountFabricScene({
      host: mediaHost,
      plan: plan({ background: "#101216" }),
      artboard: { width: 400, height: 300 },
      background: backgroundWith("loop"),
      assets: [{ id: "loop", kind: "video", path: "assets/loop.webm" }],
      resolveAsset: () => ({ url: "blob:loop" }),
    });
    expect(
      withMedia.canvas.backgroundColor,
      "and not over the media either",
    ).toBe("");
    expect(
      mediaHost.style.background,
      "while the host still carries the colour",
    ).toBe("rgb(16, 18, 22)");
    withMedia.dispose();
    mediaHost.remove();
  });
});

describe("mountFabricScene's display presentation", () => {
  /** The scene as its host mounted it: the handle is the record, and `host` is
   *  where the disc and the canvas live. */
  function mountPresented(
    presentation?: DisplayPresentation,
    artboard: Partial<ScenePlan["artboard"]> = {},
  ) {
    const element = host();
    const scene = mountFabricScene({
      host: element,
      plan: plan(artboard),
      ...(presentation === undefined ? {} : { presentation }),
    });
    return { element, scene };
  }

  /** A scene whose media fills the display box rather than the board. */
  function mountDisplayMedia(presentation: DisplayPresentation) {
    const element = host();
    const scene = mountFabricScene({
      host: element,
      plan: plan(),
      artboard: { width: 400, height: 300 },
      background: { media: { assetId: "hero", bounds: "display" } },
      assets: [{ id: "hero", kind: "image", path: "assets/hero.png" }],
      resolveAsset: () => ({ url: "blob:hero" }),
      presentation,
    });
    return { element, scene };
  }

  it("applies a 90 degree rect presentation to the canvas", () => {
    const { element, scene } = mountPresented({
      shape: "rect",
      rotation: 90,
    });
    const vpt = scene.canvas.viewportTransform;
    expect(vpt[0]).toBeCloseTo(0, 9);
    expect(vpt[3]).toBeCloseTo(0, 9);
    expect(Math.abs(vpt[1])).toBeCloseTo(Math.abs(vpt[2]), 9);

    scene.dispose();
    element.remove();
  });

  it("clips a circle presentation to the disc", () => {
    // A paint that is not black, so the host assertion cannot pass on the
    // default: outside the disc the reader sees black, inside it the theme.
    const { element, scene } = mountPresented(
      { shape: "circle" },
      { background: "#101216" },
    );
    expect(element.style.background).toBe("rgb(0, 0, 0)");
    expect(scene.artboard.style.clipPath).toContain("circle(");
    const disc = element.querySelector<HTMLElement>(
      "[data-yunari-display-disc]",
    );
    expect(disc).not.toBeNull();
    // The 400x300 host: the disc is the shorter axis, centred.
    expect([
      disc?.style.left,
      disc?.style.top,
      disc?.style.width,
      disc?.style.height,
    ]).toEqual(["50px", "0px", "300px", "300px"]);
    expect(disc?.style.borderRadius).toBe("50%");
    expect(disc?.style.background, "the disc carries the theme").toBe(
      "rgb(16, 18, 22)",
    );

    scene.dispose();
    element.remove();
  });

  it("fills the disc with a display-bounded layer and restores the host", () => {
    const { element, scene } = mountDisplayMedia({ shape: "circle" });
    const layer = element.querySelector<HTMLElement>(
      "[data-yunari-background-media]",
    );
    const bounds = () => [
      layer?.style.left,
      layer?.style.top,
      layer?.style.width,
      layer?.style.height,
    ];
    // The media box is the disc box, not the artboard's.
    expect(bounds()).toEqual(["50px", "0px", "300px", "300px"]);
    expect(layer?.style.borderRadius).toBe("50%");

    scene.updatePresentation({ shape: "rect" });
    expect(scene.artboard.style.clipPath).toBe("");
    expect(
      element.querySelector<HTMLElement>("[data-yunari-display-disc]")?.style
        .display,
      "the disc leaves the composition",
    ).toBe("none");
    expect(bounds(), "and the display box is the host again").toEqual([
      "0px",
      "0px",
      "400px",
      "300px",
    ]);
    expect(layer?.style.borderRadius).toBe("");

    scene.dispose();
    element.remove();
  });

  it("moves the presentation in place", () => {
    const { element, scene } = mountPresented();
    scene.updatePresentation({ shape: "circle", rotation: 45 });
    expect(scene.transform().rotation).toBe(45);
    expect(element.querySelector("[data-yunari-display-disc]")).not.toBeNull();

    scene.dispose();
    element.remove();
  });

  it("stays upright and rectangular with no presentation", () => {
    // The record's absence is today's behaviour exactly: no disc, no clip, and
    // the transform reports the angle a reader assumes.
    const { element, scene } = mountPresented();
    expect(scene.transform().rotation).toBe(0);
    expect(scene.artboard.style.clipPath).toBe("");
    expect(element.querySelector("[data-yunari-display-disc]")).toBeNull();

    scene.dispose();
    element.remove();
  });

  it("keeps the previous presentation when an angle is refused", () => {
    const { element, scene } = mountPresented(undefined, {
      background: "#101216",
    });
    expect(() =>
      scene.updatePresentation({ shape: "rect", rotation: 45 }),
    ).toThrow(RangeError);
    expect(scene.transform().rotation).toBe(0);
    expect(element.style.background, "the paint is not repainted").toBe(
      "rgb(16, 18, 22)",
    );
    expect(element.querySelector("[data-yunari-display-disc]")).toBeNull();

    // A refused fit must not record the host size as fitted, or the next resize
    // early-returns on a size that was never fitted.
    const setDimensions = vi.spyOn(scene.canvas, "setDimensions");
    resizeHost(element, 800, 600);
    expect(() =>
      scene.updatePresentation({ shape: "rect", rotation: 45 }),
    ).toThrow(RangeError);
    scene.resize();
    expect(
      setDimensions,
      "the refused fit left no fitted size behind",
    ).toHaveBeenCalledTimes(1);

    // And a valid presentation still lands afterwards.
    scene.updatePresentation({ shape: "circle" });
    expect(element.querySelector("[data-yunari-display-disc]")).not.toBeNull();

    scene.dispose();
    element.remove();
  });

  it("samples a rotated scene's host paint under a panel, not a turned copy", () => {
    // The canvas is transparent behind a media-less theme, so a panel's
    // backdrop is the host's own background. A panel is placed over the host
    // point (100, 240) — the left half, below the centre — where the host
    // gradient is red. A sampler that turns the board's paint with the
    // composition reads the gradient's right half (blue) there.
    const element = host();
    const scene = mountFabricScene({
      host: element,
      plan: plan({
        background: {
          kind: "gradient",
          angle: 0,
          stops: [
            { offset: 0, color: "#ff0000" },
            { offset: 0.5, color: "#ff0000" },
            { offset: 0.5, color: "#0000ff" },
            { offset: 1, color: "#0000ff" },
          ],
        },
      }),
      presentation: { shape: "rect", rotation: 90 },
    });
    const at = viewportToDocument(scene.transform(), { x: 100, y: 240 });
    scene.canvas.add(
      new Rect({
        left: at.x - 20,
        top: at.y - 20,
        width: 40,
        height: 40,
        originX: "left",
        originY: "top",
        fill: "transparent",
        yunariGlass: { blurRadius: 0 },
      }),
    );
    scene.canvas.renderAll();

    const pixel = scene.canvas.getContext().getImageData(100, 240, 1, 1).data;
    expect(pixel[0], "the host's left half is red").toBeGreaterThan(200);
    expect(pixel[2]).toBeLessThan(60);

    scene.dispose();
    element.remove();
  });
});

describe("mountFabricScene's resize", () => {
  it("re-fits only when the host's pixel size changes", () => {
    // A `ResizeObserver` fires for layout changes that leave the pixel size
    // alone — a transform, a scrollbar, a sibling moving — and re-fitting the
    // artboard for those is a canvas resize and a full repaint for nothing.
    const element = host();
    const scene = mountFabricScene({
      host: element,
      plan: plan(),
      artboard: { width: 400, height: 300 },
    });
    const setDimensions = vi.spyOn(scene.canvas, "setDimensions");
    const render = vi.spyOn(scene.canvas, "requestRenderAll");

    scene.resize();
    scene.resize();

    expect(
      setDimensions,
      "an unchanged host size resizes nothing",
    ).not.toHaveBeenCalled();
    expect(render, "and asks for no repaint").not.toHaveBeenCalled();

    resizeHost(element, 800, 600);
    scene.resize();

    expect(setDimensions, "a changed size fits once").toHaveBeenCalledTimes(1);
    // Not pinned to one: Fabric's dimension setter and the adapter's render
    // scale each request a render of their own, so the fit is one setter call
    // and at least one repaint.
    expect(render, "and repaints").toHaveBeenCalled();

    // The same CSS size on a monitor with another pixel ratio is a different
    // backing store, so it is a fit: the ratio is part of what was recorded.
    const ratioDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "devicePixelRatio",
    );
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: (window.devicePixelRatio ?? 1) * 2,
    });
    try {
      scene.resize();
      expect(
        setDimensions,
        "a changed pixel ratio at the same size fits again",
      ).toHaveBeenCalledTimes(2);
    } finally {
      // The original is jsdom's accessor; restoring the value as a data
      // property would leave the file with a different `window`.
      if (ratioDescriptor === undefined) {
        delete (window as { devicePixelRatio?: number }).devicePixelRatio;
      } else {
        Object.defineProperty(window, "devicePixelRatio", ratioDescriptor);
      }
    }

    scene.dispose();
    element.remove();
  });
});

describe("mountFabricScene's video repaint", () => {
  /** A video background, with or without a glass panel over it.
   *
   *  `requestVideoFrameCallback` is the platform call `background-media.ts`
   *  makes, so the callbacks collected here are the frames the scene is
   *  following. jsdom has no such method, so it is patched on the prototype for
   *  the duration of the case. */
  function mountVideo(options: { readonly glass: boolean }): {
    readonly scene: FabricSceneHandle;
    readonly frames: readonly (() => void)[];
    readonly panel: Rect | undefined;
  } {
    const element = host();
    const frames: (() => void)[] = [];
    const proto = HTMLVideoElement.prototype as unknown as {
      requestVideoFrameCallback: (cb: () => void) => number;
      cancelVideoFrameCallback: (handle: number) => void;
    };
    proto.requestVideoFrameCallback = (cb) => {
      frames.push(cb);
      return frames.length;
    };
    proto.cancelVideoFrameCallback = () => undefined;

    const scene = mountFabricScene({
      host: element,
      plan: plan(),
      artboard: { width: 400, height: 300 },
      background: backgroundWith("loop"),
      assets: [{ id: "loop", kind: "video", path: "assets/loop.webm" }],
      resolveAsset: () => ({ url: "blob:loop" }),
    });

    let panel: Rect | undefined;
    if (options.glass) {
      panel = new Rect({
        left: 40,
        top: 40,
        width: 60,
        height: 40,
        originX: "left",
        originY: "top",
        fill: "rgba(255, 255, 255, 0.2)",
        yunariGlass: { blurRadius: 8 },
      });
      scene.canvas.add(panel);
      // The panel's scratch surface is allocated during a render, which is why
      // the gate cannot be a decision taken at mount.
      scene.canvas.renderAll();
    }

    return { scene, frames, panel };
  }

  /** The repaints one decoded frame asks for. A frame callback re-arms itself,
   *  so the snapshot is taken before any of them runs. */
  function repaintsOnFrame(
    scene: FabricSceneHandle,
    frames: readonly (() => void)[],
  ): number {
    let repaints = 0;
    const original = scene.canvas.requestRenderAll.bind(scene.canvas);
    scene.canvas.requestRenderAll = (): void => {
      repaints += 1;
      original();
    };
    try {
      for (const frame of [...frames]) frame();
    } finally {
      scene.canvas.requestRenderAll = original;
    }
    return repaints;
  }

  it("schedules no video frame callbacks when nothing samples the backdrop", () => {
    // Following the video costs a callback per decoded frame even when nothing
    // reads it, and a hidden or unread backdrop is the case this gate exists
    // for. The mount's render is the first opportunity to know the count, so
    // the layer starts armed and the sync stops it.
    const { scene, frames } = mountVideo({ glass: false });

    expect(
      frames,
      "nothing samples the backdrop, so no frame is followed",
    ).toHaveLength(0);

    scene.dispose();
  });

  it("follows frames while a glass panel samples the backdrop", () => {
    // A frozen frame behind a blur is the bug the loop exists to prevent, so
    // the gate is exactly "is anything reading the backdrop".
    const { scene, frames } = mountVideo({ glass: true });

    expect(frames, "the panel is sampling a moving backdrop").toHaveLength(1);
    expect(
      repaintsOnFrame(scene, frames),
      "a followed frame repaints the panel",
    ).toBe(1);

    scene.dispose();
  });

  it("stops re-arming when the last glass surface goes away", () => {
    const { scene, frames, panel } = mountVideo({ glass: true });
    expect(frames, "the panel's frames are followed").toHaveLength(1);

    scene.canvas.remove(panel!);
    scene.canvas.renderAll();
    const before = frames.length;
    // A callback already in flight when the panel left must not re-arm the
    // chain: that is the leak a queued callback becomes once nothing reads it.
    for (const frame of [...frames]) frame();
    expect(frames.length, "no callback was re-armed at zero surfaces").toBe(
      before,
    );

    // And a panel that comes back is what arms it again.
    scene.canvas.add(panel!);
    scene.canvas.renderAll();
    expect(frames.length, "the returned surface re-arms the chain").toBe(
      before + 1,
    );

    scene.dispose();
  });
});

describe("mountFabricScene disposal", () => {
  it("releases the media layer, its frame callback and the host contents", () => {
    // The player's `pagehide` is the only teardown this mount has, and it
    // reaches the scene only through `dispose()`. What survives it is not
    // visible on screen - a background that keeps decoding, a video frame
    // callback still asking for repaints, a canvas still holding a scene.
    const element = host();
    const scheduled: (() => void)[] = [];
    const proto = HTMLVideoElement.prototype as unknown as {
      requestVideoFrameCallback: (cb: () => void) => number;
      cancelVideoFrameCallback: (handle: number) => void;
    };
    const had = "requestVideoFrameCallback" in proto;
    proto.requestVideoFrameCallback = (cb) => {
      scheduled.push(cb);
      return scheduled.length;
    };
    const cancelled: number[] = [];
    proto.cancelVideoFrameCallback = (handle) => cancelled.push(handle);

    try {
      const scene = mountFabricScene({
        host: element,
        plan: plan(),
        artboard: { width: 400, height: 300 },
        background: backgroundWith("loop"),
        assets: [{ id: "loop", kind: "video", path: "assets/loop.webm" }],
        resolveAsset: () => ({ url: "blob:loop" }),
      });
      // A panel is what makes the video worth following now, and this case is
      // about what teardown releases, so it needs a live callback to cancel.
      scene.canvas.add(
        new Rect({
          left: 40,
          top: 40,
          width: 60,
          height: 40,
          originX: "left",
          originY: "top",
          fill: "rgba(255, 255, 255, 0.2)",
          yunariGlass: { blurRadius: 8 },
        }),
      );
      scene.canvas.renderAll();
      scene.updateArtboard({ width: 400, height: 300 });

      expect(
        element.querySelector("[data-yunari-background-media] video"),
        "the media layer is mounted",
      ).not.toBeNull();
      expect(scheduled, "the video is being followed").toHaveLength(1);

      scene.dispose();

      expect(
        element.querySelector("[data-yunari-background-media]"),
        "the media layer is gone",
      ).toBeNull();
      expect(element.textContent, "the host is empty").toBe("");
      expect(cancelled, "the frame callback was cancelled").toHaveLength(1);
      // A frame callback already queued when teardown happened must not reach
      // the host afterwards. Counting *repaints*, not a snapshot against itself:
      // `onFrame` is the scene's `requestRenderAll`, so this is what a leaked
      // callback would drive.
      const canvas = scene.canvas;
      let repaints = 0;
      const originalRequest = canvas.requestRenderAll.bind(canvas);
      canvas.requestRenderAll = (): void => {
        repaints += 1;
        originalRequest();
      };
      scheduled.forEach((cb) => cb());
      canvas.requestRenderAll = originalRequest;
      expect(
        repaints,
        "a queued frame after teardown asks for no repaint",
      ).toBe(0);
      element.remove();
    } finally {
      if (!had) {
        delete (proto as Record<string, unknown>)["requestVideoFrameCallback"];
        delete (proto as Record<string, unknown>)["cancelVideoFrameCallback"];
      }
    }
  });

  it("repaints once for a live decode when a panel samples the layer", () => {
    // **The panel is what makes the decode a repaint at all.** A still image
    // announces its decode for the same reason a video announces a frame —
    // something has to sample the layer once the bytes are there — so with
    // nothing sampling it the notification is not a repaint, and this case
    // would be counting the gate instead of the decode.
    //
    // **What the listener does after teardown is not observable from here**, and
    // the assertion that claimed to watch it could not fail: the gate is
    // downstream of the listener, so a leaked `load` handler would still call
    // `onFrame` and the repaint count would still not move. That half is counted
    // where the listener's owner lives, in `background-media.dom.test.ts`'s
    // "stops asking for a repaint once the media is torn down", which counts
    // `onFrame` invocations rather than repaints.
    const element = host();
    const scene = mountFabricScene({
      host: element,
      plan: plan(),
      artboard: { width: 400, height: 300 },
      background: backgroundWith("hero"),
      assets: [{ id: "hero", kind: "image", path: "assets/hero.png" }],
      resolveAsset: () => ({ url: "blob:hero" }),
    });
    scene.canvas.add(
      new Rect({
        left: 40,
        top: 40,
        width: 60,
        height: 40,
        originX: "left",
        originY: "top",
        fill: "rgba(255, 255, 255, 0.2)",
        yunariGlass: { blurRadius: 8 },
      }),
    );
    scene.canvas.renderAll();
    const image = element.querySelector<HTMLImageElement>(
      "[data-yunari-background-media] img",
    );
    expect(image, "the media layer is mounted").not.toBeNull();
    let repaints = 0;
    const original = scene.canvas.requestRenderAll.bind(scene.canvas);
    scene.canvas.requestRenderAll = (): void => {
      repaints += 1;
      original();
    };

    image?.dispatchEvent(new Event("load"));
    expect(repaints, "a live decode asks for a repaint").toBe(1);

    scene.dispose();
    element.remove();
  });

  it("releases everything over repeated full mount/render/dispose cycles", () => {
    // Task 1 measured a 56-surface leak over ten mount/unmount cycles, and it
    // was the *scene* that leaked, not just the glass handle - so this cycles
    // the whole mount rather than the handle alone.
    const created: HTMLCanvasElement[] = [];
    const original = document.createElement.bind(document);
    (document as unknown as { createElement: typeof original }).createElement =
      ((name: string, options?: ElementCreationOptions) => {
        const made = original(name, options);
        if (name === "canvas") created.push(made as HTMLCanvasElement);
        return made;
      }) as typeof original;

    const perCycle: number[] = [];
    const stillHolding: number[] = [];
    try {
      for (let cycle = 0; cycle < 10; cycle += 1) {
        const element = host();
        const scene = mountFabricScene({
          host: element,
          plan: plan(),
          artboard: { width: 400, height: 300 },
          background: backgroundWith("hero"),
          assets: [{ id: "hero", kind: "image", path: "assets/hero.png" }],
          resolveAsset: () => ({ url: "blob:hero" }),
        });
        scene.updateArtboard({ width: 400, height: 300 });
        const before = created.length;
        scene.canvas.add(
          new Rect({
            left: 40,
            top: 40,
            width: 60,
            height: 40,
            originX: "left",
            originY: "top",
            fill: "rgba(255, 255, 255, 0.2)",
            yunariGlass: { blurRadius: 8 },
          }),
        );
        scene.canvas.renderAll();
        scene.dispose();
        // Everything this cycle allocated after the baseline, and any of it
        // still holding a backing store.
        // The glass scratch is the one that is *reused* between frames, so it
        // is the one whose size changes when a second frame is drawn. Fabric
        // allocates canvases of its own during a render and `destroy()` does
        // not zero those, so they cannot be the subject of this claim.
        const sized = created
          .slice(before)
          .map((made) => `${made.width}x${made.height}`);
        scene.canvas.renderAll();
        const scratch = created
          .slice(before)
          .find((made, i) => `${made.width}x${made.height}` !== sized[i]);
        perCycle.push(created.length - before);
        // Whether the reused scratch is still holding a backing store.
        stillHolding.push(
          scratch === undefined ? 0 : scratch.width > 0 ? 1 : 0,
        );
        element.remove();
      }
    } finally {
      (
        document as unknown as { createElement: typeof original }
      ).createElement = original;
    }

    // Task 1's leak was a count that *grew* with the cycles - 56 surfaces
    // after ten - so the property is that it does not. A single cycle could
    // never have shown it, which is why this is ten.
    expect(
      perCycle[0],
      "the surface was found, so the test measured something",
    ).toBeGreaterThan(0);
    expect(
      new Set(stillHolding).size,
      "the scratch is released on every cycle, identically",
    ).toBe(1);
    expect(
      Math.max(...stillHolding),
      "and no cycle leaves a backing store behind",
    ).toBe(0);
  });

  it("is inert once disposed", () => {
    // A `ResizeObserver` and an `orientationchange` handler both outlive a
    // teardown, so a host that resizes after the scene is gone must not drive
    // a destroyed canvas. Mounted **with** a resolver, so the media path is
    // live: an `updateArtboard` on a scene with no media returns early and
    // would never reach the guard at all.
    const element = host();
    const scene = mountFabricScene({
      host: element,
      plan: plan(),
      artboard: { width: 400, height: 300 },
      background: backgroundWith("hero"),
      assets: [{ id: "hero", kind: "image", path: "assets/hero.png" }],
      resolveAsset: () => ({ url: "blob:hero" }),
    });
    expect(
      element.querySelector("[data-yunari-background-media] img"),
      "the media layer is live before teardown",
    ).not.toBeNull();

    scene.dispose();
    expect(
      element.querySelector("[data-yunari-background-media] img"),
      "and gone after it",
    ).toBeNull();

    // Counted from here, so only a post-teardown allocation is in the tally.
    const original = document.createElement.bind(document);
    let createdAfterDispose = 0;
    (document as unknown as { createElement: typeof original }).createElement =
      ((name: string, options?: ElementCreationOptions) => {
        if (name === "img" || name === "video") createdAfterDispose += 1;
        return original(name, options);
      }) as typeof original;

    // `finally`, because the patch is global: restored only on the success
    // path, a failure here would leak it into every later test in the file and
    // turn one red assertion into an unexplained cascade.
    try {
      expect(() => {
        scene.resize();
        scene.update(plan());
        scene.updateArtboard({ width: 400, height: 300 });
        scene.updateBackground(backgroundWith("hero"));
      }).not.toThrow();
      // The DOM cannot show the leak, because `destroy()` removed the layer and
      // anything re-appended lands on a detached node. What it *does* show is
      // the allocation: an `updateArtboard` past the guard builds a fresh image
      // with a load listener, and nothing will ever release it.
      //
      // The three guards fail by **two different mechanisms**, which is why
      // both halves are here. `resize` and `update` reach `fit()`, which
      // destructures `this.lower` after `destroy()` deleted it - a `TypeError`
      // caught by the `not.toThrow()` below. `updateArtboard` returns before
      // touching the canvas, so the counter is its only observable. Removing
      // either guard alone is caught; removing both would let the first
      // mechanism mask the second, which is why the counter is separate.
      expect(
        createdAfterDispose,
        "a disposed scene allocates no new media",
      ).toBe(0);
    } finally {
      (
        document as unknown as { createElement: typeof original }
      ).createElement = original;
    }
    element.remove();
  });

  it("is safe to dispose twice", () => {
    const element = host();
    const scene = mountFabricScene({ host: element, plan: plan() });
    scene.dispose();
    expect(() => scene.dispose()).not.toThrow();
    element.remove();
  });

  it("releases the glass lifecycle with the scene", () => {
    // Measured, because it decides what is left to prove: `canvas.destroy()`
    // disposes every Fabric object, and a disposed object drops its listeners,
    // so the panel's `before:render` and its scratch surface go with it whether
    // or not the glass handle is disposed. What Fabric cannot reach is the
    // handle's own listener on the canvas and on each group: the canvas is
    // destroyed, not disposed as a child, and a group that a caller kept a
    // reference to outlives the scene.
    const element = host();
    const scene = mountFabricScene({
      host: element,
      plan: plan(),
      artboard: { width: 400, height: 300 },
    });
    const group = new Group([], {});
    scene.canvas.add(group);
    scene.canvas.add(
      new Rect({
        left: 40,
        top: 40,
        width: 60,
        height: 40,
        originX: "left",
        originY: "top",
        fill: "rgba(255, 255, 255, 0.2)",
        yunariGlass: { blurRadius: 8 },
      }),
    );
    scene.canvas.renderAll();
    const listening = (target: object, event: string): number =>
      (
        target as unknown as {
          __eventListeners?: Record<string, unknown[]>;
        }
      ).__eventListeners?.[event]?.length ?? 0;
    expect(
      listening(group, "object:added"),
      "the handle watches the group it found",
    ).toBe(1);
    expect(listening(scene.canvas, "object:added"), "and the canvas").toBe(1);

    scene.dispose();

    expect(
      listening(group, "object:added"),
      "the group's listener is released with the scene",
    ).toBe(0);
    expect(listening(scene.canvas, "object:added"), "and the canvas's").toBe(0);
    element.remove();
  });
});
