import type { AssetResult } from "@yunari/renderer-core";
import type { AssetSource, SearchPage, SourceBytes } from "../source.js";

/** One icon in a generated manifest: a name and its own SVG markup. */
export interface LocalIcon {
  readonly name: string;
  readonly svg: string;
}

export type IconSearch = (query: string, page: number) => SearchPage;

/** One page of a grid, everywhere: the finder's first answer is this many rows
 *  per source rather than the whole manifest, which a local set answers in a
 *  single reply and would otherwise freeze the editor drawing two thousand
 *  tiles. */
const PAGE = 50;

/** Spaces and hyphens are one separator, so "arrow down" finds `arrow-down`. */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[\s-]+/g, "-");
}

/** A page is 1-based; anything else is the first page rather than a fault. */
function offsetOf(page: number): number {
  return Number.isInteger(page) && page >= 1 ? (page - 1) * PAGE : 0;
}

function previewOf(icon: LocalIcon): string {
  // A data URL rather than a host round-trip: the icon is already here, and the
  // grid renders it offline. `<img>` does not execute a script in an SVG.
  return `data:image/svg+xml;base64,${Buffer.from(icon.svg).toString("base64")}`;
}

function resultOf(icon: LocalIcon, homeUrl: string): AssetResult {
  return {
    id: icon.name,
    name: icon.name,
    kind: "icon",
    preview: previewOf(icon),
    subtitle: undefined,
    licence: "unknown",
    sourceUrl: `${homeUrl}${icon.name}`,
  };
}

/**
 * A generated icon manifest as a source.
 *
 * Lucide and Lineicons differ only in where their data came from, so they share
 * this search, paging and bytes shape rather than keeping two copies that can
 * drift.
 */
export function createLocalIconSource(config: {
  readonly id: string;
  readonly label: string;
  readonly licence: string;
  /** Where a person reads the icon and its terms; the icon's name is appended. */
  readonly homeUrl: string;
  readonly icons: readonly LocalIcon[];
}): { readonly source: AssetSource; readonly search: IconSearch } {
  const byName = new Map(config.icons.map((icon) => [icon.name, icon]));

  function search(query: string, asked: number): SearchPage {
    const wanted = normalize(query);
    const matches =
      wanted === ""
        ? config.icons
        : config.icons.filter((icon) => normalize(icon.name).includes(wanted));

    const offset = offsetOf(asked);

    return {
      results: matches.slice(offset, offset + PAGE).map((icon) => ({
        ...resultOf(icon, config.homeUrl),
        licence: config.licence,
      })),
      // A manifest with no match is one empty page, not no pages: the grid
      // says "no results" and the pager draws nothing.
      totalPages: Math.max(1, Math.ceil(matches.length / PAGE)),
    };
  }

  const source: AssetSource = {
    id: config.id,
    label: config.label,
    category: "icon",
    body: "grid",
    requires: undefined,
    configurable: true,

    async search(query, page) {
      return search(query, page);
    },

    async bytesOf(resultId): Promise<SourceBytes | undefined> {
      const icon = byName.get(resultId);
      if (icon === undefined) return undefined;

      return {
        bytes: new TextEncoder().encode(icon.svg),
        contentType: "image/svg+xml",
        filename: `${icon.name}.svg`,
      };
    },
  };

  return { source, search };
}
