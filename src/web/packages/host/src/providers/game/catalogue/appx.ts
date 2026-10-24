import path from "node:path";
import type { InstalledGame } from "./catalogue.js";
import { executableFromGameConfig, GAME_CONFIG_FILE } from "./game-config.js";
import { type CatalogueSeams, isTrueFlag, textField } from "./seams.js";

/**
 * One projection over every package. `PackageFullName` is carried so a caller
 * can identify a package whose install path is ambiguous. The config probe runs
 * in the same call, so a catalogue read is still one PowerShell invocation.
 */
const APPX_SCRIPT =
  "$packages = Get-AppxPackage -ErrorAction SilentlyContinue | " +
  "ForEach-Object { [pscustomobject]@{ " +
  "Name = $_.Name; " +
  "PackageFullName = $_.PackageFullName; " +
  "InstallLocation = $_.InstallLocation; " +
  "IsFramework = $_.IsFramework; " +
  "HasConfig = [bool]($_.InstallLocation -and " +
  "(Test-Path -LiteralPath " +
  "(Join-Path $_.InstallLocation 'MicrosoftGame.config'))) } }; " +
  "ConvertTo-Json -InputObject @($packages) -Compress";

/** A GDK package names its launcher in the config; an unreadable one has none. */
async function appxExecutables(
  seams: CatalogueSeams,
  installDir: string,
): Promise<readonly string[]> {
  let text: string;

  try {
    text = await seams.readFile(path.win32.join(installDir, GAME_CONFIG_FILE));
  } catch {
    return [];
  }

  const executable = executableFromGameConfig(text);

  if (executable === undefined) return [];

  return [
    path.win32.isAbsolute(executable)
      ? executable
      : path.win32.join(installDir, executable),
  ];
}

/**
 * Microsoft Store and Game Pass packages, GDK titles only: a package without
 * `MicrosoftGame.config` is an ordinary Store app, not a game. `name` is the
 * package `Name` (`Microsoft.ForzaHorizon5`); the AppxManifest `DisplayName` is
 * not read because it is usually an unresolvable `ms-resource:` token. A
 * framework package or one with no install location is not a game and is
 * skipped too.
 */
export async function readAppxGames(
  seams: CatalogueSeams,
): Promise<readonly InstalledGame[]> {
  let answer: unknown;

  try {
    answer = await seams.runPowerShell(APPX_SCRIPT);
  } catch {
    return [];
  }

  if (!Array.isArray(answer)) return [];

  const games: InstalledGame[] = [];

  for (const entry of answer) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      continue;
    }

    const record = entry as Record<string, unknown>;

    if (isTrueFlag(record["IsFramework"])) continue;
    if (!isTrueFlag(record["HasConfig"])) continue;

    const name = textField(record, "Name");
    const installDir = textField(record, "InstallLocation");

    if (name === undefined || installDir === undefined) continue;

    games.push({
      source: "appx",
      name,
      installDir,
      exes: await appxExecutables(seams, installDir),
    });
  }

  return games;
}
