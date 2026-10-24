import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  matchProcess,
  parseAppManifest,
  parseLibraryFolders,
  readSteamApps,
  resolveSteamRoot,
  type SteamApp,
  type SteamRootExec,
} from "./steam-library.js";

/**
 * The fixtures are the shapes this machine's Steam install writes: tabs between
 * a quoted key and its quoted value, escaped backslashes in paths, and one
 * nested block per library.
 */
const LIBRARY_FOLDERS = `"libraryfolders"
{
\t"0"
\t{
\t\t"path"\t\t"D:\\\\Games\\\\Steam"
\t\t"label"\t\t""
\t\t"apps"
\t\t{
\t\t\t"10"\t\t"318799907"
\t\t}
\t}
\t"1"
\t{
\t\t"path"\t\t"E:\\\\Steam Library"
\t\t"label"\t\t""
\t\t"apps"
\t\t{
\t\t\t"400"\t\t"0"
\t\t}
\t}
}
`;

const APP_MANIFEST = `"AppState"
{
\t"appid"\t\t"10"
\t"Universe"\t\t"1"
\t"LauncherPath"\t\t"d:\\\\games\\\\steam\\\\steam.exe"
\t"name"\t\t"Counter-Strike"
\t"installdir"\t\t"Half-Life"
\t"StateFlags"\t\t"4"
}
`;

function app(installDir: string): SteamApp {
  return { appId: "10", name: "Counter-Strike", installDir };
}

describe("parseLibraryFolders", () => {
  it("survives tabs, escaped backslashes and a quoted path with spaces", () => {
    expect(parseLibraryFolders(LIBRARY_FOLDERS, "D:\\Games\\Steam")).toEqual([
      "D:\\Games\\Steam",
      "E:\\Steam Library",
    ]);
  });

  it("falls back to the Steam root when the file cannot be parsed", () => {
    expect(parseLibraryFolders("not vdf at all", "D:\\Games\\Steam")).toEqual([
      "D:\\Games\\Steam",
    ]);
    expect(parseLibraryFolders("", "D:\\Games\\Steam")).toEqual([
      "D:\\Games\\Steam",
    ]);
  });

  it("reads the older flat mapping where the number is the path", () => {
    const vdf = `"libraryfolders"
{
\t"TimeNextStatsReport"\t\t"1"
\t"1"\t\t"E:\\\\Steam Library"
}
`;

    expect(parseLibraryFolders(vdf, "D:\\Games\\Steam")).toEqual([
      "E:\\Steam Library",
    ]);
  });
});

describe("parseAppManifest", () => {
  it("yields the app id, name and relative install directory", () => {
    expect(parseAppManifest(APP_MANIFEST)).toEqual({
      appId: "10",
      name: "Counter-Strike",
      installDir: "Half-Life",
    });
  });

  it("trims the values it returns", () => {
    expect(
      parseAppManifest(
        '"AppState" { "appid" " 10 " "name" " Counter-Strike " "installdir" " Half-Life " }',
      ),
    ).toEqual({
      appId: "10",
      name: "Counter-Strike",
      installDir: "Half-Life",
    });
  });

  it("is undefined for a malformed manifest rather than a partial app", () => {
    expect(parseAppManifest('"AppState" { "appid" "10" }')).toBeUndefined();
    expect(
      parseAppManifest('"AppState" { "name" "Counter-Strike" }'),
    ).toBeUndefined();
    expect(
      parseAppManifest('"AppState" { "appid" "10" "name" "Counter-Strike" }'),
    ).toBeUndefined();
    expect(parseAppManifest("")).toBeUndefined();
  });
});

describe("matchProcess", () => {
  const installDir = "D:\\Games\\Steam\\steamapps\\common\\Half-Life";

  it("matches case-insensitively on Windows paths", () => {
    expect(
      matchProcess("d:\\games\\steam\\STEAMAPPS\\common\\half-life\\hl.exe", [
        app(installDir),
      ])?.appId,
    ).toBe("10");
  });

  it("requires a whole path segment, so Half-Life2 is not inside Half-Life", () => {
    expect(
      matchProcess("D:\\Games\\Steam\\steamapps\\common\\Half-Life2\\hl2.exe", [
        app(installDir),
      ]),
    ).toBeUndefined();
  });

  it("rejects a path outside every install directory", () => {
    expect(
      matchProcess("C:\\Games\\Other\\other.exe", [app(installDir)]),
    ).toBeUndefined();
  });

  it("chooses the deepest install directory when one contains another", () => {
    const nested = `${installDir}\\episode`;
    const apps = [
      { appId: "10", name: "Half-Life", installDir },
      { appId: "20", name: "Episode", installDir: nested },
    ];

    expect(matchProcess(`${nested}\\hl.exe`, apps)?.appId).toBe("20");
  });
});

