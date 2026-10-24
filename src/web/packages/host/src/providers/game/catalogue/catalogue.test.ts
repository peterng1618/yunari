import { describe, expect, it } from "vitest";
import { readInstalledGames } from "./catalogue.js";
import { seamsOf } from "./test-seams.js";

const EPIC_MANIFEST_DIR =
  "C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests";

function epicManifest(
  name: string,
  installDir: string,
  executable: string,
): string {
  return JSON.stringify({
    AppName: name,
    DisplayName: name,
    InstallLocation: installDir,
    LaunchExecutable: executable,
    MainGameAppName: name,
    bIsIncompleteInstall: false,
  });
}

function epicFixture(
  name: string,
  installDir: string,
  executable: string,
): {
  readonly directories: Record<string, readonly string[]>;
  readonly files: Record<string, string>;
} {
  return {
    directories: { [EPIC_MANIFEST_DIR]: [`${name}.item`] },
    files: {
      [`${EPIC_MANIFEST_DIR}\\${name}.item`]: epicManifest(
        name,
        installDir,
        executable,
      ),
    },
  };
}

describe("readInstalledGames", () => {
  it("keeps Steam when Epic names the same executable", async () => {
    const seams = {
      ...seamsOf(epicFixture("Shared", "C:\\Games\\Shared", "game.exe")),
      steamApps: async () => [
        {
          source: "steam" as const,
          name: "Steam Copy",
          installDir: "C:\\Steam\\Shared",
          exes: ["C:\\Games\\Shared\\game.exe"],
        },
      ],
    };

    await expect(readInstalledGames(seams)).resolves.toEqual([
      {
        source: "steam",
        name: "Steam Copy",
        installDir: "C:\\Steam\\Shared",
        exes: ["C:\\Games\\Shared\\game.exe"],
      },
    ]);
  });

  it("keeps two sources whose executables differ", async () => {
    const seams = {
      ...seamsOf(epicFixture("Epic Game", "C:\\Epic\\Game", "epic.exe")),
      steamApps: async () => [
        {
          source: "steam" as const,
          name: "Steam Game",
          installDir: "C:\\Steam\\Game",
          exes: ["C:\\Steam\\Game\\steam.exe"],
        },
      ],
    };

    const games = await readInstalledGames(seams);

    expect(games.map((game) => game.source)).toEqual(["steam", "epic"]);
  });

  it("collapses two empty-exe entries with the same install root", async () => {
    const seams = {
      ...seamsOf({
        powerShell: [{ gameName: "GOG Copy", path: "C:\\Games\\SAME" }],
      }),
      steamApps: async () => [
        {
          source: "steam" as const,
          name: "Steam Copy",
          installDir: "C:\\Games\\Same",
          exes: [],
        },
      ],
    };

    await expect(readInstalledGames(seams)).resolves.toEqual([
      {
        source: "steam",
        name: "Steam Copy",
        installDir: "C:\\Games\\Same",
        exes: [],
      },
    ]);
  });

  it("keeps two empty-exe entries with different install roots", async () => {
    const seams = {
      ...seamsOf({
        powerShell: [{ gameName: "GOG Copy", path: "C:\\Games\\Other" }],
      }),
      steamApps: async () => [
        {
          source: "steam" as const,
          name: "Steam Copy",
          installDir: "C:\\Games\\One",
          exes: [],
        },
      ],
    };

    const games = await readInstalledGames(seams);

    expect(games.map((game) => game.source)).toEqual(["steam", "gog"]);
  });

  it("lets a throwing source lose only itself", async () => {
    const seams = {
      ...seamsOf(epicFixture("Epic Game", "C:\\Epic\\Game", "epic.exe")),
      steamApps: async () => {
        throw new Error("Steam library unavailable");
      },
    };

    await expect(readInstalledGames(seams)).resolves.toEqual([
      {
        source: "epic",
        name: "Epic Game",
        installDir: "C:\\Epic\\Game",
        exes: ["C:\\Epic\\Game\\epic.exe"],
      },
    ]);
  });
});
