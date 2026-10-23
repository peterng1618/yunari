// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mountBackgroundMedia } from "./background-media.js";

const ARTBOARD = { width: 400, height: 200 } as const;
const HERO = { id: "hero", kind: "image", path: "assets/hero.png" } as const;
const LOOP = { id: "loop", kind: "video", path: "assets/loop.webm" } as const;
const OTHER = {
  id: "other",
  kind: "video",
  path: "assets/other.webm",
} as const;
const TWO = { id: "two", kind: "svg", path: "assets/two.svg" } as const;

describe("background media", () => {
  it("mounts image media below the Fabric canvas and disposes its source", () => {
    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    host.append(canvas);
    let disposed = false;

    const handle = mountBackgroundMedia({
      host,
      background: { media: { assetId: "hero", bounds: "theme" } },
      artboard: ARTBOARD,
      assets: [HERO],
      resolveAsset: () => ({
        url: "blob:hero",
        dispose: () => {
          disposed = true;
        },
      }),
    });

    const image = host.querySelector<HTMLImageElement>(
      "[data-yunari-background-media] img",
    );
    expect(image?.src).toBe("blob:hero");
    // Positioned by `placement`, not by `object-fit`.
    expect(image?.style.position).toBe("absolute");
    expect(image?.style.objectFit).toBe("");
    expect(
      host.firstElementChild?.hasAttribute("data-yunari-background-media"),
    ).toBe(true);
    expect(host.lastElementChild).toBe(canvas);

    handle.destroy();

    expect(disposed).toBe(true);
    expect(host.querySelector("[data-yunari-background-media]")).toBeNull();
  });

  it("mounts muted looping video media", () => {
    const host = document.createElement("div");
    const handle = mountBackgroundMedia({
      host,
      background: { media: { assetId: "loop", bounds: "theme" } },
      artboard: ARTBOARD,
      assets: [LOOP],
      resolveAsset: () => ({ url: "blob:loop" }),
    });

    const video = host.querySelector<HTMLVideoElement>(
      "[data-yunari-background-media] video",
    );
    expect(video?.src).toBe("blob:loop");
    expect(video?.style.position).toBe("absolute");
    expect(video?.autoplay).toBe(true);
    expect(video?.muted).toBe(true);
    expect(video?.loop).toBe(true);
    expect(video?.playsInline).toBe(true);

    handle.destroy();
  });

  it("replaces the old source when its media changes", () => {
    const host = document.createElement("div");
    const disposed: string[] = [];
    const resolveAsset = (id: string) => ({
      url: `blob:${id}`,
      dispose: () => {
        disposed.push(id);
      },
    });
    const handle = mountBackgroundMedia({
      host,
      background: { media: { assetId: "one", bounds: "theme" } },
      artboard: ARTBOARD,
      assets: [{ id: "one", kind: "image", path: "assets/one.png" }, TWO],
      resolveAsset,
    });

    handle.setBackground({ media: { assetId: "two", bounds: "theme" } });

    expect(disposed).toEqual(["one"]);
    expect(host.querySelector("img")?.src).toBe("blob:two");
  });

  it("keeps the same video element when only the transform changes", () => {
    const host = document.createElement("div");
    const handle = mountBackgroundMedia({
      host,
      background: { media: { assetId: "loop", bounds: "theme" } },
      artboard: ARTBOARD,
      assets: [LOOP],
      resolveAsset: () => ({ url: "blob:loop" }),
    });
    const before = host.querySelector("video");
    expect(before).not.toBeNull();

    handle.setBackground({
      media: { assetId: "loop", bounds: "theme", offsetX: 0.25 },
    });

    expect(host.querySelector("video")).toBe(before);
    handle.destroy();
  });

  it("replaces the element when the asset changes", () => {
    const host = document.createElement("div");
    const handle = mountBackgroundMedia({
      host,
      background: { media: { assetId: "loop", bounds: "theme" } },
      artboard: ARTBOARD,
      assets: [LOOP, OTHER],
      resolveAsset: (id) => ({ url: `blob:${id}` }),
    });
    const before = host.querySelector("video");
    expect(before).not.toBeNull();

    handle.setBackground({ media: { assetId: "other", bounds: "theme" } });

    expect(host.querySelector("video")).not.toBe(before);
    expect(host.querySelector<HTMLVideoElement>("video")?.src).toBe(
      "blob:other",
    );
    handle.destroy();
  });

  it("sizes the child from the placement rect", () => {
    const host = document.createElement("div");
    const handle = mountBackgroundMedia({
      host,
      background: { media: { assetId: "loop", bounds: "theme" } },
      artboard: { width: 200, height: 100 },
      assets: [LOOP],
      resolveAsset: () => ({ url: "blob:loop" }),
    });
    const child = host.querySelector<HTMLVideoElement>(
      "[data-yunari-background-media] video",
    );
    if (child === null) throw new Error("the layer mounted no video");
    // jsdom decodes nothing: the intrinsic size and the ready state have to be
    // stated for placement to have a source to fit.
    Object.defineProperty(child, "videoWidth", { value: 100 });
    Object.defineProperty(child, "videoHeight", { value: 100 });
    Object.defineProperty(child, "readyState", { value: 2 });

    handle.setBackground({
      media: {
        assetId: "loop",
        bounds: "theme",
        offsetY: 0.25,
      },
    });
    handle.setBounds({
      artboard: { left: 0, top: 0, width: 200, height: 100 },
      display: { left: 0, top: 0, width: 200, height: 100 },
    });

    // 200×100 box, 100×100 source: cover makes it 200×200, and a quarter-box
    // offset pans it 25px within the half-box overhang.
    expect(child.style.left).toBe("0px");
    expect(child.style.top).toBe("-25px");
    expect(child.style.width).toBe("200px");
    expect(child.style.height).toBe("200px");
    handle.destroy();
  });

  it("sizes a video from its metadata, before any frame decodes", () => {
    // `loadedmetadata` is the only intrinsic-arrived event a video has, and at
    // that moment `readyState` is HAVE_METADATA: the size is known, the frame is
    // not. Gating the placement on a frame left the video as the bare box —
    // stretched, every offset inert — while the glass sampler, reading later,
    // drew the placed rect.
    const host = document.createElement("div");
    const handle = mountBackgroundMedia({
      host,
      background: { media: { assetId: "loop", bounds: "theme" } },
      artboard: { width: 400, height: 200 },
      assets: [LOOP],
      resolveAsset: () => ({ url: "blob:loop" }),
    });
    const child = host.querySelector<HTMLVideoElement>(
      "[data-yunari-background-media] video",
    );
    if (child === null) throw new Error("the layer mounted no video");
    Object.defineProperty(child, "videoWidth", { value: 100 });
    Object.defineProperty(child, "videoHeight", { value: 100 });
    Object.defineProperty(child, "readyState", { value: 1 });
    child.dispatchEvent(new Event("loadedmetadata"));

    handle.setBackground({
      media: { assetId: "loop", bounds: "theme", offsetX: 0.25 },
    });
    handle.setBounds({
      artboard: { left: 0, top: 0, width: 400, height: 200 },
      display: { left: 0, top: 0, width: 400, height: 200 },
    });

    // 400×200 box, 100×100 source: cover is 4×, and a quarter-box pan on x needs
    // box*(1 + 0.5)/source = 6×, so the rect is 600×600 and pans 100px.
    expect(child.style.left).toBe("0px");
    expect(child.style.top).toBe("-200px");
    expect(child.style.width).toBe("600px");
    expect(child.style.height).toBe("600px");
    handle.destroy();
  });

  it("mirrors the child about the placed rect's centre", () => {
    const host = document.createElement("div");
    const handle = mountBackgroundMedia({
      host,
      background: { media: { assetId: "loop", bounds: "theme" } },
      artboard: { width: 200, height: 100 },
      assets: [LOOP],
      resolveAsset: () => ({ url: "blob:loop" }),
    });
    const child = host.querySelector<HTMLVideoElement>(
      "[data-yunari-background-media] video",
    );
    if (child === null) throw new Error("the layer mounted no video");
    Object.defineProperty(child, "videoWidth", { value: 100 });
    Object.defineProperty(child, "videoHeight", { value: 100 });
    Object.defineProperty(child, "readyState", { value: 2 });
    handle.setBounds({
      artboard: { left: 0, top: 0, width: 200, height: 100 },
      display: { left: 0, top: 0, width: 200, height: 100 },
    });

    const media = { assetId: "loop", bounds: "theme" } as const;
    handle.setBackground({ media: { ...media, flipX: true } });
    expect(child.style.transform).toBe("scaleX(-1)");
    // Flip is paint-time: the rect the no-gap proof reads does not move.
    expect([
      child.style.left,
      child.style.top,
      child.style.width,
      child.style.height,
    ]).toEqual(["0px", "-50px", "200px", "200px"]);

    handle.setBackground({ media: { ...media, flipY: true } });
    expect(child.style.transform).toBe("scaleY(-1)");

    handle.setBackground({ media: { ...media, flipX: true, flipY: true } });
    expect(child.style.transform).toBe("scaleX(-1) scaleY(-1)");

    handle.setBackground({ media });
    expect(child.style.transform).toBe("");
    handle.destroy();
  });

  it("sizes the layer to the chosen box and reports the rect it covered", () => {
    const host = document.createElement("div");
    const handle = mountBackgroundMedia({
      host,
      background: { media: { assetId: "hero", bounds: "theme" } },
      artboard: ARTBOARD,
      assets: [HERO],
      resolveAsset: () => ({ url: "blob:hero" }),
    });
    const layer = host.querySelector<HTMLElement>(
      "[data-yunari-background-media]",
    );
    const boxes = {
      artboard: { left: 10, top: 20, width: 800, height: 400 },
      display: { left: 0, top: 0, width: 1200, height: 500 },
    };
    handle.setBounds(boxes);

    // Theme: the layer sits on the artboard box, and the rect it covers in
    // artboard units is the board itself.
    expect([
      layer?.style.left,
      layer?.style.top,
      layer?.style.width,
      layer?.style.height,
    ]).toEqual(["10px", "20px", "800px", "400px"]);
    expect(handle.backdrop()?.rect).toEqual({
      left: 0,
      top: 0,
      width: 400,
      height: 200,
    });

    handle.setBackground({
      media: { assetId: "hero", bounds: "display" },
    });

    // Display: the layer covers the display box, not the artboard.
    expect([
      layer?.style.left,
      layer?.style.top,
      layer?.style.width,
      layer?.style.height,
    ]).toEqual(["0px", "0px", "1200px", "500px"]);
    // The reported rect is still artboard units: the artboard box is twice the
    // board's own size, so the display box starts half a board outside it.
    expect(handle.backdrop()?.rect).toEqual({
      left: -5,
      top: -10,
      width: 600,
      height: 250,
    });
    handle.destroy();
  });

  it("clips at the display box when bounds is display", () => {
    const host = document.createElement("div");
    const handle = mountBackgroundMedia({
      host,
      background: { media: { assetId: "loop", bounds: "theme" } },
      artboard: { width: 100, height: 100 },
      assets: [LOOP],
      resolveAsset: () => ({ url: "blob:loop" }),
    });
    handle.setBounds({
      artboard: { left: 50, top: 50, width: 100, height: 100 },
      display: { left: 0, top: 0, width: 400, height: 300 },
    });
    const layer = host.querySelector<HTMLElement>(
      "[data-yunari-background-media]",
    );
    expect([
      layer?.style.left,
      layer?.style.top,
      layer?.style.width,
      layer?.style.height,
    ]).toEqual(["50px", "50px", "100px", "100px"]);
    expect(layer?.style.overflow).toBe("hidden");

    handle.setBackground({ media: { assetId: "loop", bounds: "display" } });

    expect([
      layer?.style.left,
      layer?.style.top,
      layer?.style.width,
      layer?.style.height,
    ]).toEqual(["0px", "0px", "400px", "300px"]);
    handle.destroy();
  });

  it("reports an unresolvable declared background instead of dropping it", () => {
    const host = document.createElement("div");
    const errors: string[] = [];
    const handle = mountBackgroundMedia({
      host,
      background: { media: { assetId: "missing", bounds: "theme" } },
      artboard: ARTBOARD,
      assets: [HERO],
      resolveAsset: () => undefined,
      onMediaError: (message) => errors.push(message),
    });

    expect(errors).toEqual([
      'Background media asset "missing" is not declared by this theme.',
    ]);
    expect(host.querySelector("[data-yunari-background-media] img")).toBeNull();

    // A declared-but-unreadable asset reports too, rather than no-opping.
    handle.setBackground({ media: { assetId: "hero", bounds: "theme" } });

    expect(errors[1]).toBe(
      'Background media asset "hero" has no readable bytes.',
    );
    handle.destroy();
  });
});

