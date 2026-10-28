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

describe("a video background's declared frame", () => {
  it("samples a video's declared frame and shows it when the video cannot play", () => {
    // 0135: a moving background is re-blurred for the glass on every frame.
    // The declared frame is the picture instead — measured, not assumed:
    // `currentTime = frame / fps`, with the fps taken from two callbacks.
    const scheduled: ((now: number, meta: { mediaTime: number }) => void)[] =
      [];
    const drawn: unknown[][] = [];
    let currentTime = 0;
    const restores: (() => void)[] = [];
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
      expect(scheduled, "the live picture is followed").toHaveLength(1);

      const videos = host.querySelectorAll("video");
      const probe = videos[videos.length - 1];
      expect(videos).toHaveLength(2);
      expect(probe, "a probe element reads the frame").not.toBe(videos[0]);

      probe?.dispatchEvent(new Event("loadedmetadata"));
      expect(scheduled, "the probe measures the frame rate").toHaveLength(2);
      scheduled[1]?.(0, { mediaTime: 0 });
      scheduled[2]?.(0, { mediaTime: 1 / 25 });

      // Frame 12 at the measured 25 fps.
      expect(currentTime).toBeCloseTo(0.48, 3);
      expect(drawn, "the probe's frame is drawn once").toHaveLength(1);
      expect(drawn[0]?.[0]).toBe(probe);
      expect((drawn[0]?.[3] as number) ?? 0, "capped, not full size").toBe(320);
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
      for (const restore of restores.reverse()) restore();
    }
  });

  it("paints the paint, not the video, for a static panel with no declared frame", () => {
    // Static means the picture an image background or a paint would give: with
    // no frame declared there is no still, so the video is not a stand-in.
    const host = document.createElement("div");
    const handle = mountBackgroundMedia({
      host,
      background: { media: { assetId: "loop", bounds: "theme" } },
      artboard: ARTBOARD,
      assets: [LOOP],
      resolveAsset: () => ({ url: "blob:loop" }),
    });
    const video = host.querySelector("video");
    if (video === null) throw new Error("the layer mounted no video");
    // jsdom decodes nothing, so the size and the decoded frame are stated.
    Object.defineProperty(video, "videoWidth", { value: 400 });
    Object.defineProperty(video, "videoHeight", { value: 200 });
    Object.defineProperty(video, "readyState", { value: 4 });

    const device = { left: 0, top: 0, width: 400, height: 200 };
    const live = recordingContext();
    expect(handle.backdrop()?.paint(live.ctx, device, device, "dynamic")).toBe(
      true,
    );
    expect(live.calls[0]?.[0]).toBe(video);

    const still = recordingContext();
    expect(handle.backdrop()?.paint(still.ctx, device, device, "static")).toBe(
      false,
    );
    expect(still.calls, "nothing static to show").toHaveLength(0);
    handle.destroy();
  });
});
