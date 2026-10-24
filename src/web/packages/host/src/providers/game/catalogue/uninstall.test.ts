import { describe, expect, it } from "vitest";
import { seamsOf } from "./test-seams.js";
import { readUninstallGames } from "./uninstall.js";

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
