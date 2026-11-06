import { describe, expect, it } from "vitest";
import {
  type ExecutionProfile,
  type PluginManifest,
  readPluginManifest,
  requiredExecution,
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

const ASSET_CATEGORY = {
  id: "acme-cat",
  label: "Acme Cat",
  icon: "grid",
  resultKind: "thing",
  body: "grid",
} as const;

const PANEL_FAMILY = {
  id: "acme-panel",
  label: "Acme Panel",
  vendorId: 1,
  productId: 1,
  geometry: { width: 320, height: 320 },
  support: PANEL_SUPPORT,
  commands: ["init"],
};

/** A manifest whose own execution needs nothing, so a required profile can
 *  only come from the contributions under test. */
function declarativeManifest(): PluginManifest {
  return {
    manifestVersion: 1,
    id: "acme-descriptors",
    name: "Acme Descriptors",
    version: "1.0.0",
    description: "Declarative content.",
    engines: { yunari: ">=0.1.0" },
    pluginApi: 1,
    execution: "declarative",
    capabilities: ["asset:provide"],
    contributes: {},
  };
}

describe("readPluginManifest", () => {
  it("accepts a valid manifest without coercing absent optionals", () => {
    expect(readPluginManifest(validManifest())).toEqual({
      ok: true,
      manifest: validManifest(),
    });
  });

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

  it("refuses a vendor id outside the USB 16-bit range", () => {
    expect(
      readPluginManifest({
        ...validManifest(),
        contributes: {
          panelFamilies: [{ ...PANEL_FAMILY, vendorId: 65536 }],
        },
      }),
    ).toEqual({
      ok: false,
      reason:
        "contributes.panelFamilies[0].vendorId must be a 16-bit USB id (0-65535).",
    });
  });

  it("refuses a numeric prerelease identifier with a leading zero", () => {
    expect(
      readPluginManifest({ ...validManifest(), version: "1.0.0-01" }),
    ).toEqual({
      ok: false,
      reason: 'Plugin version must be semver "x.y.z".',
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

const ASSET_SOURCE_PROFILES = [
  ["a built-in body", { body: "grid" }, "declarative"],
  ["a custom body", { body: "custom-carousel" }, "sandboxed-ui"],
  ["a code entry", { entry: "source.js" }, "trusted-worker"],
] as const satisfies readonly (readonly [
  string,
  Readonly<Record<string, unknown>>,
  ExecutionProfile,
])[];

describe("requiredExecution", () => {
  for (const [label, source, expected] of ASSET_SOURCE_PROFILES) {
    it(`requires ${expected} for ${label}`, () => {
      const manifest: PluginManifest = {
        ...declarativeManifest(),
        contributes: { assetSources: [source] },
      };
      expect(requiredExecution(manifest)).toBe(expected);
    });
  }

  it("returns the highest profile for panelFamilies and assetCategories", () => {
    const manifest: PluginManifest = {
      ...declarativeManifest(),
      capabilities: ["asset:provide", "panel:drive"],
      contributes: {
        assetCategories: [ASSET_CATEGORY],
        panelFamilies: [PANEL_FAMILY],
      },
    };
    expect(requiredExecution(manifest)).toBe("trusted-worker");
  });

  it("returns the highest profile for assetCategories and a custom-body source", () => {
    const manifest: PluginManifest = {
      ...declarativeManifest(),
      contributes: {
        assetCategories: [ASSET_CATEGORY],
        assetSources: [{ body: "custom-carousel" }],
      },
    };
    expect(requiredExecution(manifest)).toBe("sandboxed-ui");
  });
});

describe("validateManifestExecution", () => {
  it("accepts a declared profile higher than the contributions require", () => {
    const manifest: PluginManifest = {
      ...declarativeManifest(),
      execution: "trusted-worker",
      contributes: { assetCategories: [ASSET_CATEGORY] },
    };
    expect(validateManifestExecution(manifest)).toEqual({ ok: true, manifest });
  });

  it("refuses a profile below a declarative contribution", () => {
    const manifest: PluginManifest = {
      ...declarativeManifest(),
      execution: "data",
      contributes: { assetCategories: [ASSET_CATEGORY] },
    };
    expect(validateManifestExecution(manifest)).toEqual({
      ok: false,
      reason:
        'The assetCategories contribution requires "declarative", but the manifest declares "data".',
    });
  });

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
