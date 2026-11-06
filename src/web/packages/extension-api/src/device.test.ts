import { describe, expect, it } from "vitest";
import {
  type DeviceAllowlist,
  deviceAllowlistOf,
  deviceIdentity,
} from "./device";
import type { PluginContributions, PluginManifest } from "./manifest";

type PanelFamily = NonNullable<PluginContributions["panelFamilies"]>[number];

function family(overrides: Partial<PanelFamily> = {}): PanelFamily {
  return {
    id: "acme-panel",
    label: "Acme Panel",
    vendorId: 0x1cbe,
    productId: 0xa092,
    geometry: { width: 320, height: 320 },
    support: {
      maker: "Acme",
      hardwareRevision: "rev-a",
      supportedFirmware: ["1.0.0"],
      updatedAt: "2026-11-06",
    },
    commands: ["hello"],
    transports: ["usb"],
    ...overrides,
  };
}

function manifestWithFamilies(
  families: readonly PanelFamily[],
): PluginManifest {
  return {
    manifestVersion: 1,
    id: "acme-panels",
    name: "Acme Panels",
    version: "1.0.0",
    description: "Drives Acme panels.",
    engines: { yunari: ">=0.1.0" },
    pluginApi: 1,
    execution: "trusted-worker",
    capabilities: ["panel:drive", "usb:device", "serial:device"],
    contributes: { panelFamilies: families },
    main: "main.js",
  };
}

describe("deviceIdentity", () => {
  it("prints a usb identity in lowercase four-digit hex", () => {
    expect(
      deviceIdentity({
        transport: "usb",
        vendorId: 0x1cbe,
        productId: 0xa092,
      }),
    ).toBe("usb:1cbe:a092");
  });

  it("pads a short hex id to four digits", () => {
    expect(
      deviceIdentity({ transport: "hid", vendorId: 0x8, productId: 0x1e71 }),
    ).toBe("hid:0008:1e71");
  });

  it("prints a serial identity as the declared path", () => {
    expect(
      deviceIdentity({
        transport: "serial",
        path: "COM3",
        vendorId: 0x1cbe,
        productId: 0xa092,
      }),
    ).toBe("serial:COM3");
  });

  it("canonicalises a COM port to uppercase in the identity", () => {
    expect(
      deviceIdentity({
        transport: "serial",
        path: "com3",
        vendorId: 0x1cbe,
        productId: 0xa092,
      }),
    ).toBe("serial:COM3");
  });
});

describe("deviceAllowlistOf", () => {
  it("builds stable device identities", () => {
    expect(
      deviceAllowlistOf(manifestWithFamilies([family()])).map(deviceIdentity),
    ).toEqual(["usb:1cbe:a092"]);
  });

  it("unions every family's transports", () => {
    const manifest = manifestWithFamilies([
      family(),
      family({
        id: "acme-hid",
        transports: ["hid"],
        vendorId: 0x1e71,
        productId: 0x3008,
      }),
      family({
        id: "acme-serial",
        transports: ["serial"],
        serialPath: "COM3",
      }),
    ]);
    expect(deviceAllowlistOf(manifest).map(deviceIdentity)).toEqual([
      "usb:1cbe:a092",
      "hid:1e71:3008",
      "serial:COM3",
    ]);
  });

  it("declares the vendor and product ids of a serial device", () => {
    const manifest = manifestWithFamilies([
      family({ transports: ["serial"], serialPath: "/dev/ttyUSB0" }),
    ]);
    expect(deviceAllowlistOf(manifest)).toEqual([
      {
        transport: "serial",
        path: "/dev/ttyUSB0",
        vendorId: 0x1cbe,
        productId: 0xa092,
      },
    ] satisfies readonly DeviceAllowlist[]);
  });

  it("collapses a duplicate device identity into one row", () => {
    const manifest = manifestWithFamilies([
      family(),
      family({ id: "acme-panel-two" }),
    ]);
    expect(deviceAllowlistOf(manifest).map(deviceIdentity)).toEqual([
      "usb:1cbe:a092",
    ]);
  });

  it("collapses a duplicate serial path into one row", () => {
    const manifest = manifestWithFamilies([
      family({ transports: ["serial"], serialPath: "COM3" }),
      family({
        id: "acme-serial-two",
        transports: ["serial"],
        serialPath: "COM3",
      }),
    ]);
    expect(deviceAllowlistOf(manifest).map(deviceIdentity)).toEqual([
      "serial:COM3",
    ]);
  });

  it("collapses one COM port declared in either case", () => {
    const manifest = manifestWithFamilies([
      family({ transports: ["serial"], serialPath: "COM3" }),
      family({
        id: "acme-serial-two",
        transports: ["serial"],
        serialPath: "com3",
      }),
    ]);
    expect(deviceAllowlistOf(manifest)).toEqual([
      {
        transport: "serial",
        path: "COM3",
        vendorId: 0x1cbe,
        productId: 0xa092,
      },
    ] satisfies readonly DeviceAllowlist[]);
  });

  it("returns no devices for a manifest without panel families", () => {
    const manifest = manifestWithFamilies([]);
    expect(deviceAllowlistOf(manifest)).toEqual([]);
  });
});
