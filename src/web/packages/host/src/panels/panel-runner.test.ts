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

  it("starts the next capture while the frame is still being sent", async () => {
    const order: string[] = [];
    let sending = false;
    const capture = vi.fn(async () => {
      order.push(sending ? "capture-during-send" : "capture");
      return RED;
    });
    const present = vi.fn(async () => {
      sending = true;
      await new Promise((resolve) => setTimeout(resolve, 5));
      sending = false;
    });
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

    await expect(runner.tick()).resolves.toBe(true);

    // The overlap is the whole point: the next frame is in hand before this
    // one is on the wire, so a frame costs the longer of the two, not the sum.
    expect(order).toEqual(["capture", "capture-during-send"]);
  });

  it("never runs two captures at once", async () => {
    let active = 0;
    let peak = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const capture = vi.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await gate;
      active -= 1;
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
    // A tick that arrives mid-capture is queued, not raced.
    await expect(runner.tick()).resolves.toBe(false);
    release?.();
    await expect(first).resolves.toBe(true);

    expect(peak).toBe(1);
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

  it("gives the device up after three failed frames, and says so once", async () => {
    const { device, rasterizer, present } = fakes([RED, RED, RED, RED]);
    present.mockRejectedValue(new Error("write after a stream was destroyed"));
    const lost = vi.fn();
    const runner = createPanelRunner({
      device,
      rasterizer,
      onLost: (message) => lost(message),
    });

    await expect(runner.tick()).resolves.toBe(false);
    await expect(runner.tick()).resolves.toBe(false);
    expect(lost).not.toHaveBeenCalled();
    await expect(runner.tick()).resolves.toBe(false);

    // Three refusals in a row is a port that is gone, not a bad frame. The
    // manager is told once and the runner stops feeding itself, so the retry
    // pass owns the display rather than a tick loop spinning on a dead handle.
    expect(lost).toHaveBeenCalledTimes(1);
    expect(lost).toHaveBeenCalledWith("write after a stream was destroyed");
    expect(runner.running).toBe(false);
    await expect(runner.tick()).resolves.toBe(false);
    expect(present).toHaveBeenCalledTimes(3);
  });

  it("lets one success clear the failures before it", async () => {
    const { device, rasterizer, present } = fakes([RED, RED, RED, RED]);
    present
      .mockRejectedValueOnce(new Error("once"))
      .mockRejectedValueOnce(new Error("twice"));
    const lost = vi.fn();
    const runner = createPanelRunner({
      device,
      rasterizer,
      onLost: (message) => lost(message),
    });

    await runner.tick();
    await runner.tick();
    await expect(runner.tick()).resolves.toBe(true);
    await runner.tick();

    // A panel that answers again is not lost: the count is consecutive, so the
    // two refusals before the success cannot add up to one.
    expect(lost).not.toHaveBeenCalled();
    expect(runner.running).toBe(true);
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

  it("keeps stills when the device has no video, whatever source it is given", async () => {
    const present = vi.fn(async () => {});
    const overlay = vi.fn(async () => Uint8Array.of(2));
    const device: PanelDevice = {
      geometry: { width: 4, height: 4 },
      open: async () => {},
      present,
      close: async () => {},
    };
    const rasterizer: Rasterizer = {
      capture: vi.fn(async () => Uint8Array.of(1)),
      captureOverlay: overlay,
      close: async () => {},
    };

    await createPanelRunner({ device, rasterizer, video: SOURCE }).tick();

    expect(present).toHaveBeenCalledTimes(1);
    expect(overlay).not.toHaveBeenCalled();
  });

  it("starts the clip once across many ticks", async () => {
    const start = vi.fn(async () => {});
    let frame = 0;
    const device: PanelDevice = {
      geometry: { width: 4, height: 4 },
      open: async () => {},
      present: vi.fn(async () => {}),
      close: async () => {},
      video: {
        start,
        presentOverlay: vi.fn(async () => {}),
        stop: async () => {},
      },
    };
    const rasterizer: Rasterizer = {
      capture: vi.fn(async () => Uint8Array.of(1)),
      captureOverlay: vi.fn(async () => Uint8Array.of(1, (frame += 1))),
      close: async () => {},
    };

    const runner = createPanelRunner({ device, rasterizer, video: SOURCE });
    await runner.tick();
    await runner.tick();

    expect(start).toHaveBeenCalledTimes(1);
  });

  it("stops the clip before closing the device", async () => {
    const order: string[] = [];
    const device: PanelDevice = {
      geometry: { width: 4, height: 4 },
      open: async () => {},
      present: vi.fn(async () => {}),
      close: async () => {
        order.push("close");
      },
      video: {
        start: async () => {},
        presentOverlay: async () => {},
        stop: async () => {
          order.push("stop");
        },
      },
    };
    const rasterizer: Rasterizer = {
      capture: vi.fn(async () => Uint8Array.of(1)),
      captureOverlay: vi.fn(async () => Uint8Array.of(2)),
      close: async () => {},
    };

    const runner = createPanelRunner({ device, rasterizer, video: SOURCE });
    await runner.tick();
    await runner.stop();

    expect(order).toEqual(["stop", "close"]);
  });

  it("waits for a tick already inside the clip before closing", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const order: string[] = [];
    const device: PanelDevice = {
      geometry: { width: 4, height: 4 },
      open: async () => {},
      present: vi.fn(async () => {}),
      close: async () => {
        order.push("close");
      },
      video: {
        start: async () => {
          order.push("start");
        },
        presentOverlay: async () => {
          await gate;
          order.push("overlay");
        },
        stop: async () => {
          order.push("stop");
        },
      },
    };
    const rasterizer: Rasterizer = {
      capture: vi.fn(async () => Uint8Array.of(1)),
      captureOverlay: vi.fn(async () => Uint8Array.of(2)),
      close: async () => {},
    };

    const runner = createPanelRunner({ device, rasterizer, video: SOURCE });
    const ticking = runner.tick();
    // Let `video.start` resolve so the tick is inside `presentOverlay`.
    await Promise.resolve();

    const stopping = runner.stop();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual(["start"]);

    release();
    await Promise.all([ticking, stopping]);

    expect(order).toEqual(["start", "overlay", "stop", "close"]);
  });

  it("falls back to stills when the overlay is refused after the clip started", async () => {
    const errors: string[] = [];
    const present = vi.fn(async () => {});
    let overlayCalls = 0;
    const presentOverlay = vi.fn(async () => {
      overlayCalls += 1;
      if (overlayCalls === 3) throw new Error("overlay refused");
    });
    const start = vi.fn(async () => {});
    let overlayFrame = 0;
    let stillFrame = 0;
    const device: PanelDevice = {
      geometry: { width: 4, height: 4 },
      open: async () => {},
      present,
      close: async () => {},
      video: { start, presentOverlay, stop: async () => {} },
    };
    const rasterizer: Rasterizer = {
      capture: vi.fn(async () => Uint8Array.of(10, (stillFrame += 1))),
      captureOverlay: vi.fn(async () => Uint8Array.of(1, (overlayFrame += 1))),
      close: async () => {},
    };

    const runner = createPanelRunner({
      device,
      rasterizer,
      video: SOURCE,
      onError: (message) => errors.push(message),
    });
    await runner.tick();
    await runner.tick();
    await expect(runner.tick()).resolves.toBe(false);
    await expect(runner.tick()).resolves.toBe(true);

    // Refused once, then stills for the rest of the runner's life.
    expect(presentOverlay).toHaveBeenCalledTimes(3);
    expect(present).toHaveBeenCalledTimes(1);
    expect(errors).toEqual(["overlay refused"]);
    expect(start).toHaveBeenCalledTimes(1);
  });
});
