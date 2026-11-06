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

  it("refuses a Windows device name as an id", () => {
    for (const id of ["con", "prn", "aux", "nul", "com1", "lpt9"]) {
      expect(readPluginManifest({ ...validManifest(), id })).toEqual({
        ok: false,
        reason: `Plugin id ${JSON.stringify(id)} is a reserved device name.`,
      });
    }
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
              commands: ["hello"],
              transports: ["usb"],
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

  it("reads the declared network hosts", () => {
    const manifest = {
      ...validManifest(),
      networkHosts: ["api.acme.test", "10.0.0.7"],
    };
    expect(readPluginManifest(manifest)).toEqual({ ok: true, manifest });
  });

  it("refuses a network host with a scheme or path", () => {
    expect(
      readPluginManifest({
        ...validManifest(),
        networkHosts: ["https://api.acme.test/v1"],
      }),
    ).toEqual({
      ok: false,
      reason:
        'The network host "https://api.acme.test/v1" must be a bare DNS name.',
    });
  });

  it("refuses an uppercase, wildcard, port or trailing-dot host", () => {
    for (const host of [
      "API.acme.test",
      "*.acme.test",
      "api.acme.test:443",
      "api.acme.test.",
    ]) {
      expect(
        readPluginManifest({ ...validManifest(), networkHosts: [host] }),
      ).toEqual({
        ok: false,
        reason: `The network host ${JSON.stringify(host)} must be a bare DNS name.`,
      });
    }
  });

  it("refuses a host longer than 63 characters", () => {
    const host = `${"a".repeat(63)}.test`;
    expect(
      readPluginManifest({ ...validManifest(), networkHosts: [host] }),
    ).toEqual({
      ok: false,
      reason: `The network host ${JSON.stringify(host)} must be a bare DNS name.`,
    });
  });

  it("refuses more than 16 network hosts", () => {
    expect(
      readPluginManifest({
        ...validManifest(),
        networkHosts: Array.from(
          { length: 17 },
          (_, index) => `h${index}.test`,
        ),
      }),
    ).toEqual({
      ok: false,
      reason: "A plugin declares at most 16 network hosts.",
    });
  });

  it("refuses a duplicate network host", () => {
    expect(
      readPluginManifest({
        ...validManifest(),
        networkHosts: ["api.acme.test", "api.acme.test"],
      }),
    ).toEqual({
      ok: false,
      reason: 'Network host "api.acme.test" is listed twice.',
    });
  });

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

  it("requires transports on a panel family", () => {
    const { transports, ...rest } = PANEL_FAMILY;
    expect(transports).toEqual(["usb"]);
    expect(
      readPluginManifest({
        ...validManifest(),
        capabilities: ["panel:drive", "usb:device"],
        contributes: { panelFamilies: [rest] },
      }),
    ).toEqual({
      ok: false,
      reason: "contributes.panelFamilies[0].transports is required.",
    });
  });

  it("deduplicates renderModes", () => {
    const manifest = panelManifest({ renderModes: ["wave", "wave", "static"] });
    expect(readPluginManifest(manifest)).toEqual({
      ok: true,
      manifest: {
        ...manifest,
        contributes: {
          panelFamilies: [{ ...PANEL_FAMILY, renderModes: ["wave", "static"] }],
        },
      },
    });
  });

  it("admits nine identical renderModes as one", () => {
    const manifest = panelManifest({
      renderModes: Array.from({ length: 9 }, () => "wave"),
    });
    expect(readPluginManifest(manifest)).toEqual({
      ok: true,
      manifest: {
        ...manifest,
        contributes: {
          panelFamilies: [{ ...PANEL_FAMILY, renderModes: ["wave"] }],
        },
      },
    });
  });

  it("refuses more than 8 renderModes", () => {
    expect(
      readPluginManifest(
        panelManifest({
          renderModes: Array.from({ length: 9 }, (_, index) => `mode-${index}`),
        }),
      ),
    ).toEqual({
      ok: false,
      reason:
        "contributes.panelFamilies[0].renderModes carries at most 8 entries.",
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
              commands: ["hello"],
              transports: ["usb"],
            },
          ],
        },
      }),
    ).toEqual({
      ok: false,
      reason:
        "contributes.panelFamilies[0].geometry.width must be a whole number between 1 and 16384.",
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

describe("settings pages", () => {
  function pageManifest(contributes: unknown, capabilities: string[]) {
    return readPluginManifest({
      ...validManifest(),
      capabilities,
      contributes,
    });
  }

  it("refuses a sandboxed page without ui:frame", () => {
    expect(
      pageManifest(
        {
          settingsPages: [
            { id: "acme", label: "Acme", ui: "settings/index.html" },
          ],
        },
        ["settings:own"],
      ),
    ).toEqual({
      ok: false,
      reason: 'The settings page "acme" requires the "ui:frame" capability.',
    });
  });

  it("reads a declarative page field set", () => {
    const fields = [
      { key: "apiKey", label: "API key", type: "secret" },
      { key: "refresh", label: "Refresh", type: "number", min: 1, max: 60 },
    ];
    const read = pageManifest(
      { settingsPages: [{ id: "acme", label: "Acme", fields }] },
      ["settings:own"],
    );
    expect(read.ok).toBe(true);
    if (read.ok)
      expect(read.manifest.contributes.settingsPages).toEqual([
        { id: "acme", label: "Acme", fields },
      ]);
  });

  it("refuses a page with neither fields nor ui", () => {
    expect(
      pageManifest({ settingsPages: [{ id: "acme", label: "Acme" }] }, [
        "settings:own",
      ]),
    ).toEqual({
      ok: false,
      reason: 'The settings page "acme" needs "fields" or "ui".',
    });
  });

  it("refuses a page with both fields and ui", () => {
    expect(
      pageManifest(
        {
          settingsPages: [
            {
              id: "acme",
              label: "Acme",
              fields: [{ key: "mode", label: "Mode", type: "text" }],
              ui: "settings/index.html",
            },
          ],
        },
        ["settings:own", "ui:frame"],
      ),
    ).toEqual({
      ok: false,
      reason: 'The settings page "acme" declares both "fields" and "ui".',
    });
  });

  it("refuses a duplicate field key within a page", () => {
    expect(
      pageManifest(
        {
          settingsPages: [
            {
              id: "acme",
              label: "Acme",
              fields: [
                { key: "mode", label: "Mode", type: "text" },
                { key: "mode", label: "Again", type: "boolean" },
              ],
            },
          ],
        },
        ["settings:own"],
      ),
    ).toEqual({
      ok: false,
      reason: 'The settings page "acme" declares the field "mode" twice.',
    });
  });

  it("refuses a select default outside its options", () => {
    expect(
      pageManifest(
        {
          settingsPages: [
            {
              id: "acme",
              label: "Acme",
              fields: [
                {
                  key: "mode",
                  label: "Mode",
                  type: "select",
                  options: [{ value: "a", label: "A" }],
                  default: "b",
                },
              ],
            },
          ],
        },
        ["settings:own"],
      ),
    ).toEqual({
      ok: false,
      reason: 'The field "mode" has a default that is not one of its options.',
    });
  });

  it("refuses an unknown field type", () => {
    expect(
      pageManifest(
        {
          settingsPages: [
            {
              id: "acme",
              label: "Acme",
              fields: [{ key: "mode", label: "Mode", type: "colour" }],
            },
          ],
        },
        ["settings:own"],
      ),
    ).toEqual({
      ok: false,
      reason: "contributes.settingsPages[0].fields[0].type is unknown.",
    });
  });

  it("refuses an inverted number range", () => {
    expect(
      pageManifest(
        {
          settingsPages: [
            {
              id: "acme",
              label: "Acme",
              fields: [
                { key: "n", label: "N", type: "number", min: 10, max: 1 },
              ],
            },
          ],
        },
        ["settings:own"],
      ),
    ).toEqual({
      ok: false,
      reason: 'The field "n" has a minimum above its maximum.',
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
