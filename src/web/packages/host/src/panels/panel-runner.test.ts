import { describe, expect, it, vi } from "vitest";
import type { PanelDevice } from "./panel-device.js";
import type { Rasterizer } from "./panel-raster.js";
import { createPanelRunner } from "./panel-runner.js";

function fakes(
  frames: readonly Uint8Array[],
  options: {
    readonly video?: {
      readonly start: () => Promise<void>;
      readonly presentOverlay: (png: Uint8Array) => Promise<void>;
      readonly stop: () => Promise<void>;
    };
  } = {},
) {
  let index = 0;
  let overlays = 0;
  const present = vi.fn(async () => {});
  const video =
    options.video === undefined
      ? undefined
      : {
          start: vi.fn(options.video.start),
          presentOverlay: vi.fn(options.video.presentOverlay),
          stop: vi.fn(options.video.stop),
        };
  const device: PanelDevice = {
    geometry: { width: 4, height: 4 },
    open: vi.fn(async () => {}),
    present,
    close: vi.fn(async () => {}),
    ...(video === undefined ? {} : { video }),
  };
  const close = vi.fn(async () => {});
  const rasterizer: Rasterizer = {
    capture: vi.fn(async () => {
      const frame = frames[Math.min(index, frames.length - 1)];
      index += 1;
      return frame ?? new Uint8Array();
    }),
    captureOverlay: vi.fn(async () => {
      overlays += 1;
      return Uint8Array.of(0x89, 0x50, overlays);
    }),
    close,
  };
  return { device, rasterizer, present, close, video };
}

const RED = Uint8Array.of(1, 2, 3);
const BLUE = Uint8Array.of(1, 2, 4);
const VIDEO = {
  bytes: Uint8Array.of(1),
  placement: { offsetX: 0, offsetY: 0 },
};

