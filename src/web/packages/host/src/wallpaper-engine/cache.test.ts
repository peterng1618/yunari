import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readListingCache, writeListingCache } from "./cache.js";
import type { WallpaperEngineInstall } from "./locate.js";

describe("the wallpaper listing cache", () => {
  let tmpDir: string | undefined;

  afterEach(async () => {
    if (tmpDir !== undefined) {
      await fs.rm(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  it("keeps an item's updated time across a write and read", async () => {
    // The editor's "Updated" sort reads this number. A cached listing is what
    // the host serves after its first scan, so dropping it on read left every
    // item without one — and the sort compared absent with absent.
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "yunari-wallpaper-cache-"),
    );
    const install: WallpaperEngineInstall = {
      root: tmpDir,
      libraries: [path.join(tmpDir, "library")],
      myProjects: path.join(tmpDir, "projects"),
      editor: path.join(tmpDir, "wallpaperui.exe"),
    };
    const updatedAt = 1_764_000_000_000;

    await writeListingCache(tmpDir, install, "fingerprint", {
      items: [],
      stored: [
        {
          workshopId: "101",
          title: "One",
          kind: "video",
          filesize: 10,
          updatedAt,
          tags: [],
          properties: {},
        },
      ],
      skipped: 0,
    });

    const cache = await readListingCache(tmpDir, install, "fingerprint");

    expect(cache?.stored[0]?.updatedAt).toBe(updatedAt);
  });
});
