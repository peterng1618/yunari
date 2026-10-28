import { describe, expect, it, vi } from "vitest";
import type { PanelDevice } from "./panel-device.js";
import type { Rasterizer } from "./panel-raster.js";
import { createPanelRunner } from "./panel-runner.js";

function fakes(frames: readonly Uint8Array[]) {
  let index = 0;
  const present = vi.fn(async () => {});
  const device: PanelDevice = {
    geometry: { width: 4, height: 4 },
    open: vi.fn(async () => {}),
    present,
    close: vi.fn(async () => {}),
  };
  const close = vi.fn(async () => {});
  const rasterizer: Rasterizer = {
    capture: vi.fn(async () => {
      const frame = frames[Math.min(index, frames.length - 1)];
      index += 1;
      return frame ?? new Uint8Array();
    }),
    captureOverlay: vi.fn(async () => new Uint8Array()),
    close,
  };
  return { device, rasterizer, present, close };
}

const RED = Uint8Array.of(1, 2, 3);
const BLUE = Uint8Array.of(1, 2, 4);
const SOURCE = {
  bytes: Uint8Array.of(7),
  placement: { offsetX: 0, offsetY: 0 },
};

describe("createPanelRunner", () => {
  it("sends the first frame", async () => {
    const { device, rasterizer, present } = fakes([RED]);
    const runner = createPanelRunner({ device, rasterizer });

    await expect(runner.tick()).resolves.toBe(true);
    expect(present).toHaveBeenCalledTimes(1);
  });

  it("does not start a second capture while one is in flight", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const capture = vi.fn(async () => {
      await gate;
      return RED;
    });
    const present = vi.fn(async () => {});
    const device: PanelDevice = {
      geometry: { width: 4, height: 4 },
      open: async () => {},
      present,
      close: async () => {},
    };
    const runner = createPanelRunner({
      device,
      rasterizer: {
        capture,
        captureOverlay: async () => new Uint8Array(),
        close: async () => {},
      },
    });

    const first = runner.tick();
    await expect(runner.tick()).resolves.toBe(false);
    release?.();
    await expect(first).resolves.toBe(true);

    expect(capture).toHaveBeenCalledTimes(1);
    expect(present).toHaveBeenCalledTimes(1);
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

    expect(errors).toEqual(["unplugged"]);
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
    expect(errors).toEqual(["the browser went away"]);
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

  it("sends overlay captures through presentOverlay when a video source is given", async () => {
    const presentOverlay = vi.fn(async () => {});
    const present = vi.fn(async () => {});
    const start = vi.fn(async () => {});
    const stopVideo = vi.fn(async () => {});
    const device: PanelDevice = {
      geometry: { width: 4, height: 4 },
      open: async () => {},
      present,
      close: async () => {},
      video: { start, presentOverlay, stop: stopVideo },
    };
    const rasterizer: Rasterizer = {
      capture: vi.fn(async () => Uint8Array.of(1)),
      captureOverlay: vi.fn(async () => Uint8Array.of(2)),
      close: async () => {},
    };

    const runner = createPanelRunner({ device, rasterizer, video: SOURCE });
    await expect(runner.tick()).resolves.toBe(true);

    expect(start).toHaveBeenCalledWith(SOURCE.bytes, SOURCE.placement);
    expect(presentOverlay).toHaveBeenCalledWith(Uint8Array.of(2));
    expect(present).not.toHaveBeenCalled();

    // The clip is the device's once started, so it is released with it.
    await runner.stop();
    expect(stopVideo).toHaveBeenCalledTimes(1);
  });

  it("falls back to still frames when the video will not start, once", async () => {
    const onError = vi.fn();
    const present = vi.fn(async () => {});
    let frame = 0;
    const device: PanelDevice = {
      geometry: { width: 4, height: 4 },
      open: async () => {},
      present,
      close: async () => {},
      video: {
        start: async () => {
          throw new Error("no");
        },
        presentOverlay: async () => {},
        stop: async () => {},
      },
    };
    const rasterizer: Rasterizer = {
      capture: vi.fn(async () => Uint8Array.of((frame += 1))),
      captureOverlay: vi.fn(async () => Uint8Array.of(9)),
      close: async () => {},
    };

    const runner = createPanelRunner({
      device,
      rasterizer,
      video: SOURCE,
      onError,
    });
    await runner.tick();
    await runner.tick();

    // The retry is the point: a refused clip is reported once, then the panel
    // shows stills rather than spinning on an upload that already failed.
    expect(present).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("keeps the still path when no video source is given", async () => {
    const present = vi.fn(async () => {});
    const presentOverlay = vi.fn(async () => {});
    const device: PanelDevice = {
      geometry: { width: 4, height: 4 },
      open: async () => {},
      present,
      close: async () => {},
      video: { start: async () => {}, presentOverlay, stop: async () => {} },
    };
    const rasterizer: Rasterizer = {
      capture: vi.fn(async () => Uint8Array.of(1)),
      captureOverlay: vi.fn(async () => Uint8Array.of(2)),
      close: async () => {},
    };

    await createPanelRunner({ device, rasterizer }).tick();

    expect(present).toHaveBeenCalledTimes(1);
    expect(presentOverlay).not.toHaveBeenCalled();
  });
});
