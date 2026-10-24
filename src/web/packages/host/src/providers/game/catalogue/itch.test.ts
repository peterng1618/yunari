import { describe, expect, it } from "vitest";
import { readItchGames } from "./itch.js";
import { seamsOf } from "./test-seams.js";

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
