import type { AssetResult } from "@yunari/renderer-core";
import type {
  AssetSource,
  SearchPage,
  SourceBytes,
  SourceContext,
} from "../source.js";

export const UNSPLASH_VERSION = "v1";

const API = `https://api.unsplash.com/`;
/** The API's documented `per_page` ceiling; a larger ask is a 400. */
const PER_PAGE = 30;
const LICENCE = "Unsplash License";
const PHOTO_ID = /^[A-Za-z0-9_-]+$/;

interface UnsplashPhoto {
  readonly id?: unknown;
  readonly alt_description?: unknown;
  readonly description?: unknown;
  readonly premium?: unknown;
  readonly plus?: unknown;
  readonly user?: { readonly name?: unknown };
  readonly links?: {
    readonly html?: unknown;
    readonly download_location?: unknown;
  };
  readonly urls?: {
    readonly full?: unknown;
    readonly regular?: unknown;
    readonly small?: unknown;
  };
}

interface SearchAnswer {
  readonly results?: unknown;
  readonly total_pages?: unknown;
}

function keyOf(ctx: SourceContext): string {
  const key = ctx.credential("unsplash");
  if (key === undefined) throw new Error("Unsplash needs an access key.");
  return key;
}

function auth(key: string): { Authorization: string } {
  return { Authorization: `Client-ID ${key}` };
}

function hostOf(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
}

function textOf(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Unsplash+ content carries one of three signs; any one is enough to drop it. */
function isFree(photo: UnsplashPhoto): boolean {
  if (photo.premium === true || photo.plus === true) return false;
  return (
    hostOf(photo.urls?.small) !== "plus.unsplash.com" &&
    hostOf(photo.urls?.regular) !== "plus.unsplash.com"
  );
}

function pageOf(page: number): number {
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

/** The next page the Editorial feed claims. Its count is in the `Link` header
 *  rather than the body: a named `last` page wins, a `next` page means one
 *  more, and a header-less feed is judged by whether its page came back full. */
function feedPages(link: string | null, page: number, served: number): number {
  const entries = (link ?? "").split(",");
  const pageIn = (entry: string): number | undefined => {
    const match = /[?&]page=(\d+)/.exec(entry);
    return match?.[1] === undefined ? undefined : Number(match[1]);
  };

  for (const entry of entries) {
    if (!/rel="last"/.test(entry)) continue;
    const last = pageIn(entry);
    if (last !== undefined) return last;
  }
  if (entries.some((entry) => /rel="next"/.test(entry))) return page + 1;
  return served >= PER_PAGE ? page + 1 : page;
}

/** The API's own words for a refusal, which name the fault a status cannot:
 *  a bad key, a missing parameter, a rate limit. Never the request's key. */
async function detailOf(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { errors?: unknown };
    const errors = Array.isArray(body.errors)
      ? body.errors.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [];
    return errors.length === 0 ? "" : `: ${errors.join("; ")}`;
  } catch {
    return "";
  }
}

async function jsonOf(response: Response, what: string): Promise<unknown> {
  if (!response.ok) {
    const detail = await detailOf(response);
    throw new Error(`Unsplash ${what} answered ${response.status}${detail}`);
  }
  return (await response.json()) as unknown;
}

function resultOf(photo: UnsplashPhoto): AssetResult | undefined {
  const id = textOf(photo.id);
  const small = textOf(photo.urls?.small);
  const page = textOf(photo.links?.html);
  if (id === undefined || small === undefined || page === undefined) {
    return undefined;
  }

  return {
    id,
    name:
      textOf(photo.alt_description) ?? textOf(photo.description) ?? "Untitled",
    kind: "image",
    preview: small,
    subtitle: textOf(photo.user?.name),
    licence: LICENCE,
    sourceUrl: page,
  };
}

/**
 * Unsplash, free photos only.
 *
 * The key is the app's access key and it stays on the host. Everything that
 * marks Unsplash+ content is dropped, so a result that reaches the grid is
 * under the Unsplash License.
 */
export const unsplashSource: AssetSource = {
  id: "unsplash",
  label: "Unsplash",
  category: "image",
  body: "grid",
  requires: "unsplash",
  configurable: true,
  // The one host that receives the term (spec §5).
  host: "api.unsplash.com",

  async search(query, asked, ctx): Promise<SearchPage> {
    const key = keyOf(ctx);
    const page = pageOf(asked);

    // An empty term browses the Editorial feed (`GET /photos`); it needs the
    // same key, and it is what the Images tab shows on open (spec R3).
    if (query.trim() === "") {
      const url = new URL("photos", API);
      url.searchParams.set("page", String(page));
      url.searchParams.set("per_page", String(PER_PAGE));
      const response = await ctx.fetch(url.toString(), {
        headers: auth(key),
        signal: ctx.signal,
      });
      const answer = await jsonOf(response, "feed");
      const served = Array.isArray(answer) ? answer : [];

      const results: AssetResult[] = [];
      for (const entry of served) {
        const photo = entry as UnsplashPhoto;
        if (!isFree(photo)) continue;
        const result = resultOf(photo);
        if (result !== undefined) results.push(result);
      }

      return {
        results,
        // A filtered page can be shorter than the one Unsplash served; the
        // page's own length, not the free results', is what proves another.
        totalPages: feedPages(
          response.headers.get("link"),
          page,
          served.length,
        ),
      };
    }

    const url = new URL("search/photos", API);
    url.searchParams.set("query", query);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(PER_PAGE));

    const answer = (await jsonOf(
      await ctx.fetch(url.toString(), {
        headers: auth(key),
        signal: ctx.signal,
      }),
      "search",
    )) as SearchAnswer;

    const results: AssetResult[] = [];
    for (const entry of Array.isArray(answer.results) ? answer.results : []) {
      const photo = entry as UnsplashPhoto;
      if (!isFree(photo)) continue;
      const result = resultOf(photo);
      if (result !== undefined) results.push(result);
    }

    return {
      results,
      totalPages:
        typeof answer.total_pages === "number" ? answer.total_pages : undefined,
    };
  },

  async bytesOf(resultId, ctx): Promise<SourceBytes | undefined> {
    if (!PHOTO_ID.test(resultId)) return undefined;

    const key = keyOf(ctx);
    const details = (await jsonOf(
      await ctx.fetch(`${API}photos/${resultId}`, {
        headers: auth(key),
        signal: ctx.signal,
      }),
      "photo",
    )) as UnsplashPhoto;

    const trigger = textOf(details.links?.download_location);
    const full = textOf(details.urls?.full);
    if (trigger === undefined || full === undefined) return undefined;

    // The API guideline's download trigger, before the image itself.
    await ctx.fetch(trigger, { headers: auth(key), signal: ctx.signal });

    const image = await ctx.fetch(full, { signal: ctx.signal });
    if (!image.ok) throw new Error(`Unsplash image answered ${image.status}`);

    return {
      bytes: new Uint8Array(await image.arrayBuffer()),
      contentType: "image/jpeg",
      filename: `${resultId}.jpg`,
    };
  },
};

/** The Connections tab's check: one real search with `per_page=1`. */
export async function verifyUnsplash(
  value: string,
  fetchImpl: typeof fetch,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const response = await fetchImpl(
    `${API}search/photos?query=test&per_page=1`,
    { headers: auth(value) },
  );

  return response.ok
    ? { ok: true }
    : { ok: false, message: `Unsplash answered ${response.status}.` };
}
