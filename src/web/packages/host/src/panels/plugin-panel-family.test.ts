import type { HostMethod, InstalledPlugin } from "@yunari/extension-api";
import { describe, expect, it, vi } from "vitest";
import type { DeviceBroker } from "../extensions/runtime/device-broker.js";
import type { PluginSupervisor } from "../extensions/runtime/supervisor.js";
import type { PanelFamilyContribution } from "./panel-families.js";
import { pluginPanelFamily } from "./plugin-panel-family.js";

const PLUGIN: InstalledPlugin = {
  key: "acme/panel",
  publisher: "acme",
  directory: "/plugins/acme/panel/1.0.0",
  contentHash: "a".repeat(64),
  manifest: {
    manifestVersion: 1,
    id: "panel",
    name: "Acme Panel",
    version: "1.0.0",
    description: "fixture",
    engines: { yunari: ">=0.1.0" },
    pluginApi: 1,
    execution: "trusted-worker",
    capabilities: ["panel:drive", "usb:device"],
    contributes: {},
    networkHosts: [],
  },
};

function familyContribution(
  patch: Partial<PanelFamilyContribution> = {},
): PanelFamilyContribution {
  return {
    id: "acme-panel",
    label: "Acme panel",
    vendorId: 0x1234,
    productId: 0x5678,
    geometry: { width: 480, height: 1920 },
    support: {
      maker: "Acme",
      hardwareRevision: "1",
      supportedFirmware: ["1.0"],
      updatedAt: "2026-11-07",
    },
    commands: [],
    ...patch,
  };
}

type Answer = (method: HostMethod, params: unknown) => unknown;
type FakeSupervisor = PluginSupervisor & {
  readonly calls: [HostMethod, unknown][];
};

function fakeSupervisor(answer: Answer = () => undefined): FakeSupervisor {
  const calls: [HostMethod, unknown][] = [];

  return {
    get alive() {
      return true;
    },
    calls,
    start: async () => undefined,
    stop: async () => undefined,
    request: async <T>(method: HostMethod, params: unknown): Promise<T> => {
      calls.push([method, params]);
      return (await answer(method, params)) as T;
    },
  };
}

function fakeBroker(overrides: Partial<DeviceBroker> = {}): DeviceBroker {
  return {
    list: vi.fn(async () => []),
    open: vi.fn(async () => "token"),
    call: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    closeAll: vi.fn(async () => undefined),
    closeScope: vi.fn(async () => undefined),
    ...overrides,
  };
}

function familyOf(
  supervisor: PluginSupervisor,
  broker: DeviceBroker,
  contribution = familyContribution(),
  cacheDir?: string,
) {
  return pluginPanelFamily({
    plugin: PLUGIN,
    contribution,
    supervisor,
    broker,
    cacheDir,
  });
}

describe("pluginPanelFamily", () => {
  it("declares the contribution's identity and hardware", () => {
    const family = familyOf(fakeSupervisor(), fakeBroker());

    expect(family.id).toBe("acme-panel");
    expect(family.label).toBe("Acme panel");
    expect(family.vendorId).toBe(0x1234);
    expect(family.productId).toBe(0x5678);
    expect(family.geometry).toEqual({ width: 480, height: 1920 });
    expect(family.support.maker).toBe("Acme");
  });

  it("refuses a zero or negative geometry at construction", () => {
    expect(() =>
      familyOf(
        fakeSupervisor(),
        fakeBroker(),
        familyContribution({ geometry: { width: 0, height: 1920 } }),
      ),
    ).toThrow();
    expect(() =>
      familyOf(
        fakeSupervisor(),
        fakeBroker(),
        familyContribution({ geometry: { width: 480, height: -1 } }),
      ),
    ).toThrow();
  });

  it("opens the contribution's geometry and the chosen render mode", async () => {
    const supervisor = fakeSupervisor();
    const family = familyOf(supervisor, fakeBroker());

    const device = await family.open({ renderMode: "mode-b" });

    expect(supervisor.calls).toEqual([
      ["panel.open", { width: 480, height: 1920, renderMode: "mode-b" }],
    ]);
    expect(device.geometry).toEqual({ width: 480, height: 1920 });
  });

  it("never hands the host's cache path to the worker", async () => {
    const supervisor = fakeSupervisor();
    const family = familyOf(
      supervisor,
      fakeBroker(),
      familyContribution(),
      "/host/cache",
    );

    await family.open();

    expect(JSON.stringify(supervisor.calls)).not.toContain("/host/cache");
  });

  it("closes a device whose open failed and rethrows", async () => {
    const supervisor = fakeSupervisor(() => {
      throw new Error("The plugin stopped answering.");
    });
    const broker = fakeBroker();
    const family = familyOf(supervisor, broker);

    await expect(family.open()).rejects.toThrow("stopped answering");
    expect(broker.closeScope).toHaveBeenCalledWith(
      "acme/panel",
      expect.any(String),
    );
  });

  it("attaches only the hints its own ids claim", async () => {
    const supervisor = fakeSupervisor(() => [
      { vendorId: 0x1234, productId: 0x5678, serial: "mine", label: "Acme" },
      { vendorId: 0x9999, productId: 0x0001, serial: "other", label: "Other" },
    ]);
    const family = familyOf(supervisor, fakeBroker());

    expect(await family.attached()).toEqual([
      { vendorId: 0x1234, productId: 0x5678, serial: "mine", label: "Acme" },
    ]);
    expect(supervisor.calls).toEqual([["panel.attached", {}]]);
  });

  it("falls back to the broker when the worker throws", async () => {
    const supervisor = fakeSupervisor(() => {
      throw new Error("The plugin stopped answering.");
    });
    const broker = fakeBroker({
      list: vi.fn(async () => [
        {
          transport: "usb" as const,
          vendorId: 0x1234,
          productId: 0x5678,
          path: "/dev/panel",
          serial: undefined,
          product: "Acme",
        },
        {
          transport: "usb" as const,
          vendorId: 0x9999,
          productId: 0x0001,
          path: "/dev/other",
          serial: "zz",
          product: undefined,
        },
      ]),
    });
    const family = familyOf(supervisor, broker);

    expect(await family.attached()).toEqual([
      {
        vendorId: 0x1234,
        productId: 0x5678,
        serial: "",
        label: "Acme panel",
      },
    ]);
  });

  it("falls back to the broker when the worker answers garbage", async () => {
    const supervisor = fakeSupervisor(() => "not a list");
    const broker = fakeBroker({
      list: vi.fn(async () => [
        {
          transport: "usb" as const,
          vendorId: 0x1234,
          productId: 0x5678,
          path: "/dev/panel",
          serial: "s",
          product: "Acme",
        },
      ]),
    });
    const family = familyOf(supervisor, broker);

    expect(await family.attached()).toEqual([
      { vendorId: 0x1234, productId: 0x5678, serial: "s", label: "Acme panel" },
    ]);
  });
});
