/**
 * The rule that decides a local game name is the same game as a store
 * candidate.
 *
 * Only two tiers accept: equal normalised base titles, or equal token sets
 * after case, symbols, punctuation, a leading article and edition qualifiers
 * are dropped. There is deliberately no prefix, substring or edit-distance
 * rule: `Half-Life` must not resolve to `Half-Life 2`.
 */

/** Edition words safe to drop bare: they never distinguish one title alone. */
const BARE_QUALIFIERS = [
  "definitive",
  "deluxe",
  "ultimate",
  "complete",
  "goty",
  "game of the year",
  "enhanced",
  "remastered",
  "collectors",
  "directors cut",
];

/**
 * Words that are also title words — `Pokémon Gold` is not `Pokémon` — so they
 * drop only inside an `edition` phrase.
 */
const EDITION_ONLY_QUALIFIERS = ["gold", "special", "legendary", "anniversary"];

/**
 * Trailing phrases that name an edition, not the game. Longest first:
 * `director's cut edition` must be removed whole, or its `edition` would
 * remain as a stray word.
 */
const QUALIFIERS: readonly (readonly string[])[] = [
  ...BARE_QUALIFIERS.flatMap((phrase) => {
    const words = phrase.split(" ");
    return [words, [...words, "edition"]];
  }),
  ...EDITION_ONLY_QUALIFIERS.map((phrase) => [...phrase.split(" "), "edition"]),
].sort((left, right) => right.length - left.length);

const ARTICLES = new Set(["a", "an", "the"]);

function stripQualifiers(tokens: readonly string[]): readonly string[] {
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
 * Drop a combining mark only when it decorates a Latin letter. Kana voicing
 * (`が` vs `か`) and Cyrillic phonemic marks (`й` vs `и`) distinguish different
 * titles, and stripping them would turn a sequel-like pair into a wrong match.
 */
function keepNonLatinMarks(value: string): string {
  let out = "";
  let base = "";

  for (const char of value) {
    const isMark = /\p{M}/u.test(char);

    if (isMark) {
      if (!/[a-z]/.test(base)) out += char;
      continue;
    }

    out += char;
    base = char;
  }

  return out;
}

/** Comparable words: folded, symbols and punctuation dropped, article gone. */
function tokenise(name: string): readonly string[] {
  const folded = name
    // NFKD decomposes `™` to the letters `TM`, so the symbols go first.
    .replace(/[™®©]/gu, "")
    .normalize("NFKD")
    .replace(/['’]/gu, "")
    .toLowerCase();

  const words = keepNonLatinMarks(folded)
    // `\p{M}` stays: a non-Latin mark is part of the letter it follows.
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .split(/\s+/u)
    .filter((word) => word !== "");

  return words[0] !== undefined && ARTICLES.has(words[0])
    ? words.slice(1)
    : words;
}

/**
 * A title's comparable base. A title made only of qualifier words keeps its
 * words instead of collapsing to the empty string; `matchStoreGame` refuses it
 * rather than letting it match everything.
 */
export function normalizeGameName(name: string): string {
  const words = tokenise(name);
  const base = stripQualifiers(words);

  return (base.length > 0 ? base : words).join(" ");
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

function baseOf(name: string): readonly string[] {
  return stripQualifiers(tokenise(name));
}

/**
 * The one candidate that could be this game, or `undefined` when none — or
 * more than one — survives. Two candidates for the same app id are one
 * survivor: the store can list an app twice. A title that is nothing but
 * qualifier words never matches.
 */
export function matchStoreGame(
  localName: string,
  candidates: readonly { id: number; name: string }[],
): { id: number; name: string } | undefined {
  const localBase = baseOf(localName);
  if (localBase.length === 0) return undefined;

  const base = localBase.join(" ");
  const baseTokens = tokenSet(base);
  let winner: { id: number; name: string } | undefined;

  for (const candidate of candidates) {
    const candidateBase = baseOf(candidate.name);
    if (candidateBase.length === 0) continue;

    const normalised = candidateBase.join(" ");
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
