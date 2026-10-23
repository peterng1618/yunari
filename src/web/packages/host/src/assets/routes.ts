import type http from "node:http";
import {
  type AssetSourceListing,
  parseAssetSearchRequest,
} from "@yunari/renderer-core";
import type { CredentialStore } from "../settings/credentials.js";
import { searchSources } from "./search.js";
import type { AssetSource, SourceContext } from "./source.js";
import { ASSET_SOURCES } from "./sources.js";

/** What the host serves at `/api/assets`, or nothing when it serves none. */
export interface AssetRouteOptions {
  readonly credentials?: CredentialStore;
  readonly sources?: readonly AssetSource[];
  /** Supplied so a test can search without a network. */
  readonly fetch?: typeof fetch;
}

export interface AssetRouteInput {
  readonly request: http.IncomingMessage;
  readonly response: http.ServerResponse;
  readonly url: URL;
  readonly loopback: boolean;
  /** Whether the request states another page's origin; a search spends a key. */
  readonly foreignOrigin: boolean;
  readonly assets: AssetRouteOptions | undefined;
  readonly fetch: typeof fetch;
  readonly readBody: (
    request: http.IncomingMessage,
    limit?: number,
  ) => Promise<string>;
}

function json(
  response: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function text(
  response: http.ServerResponse,
  status: number,
  message: string,
): void {
  response.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(message);
}

function listingOf(source: AssetSource): AssetSourceListing {
  return {
    id: source.id,
    label: source.label,
    category: source.category,
    body: source.body,
    // `null` rather than an omitted key: a reader distinguishes "needs no
    // credential" from a field the answer forgot to carry.
    requires: source.requires ?? null,
    configurable: source.configurable,
    presetKind: source.presetKind ?? null,
    host: source.host ?? null,
  };
}

/** The credentials a source asked for, read once per request. */
async function credentialReader(
  assets: AssetRouteOptions,
): Promise<(id: string) => string | undefined> {
  const values = new Map<string, string>();
  const store = assets.credentials;

  if (store !== undefined) {
    const wanted = new Set(
      (assets.sources ?? ASSET_SOURCES)
        .map((source) => source.requires)
        .filter((id): id is string => id !== undefined),
    );
    for (const id of wanted) {
      const value = await store.valueOf(id);
      if (value !== undefined) values.set(id, value);
    }
  }

  return (id) => values.get(id);
}

/**
 * The asset finder's three routes.
 *
 * Mounted for every `/api/assets` path, whether or not this host serves
 * sources, so a build without them says so rather than falling through to the
 * static handler's 404. No body or credential is logged.
 */
export async function handleAssetRoutes(
  input: AssetRouteInput,
): Promise<boolean> {
  const { request, response, url, assets } = input;

  const sourcesPath = "/api/assets/sources";
  const searchPath = "/api/assets/search";
  const bytesPath = "/api/assets/bytes";

  if (
    url.pathname !== sourcesPath &&
    url.pathname !== searchPath &&
    url.pathname !== bytesPath
  ) {
    return false;
  }

  // A paired display has no finder, and a search is an outbound request it did
  // not ask for, so every one of these routes is this PC's.
  if (!input.loopback) {
    text(response, 403, "Asset sources are available on this PC only.");
    return true;
  }

  if (input.foreignOrigin) {
    text(response, 403, "Asset sources are not available to another page.");
    return true;
  }

  if (assets === undefined) {
    text(response, 503, "Asset sources are not enabled on this host.");
    return true;
  }

  const sources = assets.sources ?? ASSET_SOURCES;

  if (url.pathname === sourcesPath) {
    if (request.method !== "GET") {
      text(response, 405, "Only GET is supported.");
      return true;
    }

    json(response, 200, { sources: sources.map(listingOf) });
    return true;
  }

  if (url.pathname === searchPath) {
    if (request.method !== "POST") {
      text(response, 405, "Only POST is supported.");
      return true;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await input.readBody(request)) as unknown;
    } catch {
      text(response, 400, "That request body is not JSON.");
      return true;
    }

    const search = parseAssetSearchRequest(
      parsed,
      sources.map((source) => source.id),
    );
    if (search === undefined) {
      text(response, 400, "That search request is not one this host reads.");
      return true;
    }

    const controller = new AbortController();
    const abort = (): void =>
      controller.abort(new Error("The search was cancelled."));
    request.once("aborted", abort);

    try {
      const ctx: SourceContext = {
        credential: await credentialReader(assets),
        signal: controller.signal,
        fetch: assets.fetch ?? input.fetch,
      };
      json(response, 200, await searchSources(search, ctx, sources));
    } catch (error: unknown) {
      text(
        response,
        500,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      request.off("aborted", abort);
    }
    return true;
  }

  // Bytes.
  if (request.method !== "GET") {
    text(response, 405, "Only GET is supported.");
    return true;
  }

  const sourceId = url.searchParams.get("source");
  const resultId = url.searchParams.get("id");
  if (sourceId === null || resultId === null) {
    text(response, 400, "A source and an asset id are required.");
    return true;
  }

  const source = sources.find((entry) => entry.id === sourceId);
  if (source === undefined) {
    text(response, 404, "No such asset source.");
    return true;
  }

  const ctx: SourceContext = {
    credential: await credentialReader(assets),
    signal: new AbortController().signal,
    fetch: assets.fetch ?? input.fetch,
  };

  // A grid row's id is the search's namespaced `<source>:<entry>`; the source
  // names its own assets unprefixed, so the prefix is removed once, here.
  const entryId = resultId.startsWith(`${source.id}:`)
    ? resultId.slice(source.id.length + 1)
    : resultId;
  const bytes = await source.bytesOf(entryId, ctx);
  if (bytes === undefined) {
    text(response, 404, "That source does not have this asset.");
    return true;
  }

  response.writeHead(200, {
    "content-type": bytes.contentType,
    "content-length": bytes.bytes.byteLength,
    "cache-control": "no-store",
    "x-yunari-filename": bytes.filename,
  });
  response.end(Buffer.from(bytes.bytes));
  return true;
}
