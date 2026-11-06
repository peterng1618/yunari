import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type WidgetDocument, writeWidgetPackage } from "@yunari/theme-package";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWidgetPackStore } from "./widget-packs.js";

const PACKAGE = "package.zip";

function widgetDocument(
  id = "pack-one",
  name = "Pack One",
  version = "1.0.0",
): WidgetDocument {
  return {
    schemaVersion: "2.0.0",
    fabricVersion: "7.4.0",
    id,
    metadata: { name, version, themeLanguage: "en" },
    scene: {
      version: "7.4.0",
      objects: [
        {
          type: "Group",
          id: "card",
          objects: [{ type: "Rect", id: "card-value" }],
          provenance: { widgetId: "card", widgetName: "Card" },
        },
      ],
    },
    bindings: { card: [{ id: "card-binding", semanticKey: "cpu.load" }] },
  };
}

function widgetPackageBytes(
  id = "pack-one",
  name = "Pack One",
  version = "1.0.0",
): Uint8Array {
  const written = writeWidgetPackage({
    document: widgetDocument(id, name, version),
    assets: {},
  });
  if (!written.ok) throw new Error(written.message);
  return written.bytes;
}

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "yunari-widget-packs-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("the widget pack store", () => {
  it("installs, lists, reads and removes a widget pack", async () => {
    const store = createWidgetPackStore(directory);
    const installed = await store.install(widgetPackageBytes());
    expect(installed.ok).toBe(true);
    if (!installed.ok) return;

    expect(installed.pack).toEqual({
      id: "pack-one",
      name: "Pack One",
      version: "1.0.0",
      units: [{ id: "card", label: "Card" }],
    });
    expect((await store.list()).map((pack) => pack.id)).toEqual(["pack-one"]);
    expect(await store.read("pack-one")).toEqual(widgetPackageBytes());

    await store.remove("pack-one");
    expect(await store.list()).toEqual([]);
    expect(await store.read("pack-one")).toBeUndefined();
  });

  it("refuses an invalid package without writing a directory", async () => {
    const store = createWidgetPackStore(directory);
    expect(await store.install(new Uint8Array([1, 2, 3]))).toMatchObject({
      ok: false,
    });
    expect(await readdir(directory).catch(() => [])).toEqual([]);
  });

  it("writes one package.zip per pack and no temporary directory", async () => {
    const store = createWidgetPackStore(directory);
    expect((await store.install(widgetPackageBytes())).ok).toBe(true);
    expect(await readdir(directory)).toEqual(["pack-one"]);
    expect(await readdir(path.join(directory, "pack-one"))).toEqual([PACKAGE]);
  });

  it("replaces an installed pack with the same id", async () => {
    const store = createWidgetPackStore(directory);
    expect(
      (await store.install(widgetPackageBytes("pack-one", "Old"))).ok,
    ).toBe(true);
    const replacement = widgetPackageBytes("pack-one", "New", "2.0.0");
    expect((await store.install(replacement)).ok).toBe(true);

    const listed = await store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: "pack-one", name: "New" });
    expect(await store.read("pack-one")).toEqual(replacement);
  });

  it("lists and reads bundled packs without writing them to disk", async () => {
    const bundled = widgetPackageBytes("bundled-one", "Bundled", "3.0.0");
    const store = createWidgetPackStore(directory, { bundled: [bundled] });

    expect((await store.list()).map((pack) => pack.id)).toEqual([
      "bundled-one",
    ]);
    expect(await store.read("bundled-one")).toEqual(bundled);
    expect(await readdir(directory).catch(() => [])).toEqual([]);

    // A bundled pack is not on disk, so removal is a no-op.
    await store.remove("bundled-one");
    expect(await store.read("bundled-one")).toEqual(bundled);
  });

  it("skips a stored pack whose bytes no longer validate", async () => {
    const store = createWidgetPackStore(directory);
    const target = path.join(directory, "pack-one");
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, PACKAGE), new Uint8Array([1, 2, 3]));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      expect(await store.list()).toEqual([]);
      expect(await store.read("pack-one")).toBeUndefined();
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  it("refuses a pack id that is not a plain path segment", async () => {
    const store = createWidgetPackStore(directory);
    await expect(store.read("../pack-one")).resolves.toBeUndefined();
    await expect(store.read("a/b")).resolves.toBeUndefined();
    await expect(store.read("")).resolves.toBeUndefined();
    await store.remove("../pack-one");
    expect(await readdir(directory)).toEqual([]);
  });
});
