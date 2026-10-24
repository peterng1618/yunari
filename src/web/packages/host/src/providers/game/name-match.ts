/**
 * The rule that decides a local game name is the same game as a store
 * candidate (decision 0109).
 *
 * Only two tiers accept: equal normalised base titles, or equal token sets
 * after case, symbols, punctuation, a leading article and edition qualifiers
 * are dropped. There is deliberately no prefix, substring or edit-distance
 * rule: `Half-Life` must not resolve to `Half-Life 2`.
 */

/** Trailing token sequences that name an edition, not the game. */
const QUALIFIERS: readonly (readonly string[])[] = [
  ["game", "of", "the", "year", "edition"],
  ["game", "of", "the", "year"],
  ["digital", "deluxe", "edition"],
  ["collectors", "edition"],
  ["anniversary", "edition"],
  ["definitive", "edition"],
  ["legendary", "edition"],
  ["standard", "edition"],
  ["enhanced", "edition"],
  ["complete", "edition"],
  ["special", "edition"],
  ["premium", "edition"],
  ["ultimate", "edition"],
  ["deluxe", "edition"],
  ["goty", "edition"],
  ["gold", "edition"],
  ["digital", "deluxe"],
  ["deluxe"],
  ["goty"],
];

const ARTICLES = new Set(["a", "an", "the"]);

function dropQualifiers(tokens: readonly string[]): readonly string[] {
  let remaining = tokens;

  while (remaining.length > 0) {
    const phrase = QUALIFIERS.find((candidate) => {
      if (candidate.length > remaining.length) return false;
      const start = remaining.length - candidate.length;
      return candidate.every(
        (word, index) => remaining[start + index] === word,
      );
    });

    if (phrase === undefined) break;
    remaining = remaining.slice(0, remaining.length - phrase.length);
  }

  return remaining;
}

/**
 * A title's comparable base: NFKD-folded, combining marks and symbols
 * removed, lowercased, punctuation treated as a separator, a leading article
 * dropped, then edition qualifiers dropped from the end.
 */
export function normalizeGameName(name: string): string {
  const words = name
    // NFKD decomposes `™` to the letters `TM`, so the symbols go first.
    .replace(/[™®©]/gu, "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/['’]/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/u)
    .filter((word) => word !== "");

  const withoutArticle =
    words[0] !== undefined && ARTICLES.has(words[0]) ? words.slice(1) : words;

  return dropQualifiers(withoutArticle).join(" ");
}

function tokenSet(normalised: string): ReadonlySet<string> {
  return new Set(normalised.split(" ").filter((token) => token !== ""));
}

function sameSet(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  if (left.size !== right.size) return false;

  for (const token of left) {
    if (!right.has(token)) return false;
  }

  return true;
}

/**
 * The one candidate that could be this game, or `undefined` when none — or
 * more than one — survives. Two candidates for the same app id are one
 * survivor: the store can list an app twice.
 */
export function matchStoreGame(
  localName: string,
  candidates: readonly { id: number; name: string }[],
): { id: number; name: string } | undefined {
  const base = normalizeGameName(localName);
  if (base === "") return undefined;

  const baseTokens = tokenSet(base);
  let winner: { id: number; name: string } | undefined;

  for (const candidate of candidates) {
    const normalised = normalizeGameName(candidate.name);
    if (normalised === "") continue;

    const accepted =
      normalised === base || sameSet(tokenSet(normalised), baseTokens);
    if (!accepted) continue;

    if (winner === undefined) {
      winner = candidate;
      continue;
    }

    if (winner.id !== candidate.id) return undefined;
  }

  return winner;
}
