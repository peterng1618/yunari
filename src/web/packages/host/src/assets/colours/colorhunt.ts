import type { AssetResult } from "@yunari/renderer-core";
import type { AssetSource } from "../source.js";

export const COLOUR_PAGE_SIZE = 40;

const FEED_URL = "https://colorhunt.co/php/feed.php";
const LICENCE = "unknown";
const CODE = /^[0-9a-f]{24}$/i;
const COLOUR_LENGTH = 6;

interface Entry {
  readonly code: string;
  readonly likes: string | undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A palette is a 24-hex code, four concatenated `RRGGBB`; anything else is
 *  refused rather than rendered with a guessed colour. */
function entryOf(value: unknown): Entry | undefined {
  if (!isObject(value)) return undefined;

  const code = value.code;
  if (typeof code !== "string" || !CODE.test(code)) return undefined;

  return {
    code,
    likes: typeof value.likes === "string" ? value.likes : undefined,
  };
}

function pageOf(page: number): number {
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

function coloursOf(code: string): readonly string[] {
  const colours: string[] = [];
  for (let at = 0; at < code.length; at += COLOUR_LENGTH) {
    colours.push(`#${code.slice(at, at + COLOUR_LENGTH)}`);
  }
  return colours;
}

function resultOf(entry: Entry): AssetResult {
  return {
    id: entry.code,
    name: `Color Hunt ${entry.code.slice(0, COLOUR_LENGTH).toUpperCase()}`,
    kind: "palette",
    preview: "",
    subtitle: entry.likes === undefined ? undefined : `${entry.likes} likes`,
    licence: LICENCE,
    sourceUrl: `https://colorhunt.co/palette/${entry.code}`,
    preset: { kind: "palette", colours: coloursOf(entry.code) },
  };
}

/**
 * Color Hunt, the undocumented tag feed.
 *
 * Each page is its own POST — the feed answers a step, not a catalogue — so
 * nothing is cached. A query is a tag, so the feed filters it host-side.
 */
export const colorhuntSource: AssetSource = {
  id: "colorhunt",
  label: "Color Hunt",
  category: "colour",
  body: "grid",
  requires: undefined,
  configurable: true,
  presetKind: "palette",
  host: "colorhunt.co",

  async search(query, asked, ctx) {
    const page = pageOf(asked);
    const body = new URLSearchParams({
      step: String(page - 1),
      sort: "new",
      tags: query.trim(),
      timeframe: "",
    });

    const response = await ctx.fetch(FEED_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body,
      signal: ctx.signal,
    });
    if (!response.ok) {
      throw new Error(`Color Hunt feed answered ${response.status}`);
    }

    const entries = (await response.json()) as unknown;
    if (!Array.isArray(entries)) {
      // The feed is undocumented; a changed shape is a failure, not an empty page.
      throw new Error("Color Hunt feed is not a list");
    }

    const results: AssetResult[] = [];
    for (const value of entries) {
      const entry = entryOf(value);
      if (entry !== undefined) results.push(resultOf(entry));
    }

    return {
      results,
      // The feed answers a step, never a catalogue: an empty page proves the
      // end is behind, a short page is the end, and a full one says only that
      // the next page exists.
      totalPages:
        results.length === 0
          ? Math.max(1, page - 1)
          : results.length < COLOUR_PAGE_SIZE
            ? page
            : page + 1,
    };
  },

  async bytesOf(): Promise<undefined> {
    // A palette is a preset, never a file.
    return undefined;
  },
};
