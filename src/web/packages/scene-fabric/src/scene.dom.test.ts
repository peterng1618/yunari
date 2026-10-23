// @vitest-environment jsdom

import type { Background, ScenePlan } from "@yunari/renderer-core";
import { Group, Rect } from "fabric/es";
import { describe, expect, it } from "vitest";
import { type FabricSceneHandle, mountFabricScene } from "./scene.js";

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
  Object.defineProperty(element, "clientWidth", { value: 400 });
  Object.defineProperty(element, "clientHeight", { value: 300 });
  document.body.append(element);
  return element;
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

    if (options.glass) {
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
      // The panel's scratch surface is allocated during a render, which is why
      // the gate cannot be a decision taken at mount.
      scene.canvas.renderAll();
    }

    return { scene, frames };
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

  it("asks for no repaint per decoded frame when nothing samples the backdrop", () => {
    // The video is still followed — that is `background-media.ts`'s own
    // decision, unchanged — and every frame it delivers asks for nothing,
    // because a canvas repaint per decoded frame is what a video background
    // used to cost with no reader at all.
    const { scene, frames } = mountVideo({ glass: false });

    expect(frames, "the video is being followed").toHaveLength(1);
    expect(
      repaintsOnFrame(scene, frames),
      "a decoded frame nothing samples asks for no repaint",
    ).toBe(0);

    scene.dispose();
  });

  it("still repaints per frame when a glass panel samples the backdrop", () => {
    // A frozen frame behind a blur is the bug the loop exists to prevent, so
    // the gate is exactly "is anything reading the backdrop".
    const { scene, frames } = mountVideo({ glass: true });

    expect(
      repaintsOnFrame(scene, frames),
      "the panel is sampling a moving backdrop",
    ).toBe(1);

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
