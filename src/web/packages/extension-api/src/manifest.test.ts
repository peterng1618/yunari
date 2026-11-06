import { describe, expect, it } from "vitest";
import {
  type PluginManifest,
  readPluginManifest,
  validateManifestExecution,
} from "./manifest";

function validManifest(): PluginManifest {
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

const PANEL_SUPPORT = {
  maker: "Acme",
  hardwareRevision: "rev-a",
  supportedFirmware: ["1.0.0"],
  updatedAt: "2026-11-06",
};

describe("readPluginManifest", () => {
  it("refuses an unknown capability", () => {
    expect(
      readPluginManifest({
        ...validManifest(),
        capabilities: ["process:spawn"],
      }),
    ).toEqual({
      ok: false,
      reason: 'Unknown capability "process:spawn".',
    });
  });

  it("refuses trusted-worker without main", () => {
    const { main, ...rest } = validManifest();
    expect(main).toBe("main.js");
    expect(readPluginManifest(rest)).toEqual({
      ok: false,
      reason: 'A trusted-worker plugin needs "main".',
    });
  });

  it("refuses an unknown manifest key", () => {
    expect(readPluginManifest({ ...validManifest(), extra: true })).toEqual({
      ok: false,
      reason: 'Unknown manifest key "extra".',
    });
  });

  it("refuses an unknown contributes key", () => {
    expect(
      readPluginManifest({ ...validManifest(), contributes: { widgets: [] } }),
    ).toEqual({
      ok: false,
      reason: 'contributes has unknown key "widgets".',
    });
  });

  it("refuses an unknown key inside a contribution", () => {
    expect(
      readPluginManifest({
        ...validManifest(),
        contributes: {
          sensorProviders: [{ id: "acme", label: "Acme", extra: true }],
        },
      }),
    ).toEqual({
      ok: false,
      reason: 'contributes.sensorProviders[0] has unknown key "extra".',
    });
  });

  it("refuses more than 32 capabilities", () => {
    expect(
      readPluginManifest({
        ...validManifest(),
        capabilities: Array.from({ length: 33 }, () => "sensor:provide"),
      }),
    ).toEqual({
      ok: false,
      reason: "A plugin declares at most 32 capabilities.",
    });
  });

  it("refuses a duplicate capability", () => {
    expect(
      readPluginManifest({
        ...validManifest(),
        capabilities: ["sensor:provide", "sensor:provide"],
      }),
    ).toEqual({
      ok: false,
      reason: 'Capability "sensor:provide" is listed twice.',
    });
  });

  it("refuses more than 64 entries in a contribution list", () => {
    expect(
      readPluginManifest({
        ...validManifest(),
        contributes: {
          sensorProviders: Array.from({ length: 65 }, (_, index) => ({
            id: `sensor-${index}`,
            label: "Sensor",
          })),
        },
      }),
    ).toEqual({
      ok: false,
      reason: "contributes.sensorProviders carries at most 64 entries.",
    });
  });

  it("refuses a negative vendor id", () => {
    expect(
      readPluginManifest({
        ...validManifest(),
        contributes: {
          panelFamilies: [
            {
              id: "acme-panel",
              label: "Acme Panel",
              vendorId: -1,
              productId: 1,
              geometry: { width: 320, height: 320 },
              support: PANEL_SUPPORT,
              commands: ["init"],
            },
          ],
        },
      }),
    ).toEqual({
      ok: false,
      reason:
        "contributes.panelFamilies[0].vendorId must be a non-negative integer.",
    });
  });

  it("refuses a non-positive geometry dimension", () => {
    expect(
      readPluginManifest({
        ...validManifest(),
        contributes: {
          panelFamilies: [
            {
              id: "acme-panel",
              label: "Acme Panel",
              vendorId: 1,
              productId: 1,
              geometry: { width: 0, height: 320 },
              support: PANEL_SUPPORT,
              commands: ["init"],
            },
          ],
        },
      }),
    ).toEqual({
      ok: false,
      reason:
        "contributes.panelFamilies[0].geometry.width must be a positive number.",
    });
  });
});

describe("validateManifestExecution", () => {
  it("refuses a lower profile than the contributions require", () => {
    const manifest: PluginManifest = {
      ...validManifest(),
      execution: "declarative",
      contributes: { sensorProviders: [{ id: "acme", label: "Acme" }] },
    };
    expect(validateManifestExecution(manifest)).toEqual({
      ok: false,
      reason:
        'The sensorProviders contribution requires "trusted-worker", but the manifest declares "declarative".',
    });
  });

  it("requires trusted-worker for a code asset source", () => {
    const manifest: PluginManifest = {
      ...validManifest(),
      execution: "declarative",
      capabilities: ["asset:provide"],
      contributes: { assetSources: [{ entry: "source.js" }] },
    };
    expect(validateManifestExecution(manifest)).toEqual({
      ok: false,
      reason:
        'The assetSources contribution requires "trusted-worker", but the manifest declares "declarative".',
    });
  });
});
