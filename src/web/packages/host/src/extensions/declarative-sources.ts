import {
  IDENTIFIER_PATTERN,
  type InstalledExtension,
  isCodeAssetSourceEntry,
} from "@yunari/extension-api";
import type { AssetResult, PresetKind } from "@yunari/renderer-core";
import type {
  AssetSource,
  SearchPage,
  SourceBytes,
  SourceContext,
} from "../assets/source.js";
import {
  checkDestination,
  discard,
  dnsLookup,
  type HostLookup,
  messageOf,
  PINNED_ADDRESSES,
  type PinnedRequestInit,
  REDIRECT_STATUSES,
  TIMEOUT_REASON,
  withFetchSlot,
} from "../providers/custom/fetch-source.js";
import { resolvePointer } from "../providers/custom/pointer.js";
import { redactForBrowser } from "../providers/provider.js";
import { guardedFetch } from "./runtime/network.js";

/**
 * A declarative asset source: the manifest says where to search, how to page
 * and which pointers name a result, so the host needs no code from the plugin.
 * The request still passes the custom-source destination policy, and a host
 * credential is inserted only inside the outbound request.
 */

/** One extension may contribute this many adapted sources; the rest are
 *  refused with a stated reason rather than making startup unbounded. */
const MAX_SOURCES_PER_EXTENSION = 20;
/** A result's sourceUrl is remembered for `bytesOf`, up to this many rows. */
const REMEMBERED_RESULTS = 1_000;
const SEARCH_TIMEOUT_MS = 15_000;
const SEARCH_MAX_BYTES = 1024 * 1024;
const BYTES_TIMEOUT_MS = 30_000;
const BYTES_MAX_BYTES = 32 * 1024 * 1024;
const LOG_LIMIT = 200;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

const HTTPS_REQUIRED = "Declarative asset sources must use https.";
const USERINFO_REFUSED =
  "A declarative asset source URL may not carry user information.";
const UNREADABLE_PAGE =
  "The declarative asset source returned an unusable search page.";
const UNREADABLE_ITEM =
  "The declarative asset source returned an unusable asset.";

const PRESET_KINDS: ReadonlySet<string> = new Set(["palette", "gradient"]);

export interface DeclarativeAssetSourceAuth {
  readonly kind: "header" | "query";
  readonly name: string;
}

export interface DeclarativeAssetSource {
  readonly id: string;
  readonly label: string;
  readonly category: string;
  readonly body: "grid";
  readonly requires?: string;
  readonly presetKind?: PresetKind;
  readonly host: string;
  readonly request: {
    readonly url: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly pageParam?: string;
    readonly firstPage?: number;
    readonly totalPath?: string;
    readonly auth?: DeclarativeAssetSourceAuth;
  };
  readonly result: {
    readonly itemsPath: string;
    readonly id: string;
    readonly name: string;
    readonly preview?: string;
    readonly subtitle?: string;
    readonly kind?: string;
    readonly licence?: string;
    readonly sourceUrl?: string;
  };
}

type ReadResult =
  | { readonly ok: true; readonly source: DeclarativeAssetSource }
  | { readonly ok: false; readonly message: string };

type Check<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

function refuse(message: string): ReadResult {
  return { ok: false, message };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function readAuth(
  value: unknown,
  id: string,
  requires: string | undefined,
): Check<DeclarativeAssetSourceAuth | undefined> {
  if (value === undefined) {
    if (requires !== undefined) {
      return {
        ok: false,
        message:
          'A declarative asset source that names "requires" also needs request.auth.',
      };
    }
    return { ok: true, value: undefined };
  }

  if (requires === undefined) {
    return {
      ok: false,
      message:
        'A declarative asset source that uses request.auth also needs "requires".',
    };
  }
  if (!isRecord(value)) {
    return {
      ok: false,
      message: `The declarative asset source "${id}" declares an unreadable request.auth.`,
    };
  }

  const kind = value["kind"];
  const name = value["name"];
  if (kind !== "header" && kind !== "query") {
    return {
      ok: false,
      message: `The declarative asset source "${id}" declares an unknown request.auth.kind.`,
    };
  }
  if (!nonEmpty(name) || !HEADER_NAME.test(name)) {
    return {
      ok: false,
      message: `The declarative asset source "${id}" needs a usable request.auth.name.`,
    };
  }

  return { ok: true, value: { kind, name } };
}

function readHeaders(
  value: unknown,
  id: string,
): Check<Readonly<Record<string, string>> | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (!isRecord(value)) {
    return {
      ok: false,
      message: `The declarative asset source "${id}" declares unreadable request.headers.`,
    };
  }

  const headers: Record<string, string> = {};
  for (const [name, header] of Object.entries(value)) {
    if (
      !HEADER_NAME.test(name) ||
      typeof header !== "string" ||
      CONTROL_CHARACTERS.test(header)
    ) {
      return {
        ok: false,
        message: `The declarative asset source "${id}" declares an unusable request header.`,
      };
    }
    headers[name] = header;
  }
  return { ok: true, value: headers };
}

