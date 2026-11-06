import type {
  DeviceAllowlist,
  HostMethod,
  InstalledPlugin,
} from "@yunari/extension-api";
import { describe, expect, it } from "vitest";
import {
  createDeviceBroker,
  type DeviceBackend,
  type DeviceBroker,
  type DeviceDescriptor,
  type DeviceHandle,
} from "../extensions/runtime/device-broker.js";
import type { PluginSupervisor } from "../extensions/runtime/supervisor.js";
import type { PanelFamilyContribution } from "./panel-families.js";
import { pluginPanelFamily } from "./plugin-panel-family.js";

/**
 * A plugin panel driven end to end through a fake backend.
 *
 * The worker half is simulated in-process: it calls the broker the way a real
 * worker would, so the only path from a plugin to a device is the one the host
 * mediates. No USB device is opened here.
 */

const FAKE_JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a]);

const VENDOR_ID = 0x1234;
const PRODUCT_ID = 0x5678;

const USB_ALLOWLIST: DeviceAllowlist = {
  transport: "usb",
  vendorId: VENDOR_ID,
  productId: PRODUCT_ID,
};

const DEVICE: DeviceDescriptor = {
  transport: "usb",
  vendorId: VENDOR_ID,
  productId: PRODUCT_ID,
  path: "1:2",
  serial: "serial-1",
  product: "Acme panel",
};

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

const CONTRIBUTION: PanelFamilyContribution = {
  id: "acme-panel",
  label: "Acme panel",
  vendorId: VENDOR_ID,
  productId: PRODUCT_ID,
  geometry: { width: 480, height: 1920 },
  support: {
    maker: "Acme",
    hardwareRevision: "1",
    supportedFirmware: ["1.0"],
    updatedAt: "2026-11-07",
  },
  commands: [],
};

interface Transfer {
  readonly endpoint: number;
  readonly bytes: Uint8Array;
}

interface FakeBackend extends DeviceBackend {
  readonly opened: DeviceDescriptor[];
  readonly transfers: Transfer[];
}

function fakeDeviceBackend(): FakeBackend {
  const opened: DeviceDescriptor[] = [];
  const transfers: Transfer[] = [];

  const handle: DeviceHandle = {
    open: () => Promise.resolve(),
    bulkTransferOut: (endpoint, bytes) => {
      transfers.push({ endpoint, bytes });
      return Promise.resolve();
    },
    controlTransferOut: () => Promise.resolve(),
    interruptTransferIn: () => Promise.resolve(new Uint8Array()),
    hidWrite: () => Promise.resolve(),
    hidRead: () => Promise.resolve(new Uint8Array()),
    serialWrite: () => Promise.resolve(),
    serialRead: () => Promise.resolve(new Uint8Array()),
    serialDrain: () => Promise.resolve(new Uint8Array()),
    close: () => Promise.resolve(),
  };

  return {
    opened,
    transfers,
    list: () => Promise.resolve([DEVICE]),
    open: (device) => {
      opened.push(device);
      return Promise.resolve(handle);
    },
  };
}

interface FakeSupervisor extends PluginSupervisor {
  /** The broker token the plugin side holds; never the host's handle. */
  readonly token: string | undefined;
  /** Every host request the plugin side answered. */
  readonly requests: {
    readonly method: HostMethod;
    readonly params: unknown;
  }[];
}

/** The plugin side of the protocol: it reaches the device only through the
 *  broker, and keeps the opaque token the broker returns. */
function fakeSupervisor(broker: DeviceBroker): FakeSupervisor {
  const requests: { method: HostMethod; params: unknown }[] = [];
  let token: string | undefined;

  return {
    get alive() {
      return true;
    },
    get token() {
      return token;
    },
    requests,
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(),
    request: async <T>(method: HostMethod, params: unknown): Promise<T> => {
      requests.push({ method, params });

      switch (method) {
        case "panel.open":
          token = await broker.open(PLUGIN.key, {
            transport: "usb",
            vendorId: VENDOR_ID,
            productId: PRODUCT_ID,
          });
          return {} as unknown as T;
        case "panel.present": {
          const present = params as { readonly bytes: Uint8Array };
          await broker.call(PLUGIN.key, token as string, "usb.bulkTransfer", {
            endpoint: 0x02,
            bytes: present.bytes,
          });
          return undefined as unknown as T;
        }
        case "panel.close":
          if (token !== undefined) await broker.close(PLUGIN.key, token);
          token = undefined;
          return undefined as unknown as T;
        case "panel.attached":
          return [] as unknown as T;
        default:
          throw new Error(`unexpected host request: ${method}`);
      }
    },
  };
}

describe("fake plugin panel family", () => {
  it("drives a fake device only through host-mediated transfers", async () => {
    const backend = fakeDeviceBackend();
    const broker = createDeviceBroker({
      allowlists: () => [USB_ALLOWLIST],
      backend,
    });
    const supervisor = fakeSupervisor(broker);
    const pluginFamily = pluginPanelFamily({
      plugin: PLUGIN,
      contribution: CONTRIBUTION,
      supervisor,
      broker,
    });

    const device = await pluginFamily.open();
    await device.present(FAKE_JPEG);

    expect(backend.opened).toEqual([DEVICE]);
    expect(backend.transfers).toHaveLength(1);
    expect(backend.transfers[0]?.endpoint).toBe(0x02);
    expect(backend.transfers[0]?.bytes).toEqual(FAKE_JPEG);
    expect(pluginFamily.geometry).toEqual({ width: 480, height: 1920 });

    // The host sends the plugin a real raster and nothing else: no handle and
    // no host object travels over the worker boundary.
    const present = supervisor.requests.find(
      (request) => request.method === "panel.present",
    );
    if (present === undefined) throw new Error("no panel.present request");
    const params = present.params as {
      readonly format: string;
      readonly bytes: unknown;
    };
    expect(params.format).toBe("jpeg");
    expect(params.bytes).toBeInstanceOf(Uint8Array);
    expect(params.bytes).toEqual(FAKE_JPEG);

    for (const request of supervisor.requests) {
      expect(() => structuredClone(request.params)).not.toThrow();
    }

    // The plugin's side holds the broker's opaque token, not a device handle.
    expect(typeof supervisor.token).toBe("string");
    expect(supervisor.token).not.toBe("");
    expect(supervisor.token).not.toBe(backend.opened[0]);

    await device.close();
  });

  it("refuses an undeclared device before the backend opens it", async () => {
    const backend = fakeDeviceBackend();
    const broker = createDeviceBroker({
      allowlists: () => [USB_ALLOWLIST],
      backend,
    });

    await expect(
      broker.open(PLUGIN.key, {
        transport: "usb",
        vendorId: 0x9999,
        productId: 0x0001,
      }),
    ).rejects.toThrow("not declared");

    expect(backend.opened).toEqual([]);
  });
});
