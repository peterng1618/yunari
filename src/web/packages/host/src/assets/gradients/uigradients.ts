import type { AssetResult } from "@yunari/renderer-core";
import type { AssetSource, SourceContext } from "../source.js";

export const GRADIENT_PAGE_SIZE = 40;

const CATALOGUE_URL =
  "https://raw.githubusercontent.com/ghosh/uiGradients/main/gradients.json";
const LICENCE = "MIT";
const SOURCE_URL = "https://github.com/ghosh/uiGradients";
const HEX = /^#[0-9a-f]{6}$/i;

interface Gradient {
  readonly id: string;
  readonly name: string;
  readonly colours: readonly string[];
}

/** The whole catalogue is fetched once per host process. */
let pending: Promise<readonly Gradient[]> | undefined;

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

/** A gradient is its own name and at least two hex colours; anything else is
 *  refused rather than rendered with a guessed stop. */
function gradientOf(value: unknown, index: number): Gradient | undefined {
  if (!isObject(value)) return undefined;

  const name = textOf(value.name);
  if (name === undefined || !Array.isArray(value.colors)) return undefined;

  const colours = value.colors.filter(
    (colour): colour is string =>
      typeof colour === "string" && HEX.test(colour),
  );
  if (colours.length < 2) return undefined;

  return { id: String(index), name, colours };
}

async function load(ctx: SourceContext): Promise<readonly Gradient[]> {
  // No request signal: the catalogue is process-lived, so one cancelled search
  // must not abort the load every other search is waiting on.
  const response = await ctx.fetch(CATALOGUE_URL);
  if (!response.ok) {
    throw new Error(`UI Gradients catalogue answered ${response.status}`);
  }

  const body = (await response.json()) as unknown;
  if (!Array.isArray(body)) {
    throw new Error("UI Gradients catalogue is not a list");
  }

  const gradients: Gradient[] = [];
  body.forEach((entry, index) => {
    const gradient = gradientOf(entry, index);
    if (gradient !== undefined) gradients.push(gradient);
  });
  return gradients;
}

function catalogue(ctx: SourceContext): Promise<readonly Gradient[]> {
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

function resultOf(gradient: Gradient): AssetResult {
  const last = gradient.colours.length - 1;
  return {
    id: gradient.id,
    name: gradient.name,
    kind: "gradient",
    preview: "",
    subtitle: undefined,
    licence: LICENCE,
    sourceUrl: SOURCE_URL,
    preset: {
      kind: "gradient",
      // The site renders every entry `to right`.
      angle: 0,
      stops: gradient.colours.map((color, index) => ({
        offset: index / last,
        color,
      })),
    },
  };
}

/**
 * UI Gradients, the static MIT catalogue.
 *
 * The file is one GET per host process; the query filters it locally, so a
 * term never re-reaches the host after the first search.
 */
export const uigradientsSource: AssetSource = {
  id: "uigradients",
  label: "UI Gradients",
  category: "colour",
  body: "grid",
  requires: undefined,
  configurable: true,
  presetKind: "gradient",
  host: "raw.githubusercontent.com",

  async search(query, asked, ctx) {
    const gradients = await catalogue(ctx);
    const wanted = normalize(query.trim());
    const matches =
      wanted === ""
        ? gradients
        : gradients.filter((gradient) =>
            normalize(gradient.name).includes(wanted),
          );

    const offset = (pageOf(asked) - 1) * GRADIENT_PAGE_SIZE;

    return {
      results: matches.slice(offset, offset + GRADIENT_PAGE_SIZE).map(resultOf),
      // No match is one empty page, not no pages.
      totalPages: Math.max(1, Math.ceil(matches.length / GRADIENT_PAGE_SIZE)),
    };
  },

  async bytesOf(): Promise<undefined> {
    // A gradient is a preset, never a file.
    return undefined;
  },
};