function readUrl(value: unknown): Check<URL> {
  if (typeof value !== "string" || value === "") {
    return {
      ok: false,
      message: "A declarative asset source needs a non-empty request.url.",
    };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return {
      ok: false,
      message: "A declarative asset source URL is not a URL.",
    };
  }
  if (url.protocol !== "https:") return { ok: false, message: HTTPS_REQUIRED };
  if (url.username !== "" || url.password !== "") {
    return { ok: false, message: USERINFO_REFUSED };
  }
  return { ok: true, value: url };
}

/**
 * One contribution, admitted or refused.
 *
 * The descriptor is parsed once at load. A refusal disables only this source;
 * `declarativeAssetSources` reports it and the rest of the extension still
 * loads.
 */
export function readDeclarativeAssetSource(value: unknown): ReadResult {
  if (!isRecord(value)) {
    return refuse("A declarative asset source must be an object.");
  }

  const id = value["id"];
  if (!nonEmpty(id) || !IDENTIFIER_PATTERN.test(id)) {
    return refuse(
      'A declarative asset source needs a lowercase identifier "id".',
    );
  }

  const label = value["label"];
  if (!nonEmpty(label)) {
    return refuse(
      `The declarative asset source "${id}" needs a non-empty "label".`,
    );
  }

  const category = value["category"];
  if (!nonEmpty(category)) {
    return refuse(
      `The declarative asset source "${id}" needs a non-empty "category".`,
    );
  }

  if (value["body"] !== "grid") {
    return refuse(
      `The declarative asset source "${id}" declares a body the editor does not draw; use "grid".`,
    );
  }

  const requiresValue = value["requires"];
  if (requiresValue !== undefined && !nonEmpty(requiresValue)) {
    return refuse(
      `The declarative asset source "${id}" declares an empty "requires".`,
    );
  }
  const requires = requiresValue as string | undefined;

  const presetKindValue = value["presetKind"];
  if (
    presetKindValue !== undefined &&
    (typeof presetKindValue !== "string" || !PRESET_KINDS.has(presetKindValue))
  ) {
    return refuse(
      `The declarative asset source "${id}" declares an unknown presetKind.`,
    );
  }

  const host = value["host"];
  if (!nonEmpty(host)) {
    return refuse(
      `The declarative asset source "${id}" needs a non-empty "host".`,
    );
  }

  if (!isRecord(value["request"])) {
    return refuse(
      `The declarative asset source "${id}" needs a request object.`,
    );
  }
  const requestValue = value["request"];

  const url = readUrl(requestValue["url"]);
  if (!url.ok) return refuse(url.message);

  const headers = readHeaders(requestValue["headers"], id);
  if (!headers.ok) return refuse(headers.message);

  const pageParam = requestValue["pageParam"];
  if (pageParam !== undefined && !nonEmpty(pageParam)) {
    return refuse(
      `The declarative asset source "${id}" declares an empty pageParam.`,
    );
  }

  const firstPage = requestValue["firstPage"];
  if (
    firstPage !== undefined &&
    (typeof firstPage !== "number" ||
      !Number.isInteger(firstPage) ||
      firstPage < 0)
  ) {
    return refuse(
      `The declarative asset source "${id}" declares an unusable firstPage.`,
    );
  }

  const totalPath = requestValue["totalPath"];
  if (totalPath !== undefined && typeof totalPath !== "string") {
    return refuse(
      `The declarative asset source "${id}" declares an unusable totalPath.`,
    );
  }

  const auth = readAuth(requestValue["auth"], id, requires);
  if (!auth.ok) return refuse(auth.message);

  if (!isRecord(value["result"])) {
    return refuse(
      `The declarative asset source "${id}" needs a result object.`,
    );
  }
  const resultValue = value["result"];

  const itemsPath = resultValue["itemsPath"];
  if (typeof itemsPath !== "string") {
    return refuse(
      `The declarative asset source "${id}" needs a string result.itemsPath.`,
    );
  }
  for (const field of ["id", "name"] as const) {
    if (!nonEmpty(resultValue[field])) {
      return refuse(
        `The declarative asset source "${id}" needs a non-empty result.${field} pointer.`,
      );
    }
  }
  for (const field of [
    "preview",
    "subtitle",
    "kind",
    "licence",
    "sourceUrl",
  ] as const) {
    if (
      resultValue[field] !== undefined &&
      typeof resultValue[field] !== "string"
    ) {
      return refuse(
        `The declarative asset source "${id}" declares an unusable result.${field} pointer.`,
      );
    }
  }

  return {
    ok: true,
    source: {
      id,
      label,
      category,
      body: "grid",
      host,
      ...(requires === undefined ? {} : { requires }),
      ...(presetKindValue === undefined
        ? {}
        : { presetKind: presetKindValue as PresetKind }),
      request: {
        url: requestValue["url"] as string,
        ...(headers.value === undefined ? {} : { headers: headers.value }),
        ...(pageParam === undefined ? {} : { pageParam: pageParam as string }),
        ...(firstPage === undefined ? {} : { firstPage: firstPage as number }),
        ...(totalPath === undefined ? {} : { totalPath: totalPath as string }),
        ...(auth.value === undefined ? {} : { auth: auth.value }),
      },
      result: {
        itemsPath,
        id: resultValue["id"] as string,
        name: resultValue["name"] as string,
        ...(resultValue["preview"] === undefined
          ? {}
          : { preview: resultValue["preview"] as string }),
        ...(resultValue["subtitle"] === undefined
          ? {}
          : { subtitle: resultValue["subtitle"] as string }),
        ...(resultValue["kind"] === undefined
          ? {}
          : { kind: resultValue["kind"] as string }),
        ...(resultValue["licence"] === undefined
          ? {}
          : { licence: resultValue["licence"] as string }),
        ...(resultValue["sourceUrl"] === undefined
          ? {}
          : { sourceUrl: resultValue["sourceUrl"] as string }),
      },
    },
  };
}

