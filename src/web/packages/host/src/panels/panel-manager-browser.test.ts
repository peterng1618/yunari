import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  managerOver as createManagerOver,
  deviceOver,
  type FakeBrowser,
  familyOver,
  RECORD,
  storeOver,
  TOWER,
} from "./panel-manager.fixtures.js";
import type { PanelManagerOptions } from "./panel-manager.js";

/** The manager's ownership of the one shared runtime, apart from the runner
 *  lifecycle: two panels, one browser; shutdown order; a crash retaken. */

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

describe("panel manager browser ownership", () => {
  it("shares one browser across two panels", async () => {
    h.family = familyOver(async () => deviceOver());
    const manager = managerOver({ displays: storeOver([RECORD, TOWER]) });

    await Promise.all([manager.start("strip"), manager.start("tower")]);

    expect(h.browsers).toHaveLength(1);
    expect((h.browsers[0] as FakeBrowser).create).toHaveBeenCalledTimes(2);

    await manager.stopAll();
  });

  it("stops the browser after the runners on shutdown", async () => {
    h.family = familyOver(async () =>
      deviceOver({ name: "d1", events: h.events }),
    );
    const manager = managerOver();

    await manager.start("strip");
    await manager.stopAll();

    // The device was released before the shared runtime: a runner still
    // writing to a closed browser would fail its own close.
    expect(h.events.at(-1)).toBe("browser:stop");
    expect(h.events.indexOf("close:d1")).toBeGreaterThanOrEqual(0);
    expect(h.events.indexOf("close:d1")).toBeLessThan(
      h.events.indexOf("browser:stop"),
    );
  });

  it("replaces a closed browser on the next panel start", async () => {
    h.family = familyOver(async () => deviceOver());
    const manager = managerOver();

    await manager.start("strip");
    await manager.stop("strip");
    (h.browsers[0] as FakeBrowser).closed = true;

    await manager.start("strip");

    expect(h.browsers).toHaveLength(2);
    expect((h.browsers[1] as FakeBrowser).create).toHaveBeenCalledTimes(1);

    await manager.stopAll();
  });
});
