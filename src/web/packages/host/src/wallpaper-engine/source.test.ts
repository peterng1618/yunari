import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WallpaperEngineInstall } from "./locate.js";
import { createWallpaperEngineSource } from "./source.js";

const encoder = new TextEncoder();

/** The same hand-built container `classify.test.ts` uses. */
function buildPackage(
  members: readonly (readonly [string, string])[],
): Uint8Array {
  const entries = members.map(
    ([name, body]) => [encoder.encode(name), encoder.encode(body)] as const,
  );
  const namesSize = entries.reduce(
    (total, [name]) => total + 4 + name.length + 8,
    0,
  );
  const dataSize = entries.reduce((total, [, data]) => total + data.length, 0);
  const dataStart = 16 + namesSize;
  const out = new Uint8Array(dataStart + dataSize);
  const view = new DataView(out.buffer);

  view.setUint32(0, 8, true);
  out.set(encoder.encode("PKGV0001"), 4);
  view.setUint32(12, entries.length, true);

  let cursor = 16;
  let offset = 0;
  for (const [name, data] of entries) {
    view.setUint32(cursor, name.length, true);
    cursor += 4;
    out.set(name, cursor);
    cursor += name.length;
    view.setUint32(cursor, offset, true);
    view.setUint32(cursor + 4, data.length, true);
    cursor += 8;
    offset += data.length;
  }

  let dataCursor = dataStart;
  for (const [, data] of entries) {
    out.set(data, dataCursor);
    dataCursor += data.length;
  }

  return out;
}

const stillScene = buildPackage([
  [
    "scene.json",
    JSON.stringify({
      objects: [{ image: "background.jpg" }, { text: "12:00" }],
    }),
  ],
]);

/**
 * A workshop library as it looks on disk: two scenes, a video, and one
 * directory whose descriptor does not parse. The second scene's package is cut
 * short, which is normal input — it is listed and simply not classified.
 */