describe("readSteamApps", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "yunari-steam-apps-"));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  function vdfPath(target: string): string {
    return target.replaceAll("\\", "\\\\");
  }

  async function writeManifest(
    directory: string,
    file: string,
    fields: Readonly<Record<string, string>>,
  ): Promise<void> {
    const body = Object.entries(fields)
      .map(([key, value]) => `\t"${key}"\t\t"${value}"`)
      .join("\n");

    await fs.writeFile(
      path.join(directory, file),
      `"AppState"\n{\n${body}\n}\n`,
    );
  }

  it("walks the root and a listed library, joins installdir and ignores non-manifests", async () => {
    const steamRoot = path.join(tmp, "steam");
    const second = path.join(tmp, "library-b");
    const rootApps = path.join(steamRoot, "steamapps");
    const secondApps = path.join(second, "steamapps");

    await fs.mkdir(rootApps, { recursive: true });
    await fs.mkdir(secondApps, { recursive: true });

    await fs.writeFile(
      path.join(rootApps, "libraryfolders.vdf"),
      `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${vdfPath(steamRoot)}"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"${vdfPath(second)}"\n\t}\n}\n`,
    );

    await writeManifest(rootApps, "appmanifest_10.acf", {
      appid: "10",
      name: "Counter-Strike",
      installdir: "Half-Life",
    });
    await writeManifest(rootApps, "appmanifest_20.acf", {
      appid: "20",
      name: "Kind Words",
      installdir: "Kind Words",
    });
    await writeManifest(secondApps, "appmanifest_400.acf", {
      appid: "400",
      name: "Portal 2",
      installdir: "Portal 2",
    });
    await fs.writeFile(
      path.join(rootApps, "appmanifest_bad.acf"),
      '"AppState" { "appid" "999" }',
    );
    await fs.writeFile(path.join(rootApps, "notes.txt"), "ignored");
    await fs.mkdir(path.join(rootApps, "appmanifest_98.acf"));

    const apps = await readSteamApps(steamRoot);
    const byId = new Map(apps.map((app) => [app.appId, app]));

    expect([...byId.keys()].sort()).toEqual(["10", "20", "400"]);
    expect(byId.get("10")?.installDir).toBe(
      path.join(rootApps, "common", "Half-Life"),
    );
    expect(byId.get("400")?.installDir).toBe(
      path.join(secondApps, "common", "Portal 2"),
    );
    expect(byId.get("20")?.name).toBe("Kind Words");
  });

  it("answers no apps when the Steam root does not exist", async () => {
    expect(await readSteamApps(path.join(tmp, "missing"))).toEqual([]);
  });
});

describe("resolveSteamRoot", () => {
  it("returns the registry root, including the forward-slash form", async () => {
    const calls: { executable: string; args: readonly string[] }[] = [];
    const exec: SteamRootExec = async (executable, args) => {
      calls.push({ executable, args });
      return '{"kind":"steam","root":"d:/games/steam"}\n';
    };

    expect(await resolveSteamRoot({ pathExists: () => true, exec })).toBe(
      "d:/games/steam",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toContain("-EncodedCommand");
  });

  it("answers undefined for a failed run", async () => {
    expect(
      await resolveSteamRoot({
        pathExists: () => true,
        exec: async () => undefined,
      }),
    ).toBeUndefined();
  });

  it("answers undefined for a rejecting run", async () => {
    await expect(
      resolveSteamRoot({
        pathExists: () => true,
        exec: async () => {
          throw new Error("registry read failed");
        },
      }),
    ).resolves.toBeUndefined();
  });

  it("does not run PowerShell when it is absent", async () => {
    let ran = false;

    expect(
      await resolveSteamRoot({
        pathExists: () => false,
        exec: async () => {
          ran = true;
          return undefined;
        },
      }),
    ).toBeUndefined();
    expect(ran).toBe(false);
  });
});
