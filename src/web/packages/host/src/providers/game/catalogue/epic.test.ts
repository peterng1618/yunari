import { describe, expect, it } from "vitest";
import { readEpicGames } from "./epic.js";
import { seamsOf } from "./test-seams.js";

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

/** The real local shape: an empty MainGameAppName is no DLC, not a mismatch. */
const EMPTY_MAIN_GAME_MANIFEST = JSON.stringify({
  AppName: "HeardInstalling",
  DisplayName: "Red Dead Redemption 2",
  InstallLocation: "C:\\Program Files\\Epic Games\\RedDeadRedemption2",
  LaunchExecutable: "RDR2.exe",
  MainGameAppName: "",
  bIsIncompleteInstall: false,
});

function manifestFile(name: string): string {
  return `${MANIFEST_DIR}\\${name}`;
}

describe("readEpicGames", () => {
  it("resolves a valid manifest's LaunchExecutable under InstallLocation", async () => {
    const seams = seamsOf({
      directories: { [MANIFEST_DIR]: ["Fortnite.item"] },
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

  it("keeps an absolute LaunchExecutable as-is", async () => {
    const manifest = JSON.stringify({
      AppName: "Elsewhere",
      DisplayName: "Elsewhere",
      InstallLocation: "C:\\Games\\Elsewhere",
      LaunchExecutable: "D:\\Games\\X\\game.exe",
      MainGameAppName: "Elsewhere",
      bIsIncompleteInstall: false,
    });
    const seams = seamsOf({
      directories: { [MANIFEST_DIR]: ["Elsewhere.item"] },
      files: { [manifestFile("Elsewhere.item")]: manifest },
    });

    await expect(readEpicGames(seams)).resolves.toEqual([
      {
        source: "epic",
        name: "Elsewhere",
        installDir: "C:\\Games\\Elsewhere",
        exes: ["D:\\Games\\X\\game.exe"],
      },
    ]);
  });

  it("skips an incomplete install", async () => {
    const seams = seamsOf({
      directories: { [MANIFEST_DIR]: ["RocketLeague.item"] },
      files: { [manifestFile("RocketLeague.item")]: INCOMPLETE_MANIFEST },
    });

    await expect(readEpicGames(seams)).resolves.toEqual([]);
  });

  it("skips DLC whose MainGameAppName is another app", async () => {
    const seams = seamsOf({
      directories: { [MANIFEST_DIR]: ["Fortnite_DLC.item"] },
      files: { [manifestFile("Fortnite_DLC.item")]: DLC_MANIFEST },
    });

    await expect(readEpicGames(seams)).resolves.toEqual([]);
  });

  it("keeps a game whose MainGameAppName is empty", async () => {
    const seams = seamsOf({
      directories: { [MANIFEST_DIR]: ["HeardInstalling.item"] },
      files: {
        [manifestFile("HeardInstalling.item")]: EMPTY_MAIN_GAME_MANIFEST,
      },
    });

    const games = await readEpicGames(seams);

    expect(games).toHaveLength(1);
    expect(games[0]?.name).toBe("Red Dead Redemption 2");
    expect(games[0]?.exes).toEqual([
      "C:\\Program Files\\Epic Games\\RedDeadRedemption2\\RDR2.exe",
    ]);
  });

  it("treats a missing manifest directory as an empty list", async () => {
    const seams = seamsOf({});

    await expect(readEpicGames(seams)).resolves.toEqual([]);
  });

  it("skips a malformed manifest and keeps its valid neighbour", async () => {
    const seams = seamsOf({
      directories: { [MANIFEST_DIR]: ["Broken.item", "Fortnite.item"] },
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
