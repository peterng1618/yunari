import { describe, expect, it } from "vitest";
import { readGogGames } from "./gog.js";
import { seamsOf } from "./test-seams.js";

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
