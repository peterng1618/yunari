import { describe, expect, it } from "vitest";
import { seamsOf } from "./test-seams.js";
import { readXboxGames } from "./xbox.js";

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
