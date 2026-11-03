// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mountBackgroundMedia } from "./background-media.js";

/**
 * The frame a video background declares, and the panel that reads it.
 *
 * Split from `background-media.dom.test.ts`, which is past the size the project
 * treats as a stop: this is one feature's browser behaviour and its own stubs.
 */

const ARTBOARD = { width: 400, height: 200 } as const;
const LOOP = { id: "loop", kind: "video", path: "assets/loop.webm" } as const;
const OTHER = {
  id: "other",
  kind: "video",
  path: "assets/other.webm",
} as const;
const HERO = { id: "hero", kind: "image", path: "assets/hero.png" } as const;

/** A fake 2D context that records the media's own operations. */
const recordingContext = () => {
  const calls: unknown[][] = [];
  return {
    calls,
    ctx: {
      save: () => undefined,
      restore: () => undefined,
      translate: () => undefined,
      scale: () => undefined,
      drawImage: (...args: unknown[]) => {
        calls.push(args);
      },
    } as unknown as CanvasRenderingContext2D,
  };
};

/**
 * jsdom decodes nothing, so the video's size, duration and seek are stated.
 * `scheduled` holds the frame callbacks the sampler registers, `drawn` the
 * frames the probe draws, and `time` the last seek — the frame it measured.
 */
function stubProbeMedia() {
  const scheduled: ((now: number, meta: { mediaTime: number }) => void)[] = [];
  const drawn: unknown[][] = [];
  const restores: (() => void)[] = [];
  let currentTime = 0;
  const patch = (
    target: object,
    key: string,
    descriptor: PropertyDescriptor,
  ): void => {
    const before = Object.getOwnPropertyDescriptor(target, key);
    Object.defineProperty(target, key, descriptor);
    restores.push(() => {
      if (before === undefined) {
        Reflect.deleteProperty(target, key);
      } else {
        Object.defineProperty(target, key, before);
      }
    });
  };
  patch(HTMLVideoElement.prototype, "requestVideoFrameCallback", {
    configurable: true,
    value: (callback: (now: number, meta: { mediaTime: number }) => void) => {
      scheduled.push(callback);
      return scheduled.length;
    },
  });
  patch(HTMLVideoElement.prototype, "cancelVideoFrameCallback", {
    configurable: true,
    value: () => undefined,
  });
  patch(HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: () => undefined,
  });
  patch(HTMLMediaElement.prototype, "pause", {
    configurable: true,
    value: () => undefined,
  });
  patch(HTMLVideoElement.prototype, "videoWidth", {
    configurable: true,
    get: () => 320,
  });
  patch(HTMLVideoElement.prototype, "videoHeight", {
    configurable: true,
    get: () => 180,
  });
  patch(HTMLMediaElement.prototype, "duration", {
    configurable: true,
    get: () => 10,
  });
  patch(HTMLMediaElement.prototype, "readyState", {
    configurable: true,
    get: () => 4,
  });
  patch(HTMLMediaElement.prototype, "currentTime", {
    configurable: true,
    get: () => currentTime,
    set(this: HTMLMediaElement, value: number) {
      currentTime = value;
      this.dispatchEvent(new Event("seeked"));
    },
  });
  patch(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => ({
      drawImage: (...args: unknown[]) => {
        drawn.push(args);
      },
    }),
  });
  patch(HTMLCanvasElement.prototype, "toDataURL", {
    configurable: true,
    value: () => "data:image/png;base64,AA",
  });
  return {
    scheduled,
    drawn,
    time: () => currentTime,
    restore: () => {
      for (const restore of restores.reverse()) restore();
    },
  };
}

/** The probe reads the frame rate from two callbacks, then seeks to the frame. */
const measureFrameRate = (media: ReturnType<typeof stubProbeMedia>): void => {
  // The last callback is the probe's: without a sampler following the live
  // video, it is also the only one.
  media.scheduled.at(-1)?.(0, { mediaTime: 0 });
  media.scheduled.at(-1)?.(0, { mediaTime: 1 / 25 });
};

