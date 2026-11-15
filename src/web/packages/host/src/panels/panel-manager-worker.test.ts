import { describe, expect, it, vi } from "vitest";
import type { PanelFamily } from "./panel-device.js";
import { PanelFamilyRegistry } from "./panel-families.js";
import {
  deviceOver,
  familyOver,
  managerOver,
  PRODUCT_ID,
  until,
  VENDOR_ID,
} from "./panel-manager.fixtures.js";
import type { Rasterizer } from "./panel-raster.js";
import type {
  PanelWorkerOptions,
  PanelWorkerPage,
} from "./panel-worker-client.js";

vi.mock("../serve/display-launcher.js", () => ({
  findBrowser: () => "C:/fake/chrome.exe",
}));

/**
 * A built-in panel is opened on a thread of its own: the manager must never
 * call the family's in-process `open`, must drive the device and the page it
 * is handed, and must give both back on stop.
 */
describe("createPanelManager with a built-in panel", () => {
  it("opens the device on its thread and gives the page back on stop", async () => {
    const events: string[] = [];
    const present = vi.fn(async () => {});
    const inProcess = vi.fn(async () => {
      throw new Error("the manager opened the family in-process");
    });
    const family: PanelFamily = familyOver(inProcess);

    const device = deviceOver({ events, present, frameIntervalMs: 110 });

    let seen: PanelWorkerOptions | undefined;
    const attach = vi.fn(async (page: PanelWorkerPage): Promise<Rasterizer> => {
      events.push(`attach:${page.url}`);
      return {
        capture: async () => Uint8Array.of(1, 2, 3),
        captureOverlay: async () => Uint8Array.of(4),
        close: async () => {
          events.push("raster:close");
          await page.closePage();
        },
      };
    });

    const manager = managerOver(
      {
        rasterizer: () => ({
          capture: async () => new Uint8Array([0]),
          captureOverlay: async () => new Uint8Array([0]),
          close: async () => {},
        }),
        browsers: [],
        events,
      },
      {
        families: new PanelFamilyRegistry([family]),
        panelWorkerFactory: async (options) => {
          seen = options;
          return { device, attach };
        },
      },
    );

    await manager.start("strip");
    await until(() => present.mock.calls.length > 0);

    expect(inProcess).not.toHaveBeenCalled();
    expect(seen).toEqual({
      vendorId: VENDOR_ID,
      productId: PRODUCT_ID,
      open: {
        device: {
          vendorId: VENDOR_ID,
          productId: PRODUCT_ID,
          model: "fake",
        },
      },
    });
    expect(attach).toHaveBeenCalledTimes(1);
    expect(events).toContain("attach:http://127.0.0.1:1/?display=strip");
    expect(present).toHaveBeenCalled();
    expect(manager.running()).toEqual(["strip"]);

    await manager.stop("strip");

    expect(events).toContain("raster:close");
    expect(events).toContain("page:release");
    expect(events).toContain("close:device");
  });

  it("keeps a thread-unsafe driver on the host's loop", async () => {
    const events: string[] = [];
    const present = vi.fn(async () => {});
    const device = deviceOver({ events, present });
    const inProcess = vi.fn(async () => device);
    const family: PanelFamily = {
      ...familyOver(inProcess),
      threadSafe: false,
    };

    const workerFactory = vi.fn(async () => {
      throw new Error("the manager opened a thread-unsafe driver on a thread");
    });

    const manager = managerOver(
      {
        rasterizer: () => ({
          capture: async () => new Uint8Array([0]),
          captureOverlay: async () => new Uint8Array([0]),
          close: async () => {},
        }),
        browsers: [],
        events,
      },
      {
        families: new PanelFamilyRegistry([family]),
        panelWorkerFactory: workerFactory,
      },
    );

    await manager.start("strip");
    await until(() => present.mock.calls.length > 0);

    expect(workerFactory).not.toHaveBeenCalled();
    expect(inProcess).toHaveBeenCalledTimes(1);
    expect(manager.running()).toEqual(["strip"]);

    await manager.stop("strip");

    expect(events).toContain("close:device");
  });
});
