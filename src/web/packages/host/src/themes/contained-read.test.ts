import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readContainedFile } from "./contained-read.js";

describe("readContainedFile", () => {
  let dir: string;
  let root: string;
  let outside: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-contained-"));
    root = path.join(dir, "root");
    outside = path.join(dir, "outside");
    await fs.mkdir(root, { recursive: true });
    await fs.mkdir(outside, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("reads a file inside the root", async () => {
    await fs.writeFile(path.join(root, "theme.json"), "{}");

    expect((await readContainedFile(root, "theme.json"))?.toString()).toBe(
      "{}",
    );
  });

  it("reads a nested file written with forward slashes", async () => {
    await fs.mkdir(path.join(root, "assets"));
    await fs.writeFile(path.join(root, "assets", "badge.svg"), "<svg/>");

    expect(
      (await readContainedFile(root, "assets/badge.svg"))?.toString(),
    ).toBe("<svg/>");
  });

  it("answers undefined for a path that climbs out", async () => {
    await fs.writeFile(path.join(outside, "secret"), "secret");

    expect(await readContainedFile(root, "../outside/secret")).toBeUndefined();
  });

  it("answers undefined for a file that is not there", async () => {
    expect(await readContainedFile(root, "missing.json")).toBeUndefined();
  });

  it("refuses a link that leaves the root", async () => {
    await fs.writeFile(path.join(outside, "secret"), "secret");
    // A junction needs no elevation on Windows, and is a plain symlink elsewhere.
    await fs.symlink(outside, path.join(root, "escape"), "junction");

    expect(await readContainedFile(root, "escape/secret")).toBeUndefined();
  });

  it("still reads a link that stays inside the root", async () => {
    await fs.mkdir(path.join(root, "assets"));
    await fs.writeFile(path.join(root, "assets", "badge.svg"), "<svg/>");
    await fs.symlink(
      path.join(root, "assets"),
      path.join(root, "alias"),
      "junction",
    );

    expect((await readContainedFile(root, "alias/badge.svg"))?.toString()).toBe(
      "<svg/>",
    );
  });

  it("refuses a file past the byte cap without reading it", async () => {
    await fs.writeFile(path.join(root, "big.bin"), "0123456789");
    const readFile = vi.spyOn(fs, "readFile");
    try {
      // At the cap it reads — the probe that this spy sees the call the
      // refusal below must not make.
      expect((await readContainedFile(root, "big.bin", 10))?.toString()).toBe(
        "0123456789",
      );
      expect(readFile).toHaveBeenCalled();
      readFile.mockClear();

      // One byte over is refused on its size, so its bytes are never buffered.
      expect(await readContainedFile(root, "big.bin", 9)).toBeUndefined();
      expect(readFile).not.toHaveBeenCalled();

      // No cap keeps the old behaviour: the same file reads.
      expect((await readContainedFile(root, "big.bin"))?.toString()).toBe(
        "0123456789",
      );
    } finally {
      readFile.mockRestore();
    }
  });
});
