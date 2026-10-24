import { lookup } from "node:dns/promises";
import type { CustomSource } from "../../settings/sources.js";
import { redactForBrowser } from "../provider.js";

/**
 * The one request a user-authored source makes. A destination typed by a user
 * can point anywhere, so the whole policy lives here: resolve and refuse
 * before dialling, re-check every hop, drop a credential on a cross-origin
 * redirect, count the body as it arrives, and share one process-wide limit.
 */

export type FetchOutcome =
  | { readonly ok: true; readonly body: unknown; readonly elapsedMs: number }
  | { readonly ok: false; readonly status?: number; readonly reason: string };

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;
const MAX_IN_FLIGHT = 4;
const TIMEOUT_REASON = "the source did not answer within its timeout";
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([
  301, 302, 303, 307, 308,
]);

type Fail = (reason: string, status?: number) => FetchOutcome;

/** Four fetches across the whole host, however many sources are configured. */
let inFlight = 0;
const waitingSlots: (() => void)[] = [];

function acquireSlot(): Promise<void> {
  if (inFlight < MAX_IN_FLIGHT) {
    inFlight += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waitingSlots.push(resolve));
}

function releaseSlot(): void {
  const next = waitingSlots.shift();
  if (next !== undefined) {
    // The freed slot passes straight to the waiter; `inFlight` is unchanged.
    next();
    return;
  }
  inFlight -= 1;
}

/** One tail per source id, so a second call queues rather than overlaps. */
const sourceTails = new Map<string, Promise<void>>();

async function withSourceLock<T>(
  id: string,
  work: () => Promise<T>,
): Promise<T> {
  const previous = sourceTails.get(id) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  sourceTails.set(id, tail);

  await previous;
  try {
    return await work();
  } finally {
    release();
    if (sourceTails.get(id) === tail) sourceTails.delete(id);
  }
}

function asIpv4(address: string): number | undefined {
  const parts = address.split(".");
  if (parts.length !== 4) return undefined;

  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const octet = Number(part);
    if (octet > 255) return undefined;
    value = value * 256 + octet;
  }
  return value;
}

function isLinkLocalV4(value: number): boolean {
  return value >= 0xa9fe0000 && value <= 0xa9feffff;
}

/** `::ffff:169.254.169.254` canonicalises to `::ffff:a9fe:a9fe`, so the mapped
 *  IPv4 has to be decoded from either spelling before the range test. */
function mappedIpv4(address: string): number | undefined {
  const match =
    /^::ffff:(?:(\d{1,3}(?:\.\d{1,3}){3})|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/.exec(
      address,
    );
  if (match === null) return undefined;
  if (match[1] !== undefined) return asIpv4(match[1]);

  const high = Number.parseInt(match[2] ?? "", 16);
  const low = Number.parseInt(match[3] ?? "", 16);
  return high * 0x10000 + low;
}

/** An IPv4 encoded in a translation prefix, or undefined. NAT64's well-known
 *  prefix `64:ff9b::/96` carries it in the low 32 bits; 6to4's `2002::/16`
 *  carries it in bits 16..47. Canonical URLs always print both compressed. */
function translatedIpv4(address: string): number | undefined {
  const nat64 = /^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(address);
  const sixToFour =
    nat64 ?? /^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})(?::|$)/.exec(address);
  if (sixToFour === null) return undefined;

  const high = Number.parseInt(sixToFour[1] ?? "", 16);
  const low = Number.parseInt(sixToFour[2] ?? "", 16);
  return high * 0x10000 + low;
}

/** IPv4 `169.254.0.0/16` and IPv6 `fe80::/10`: metadata and link-local only.
 *  Loopback and the private LAN ranges are deliberate: the user typed the URL. */
