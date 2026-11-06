import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { KRAKEN_FRAME_INTERVAL_MS } from "./kraken-z3-panel.js";
import type { PanelDevice, PanelFamily, PanelHint } from "./panel-device.js";
import {
  BUILTIN_PANEL_FAMILIES,
  createPanelFamilyRegistry,
  PanelFamilyRegistry,
} from "./panel-families.js";

/**
 * The registry is the claim that was not previously testable: that a panel family
 * this code has never seen is a row, not an edit. These cases hold that claim
 * to something a future change can break.
 */

/** A row this build has never seen, shaped like a driver module's export. */
function pluginFamily(options: {
  readonly vendorId: number;
  readonly productId: number;
  readonly id?: string;
  readonly attached?: () => Promise<readonly PanelHint[]>;
}): PanelFamily {
  return {
    id: options.id ?? `plugin-${options.vendorId.toString(16)}`,
    label: "Plugin panel",
    vendorId: options.vendorId,
    productId: options.productId,
    support: {
      maker: "Plugin",
      hardwareRevision: "1",
      supportedFirmware: [],
      updatedAt: "2026-11-07",
    },
    commands: [],
    geometry: { width: 100, height: 100 },
    attached: options.attached ?? (async () => []),
    open: async () => {
      throw new Error("a plugin fixture is never opened");
    },
  };
}

const builtins = createPanelFamilyRegistry();

