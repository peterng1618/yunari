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
    close,
  };
  return { device, rasterizer, present, close };
}

const RED = Uint8Array.of(1, 2, 3);
const BLUE = Uint8Array.of(1, 2, 4);

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
      rasterizer: { capture, close: async () => {} },
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
});
