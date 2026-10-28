import { describe, expect, it, vi } from "vitest";
import type { DisplayRecord, DisplayStore } from "../settings/displays.js";
import type {
  PanelDevice,
  PanelFamily,
  PanelVideoSource,
} from "./panel-device.js";
import {
  createPanelManager,
  type PanelManagerOptions,
  PanelNotRunningError,
} from "./panel-manager.js";

/**
 * The manager's concurrency is the thing under test, so the hardware and the
 * browser are replaced at their seams: the family table is one fake, the
 * rasteriser is one fake, and every device is a log of what happened to it.
 */
const h = vi.hoisted(() => ({
  family: undefined as unknown,
  rasterizer: (): unknown => ({
    capture: async () => new Uint8Array([1]),
    captureOverlay: async () => new Uint8Array([2]),
    close: async () => {},
  }),
}));

vi.mock("./panel-families.js", () => ({ familyFor: () => h.family }));
vi.mock("./panel-raster.js", () => ({
  createRasterizer: async () => h.rasterizer(),
}));
vi.mock("../serve/display-launcher.js", () => ({
  findBrowser: () => "C:/fake/chrome.exe",
}));

const VENDOR_ID = 0x1cbe;
const PRODUCT_ID = 0xa092;

const RECORD: DisplayRecord = {
  id: "strip",
  label: "Strip",
  kind: "panel",
  createdAt: "2026-10-29T00:00:00.000Z",
  lastSeenAt: "2026-10-29T00:00:00.000Z",
  shape: "rect",
  panel: { vendorId: VENDOR_ID, productId: PRODUCT_ID, model: "fake" },
};

const store = {
  list: async () => [RECORD],
  find: async (id: string) => (id === RECORD.id ? RECORD : undefined),
} as unknown as DisplayStore;

interface DeviceOptions {
  readonly name?: string;
  readonly events?: string[];
  readonly present?: (frame: Uint8Array) => Promise<void>;
  readonly minimumIntervalMs?: number;
  readonly video?: PanelDevice["video"];
}

/** A device that logs its close, so order against opens is observable. */
function deviceOver(options: DeviceOptions = {}): PanelDevice {
  const name = options.name ?? "device";
  const events = options.events ?? [];

  return {
    geometry: { width: 4, height: 4 },
    open: async () => {},
    present: vi.fn(options.present ?? (async () => {})),
    close: vi.fn(async () => {
      events.push(`close:${name}`);
    }),
    ...(options.minimumIntervalMs === undefined
      ? {}
      : { minimumIntervalMs: options.minimumIntervalMs }),
    ...(options.video === undefined ? {} : { video: options.video }),
  };
}

function familyOver(open: () => Promise<PanelDevice>): PanelFamily {
  return {
    id: "fake",
    label: "Fake panel",
    vendorId: VENDOR_ID,
    productId: PRODUCT_ID,
    stores: false,
    support: {
      maker: "Fake",
      hardwareRevision: "1",
      supportedFirmware: [],
      updatedAt: "2026-10-29",
    },
    commands: [],
    attached: async () => [],
    open,
  };
}

function managerOver(
  overrides: Partial<PanelManagerOptions> = {},
): ReturnType<typeof createPanelManager> {
  return createPanelManager({
    displays: store,
    pageFor: (displayId) => `http://127.0.0.1:1/?display=${displayId}`,
    ...overrides,
  });
}

const SETTLE_MS = 20;

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const SOURCE: PanelVideoSource = {
  bytes: Uint8Array.of(7),
  placement: { offsetX: 0, offsetY: 0 },
};

