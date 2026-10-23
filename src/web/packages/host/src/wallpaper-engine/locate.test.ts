import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { locateInstall } from "./locate.js";

const EXE = path.join("bin", "wallpaperui.exe");

/**
 * The shape of a machine: a Steam root, the install under
 * `steamapps/common`, and the libraries `libraryfolders.vdf` names. The hook
 * (`YUNARI_WALLPAPER_ENGINE`) is the only candidate reached, because falling
 * through to the registry would make these cases read this PC's own Steam.
 */
describe("locating the Wallpaper Engine install", () => {
  let tmp: string;
  let steam: string;
  let install: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-we-locate-"));
    steam = path.join(tmp, "steam");
    install = path.join(steam, "steamapps", "common", "wallpaper_engine");
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  async function writeInstall(): Promise<void> {
    await fs.mkdir(path.join(install, "bin"), { recursive: true });
    await fs.writeFile(path.join(install, EXE), "");
    await fs.mkdir(path.join(install, "projects", "myprojects"), {
      recursive: true,
    });
  }

  async function writeLibraryFolders(paths: readonly string[]): Promise<void> {
    const lines = ['"libraryfolders"', "{"];
    paths.forEach((libraryPath, index) => {
      lines.push(
        `\t"${index}"`,
        "\t{",
        `\t\t"path"\t\t"${libraryPath}"`,
        '\t\t"apps"\t\t{ "431960" "1234" }',
        "\t}",
      );
    });
    lines.push("}");

    await fs.mkdir(path.join(steam, "steamapps"), { recursive: true });
    await fs.writeFile(
      path.join(steam, "steamapps", "libraryfolders.vdf"),
      lines.join("\r\n"),
    );
  }

  it("finds the install and only the libraries that hold workshop content", async () => {
    const content = path.join(
      tmp,
      "library-a",
      "steamapps",
      "workshop",
      "content",
      "431960",
    );
    await fs.mkdir(content, { recursive: true });
    // A second library listed by the vdf, but without the app's content.
    await fs.mkdir(
      path.join(tmp, "library-b", "steamapps", "workshop", "content"),
      { recursive: true },
    );
    await writeInstall();
    // The same library a second time under another drive-letter casing, which
    // is how the Steam root arrives when the registry and the vdf disagree.
    await writeLibraryFolders([
      path.join(tmp, "library-a"),
      path.join(tmp, "library-b"),
      path.join(tmp, "library-a").toUpperCase(),
    ]);

    const found = await locateInstall(
      { YUNARI_WALLPAPER_ENGINE: install },
      "win32",
    );

    expect(found).toEqual({
      root: install,
      libraries: [content],
      myProjects: path.join(install, "projects", "myprojects"),
      editor: path.join(install, EXE),
    });
  });

  it("answers undefined for a tree that holds no install", async () => {
    await fs.mkdir(install, { recursive: true });

    expect(
      await locateInstall({ YUNARI_WALLPAPER_ENGINE: install }, "win32"),
    ).toBeUndefined();
  });

  it("answers undefined off Windows without reading anything", async () => {
    await writeInstall();

    expect(
      await locateInstall({ YUNARI_WALLPAPER_ENGINE: install }, "linux"),
    ).toBeUndefined();
  });
});
