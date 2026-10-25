import type { AssetResult, FontCut } from "@yunari/renderer-core";
import type {
  AssetSource,
  SearchPage,
  SourceBytes,
  SourceContext,
} from "../source.js";

/** The `AssetSource` id these families are served under. */
export const GOOGLE_SOURCE_ID = "google-fonts";

const REGISTRY = "https://api.fontsource.org/v1/fonts";
/** The list endpoint names the fields a match needs; the version comes from
 *  the per-family endpoint, so one match costs one more request. */
const REGISTRY_URL = `${REGISTRY}?type=google`;
const CDN = "https://cdn.jsdelivr.net/fontsource/fonts";
/** One page of family results; the registry holds ~2,000 Google families. */
const PAGE = 24;
/** `cut:<family id>@<npm version>/<subset>-<weight>-<style>`. Strict because
 *  the tail becomes a URL path when the bytes are read. */
const CUT =
  /^cut:[a-z0-9-]+@[0-9][0-9a-z.+-]*\/[a-z0-9-]+-\d{1,4}-(?:normal|italic)$/;
/** A subset becomes a path segment in the cut id and the pinned URL. */
const SUBSET = /^[a-z0-9-]+$/;
/** The id and version also become cut-id segments; a row outside these cannot
 *  be addressed back by `bytesOf`, so it is not offered. */
const FAMILY_ID = /^[a-z0-9-]+$/;
const NPM_VERSION = /^[0-9][0-9a-z.+-]*$/;

