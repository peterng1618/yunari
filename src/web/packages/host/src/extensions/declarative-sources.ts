import type { InstalledExtension } from "@yunari/extension-api";
import type { AssetResult, PresetKind } from "@yunari/renderer-core";
import type {
  AssetSource,
  SearchPage,
  SourceBytes,
  SourceContext,
} from "../assets/source.js";
import {
  dnsLookup,
  type HostLookup,
  messageOf,
} from "../providers/custom/fetch-source.js";
import { createPinnedFetch } from "../providers/custom/pinned-fetch.js";
import { resolvePointer } from "../providers/custom/pointer.js";
import { redactForBrowser } from "../providers/provider.js";
import { MAX_ASSET_BYTES } from "./asset-bytes.js";
import {
  DECLARATIVE_LOG_LIMIT,
  type DeclarativeAssetSource,
  warnDeclarativeSource,
} from "./declarative-contributions.js";
import { guardedFetch, guardedFetchBytes } from "./runtime/network.js";

/**
 * The HTTP adapter for a declarative asset source. The descriptor is parsed in
 * `declarative-contributions`; this file only makes requests: a search through
 * the guarded JSON fetch, and artwork through the guarded byte fetch. Both use
 * the same pinned fetch, so the address the policy checked is the address the
 * socket reaches.
 */

/** A result's sourceUrl is remembered for `bytesOf`, up to this many rows. */
const REMEMBERED_RESULTS = 1_000;
const SEARCH_TIMEOUT_MS = 15_000;
const SEARCH_MAX_BYTES = 1024 * 1024;
const BYTES_TIMEOUT_MS = 30_000;
/** A page count past this is not a pager a grid can draw. */
const TOTAL_PAGE_CEILING = 10_000;

const UNREADABLE_PAGE =
  "The declarative asset source returned an unusable search page.";
const UNREADABLE_ITEM =
  "The declarative asset source returned an unusable asset.";

interface BuiltRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

function warn(pluginKey: string, reason: string): void {
  warnDeclarativeSource(pluginKey, reason);
}

/** A filename is a header value: printable ASCII without a path separator, or
 *  a safe placeholder when the URL's last segment is anything else. */
function filenameOf(url: URL): string {
  const last = url.pathname.split("/").at(-1) ?? "";

  let name: string;
  try {
    name = decodeURIComponent(last);
  } catch {
    return "asset";
  }
  if (name === "" || name === "." || name === "..") return "asset";
  if (!/^[\x20-\x7e]+$/.test(name)) return "asset";
  if (name.includes("/") || name.includes("\\")) return "asset";
  return name;
}

/**
 * The adapter from a declarative contribution to the host's source port.
 *
 * `fetchImpl` and `resolve` are test seams. Without a `fetchImpl` the adapter
 * builds the pinned fetch itself: falling back to the context's fetch would let
 * a second DNS answer reach a different address than the policy checked.
 */
export class DeclarativeAssetSourceAdapter implements AssetSource {
  readonly id: string;
  readonly label: string;
  readonly category: string;
  readonly body: string;
  readonly plugin?: { readonly key: string; readonly ui: string };
  readonly requires = undefined;
  readonly configurable = true;
  readonly presetKind?: PresetKind;
  readonly host: string;

  readonly #pluginKey: string;
  readonly #contribution: DeclarativeAssetSource;
  readonly #allowedHosts: readonly string[];
  readonly #fetchImpl: typeof fetch;
  readonly #resolve: HostLookup;
  /** The sourceUrl each result id resolved to, most recently searched last. */
  readonly #sourceUrls = new Map<string, string>();

