import {
  checkDestination,
  discard,
  dnsLookup,
  type FetchOutcome,
  type HostLookup,
  isJsonContentType,
  MAX_REDIRECTS,
  messageOf,
  PINNED_ADDRESSES,
  type PinnedRequestInit,
  REDIRECT_STATUSES,
  readBody,
  readBodyBytes,
  TIMEOUT_REASON,
  withFetchSlot,
} from "../../providers/custom/fetch-source.js";

/**
 * A plugin's own request through the destination policy the custom-source
 * reader owns: the manifest-declared host is checked before any dial and again
 * on every hop, link-local and metadata addresses are refused outright, and a
 * private address needs the caller's explicit permission. The plugin's headers
 * and body are its own; no host credential is added. `fetchImpl` must pin the
 * checked address (see `createPinnedFetch`), so a second resolution cannot
 * redirect the connection.
 *
 * The request takes one of the host's four fetch slots, so a plugin cannot
 * hold more stalled connections than every other source combined.
 */

export interface GuardedFetchOptions {
  readonly url: string;
  readonly allowedHosts: readonly string[];
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  readonly maxBytes: number;
  readonly fetchImpl: typeof fetch;
  readonly method?: "GET" | "POST";
  readonly body?: string;
  readonly allowPrivateOrigin?: boolean;
  /** Test seam; production resolves through the host's DNS. */
  readonly resolve?: HostLookup;
  readonly redirects?: number;
}

export interface GuardedFetchBytesOptions {
  readonly url: string;
  readonly allowedHosts: readonly string[];
  readonly signal: AbortSignal;
  readonly maxBytes: number;
  readonly fetchImpl: typeof fetch;
  /** Test seam; production resolves through the host's DNS. */
  readonly resolve?: HostLookup;
  readonly redirects?: number;
}

export type FetchBytesOutcome =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      readonly contentType: string;
    }
  | { readonly ok: false; readonly status?: number; readonly reason: string };

/** Hosts are declared without a port or case, so the comparison drops both. */
export function isAllowedHost(
  hostname: string,
  allowedHosts: readonly string[],
): boolean {
  const wanted = hostname.toLowerCase();
  return allowedHosts.some((host) => host.toLowerCase() === wanted);
}

/** Everything both kinds of request share; the JSON-only fields are absent on
 *  a byte request and never read there. */
interface GuardedRunOptions {
  readonly url: string;
  readonly allowedHosts: readonly string[];
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  readonly maxBytes: number;
  readonly fetchImpl: typeof fetch;
  readonly method?: "GET" | "POST";
  readonly body?: string;
  readonly allowPrivateOrigin?: boolean;
  readonly resolve?: HostLookup;
  readonly redirects?: number;
}

type GuardKind = "json" | "bytes";

type GuardedOutcome<Kind extends GuardKind> = Kind extends "json"
  ? FetchOutcome
  : FetchBytesOutcome;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function guardedFetch(
  options: GuardedFetchOptions,
): Promise<FetchOutcome> {
  return withFetchSlot(() => runGuarded(options, "json"));
}

/**
 * The same destination policy as `guardedFetch`, for an answer that is bytes
 * rather than JSON. Every hop is checked and pinned, the scheme may not change,
 * and a link-local or private destination stays refused.
 */
export function guardedFetchBytes(
  options: GuardedFetchBytesOptions,
): Promise<FetchBytesOutcome> {
  return withFetchSlot(() => runGuarded(options, "bytes"));
}

/**
 * The one hop loop. It owns the host, address, redirect, header/body and
 * response checks; only how a successful body is decoded differs.
 */
