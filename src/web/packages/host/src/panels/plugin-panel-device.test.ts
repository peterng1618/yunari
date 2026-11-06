import type { HostMethod, InstalledPlugin } from "@yunari/extension-api";
import { describe, expect, it, vi } from "vitest";
import type { DeviceBroker } from "../extensions/runtime/device-broker.js";
import type { PluginSupervisor } from "../extensions/runtime/supervisor.js";
import type { PanelFamilyContribution } from "./panel-families.js";
import { PluginPanelDevice } from "./plugin-panel-device.js";

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
    ...overrides,
  };
}

function deviceOf(
  supervisor: PluginSupervisor,
  broker: DeviceBroker,
  contribution = familyContribution(),
): PluginPanelDevice {
  return new PluginPanelDevice({
    plugin: PLUGIN,
    supervisor,
    broker,
    contribution,
  });
}

describe("PluginPanelDevice", () => {
  it("sends bytes and no device handle to the worker", async () => {
    const supervisor = fakeSupervisor();
    const device = deviceOf(supervisor, fakeBroker());

    await device.open();
    await device.present(new Uint8Array([1, 2, 3]));

    expect(supervisor.calls).toEqual([
      ["panel.open", { width: 480, height: 1920, renderMode: undefined }],
      ["panel.present", { format: "jpeg", bytes: new Uint8Array([1, 2, 3]) }],
    ]);
    expect(JSON.stringify(supervisor.calls)).not.toContain("token");
  });

  it("stops only this display when the worker dies", async () => {
    const supervisor = fakeSupervisor(() => {
      throw new Error("The plugin stopped answering.");
    });
    const broker = fakeBroker();
    const device = deviceOf(supervisor, broker);

    await expect(device.present(new Uint8Array([1]))).rejects.toThrow(
      "stopped answering",
    );
    expect(broker.closeAll).toHaveBeenCalledWith("acme/panel");
  });

  it("keeps the manifest's geometry over a disagreeing open result", async () => {
    const supervisor = fakeSupervisor(() => ({ width: 1, height: 2 }));
    const device = deviceOf(supervisor, fakeBroker());

    await device.open();

    expect(device.geometry).toEqual({ width: 480, height: 1920 });
  });

  it("reads the stated cadence and still format once", async () => {
    const supervisor = fakeSupervisor(() => ({
      frameIntervalMs: 140,
      stillFormat: "png",
      unknownField: "ignored",
    }));
    const device = deviceOf(supervisor, fakeBroker());

    await device.open();
    await device.present(new Uint8Array([4]));

    expect(device.frameIntervalMs).toBe(140);
    expect(device.stillFormat).toBe("png");
    expect(supervisor.calls[1]).toEqual([
      "panel.present",
      { format: "png", bytes: new Uint8Array([4]) },
    ]);
  });

  it("refuses a cadence that is not a positive finite number", async () => {
    const supervisor = fakeSupervisor(() => ({ frameIntervalMs: 0 }));
    const broker = fakeBroker();
    const device = deviceOf(supervisor, broker);

    await expect(device.open()).rejects.toThrow();
    expect(broker.closeAll).toHaveBeenCalledWith("acme/panel");
  });

  it("returns the device's own reply text from a command", async () => {
    const supervisor = fakeSupervisor((method) =>
      method === "panel.command" ? "OK" : undefined,
    );
    const device = deviceOf(
      supervisor,
      fakeBroker(),
      familyContribution({ commands: ["brightness"] }),
    );

    const reply = await device.controls?.run({
      kind: "brightness",
      level: 40,
    });

    expect(reply).toBe("OK");
    expect(supervisor.calls).toEqual([
      ["panel.command", { command: { kind: "brightness", level: 40 } }],
    ]);
  });

  it("answers an empty string when the reply is not text", async () => {
    const supervisor = fakeSupervisor(() => 42);
    const device = deviceOf(
      supervisor,
      fakeBroker(),
      familyContribution({ commands: ["status"] }),
    );

    expect(await device.controls?.run({ kind: "status" })).toBe("");
  });

  it("offers no controls when the contribution declares no commands", () => {
    expect(deviceOf(fakeSupervisor(), fakeBroker()).controls).toBeUndefined();
  });

  it("closes the worker's display before the broker's handles", async () => {
    const events: string[] = [];
    const supervisor = fakeSupervisor((method) => {
      events.push(method);
      return undefined;
    });
    const broker = fakeBroker({
      closeAll: vi.fn(async () => {
        events.push("closeAll");
      }),
    });
    const device = deviceOf(supervisor, broker);

    await device.open();
    await device.close();

    expect(events).toEqual(["panel.open", "panel.close", "closeAll"]);
    expect(broker.closeAll).toHaveBeenCalledWith("acme/panel");
  });
});