function isBlockedAddress(address: string): boolean {
  const bare = address.replace(/^\[/, "").replace(/\]$/, "").split("%")[0];
  if (bare === undefined) return true;
  const lower = bare.toLowerCase();

  const v4 = asIpv4(lower);
  if (v4 !== undefined) return isLinkLocalV4(v4);

  const mapped = mappedIpv4(lower);
  if (mapped !== undefined) return isLinkLocalV4(mapped);

  const translated = translatedIpv4(lower);
  if (translated !== undefined) return isLinkLocalV4(translated);

  return /^fe[89ab][0-9a-f]:/.test(lower);
}

function isIpLiteral(host: string): boolean {
  const bare = host.replace(/^\[/, "").replace(/\]$/, "");
  return asIpv4(bare) !== undefined || bare.includes(":");
}

async function refusalReason(destination: URL): Promise<string | undefined> {
  if (destination.protocol !== "http:" && destination.protocol !== "https:") {
    return "the source URL must be http or https";
  }

  const host = destination.hostname;
  const addresses: string[] = [];

  if (isIpLiteral(host)) {
    addresses.push(host.replace(/^\[/, "").replace(/\]$/, ""));
  } else {
    try {
      const resolved = await lookup(host, { all: true, verbatim: true });
      for (const entry of resolved) addresses.push(entry.address);
    } catch {
      return "the source host could not be resolved";
    }
    if (addresses.length === 0) return "the source host has no address";
  }

  for (const address of addresses) {
    if (isBlockedAddress(address)) {
      return "the source resolves to a link-local or metadata address";
    }
  }
  return undefined;
}

interface BuiltRequest {
  readonly url: URL;
  readonly headers: Headers;
}

function responseOf(
  built: BuiltRequest | { readonly reason: string },
): built is BuiltRequest {
  return "url" in built;
}

/** The source's configured query belongs to the first URL only; a redirect's
 *  `Location` is the endpoint that answered. Only the credential query is
 *  re-applied on a same-origin hop that dropped it. */
function buildRequest(
  source: CustomSource,
  destination: URL,
  credential: string | undefined,
  sameOrigin: boolean,
): BuiltRequest | { readonly reason: string } {
  const url = new URL(destination.href);
  const headers = new Headers();

  // A cross-origin hop gets none of the source's headers: they were configured
  // for the endpoint the user typed, and a redirect is not that endpoint.
  // Named headers are often secrets even when they are not `Authorization`.
  if (sameOrigin) {
    for (const [name, value] of Object.entries(source.headers ?? {})) {
      headers.set(name, value);
    }
  }

  const auth = source.auth;
  if (auth === undefined || auth.kind === "none" || !sameOrigin) {
    return { url, headers };
  }
  if (credential === undefined)
    return { reason: "the source's credential is not set" };

  switch (auth.kind) {
    case "bearer":
      headers.set("authorization", `Bearer ${credential}`);
      break;
    case "basic":
      headers.set(
        "authorization",
        `Basic ${Buffer.from(credential).toString("base64")}`,
      );
      break;
    case "header":
      if (auth.headerName === undefined) {
        return { reason: "the source's auth header has no name" };
      }
      headers.set(auth.headerName, credential);
      break;
    case "query":
      if (auth.queryName === undefined) {
        return { reason: "the source's auth query has no name" };
      }
      url.searchParams.set(auth.queryName, credential);
      break;
  }

  return { url, headers };
}

function isJsonContentType(value: string | null): boolean {
  if (value === null) return false;
  const type = value.split(";")[0]?.trim().toLowerCase() ?? "";
  return /^application\/(?:json|[\w.+-]+\+json)$/.test(type);
}

async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

/** Counts bytes as they arrive and races the deadline, so neither an upstream
 *  that ignores `content-length` nor a stalled body can outlast the cap. */
