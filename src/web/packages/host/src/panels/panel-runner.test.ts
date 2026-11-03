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
  rotation: 90,
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

    expect(start).toHaveBeenCalledWith(
      SOURCE.bytes,
      SOURCE.placement,
      SOURCE.rotation,
    );
    expect(presentOverlay).toHaveBeenCalledWith(Uint8Array.of(2));
    expect(present).not.toHaveBeenCalled();

    // The clip is the device's once started, so it is released with it.
    await runner.stop();
    expect(stopVideo).toHaveBeenCalledTimes(1);
  });

  it("retries a clip that failed to start before giving up on it", async () => {
    const presentOverlay = vi.fn(async () => {});
    const present = vi.fn(async () => {});
    let attempts = 0;
    const start = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("the page was navigating");
    });
    let frame = 0;
    const device: PanelDevice = {
      geometry: { width: 4, height: 4 },
      open: async () => {},
      present,
      close: async () => {},
      video: { start, presentOverlay, stop: async () => {} },
    };
    const rasterizer: Rasterizer = {
      capture: vi.fn(async () => Uint8Array.of((frame += 1))),
      captureOverlay: vi.fn(async () => Uint8Array.of(9, (frame += 1))),
      close: async () => {},
    };

    const runner = createPanelRunner({ device, rasterizer, video: SOURCE });
    // The first refusal shows a still; the next tick retries the clip and
    // recovers, which is what a save's page navigation requires.
    await runner.tick();
    await runner.tick();
    await runner.tick();

    expect(start).toHaveBeenCalledTimes(2);
    expect(present).toHaveBeenCalledTimes(1);
    expect(presentOverlay).toHaveBeenCalledTimes(2);
  });

  it("gives up on a clip the device keeps refusing", async () => {
    const onError = vi.fn();
    const present = vi.fn(async () => {});
    const start = vi.fn(async () => {
      throw new Error("no");
    });
    let frame = 0;
    const device: PanelDevice = {
      geometry: { width: 4, height: 4 },
      open: async () => {},
      present,
      close: async () => {},
      video: { start, presentOverlay: async () => {}, stop: async () => {} },
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
    for (let tick = 0; tick < 5; tick += 1) await runner.tick();

    // A retried upload that never lands stops being retried: stills are the
    // honest mode, and the attempts are what the log shows.
    expect(start).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(3);
    expect(present).toHaveBeenCalledTimes(5);
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

  it("retries an overlay the device refused once", async () => {
    let overlayCalls = 0;
    const presentOverlay = vi.fn(async () => {
      overlayCalls += 1;
      if (overlayCalls === 1) throw new Error("overlay refused");
    });
    const present = vi.fn(async () => {});
    let overlayFrame = 0;
    let stillFrame = 0;
    const device: PanelDevice = {
      geometry: { width: 4, height: 4 },
      open: async () => {},
      present,
      close: async () => {},
      video: {
        start: async () => {},
        presentOverlay,
        stop: async () => {},
      },
    };
    const rasterizer: Rasterizer = {
      capture: vi.fn(async () => Uint8Array.of(10, (stillFrame += 1))),
      captureOverlay: vi.fn(async () => Uint8Array.of(1, (overlayFrame += 1))),
      close: async () => {},
    };

    const runner = createPanelRunner({ device, rasterizer, video: SOURCE });
    await runner.tick();
    await runner.tick();
    await runner.tick();

    // A save's page reload can hand one capture an opaque frame the device
    // refuses; the next tick must offer the UI again rather than stick on
    // stills until the panel is reassigned.
    expect(presentOverlay).toHaveBeenCalledTimes(3);
    expect(present).not.toHaveBeenCalled();
  });

  it("falls back to stills once the overlay is refused repeatedly", async () => {
    const errors: string[] = [];
    const present = vi.fn(async () => {});
    const presentOverlay = vi.fn(async () => {
      throw new Error("overlay refused");
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

    // A refusal that keeps happening is a mode the panel does not have:
    // attempted a bounded number of times, then stills for the rest of its life.
    expect(presentOverlay).toHaveBeenCalledTimes(3);
    expect(present).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([
      "overlay refused",
      "overlay refused",
      "overlay refused",
    ]);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("closes the rasteriser and the device when the clip's stop fails", async () => {
    const close = vi.fn(async () => {});
    const deviceClose = vi.fn(async () => {});
    const device: PanelDevice = {
      geometry: { width: 4, height: 4 },
      open: async () => {},
      present: vi.fn(async () => {}),
      close: deviceClose,
      video: {
        start: async () => {},
        presentOverlay: async () => {},
        // A disconnected panel refuses this write; the port is still open and
        // must be released before anything can open it again.
        stop: async () => {
          throw new Error("The serial port is closed.");
        },
      },
    };
    const rasterizer: Rasterizer = {
      capture: vi.fn(async () => Uint8Array.of(1)),
      captureOverlay: vi.fn(async () => Uint8Array.of(2)),
      close,
    };

    const runner = createPanelRunner({ device, rasterizer, video: SOURCE });
    await runner.tick();
    await expect(runner.stop()).rejects.toThrow("The serial port is closed.");

    expect(close).toHaveBeenCalledTimes(1);
    expect(deviceClose).toHaveBeenCalledTimes(1);
  });

  it("closes the device when the rasteriser will not close", async () => {
    const deviceClose = vi.fn(async () => {});
    const device: PanelDevice = {
      geometry: { width: 4, height: 4 },
      open: async () => {},
      present: vi.fn(async () => {}),
      close: deviceClose,
    };
    const rasterizer: Rasterizer = {
      capture: vi.fn(async () => Uint8Array.of(1)),
      captureOverlay: vi.fn(async () => Uint8Array.of(2)),
      close: async () => {
        throw new Error("the page is gone");
      },
    };

    const runner = createPanelRunner({ device, rasterizer });
    await runner.tick();
    await expect(runner.stop()).rejects.toThrow("the page is gone");

    // A page that cannot close is not a reason to keep the port.
    expect(deviceClose).toHaveBeenCalledTimes(1);
  });
});
