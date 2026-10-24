import { describe, expect, it } from "vitest";
import { readAppxGames } from "./appx.js";
import { seamsOf } from "./test-seams.js";

/**
 * Microsoft Store and Game Pass packages come from `Get-AppxPackage`. The GDK
 * titles among them name their launcher in `MicrosoftGame.config`, which the
 * same reader also sees for Xbox.
 */
const APPX_INSTALL =
  "C:\\Program Files\\WindowsApps\\Microsoft.ForzaHorizon5_1.0.0.0_x64__8wekyb3d8bbwe";

const APPX_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<Game configVersion="1">
  <ExecutableList>
    <Executable Name="ForzaHorizon5.exe" TargetDeviceType="PC" />
  </ExecutableList>
</Game>`;

describe("readAppxGames", () => {
  it("enumerates Get-AppxPackage and its config probe in one PowerShell call", async () => {
    const scripts: string[] = [];
    const seams = {
      ...seamsOf({ powerShell: [] }),
      runPowerShell: async (script: string) => {
        scripts.push(script);
        return [];
      },
    };

    await readAppxGames(seams);

    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain("Get-AppxPackage");
    expect(scripts[0]).toContain("MicrosoftGame.config");
    expect(scripts[0]).toContain("ConvertTo-Json -InputObject @(");
  });

  it("skips a package without MicrosoftGame.config", async () => {
    const seams = seamsOf({
      powerShell: [
        {
          Name: "Microsoft.Edge",
          InstallLocation: "C:\\Program Files\\WindowsApps\\Microsoft.Edge",
          IsFramework: false,
          HasConfig: false,
        },
        {
          Name: "Microsoft.ForzaHorizon5",
          InstallLocation: APPX_INSTALL,
          IsFramework: false,
          HasConfig: true,
        },
      ],
      files: { [`${APPX_INSTALL}\\MicrosoftGame.config`]: APPX_CONFIG },
    });

    await expect(readAppxGames(seams)).resolves.toEqual([
      {
        source: "appx",
        name: "Microsoft.ForzaHorizon5",
        installDir: APPX_INSTALL,
        exes: [`${APPX_INSTALL}\\ForzaHorizon5.exe`],
      },
    ]);
  });

  it("skips a package whose config flag is absent", async () => {
    const seams = seamsOf({
      powerShell: [
        {
          Name: "Microsoft.NoProbe",
          InstallLocation: "C:\\Program Files\\WindowsApps\\Microsoft.NoProbe",
          IsFramework: false,
        },
      ],
    });

    await expect(readAppxGames(seams)).resolves.toEqual([]);
  });

  it("skips framework packages, whether boolean or string", async () => {
    const seams = seamsOf({
      powerShell: [
        {
          Name: "Microsoft.VCLibs",
          InstallLocation: "C:\\Program Files\\WindowsApps\\Microsoft.VCLibs",
          IsFramework: true,
        },
        {
          Name: "Microsoft.NET.Native.Runtime",
          InstallLocation:
            "C:\\Program Files\\WindowsApps\\Microsoft.NET.Native.Runtime",
          IsFramework: "True",
        },
        {
          Name: "Microsoft.ForzaHorizon5",
          InstallLocation: APPX_INSTALL,
          IsFramework: "False",
          HasConfig: true,
        },
      ],
    });

    const games = await readAppxGames(seams);

    expect(games).toHaveLength(1);
    expect(games[0]?.name).toBe("Microsoft.ForzaHorizon5");
  });

  it("skips a package with no install location", async () => {
    const seams = seamsOf({
      powerShell: [
        {
          Name: "Microsoft.MissingLocation",
          IsFramework: false,
          HasConfig: true,
        },
        {
          Name: "Microsoft.BlankLocation",
          InstallLocation: "  ",
          IsFramework: false,
          HasConfig: true,
        },
        {
          Name: "Microsoft.ForzaHorizon5",
          InstallLocation: APPX_INSTALL,
          IsFramework: false,
          HasConfig: true,
        },
      ],
    });

    const games = await readAppxGames(seams);

    expect(games).toHaveLength(1);
    expect(games[0]?.name).toBe("Microsoft.ForzaHorizon5");
  });

  it("takes the executable from a GDK MicrosoftGame.config", async () => {
    const seams = seamsOf({
      powerShell: [
        {
          Name: "Microsoft.ForzaHorizon5",
          InstallLocation: APPX_INSTALL,
          IsFramework: false,
          HasConfig: true,
        },
      ],
      files: { [`${APPX_INSTALL}\\MicrosoftGame.config`]: APPX_CONFIG },
    });

    await expect(readAppxGames(seams)).resolves.toEqual([
      {
        source: "appx",
        name: "Microsoft.ForzaHorizon5",
        installDir: APPX_INSTALL,
        exes: [`${APPX_INSTALL}\\ForzaHorizon5.exe`],
      },
    ]);
  });

  it("keeps a package whose config exists but is denied", async () => {
    const seams = {
      ...seamsOf({
        powerShell: [
          {
            Name: "Microsoft.ForzaHorizon5",
            InstallLocation: APPX_INSTALL,
            IsFramework: false,
            HasConfig: true,
          },
        ],
        files: { [`${APPX_INSTALL}\\MicrosoftGame.config`]: APPX_CONFIG },
      }),
      readFile: async () => {
        throw Object.assign(new Error("EACCES: permission denied"), {
          code: "EACCES",
        });
      },
    };

    await expect(readAppxGames(seams)).resolves.toEqual([
      {
        source: "appx",
        name: "Microsoft.ForzaHorizon5",
        installDir: APPX_INSTALL,
        exes: [],
      },
    ]);
  });

  it("keeps an absolute executable from the config as-is", async () => {
    const config = `<Game><ExecutableList><Executable Name="D:\\Games\\Launcher\\game.exe" /></ExecutableList></Game>`;
    const seams = seamsOf({
      powerShell: [
        {
          Name: "Microsoft.ForzaHorizon5",
          InstallLocation: APPX_INSTALL,
          IsFramework: false,
          HasConfig: true,
        },
      ],
      files: { [`${APPX_INSTALL}\\MicrosoftGame.config`]: config },
    });

    await expect(readAppxGames(seams)).resolves.toEqual([
      {
        source: "appx",
        name: "Microsoft.ForzaHorizon5",
        installDir: APPX_INSTALL,
        exes: ["D:\\Games\\Launcher\\game.exe"],
      },
    ]);
  });

  it("treats an answer that is not an array as an empty list", async () => {
    const seams = seamsOf({
      powerShell: { Name: "One Object", InstallLocation: APPX_INSTALL },
    });

    await expect(readAppxGames(seams)).resolves.toEqual([]);
  });

  it("treats a PowerShell rejection as an empty list", async () => {
    const seams = {
      ...seamsOf({}),
      runPowerShell: async () => {
        throw new Error("appx unavailable");
      },
    };

    await expect(readAppxGames(seams)).resolves.toEqual([]);
  });
});