function warn(pluginKey: string, reason: string): void {
  console.warn(
    `Declarative asset source ${pluginKey}: ${redactForBrowser(reason, LOG_LIMIT)}`,
  );
}

/**
 * Every declarative source the installed extensions may register.
 *
 * Only a contribution whose consent is not missing is considered. A malformed
 * row disables that source alone (or, for a duplicate id, the later row), and
 * an extension may not contribute more than `MAX_SOURCES_PER_EXTENSION`.
 */
export function declarativeAssetSources(
  extensions: readonly InstalledExtension[],
): readonly DeclarativeAssetSource[] {
  const sources: DeclarativeAssetSource[] = [];
  const seen = new Set<string>();

  for (const extension of extensions) {
    if (extension.consent === "missing") continue;

    let accepted = 0;
    for (const entry of extension.contributions.assetSources ?? []) {
      if (isCodeAssetSourceEntry(entry)) continue;

      if (accepted >= MAX_SOURCES_PER_EXTENSION) {
        warn(
          extension.key,
          `it contributes more than ${MAX_SOURCES_PER_EXTENSION} asset sources; the rest are ignored.`,
        );
        break;
      }

      const read = readDeclarativeAssetSource(entry);
      if (!read.ok) {
        warn(extension.key, read.message);
        continue;
      }

      if (seen.has(read.source.id)) {
        warn(
          extension.key,
          `the asset source "${read.source.id}" is already declared; the duplicate is skipped.`,
        );
        continue;
      }

      seen.add(read.source.id);
      accepted += 1;
      sources.push(read.source);
    }
  }

  return sources;
}

interface BuiltRequest {
  readonly url: string;
  /** The search URL a result falls back to, without an inserted credential. */
  readonly publicUrl: string;
  readonly headers: Readonly<Record<string, string>>;
}

type BytesOutcome =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      readonly contentType: string;
      readonly filename: string;
    }
  | { readonly ok: false; readonly reason: string };

