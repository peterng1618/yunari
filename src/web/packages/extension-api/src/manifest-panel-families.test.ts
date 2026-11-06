import { describe, expect, it } from "vitest";
import { readPluginManifest } from "./manifest";

const PANEL_SUPPORT = {
  maker: "Acme",
  hardwareRevision: "rev-a",
  supportedFirmware: ["1.0.0"],
  updatedAt: "2026-11-06",
};

const PANEL_FAMILY = {
  id: "acme-panel",
  label: "Acme Panel",
  vendorId: 1,
  productId: 1,
  geometry: { width: 320, height: 320 },
  support: PANEL_SUPPORT,
  commands: ["hello"],
  transports: ["usb"] as const,
};

/** A panel manifest that passes admission, so one family change is the only
 *  difference under test. */
function panelManifest(
  family: Readonly<Record<string, unknown>> = {},
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    ...validManifest(),
    capabilities: ["panel:drive", "usb:device"],
    contributes: { panelFamilies: [{ ...PANEL_FAMILY, ...family }] },
    ...overrides,
  };
}

function validManifest(): Record<string, unknown> {
  return {
    manifestVersion: 1,
    id: "acme-sensors",
    name: "Acme Sensors",
    version: "1.2.0",
    description: "Reads Acme hardware.",
    engines: { yunari: ">=0.1.0" },
    pluginApi: 1,
    execution: "trusted-worker",
    capabilities: ["sensor:provide"],
    contributes: { sensorProviders: [{ id: "acme", label: "Acme" }] },
    main: "main.js",
  };
}

