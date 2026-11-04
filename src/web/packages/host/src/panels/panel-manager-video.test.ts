import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PanelVideoSource } from "./panel-device.js";
import {
  managerOver as createManagerOver,
  deviceOver,
  familyOver,
  pause,
  SETTLE_MS,
  SOURCE,
} from "./panel-manager.fixtures.js";
import type { PanelManagerOptions } from "./panel-manager.js";

/**
 * The save-time restart gate: a running panel is left alone only when the next
 * read describes the same stream. The clip's bytes, the authored pan, the
 * composition baked into the pixels and the display's angle all decide that.
 */
const h = vi.hoisted(() => ({
  family: undefined as unknown,
  rasterizer: (): unknown => ({
    capture: async () => new Uint8Array([1]),
    captureOverlay: async () => new Uint8Array([2]),
    close: async () => {},
  }),
  browsers: [] as unknown[],
  events: [] as string[],
}));

vi.mock("./panel-families.js", () => ({ familyFor: () => h.family }));
vi.mock("../serve/display-launcher.js", () => ({
  findBrowser: () => "C:/fake/chrome.exe",
}));

beforeEach(() => {
  h.browsers = [];
  h.events = [];
  h.rasterizer = () => ({
    capture: async () => new Uint8Array([1]),
    captureOverlay: async () => new Uint8Array([2]),
    close: async () => {},
  });
});

function managerOver(
  overrides: Partial<PanelManagerOptions> = {},
): ReturnType<typeof createManagerOver> {
  return createManagerOver(h, overrides);
}

describe("createPanelManager video refresh", () => {
  it("leaves the runner alone when a save re-reads the same clip", async () => {
    let opens = 0;
    const start = vi.fn(async () => {});
    const stop = vi.fn(async () => {});
    h.family = familyOver(async () => {
      opens += 1;
      return deviceOver({
        frameIntervalMs: 5,
        video: { start, presentOverlay: async () => {}, stop },
      });
    });

    // A fresh object each read, so the comparison cannot pass on identity.
    const videoFor = vi.fn(async () => ({
      bytes: Uint8Array.of(7),
      placement: { offsetX: 0.25, offsetY: 0 },
    }));
    const manager = managerOver({ videoFor });

    await manager.start("strip");
    await pause(2 * SETTLE_MS);
    await manager.refreshVideo("strip");

    expect(opens).toBe(1);
    expect(stop).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledTimes(1);

    await manager.stop("strip");
  });

  it("restarts the runner when a save's clip, its pan or its angle changed", async () => {
    let opens = 0;
    let clip: PanelVideoSource = {
      bytes: Uint8Array.of(7),
      placement: { offsetX: 0, offsetY: 0 },
      rotation: 0,
    };
    const start = vi.fn(async () => {});
    h.family = familyOver(async () => {
      opens += 1;
      return deviceOver({
        frameIntervalMs: 5,
        video: { start, presentOverlay: async () => {}, stop: async () => {} },
      });
    });

    const videoFor = vi.fn(async () => clip);
    const manager = managerOver({ videoFor });

    await manager.start("strip");
    await pause(2 * SETTLE_MS);

    // Neither a new placement nor new bytes is "the same clip".
    clip = { bytes: Uint8Array.of(7), placement: { offsetX: 0.5, offsetY: 0 } };
    await manager.refreshVideo("strip");
    expect(opens).toBe(2);
    expect(start).toHaveBeenCalledTimes(2);

    clip = { bytes: Uint8Array.of(8), placement: { offsetX: 0.5, offsetY: 0 } };
    await manager.refreshVideo("strip");
    expect(opens).toBe(3);

    // The same clip on a turned glass is a different stream, so the runner
    // re-uploads it rather than keeping the upright copy playing.
    clip = {
      bytes: Uint8Array.of(8),
      placement: { offsetX: 0.5, offsetY: 0 },
      rotation: 90,
    };
    await manager.refreshVideo("strip");
    expect(opens).toBe(4);

    await manager.stop("strip");
  });

  it("restarts the runner when only the composition changed", async () => {
    let opens = 0;
    let clip: PanelVideoSource = {
      bytes: Uint8Array.of(7),
      placement: {
        offsetX: 0,
        offsetY: 0,
        region: { left: 0.35 },
        fill: { kind: "solid", color: "#101418" },
      },
    };
    const start = vi.fn(async () => {});
    h.family = familyOver(async () => {
      opens += 1;
      return deviceOver({
        frameIntervalMs: 5,
        video: { start, presentOverlay: async () => {}, stop: async () => {} },
      });
    });

    const manager = managerOver({ videoFor: async () => clip });

    await manager.start("strip");
    await pause(2 * SETTLE_MS);

    // The bytes and the pan are the same; only the region moved, and the clip
    // the device should play is now a different one.
    clip = {
      bytes: Uint8Array.of(7),
      placement: {
        offsetX: 0,
        offsetY: 0,
        region: { left: 0.5 },
        fill: { kind: "solid", color: "#101418" },
      },
    };
    await manager.refreshVideo("strip");
    expect(opens).toBe(2);
    expect(start).toHaveBeenCalledTimes(2);

    await manager.stop("strip");
  });

  it("does nothing for a display with no runner", async () => {
    const videoFor = vi.fn(async () => SOURCE);
    const manager = managerOver({ videoFor });

    await expect(manager.refreshVideo("strip")).resolves.toBeUndefined();
    expect(videoFor).not.toHaveBeenCalled();
  });
});