function isAllowedHost(
  hostname: string,
  allowedHosts: readonly string[],
): boolean {
  const wanted = hostname.toLowerCase();
  return allowedHosts.some((host) => host.toLowerCase() === wanted);
}

/** A filename is a header value, so a separator or control character would
 *  name a path or split the header. */
function filenameOf(url: URL): string | undefined {
  const last = url.pathname.split("/").at(-1);
  if (last === undefined || last === "") return undefined;

  let name: string;
  try {
    name = decodeURIComponent(last);
  } catch {
    return undefined;
  }
  if (name === "" || name === "." || name === "..") return undefined;
  if (name.includes("/") || name.includes("\\")) return undefined;
  if (CONTROL_CHARACTERS.test(name)) return undefined;
  return name;
}

/** Counts bytes as they arrive: a Content-Length that lies and a stalled body
 *  both stop at the cap. */
async function readBinary(
  response: Response,
  signal: AbortSignal,
  maxBytes: number,
): Promise<Uint8Array> {
  if (response.body === null) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  const aborted = new Promise<never>((_resolve, reject) => {
    const stop = () => reject(new Error(TIMEOUT_REASON));
    if (signal.aborted) {
      stop();
      return;
    }
    signal.addEventListener("abort", stop, { once: true });
  });

  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new Error(`the asset answered more than ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return new Uint8Array(Buffer.concat(chunks));
}

async function fetchArtwork(options: {
  readonly url: string;
  readonly allowedHosts: readonly string[];
  readonly signal: AbortSignal;
  readonly resolve: HostLookup;
  readonly fetchImpl: typeof fetch;
}): Promise<BytesOutcome> {
  return withFetchSlot(async () => {
    try {
      return await fetchArtworkHop(options);
    } catch (error) {
      return {
        ok: false,
        reason: options.signal.aborted ? TIMEOUT_REASON : messageOf(error),
      };
    }
  });
}

async function fetchArtworkHop(options: {
  readonly url: string;
  readonly allowedHosts: readonly string[];
  readonly signal: AbortSignal;
  readonly resolve: HostLookup;
  readonly fetchImpl: typeof fetch;
}): Promise<BytesOutcome> {
  let destination: URL;
  try {
    destination = new URL(options.url);
  } catch {
    return { ok: false, reason: "the asset URL is not a URL" };
  }
  if (destination.protocol !== "https:") {
    return { ok: false, reason: "the asset URL is not https" };
  }
  if (destination.username !== "" || destination.password !== "") {
    return { ok: false, reason: "the asset URL carries credentials" };
  }
  if (!isAllowedHost(destination.hostname, options.allowedHosts)) {
    return {
      ok: false,
      reason: `the host ${destination.hostname} is not declared by the extension`,
    };
  }

  const checked = await checkDestination(
    destination,
    { allowPrivate: false },
    options.resolve,
  );
  if (!checked.ok) return { ok: false, reason: checked.reason };
  if (options.signal.aborted) return { ok: false, reason: TIMEOUT_REASON };

  let response: Response;
  try {
    const init: PinnedRequestInit = {
      headers: new Headers(),
      signal: options.signal,
      redirect: "manual",
      [PINNED_ADDRESSES]: checked.addresses,
    };
    response = await options.fetchImpl(destination, init);
  } catch (error) {
    return {
      ok: false,
      reason: options.signal.aborted ? TIMEOUT_REASON : messageOf(error),
    };
  }

  if (REDIRECT_STATUSES.has(response.status)) {
    await discard(response);
    return { ok: false, reason: "the asset URL redirected" };
  }
  if (!response.ok) {
    await discard(response);
    return {
      ok: false,
      reason: `the asset answered HTTP ${response.status}`,
    };
  }

  const contentType = response.headers.get("content-type")?.trim();
  if (
    contentType === undefined ||
    contentType === "" ||
    CONTROL_CHARACTERS.test(contentType)
  ) {
    await discard(response);
    return { ok: false, reason: "the asset answered an unusable content type" };
  }

  const filename = filenameOf(destination);
  if (filename === undefined) {
    await discard(response);
    return { ok: false, reason: "the asset URL does not name a file" };
  }

  const bytes = await readBinary(response, options.signal, BYTES_MAX_BYTES);
  return { ok: true, bytes, contentType, filename };
}

/**
 * The adapter from a declarative contribution to the host's source port.
 *
 * `fetchImpl` and `resolve` are test seams; in production the search uses the
 * request context's fetch and the host's DNS. A credential comes from
 * `SourceContext.credential` and is inserted only into the outbound request.
 */
export class DeclarativeAssetSourceAdapter implements AssetSource {
  readonly id: string;
  readonly label: string;
  readonly category: string;
  readonly body = "grid" as const;
  readonly requires: string | undefined;
  readonly configurable: boolean;
  readonly presetKind?: PresetKind;
  readonly host: string;

  readonly #pluginKey: string;
  readonly #contribution: DeclarativeAssetSource;
  readonly #allowedHosts: readonly string[];
  readonly #fetchImpl: typeof fetch | undefined;
  readonly #resolve: HostLookup | undefined;
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
    this.requires = options.contribution.requires;
    this.configurable = options.contribution.requires !== undefined;
    this.host = options.contribution.host;
    if (options.contribution.presetKind !== undefined) {
      this.presetKind = options.contribution.presetKind;
    }
    this.#allowedHosts = [
      new URL(options.contribution.request.url).hostname,
      options.contribution.host,
    ];
    this.#fetchImpl = options.fetchImpl;
    this.#resolve = options.resolve;
  }

  async search(
    query: string,
    page: number,
    ctx: SourceContext,
  ): Promise<SearchPage> {
    if (ctx.signal.aborted) throw new Error(messageOf(ctx.signal.reason));

    const credential = this.#credentialOf(ctx);
    const built = this.#buildRequest(query, page, credential);
    const outcome = await guardedFetch({
      url: built.url,
      allowedHosts: this.#allowedHosts,
      headers: built.headers,
      signal: AbortSignal.any([
        ctx.signal,
        AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      ]),
      maxBytes: SEARCH_MAX_BYTES,
      fetchImpl: this.#fetchImpl ?? ctx.fetch,
      resolve: this.#resolve ?? dnsLookup,
      allowPrivateOrigin: false,
    });

    if (!outcome.ok) throw new Error(this.#clean(outcome.reason, credential));

    const items = resolvePointer(
      outcome.body,
      this.#contribution.result.itemsPath,
    );
    if (!items.found || !Array.isArray(items.value)) {
      throw new Error(UNREADABLE_PAGE);
    }

    const results = items.value.map((entry) =>
      this.#readItem(entry, built.publicUrl),
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

    const outcome = await fetchArtwork({
      url,
      allowedHosts: this.#allowedHosts,
      signal: AbortSignal.any([
        ctx.signal,
        AbortSignal.timeout(BYTES_TIMEOUT_MS),
      ]),
      resolve: this.#resolve ?? dnsLookup,
      fetchImpl: this.#fetchImpl ?? ctx.fetch,
    });

    if (!outcome.ok) {
      warn(this.#pluginKey, outcome.reason);
      return undefined;
    }
    return {
      bytes: outcome.bytes,
      contentType: outcome.contentType,
      filename: outcome.filename,
    };
  }

  #credentialOf(ctx: SourceContext): string | undefined {
    const requires = this.#contribution.requires;
    if (requires === undefined) return undefined;

    const value = ctx.credential(requires);
    if (value === undefined || value === "") {
      throw new Error(`The "${requires}" credential is not set.`);
    }
    return value;
  }

  #buildRequest(
    query: string,
    page: number,
    credential: string | undefined,
  ): BuiltRequest {
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
    const auth = request.auth;
    if (auth !== undefined && credential !== undefined) {
      if (auth.kind === "header") headers[auth.name] = credential;
      else url.searchParams.set(auth.name, credential);
    }

    // The fallback a result records must not carry the credential; a search
    // URL is a result field, and a result is visible to the editor.
    const publicUrl = new URL(url.href);
    if (auth !== undefined && auth.kind === "query") {
      publicUrl.searchParams.delete(auth.name);
    }

    return {
      url: url.toString(),
      publicUrl: publicUrl.toString(),
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
    if (!resolved.found || !nonEmpty(resolved.value)) {
      throw new Error(UNREADABLE_ITEM);
    }
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
      !Number.isFinite(resolved.value) ||
      resolved.value < page
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

  #clean(reason: string, credential: string | undefined): string {
    const withoutSecret =
      credential === undefined || credential === ""
        ? reason
        : reason.split(credential).join("[redacted]");
    return redactForBrowser(withoutSecret, LOG_LIMIT);
  }
}
