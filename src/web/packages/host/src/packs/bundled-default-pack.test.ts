import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readWidgetPackage } from "@yunari/theme-package";
import { describe, expect, it } from "vitest";
import { defaultWidgetPackBytes } from "./bundled-default-pack.js";
import { createWidgetPackStore } from "./widget-packs.js";

describe("the bundled default widget pack", () => {
  const unitIds = [
    "group-time-card",
    "group-cpu-card",
    "group-gpu-card",
    "group-ram-card",
    "group-vram-card",
    "group-trends-card",
    "group-storage-card",
    "group-network-card",
  ];

  it("reads back as the eight starter card units", () => {
    const read = readWidgetPackage(defaultWidgetPackBytes());
    if (!read.ok) throw new Error(read.message);

    expect(read.document.id).toBe("yunari-default-widgets");
    expect(read.units.map((unit) => unit.id)).toEqual(unitIds);
  });

  it("is listed by the store without writing anything to disk", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "yunari-default-pack-"),
    );
    try {
      const store = createWidgetPackStore(directory, {
        bundled: [defaultWidgetPackBytes()],
      });

      const packs = await store.list();
      expect(packs.map((pack) => pack.id)).toEqual(["yunari-default-widgets"]);
      expect(packs[0]?.units.map((unit) => unit.id)).toEqual(unitIds);
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
