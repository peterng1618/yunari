import { describe, expect, it } from "vitest";
import { type CatalogueSeams, readEpicGames } from "./game-catalogue.js";

/**
 * Epic writes one JSON `.item` per install under its launcher's manifest
 * directory. The fixtures below mirror that shape; a seam map stands in for the
 * disk so the tests never read this machine's manifests.
 */
const MANIFEST_DIR =
  "C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests";

const VALID_MANIFEST = JSON.stringify({
  AppName: "Fortnite",
  DisplayName: "Fortnite",
  InstallLocation: "C:\\Program Files\\Epic Games\\Fortnite",
  LaunchExecutable: "FortniteGame\\Binaries\\Win64\\FortniteLauncher.exe",
  MainGameAppName: "Fortnite",
  bIsIncompleteInstall: false,
});

const INCOMPLETE_MANIFEST = JSON.stringify({
  AppName: "RocketLeague",
  DisplayName: "Rocket League",
  InstallLocation: "C:\\Games\\Rocket League",
  LaunchExecutable: "Binaries\\Win64\\RocketLeague.exe",
  bIsIncompleteInstall: true,
});

const DLC_MANIFEST = JSON.stringify({
  AppName: "Fortnite_DLC",
  DisplayName: "Fortnite Bonus Content",
  InstallLocation: "C:\\Program Files\\Epic Games\\Fortnite",
  LaunchExecutable: "FortniteGame\\Binaries\\Win64\\FortniteLauncher.exe",
  MainGameAppName: "Fortnite",
  bIsIncompleteInstall: false,
});

interface Fixture {
  readonly entries?: readonly string[];
  readonly files?: Record<string, string>;
  readonly missingDirectory?: true;
}

function seamsOf(fixture: Fixture): CatalogueSeams {
  return {
    readFile: async (file) => {
      const text = fixture.files?.[file];

      if (text === undefined) throw new Error(`ENOENT: ${file}`);
      return text;
    },
    readdir: async (dir) => {
      if (dir !== MANIFEST_DIR) throw new Error(`unexpected directory: ${dir}`);
      if (fixture.missingDirectory === true) throw new Error(`ENOENT: ${dir}`);
      return fixture.entries ?? [];
    },
    programData: "C:\\ProgramData",
    appData: "C:\\Users\\player\\AppData\\Roaming",
    runPowerShell: async () => undefined,
    steamApps: async () => [],
  };
}

function manifestFile(name: string): string {
  return `${MANIFEST_DIR}\\${name}`;
}

describe("readEpicGames", () => {
  it("resolves a valid manifest's LaunchExecutable under InstallLocation", async () => {
    const seams = seamsOf({
      entries: ["Fortnite.item"],
      files: { [manifestFile("Fortnite.item")]: VALID_MANIFEST },
    });

    await expect(readEpicGames(seams)).resolves.toEqual([
      {
        source: "epic",
        name: "Fortnite",
        installDir: "C:\\Program Files\\Epic Games\\Fortnite",
        exes: [
          "C:\\Program Files\\Epic Games\\Fortnite\\FortniteGame\\Binaries\\Win64\\FortniteLauncher.exe",
        ],
      },
    ]);
  });

  it("skips an incomplete install", async () => {
    const seams = seamsOf({
      entries: ["RocketLeague.item"],
      files: { [manifestFile("RocketLeague.item")]: INCOMPLETE_MANIFEST },
    });

    await expect(readEpicGames(seams)).resolves.toEqual([]);
  });

  it("skips DLC whose MainGameAppName is another app", async () => {
    const seams = seamsOf({
      entries: ["Fortnite_DLC.item"],
      files: { [manifestFile("Fortnite_DLC.item")]: DLC_MANIFEST },
    });

    await expect(readEpicGames(seams)).resolves.toEqual([]);
  });

  it("treats a missing manifest directory as an empty list", async () => {
    const seams = seamsOf({ missingDirectory: true });

    await expect(readEpicGames(seams)).resolves.toEqual([]);
  });

  it("skips a malformed manifest and keeps its valid neighbour", async () => {
    const seams = seamsOf({
      entries: ["Broken.item", "Fortnite.item"],
      files: {
        [manifestFile("Broken.item")]: "{ not json",
        [manifestFile("Fortnite.item")]: VALID_MANIFEST,
      },
    });

    const games = await readEpicGames(seams);

    expect(games).toHaveLength(1);
    expect(games[0]?.name).toBe("Fortnite");
  });
});
