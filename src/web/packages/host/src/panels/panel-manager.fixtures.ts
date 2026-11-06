import { vi } from "vitest";
import type { DisplayRecord, DisplayStore } from "../settings/displays.js";
import type {
  PanelDevice,
  PanelFamily,
  PanelVideoSource,
} from "./panel-device.js";
import { createPanelFamilyRegistry } from "./panel-families.js";
import {
  createPanelManager,
  type PanelManagerOptions,
} from "./panel-manager.js";
import type { Rasterizer } from "./panel-raster.js";
import type { RasterBrowser } from "./panel-raster-browser.js";

/** Shared fakes for the manager's tests; nothing here is production code. */

export const VENDOR_ID = 0x1cbe;
export const PRODUCT_ID = 0xa092;

export const RECORD: DisplayRecord = {
  id: "strip",
  label: "Strip",
  kind: "panel",
  createdAt: "2026-10-29T00:00:00.000Z",
  lastSeenAt: "2026-10-29T00:00:00.000Z",
  shape: "rect",
  panel: { vendorId: VENDOR_ID, productId: PRODUCT_ID, model: "fake" },
};

export const TOWER: DisplayRecord = {
  ...RECORD,
  id: "tower",
  label: "Tower",
};

export const SOURCE: PanelVideoSource = {
  bytes: Uint8Array.of(7),
  placement: { offsetX: 0, offsetY: 0 },
};

export const store = storeOver([RECORD]);

export function storeOver(records: readonly DisplayRecord[]): DisplayStore {
  return {
    list: async () => records,
    find: async (id: string) => records.find((record) => record.id === id),
  } as unknown as DisplayStore;
}

export interface DeviceOptions {
  readonly name?: string;
  readonly events?: string[];
  readonly present?: (frame: Uint8Array) => Promise<void>;
  readonly frameIntervalMs?: number;
  readonly video?: PanelDevice["video"];
}

/** A device that logs its close, so order against opens is observable. */
export function deviceOver(options: DeviceOptions = {}): PanelDevice {
  const name = options.name ?? "device";
  const events = options.events ?? [];

  return {
    geometry: { width: 4, height: 4 },
    open: async () => {},
    present: vi.fn(options.present ?? (async () => {})),
    close: vi.fn(async () => {
      events.push(`close:${name}`);
    }),
    ...(options.frameIntervalMs === undefined
      ? {}
      : { frameIntervalMs: options.frameIntervalMs }),
    ...(options.video === undefined ? {} : { video: options.video }),
  };
}

export function familyOver(open: PanelFamily["open"]): PanelFamily {
  return {
    id: "fake",
    label: "Fake panel",
    vendorId: VENDOR_ID,
    productId: PRODUCT_ID,
    support: {
      maker: "Fake",
      hardwareRevision: "1",
      supportedFirmware: [],
      updatedAt: "2026-10-29",
    },
    commands: [],
    geometry: { width: 464, height: 1920 },
    attached: async () => [],
    open,
  };
}

export interface ManagerHarness {
  rasterizer: () => unknown;
  browsers: unknown[];
  events: string[];
}

export type FakeBrowser = Omit<RasterBrowser, "closed"> & { closed: boolean };

export function fakeBrowser(
  events: string[],
  rasterizer: ManagerHarness["rasterizer"],
): FakeBrowser {
  const browser: FakeBrowser = {
    closed: false,
    create: vi.fn(async () => rasterizer() as Rasterizer),
    capturePage: vi.fn(async () => {
      const page = rasterizer() as Rasterizer;
      try {
        return await page.capture();
      } finally {
        await page.close();
      }
    }),
    stop: vi.fn(async () => {
      browser.closed = true;
      events.push("browser:stop");
    }),
  };

  return browser;
}

export function managerOver(
  harness: ManagerHarness,
  overrides: Partial<PanelManagerOptions> = {},
): ReturnType<typeof createPanelManager> {
  return createPanelManager({
    displays: store,
    families: createPanelFamilyRegistry(),
    pageFor: (displayId) => `http://127.0.0.1:1/?display=${displayId}`,
    pageForTheme: (themeId) => `http://127.0.0.1:1/?theme=${themeId}`,
    rasterBrowserFactory: () => {
      const browser = fakeBrowser(harness.events, harness.rasterizer);
      harness.browsers.push(browser);
      return browser;
    },
    ...overrides,
  });
}

export const SETTLE_MS = 20;

export const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for a condition the retry loop reaches on its own timer, so a case
 *  about reconnection does not guess how many passes it takes. */
export async function until(check: () => boolean, ms = 2_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check() && Date.now() < deadline) await pause(5);
}
