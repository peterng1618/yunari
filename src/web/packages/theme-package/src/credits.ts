/**
 * `credits.json`, the package's attribution member.
 *
 * An imported asset is not imported until it carries its credit (finder spec
 * R7). The member is a package file beside the manifest and the document, and
 * this module is its one reader.
 */
export const CREDITS = "credits.json";

/** The reader's own cap, restated by the writer when it refuses an over-cap list. */
export const MAX_CREDITS_ENTRIES = 256;

/** Who made the work. Wallpaper Engine identifiers and a plain name both land
 *  here, so one member serves every source. */
export interface ThemeCreditsAuthor {
  readonly name?: string;
  readonly steamId?: string;
}

/** Where a person reads the terms. A workshop id and a plain URL are the two
 *  shapes the sources produce. */
export interface ThemeCreditsSource {
  readonly url?: string;
  readonly workshopId?: string;
}

export interface ThemeCreditsEntry {
  readonly kind: string;
  readonly title: string;
  readonly author?: ThemeCreditsAuthor;
  readonly source?: ThemeCreditsSource;
  readonly license: string;
  readonly changes: string;
  /** The asset this credit attributes, when the entry arrived with one. Absent
   *  on credits written before assets could be credited; absent reads as
   *  "nothing to prune" rather than as an unknown asset. */
  readonly assetId?: string;
}

export interface ThemeCredits {
  readonly format: "yunari-theme-credits";
  readonly version: 1;
  readonly entries: readonly ThemeCreditsEntry[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asAuthor(value: unknown): ThemeCreditsAuthor | undefined {
  if (!isObject(value)) return undefined;

  const author: { name?: string; steamId?: string } = {};
  if (typeof value.name === "string" && value.name !== "") {
    author.name = value.name;
  }
  if (typeof value.steamId === "string" && value.steamId !== "") {
    author.steamId = value.steamId;
  }

  return author.name === undefined && author.steamId === undefined
    ? undefined
    : author;
}

function asSource(value: unknown): ThemeCreditsSource | undefined {
  if (!isObject(value)) return undefined;

  const source: { url?: string; workshopId?: string } = {};
  if (typeof value.url === "string" && value.url !== "") source.url = value.url;
  if (typeof value.workshopId === "string" && value.workshopId !== "") {
    source.workshopId = value.workshopId;
  }

  return source.url === undefined && source.workshopId === undefined
    ? undefined
    : source;
}

function asEntry(value: unknown): ThemeCreditsEntry | undefined {
  if (!isObject(value)) return undefined;

  const { kind, title, author, source, license, changes, assetId } = value;
  if (
    typeof kind !== "string" ||
    typeof title !== "string" ||
    typeof license !== "string" ||
    typeof changes !== "string"
  ) {
    return undefined;
  }

  // Optional fields are built only when present: `exactOptionalPropertyTypes`
  // treats an explicit `undefined` as a different value from an absent key.
  const entry: {
    kind: string;
    title: string;
    author?: ThemeCreditsAuthor;
    source?: ThemeCreditsSource;
    license: string;
    changes: string;
    assetId?: string;
  } = { kind, title, license, changes };

  const parsedAuthor = asAuthor(author);
  if (parsedAuthor !== undefined) entry.author = parsedAuthor;
  const parsedSource = asSource(source);
  if (parsedSource !== undefined) entry.source = parsedSource;
  if (typeof assetId === "string" && assetId !== "") entry.assetId = assetId;

  return entry;
}

/**
 * The member's contents, or nothing when the bytes are not one.
 *
 * Total, like the catalogue reader: a non-object, a wrong `format`, a version
 * other than 1, or an over-cap entry list answers `undefined` rather than
 * throwing. An entry that is not usable is dropped, not fatal to the rest.
 */
export function readThemeCredits(bytes: Uint8Array): ThemeCredits | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return undefined;
  }

  if (!isObject(parsed)) return undefined;
  if (parsed.format !== "yunari-theme-credits") return undefined;
  if (parsed.version !== 1) return undefined;
  if (!Array.isArray(parsed.entries)) return undefined;
  if (parsed.entries.length > MAX_CREDITS_ENTRIES) return undefined;

  const entries: ThemeCreditsEntry[] = [];
  for (const raw of parsed.entries) {
    const entry = asEntry(raw);
    if (entry !== undefined) entries.push(entry);
  }

  return { format: "yunari-theme-credits", version: 1, entries };
}