describe("the Wallpaper Engine source", () => {
  let tmp: string;
  let library: string;
  let install: WallpaperEngineInstall;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-we-source-"));
    library = path.join(
      tmp,
      "library",
      "steamapps",
      "workshop",
      "content",
      "431960",
    );
    const root = path.join(tmp, "wallpaper_engine");
    install = {
      root,
      libraries: [library],
      myProjects: path.join(root, "projects", "myprojects"),
      editor: path.join(root, "bin", "wallpaperui.exe"),
    };
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  async function writeItem(
    id: string,
    name: string,
    body: string | Uint8Array,
  ) {
    const directory = path.join(library, id);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, name), body);
  }

  async function fixture(): Promise<void> {
    await writeItem(
      "201",
      "project.json",
      JSON.stringify({
        type: "scene",
        file: "scene.pkg",
        title: "Still Scene",
        preview: "preview.jpg",
      }),
    );
    await writeItem("201", "scene.pkg", stillScene);
    await writeItem("201", "preview.jpg", "jpeg");

    await writeItem(
      "202",
      "project.json",
      JSON.stringify({ type: "scene", file: "scene.pkg" }),
    );
    await writeItem("202", "scene.pkg", stillScene.subarray(0, 20));

    await writeItem(
      "203",
      "project.json",
      JSON.stringify({ type: "video", file: "clip.mp4" }),
    );
    await writeItem("203", "clip.mp4", "mp4");

    await writeItem("204", "project.json", "{ not json");
  }

  const locate = async (): Promise<WallpaperEngineInstall> => install;

  it("lists every wallpaper and classifies only the readable scene", async () => {
    await fixture();
    const source = createWallpaperEngineSource({ locate });

    const answer = await source.listing();
    if (!answer.available) throw new Error(answer.reason);

    expect(answer.install).toBe(install.root);
    expect(answer.skipped).toBe(1);
    expect(answer.items).toHaveLength(3);

    const byId = new Map(
      answer.items.map((item) => [item.workshopId, item] as const),
    );

    expect(byId.get("201")).toMatchObject({
      kind: "scene",
      previewUrl: "/api/wallpaper-engine/item/201/preview",
      stillAtRest: true,
      hasText: true,
    });
    // Cut short: listed as a scene, never guessed still.
    expect(byId.get("202")).toMatchObject({ kind: "scene" });
    expect(byId.get("202")).not.toHaveProperty("stillAtRest");
    expect(byId.get("202")).not.toHaveProperty("hasText");
    expect(byId.get("203")).toMatchObject({ kind: "video" });
  });

  it("reuses the persisted scan across a restart and notices library changes", async () => {
    await fixture();
    const cacheDir = path.join(tmp, "cache");

    const first = createWallpaperEngineSource({ locate, cacheDir });
    const original = await first.listing();
    if (!original.available) throw new Error(original.reason);
    expect(original.items).toHaveLength(3);

    // A fresh source is a fresh host process: the package scan must not run
    // again when the library fingerprint still matches.
    const classify = vi.fn();
    const second = createWallpaperEngineSource({ locate, classify, cacheDir });
    const cached = await second.listing();
    if (!cached.available) throw new Error(cached.reason);
    expect(classify).not.toHaveBeenCalled();
    expect(cached.items.map((item) => item.workshopId).sort()).toEqual(
      original.items.map((item) => item.workshopId).sort(),
    );
    expect(cached.skipped).toBe(original.skipped);

    // A subscription appears as a new directory, which changes the
    // fingerprint and earns a scan.
    await writeItem(
      "205",
      "project.json",
      JSON.stringify({ type: "video", file: "clip.mp4" }),
    );
    await writeItem("205", "clip.mp4", "mp4");

    const added = await second.listing();
    if (!added.available) throw new Error(added.reason);
    expect(added.items.map((item) => item.workshopId)).toContain("205");

    // Removing it is noticed the same way.
    await fs.rm(path.join(library, "205"), { recursive: true, force: true });
    const removed = await second.listing();
    if (!removed.available) throw new Error(removed.reason);
    expect(removed.items.map((item) => item.workshopId)).not.toContain("205");
  });

  it("answers not-installed when there is no install", async () => {
    const source = createWallpaperEngineSource({
      locate: async () => undefined,
    });

    expect(await source.listing()).toEqual({
      available: false,
      reason: "not-installed",
    });
  });

  it("forgets the last scan once the install is gone", async () => {
    await fixture();
    let current: WallpaperEngineInstall | undefined = install;
    const source = createWallpaperEngineSource({
      locate: async () => current,
    });

    expect((await source.listing()).available).toBe(true);

    current = undefined;

    expect(await source.listing()).toEqual({
      available: false,
      reason: "not-installed",
    });
    // The item's path belonged to a library that is no longer there.
    expect(await source.bytesOf("201", "asset")).toBeUndefined();
  });

  it("serves preview and payload bytes by id, and nothing else", async () => {
    await fixture();
    const source = createWallpaperEngineSource({ locate });
    await source.listing();

    const preview = await source.bytesOf("201", "preview");
    expect(preview?.contentType).toBe("image/jpeg");
    expect(Buffer.from(preview?.bytes ?? []).toString()).toBe("jpeg");

    const scene = await source.bytesOf("201", "asset");
    expect(scene?.contentType).toBe("application/octet-stream");
    expect(Buffer.from(scene?.bytes ?? [])).toEqual(Buffer.from(stillScene));

    const video = await source.bytesOf("203", "asset");
    expect(video?.contentType).toBe("video/mp4");
    expect(Buffer.from(video?.bytes ?? []).toString()).toBe("mp4");

    expect(await source.bytesOf("999", "asset")).toBeUndefined();
    expect(await source.bytesOf("../../secret", "preview")).toBeUndefined();
  });

  it("refuses a preview that leaves the item's directory", async () => {
    await writeItem(
      "301",
      "project.json",
      JSON.stringify({
        type: "scene",
        file: "scene.pkg",
        preview: "../secret.jpg",
      }),
    );
    await writeItem("301", "scene.pkg", stillScene);
    await fs.mkdir(library, { recursive: true });
    await fs.writeFile(path.join(library, "secret.jpg"), "secret");

    const source = createWallpaperEngineSource({ locate });
    await source.listing();

    expect(await source.bytesOf("301", "preview")).toBeUndefined();
  });

  it("answers an item whose preview is absent with nothing", async () => {
    await writeItem(
      "302",
      "project.json",
      JSON.stringify({ type: "scene", file: "scene.pkg" }),
    );
    await writeItem("302", "scene.pkg", stillScene);

    const source = createWallpaperEngineSource({ locate });
    await source.listing();

    expect(await source.bytesOf("302", "preview")).toBeUndefined();
  });

  it("unpacks a project without starting anything", async () => {
    await fixture();
    await fs.mkdir(install.myProjects, { recursive: true });
    const source = createWallpaperEngineSource({ locate });

    const result = await source.project("201");

    expect(result).toEqual({ ok: true, name: "201", reused: false });
    expect(result).not.toHaveProperty("launched");
  });

  it("resolves an author once and answers the cache afterwards", async () => {
    let calls = 0;
    const fetchImpl = (() => {
      calls += 1;
      return Promise.resolve(new Response("<steamID>Ada</steamID>"));
    }) as typeof fetch;
    const source = createWallpaperEngineSource({ locate, fetchImpl });

    expect(await source.authorName("76561198000000001")).toBe("Ada");
    expect(await source.authorName("76561198000000001")).toBe("Ada");
    expect(calls).toBe(1);
  });
});
