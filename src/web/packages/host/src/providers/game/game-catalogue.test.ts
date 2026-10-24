import { describe, expect, it } from "vitest";
import {
  type CatalogueSeams,
  readEpicGames,
  readGogGames,
  readXboxGames,
} from "./game-catalogue.js";

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

interface Fixture {
  readonly entries?: readonly string[];
  readonly files?: Record<string, string>;
  readonly missingDirectory?: true;
  /** One seam answer per directory; a directory absent here throws ENOENT. */
  readonly directories?: Record<string, readonly string[]>;
  /** The parsed answer the PowerShell seam hands back. */
  readonly gog?: unknown;
}

function seamsOf(fixture: Fixture): CatalogueSeams {
  return {
    readFile: async (file) => {
      const text = fixture.files?.[file];

      if (text === undefined) throw new Error(`ENOENT: ${file}`);
      return text;
    },
    readdir: async (dir) => {
      const entries = fixture.directories?.[dir];

      if (entries !== undefined) return entries;
      if (dir !== MANIFEST_DIR) throw new Error(`unexpected directory: ${dir}`);
      if (fixture.missingDirectory === true) throw new Error(`ENOENT: ${dir}`);
      return fixture.entries ?? [];
    },
    programData: "C:\\ProgramData",
    appData: "C:\\Users\\player\\AppData\\Roaming",
    runPowerShell: async () => fixture.gog,
    steamApps: async () => [],
    xboxRoot: "C:\\XboxGames",
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

  it("keeps a game whose MainGameAppName is empty", async () => {
    const seams = seamsOf({
      entries: ["HeardInstalling.item"],
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

/**
 * GOG keeps its installs in one registry key, read through a single PowerShell
 * call. The fixtures hand the reader the parsed answer directly, so no test
 * reads this machine's registry.
 */
describe("readGogGames", () => {
  it("enumerates the GOG key in one PowerShell call", async () => {
    const scripts: string[] = [];
    const seams = {
      ...seamsOf({ gog: [] }),
      runPowerShell: async (script: string) => {
        scripts.push(script);
        return [];
      },
    };

    await readGogGames(seams);

    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain("GOG.com\\Games");
  });

  it("resolves a GOG entry's exe under its install path", async () => {
    const seams = seamsOf({
      gog: [
        {
          gameName: "Disco Elysium",
          path: "C:\\Games\\Disco Elysium",
          exe: "disco.exe",
          dependsOn: "",
        },
      ],
    });

    await expect(readGogGames(seams)).resolves.toEqual([
      {
        source: "gog",
        name: "Disco Elysium",
        installDir: "C:\\Games\\Disco Elysium",
        exes: ["C:\\Games\\Disco Elysium\\disco.exe"],
      },
    ]);
  });

  it("skips a DLC whose dependsOn names a parent", async () => {
    const seams = seamsOf({
      gog: [
        {
          gameName: "Disco Elysium Soundtrack",
          path: "C:\\Games\\Disco Elysium",
          exe: "disco.exe",
          dependsOn: "Disco Elysium",
        },
      ],
    });

    await expect(readGogGames(seams)).resolves.toEqual([]);
  });

  it("reports no executables for an entry without exe", async () => {
    const seams = seamsOf({
      gog: [{ gameName: "Launcher Only", path: "C:\\Games\\Launcher" }],
    });

    await expect(readGogGames(seams)).resolves.toEqual([
      {
        source: "gog",
        name: "Launcher Only",
        installDir: "C:\\Games\\Launcher",
        exes: [],
      },
    ]);
  });

  it("treats a registry answer that is not JSON as an empty list", async () => {
    const seams = seamsOf({ gog: undefined });

    await expect(readGogGames(seams)).resolves.toEqual([]);
  });

  it("treats a PowerShell rejection as an empty list", async () => {
    const seams = {
      ...seamsOf({}),
      runPowerShell: async () => {
        throw new Error("registry unavailable");
      },
    };

    await expect(readGogGames(seams)).resolves.toEqual([]);
  });
});

const XBOX_ROOT = "C:\\XboxGames";
const XBOX_CONTENT = `${XBOX_ROOT}\\Forza\\Content`;

const XBOX_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<Game configVersion="1">
  <ExecutableList>
    <Executable Name="Forza.exe" />
  </ExecutableList>
</Game>`;

describe("readXboxGames", () => {
  it("reads a title whose MicrosoftGame.config names its executable", async () => {
    const seams = seamsOf({
      directories: {
        [XBOX_ROOT]: ["Forza"],
        [XBOX_CONTENT]: ["Forza.exe", "readme.txt"],
      },
      files: { [`${XBOX_CONTENT}\\MicrosoftGame.config`]: XBOX_CONFIG },
    });

    await expect(readXboxGames(seams)).resolves.toEqual([
      {
        source: "xbox",
        name: "Forza",
        installDir: XBOX_CONTENT,
        exes: [`${XBOX_CONTENT}\\Forza.exe`],
      },
    ]);
  });

  it("falls back to the sole exe under Content when there is no config", async () => {
    const seams = seamsOf({
      directories: {
        [XBOX_ROOT]: ["Grounded"],
        [`${XBOX_ROOT}\\Grounded\\Content`]: ["Grounded.exe", "data.pak"],
      },
    });

    await expect(readXboxGames(seams)).resolves.toEqual([
      {
        source: "xbox",
        name: "Grounded",
        installDir: `${XBOX_ROOT}\\Grounded\\Content`,
        exes: [`${XBOX_ROOT}\\Grounded\\Content\\Grounded.exe`],
      },
    ]);
  });

  it("skips a title with several executables and no config", async () => {
    const seams = seamsOf({
      directories: {
        [XBOX_ROOT]: ["Bundle"],
        [`${XBOX_ROOT}\\Bundle\\Content`]: ["a.exe", "b.exe"],
      },
    });

    await expect(readXboxGames(seams)).resolves.toEqual([]);
  });

  it("treats a missing Xbox root as an empty list", async () => {
    const seams = seamsOf({ directories: {} });

    await expect(readXboxGames(seams)).resolves.toEqual([]);
  });
});
