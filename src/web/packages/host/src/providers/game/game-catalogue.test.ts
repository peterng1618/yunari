import { describe, expect, it } from "vitest";
import {
  type CatalogueSeams,
  readEpicGames,
  readGogGames,
  readItchGames,
  readUninstallGames,
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
  readonly powerShell?: unknown;
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
    runPowerShell: async () => fixture.powerShell,
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
      ...seamsOf({ powerShell: [] }),
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
      powerShell: [
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
      powerShell: [
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

  it("skips an entry with an empty gameName or no path", async () => {
    const seams = seamsOf({
      powerShell: [
        { gameName: "", path: "C:\\Games\\Nameless", exe: "a.exe" },
        { gameName: "Pathless", exe: "b.exe" },
      ],
    });

    await expect(readGogGames(seams)).resolves.toEqual([]);
  });

  it("keeps an absolute exe as-is", async () => {
    const seams = seamsOf({
      powerShell: [
        {
          gameName: "Portable",
          path: "C:\\Games\\Portable",
          exe: "D:\\Elsewhere\\portable.exe",
        },
      ],
    });

    const games = await readGogGames(seams);

    expect(games[0]?.exes).toEqual(["D:\\Elsewhere\\portable.exe"]);
  });

  it("skips an answer's non-object entries", async () => {
    const seams = seamsOf({
      powerShell: [
        null,
        7,
        {
          gameName: "Disco Elysium",
          path: "C:\\Games\\Disco Elysium",
          exe: "disco.exe",
        },
      ],
    });

    const games = await readGogGames(seams);

    expect(games).toHaveLength(1);
    expect(games[0]?.name).toBe("Disco Elysium");
  });

  it("reports no executables for an entry without exe", async () => {
    const seams = seamsOf({
      powerShell: [{ gameName: "Launcher Only", path: "C:\\Games\\Launcher" }],
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
    const seams = seamsOf({ powerShell: undefined });

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
    <Executable Name="Forza.exe" TargetDeviceType="PC" />
  </ExecutableList>
</Game>`;

/** A commented-out executable must not win over the live one. */
const COMMENTED_XBOX_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<Game configVersion="1">
  <!-- <Executable Name="old.exe" /> -->
  <ExecutableList>
    <Executable Name="Forza.exe" TargetDeviceType="PC" />
  </ExecutableList>
</Game>`;

describe("readXboxGames", () => {
  it("reads a title whose MicrosoftGame.config names its executable", async () => {
    const seams = seamsOf({
      directories: {
        [XBOX_ROOT]: ["Forza"],
        [XBOX_CONTENT]: ["Forza.exe", "ForzaHelper.exe", "readme.txt"],
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

  it("ignores a commented-out executable", async () => {
    const seams = seamsOf({
      directories: {
        [XBOX_ROOT]: ["Forza"],
        [XBOX_CONTENT]: ["Forza.exe", "old.exe"],
      },
      files: {
        [`${XBOX_CONTENT}\\MicrosoftGame.config`]: COMMENTED_XBOX_CONFIG,
      },
    });

    const games = await readXboxGames(seams);

    expect(games[0]?.exes).toEqual([`${XBOX_CONTENT}\\Forza.exe`]);
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

/**
 * itch keeps one directory per installed app under its own `apps` directory.
 * A `.itch.toml` names it and points at the launcher; without one, the folder's
 * own executables are all the reader has.
 */
const ITCH_ROOT = "C:\\Users\\player\\AppData\\Roaming\\itch\\apps";
/** The folder name and the manifest's name differ, so only the latter can pass. */
const ITCH_APP = `${ITCH_ROOT}\\baba-is-you`;

const ITCH_MANIFEST_TOML = `[app]
name = "Baba Is You"
[[actions]]
name = "Play"
path = "Baba Is You.exe"
[[actions]]
name = "Settings"
path = "settings.exe"
`;

describe("readItchGames", () => {
  it("reads an app's .itch.toml name and first action path", async () => {
    const seams = seamsOf({
      directories: { [ITCH_ROOT]: ["baba-is-you"] },
      files: { [`${ITCH_APP}\\.itch.toml`]: ITCH_MANIFEST_TOML },
    });

    await expect(readItchGames(seams)).resolves.toEqual([
      {
        source: "itch",
        name: "Baba Is You",
        installDir: ITCH_APP,
        exes: [`${ITCH_APP}\\Baba Is You.exe`],
      },
    ]);
  });

  it("reads a root exe key", async () => {
    const seams = seamsOf({
      directories: { [ITCH_ROOT]: ["Launchpad"] },
      files: {
        [`${ITCH_ROOT}\\Launchpad\\.itch.toml`]: [
          'name = "Launchpad"',
          'exe = "start.exe"',
        ].join("\n"),
      },
    });

    await expect(readItchGames(seams)).resolves.toEqual([
      {
        source: "itch",
        name: "Launchpad",
        installDir: `${ITCH_ROOT}\\Launchpad`,
        exes: [`${ITCH_ROOT}\\Launchpad\\start.exe`],
      },
    ]);
  });

  it("unescapes a TOML-escaped Windows path", async () => {
    const seams = seamsOf({
      directories: { [ITCH_ROOT]: ["Escaped"] },
      files: {
        [`${ITCH_ROOT}\\Escaped\\.itch.toml`]:
          '[[actions]]\npath = "C:\\\\Games\\\\g.exe"',
      },
    });

    await expect(readItchGames(seams)).resolves.toEqual([
      {
        source: "itch",
        name: "Escaped",
        installDir: `${ITCH_ROOT}\\Escaped`,
        exes: ["C:\\Games\\g.exe"],
      },
    ]);
  });

  it("keeps an app whose manifest names no executable", async () => {
    const seams = seamsOf({
      directories: { [ITCH_ROOT]: ["No Launcher"] },
      files: {
        [`${ITCH_ROOT}\\No Launcher\\.itch.toml`]:
          '[app]\nname = "No Launcher"',
      },
    });

    await expect(readItchGames(seams)).resolves.toEqual([
      {
        source: "itch",
        name: "No Launcher",
        installDir: `${ITCH_ROOT}\\No Launcher`,
        exes: [],
      },
    ]);
  });

  it("falls back to the app folder's own executables without a manifest", async () => {
    const seams = seamsOf({
      directories: {
        [ITCH_ROOT]: ["Scanned"],
        [`${ITCH_ROOT}\\Scanned`]: [
          "Game.exe",
          "readme.txt",
          "tool.EXE",
          "sub",
        ],
        [`${ITCH_ROOT}\\Scanned\\sub`]: ["nested.exe"],
      },
    });

    await expect(readItchGames(seams)).resolves.toEqual([
      {
        source: "itch",
        name: "Scanned",
        installDir: `${ITCH_ROOT}\\Scanned`,
        exes: [
          `${ITCH_ROOT}\\Scanned\\Game.exe`,
          `${ITCH_ROOT}\\Scanned\\tool.EXE`,
        ],
      },
    ]);
  });

  it("skips a manifest-less folder with no executable", async () => {
    const seams = seamsOf({
      directories: {
        [ITCH_ROOT]: ["Empty"],
        [`${ITCH_ROOT}\\Empty`]: ["readme.txt"],
      },
    });

    await expect(readItchGames(seams)).resolves.toEqual([]);
  });

  it("treats a missing itch root as an empty list", async () => {
    const seams = seamsOf({ directories: {} });

    await expect(readItchGames(seams)).resolves.toEqual([]);
  });
});

/**
 * The uninstall keys are one PowerShell read for the whole machine. DisplayIcon
 * carries an optional `,<resource index>` suffix, not a path.
 */
describe("readUninstallGames", () => {
  it("enumerates all four uninstall keys in one PowerShell call", async () => {
    const scripts: string[] = [];
    const seams = {
      ...seamsOf({ powerShell: [] }),
      runPowerShell: async (script: string) => {
        scripts.push(script);
        return [];
      },
    };

    await readUninstallGames(seams);

    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain(
      "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    );
    expect(scripts[0]).toContain(
      "HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    );
    expect(scripts[0]).toContain(
      "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    );
    expect(scripts[0]).toContain(
      "HKCU:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    );
  });

  it("strips DisplayIcon's resource index to name the executable", async () => {
    const seams = seamsOf({
      powerShell: [
        {
          DisplayName: "A Game",
          InstallLocation: "C:\\Games\\G",
          DisplayIcon: "C:\\Games\\G\\g.exe,0",
        },
        {
          DisplayName: "Quoted Index",
          InstallLocation: "C:\\Games\\Q",
          DisplayIcon: '"C:\\Games\\Q\\q.exe",0',
        },
        {
          DisplayName: "Quoted Only",
          InstallLocation: "C:\\Games\\R",
          DisplayIcon: '"C:\\Games\\R\\r.exe"',
        },
      ],
    });

    await expect(readUninstallGames(seams)).resolves.toEqual([
      {
        source: "uninstall",
        name: "A Game",
        installDir: "C:\\Games\\G",
        exes: ["C:\\Games\\G\\g.exe"],
      },
      {
        source: "uninstall",
        name: "Quoted Index",
        installDir: "C:\\Games\\Q",
        exes: ["C:\\Games\\Q\\q.exe"],
      },
      {
        source: "uninstall",
        name: "Quoted Only",
        installDir: "C:\\Games\\R",
        exes: ["C:\\Games\\R\\r.exe"],
      },
    ]);
  });

  it("skips an entry with an empty DisplayName or InstallLocation", async () => {
    const seams = seamsOf({
      powerShell: [
        { DisplayName: "", InstallLocation: "C:\\Games\\Nameless" },
        { DisplayName: "Pathless", DisplayIcon: "C:\\Games\\B\\b.exe" },
      ],
    });

    await expect(readUninstallGames(seams)).resolves.toEqual([]);
  });

  it("skips non-object entries and keeps a valid neighbour", async () => {
    const seams = seamsOf({
      powerShell: [
        null,
        7,
        {
          DisplayName: "A Game",
          InstallLocation: "C:\\Games\\G",
          DisplayIcon: "C:\\Games\\G\\g.exe",
        },
      ],
    });

    const games = await readUninstallGames(seams);

    expect(games).toHaveLength(1);
    expect(games[0]?.name).toBe("A Game");
  });

  it("keeps a non-game DisplayName; filtering is the classifier's job", async () => {
    const seams = seamsOf({
      powerShell: [
        {
          DisplayName: "Google Update",
          InstallLocation: "C:\\Program Files\\Google\\Update",
          DisplayIcon: "C:\\Program Files\\Google\\Update\\GoogleUpdate.exe",
        },
      ],
    });

    const games = await readUninstallGames(seams);

    expect(games).toHaveLength(1);
    expect(games[0]?.name).toBe("Google Update");
  });

  it("reports no executables when DisplayIcon is not an exe", async () => {
    const seams = seamsOf({
      powerShell: [
        {
          DisplayName: "Icon Only",
          InstallLocation: "C:\\Games\\Icon",
          DisplayIcon: "C:\\Games\\Icon\\icon.ico",
        },
      ],
    });

    await expect(readUninstallGames(seams)).resolves.toEqual([
      {
        source: "uninstall",
        name: "Icon Only",
        installDir: "C:\\Games\\Icon",
        exes: [],
      },
    ]);
  });

  it("treats an answer that is not an array as an empty list", async () => {
    const seams = seamsOf({ powerShell: { DisplayName: "One Object" } });

    await expect(readUninstallGames(seams)).resolves.toEqual([]);
  });

  it("treats a PowerShell rejection as an empty list", async () => {
    const seams = {
      ...seamsOf({}),
      runPowerShell: async () => {
        throw new Error("registry unavailable");
      },
    };

    await expect(readUninstallGames(seams)).resolves.toEqual([]);
  });
});
