import type { AssetResult } from "@yunari/renderer-core";
import { CATALOGUE_PAGE_SIZE, HEX_COLOUR } from "../catalogue.js";
import type { AssetSource, SourceContext } from "../source.js";

const CATALOGUE_URL =
  "https://raw.githubusercontent.com/itmeo/webgradients/master/gradients.json";
const LICENCE = "MIT";
const SOURCE_URL = "https://webgradients.com/";

interface Stop {
  readonly offset: number;
  readonly color: string;
}

interface Gradient {
  readonly id: string;
  readonly name: string;
  readonly angle: number;
  readonly stops: readonly Stop[];
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

/** A stop is a hex colour and a percentage; anything else is refused rather
 *  than rendered at a guessed offset. */
function stopOf(value: unknown): Stop | undefined {
  if (!isObject(value)) return undefined;

  const color = textOf(value.color);
  const pos = value.pos;
  if (color === undefined || !HEX_COLOUR.test(color)) return undefined;
  if (typeof pos !== "number" || !Number.isFinite(pos)) return undefined;

  // The catalogue carries out-of-range percentages ("Slick Carbon" has 150);
  // the editor refuses an offset outside 0..1, so clamp before normalising.
  const offset = Math.min(100, Math.max(0, pos)) / 100;

  return { offset, color };
}

/** A gradient is its own name, index and angle and at least two stops. */
function gradientOf(value: unknown): Gradient | undefined {
  if (!isObject(value)) return undefined;

  const name = textOf(value.name);
  const index = value.index;
  const deg = value.deg;
  if (name === undefined) return undefined;
  // The live catalogue stores index as a zero-padded string; a number is
  // accepted too so a numeric catalogue is still usable.
  if (typeof index === "string" ? index === "" : !Number.isInteger(index)) {
    return undefined;
  }
  if (typeof deg !== "number" || !Number.isFinite(deg)) return undefined;
  if (!Array.isArray(value.gradient)) return undefined;

  const stops = value.gradient
    .map(stopOf)
    .filter((stop): stop is Stop => stop !== undefined);
  if (stops.length < 2) return undefined;

  // The catalogue's deg is CSS's; the editor stores 0 for a left-to-right
  // gradient (CSS 90deg), so the two differ by a quarter turn.
  const angle = (90 - deg + 360) % 360;

  return { id: String(index), name, angle, stops };
}

async function load(ctx: SourceContext): Promise<readonly Gradient[]> {
  // No request signal: the catalogue is process-lived, so one cancelled search
  // must not abort the load every other search is waiting on.
  const response = await ctx.fetch(CATALOGUE_URL);
  if (!response.ok) {
    throw new Error(`WebGradients catalogue answered ${response.status}`);
  }

  const body = (await response.json()) as unknown;
  if (!Array.isArray(body)) {
    throw new Error("WebGradients catalogue is not a list");
  }

  const gradients: Gradient[] = [];
  for (const entry of body) {
    const gradient = gradientOf(entry);
    if (gradient !== undefined) gradients.push(gradient);
  }
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
      angle: gradient.angle,
      stops: gradient.stops,
    },
  };
}

/**
 * WebGradients, the static MIT catalogue.
 *
 * The file is one GET per host process; the query filters it locally, so a
 * term never re-reaches the host after the first search.
 */
export const webgradientsSource: AssetSource = {
  id: "webgradients",
  label: "WebGradients",
  category: "colour",
  body: "grid",
  requires: undefined,
  configurable: true,
  presetKind: "gradient",
  host: null,

  async search(query, asked, ctx) {
    const gradients = await catalogue(ctx);
    const wanted = normalize(query.trim());
    const matches =
      wanted === ""
        ? gradients
        : gradients.filter((gradient) =>
            normalize(gradient.name).includes(wanted),
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
    // A gradient is a preset, never a file.
    return undefined;
  },
};