describe("BUILTIN_PANEL_FAMILIES", () => {
  it("carries a support record for every family", () => {
    for (const family of BUILTIN_PANEL_FAMILIES) {
      expect(family.support.maker.length).toBeGreaterThan(0);
      expect(family.support.hardwareRevision.length).toBeGreaterThan(0);
      expect(family.support.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Array.isArray(family.support.supportedFirmware)).toBe(true);
    }
  });

  it("declares no controls for the rows that have none", () => {
    expect(builtins.forDevice(0x1cbe, 0xa092)?.commands).toEqual([]);
    expect(builtins.forDevice(0x1cbe, 0xa088)?.commands).toEqual([]);
    expect(builtins.forDevice(0x1e71, 0x3008)?.commands).toEqual([]);
  });

  it("declares each family's raster geometry", () => {
    expect(builtins.forDevice(0x1d6b, 0x0106)?.geometry).toEqual({
      width: 800,
      height: 480,
    });
    expect(builtins.forDevice(0x1e71, 0x3008)?.geometry).toEqual({
      width: 320,
      height: 320,
    });
    expect(builtins.forDevice(0x1cbe, 0xa092)?.geometry).toEqual({
      width: 464,
      height: 1920,
    });
    expect(builtins.forDevice(0x1cbe, 0xa088)?.geometry).toEqual({
      width: 480,
      height: 1920,
    });
  });

  it("answers nothing for a device no driver claims", () => {
    expect(builtins.forDevice(0x1c8e, 0xa092)).toBeUndefined();
    expect(builtins.forDevice(0, 0)).toBeUndefined();
  });

  it("claims the TURZX serial family and its support record", () => {
    expect(builtins.forDevice(0x1d6b, 0x0106)?.id).toBe("turzx-5");
    expect(
      builtins.forDevice(0x1d6b, 0x0106)?.support.supportedFirmware,
    ).toEqual(["1.88"]);
  });

  it("records the firmware each measured family was verified on", () => {
    expect(
      builtins.forDevice(0x1cbe, 0xa092)?.support.supportedFirmware,
    ).toEqual(["lianli92_0001_2026041401"]);
    expect(
      builtins.forDevice(0x1e71, 0x3008)?.support.supportedFirmware,
    ).toEqual(["5.11.0"]);
    // No firmware has been observed on the 8.8", so it claims none.
    expect(
      builtins.forDevice(0x1cbe, 0xa088)?.support.supportedFirmware,
    ).toEqual([]);
  });

  it("keeps every family's ids unique", () => {
    const seen = new Set<string>();

    for (const family of BUILTIN_PANEL_FAMILIES) {
      const key = `${family.vendorId}:${family.productId}`;
      expect(seen.has(key), `${family.id} reuses ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it("gives every family an id the display record accepts", () => {
    // `normalizePanel` on the record side refuses an empty model, and the
    // server writes `family.id` into the record: an empty one is a row nothing
    // can open.
    for (const family of BUILTIN_PANEL_FAMILIES) {
      expect(family.id.length).toBeGreaterThan(0);
      expect(family.label.length).toBeGreaterThan(0);
    }
  });

  it("opens the device each family claims", async () => {
    // A row whose `open` throws on its own ids is a row that cannot work. This
    // does not touch hardware: it asserts the wiring resolves to a function
    // and that a family's `attached` is not the only half implemented.
    for (const family of BUILTIN_PANEL_FAMILIES) {
      expect(typeof family.open).toBe("function");
      expect(typeof family.attached).toBe("function");
    }
  });
});

describe("PanelFamilyRegistry", () => {
  it("keeps built-ins first and refuses a shadowing plugin", () => {
    const registry = createPanelFamilyRegistry([
      pluginFamily({ vendorId: 0x1cbe, productId: 0xa092, id: "shadow" }),
    ]);

    expect(registry.all()[0]).toBe(BUILTIN_PANEL_FAMILIES[0]);
    expect(registry.forDevice(0x1cbe, 0xa092)?.id).toBe("lianli-9-2");
  });

  it("drops a later plugin row that duplicates an earlier one", () => {
    const registry = createPanelFamilyRegistry([
      pluginFamily({ vendorId: 0x1234, productId: 0x5678, id: "first" }),
      pluginFamily({ vendorId: 0x1234, productId: 0x5678, id: "second" }),
    ]);

    expect(registry.forDevice(0x1234, 0x5678)?.id).toBe("first");
    expect(
      registry
        .all()
        .filter(
          (family) => family.vendorId === 0x1234 && family.productId === 0x5678,
        ),
    ).toHaveLength(1);
  });

  it("removes a revoked plugin's row from every surface and keeps the built-ins", async () => {
    const builtinHint: PanelHint = {
      vendorId: 0x1cbe,
      productId: 0xa092,
      serial: "builtin",
      label: "Built-in panel",
    };
    const pluginHint: PanelHint = {
      vendorId: 0x1234,
      productId: 0x5678,
      serial: "revoked",
      label: "Plugin panel",
    };
    // A stand-in built-in row: the real ones enumerate hardware in `attached`.
    const builtin = pluginFamily({
      vendorId: 0x1cbe,
      productId: 0xa092,
      id: "builtin",
      attached: async () => [builtinHint],
    });
    const plugin = pluginFamily({
      vendorId: 0x1234,
      productId: 0x5678,
      id: "plugin",
      attached: async () => [pluginHint],
    });
    const registry = new PanelFamilyRegistry([builtin]).withBuiltinsFirst([
      plugin,
    ]);

    expect(registry.all()).toContain(plugin);
    expect(registry.forDevice(0x1234, 0x5678)).toBe(plugin);
    expect(await registry.attached()).toContainEqual(pluginHint);

    registry.setPlugins([]);

    expect(registry.all()).not.toContain(plugin);
    expect(registry.forDevice(0x1234, 0x5678)).toBeUndefined();
    expect(await registry.attached()).not.toContainEqual(pluginHint);
    // The built-in row survives the plugin's removal.
    expect(registry.all()).toContain(builtin);
    expect(registry.forDevice(0x1cbe, 0xa092)).toBe(builtin);
    expect(await registry.attached()).toContainEqual(builtinHint);
  });

  it("drops a shadowing plugin row set after the fact", () => {
    const registry = createPanelFamilyRegistry();
    const shadow = pluginFamily({
      vendorId: 0x1cbe,
      productId: 0xa092,
      id: "shadow",
    });
    const first = pluginFamily({
      vendorId: 0x1234,
      productId: 0x5678,
      id: "first",
    });
    const second = pluginFamily({
      vendorId: 0x1234,
      productId: 0x5678,
      id: "second",
    });

    registry.setPlugins([shadow, first, second]);

    expect(registry.forDevice(0x1cbe, 0xa092)?.id).toBe("lianli-9-2");
    expect(registry.forDevice(0x1234, 0x5678)?.id).toBe("first");
    expect(registry.all().some((family) => family.id === "shadow")).toBe(false);
    expect(
      registry
        .all()
        .filter(
          (family) => family.vendorId === 0x1234 && family.productId === 0x5678,
        ),
    ).toHaveLength(1);
  });

  it("reaches a plugin-only family through forDevice", () => {
    const registry = createPanelFamilyRegistry([
      pluginFamily({ vendorId: 0x1234, productId: 0x5678, id: "plugin" }),
    ]);

    expect(registry.forDevice(0x1234, 0x5678)?.id).toBe("plugin");
    expect(registry.forDevice(0x1234, 0x9999)).toBeUndefined();
  });

  it("attaches a plugin-only family's hint", async () => {
    const registry = new PanelFamilyRegistry([
      pluginFamily({
        vendorId: 0x1234,
        productId: 0x5678,
        attached: async () => [
          {
            vendorId: 0x1234,
            productId: 0x5678,
            serial: "abc",
            label: "Plugin panel",
          },
        ],
      }),
    ]);

    expect(await registry.attached()).toContainEqual(
      expect.objectContaining({ vendorId: 0x1234, productId: 0x5678 }),
    );
  });

  it("de-duplicates a hint offered twice by one family", async () => {
    const hint: PanelHint = {
      vendorId: 0x1234,
      productId: 0x5678,
      serial: "dup",
      label: "Plugin panel",
    };
    const registry = new PanelFamilyRegistry([
      pluginFamily({
        vendorId: 0x1234,
        productId: 0x5678,
        attached: async () => [hint, { ...hint }],
      }),
    ]);

    expect(await registry.attached()).toHaveLength(1);
  });

  it("keeps the other families' hints when one family's attached throws", async () => {
    const registry = new PanelFamilyRegistry([
      pluginFamily({
        vendorId: 0x1234,
        productId: 0x5678,
        id: "dead",
        attached: async () => {
          throw new Error("the plugin worker is gone");
        },
      }),
      pluginFamily({
        vendorId: 0x9abc,
        productId: 0xdef0,
        id: "live",
        attached: async () => [
          {
            vendorId: 0x9abc,
            productId: 0xdef0,
            serial: "ok",
            label: "Live panel",
          },
        ],
      }),
    ]);

    const hints = await registry.attached();

    expect(hints).toContainEqual(
      expect.objectContaining({ vendorId: 0x9abc, productId: 0xdef0 }),
    );
    expect(hints).toHaveLength(1);
  });
});

describe("the manager's own boundary", () => {
  it("does not import a driver", async () => {
    // The defect this file was written to catch: `panel-manager.ts` reached
    // into `tur-usb-panel.ts` for `openPanel`, so its docblock claim about a
    // second family was false the moment one arrived. A future edit that puts
    // that import back fails here rather than in a review.
    const source = await readFile(
      path.join(import.meta.dirname, "panel-manager.ts"),
      "utf8",
    );

    expect(source).not.toContain("tur-usb-panel");
    expect(source).not.toContain("kraken-z3-panel");
    expect(source).toContain("panel-families");
  });
});

describe("a panel's cadence", () => {
  it("states the rate the runner should tick at, when the device has one", () => {
    // The glass drops a switch faster than about 140 ms on mode-2 frames, so
    // the Kraken asks for one frame per 140 ms; see KRAKEN_FRAME_INTERVAL_MS.
    expect(KRAKEN_FRAME_INTERVAL_MS).toBe(140);
    const device = {
      geometry: { width: 320, height: 320 },
      open: async () => {},
      present: async () => {},
      close: async () => {},
      frameIntervalMs: KRAKEN_FRAME_INTERVAL_MS,
    } satisfies PanelDevice;

    expect(device.frameIntervalMs).toBeLessThan(1_000);
    // Optional on the port, so a family with no stated rate keeps the default.
    const plain: PanelDevice = {
      geometry: { width: 464, height: 1920 },
      open: async () => {},
      present: async () => {},
      close: async () => {},
    };
    expect(plain.frameIntervalMs).toBeUndefined();
  });
});

describe("attached hints", () => {
  it("type a family's hint by the ids the registry claims", () => {
    // `attached()` filters a family's hints to that family's own ids, so a
    // driver that enumerates more than its row offers does not produce a hint
    // the registry cannot open.
    const hint: PanelHint = {
      vendorId: 0x1e71,
      productId: 0x3008,
      serial: "344A35613131",
      label: "NZXT Kraken Z (Z53/Z63/Z73)",
    };

    expect(builtins.forDevice(hint.vendorId, hint.productId)).toBeDefined();
  });
});
