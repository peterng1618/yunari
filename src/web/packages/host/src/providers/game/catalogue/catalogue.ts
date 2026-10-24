import path from "node:path";
import { readAppxGames } from "./appx.js";
import { readEpicGames } from "./epic.js";
import { readGogGames } from "./gog.js";
import { readItchGames } from "./itch.js";
import type { CatalogueSeams } from "./seams.js";
import { readSteamGames } from "./steam.js";
import { readXboxGames } from "./xbox.js";

export interface InstalledGame {
  readonly source: "steam" | "epic" | "gog" | "itch" | "xbox" | "appx";
  readonly name: string;
  readonly installDir: string;
  readonly exes: readonly string[];
}

function normalised(value: string): string {
  return path.win32.normalize(value).toLowerCase();
}

/**
 * Whether a later entry names the same game as one already kept. A shared
 * executable wins; otherwise a source with no executable can still be the same
 * install as an earlier one with the same root.
 */
function isDuplicate(candidate: InstalledGame, kept: InstalledGame): boolean {
  const candidateExes = new Set(candidate.exes.map(normalised));

  if (kept.exes.some((exe) => candidateExes.has(normalised(exe)))) return true;

  if (candidate.exes.length === 0 || kept.exes.length === 0) {
    return normalised(candidate.installDir) === normalised(kept.installDir);
  }

  return false;
}

/**
 * Every installed game across the launchers, Steam first. A reader that fails
 * contributes nothing rather than taking the catalogue down: an absent or
 * broken launcher is one source's gap, not the provider's failure.
 */
export async function readInstalledGames(
  seams: CatalogueSeams,
): Promise<readonly InstalledGame[]> {
  const readers: readonly (() => Promise<readonly InstalledGame[]>)[] = [
    () => readSteamGames(seams),
    () => readEpicGames(seams),
    () => readGogGames(seams),
    () => readItchGames(seams),
    () => readXboxGames(seams),
    () => readAppxGames(seams),
  ];

  const games: InstalledGame[] = [];

  for (const read of readers) {
    let entries: readonly InstalledGame[];

    try {
      entries = await read();
    } catch {
      entries = [];
    }

    for (const entry of entries) {
      if (!games.some((kept) => isDuplicate(entry, kept))) games.push(entry);
    }
  }

  return games;
}