  constructor(options: {
    readonly plugin: InstalledExtension;
    readonly contribution: DeclarativeAssetSource;
    readonly fetchImpl?: typeof fetch;
    readonly resolve?: HostLookup;
  }) {
    this.#pluginKey = options.plugin.key;
    this.#contribution = options.contribution;
    this.id = options.contribution.id;
    this.label = options.contribution.label;
    this.category = options.contribution.category;
    this.host = options.contribution.host;
    this.body = options.contribution.body;
    if (this.body !== "grid" && options.plugin.ui !== undefined)
      this.plugin = { key: options.plugin.key, ui: options.plugin.ui };
    if (options.contribution.presetKind !== undefined) {
      this.presetKind = options.contribution.presetKind;
    }
    this.#allowedHosts = [
      new URL(options.contribution.request.url).hostname,
      options.contribution.host,
    ];
    this.#resolve = options.resolve ?? dnsLookup;
    this.#fetchImpl =
      options.fetchImpl ?? createPinnedFetch({ lookup: this.#resolve });
  }

  async search(
    query: string,
    page: number,
    ctx: SourceContext,
  ): Promise<SearchPage> {
    if (ctx.signal.aborted) throw new Error(messageOf(ctx.signal.reason));

    const built = this.#buildRequest(query, page);
    const outcome = await guardedFetch({
      url: built.url,
      allowedHosts: this.#allowedHosts,
      headers: built.headers,
      signal: AbortSignal.any([
        ctx.signal,
        AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      ]),
      maxBytes: SEARCH_MAX_BYTES,
      fetchImpl: this.#fetchImpl,
      resolve: this.#resolve,
      allowPrivateOrigin: false,
    });

    if (!outcome.ok)
      throw new Error(redactForBrowser(outcome.reason, DECLARATIVE_LOG_LIMIT));

    const items = resolvePointer(
      outcome.body,
      this.#contribution.result.itemsPath,
    );
    if (!items.found || !Array.isArray(items.value)) {
      throw new Error(UNREADABLE_PAGE);
    }

    const results = items.value.map((entry) =>
      this.#readItem(entry, built.url),
    );
    for (const result of results) this.#remember(result.id, result.sourceUrl);

    return { results, totalPages: this.#totalPages(outcome.body, page) };
  }

  async bytesOf(
    resultId: string,
    ctx: SourceContext,
  ): Promise<SourceBytes | undefined> {
    if (ctx.signal.aborted) {
      warn(this.#pluginKey, messageOf(ctx.signal.reason));
      return undefined;
    }

    const url = this.#sourceUrls.get(resultId);
    if (url === undefined) {
      warn(
        this.#pluginKey,
        `the asset "${resultId}" was not in a search result; search first.`,
      );
      return undefined;
    }

    let destination: URL;
    try {
      destination = new URL(url);
    } catch {
      warn(this.#pluginKey, "the remembered asset URL is not a URL.");
      return undefined;
    }
    if (destination.protocol !== "https:") {
      warn(this.#pluginKey, "the remembered asset URL is not https.");
      return undefined;
    }

    const outcome = await guardedFetchBytes({
      url,
      allowedHosts: this.#allowedHosts,
      maxBytes: MAX_ASSET_BYTES,
      signal: AbortSignal.any([
        ctx.signal,
        AbortSignal.timeout(BYTES_TIMEOUT_MS),
      ]),
      fetchImpl: this.#fetchImpl,
      resolve: this.#resolve,
    });

    if (!outcome.ok) {
      warn(this.#pluginKey, outcome.reason);
      return undefined;
    }
    return {
      bytes: outcome.bytes,
      contentType: outcome.contentType,
      filename: filenameOf(destination),
    };
  }

  #buildRequest(query: string, page: number): BuiltRequest {
    const request = this.#contribution.request;
    const apiPage = (request.firstPage ?? 1) + page - 1;
    const template = request.url;
    const hasQuery = template.includes("{query}");
    const hasPage = template.includes("{page}");

    let text = template;
    if (hasQuery) text = text.split("{query}").join(encodeURIComponent(query));
    if (hasPage) text = text.split("{page}").join(String(apiPage));

    const url = new URL(text);
    if (!hasQuery) url.searchParams.set("q", query);
    if (!hasPage && request.pageParam !== undefined) {
      url.searchParams.set(request.pageParam, String(apiPage));
    }

    const headers: Record<string, string> = { ...request.headers };

    return {
      url: url.toString(),
      headers,
    };
  }

  #readItem(value: unknown, defaultSourceUrl: string): AssetResult {
    const result = this.#contribution.result;

    return {
      id: this.#required(value, result.id),
      name: this.#required(value, result.name),
      kind: this.#optional(value, result.kind) ?? "unknown",
      preview: this.#optional(value, result.preview) ?? "",
      subtitle: this.#optional(value, result.subtitle),
      licence: this.#optional(value, result.licence) ?? "unknown",
      sourceUrl: this.#sourceUrl(value, result.sourceUrl, defaultSourceUrl),
    };
  }

  #required(value: unknown, pointer: string): string {
    const resolved = resolvePointer(value, pointer);
    if (!resolved.found || typeof resolved.value !== "string") {
      throw new Error(UNREADABLE_ITEM);
    }
    if (resolved.value === "") throw new Error(UNREADABLE_ITEM);
    return resolved.value;
  }

  #optional(value: unknown, pointer: string | undefined): string | undefined {
    if (pointer === undefined) return undefined;
    const resolved = resolvePointer(value, pointer);
    return resolved.found && typeof resolved.value === "string"
      ? resolved.value
      : undefined;
  }

  #sourceUrl(
    value: unknown,
    pointer: string | undefined,
    fallback: string,
  ): string {
    if (pointer === undefined) return fallback;
    const resolved = resolvePointer(value, pointer);
    if (!resolved.found || typeof resolved.value !== "string") {
      throw new Error(UNREADABLE_ITEM);
    }
    return resolved.value;
  }

  #totalPages(body: unknown, page: number): number | undefined {
    const pointer = this.#contribution.request.totalPath;
    if (pointer === undefined) return undefined;

    const resolved = resolvePointer(body, pointer);
    if (
      !resolved.found ||
      typeof resolved.value !== "number" ||
      !Number.isInteger(resolved.value) ||
      resolved.value < page ||
      resolved.value > TOTAL_PAGE_CEILING
    ) {
      return undefined;
    }
    return resolved.value;
  }

  #remember(id: string, sourceUrl: string): void {
    this.#sourceUrls.delete(id);
    this.#sourceUrls.set(id, sourceUrl);
    while (this.#sourceUrls.size > REMEMBERED_RESULTS) {
      const oldest = this.#sourceUrls.keys().next().value;
      if (oldest === undefined) break;
      this.#sourceUrls.delete(oldest);
    }
  }
}
