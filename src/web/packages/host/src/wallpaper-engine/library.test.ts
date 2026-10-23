import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanLibrary } from "./library.js";
import type { WallpaperEngineInstall } from "./locate.js";

const HTML = "<html><body>web</body></html>";

/**
 * Five workshop directories, as fifteen of them look on disk: three wallpapers,
 * a preset for another wallpaper (§1.2), and one whose `project.json` does not
 * parse. The cache covers the scene and the video; the web item has no row, so
 * its attribution stays absent rather than being invented.
 */
describe("scanning the workshop library", () => {
  let tmp: string;
  let library: string;
  let install: WallpaperEngineInstall;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-we-library-"));
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
    files: Readonly<Record<string, string>>,
  ): Promise<void> {
    const directory = path.join(library, id);
    await fs.mkdir(directory, { recursive: true });
    for (const [name, contents] of Object.entries(files)) {
      await fs.writeFile(path.join(directory, name), contents);
    }
  }

  async function writeCache(wallpapers: readonly unknown[]): Promise<void> {
    const bin = path.join(install.root, "bin");
    await fs.mkdir(bin, { recursive: true });
    await fs.writeFile(
      path.join(bin, "workshopcache.json"),
      JSON.stringify({ user: "someone", version: 2, wallpapers }),
    );
  }

  async function fixture(): Promise<void> {
    await writeItem("101", {
      "project.json": JSON.stringify({
        // Today's subscribed descriptors name this file, which is not on disk.
        type: "scene",
        file: "scene.json",
        title: "Disk Scene",
        preview: "preview.jpg",
        properties: { brightness: { type: "color", value: "#fff" } },
      }),
      "scene.pkg": "PKGV0001",
      "preview.jpg": "jpeg",
    });
    await writeItem("102", {
      "project.json": JSON.stringify({
        type: "Video",
        file: "clip.mp4",
        title: "Disk Clip",
      }),
      "clip.mp4": "mp4",
    });
    await writeItem("103", {
      "project.json": JSON.stringify({
        type: "web",
        file: "index.html",
        title: "Disk Page",
      }),
      "index.html": HTML,
    });
    await writeItem("104", {
      "project.json": JSON.stringify({
        preset: { name: "A preset" },
        dependency: "101",
        file: "project.json",
      }),
    });
    await writeItem("105", { "project.json": "{ not json" });

    await writeCache([
      {
        workshopid: 101,
        title: "Cache Scene",
        filesize: 1234,
        tags: ["Abstract", "Dark"],
        authorsteamid: "76561198000000001",
        workshopurl:
          "https://steamcommunity.com/sharedfiles/filedetails/?id=101",
      },
      {
        workshopid: "102",
        title: "Cache Clip",
        type: "Video",
        filesize: 999,
        tags: ["Video"],
        authorsteamid: "76561198000000002",
        workshopurl:
          "https://steamcommunity.com/sharedfiles/filedetails/?id=102",
      },
    ]);
  }

  it("lists the three wallpapers, counts the two refusals, and joins the cache", async () => {
    await fixture();

    const scan = await scanLibrary(install);
    const byId = new Map(scan.items.map((item) => [item.workshopId, item]));

    expect(scan.items).toHaveLength(3);
    expect(scan.skipped).toBe(2);
    expect([...byId.keys()].sort()).toEqual(["101", "102", "103"]);

    expect(byId.get("101")).toEqual({
      workshopId: "101",
      directory: path.join(library, "101"),
      title: "Cache Scene",
      payload: path.join(library, "101", "scene.pkg"),
      type: "scene",
      preview: path.join(library, "101", "preview.jpg"),
      filesize: 1234,
      tags: ["Abstract", "Dark"],
      authorSteamId: "76561198000000001",
      workshopUrl: "https://steamcommunity.com/sharedfiles/filedetails/?id=101",
      properties: { brightness: { type: "color", value: "#fff" } },
    });
  });

  it("lowercases the descriptor's type rather than trusting the cache row", async () => {
    await fixture();

    const scan = await scanLibrary(install);
    const video = scan.items.find((item) => item.workshopId === "102");

    expect(video?.type).toBe("video");
    expect(video?.filesize).toBe(999);
  });

  it("leaves attribution and title absent of the cache when there is no row", async () => {
    await fixture();

    const scan = await scanLibrary(install);
    const web = scan.items.find((item) => item.workshopId === "103");

    expect(web).toMatchObject({
      title: "Disk Page",
      type: "web",
      filesize: Buffer.byteLength(HTML),
      tags: [],
      authorSteamId: undefined,
      workshopUrl: undefined,
    });
  });

  it("makes a scene's package its payload, and keeps the named file otherwise", async () => {
    // The real shape: the descriptor names `scene.json`, the package is beside it.
    await writeItem("107", {
      "project.json": JSON.stringify({ type: "scene", file: "scene.json" }),
      "scene.pkg": "PKGV0001",
    });
    // No package: the unclassified scene is still listed against its named file.
    await writeItem("108", {
      "project.json": JSON.stringify({ type: "scene", file: "scene.json" }),
    });
    // The descriptor names something else entirely; the package still wins.
    await writeItem("109", {
      "project.json": JSON.stringify({ type: "scene", file: "custom.json" }),
      "scene.pkg": "PKGV0001",
      "custom.json": "{}",
    });

    const scan = await scanLibrary(install);
    const byId = new Map(scan.items.map((item) => [item.workshopId, item]));

    expect(byId.get("107")?.payload).toBe(
      path.join(library, "107", "scene.pkg"),
    );
    expect(byId.get("108")?.payload).toBe(
      path.join(library, "108", "scene.json"),
    );
    expect(byId.get("109")?.payload).toBe(
      path.join(library, "109", "scene.pkg"),
    );
  });
});