describe("panel family admission", () => {
  it("requires panel:drive for a panel family", () => {
    const manifest = panelManifest({}, { capabilities: ["usb:device"] });
    expect(readPluginManifest(manifest)).toEqual({
      ok: false,
      reason:
        'The panelFamilies contribution requires the "panel:drive" capability.',
    });
  });

  it("requires usb:device or serial:device for a panel family", () => {
    expect(
      readPluginManifest(panelManifest({}, { capabilities: ["panel:drive"] })),
    ).toEqual({
      ok: false,
      reason:
        'The panelFamilies contribution requires the "usb:device" or "serial:device" capability.',
    });
  });

  it("refuses a command outside the panel command union", () => {
    expect(
      readPluginManifest(panelManifest({ commands: ["hello", "dim"] })),
    ).toEqual({
      ok: false,
      reason:
        "contributes.panelFamilies[0].commands[1] is not a panel command.",
    });
  });

  it("refuses a serial transport without serial:device", () => {
    expect(
      readPluginManifest(
        panelManifest(
          { transports: ["serial"], serialPath: "COM3" },
          { capabilities: ["panel:drive"] },
        ),
      ),
    ).toEqual({
      ok: false,
      reason:
        'The panelFamilies contribution requires the "usb:device" or "serial:device" capability.',
    });
  });

  it("requires the capability of every declared transport", () => {
    expect(
      readPluginManifest(
        panelManifest(
          { transports: ["serial"], serialPath: "COM3" },
          { capabilities: ["panel:drive", "usb:device"] },
        ),
      ),
    ).toEqual({
      ok: false,
      reason:
        'The panelFamilies contribution requires the "serial:device" capability.',
    });
    expect(
      readPluginManifest(
        panelManifest({}, { capabilities: ["panel:drive", "serial:device"] }),
      ),
    ).toEqual({
      ok: false,
      reason:
        'The panelFamilies contribution requires the "usb:device" capability.',
    });
  });

  it("admits each transport with its own capability", () => {
    for (const family of [
      { transports: ["serial"], serialPath: "COM3" },
      { transports: ["hid"] },
      { transports: ["usb", "hid"] },
    ]) {
      const capabilities =
        family.transports[0] === "serial"
          ? ["panel:drive", "serial:device"]
          : ["panel:drive", "usb:device"];
      expect(
        readPluginManifest(panelManifest(family, { capabilities })).ok,
      ).toBe(true);
    }
  });

  it("requires serialPath for the serial transport", () => {
    expect(
      readPluginManifest(
        panelManifest(
          { transports: ["serial"] },
          { capabilities: ["panel:drive", "serial:device"] },
        ),
      ),
    ).toEqual({
      ok: false,
      reason:
        'contributes.panelFamilies[0].serialPath is required for the "serial" transport.',
    });
  });

  it("refuses serialPath without the serial transport", () => {
    expect(readPluginManifest(panelManifest({ serialPath: "COM3" }))).toEqual({
      ok: false,
      reason:
        'contributes.panelFamilies[0].serialPath requires the "serial" transport.',
    });
  });

  it("refuses a serial path that is not a COM port or absolute POSIX path", () => {
    for (const serialPath of [
      "C:\\dev\\panel",
      "COM",
      "dev/ttyUSB0",
      "/dev/../ttyUSB0",
    ]) {
      expect(
        readPluginManifest(
          panelManifest(
            { transports: ["serial"], serialPath },
            { capabilities: ["panel:drive", "serial:device"] },
          ),
        ),
      ).toEqual({
        ok: false,
        reason:
          "contributes.panelFamilies[0].serialPath must be a COM port or an absolute POSIX path.",
      });
    }
  });

  it("reads a COM port and an absolute POSIX serial path", () => {
    const paths = [
      ["COM3", "COM3"],
      ["com12", "COM12"],
      ["/dev/ttyUSB0", "/dev/ttyUSB0"],
    ] as const;
    for (const [declared, canonical] of paths) {
      const result = readPluginManifest(
        panelManifest(
          { transports: ["serial"], serialPath: declared },
          { capabilities: ["panel:drive", "serial:device"] },
        ),
      );
      expect(result.ok).toBe(true);
      if (result.ok)
        expect(result.manifest.contributes.panelFamilies?.[0]?.serialPath).toBe(
          canonical,
        );
    }
  });

  it("refuses an empty, duplicate or unknown transport", () => {
    expect(readPluginManifest(panelManifest({ transports: [] }))).toEqual({
      ok: false,
      reason:
        "contributes.panelFamilies[0].transports must declare at least one transport.",
    });
    expect(
      readPluginManifest(panelManifest({ transports: ["usb", "usb"] })),
    ).toEqual({
      ok: false,
      reason: 'contributes.panelFamilies[0].transports lists "usb" twice.',
    });
    expect(
      readPluginManifest(panelManifest({ transports: ["bluetooth"] })),
    ).toEqual({
      ok: false,
      reason:
        'contributes.panelFamilies[0].transports[0] must be "usb", "hid" or "serial".',
    });
  });

  it.each([
    ["a fractional", { width: 320.5, height: 320 }],
    ["a negative", { width: -1, height: 320 }],
    ["an unbounded", { width: 200_000, height: 320 }],
    ["a non-finite", { width: Number.POSITIVE_INFINITY, height: 320 }],
  ])("refuses %s geometry dimension", (_label, geometry) => {
    expect(readPluginManifest(panelManifest({ geometry }))).toEqual({
      ok: false,
      reason:
        "contributes.panelFamilies[0].geometry.width must be a whole number between 1 and 16384.",
    });
  });
});

describe("panel family interfaceNumber", () => {
  it("admits and keeps a declared interface", () => {
    const manifest = panelManifest({ interfaceNumber: 1 });
    expect(readPluginManifest(manifest)).toEqual({
      ok: true,
      manifest: {
        ...manifest,
        contributes: {
          panelFamilies: [{ ...PANEL_FAMILY, interfaceNumber: 1 }],
        },
      },
    });
  });

  it("refuses an interface outside one byte", () => {
    expect(readPluginManifest(panelManifest({ interfaceNumber: 256 }))).toEqual(
      {
        ok: false,
        reason:
          "contributes.panelFamilies[0].interfaceNumber must be a whole number between 0 and 255.",
      },
    );
  });

  it("refuses an interface on a serial-only family", () => {
    expect(
      readPluginManifest(
        panelManifest({
          transports: ["serial"],
          serialPath: "COM3",
          interfaceNumber: 0,
        }),
      ),
    ).toEqual({
      ok: false,
      reason:
        'contributes.panelFamilies[0].interfaceNumber requires the "usb" or "hid" transport.',
    });
  });
});