function fold(value: string): string {
  return value.toLowerCase().replace(/[\s-]+/g, "-");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A registry row, kept to what a match needs. The list is filtered locally as
 *  well as by the query parameter, so a registry that ignores `type` still
 *  cannot leak another provider's families into this source. */
interface RegistryFamily {
  readonly id: string;
  readonly family: string;
}

function registryFamilies(value: unknown): RegistryFamily[] {
  if (!Array.isArray(value)) {
    throw new Error("Fontsource's registry is not a list.");
  }

  const families: RegistryFamily[] = [];
  for (const entry of value) {
    if (!isObject(entry)) continue;
    const { id, family, type } = entry;
    if (typeof id !== "string" || typeof family !== "string") continue;
    if (type !== "google") continue;
    families.push({ id, family });
  }
  return families;
}

/** `/v1/fonts/:id`, the row that carries `npmVersion` and the published cuts. */
interface RegistryFont extends RegistryFamily {
  readonly defSubset: string;
  readonly category: string;
  readonly license: string;
  readonly npmVersion: string;
  /** `{ weight: { style: { subset: { url: { woff2 } } } } }`; kept raw so a
   *  malformed pairing is skipped rather than trusted. */
  readonly variants: unknown;
}

function registryFont(value: unknown): RegistryFont {
  if (!isObject(value)) {
    throw new Error("Fontsource's family entry is not an object.");
  }

  const { id, family, defSubset, category, license, npmVersion, variants } =
    value;

  if (
    typeof id !== "string" ||
    typeof family !== "string" ||
    typeof defSubset !== "string" ||
    typeof category !== "string" ||
    typeof license !== "string" ||
    typeof npmVersion !== "string"
  ) {
    throw new Error("Fontsource's family entry is missing fields.");
  }

  return {
    id,
    family,
    defSubset,
    category,
    license,
    npmVersion,
    variants,
  };
}

async function fetched(
  url: string,
  ctx: SourceContext,
  what: string,
): Promise<unknown> {
  const response = await ctx.fetch(url, { signal: ctx.signal });
  if (!response.ok) {
    throw new Error(
      `Fontsource ${what} answered ${response.status} for ${url}`,
    );
  }
  return (await response.json()) as unknown;
}

/** The id is the pinned artifact path, so `bytesOf` can rebuild the URL
 *  without holding the registry open between two host requests. */
function cutIdOf(
  font: RegistryFont,
  subset: string,
  weight: number,
  style: "normal" | "italic",
): string {
  return `cut:${font.id}@${font.npmVersion}/${subset}-${weight}-${style}`;
}

function urlOf(cutId: string): string {
  return `${CDN}/${cutId.slice("cut:".length)}.woff2`;
}

/** The detail's own `variants`: a pairing listed there is a published file,
 *  which the weight × subset cartesian product cannot promise. URLs are
 *  rebuilt from the validated keys and pinned, so an upstream `@latest` (or a
 *  foreign origin) never reaches the wire. */
function cutsOf(font: RegistryFont): FontCut[] {
  if (!FAMILY_ID.test(font.id) || !NPM_VERSION.test(font.npmVersion)) {
    return [];
  }
  if (!isObject(font.variants)) return [];

  const cuts: FontCut[] = [];
  for (const [weightKey, styles] of Object.entries(font.variants)) {
    const weight = Number(weightKey);
    if (!Number.isInteger(weight) || weight <= 0) continue;
    if (!isObject(styles)) continue;

    const normal = styles.normal;
    if (!isObject(normal)) continue;

    for (const [subset, face] of Object.entries(normal)) {
      if (!SUBSET.test(subset)) continue;
      if (!isObject(face)) continue;
      const url = isObject(face.url) ? face.url.woff2 : undefined;
      if (typeof url !== "string" || url === "") continue;

      const id = cutIdOf(font, subset, weight, "normal");
      const pinned = urlOf(id);
      cuts.push({
        id,
        source: GOOGLE_SOURCE_ID,
        family: font.family,
        weight,
        style: "normal",
        subset,
        format: "woff2",
        previewUrl: pinned,
        licence: font.license,
        sourceUrl: pinned,
      });
    }
  }
  return cuts;
}

/** A family row is addressed by its first cut, as a curated family is. Latin
 *  400 is preferred so the row's own bytes are the face most authors expect. */
function leadOf(
  font: RegistryFont,
  cuts: readonly FontCut[],
): FontCut | undefined {
  return (
    cuts.find((cut) => cut.subset === font.defSubset && cut.weight === 400) ??
    cuts.find((cut) => cut.weight === 400) ??
    cuts.find((cut) => cut.subset === font.defSubset) ??
    cuts[0]
  );
}

function resultOf(font: RegistryFont): AssetResult | undefined {
  const cuts = cutsOf(font);
  const lead = leadOf(font, cuts);
  if (lead === undefined) return undefined;

  return {
    id: lead.id,
    name: font.family,
    kind: "font",
    // A woff2 is not a picture; the cuts carry the URLs the specimen loads.
    preview: "",
    subtitle: `${font.category} · ${cuts.length} cuts`,
    licence: font.license,
    sourceUrl: lead.sourceUrl ?? lead.previewUrl,
    font: { cuts },
  };
}

/**
 * Google families, read through Fontsource's registry.
 *
 * The registry is keyless and CORS-open. Each search reads the list once and
 * then the per-family rows for the page it asks for: the list is not cached
 * across opens, so a second open re-reads it. A registry failure is thrown to
 * `searchSources`, which turns it into this source's failed page, so one dead
 * provider cannot blank the grid.
 */
export const googleFontSource: AssetSource = {
  id: GOOGLE_SOURCE_ID,
  label: "Google Fonts",
  category: "font",
  body: "font-picker",
  requires: undefined,
  configurable: false,
  host: "api.fontsource.org",

  async search(query, asked, ctx): Promise<SearchPage> {
    const wanted = fold(query.trim());
    const matches = registryFamilies(
      await fetched(REGISTRY_URL, ctx, "registry"),
    ).filter((entry) => wanted === "" || fold(entry.family).includes(wanted));

    const page = Number.isInteger(asked) && asked >= 1 ? asked : 1;
    const start = (page - 1) * PAGE;
    const details = await Promise.allSettled(
      matches
        .slice(start, start + PAGE)
        .map((entry) =>
          fetched(`${REGISTRY}/${encodeURIComponent(entry.id)}`, ctx, "family"),
        ),
    );

    const results: AssetResult[] = [];
    for (const outcome of details) {
      // One unread or malformed family is one missing row, not a failed page:
      // the other families this page asked for still reach the grid.
      if (outcome.status !== "fulfilled") continue;
      try {
        const result = resultOf(registryFont(outcome.value));
        if (result !== undefined) results.push(result);
      } catch {
        continue;
      }
    }

    return {
      results,
      totalPages: Math.max(1, Math.ceil(matches.length / PAGE)),
    };
  },

  async bytesOf(resultId, ctx): Promise<SourceBytes | undefined> {
    if (!CUT.test(resultId)) return undefined;

    const url = urlOf(resultId);
    const response = await ctx.fetch(url, { signal: ctx.signal });
    if (!response.ok) {
      throw new Error(`Fontsource answered ${response.status} for ${resultId}`);
    }

    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: "font/woff2",
      filename: `${resultId.slice("cut:".length).replace(/[@/]/g, "-")}.woff2`,
    };
  },
};
