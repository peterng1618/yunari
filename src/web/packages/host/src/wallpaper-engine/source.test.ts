import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
});

describe("the Wallpaper Engine export scope", () => {
  let tmp: string;
  let install: WallpaperEngineInstall;
  let videos: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-we-exports-"));
    const root = path.join(tmp, "wallpaper_engine");
    install = {
      root,
      libraries: [path.join(tmp, "library")],
      myProjects: path.join(root, "projects", "myprojects"),
      editor: path.join(root, "bin", "wallpaperui.exe"),
    };
    videos = path.join(tmp, "Videos");
    await fs.mkdir(path.join(root, "projects", "temp"), { recursive: true });
    await fs.mkdir(install.myProjects, { recursive: true });
    await fs.mkdir(videos, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  async function writeExport(
    directory: string,
    name: string,
    when: Date,
    body = name,
  ): Promise<string> {
    const file = path.join(directory, name);
    await fs.writeFile(file, body);
    await fs.utimes(file, when, when);
    return file;
  }

  function source(): ReturnType<typeof createWallpaperEngineSource> {
    return createWallpaperEngineSource({
      locate: async () => install,
      videosDirectory: videos,
    });
  }

  it("lists only recent png and mp4 files, newest first, across the three directories", async () => {
    const old = new Date("2020-01-01T00:00:00Z");
    const middle = new Date("2021-01-01T00:00:00Z");
    const recent = new Date("2022-01-01T00:00:00Z");

    await writeExport(
      path.join(install.root, "projects", "temp"),
      "middle.png",
      middle,
    );
    await writeExport(install.myProjects, "recent.mp4", recent);
    await writeExport(videos, "old.png", old);
    await writeExport(videos, "notes.txt", recent);
    await writeExport(videos, "clip.mkv", recent);

    const files = await source().exportsSince(
      new Date("2020-06-01T00:00:00Z").getTime(),
    );

    expect(files.map((file) => file.name)).toEqual([
      "recent.mp4",
      "middle.png",
    ]);
    expect(files[0]?.format).toBe("mp4");
    expect(files[0]?.size).toBe(Buffer.byteLength("recent.mp4"));
    expect(files[0]?.modified).toBeGreaterThan(middle.getTime());
    expect(files[1]?.format).toBe("png");
  });

  it("reads no Videos folder that does not exist", async () => {
    const answer = await createWallpaperEngineSource({
      locate: async () => install,
      videosDirectory: path.join(tmp, "no-videos"),
    }).exportsSince(0);

    expect(answer).toEqual([]);
  });

  it("serves the bytes of a real export in scope", async () => {
    await writeExport(
      path.join(install.root, "projects", "temp"),
      "shot.png",
      new Date(),
    );

    const answer = await source().exportBytes("shot.png");

    expect(answer?.contentType).toBe("image/png");
    expect(Buffer.from(answer?.bytes ?? []).toString()).toBe("shot.png");
  });

  it("answers one name once, by its newest copy", async () => {
    await writeExport(
      path.join(install.root, "projects", "temp"),
      "same.png",
      new Date("2021-01-01T00:00:00Z"),
      "older",
    );
    await writeExport(
      videos,
      "same.png",
      new Date("2022-01-01T00:00:00Z"),
      "newer",
    );

    const files = await source().exportsSince(0);

    expect(files).toHaveLength(1);
    expect(files[0]?.modified).toBeGreaterThan(
      new Date("2021-06-01T00:00:00Z").getTime(),
    );

    // The listing offered one row, so the bytes have to be that row's file —
    // not whichever scoped directory happened to be read first.
    const answer = await source().exportBytes("same.png");
    expect(Buffer.from(answer?.bytes ?? []).toString()).toBe("newer");
  });

  it("refuses every name that is not a bare png or mp4", async () => {
    await writeExport(videos, "shot.png", new Date());
    const from = source();

    // The last traversal case is the decoded form of `x%2e%2e/y.png`, which is
    // what the route asks with after `URLSearchParams` has decoded it.
    const decoded = new URLSearchParams("name=x%2e%2e/y.png").get("name");

    for (const name of [
      "../project.json",
      "a/b.png",
      decoded ?? "",
      "x.png.exe",
      "x.jpg",
      "",
    ]) {
      expect(await from.exportBytes(name)).toBeUndefined();
    }

    expect(await from.exportBytes("shot.png")).toBeDefined();
  });
});
