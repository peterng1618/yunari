import type { InstalledGame } from "./catalogue.js";
import { type CatalogueSeams, textField } from "./seams.js";

/**
 * One call spans the 32- and 64-bit views under both HKLM and HKCU. `Select`
 * trims each key to the three fields the catalogue reads.
 */
const UNINSTALL_REGISTRY_SCRIPT =
  "$keys = @(" +
  "'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', " +
  "'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', " +
  "'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', " +
  "'HKCU:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'" +
  "); " +
  "$games = Get-ItemProperty -Path $keys -ErrorAction SilentlyContinue | " +
  "Select-Object DisplayName, InstallLocation, DisplayIcon; " +
  "ConvertTo-Json -InputObject @($games) -Compress";

const DISPLAY_ICON_INDEX = /,\s*-?\d+\s*$/;

/** `DisplayIcon` usually carries a `,<resource index>` suffix, not a path. */
function uninstallExecutable(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;

  const withoutIndex = value.replace(DISPLAY_ICON_INDEX, "").trim();
  const withoutQuotes = withoutIndex.replace(/^"(.*)"$/, "$1").trim();

  return withoutQuotes.toLowerCase().endsWith(".exe")
    ? withoutQuotes
    : undefined;
}

/**
 * Every installed program the uninstall keys describe. Name filtering belongs
 * to the classifier, so a non-game title is still returned here; an entry with
 * no name or install location is the only thing skipped.
 */
export async function readUninstallGames(
  seams: CatalogueSeams,
): Promise<readonly InstalledGame[]> {
  let answer: unknown;

  try {
    answer = await seams.runPowerShell(UNINSTALL_REGISTRY_SCRIPT);
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

    const name = textField(record, "DisplayName");
    const installDir = textField(record, "InstallLocation");

    if (name === undefined || installDir === undefined) continue;

    const executable = uninstallExecutable(textField(record, "DisplayIcon"));

    games.push({
      source: "uninstall",
      name,
      installDir,
      exes: executable === undefined ? [] : [executable],
    });
  }

  return games;
}