describe("createPanelManager", () => {
  it("serializes two refreshes: one device open at a time, last entry survives", async () => {
    const events: string[] = [];
    const devices: PanelDevice[] = [];
    let opening = 0;
    let peak = 0;

    h.family = familyOver(async () => {
      opening += 1;
      peak = Math.max(peak, opening);

      const name = `d${devices.length + 1}`;
      events.push(`open:${name}`);
      // Held open across a turn so an unserialised second open would overlap.
      await pause(5);
      opening -= 1;

      const device = deviceOver({ name, events });
      devices.push(device);
      return device;
    });

    const manager = managerOver();
    await Promise.all([manager.refresh("strip"), manager.refresh("strip")]);

    // The close that releases d1's port finished before d2 opened.
    expect(peak).toBe(1);
    expect(events).toEqual(["open:d1", "close:d1", "open:d2"]);
    expect(manager.running()).toEqual(["strip"]);

    await manager.stop("strip");

    expect(events).toEqual(["open:d1", "close:d1", "open:d2", "close:d2"]);
    expect(devices[0]?.close).toHaveBeenCalledTimes(1);
    expect(devices[1]?.close).toHaveBeenCalledTimes(1);
  });

  it("stops a start that is still opening, leaving no timer behind", async () => {
    const events: string[] = [];
    const present = vi.fn(async () => {});
    let release!: () => void;
    const opened = new Promise<void>((resolve) => {
      release = resolve;
    });

    let device: PanelDevice | undefined;
    h.family = familyOver(async () => {
      await opened;
      device = deviceOver({
        name: "d1",
        events,
        present,
        minimumIntervalMs: 5,
      });
      return device;
    });

    const manager = managerOver();
    const starting = manager.start("strip");
    await pause(SETTLE_MS);

    const stopping = manager.stop("strip");
    release();
    await Promise.all([starting, stopping]);

    expect(manager.running()).toEqual([]);
    expect(device?.close).toHaveBeenCalledTimes(1);

    // The interval belonged to the entry that stopped: nothing ticks after it.
    const presented = present.mock.calls.length;
    await pause(3 * SETTLE_MS);
    expect(present.mock.calls.length).toBe(presented);
  });

  it("stopAll waits for a start still opening and closes its device", async () => {
    let release!: () => void;
    const opened = new Promise<void>((resolve) => {
      release = resolve;
    });

    let device: PanelDevice | undefined;
    h.family = familyOver(async () => {
      await opened;
      device = deviceOver();
      return device;
    });

    const manager = managerOver();
    const starting = manager.start("strip");
    await pause(SETTLE_MS);

    let finished = false;
    const stopping = manager.stopAll().then(() => {
      finished = true;
    });

    await pause(SETTLE_MS);
    expect(finished).toBe(false);

    release();
    await Promise.all([starting, stopping]);

    expect(finished).toBe(true);
    expect(device?.close).toHaveBeenCalledTimes(1);
    expect(manager.running()).toEqual([]);
  });

  it("gives up on a close that never answers and reports the display", async () => {
    const errors: string[] = [];

    h.family = familyOver(async () => ({
      geometry: { width: 4, height: 4 },
      open: async () => {},
      present: vi.fn(async () => {}),
      // The wedge the bound exists for: a device that never calls back.
      close: () => new Promise<void>(() => {}),
    }));

    const manager = managerOver({
      shutdownGraceMs: 20,
      onError: (displayId, message) => errors.push(`${displayId}: ${message}`),
    });

    await manager.start("strip");

    const started = Date.now();
    await manager.stopAll();

    expect(Date.now() - started).toBeLessThan(1000);
    expect(errors).toEqual([
      "strip: Shutdown waited 0.02s for this panel's close and is closing anyway.",
    ]);
    expect(manager.running()).toEqual([]);
  });

  it("reads videoFor once per start, and undefined leaves stills", async () => {
    const present = vi.fn(async () => {});
    const presentOverlay = vi.fn(async () => {});
    const start = vi.fn(async () => {});

    h.family = familyOver(async () =>
      deviceOver({
        minimumIntervalMs: 5,
        present,
        video: { start, presentOverlay, stop: async () => {} },
      }),
    );

    const videoFor = vi.fn(async () => undefined);
    const manager = managerOver({ videoFor });

    await manager.start("strip");
    await pause(3 * SETTLE_MS);

    expect(videoFor).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
    expect(present.mock.calls.length).toBeGreaterThan(0);
    expect(presentOverlay).not.toHaveBeenCalled();

    // A restart is a fresh read: the theme may have changed.
    await manager.refresh("strip");
    await manager.stop("strip");

    expect(videoFor).toHaveBeenCalledTimes(2);
  });

  it("passes the clip to a runner that starts it", async () => {
    const start = vi.fn(async () => {});
    let frame = 0;
    const presentOverlay = vi.fn(async () => {});

    h.rasterizer = () => ({
      capture: async () => new Uint8Array([1]),
      captureOverlay: async () => Uint8Array.of(3, (frame += 1)),
      close: async () => {},
    });
    h.family = familyOver(async () =>
      deviceOver({
        minimumIntervalMs: 5,
        video: { start, presentOverlay, stop: async () => {} },
      }),
    );

    const videoFor = vi.fn(async () => SOURCE);
    const manager = managerOver({ videoFor });

    await manager.start("strip");
    await pause(3 * SETTLE_MS);

    // Several ticks, one upload.
    expect(videoFor).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
    expect(presentOverlay.mock.calls.length).toBeGreaterThan(1);

    await manager.stop("strip");
  });

  it("retries a failed close on the next stop, then removes the entry", async () => {
    let attempts = 0;
    const close = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("close failed");
    });
    const device: PanelDevice = {
      geometry: { width: 4, height: 4 },
      open: async () => {},
      present: vi.fn(async () => {}),
      close,
    };

    h.family = familyOver(async () => device);
    const manager = managerOver();

    await manager.start("strip");
    await pause(2 * SETTLE_MS);

    await expect(manager.stop("strip")).rejects.toThrow("close failed");
    // The entry survives the refusal: its port is still held.
    expect(manager.running()).toEqual(["strip"]);

    await manager.stop("strip");

    expect(close).toHaveBeenCalledTimes(2);
    expect(manager.running()).toEqual([]);
  });

  it("does not open again when a refresh's stop failed", async () => {
    const errors: string[] = [];
    let opens = 0;
    const close = vi.fn(async () => {
      throw new Error("the port would not close");
    });

    h.family = familyOver(async () => {
      opens += 1;
      return {
        geometry: { width: 4, height: 4 },
        open: async () => {},
        present: vi.fn(async () => {}),
        close,
      };
    });

    const manager = managerOver({
      onError: (_displayId, message) => errors.push(message),
    });

    await manager.start("strip");
    await pause(2 * SETTLE_MS);
    await manager.refresh("strip");

    // Opening on a port that is still held would land dark, so it is not
    // attempted; the panel stays where it was, and the refusal is reported.
    expect(opens).toBe(1);
    expect(errors).toEqual(["the port would not close"]);
    expect(manager.running()).toEqual(["strip"]);
  });

  it("refuses a command for a display with no running runner", async () => {
    h.family = familyOver(async () => deviceOver());
    const manager = managerOver();

    await expect(
      manager.command("strip", { kind: "status" }),
    ).rejects.toBeInstanceOf(PanelNotRunningError);
  });

  it("sends a command to the running device's controls", async () => {
    const run = vi.fn(async () => "needReSend:0|renderCnt:1");
    h.family = familyOver(async () => ({
      ...deviceOver(),
      controls: { commands: ["status"], run },
    }));

    const manager = managerOver();
    await manager.start("strip");

    await expect(manager.command("strip", { kind: "status" })).resolves.toBe(
      "needReSend:0|renderCnt:1",
    );
    expect(run).toHaveBeenCalledWith({ kind: "status" });

    await manager.stop("strip");
    // The entry is gone with the runner: the device is not driven any more.
    await expect(
      manager.command("strip", { kind: "status" }),
    ).rejects.toBeInstanceOf(PanelNotRunningError);
  });

  it("refuses a command when the entry's runner is no longer running", async () => {
    const run = vi.fn(async () => "needReSend:0|renderCnt:1");
    let closes = 0;
    const close = vi.fn(async () => {
      closes += 1;
      if (closes === 1) throw new Error("close failed");
    });

    h.family = familyOver(async () => ({
      ...deviceOver(),
      close,
      controls: { commands: ["status"], run },
    }));

    const manager = managerOver();
    await manager.start("strip");
    await pause(2 * SETTLE_MS);

    // A failed close leaves the entry holding a runner whose port is on its way
    // down; its `running` flag is already false.
    await expect(manager.stop("strip")).rejects.toThrow("close failed");
    await expect(
      manager.command("strip", { kind: "status" }),
    ).rejects.toBeInstanceOf(PanelNotRunningError);
    expect(run).not.toHaveBeenCalled();

    await manager.stop("strip");
  });

  it("leaves the next start its own entry after a failed one", async () => {
    const errors: string[] = [];
    let opens = 0;

    h.family = familyOver(async () => {
      opens += 1;
      if (opens === 1) throw new Error("no device");
      return deviceOver();
    });

    const manager = managerOver({
      onError: (_displayId, message) => errors.push(message),
    });

    await Promise.all([manager.start("strip"), manager.start("strip")]);

    expect(opens).toBe(2);
    expect(errors).toEqual(["no device"]);
    expect(manager.running()).toEqual(["strip"]);

    await manager.stop("strip");
  });
});
