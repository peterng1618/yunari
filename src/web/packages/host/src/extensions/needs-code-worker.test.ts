import type { InstalledPlugin, PluginManifest } from "@yunari/extension-api";
import { describe, expect, it } from "vitest";
import { needsCodeWorker } from "./providers.js";

/** The predicate reads the manifest only, so the fixture states a manifest and
 *  nothing about a package on disk. */
function plugin(overrides: Partial<PluginManifest> = {}): InstalledPlugin {
  return {
    key: "local/acme-panel",
    publisher: "local",
    directory: "plugins/acme-panel",
    contentHash: "a".repeat(64),
    manifest: {
      manifestVersion: 1,
      id: "acme-panel",
      name: "Acme Panel",
      version: "1.0.0",
      description: "Drives a panel.",
      engines: { yunari: ">=0.1.0" },
      pluginApi: 1,
      execution: "trusted-worker",
      capabilities: [],
      contributes: {},
      main: "main.js",
      ...overrides,
    },
  };
}

describe("needsCodeWorker", () => {
  it("needs a worker for a plugin that contributes a panel family", () => {
    const panelPlugin = plugin({
      capabilities: ["panel:drive", "usb:device"],
      contributes: {
        panelFamilies: [
          {
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
            commands: ["brightness"],
            transports: ["usb"],
          },
        ],
      },
    });

    expect(needsCodeWorker(panelPlugin)).toBe(true);
  });

  it("does not need a worker for a plugin with no code contribution", () => {
    expect(needsCodeWorker(plugin())).toBe(false);
  });

  it("does not need a worker for an empty panel family list", () => {
    expect(
      needsCodeWorker(plugin({ contributes: { panelFamilies: [] } })),
    ).toBe(false);
  });
});