async function runGuarded<Kind extends GuardKind>(
  options: GuardedRunOptions,
  kind: Kind,
): Promise<GuardedOutcome<Kind>> {
  const startedAt = Date.now();
  const fetchImpl = options.fetchImpl;
  const resolve = options.resolve ?? dnsLookup;
  const maxRedirects = options.redirects ?? MAX_REDIRECTS;
  const allowPrivate = options.allowPrivateOrigin === true;

  const fail = (reason: string, status?: number): GuardedOutcome<Kind> =>
    (status === undefined
      ? { ok: false, reason }
      : { ok: false, status, reason }) as GuardedOutcome<Kind>;

  let destination: URL;
  try {
    destination = new URL(options.url);
  } catch {
    return fail("the request URL is not a URL");
  }

  if (destination.protocol !== "http:" && destination.protocol !== "https:") {
    return fail("the request URL must be http or https");
  }
  if (destination.username !== "" || destination.password !== "") {
    return fail("the request URL carries credentials");
  }
  if (!isAllowedHost(destination.hostname, options.allowedHosts)) {
    return fail(
      `the host ${destination.hostname} is not declared by the plugin`,
    );
  }

  const origin = destination.origin;
  let sameOrigin = true;
  let redirects = 0;

  for (;;) {
    if (!isAllowedHost(destination.hostname, options.allowedHosts)) {
      return fail(
        `the host ${destination.hostname} is not declared by the plugin`,
      );
    }

    const checked = await checkDestination(
      destination,
      { allowPrivate },
      resolve,
    );
    if (!checked.ok) return fail(checked.reason);
    if (options.signal.aborted) return fail(TIMEOUT_REASON);

    const headers = new Headers();
    if (sameOrigin) {
      for (const [name, value] of Object.entries(options.headers ?? {})) {
        headers.set(name, value);
      }
    }

    const init: PinnedRequestInit = {
      headers,
      signal: options.signal,
      redirect: "manual",
      [PINNED_ADDRESSES]: checked.addresses,
    };
    if (options.method !== undefined) init.method = options.method;
    // A cross-origin hop carries neither the plugin's headers nor its body: a
    // body can hold the plugin's own credential.
    if (sameOrigin && options.body !== undefined) init.body = options.body;

    let response: Response;
    try {
      response = await fetchImpl(destination, init);
    } catch (error) {
      return fail(options.signal.aborted ? TIMEOUT_REASON : messageOf(error));
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      await discard(response);

      if (redirects >= maxRedirects) {
        return fail(`the request redirected more than ${maxRedirects} times`);
      }

      const location = response.headers.get("location");
      if (location === null) {
        return fail("the request redirected without a location");
      }

      let next: URL;
      try {
        next = new URL(location, destination);
      } catch {
        return fail("the request redirected to an unusable address");
      }

      if (next.username !== "" || next.password !== "") {
        return fail("the request redirected to a URL carrying credentials");
      }
      if (next.protocol !== destination.protocol) {
        return fail(
          `the request redirected from ${destination.protocol} to ${next.protocol}, which changes the scheme`,
        );
      }
      if (!isAllowedHost(next.hostname, options.allowedHosts)) {
        return fail(`the host ${next.hostname} is not declared by the plugin`);
      }

      redirects += 1;
      if (next.origin !== origin) sameOrigin = false;
      destination = next;
      continue;
    }

    if (!response.ok) {
      await discard(response);
      return fail(
        `the request answered HTTP ${response.status}`,
        response.status,
      );
    }

    if (kind === "json") {
      const contentType = response.headers.get("content-type");
      if (!isJsonContentType(contentType)) {
        await discard(response);
        return fail(
          `the request answered ${contentType ?? "no content type"} instead of JSON`,
          response.status,
        );
      }

      let text: string;
      try {
        text = await readBody(response, options.signal, options.maxBytes);
      } catch (error) {
        return fail(
          options.signal.aborted ? TIMEOUT_REASON : messageOf(error),
          response.status,
        );
      }

      try {
        return {
          ok: true,
          body: JSON.parse(text),
          elapsedMs: Date.now() - startedAt,
        } as GuardedOutcome<Kind>;
      } catch {
        return fail(
          "the request answered something that is not JSON",
          response.status,
        );
      }
    }

    const contentType = response.headers.get("content-type")?.trim();
    if (
      contentType === undefined ||
      contentType === "" ||
      CONTROL_CHARACTERS.test(contentType)
    ) {
      await discard(response);
      return fail(
        "the request answered an unusable content type",
        response.status,
      );
    }

    try {
      const bytes = await readBodyBytes(
        response,
        options.signal,
        options.maxBytes,
      );
      return { ok: true, bytes, contentType } as GuardedOutcome<Kind>;
    } catch (error) {
      return fail(
        options.signal.aborted ? TIMEOUT_REASON : messageOf(error),
        response.status,
      );
    }
  }
}