async function readBody(
  response: Response,
  signal: AbortSignal,
): Promise<string> {
  if (response.body === null) return "";

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
      if (total > MAX_BODY_BYTES) {
        throw new Error(
          `the source answered more than ${MAX_BODY_BYTES} bytes`,
        );
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message !== ""
    ? error.message
    : "the source could not be fetched";
}

/** A reason may reach a display: strip the credential, then the address. */
function reasonOf(message: string, credential: string | undefined): string {
  const withoutSecret =
    credential === undefined || credential === ""
      ? message
      : message.split(credential).join("[redacted]");
  return redactForBrowser(withoutSecret);
}

async function run(
  source: CustomSource,
  credential: string | undefined,
  fetchImpl: typeof fetch,
  nowMs: () => number,
  fail: Fail,
): Promise<FetchOutcome> {
  const startedAt = nowMs();
  let destination: URL;
  try {
    destination = new URL(source.url);
  } catch {
    return fail("the source URL is not a URL");
  }
  for (const [name, value] of Object.entries(source.query ?? {})) {
    destination.searchParams.set(name, value);
  }

  const origin = destination.origin;
  const signal = AbortSignal.timeout(source.timeoutMs);
  let sameOrigin = true;
  let redirects = 0;

  for (;;) {
    const refused = await refusalReason(destination);
    if (refused !== undefined) return fail(refused);
    if (signal.aborted) return fail(TIMEOUT_REASON);

    const built = buildRequest(source, destination, credential, sameOrigin);
    if (!responseOf(built)) return fail(built.reason);

    let response: Response;
    try {
      response = await fetchImpl(built.url, {
        headers: built.headers,
        signal,
        redirect: "manual",
      });
    } catch (error) {
      return fail(signal.aborted ? TIMEOUT_REASON : messageOf(error));
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      // Not raced against the deadline: native fetch drops a cancelled socket
      // promptly, and a seam that stalls here is a test bug, not a source.
      await discard(response);

      if (redirects >= MAX_REDIRECTS) {
        return fail(`the source redirected more than ${MAX_REDIRECTS} times`);
      }

      const location = response.headers.get("location");
      if (location === null) {
        return fail("the source redirected without a location");
      }

      let next: URL;
      try {
        next = new URL(location, built.url);
      } catch {
        return fail("the source redirected to an unusable address");
      }

      if (next.username !== "" || next.password !== "") {
        return fail("the source redirected to a URL carrying credentials");
      }

      if (next.protocol !== built.url.protocol) {
        return fail(
          `the source redirected from ${built.url.protocol} to ${next.protocol}, which changes the scheme`,
        );
      }

      redirects += 1;
      if (next.origin !== origin) sameOrigin = false;
      destination = next;
      continue;
    }

    if (!response.ok) {
      await discard(response);
      return fail(
        `the source answered HTTP ${response.status}`,
        response.status,
      );
    }

    const contentType = response.headers.get("content-type");
    if (!isJsonContentType(contentType)) {
      await discard(response);
      return fail(
        `the source answered ${contentType ?? "no content type"} instead of JSON`,
        response.status,
      );
    }

    let text: string;
    try {
      text = await readBody(response, signal);
    } catch (error) {
      return fail(
        signal.aborted ? TIMEOUT_REASON : messageOf(error),
        response.status,
      );
    }

    try {
      return {
        ok: true,
        body: JSON.parse(text),
        elapsedMs: nowMs() - startedAt,
      };
    } catch {
      return fail(
        "the source answered something that is not JSON",
        response.status,
      );
    }
  }
}

export async function fetchSource(
  source: CustomSource,
  credential: string | undefined,
  fetchImpl: typeof fetch,
  nowMs: () => number,
): Promise<FetchOutcome> {
  const fail: Fail = (reason, status) => {
    const clean = reasonOf(reason, credential);
    return status === undefined
      ? { ok: false, reason: clean }
      : { ok: false, status, reason: clean };
  };

  return withSourceLock(source.id, async () => {
    await acquireSlot();
    try {
      return await run(source, credential, fetchImpl, nowMs, fail);
    } catch (error) {
      return fail(messageOf(error));
    } finally {
      releaseSlot();
    }
  });
}
