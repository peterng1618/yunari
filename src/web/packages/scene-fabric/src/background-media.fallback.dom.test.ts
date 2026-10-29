// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mountBackgroundMedia } from "./background-media.js";

/**
 * The frame a video background declares, and the panel that reads it (0135).
 *
 * Split from `background-media.dom.test.ts`, which is past the size the project
 * treats as a stop: this is one feature's browser behaviour and its own stubs.
 */

const ARTBOARD = { width: 400, height: 200 } as const;
const LOOP = { id: "loop", kind: "video", path: "assets/loop.webm" } as const;

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
    // 0135: a moving background is re-blurred for the glass on every frame.
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
});