describe("a video background's declared frame", () => {
  it("samples a video's declared frame and shows it when the video cannot play", () => {
    // A moving background is re-blurred for the glass on every frame.
    // The declared frame is the picture instead — measured, not assumed:
    // `currentTime = frame / fps`, with the fps taken from two callbacks.
    const media = stubProbeMedia();
    try {
      const host = document.createElement("div");
      let frames = 0;
      const handle = mountBackgroundMedia({
        host,
        background: {
          media: { assetId: "loop", bounds: "theme", fallbackFrame: 12 },
        },
        artboard: ARTBOARD,
        assets: [LOOP],
        resolveAsset: () => ({ url: "blob:loop" }),
        onFrame: () => {
          frames += 1;
        },
      });
      // The still is only read when a panel asks for it, so the video's own
      // frames are still followed until the scene says nothing is sampling.
      expect(media.scheduled, "the live picture is followed").toHaveLength(1);

      const videos = host.querySelectorAll("video");
      const probe = videos[videos.length - 1];
      expect(videos).toHaveLength(2);
      expect(probe, "a probe element reads the frame").not.toBe(videos[0]);

      probe?.dispatchEvent(new Event("loadedmetadata"));
      expect(media.scheduled, "the probe measures the frame rate").toHaveLength(
        2,
      );
      measureFrameRate(media);

      // Frame 12 at the measured 25 fps.
      expect(media.time()).toBeCloseTo(0.48, 3);
      expect(media.drawn, "the probe's frame is drawn once").toHaveLength(1);
      expect(media.drawn[0]?.[0]).toBe(probe);
      expect(
        (media.drawn[0]?.[3] as number) ?? 0,
        "capped, not full size",
      ).toBe(320);
      expect(frames, "the sampler is told it has a picture").toBe(1);
      expect(probe?.isConnected, "the probe is released").toBe(false);

      const { calls, ctx } = recordingContext();
      const device = { left: 0, top: 0, width: 400, height: 200 };
      expect(handle.backdrop()?.paint(ctx, device, device, "static")).toBe(
        true,
      );
      const sampled = calls[0]?.[0];
      expect(
        sampled,
        "the glass reads the still, not the video",
      ).toBeInstanceOf(HTMLCanvasElement);
      expect(sampled).not.toBe(videos[0]);

      // A video that cannot play is now only a display problem: the still
      // takes its place instead of leaving the bare board.
      host.querySelector("video")?.dispatchEvent(new Event("error"));
      expect(host.querySelector("video"), "no video remains").toBeNull();
      expect(host.querySelector("img")?.src).toBe("data:image/png;base64,AA");
      handle.destroy();
    } finally {
      media.restore();
    }
  });

  it("re-extracts the still when the declared frame changes", () => {
    // The editor hands `setBackground` a new object on every edit, so the frame
    // is compared by value: matching the object, or only the asset id, left the
    // glass on the previous frame after the author changed it (2026-10-29).
    const media = stubProbeMedia();
    const background = (frame?: number) => ({
      media: {
        assetId: "loop",
        bounds: "theme" as const,
        ...(frame === undefined ? {} : { fallbackFrame: frame }),
      },
    });

    try {
      const host = document.createElement("div");
      const handle = mountBackgroundMedia({
        host,
        background: background(),
        artboard: ARTBOARD,
        assets: [LOOP],
        resolveAsset: () => ({ url: "blob:loop" }),
      });
      const mounted = (): HTMLVideoElement | undefined => {
        const videos = host.querySelectorAll("video");
        return videos[videos.length - 1];
      };

      mounted()?.dispatchEvent(new Event("loadedmetadata"));
      measureFrameRate(media);
      expect(media.time()).toBeCloseTo(0, 3);

      handle.setBackground(background(12));
      expect(
        host.querySelectorAll("video"),
        "a new frame remounts",
      ).toHaveLength(2);
      mounted()?.dispatchEvent(new Event("loadedmetadata"));
      measureFrameRate(media);
      expect(media.time(), "frame 12 at 25 fps").toBeCloseTo(0.48, 3);
      expect(media.drawn, "one still per declared frame").toHaveLength(2);

      // The same background again is not a remount: an unchanged frame must not
      // restart the clip on every unrelated edit. The probe is gone by now, so
      // the live video alone is the picture.
      handle.setBackground(background(12));
      expect(host.querySelectorAll("video")).toHaveLength(1);
      expect(media.drawn).toHaveLength(2);
      handle.destroy();
    } finally {
      media.restore();
    }
  });

  it("stands a video with no declared frame on its first frame", () => {
    // A static panel with no picture paints nothing, and glass over a video
    // becomes a bare grey tint (seen on the TURZX panel, 2026-10-29). With no
    // frame authored, frame 0 is the still.
    const media = stubProbeMedia();
    try {
      const host = document.createElement("div");
      const handle = mountBackgroundMedia({
        host,
        background: { media: { assetId: "loop", bounds: "theme" } },
        artboard: ARTBOARD,
        assets: [LOOP],
        resolveAsset: () => ({ url: "blob:loop" }),
      });
      const videos = host.querySelectorAll("video");
      const probe = videos[videos.length - 1];
      probe?.dispatchEvent(new Event("loadedmetadata"));
      measureFrameRate(media);

      expect(media.time(), "the first frame, not a later one").toBeCloseTo(
        0,
        3,
      );
      expect(media.drawn, "the probe's frame is drawn once").toHaveLength(1);

      const { calls, ctx } = recordingContext();
      const device = { left: 0, top: 0, width: 400, height: 200 };
      expect(handle.backdrop()?.paint(ctx, device, device, "static")).toBe(
        true,
      );
      expect(calls[0]?.[0], "the glass reads the still").toBeInstanceOf(
        HTMLCanvasElement,
      );
      expect(calls[0]?.[0]).not.toBe(videos[0]);
      handle.destroy();
    } finally {
      media.restore();
    }
  });

  it("samples an image background as its own still", () => {
    // An image is already the picture a static panel wants. Reading only a
    // video's extracted frame left glass over an image sampling the board paint
    // instead — the card went flat the moment a video theme was switched to an
    // image background (seen on the TURZX panel, 2026-10-30).
    // jsdom decodes nothing, so the still states its own readiness and size.
    const restores = [
      stubImageProperty("complete", () => true),
      stubImageProperty("naturalWidth", () => 400),
      stubImageProperty("naturalHeight", () => 200),
    ];

    try {
      const host = document.createElement("div");
      const handle = mountBackgroundMedia({
        host,
        background: { media: { assetId: "hero", bounds: "theme" } },
        artboard: ARTBOARD,
        assets: [HERO],
        resolveAsset: () => ({ url: "blob:hero" }),
      });
      const image = host.querySelector("img");
      expect(image, "the image is mounted").not.toBeNull();

      const { calls, ctx } = recordingContext();
      const device = { left: 0, top: 0, width: 400, height: 200 };
      expect(handle.backdrop()?.paint(ctx, device, device, "static")).toBe(
        true,
      );
      expect(calls[0]?.[0], "the glass reads the image itself").toBe(image);
      handle.destroy();
    } finally {
      for (const restore of restores.reverse()) restore();
    }
  });

  it("does not let a stopped video's aborted play condemn the one swapped in", async () => {
    // Swapping the background stops the old video, whose pending `play()`
    // rejects with an abort *after* the new element is mounted. Marking the
    // mount failed from that stale rejection made its still replace the live
    // video, which froze the preview and left the play control nothing to act
    // on.
    const media = stubProbeMedia();
    const plays: {
      promise: Promise<void>;
      reject: (error: unknown) => void;
    }[] = [];
    const beforePlay = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      "play",
    );
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: () => {
        let reject!: (error: unknown) => void;
        const promise = new Promise<void>((_resolve, fail) => {
          reject = fail;
        });
        plays.push({ promise, reject });
        return promise;
      },
    });
    try {
      const host = document.createElement("div");
      const handle = mountBackgroundMedia({
        host,
        background: { media: { assetId: "loop", bounds: "theme" } },
        artboard: ARTBOARD,
        assets: [LOOP, OTHER],
        resolveAsset: (id) => ({ url: `blob:${id}` }),
      });
      const first = plays[0];
      handle.setBackground({ media: { assetId: "other", bounds: "theme" } });
      const live = host.querySelector("video");
      expect(first, "the first mount asked to play").toBeDefined();
      expect(live, "the swapped video is mounted").not.toBeNull();

      // The removed element's play aborts now that the replacement is in place.
      first?.reject(new Error("AbortError"));
      await Promise.resolve();

      // The replacement's still is extracted, which is when a wrong `failed`
      // would swap the live video for it.
      const videos = host.querySelectorAll("video");
      videos[videos.length - 1]?.dispatchEvent(new Event("loadedmetadata"));
      measureFrameRate(media);

      expect(host.querySelector("video"), "the live video stays").toBe(live);
      expect(
        host.querySelector("[data-yunari-background-media] img"),
        "a stale abort replaced the swapped video with its still",
      ).toBeNull();
      handle.destroy();
    } finally {
      if (beforePlay === undefined) {
        Reflect.deleteProperty(HTMLMediaElement.prototype, "play");
      } else {
        Object.defineProperty(HTMLMediaElement.prototype, "play", beforePlay);
      }
      media.restore();
    }
  });

  it("places the fallback still by its own size once it loads", () => {
    // The still replaces a video that cannot play, and the video's own
    // intrinsic listener leaves with it. Without one on the image, an
    // undecoded still was placed as the bare box — stretched — and never
    // corrected when it loaded.
    const media = stubProbeMedia();
    try {
      const host = document.createElement("div");
      const handle = mountBackgroundMedia({
        host,
        background: { media: { assetId: "loop", bounds: "theme" } },
        artboard: ARTBOARD,
        assets: [LOOP],
        resolveAsset: () => ({ url: "blob:loop" }),
      });
      const videos = host.querySelectorAll("video");
      videos[videos.length - 1]?.dispatchEvent(new Event("loadedmetadata"));
      measureFrameRate(media);

      handle.setBounds({
        artboard: { left: 0, top: 0, width: 400, height: 200 },
      });
      host.querySelector("video")?.dispatchEvent(new Event("error"));
      const image = host.querySelector<HTMLImageElement>(
        "[data-yunari-background-media] img",
      );
      expect(image, "the still stands in for the video").not.toBeNull();
      // Before it decodes the box is all there is: 400 × 200.
      expect(image?.style.height).toBe("200px");

      const restore = stubImageSize(320, 180);
      try {
        image?.dispatchEvent(new Event("load"));
        // 320 × 180 covering 400 × 200 is 400 × 225, not a stretch to 200.
        expect(image?.style.width, "the still covers the box").toBe("400px");
        expect(image?.style.height, "the still keeps its own aspect").toBe(
          "225px",
        );
      } finally {
        restore();
      }
      handle.destroy();
    } finally {
      media.restore();
    }
  });
});

