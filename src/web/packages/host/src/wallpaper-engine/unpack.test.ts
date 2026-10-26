import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LibraryItem } from "./library.js";
import type { WallpaperEngineInstall } from "./locate.js";
import { memberBytes, readPackage } from "./pkg.js";
import { createWallpaperEngineSource } from "./source.js";
import { unpackScene } from "./unpack.js";

const encoder = new TextEncoder();

/** The same hand-built container `classify.test.ts` and `source.test.ts` use. */
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

const members = [
  ["scene.json", JSON.stringify({ objects: [{ text: "12:00" }] })],
  ["background.tex", "tex-bytes"],
  ["materials/sky.tex", "nested-member-bytes"],
] as const;

const descriptor = {
  type: "scene",
  file: "scene.pkg",
  title: "Still Scene",
  preview: "preview.jpg",
};

describe("unpacking a scene theme", () => {
  let tmp: string;
  let install: WallpaperEngineInstall;
  let item: LibraryItem;
  let library: string;

  async function writeFixture(pkg: Uint8Array): Promise<void> {
    await fs.writeFile(path.join(item.directory, "scene.pkg"), pkg);
  }

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-we-unpack-"));
    const root = path.join(tmp, "wallpaper_engine");
    library = path.join(tmp, "library");
    item = {
      workshopId: "201",
      directory: path.join(library, "201"),
      title: "Still Scene",
      payload: path.join(library, "201", "scene.pkg"),
      type: "scene",
      preview: undefined,
      filesize: 1,
      tags: [],
      authorSteamId: undefined,
      workshopUrl: undefined,
      properties: undefined,
    };
    install = {
      root,
      libraries: [library],
      myProjects: path.join(root, "projects", "myprojects"),
      editor: path.join(root, "bin", "wallpaperui.exe"),
    };

    await fs.mkdir(path.join(item.directory ?? ""), { recursive: true });
    await fs.mkdir(install.myProjects, { recursive: true });
    await fs.writeFile(
      path.join(item.directory, "project.json"),
      JSON.stringify(descriptor),
    );
    await writeFixture(buildPackage(members));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("writes every member byte-identically beside a descriptor naming scene.json", async () => {
    const result = await unpackScene(install, item);

    expect(result).toEqual({ ok: true, name: "201", reused: false });

    const target = path.join(install.myProjects, "201");
    const pkg = readPackage(await fs.readFile(item.payload));
    if (pkg === undefined) throw new Error("fixture package did not parse");

    for (const [name] of members) {
      const expected = memberBytes(pkg, name);
      if (expected === undefined) throw new Error(`no member ${name}`);
      const actual = await fs.readFile(path.join(target, name));
      // Content, not length: a same-sized member would pass a size check.
      expect(Buffer.compare(actual, Buffer.from(expected))).toBe(0);
    }

    const written = JSON.parse(
      await fs.readFile(path.join(target, "project.json"), "utf8"),
    );
    expect(written.file).toBe("scene.json");
    expect(written.title).toBe("[yunari] Still Scene");
  });

  it("prefixes a fresh project's title once", async () => {
    await fs.writeFile(
      path.join(item.directory, "project.json"),
      JSON.stringify({ ...descriptor, title: "Cache Scene" }),
    );

    await unpackScene(install, item);

    const written = JSON.parse(
      await fs.readFile(
        path.join(install.myProjects, "201", "project.json"),
        "utf8",
      ),
    );
    expect(written.title).toBe("[yunari] Cache Scene");
  });

  it("answers reused for an existing directory and rewrites nothing", async () => {
    expect(await unpackScene(install, item)).toMatchObject({ reused: false });

    const target = path.join(install.myProjects, "201");
    const file = path.join(target, "project.json");
    const before = await fs.stat(file);
    const bytesBefore = await fs.readFile(file);

    const second = await unpackScene(install, item);

    expect(second).toEqual({ ok: true, name: "201", reused: true });
    expect((await fs.stat(file)).mtimeMs).toBe(before.mtimeMs);
    expect(Buffer.compare(await fs.readFile(file), bytesBefore)).toBe(0);
  });

  it("leaves a hand-edited title alone when the same item is unpacked again", async () => {
    await unpackScene(install, item);
    const file = path.join(install.myProjects, "201", "project.json");
    const edited = JSON.parse(await fs.readFile(file, "utf8"));
    await fs.writeFile(
      file,
      JSON.stringify({ ...edited, title: "My Title" }),
      "utf8",
    );

    expect(await unpackScene(install, item)).toMatchObject({ reused: true });

    const written = JSON.parse(await fs.readFile(file, "utf8"));
    expect(written.title).toBe("My Title");
  });

  it("copies the workshop's own preview so the project has a thumbnail", async () => {
    item = {
      ...item,
      preview: path.join(item.directory, "preview.jpg"),
    };
    await fs.writeFile(item.preview as string, "jpeg-bytes");

    await unpackScene(install, item);

    expect(
      await fs.readFile(
        path.join(install.myProjects, "201", "preview.jpg"),
        "utf8",
      ),
    ).toBe("jpeg-bytes");
  });

  it("fills in a missing preview in a project an earlier run unpacked", async () => {
    const target = path.join(install.myProjects, "201");
    await fs.mkdir(target);
    await fs.writeFile(
      path.join(target, "project.json"),
      JSON.stringify({ ...descriptor, file: "scene.json" }),
    );
    item = {
      ...item,
      preview: path.join(item.directory, "preview.jpg"),
    };
    await fs.writeFile(item.preview as string, "jpeg-bytes");

    expect(await unpackScene(install, item)).toMatchObject({ reused: true });

    expect(await fs.readFile(path.join(target, "preview.jpg"), "utf8")).toBe(
      "jpeg-bytes",
    );
  });

  it("never writes into a directory this run did not create", async () => {
    const target = path.join(install.myProjects, "201");
    await fs.mkdir(target);
    const sentinel = path.join(target, "sentinel.txt");
    await fs.writeFile(sentinel, "left alone");

    const result = await unpackScene(install, item);

    expect(result).toEqual({ ok: true, name: "201", reused: true });
    expect(await fs.readFile(sentinel, "utf8")).toBe("left alone");
    expect(await fs.readdir(target)).toEqual(["sentinel.txt"]);
  });

  it("removes the directory it created when the package is truncated", async () => {
    await writeFixture(buildPackage(members).subarray(0, 20));

    expect(await unpackScene(install, item)).toEqual({
      ok: false,
      reason: "unreadable",
    });
    await expect(
      fs.stat(path.join(install.myProjects, "201")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a package with no scene.json member", async () => {
    await writeFixture(
      buildPackage([
        ["background.tex", "tex-bytes"],
        ["materials/sky.tex", "nested-member-bytes"],
      ]),
    );

    expect(await unpackScene(install, item)).toEqual({
      ok: false,
      reason: "unreadable",
    });
    await expect(
      fs.stat(path.join(install.myProjects, "201")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses every member name that is not a safe relative path", async () => {
    // A segment list rather than a separator rule: real packages nest members
    // (`materials/sky.tex`), so only traversal, drive letters and backslashes
    // are refused — never nesting itself.
    for (const name of [
      "../escape.txt",
      "materials/../escape.txt",
      "materials//empty.tex",
      "materials/./dot.tex",
      "C:/absolute.tex",
      "back\\slash.tex",
      "/rooted.tex",
    ]) {
      await writeFixture(
        buildPackage([
          ["scene.json", "{}"],
          [name, "escaped"],
        ]),
      );

      expect(await unpackScene(install, item), name).toEqual({
        ok: false,
        reason: "unreadable",
      });
      await expect(
        fs.stat(path.join(install.myProjects, "201")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    }

    await expect(
      fs.stat(path.join(install.myProjects, "escape.txt")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a target name that is not alphanumeric without creating anything", async () => {
    const unsafe: LibraryItem = { ...item, workshopId: "../201" };

    expect(await unpackScene(install, unsafe)).toEqual({
      ok: false,
      reason: "refused",
    });
    expect(await fs.readdir(install.myProjects)).toEqual([]);
  });

  it("refuses an id the library does not hold", async () => {
    const source = createWallpaperEngineSource({
      locate: async () => install,
    });

    expect(await source.project("999")).toEqual({
      ok: false,
      reason: "refused",
    });
  });

  it("answers no-install when there is no install", async () => {
    const source = createWallpaperEngineSource({
      locate: async () => undefined,
    });

    expect(await source.project("201")).toEqual({
      ok: false,
      reason: "no-install",
    });
  });
});