describe("createPanelRunner", () => {
  it("sends the first frame", async () => {
    const { device, rasterizer, present } = fakes([RED]);
    const runner = createPanelRunner({ device, rasterizer });

    await expect(runner.tick()).resolves.toBe(true);
    expect(present).toHaveBeenCalledTimes(1);
  });

  it("does not start a second tick while one is in flight", async () => {
    const { device, rasterizer, present } = fakes([RED, BLUE]);
    let release: () => void = () => {};
    present.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const runner = createPanelRunner({ device, rasterizer });

    const first = runner.tick();
    // The interval fires again a second later. Overlapping sends on one USB
    // device are what the addon reports as "Cancelled".
    await expect(runner.tick()).resolves.toBe(false);
    expect(present).toHaveBeenCalledTimes(1);

    release();
    await expect(first).resolves.toBe(true);
  });

  it("does not send a frame identical to the one on the panel", async () => {
    const { device, rasterizer, present } = fakes([RED, RED, RED]);
    const runner = createPanelRunner({ device, rasterizer });

    await runner.tick();
    await expect(runner.tick()).resolves.toBe(false);
    await expect(runner.tick()).resolves.toBe(false);

    // The saving that makes a wall screen affordable: one write, three captures.
    expect(present).toHaveBeenCalledTimes(1);
  });

  it("sends again when one byte moved", async () => {
    const { device, rasterizer, present } = fakes([RED, BLUE]);
    const runner = createPanelRunner({ device, rasterizer });

    await runner.tick();
    await expect(runner.tick()).resolves.toBe(true);
    expect(present).toHaveBeenCalledTimes(2);
  });

  it("does not remember a frame the panel refused", async () => {
    const { device, rasterizer, present } = fakes([RED, RED]);
    present.mockRejectedValueOnce(new Error("unplugged"));
    const errors: string[] = [];
    const runner = createPanelRunner({
      device,
      rasterizer,
      onError: (message) => errors.push(message),
    });

    await expect(runner.tick()).resolves.toBe(false);
    // The retry is the point: a failed send left the panel showing something
    // else, so the same pixels are still news.
    await expect(runner.tick()).resolves.toBe(true);

    expect(errors).toEqual(["send: unplugged"]);
    expect(present).toHaveBeenCalledTimes(2);
  });

  it("reports a capture that threw without sending anything", async () => {
    const { device, present } = fakes([RED]);
    const errors: string[] = [];
    const rasterizer: Rasterizer = {
      capture: vi.fn(async () => {
        throw new Error("the browser went away");
      }),
      captureOverlay: vi.fn(async () => new Uint8Array()),
      close: vi.fn(async () => {}),
    };
    const runner = createPanelRunner({
      device,
      rasterizer,
      onError: (message) => errors.push(message),
    });

    await expect(runner.tick()).resolves.toBe(false);
    expect(present).not.toHaveBeenCalled();
    expect(errors).toEqual(["capture: the browser went away"]);
  });

  it("reports each frame it sent, and only those", async () => {
    const { device, rasterizer } = fakes([RED, RED, BLUE]);
    const frames: number[] = [];
    const runner = createPanelRunner({
      device,
      rasterizer,
      onFrame: () => frames.push(1),
    });

    await runner.tick();
    await runner.tick();
    await runner.tick();

    // The point of the line: it says a panel is being fed, and a skipped frame
    // is not one.
    expect(frames).toHaveLength(2);
  });

  it("sends nothing after stop, and releases both halves", async () => {
    const { device, rasterizer, present, close } = fakes([RED, BLUE]);
    const runner = createPanelRunner({ device, rasterizer });

    await runner.tick();
    await runner.stop();

    await expect(runner.tick()).resolves.toBe(false);
    expect(present).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(device.close).toHaveBeenCalledTimes(1);
  });

  it("is stopped once however often stop is called", async () => {
    const { device, rasterizer, close } = fakes([RED]);
    const runner = createPanelRunner({ device, rasterizer });

    await runner.stop();
    await runner.stop();

    expect(close).toHaveBeenCalledTimes(1);
    expect(device.close).toHaveBeenCalledTimes(1);
  });

  it("starts a video theme once and sends only the UI over it", async () => {
    const { device, rasterizer, present, video } = fakes([RED], {
      video: {
        start: async () => {},
        presentOverlay: async () => {},
        stop: async () => {},
      },
    });
    const runner = createPanelRunner({
      device,
      rasterizer,
      video: VIDEO,
    });

    await runner.tick();
    await runner.tick();

    // Playback is the device's: starting it twice restarts the clip, and a
    // still frame underneath would hide the video the owner assigned.
    expect(video?.start).toHaveBeenCalledTimes(1);
    expect(video?.presentOverlay).toHaveBeenCalledTimes(2);
    expect(present).not.toHaveBeenCalled();
  });

  it("falls back to still frames when the video will not start", async () => {
    const { device, rasterizer, present, video } = fakes([RED, BLUE], {
      video: {
        start: async () => {
          throw new Error("the encoder died");
        },
        presentOverlay: async () => {},
        stop: async () => {},
      },
    });
    const errors: string[] = [];
    const runner = createPanelRunner({
      device,
      rasterizer,
      video: VIDEO,
      onError: (message) => errors.push(message),
    });

    await runner.tick();
    await runner.tick();

    // Reported once, not every second: the panel is usable, just not as video.
    expect(errors).toEqual(["video: the encoder died"]);
    expect(video?.start).toHaveBeenCalledTimes(1);
    expect(present).toHaveBeenCalledTimes(2);
  });

  it("keeps the still path on a device that cannot decode video", async () => {
    const { device, rasterizer, present } = fakes([RED, BLUE]);
    const runner = createPanelRunner({
      device,
      rasterizer,
      video: VIDEO,
    });

    await runner.tick();

    expect(present).toHaveBeenCalledTimes(1);
  });

  it("stops playback when the runner stops", async () => {
    const { device, rasterizer, video } = fakes([RED], {
      video: {
        start: async () => {},
        presentOverlay: async () => {},
        stop: async () => {},
      },
    });
    const runner = createPanelRunner({
      device,
      rasterizer,
      video: VIDEO,
    });

    await runner.tick();
    await runner.stop();

    expect(video?.stop).toHaveBeenCalledTimes(1);
  });
});
