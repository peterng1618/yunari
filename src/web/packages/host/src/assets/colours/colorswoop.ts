import type { AssetResult } from "@yunari/renderer-core";
import { CATALOGUE_PAGE_SIZE, HEX_COLOUR } from "../catalogue.js";
import type { AssetSource, SourceContext } from "../source.js";

const CATALOGUE_URL = "https://colorswoop.com/api/palettes.json";
const LICENCE = "CC0-1.0";

interface Palette {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly colours: readonly string[];
  readonly tags: readonly string[];
}

/** The whole catalogue is fetched once per host process. */
let pending: Promise<readonly Palette[]> | undefined;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOf(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Case- and accent-insensitive, so "cafe" finds "Café". */
function normalize(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

/** A palette is its own id, name, page and at least two hex colours; anything
 *  else is refused rather than rendered with a guessed value. */
function paletteOf(value: unknown): Palette | undefined {
  if (!isObject(value)) return undefined;

  const id = textOf(value.id);
  const name = textOf(value.name);
  const url = textOf(value.url);
  const colours = value.colors;
  if (id === undefined || name === undefined || url === undefined) {
    return undefined;
  }
  if (!Array.isArray(colours) || colours.length < 2) return undefined;
  if (!colours.every((entry): entry is string => textOf(entry) !== undefined)) {
    return undefined;
  }
  if (!colours.every((entry) => HEX_COLOUR.test(entry))) return undefined;

  const tags = Array.isArray(value.tags)
    ? value.tags.filter((tag): tag is string => typeof tag === "string")
    : [];

  return { id, name, url, colours, tags };
}

async function load(ctx: SourceContext): Promise<readonly Palette[]> {
  // No request signal: the catalogue is process-lived, so one cancelled search
  // must not abort the load every other search is waiting on.
  const response = await ctx.fetch(CATALOGUE_URL);
  if (!response.ok) {
    throw new Error(`ColorSwoop catalogue answered ${response.status}`);
  }

  const body = (await response.json()) as unknown;
  const entries =
    isObject(body) && Array.isArray(body.palettes) ? body.palettes : [];

  const palettes: Palette[] = [];
  for (const entry of entries) {
    const palette = paletteOf(entry);
    if (palette !== undefined) palettes.push(palette);
  }
  return palettes;
}

function catalogue(ctx: SourceContext): Promise<readonly Palette[]> {
  // A failed fetch clears the cache, so the next search retries rather than
  // replaying the refusal forever.
  pending ??= load(ctx).catch((error: unknown) => {
    pending = undefined;
    throw error;
  });
  return pending;
}

function pageOf(page: number): number {
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

function resultOf(palette: Palette): AssetResult {
  return {
    id: palette.id,
    name: palette.name,
    kind: "palette",
    preview: "",
    subtitle: palette.tags.join(", "),
    licence: LICENCE,
    sourceUrl: palette.url,
    preset: { kind: "palette", colours: palette.colours },
  };
}

/**
 * ColorSwoop, the static CC0 catalogue.
 *
 * The file is one GET per host process; the query filters it locally, so a
 * term never re-reaches the host after the first search.
 */
export const colorswoopSource: AssetSource = {
  id: "colorswoop",
  label: "ColorSwoop",
  category: "colour",
  body: "grid",
  requires: undefined,
  configurable: true,
  presetKind: "palette",
  host: null,

  async search(query, asked, ctx) {
    const palettes = await catalogue(ctx);
    const wanted = normalize(query.trim());
    const matches =
      wanted === ""
        ? palettes
        : palettes.filter(
            (palette) =>
              normalize(palette.name).includes(wanted) ||
              palette.tags.some((tag) => normalize(tag).includes(wanted)),
          );

    const offset = (pageOf(asked) - 1) * CATALOGUE_PAGE_SIZE;

    return {
      results: matches
        .slice(offset, offset + CATALOGUE_PAGE_SIZE)
        .map(resultOf),
      // No match is one empty page, not no pages.
      totalPages: Math.max(1, Math.ceil(matches.length / CATALOGUE_PAGE_SIZE)),
    };
  },

  async bytesOf(): Promise<undefined> {
    // A palette is a preset, never a file.
    return undefined;
  },
};
