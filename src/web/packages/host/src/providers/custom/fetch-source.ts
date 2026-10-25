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

function bareAddress(address: string): string {
  return address.replace(/^\[/, "").replace(/\]$/, "").split("%")[0] ?? "";
}

/** Eight 16-bit groups, expanding `::` and a trailing dotted quad, or
 *  undefined when the text is not IPv6. */
function ipv6Groups(address: string): number[] | undefined {
  let text = address;

  const dotted = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (dotted !== null) {
    const v4 = asIpv4(dotted[2] ?? "");
    if (v4 === undefined) return undefined;
    const high = Math.floor(v4 / 0x10000).toString(16);
    const low = (v4 % 0x10000).toString(16);
    text = `${dotted[1]}${high}:${low}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return undefined;

  const parse = (part: string): number[] | undefined => {
    const groups: number[] = [];
    if (part === "") return groups;
    for (const group of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/i.test(group)) return undefined;
      groups.push(Number.parseInt(group, 16));
    }
    return groups;
  };

  const head = parse(halves[0] ?? "");
  const tail = halves.length === 2 ? parse(halves[1] ?? "") : [];
  if (head === undefined || tail === undefined) return undefined;
  if (halves.length === 1) return head.length === 8 ? head : undefined;

  const missing = 8 - head.length - tail.length;
  if (missing < 1) return undefined;
  return [...head, ...Array.from({ length: missing }, () => 0), ...tail];
}

/** The IPv4 an address carries inside a mapped (`::ffff:a.b.c.d`), translated
 *  (`::ffff:0:a.b.c.d`), NAT64 (`64:ff9b::/96` and `64:ff9b:1::/96`), 6to4
 *  (`2002::/16`) or Teredo (`2001::/32`) form. Teredo hides the client in the
 *  last 32 bits XORed with all ones, so it is decoded before any range test. */
function embeddedIpv4(groups: readonly number[]): number | undefined {
  const group = (index: number): number => groups[index] ?? 0;
  const low = group(6) * 0x10000 + group(7);
  const zeros = (until: number): boolean => {
    for (let index = 0; index < until; index += 1) {
      if (group(index) !== 0) return false;
    }
    return true;
  };

  if (zeros(5) && group(5) === 0xffff) return low;
  if (zeros(4) && group(4) === 0xffff && group(5) === 0) return low;

  if (group(0) === 0x64 && group(1) === 0xff9b) {
    const wellKnown =
      group(2) === 0 && group(3) === 0 && group(4) === 0 && group(5) === 0;
    const localUse =
      group(2) === 1 && group(3) === 0 && group(4) === 0 && group(5) === 0;
    if (wellKnown || localUse) return low;
  }

  if (group(0) === 0x2002) return group(1) * 0x10000 + group(2);
  if (group(0) === 0x2001 && group(1) === 0) return 0xffffffff - low;

  // Ceiling: IPv4-compatible `::a.b.c.d` is not decoded; not enumerated, not routable today.

  return undefined;
}

/** RFC 1918, loopback, CGNAT (`100.64.0.0/10`) and `0.0.0.0/8`. Link-local is
 *  not here: it is refused on every hop, including the first. */
function isPrivateV4(value: number): boolean {
  const top = Math.floor(value / 0x1000000);
  return (
    top === 0 ||
    top === 10 ||
    top === 127 ||
    (value >= 0x64400000 && value <= 0x647fffff) ||
    (value >= 0xac100000 && value <= 0xac1fffff) ||
    (value >= 0xc0a80000 && value <= 0xc0a8ffff)
  );
}

function isPrivateAddress(address: string): boolean {
  const lower = bareAddress(address).toLowerCase();
  const v4 = asIpv4(lower);
  if (v4 !== undefined) return isPrivateV4(v4);

  const groups = ipv6Groups(lower);
  if (groups === undefined) return false;

  const embedded = embeddedIpv4(groups);
  if (embedded !== undefined) return isPrivateV4(embedded);

  const first = groups[0] ?? 0;
  if (groups.every((group) => group === 0)) return true;
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) {
    return true;
  }
  return (first & 0xfe00) === 0xfc00;
}

/** IPv4 `169.254.0.0/16` and IPv6 `fe80::/10`: metadata and link-local, refused
 *  on every hop. Private ranges depend on who typed the URL. */
export function isBlockedAddress(address: string): boolean {
  const lower = bareAddress(address).toLowerCase();
  const v4 = asIpv4(lower);
  if (v4 !== undefined) return isLinkLocalV4(v4);

  const groups = ipv6Groups(lower);
  if (groups === undefined) return false;

  const embedded = embeddedIpv4(groups);
  if (embedded !== undefined) return isLinkLocalV4(embedded);

  return ((groups[0] ?? 0) & 0xffc0) === 0xfe80;
}

function isIpLiteral(host: string): boolean {
  const bare = host.replace(/^\[/, "").replace(/\]$/, "");
  return asIpv4(bare) !== undefined || bare.includes(":");
}

export interface ResolvedAddress {
  readonly address: string;
  readonly family: number;
}

/** The policy's one resolution. A test injects it so a second resolution at
 *  connect time would show up as a second call. */
export type HostLookup = (host: string) => Promise<readonly ResolvedAddress[]>;

export const dnsLookup: HostLookup = async (host) => {
  const entries = await lookup(host, { all: true, verbatim: true });
  return entries.map((entry) => ({
    address: entry.address,
    family: entry.family,
  }));
};

/** The addresses the policy checked for a hostname, so the connection can pin
 *  one instead of resolving again. Every policy resolution replaces the entry,
 *  so a later fetch re-resolves rather than reusing a stale answer. A hostname
 *  is the only key `connect.lookup` receives, so two sources resolving the same
 *  name at once share whichever answer was recorded last. */
const checkedByHost = new Map<string, readonly ResolvedAddress[]>();

export function recordCheckedAddresses(
  host: string,
  addresses: readonly ResolvedAddress[],
): void {
  checkedByHost.set(host, addresses);
}

export function checkedAddressesFor(
  host: string,
): readonly ResolvedAddress[] | undefined {
  return checkedByHost.get(host);
}

type Resolved =
  | { readonly ok: true; readonly addresses: readonly ResolvedAddress[] }
  | { readonly ok: false; readonly reason: string };

async function resolveDestination(
  destination: URL,
  resolve: HostLookup,
): Promise<Resolved> {
  if (destination.protocol !== "http:" && destination.protocol !== "https:") {
    return { ok: false, reason: "the source URL must be http or https" };
  }

  const host = destination.hostname;

  if (isIpLiteral(host)) {
    const bare = host.replace(/^\[/, "").replace(/\]$/, "");
    return {
      ok: true,
      addresses: [{ address: bare, family: bare.includes(":") ? 6 : 4 }],
    };
  }

  let resolved: readonly ResolvedAddress[];
  try {
    resolved = await resolve(host);
  } catch {
    return { ok: false, reason: "the source host could not be resolved" };
  }
  if (resolved.length === 0) {
    return { ok: false, reason: "the source host has no address" };
  }

  return { ok: true, addresses: resolved };
}

function refusalOf(
  addresses: readonly string[],
  allowPrivate: boolean,
): string | undefined {
  if (addresses.some(isBlockedAddress)) {
    return "the source resolves to a link-local or metadata address";
  }
  if (!allowPrivate && addresses.some(isPrivateAddress)) {
    return "the source resolves to a private or loopback address";
  }
  return undefined;
}

async function refusalReason(
  destination: URL,
  options: { readonly allowPrivate: boolean },
  resolve: HostLookup,
): Promise<string | undefined> {
  const resolved = await resolveDestination(destination, resolve);
  if (!resolved.ok) return resolved.reason;

  const addresses = resolved.addresses.map((entry) => entry.address);
  const refused = refusalOf(addresses, options.allowPrivate);
  // Only an address that passed the policy may be pinned for the connection.
  if (refused === undefined && !isIpLiteral(destination.hostname)) {
    recordCheckedAddresses(destination.hostname, resolved.addresses);
  }
  return refused;
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
  resolve: HostLookup,
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
  let allowPrivate = false;
  let firstHop = true;

  for (;;) {
    if (firstHop) {
      // The user typed the first URL, so its private ranges are allowed; a
      // redirect may only reach them when that first URL already did.
      const resolved = await resolveDestination(destination, resolve);
      if (!resolved.ok) return fail(resolved.reason);
      const addresses = resolved.addresses.map((entry) => entry.address);
      allowPrivate = addresses.every(isPrivateAddress);
      const refused = refusalOf(addresses, true);
      if (refused !== undefined) return fail(refused);
      if (!isIpLiteral(destination.hostname)) {
        recordCheckedAddresses(destination.hostname, resolved.addresses);
      }
      firstHop = false;
    } else {
      const refused = await refusalReason(
        destination,
        { allowPrivate },
        resolve,
      );
      if (refused !== undefined) return fail(refused);
    }
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
  resolve: HostLookup = dnsLookup,
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
      return await run(source, credential, fetchImpl, resolve, nowMs, fail);
    } catch (error) {
      return fail(messageOf(error));
    } finally {
      releaseSlot();
    }
  });
}
