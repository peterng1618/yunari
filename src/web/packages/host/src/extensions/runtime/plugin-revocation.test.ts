import type { HostMethod } from "@yunari/extension-api";
import { describe, expect, it, type Mock, vi } from "vitest";
import type { PanelFamily } from "../../panels/panel-device.js";
import { PanelFamilyRegistry } from "../../panels/panel-families.js";
import { PluginPanelRows } from "../../panels/plugin-panel-rows.js";
import type { DeviceBackend } from "./device-broker.js";
import { createDeviceBroker } from "./device-broker.js";
import { revokePluginRuntime } from "./plugin-revocation.js";
import type { PluginSupervisor } from "./supervisor.js";

const PLUGIN_KEY = "acme/panel";
const VENDOR_ID = 0x1234;
const PRODUCT_ID = 0x5678;

function family(vendorId: number, productId: number, id: string): PanelFamily {
  return {
    id,
    label: id,
    vendorId,
    productId,
    support: {
      maker: "Acme",
      hardwareRevision: "1",
      supportedFirmware: ["1.0"],
      updatedAt: "2026-11-07",
    },
    commands: [],
    geometry: { width: 480, height: 1920 },
    attached: async () => [],
    open: async () => {
      throw new Error("not opened in this test");
    },
  };
}

function fakeSupervisor(): {
  readonly supervisor: PluginSupervisor;
  readonly stop: Mock;
} {
  const stop = vi.fn(async () => undefined);
  return {
    stop,
    supervisor: {
      get alive() {
        return true;
      },
      start: async () => undefined,
      stop,
      request: async <T>(_method: HostMethod): Promise<T> => undefined as T,
    },
  };
}

function fakeBackend(): DeviceBackend {
  return {
    list: async () => [
      {
        transport: "usb",
        vendorId: VENDOR_ID,
        productId: PRODUCT_ID,
        path: "1:2",
        serial: undefined,
        product: undefined,
      },
    ],
    open: async () => ({
      open: async () => undefined,
      bulkTransferOut: async () => undefined,
      controlTransferOut: async () => undefined,
      interruptTransferIn: async () => new Uint8Array(),
      hidWrite: async () => undefined,
      hidRead: async () => new Uint8Array(),
      serialWrite: async () => undefined,
      serialRead: async () => new Uint8Array(),
      serialDrain: async () => new Uint8Array(),
      close: vi.fn(async () => undefined),
    }),
  };
}

/**
 * The same wiring `main.ts` runs: the live registry the server and the panel
 * manager share, the broker's allowlist map, the running supervisors and the
 * plugin rows. Revocation is the one path that removes all four.
 */
function mainWiring() {
  const builtin = family(0x1cbe, 0xa092, "builtin-panel");
  const registry = new PanelFamilyRegistry([builtin]);
  const rows = new PluginPanelRows(registry);
  rows.add({
    pluginKey: PLUGIN_KEY,
    family: family(VENDOR_ID, PRODUCT_ID, "acme-panel"),
  });

  const allowlists = new Map([
    [
      PLUGIN_KEY,
      [
        {
          transport: "usb" as const,
          vendorId: VENDOR_ID,
          productId: PRODUCT_ID,
        },
      ],
    ],
  ]);
  const broker = createDeviceBroker({
    allowlists: (key) => allowlists.get(key) ?? [],
    backend: fakeBackend(),
  });
  const { supervisor, stop } = fakeSupervisor();
  const supervisors = new Map([[PLUGIN_KEY, supervisor]]);

  return {
    builtin,
    registry,
    rows,
    allowlists,
    broker,
    stop,
    supervisors,
  };
}

describe("revokePluginRuntime", () => {
  it("removes a revoked plugin's family from the live registry", async () => {
    const wiring = mainWiring();
    expect(wiring.registry.forDevice(VENDOR_ID, PRODUCT_ID)).toBeDefined();

    await revokePluginRuntime({
      pluginKey: PLUGIN_KEY,
      supervisors: wiring.supervisors,
      allowlists: wiring.allowlists,
      panelRows: wiring.rows,
      broker: wiring.broker,
    });

    expect(wiring.registry.forDevice(VENDOR_ID, PRODUCT_ID)).toBeUndefined();
    expect(wiring.registry.forDevice(0x1cbe, 0xa092)).toBe(wiring.builtin);
    expect(wiring.rows.rows()).toEqual([]);
  });

  it("stops the worker, drops its allowlist and closes its devices", async () => {
    const wiring = mainWiring();
    const token = await wiring.broker.open(PLUGIN_KEY, {
      transport: "usb",
      vendorId: VENDOR_ID,
      productId: PRODUCT_ID,
    });

    await revokePluginRuntime({
      pluginKey: PLUGIN_KEY,
      supervisors: wiring.supervisors,
      allowlists: wiring.allowlists,
      panelRows: wiring.rows,
      broker: wiring.broker,
    });

    expect(wiring.stop).toHaveBeenCalledOnce();
    expect(wiring.supervisors.has(PLUGIN_KEY)).toBe(false);
    expect(wiring.allowlists.has(PLUGIN_KEY)).toBe(false);
    await expect(
      wiring.broker.call(PLUGIN_KEY, token, "usb.bulkTransfer", {
        endpoint: 1,
        bytes: new Uint8Array(),
      }),
    ).rejects.toThrow("not open");
    await expect(
      wiring.broker.open(PLUGIN_KEY, {
        transport: "usb",
        vendorId: VENDOR_ID,
        productId: PRODUCT_ID,
      }),
    ).rejects.toThrow("not declared");
  });

  it("removes the rows of a plugin that never started", async () => {
    const wiring = mainWiring();
    wiring.supervisors.delete(PLUGIN_KEY);

    await revokePluginRuntime({
      pluginKey: PLUGIN_KEY,
      supervisors: wiring.supervisors,
      allowlists: wiring.allowlists,
      panelRows: wiring.rows,
      broker: wiring.broker,
    });

    expect(wiring.registry.forDevice(VENDOR_ID, PRODUCT_ID)).toBeUndefined();
  });
});
