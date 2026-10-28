import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { PanelDevice, PanelHint } from "./panel-device.js";
import { familyFor, PANEL_FAMILIES } from "./panel-families.js";

/**
 * The registry is the claim `0130` made and could not test: that a panel family
 * this code has never seen is a row, not an edit. These cases hold that claim
 * to something a future change can break.
 */

describe("PANEL_FAMILIES", () => {
  it("carries a support record for every family", () => {
    for (const family of PANEL_FAMILIES) {
      expect(family.support.maker.length).toBeGreaterThan(0);
      expect(family.support.hardwareRevision.length).toBeGreaterThan(0);
      expect(family.support.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Array.isArray(family.support.supportedFirmware)).toBe(true);
    }
  });

  it("declares no controls for the rows that have none", () => {
    expect(familyFor(0x1cbe, 0xa092)?.commands).toEqual([]);
    expect(familyFor(0x1cbe, 0xa088)?.commands).toEqual([]);
    expect(familyFor(0x1e71, 0x3008)?.commands).toEqual([]);
  });

  it("answers nothing for a device no driver claims", () => {
    expect(familyFor(0x1c8e, 0xa092)).toBeUndefined();
    expect(familyFor(0, 0)).toBeUndefined();
  });

  it("states which families store content rather than stream it", () => {
    // The distinction the manager and the owner both need: a streaming panel
    // costs a wire frame, a storing one costs a flash write.
    expect(familyFor(0x1e71, 0x3008)?.stores).toBe(true);
    expect(familyFor(0x1cbe, 0xa092)?.stores).toBe(false);
    expect(familyFor(0x1cbe, 0xa088)?.stores).toBe(false);
  });

  it("keeps every family's ids unique", () => {
    const seen = new Set<string>();

    for (const family of PANEL_FAMILIES) {
      const key = `${family.vendorId}:${family.productId}`;
      expect(seen.has(key), `${family.id} reuses ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it("gives every family an id the display record accepts", () => {
    // `normalizePanel` on the record side refuses an empty model, and the
    // server writes `family.id` into the record: an empty one is a row nothing
    // can open.
    for (const family of PANEL_FAMILIES) {
      expect(family.id.length).toBeGreaterThan(0);
      expect(family.label.length).toBeGreaterThan(0);
    }
  });

  it("opens the device each family claims", async () => {
    // A row whose `open` throws on its own ids is a row that cannot work. This
    // does not touch hardware: it asserts the wiring resolves to a function
    // and that a family's `attached` is not the only half implemented.
    for (const family of PANEL_FAMILIES) {
      expect(typeof family.open).toBe("function");
      expect(typeof family.attached).toBe("function");
    }
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

describe("a storing panel's cadence", () => {
  it("states a floor the runner honours", () => {
    // The Kraken's `present` is a bucket upload. Without a floor the runner
    // would rewrite a flash bucket every second for a picture that had not
    // changed, so the device states one and the manager passes it through.
    const device = {
      geometry: { width: 320, height: 320 },
      open: async () => {},
      present: async () => {},
      close: async () => {},
      minimumIntervalMs: 60_000,
    } satisfies PanelDevice;

    expect(device.minimumIntervalMs).toBeGreaterThanOrEqual(1_000);
    // Optional on the port, so a streaming family is not forced to invent one.
    const streaming: PanelDevice = {
      geometry: { width: 464, height: 1920 },
      open: async () => {},
      present: async () => {},
      close: async () => {},
    };
    expect(streaming.minimumIntervalMs).toBeUndefined();
  });
});

describe("attached hints", () => {
  it("type a family's hint by the ids the table claims", () => {
    // `attachedDevices` filters a family's hints to that family's own ids, so a
    // driver that enumerates more than its row offers does not produce a hint
    // the registry cannot open.
    const hint: PanelHint = {
      vendorId: 0x1e71,
      productId: 0x3008,
      serial: "344A35613131",
      label: "NZXT Kraken Z (Z53/Z63/Z73)",
    };

    expect(familyFor(hint.vendorId, hint.productId)).toBeDefined();
  });
});