describe("background media as a glass backdrop", () => {
  const background = {
    media: { assetId: "hero", bounds: "theme" },
  } as const;

  it("has nothing to sample without a declared, resolvable background", () => {
    const host = document.createElement("div");
    const handle = mountBackgroundMedia({
      host,
      background: undefined,
      artboard: ARTBOARD,
      assets: [],
      resolveAsset: () => ({ url: "blob:hero" }),
    });
    expect(handle.backdrop()).toBeUndefined();

    handle.setBackground(background);
    // Declared but undeclared by this theme: already reported, and nothing to draw.
    expect(handle.backdrop()).toBeUndefined();
    handle.destroy();
  });

  /** A fake 2D context that records the media's own operations. */
  const recordingContext = () => {
    const calls: unknown[][] = [];
    const ops: string[] = [];
    return {
      calls,
      ops,
      ctx: {
        save: () => ops.push("save"),
        restore: () => ops.push("restore"),
        translate: (x: number, y: number) => ops.push(`translate:${x},${y}`),
        scale: (x: number, y: number) => ops.push(`scale:${x},${y}`),
        drawImage: (...args: unknown[]) => {
          ops.push("drawImage");
          calls.push(args);
        },
      } as unknown as CanvasRenderingContext2D,
    };
  };

  /** jsdom decodes nothing, so the intrinsic size paint fits against is stated. */
  const withIntrinsic = (
    host: HTMLElement,
    width: number,
    height: number,
  ): HTMLImageElement => {
    const image = host.querySelector<HTMLImageElement>(
      "[data-yunari-background-media] img",
    );
    if (image === null) throw new Error("the layer mounted no image");
    Object.defineProperty(image, "complete", { value: true });
    Object.defineProperty(image, "naturalWidth", { value: width });
    Object.defineProperty(image, "naturalHeight", { value: height });
    return image;
  };

  it("draws the placed rect, not a cover crop, when the media is offset", () => {
    const host = document.createElement("div");
    const handle = mountBackgroundMedia({
      host,
      background: {
        media: {
          assetId: "hero",
          bounds: "theme",
          offsetX: 0.25,
          offsetY: 0.25,
        },
      },
      artboard: { width: 200, height: 100 },
      assets: [HERO],
      resolveAsset: () => ({ url: "blob:hero" }),
    });
    withIntrinsic(host, 100, 100);

    const { calls, ctx } = recordingContext();
    // 200×100 box, 100×100 source: cover is 200×200, and the quarter-box offsets
    // ask for a 50 px horizontal pan, which needs the 1.5× rect (300×300) 0095
    // describes; the 25 px vertical pan then sits inside the extra overhang.
    const painted = handle
      .backdrop()
      ?.paint(
        ctx,
        { left: 0, top: 0, width: 200, height: 100 },
        { left: 0, top: 0, width: 200, height: 100 },
      );
    expect(painted).toBe(true);
    expect(calls[0]?.slice(-4)).toEqual([0, -75, 300, 300]);
    handle.destroy();
  });

  it("mirrors what the DOM layer mirrors, about the placed rect's centre", () => {
    // Both axes, because the DOM child composes them independently and a
    // sampler that inverted only one would still agree on the other.
    for (const [axis, op] of [
      ["flipX", "scale:-1,1"],
      ["flipY", "scale:1,-1"],
    ] as const) {
      const host = document.createElement("div");
      const handle = mountBackgroundMedia({
        host,
        background: {
          media: { assetId: "hero", bounds: "theme", [axis]: true },
        },
        artboard: { width: 200, height: 100 },
        assets: [HERO],
        resolveAsset: () => ({ url: "blob:hero" }),
      });
      withIntrinsic(host, 100, 100);

      const { calls, ops, ctx } = recordingContext();
      handle
        .backdrop()
        ?.paint(
          ctx,
          { left: 0, top: 0, width: 200, height: 100 },
          { left: 0, top: 0, width: 200, height: 100 },
        );
      // The placed rect is 0,-50,200,200, so its centre is (100, 50); drawing
      // at the half-size about that centre is the same mirror the DOM child
      // carries.
      expect(ops, axis).toEqual([
        "save",
        "translate:100,50",
        op,
        "drawImage",
        "restore",
      ]);
      expect(calls[0]?.slice(-4), axis).toEqual([-100, -100, 200, 200]);
      handle.destroy();
    }
  });

  it("draws the whole source at every device scale, not a window of it", () => {
    // The defect (0012): a source window sized by the *device* rect is a
    // pixel-for-pixel crop of the middle of the file. Drawing without a source
    // rect makes the whole file the only thing `drawImage` can show.
    const host = document.createElement("div");
    const handle = mountBackgroundMedia({
      host,
      background,
      artboard: { width: 400, height: 200 },
      assets: [HERO],
      resolveAsset: () => ({ url: "blob:hero" }),
    });
    withIntrinsic(host, 400, 200);

    const drawnAt = (width: number, height: number) => {
      const { calls, ctx } = recordingContext();
      const device = { left: 0, top: 0, width, height };
      handle.backdrop()?.paint(ctx, device, device);
      return calls[0] ?? [];
    };

    // The player's reference viewport, and the editor's own zoomed-out camera.
    const atSize = drawnAt(400, 200);
    const zoomedOut = drawnAt(200, 100);

    // Five arguments: the whole image, no source window, and a destination that
    // is the placed rect at whatever scale the device rect was mapped at.
    expect(atSize).toHaveLength(5);
    expect(atSize.slice(-4)).toEqual([0, 0, 400, 200]);
    expect(zoomedOut.slice(-4)).toEqual([0, 0, 200, 100]);
    handle.destroy();
  });

  it("keeps a source feature at the same place in the region it is sampled for", () => {
    // A panel away from the media's origin must show the part of the background
    // actually behind it: sampling a region that starts at x=200 shifts the
    // media by the same amount, or the wallpaper slides under the panel.
    const host = document.createElement("div");
    const handle = mountBackgroundMedia({
      host,
      background,
      artboard: { width: 200, height: 100 },
      assets: [HERO],
      resolveAsset: () => ({ url: "blob:hero" }),
    });
    withIntrinsic(host, 200, 100);

    const drawnIn = (regionLeft: number) => {
      const { calls, ctx } = recordingContext();
      handle
        .backdrop()
        ?.paint(
          ctx,
          { left: regionLeft, top: 0, width: 600, height: 400 },
          { left: 0, top: 0, width: 400, height: 200 },
        );
      return (calls[0] ?? []).slice(-4) as number[];
    };

    const atOrigin = drawnIn(0);
    const shifted = drawnIn(200);

    // Same placement, moved left by exactly the region's own left offset.
    expect(atOrigin).toEqual([0, 0, 400, 200]);
    expect(shifted).toEqual([-200, 0, 400, 200]);
    // A stripe at the box's horizontal centre stays there, which is what makes
    // a located feature testable at all.
    expect((atOrigin[0] ?? 0) + (atOrigin[2] ?? 0) / 2).toBe(200);
  });

  it("follows video frames and starts no loop without a video", () => {
    const scheduled: (() => void)[] = [];
    const cancelled: number[] = [];
    const proto = HTMLVideoElement.prototype as unknown as {
      requestVideoFrameCallback: (cb: () => void) => number;
      cancelVideoFrameCallback: (handle: number) => void;
    };
    const hadCallbacks = "requestVideoFrameCallback" in proto;
    proto.requestVideoFrameCallback = (cb) => {
      scheduled.push(cb);
      return scheduled.length;
    };
    proto.cancelVideoFrameCallback = (handle) => cancelled.push(handle);

    try {
      const host = document.createElement("div");
      let frames = 0;
      const still = mountBackgroundMedia({
        host,
        background,
        artboard: ARTBOARD,
        assets: [HERO],
        resolveAsset: () => ({ url: "blob:hero" }),
        onFrame: () => {
          frames += 1;
        },
      });
      // An image background is not a moving thing; no loop may start for it.
      expect(scheduled).toHaveLength(0);
      expect(frames).toBe(0);
      still.destroy();

      const moving = mountBackgroundMedia({
        host,
        background: { media: { assetId: "loop", bounds: "theme" } },
        artboard: ARTBOARD,
        assets: [LOOP],
        resolveAsset: () => ({ url: "blob:loop" }),
        onFrame: () => {
          frames += 1;
        },
      });
      expect(scheduled).toHaveLength(1);
      scheduled[0]?.();
      expect(frames).toBe(1);
      // It re-arms, or the loop would run exactly once.
      expect(scheduled).toHaveLength(2);
      moving.destroy();
      expect(cancelled).toHaveLength(1);
      // Nothing may fire after teardown.
      const before = frames;
      scheduled.forEach((cb) => cb());
      expect(frames).toBe(before);

      if (!hadCallbacks) {
        delete (proto as Record<string, unknown>)["requestVideoFrameCallback"];
        delete (proto as Record<string, unknown>)["cancelVideoFrameCallback"];
      }
    } finally {
      if (!hadCallbacks) {
        delete (proto as Record<string, unknown>)["requestVideoFrameCallback"];
        delete (proto as Record<string, unknown>)["cancelVideoFrameCallback"];
      }
    }
  });

  it("asks for a repaint when a still image finally decodes", () => {
    // A glass panel samples the media into its backdrop, and an image with no
    // decoded pixels has none to sample. The layer is a DOM sibling, so Fabric
    // never sees it arrive: without this the panel keeps the empty sample it
    // took before the bytes landed, and nothing else in the scene will
    // repaint to correct it.
    const host = document.createElement("div");
    let frames = 0;
    const handle = mountBackgroundMedia({
      host,
      background,
      artboard: ARTBOARD,
      assets: [HERO],
      resolveAsset: () => ({ url: "blob:hero" }),
      onFrame: () => {
        frames += 1;
      },
    });
    const image = host.querySelector<HTMLImageElement>(
      "[data-yunari-background-media] img",
    );
    expect(image, "the layer mounted an image").not.toBeNull();
    expect(frames, "nothing to report before the bytes land").toBe(0);

    image?.dispatchEvent(new Event("load"));
    expect(frames, "the decode asks for a repaint").toBe(1);
    // Once, not a loop: a still image is not a moving thing.
    image?.dispatchEvent(new Event("load"));
    expect(frames, "and it is not a loop").toBe(1);

    // A failed image never gets pixels, so it must not keep asking.
    const failing = new Event("error");
    image?.dispatchEvent(failing);
    expect(frames, "a failed decode does not ask for a repaint").toBe(1);
    handle.destroy();
  });

  it("stops asking for a repaint once the media is torn down", () => {
    // A decode that lands after teardown would repaint a canvas the host has
    // already released, and the listener is what has to go.
    const host = document.createElement("div");
    let frames = 0;
    const handle = mountBackgroundMedia({
      host,
      background,
      artboard: ARTBOARD,
      assets: [HERO],
      resolveAsset: () => ({ url: "blob:hero" }),
      onFrame: () => {
        frames += 1;
      },
    });
    const image = host.querySelector<HTMLImageElement>(
      "[data-yunari-background-media] img",
    );
    handle.destroy();
    image?.dispatchEvent(new Event("load"));
    expect(frames, "a decode after teardown asks for nothing").toBe(0);
  });

  it("re-arms the decode notification across an asset change", () => {
    // A different asset replaces the element, so the new one needs its own
    // listener or a swapped background never reaches the glass panels
    // sampling it.
    const host = document.createElement("div");
    let frames = 0;
    const handle = mountBackgroundMedia({
      host,
      background,
      artboard: ARTBOARD,
      assets: [HERO, TWO],
      resolveAsset: (id) => ({ url: `blob:${id}` }),
      onFrame: () => {
        frames += 1;
      },
    });
    handle.setBackground({ media: { assetId: "two", bounds: "theme" } });
    const swapped = host.querySelector<HTMLImageElement>(
      "[data-yunari-background-media] img",
    );
    swapped?.dispatchEvent(new Event("load"));
    expect(frames, "the replacement image reports its own decode").toBe(1);
    handle.destroy();
  });

  it("keeps following frames when a transform update re-places the same video", () => {
    // An offset or flip change is a placement or paint change, not a reload:
    // the video must keep playing, so the frame subscription must survive it
    // too.
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
    proto.cancelVideoFrameCallback = () => {};

    try {
      const host = document.createElement("div");
      let frames = 0;
      const handle = mountBackgroundMedia({
        host,
        background: { media: { assetId: "loop", bounds: "theme" } },
        artboard: ARTBOARD,
        assets: [LOOP, OTHER, HERO],
        resolveAsset: (id) => ({ url: `blob:${id}` }),
        onFrame: () => {
          frames += 1;
        },
      });
      const video = host.querySelector("video");
      expect(scheduled).toHaveLength(1);

      // A same-asset transform change: the same element, the same loop.
      handle.setBackground({
        media: { assetId: "loop", bounds: "theme", offsetX: 0.25, flipY: true },
      });
      expect(host.querySelector("video")).toBe(video);
      expect(scheduled, "no new subscription for a re-placement").toHaveLength(
        1,
      );
      scheduled[0]?.();
      expect(frames, "a frame still reaches the host").toBe(1);

      // A switch to a different video mounts and follows the new one.
      const afterFire = scheduled.length;
      handle.setBackground({ media: { assetId: "other", bounds: "theme" } });
      expect(scheduled.length, "the new video is followed too").toBe(
        afterFire + 1,
      );

      // And back to an image, which must stop following entirely.
      const afterSwitch = scheduled.length;
      handle.setBackground(background);
      expect(scheduled.length, "an image starts no loop").toBe(afterSwitch);
      handle.destroy();
    } finally {
      if (!had) {
        delete (proto as Record<string, unknown>)["requestVideoFrameCallback"];
        delete (proto as Record<string, unknown>)["cancelVideoFrameCallback"];
      }
    }
  });
});
