import type { AssetResult } from "@yunari/renderer-core";
import type { AssetSource, SearchPage, SourceBytes } from "../source.js";
import {
  CURATED_FACES,
  CURATED_SOURCE_ID,
  CURATED_TRIOS,
  type CuratedFace,
  type CuratedTrio,
  faceById,
  toFontCut,
  toFontTrioInfo,
  trioById,
} from "./curated-data.js";

/** Spaces and hyphens are one separator, so "fira-code" finds "Fira Code". */
function fold(value: string): string {
  return value.toLowerCase().replace(/[\s-]+/g, "-");
}

interface CuratedFamily {
  readonly name: string;
  /** The face whose id addresses the family row for its bytes. */
  readonly lead: CuratedFace;
  /** Every distinct cut of the family, in catalogue order. */
  readonly faces: readonly CuratedFace[];
}

const FAMILIES: CuratedFamily[] = [];
{
  const byName = new Map<string, CuratedFace[]>();
  for (const face of CURATED_FACES) {
    let faces = byName.get(face.family);
    if (faces === undefined) {
      faces = [];
      byName.set(face.family, faces);
      FAMILIES.push({ name: face.family, lead: face, faces });
    }
    faces.push(face);
  }
}

/** Exact family name, as the wire's cuts spell it: a token's `family` came
 *  from a cut, so the lookup does not fold. */
const FAMILY_BY_NAME = new Map(FAMILIES.map((family) => [family.name, family]));

function resultOfTrio(trio: CuratedTrio): AssetResult {
  // Position 0 is the heading face; the catalogue's shape test pins it.
  const heading = trio.faces[0];
  return {
    id: `trio:${trio.id}`,
    name: trio.name,
    kind: "font",
    // A woff2 is not a picture; the cuts carry the URLs the grid loads.
    preview: "",
    subtitle: trio.description,
    licence: heading.license.name,
    sourceUrl: heading.sourceUrl,
    font: { cuts: trio.faces.map(toFontCut), trio: toFontTrioInfo(trio) },
  };
}

function resultOfFamily(family: CuratedFamily): AssetResult {
  return {
    id: `cut:${family.lead.id}`,
    name: family.name,
    kind: "font",
    preview: "",
    subtitle: `${family.faces.length} cuts`,
    licence: family.lead.license.name,
    sourceUrl: family.lead.sourceUrl,
    font: { cuts: family.faces.map(toFontCut) },
  };
}

/**
 * The Fonttrio catalogue as the font picker's source.
 *
 * Search is local: the catalogue is already in the host, so browsing costs no
 * CDN call and a dead CDN cannot blank the grid. Bytes are fetched on demand
 * when an author applies a face.
 */
export const curatedFontSource: AssetSource = {
  id: CURATED_SOURCE_ID,
  label: "Curated fonts",
  category: "font",
  body: "font-picker",
  requires: undefined,
  configurable: false,

  async search(query): Promise<SearchPage> {
    const wanted = fold(query.trim());
    const matches = (value: string): boolean =>
      wanted === "" || fold(value).includes(wanted);

    const trios = CURATED_TRIOS.filter(
      (trio) =>
        matches(trio.name) ||
        matches(trio.description) ||
        trio.faces.some((face) => matches(face.family)),
    ).map(resultOfTrio);

    const families = FAMILIES.filter((family) => matches(family.name)).map(
      resultOfFamily,
    );

    // Trios first: a pairing is the authored decision, a single family the
    // fallback. One page: the catalogue is small enough to answer at once.
    return { results: [...trios, ...families], totalPages: undefined };
  },

  async bytesOf(resultId, ctx): Promise<SourceBytes | undefined> {
    const face = faceOfResultId(resultId);
    if (face === undefined) return undefined;

    const response = await ctx.fetch(face.sourceUrl, { signal: ctx.signal });
    if (!response.ok)
      throw new Error(`Fontsource answered ${response.status} for ${face.id}`);

    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: "font/woff2",
      filename: `${face.id}.woff2`,
    };
  },

  /** The catalogue is in memory, so no fetch and no context is needed. */
  familyCuts(family) {
    return FAMILY_BY_NAME.get(family)?.faces.map(toFontCut);
  },
};

/** A family row is addressed by its lead cut; a trio row by its heading cut. */
function faceOfResultId(resultId: string): CuratedFace | undefined {
  if (resultId.startsWith("cut:")) return faceById(resultId.slice(4));
  if (resultId.startsWith("trio:"))
    return trioById(resultId.slice(5))?.faces[0];
  return undefined;
}
