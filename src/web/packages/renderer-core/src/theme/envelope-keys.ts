/**
 * The key vocabulary a v2 envelope is decided against.
 *
 * The envelope's shape is declared twice: here, and in
 * `schema/theme-document.schema.json`. This is the decider
 * (docs/decisions/0023) and the schema is the hand-written contract held to it
 * by `envelope-keys-disagreement.test.ts`, which derives the schema's own key
 * sets from the file and compares them here. It lives apart from the checks
 * that consume it so the drift test has one thing to hold: the vocabulary.
 */

/**
 * Known keys mirror schema shapes with `additionalProperties: false`.
 *
 * This module is the decider (docs/decisions/0023). The published schema is a
 * hand-written contract held to it by `envelope-keys-disagreement.test.ts`,
 * which derives the schema's own key sets from the file and compares them here.
 */
const KNOWN_KEYS = {
  metadata: [
    "name",
    "author",
    "description",
    "version",
    "createdAt",
    "updatedAt",
    "themeLanguage",
    // The key only. A tag's *value* has no enum anywhere, deliberately: the
    // vocabulary is the catalogue's and has to be able to grow (docs/decisions/0087).
    "tags",
    "remixOf",
  ],
  artboard: ["width", "height", "contentFit"],
  // `format` and `timeZone` are validated below and authored by the editor's
  // runs panel; omitting them here refused the key before that code ran.
  binding: [
    "id",
    "semanticKey",
    "precision",
    "unitDisplay",
    "scale",
    "offset",
    "format",
    "timeZone",
  ],
  assetReference: [
    "id",
    "kind",
    "path",
    "sha256",
    "sourceUrl",
    "license",
    "family",
    "weight",
    "style",
    "format",
  ],
  globalEntry: ["name", "value"],
  typePreset: [
    "family",
    "size",
    "weight",
    "letterSpacing",
    "lineHeight",
    "face",
    "trioRole",
  ],
  fontFaceReference: ["assetId"],
} as const satisfies Record<string, readonly string[]>;

export type KnownKeyShape = keyof typeof KNOWN_KEYS;

/** Exposed for schema drift tests. */
export function knownKeysFor(shape: KnownKeyShape): readonly string[] {
  return KNOWN_KEYS[shape];
}

/** Every shape this module decides, so the drift test can insist each one is accounted for. */
export function knownKeyShapes(): readonly KnownKeyShape[] {
  return Object.keys(KNOWN_KEYS) as KnownKeyShape[];
}

/**
 * The v2 envelope's own bags. The envelope root is a separate decision from
 * `KNOWN_KEYS`, which lists the shapes inside it: a binding's keys are one fact
 * read from `KNOWN_KEYS` above, while the root and the two bags v2 renames are
 * this table's.
 */
const ENVELOPE_KEYS = {
  envelope: [
    "schemaVersion",
    "fabricVersion",
    "id",
    "metadata",
    "artboard",
    "background",
    "globals",
    "assets",
    "bindings",
    "editorMetadata",
    "scene",
  ],
  globals: ["palette", "typePresets"],
  background: ["color", "media"],
  backgroundMedia: [
    "assetId",
    "bounds",
    "offsetX",
    "offsetY",
    "flipX",
    "flipY",
  ],
} as const;

export type EnvelopeKeyBag = keyof typeof ENVELOPE_KEYS;

export function envelopeKeysFor(bag: EnvelopeKeyBag): readonly string[] {
  return ENVELOPE_KEYS[bag];
}

export function envelopeKeyBags(): readonly EnvelopeKeyBag[] {
  return Object.keys(ENVELOPE_KEYS) as EnvelopeKeyBag[];
}

/** Returns a close known key for typo diagnostics, capped at edit distance 3. */
export function nearestKey(
  key: string,
  allowed: readonly string[],
): string | undefined {
  // Provisional budget: a suggestion must be a plausible typo of *this* key, not
  // merely the closest of a short list. The removed media key `fit` is three
  // edits from `flipX`, and offering the mirror in place of "this key is gone"
  // misleads the author.
  let best: string | undefined;
  let bestDistance = Math.max(1, Math.floor(key.length / 2)) + 1;

  for (const candidate of allowed) {
    const distance = editDistance(key.toLowerCase(), candidate.toLowerCase());

    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best;
}

function editDistance(a: string, b: string): number {
  // Single-row Levenshtein is enough for short property names.
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const current = [i];

    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      const insertion = current[j - 1]! + 1;
      const deletion = previous[j]! + 1;
      current.push(Math.min(substitution, insertion, deletion));
    }

    previous = current;
  }

  return previous[b.length]!;
}
