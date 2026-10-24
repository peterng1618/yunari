import { describe, expect, it } from "vitest";
import { defaultCatalogueSeams } from "./seams.js";
import { readSteamGames } from "./steam.js";
import { seamsOf } from "./test-seams.js";

describe("readSteamGames", () => {
  it("returns the seam's catalogue entries unchanged", async () => {
    const entries = [
      {
        source: "steam" as const,
        name: "Game",
        installDir: "C:\\Steam\\Game",
        exes: [],
      },
    ];
    const seams = { ...seamsOf({}), steamApps: async () => entries };

    await expect(readSteamGames(seams)).resolves.toEqual(entries);
  });
});

describe("defaultCatalogueSeams Steam adapter", () => {
  it("maps the Steam library to catalogue entries with no executables", async () => {
    const roots: string[] = [];
    const seams = defaultCatalogueSeams({
      resolveSteamRoot: async () => "C:\\Steam",
      readSteamApps: async (root) => {
        roots.push(root);
        return [
          {
            appId: "123",
            name: "Game",
            installDir: "C:\\Steam\\steamapps\\common\\Game",
          },
        ];
      },
    });

    await expect(seams.steamApps()).resolves.toEqual([
      {
        source: "steam",
        name: "Game",
        installDir: "C:\\Steam\\steamapps\\common\\Game",
        exes: [],
      },
    ]);
    expect(roots).toEqual(["C:\\Steam"]);
  });

  it("answers no Steam apps when there is no root", async () => {
    const seams = defaultCatalogueSeams({
      resolveSteamRoot: async () => undefined,
      readSteamApps: async () => {
        throw new Error("must not read without a root");
      },
    });

    await expect(seams.steamApps()).resolves.toEqual([]);
  });

  it("answers no Steam apps when resolving the root throws", async () => {
    const seams = defaultCatalogueSeams({
      resolveSteamRoot: async () => {
        throw new Error("registry unavailable");
      },
    });

    await expect(seams.steamApps()).resolves.toEqual([]);
  });

  it("answers no Steam apps when reading the library throws", async () => {
    const seams = defaultCatalogueSeams({
      resolveSteamRoot: async () => "C:\\Steam",
      readSteamApps: async () => {
        throw new Error("library unreadable");
      },
    });

    await expect(seams.steamApps()).resolves.toEqual([]);
  });
});
