import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createGameArtwork,
  findBoxArt,
  MAX_BOX_ART_BYTES,
  readBoxArt,
} from "./box-art.js";
import type { SteamApp } from "./steam-library.js";

/** Only its JPEG framing matters; nothing here decodes the bytes. */
const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

const COUNTER_STRIKE: SteamApp = {
  appId: "10",
  name: "Counter-Strike",
  installDir: "D:\\Games\\Steam\\steamapps\\common\\Half-Life",
};

let tmp: string;
let root: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-box-art-"));
  root = path.join(tmp, "steam");
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

/** Steam writes the 600x900 art under `<root>/appcache/librarycache/<id>/`. */
function boxArtFile(appId: string): string {
  return path.join(
    root,
    "appcache",
    "librarycache",
    appId,
    "library_600x900.jpg",
  );
}

async function writeBoxArt(appId: string, bytes: Uint8Array = BYTES) {
  await fs.mkdir(path.dirname(boxArtFile(appId)), { recursive: true });
  await fs.writeFile(boxArtFile(appId), bytes);
}

describe("findBoxArt", () => {
  it("finds Steam's cached 600x900 art and names it as a host URL", async () => {
    await writeBoxArt("10");

    expect(await findBoxArt(COUNTER_STRIKE, [root])).toBe(
      "/api/game/artwork/10.jpg",
    );
  });

  it("leaves a game with no local image undefined and never a CDN URL", async () => {
    // The folder holds other art, but not the box art the route serves.
    const folder = path.join(root, "appcache", "librarycache", "10");
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, "header.jpg"), BYTES);

    expect(await findBoxArt(COUNTER_STRIKE, [root])).toBeUndefined();
  });

  it("tries every root it is given", async () => {
    await writeBoxArt("10");

    expect(
      await findBoxArt(COUNTER_STRIKE, [path.join(tmp, "absent"), root]),
    ).toBe("/api/game/artwork/10.jpg");
  });

  it("refuses a cache entry that links outside Steam's cache", async () => {
    const outside = path.join(tmp, "outside");
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(outside, "library_600x900.jpg"), BYTES);

    const cache = path.join(root, "appcache", "librarycache");
    await fs.mkdir(cache, { recursive: true });
    // A junction, not a file symlink: Windows allows these without elevation,
    // and resolving through it must not become a read of an arbitrary file.
    await fs.symlink(outside, path.join(cache, "10"), "junction");

    expect(await findBoxArt(COUNTER_STRIKE, [root])).toBeUndefined();
  });
});

describe("readBoxArt", () => {
  it("refuses an oversized file before readFile is called", async () => {
    await writeBoxArt("10", new Uint8Array(MAX_BOX_ART_BYTES + 1));
    let reads = 0;

    const bytes = await readBoxArt(boxArtFile("10"), async () => {
      reads += 1;
      return new Uint8Array();
    });

    expect(bytes).toBeUndefined();
    expect(reads).toBe(0);
  });
});

describe("createGameArtwork", () => {
  function source(apps: readonly SteamApp[] = [COUNTER_STRIKE]) {
    return createGameArtwork({
      steamRoot: async () => root,
      loadSteamApps: async () => apps,
    });
  }

  it("serves an installed app's cached bytes", async () => {
    await writeBoxArt("10");

    expect(Array.from((await source().read("10")) ?? [])).toEqual(
      Array.from(BYTES),
    );
  });

  it("refuses an app id that is not among the installed apps", async () => {
    await writeBoxArt("999");

    expect(await source().read("999")).toBeUndefined();
  });

  it("refuses a malformed app id before touching the disk", async () => {
    await writeBoxArt("10");
    const artwork = source();

    for (const id of ["", "10.png", "..", "../10", "10/../10", "abc", "1e3"]) {
      expect(await artwork.read(id), id).toBeUndefined();
    }
  });

  it("refuses a file over the 5 MiB bound", async () => {
    await writeBoxArt("10", new Uint8Array(MAX_BOX_ART_BYTES + 1));

    expect(await source().read("10")).toBeUndefined();
  });

  it("retries a library read that failed instead of caching the failure", async () => {
    await writeBoxArt("10");
    let reads = 0;
    const artwork = createGameArtwork({
      steamRoot: async () => root,
      loadSteamApps: async () => {
        reads += 1;
        if (reads === 1) throw new Error("transient manifest failure");
        return [COUNTER_STRIKE];
      },
    });

    expect(await artwork.read("10")).toBeUndefined();
    expect(Array.from((await artwork.read("10")) ?? [])).toEqual(
      Array.from(BYTES),
    );
  });

  it("returns undefined when there is no Steam root or the apps fail to load", async () => {
    await writeBoxArt("10");

    expect(
      await createGameArtwork({ steamRoot: async () => undefined }).read("10"),
    ).toBeUndefined();
    expect(
      await createGameArtwork({
        steamRoot: async () => root,
        loadSteamApps: async () => {
          throw new Error("unreadable");
        },
      }).read("10"),
    ).toBeUndefined();
  });
});