/** jsdom decodes nothing: the still reports the size it would have after load. */
function stubImageSize(width: number, height: number): () => void {
  const restores = (
    [
      ["complete", () => true],
      ["naturalWidth", () => width],
      ["naturalHeight", () => height],
    ] as const
  ).map(([key, value]) => {
    const before = Object.getOwnPropertyDescriptor(
      HTMLImageElement.prototype,
      key,
    );
    Object.defineProperty(HTMLImageElement.prototype, key, {
      configurable: true,
      get: value,
    });
    return () => {
      if (before === undefined)
        Reflect.deleteProperty(HTMLImageElement.prototype, key);
      else Object.defineProperty(HTMLImageElement.prototype, key, before);
    };
  });
  return () => {
    for (const restore of restores.reverse()) restore();
  };
}

/** A read-only image property jsdom answers with nothing; the restore puts it back. */
function stubImageProperty(
  key: "complete" | "naturalWidth" | "naturalHeight",
  value: () => boolean | number,
): () => void {
  const before = Object.getOwnPropertyDescriptor(
    HTMLImageElement.prototype,
    key,
  );
  Object.defineProperty(HTMLImageElement.prototype, key, {
    configurable: true,
    get: value,
  });
  return () => {
    if (before === undefined)
      Reflect.deleteProperty(HTMLImageElement.prototype, key);
    else Object.defineProperty(HTMLImageElement.prototype, key, before);
  };
}
