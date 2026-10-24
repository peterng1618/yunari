import type { CatalogueSeams } from "./seams.js";

/** The fixture shape every source test drives the seams with. */
export interface Fixture {
  readonly files?: Record<string, string>;
  /** One answer per directory; a directory absent here throws ENOENT. */
  readonly directories?: Record<string, readonly string[]>;
  /** The parsed answer the PowerShell seam hands back. */
  readonly powerShell?: unknown;
}

export function seamsOf(fixture: Fixture): CatalogueSeams {
  return {
    readFile: async (file) => {
      const text = fixture.files?.[file];

      if (text === undefined) throw new Error(`ENOENT: ${file}`);
      return text;
    },
    readdir: async (dir) => {
      const entries = fixture.directories?.[dir];

      if (entries === undefined)
        throw new Error(`unexpected directory: ${dir}`);
      return entries;
    },
    programData: "C:\\ProgramData",
    appData: "C:\\Users\\player\\AppData\\Roaming",
    runPowerShell: async () => fixture.powerShell,
    steamApps: async () => [],
    xboxRoot: "C:\\XboxGames",
  };
}
