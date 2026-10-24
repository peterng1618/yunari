import { describe, expect, it } from "vitest";
import {
  matchProcess,
  parseAppManifest,
  parseLibraryFolders,
  type SteamApp,
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
