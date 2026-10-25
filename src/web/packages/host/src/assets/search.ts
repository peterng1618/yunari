import type { AssetPage, AssetSearchRequest } from "@yunari/renderer-core";
import type { AssetSource, SourceContext } from "./source.js";
import { ASSET_SOURCES } from "./sources.js";

export interface SearchOutcome {
  readonly pages: readonly AssetPage[];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failed(source: string, message: string): AssetPage {
  return {
    source,
    results: [],
    totalPages: undefined,
    failure: { reason: "failed", message },
  };
}

async function pageOf(
  source: AssetSource,
  request: AssetSearchRequest,
  ctx: SourceContext,
): Promise<AssetPage> {
  if (ctx.signal.aborted)
    return failed(source.id, messageOf(ctx.signal.reason));

  if (
    source.requires !== undefined &&
    ctx.credential(source.requires) === undefined
  ) {
    return {
      source: source.id,
      results: [],
      totalPages: undefined,
      failure: { reason: "needs-credential", credential: source.requires },
    };
  }

  try {
    const page = await source.search(
      request.query,
      request.pages[source.id] ?? 1,
      ctx,
    );

    return {
      source: source.id,
      results: page.results.map((entry) => ({
        ...entry,
        // Namespaced here, once: two sources cannot collide, and a row names its
        // origin without a lookup.
        id: `${source.id}:${entry.id}`,
      })),
      totalPages: page.totalPages,
      failure: undefined,
    };
  } catch (error: unknown) {
    return failed(source.id, messageOf(error));
  }
}

/**
 * One search over every enabled source serving the requested body.
 *
 * A page that was not asked for is not produced: a disabled source, or one of
 * another body, makes no call. Pages come back in registry order whatever order
 * they resolved in, so the grid's interleave is stable.
 */
export async function searchSources(
  request: AssetSearchRequest,
  ctx: SourceContext,
  sources: readonly AssetSource[] = ASSET_SOURCES,
): Promise<SearchOutcome> {
  const enabled = new Set(request.enabled);
  const body = request.body ?? "grid";
  const asking = sources.filter(
    (source) => enabled.has(source.id) && source.body === body,
  );

  const pages = await Promise.all(
    asking.map((source) => pageOf(source, request, ctx)),
  );

  return { pages };
}
