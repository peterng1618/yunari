# 0105 — Custom-source fetching owns one bounded request and a pointer walk

- **Date:** 2026-10-24
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/providers/custom/fetch-source.ts`,
  `src/web/packages/host/src/providers/custom/pointer.ts`

## The problem

A user-authored HTTP source is the one request in the host whose destination is
typed by a user and can redirect. The shape is not "call an endpoint": the
client must resolve a hostname and refuse link-local answers *before* dialling,
re-check every redirect hop, drop a credential when an origin changes, read a
1 MiB body without buffering past it, share four in-flight slots across every
source, serialise one source against itself, and keep a credential out of every
reason it returns. The field reader then walks RFC 6901, where a malformed
pointer or an invalid `~` escape is a miss rather than an exception. A wrong
answer here is invisible: a request that quietly follows one hop too many, or
reads a metadata endpoint, still returns JSON.

## Rung 1 — Yunari

Searched: `src/web/packages/host/src/providers/` for timeout/cap/redirect
policy, address-range checks, a JSON Pointer resolver and a concurrency
limiter; and the wider tree for the same symbols.

Found: `weather/open-meteo.ts` owns `fetchWeatherJson` with `TIMEOUT_MS`,
`MAX_BODY_BYTES = 1 MiB`, chunked reading and `redirect: "error"`. It refuses
redirects outright, so it cannot be the client for a source that may follow
three, and it has no address check or concurrency policy. No SSRF/link-local
check exists anywhere in `src/` or `scripts/`. No JSON Pointer resolver and no
semaphore exist. `settings/sources.ts` validates the URL shape but never dials
it.

## Rung 2 — dependencies

Searched: `@yunari/host`'s manifest and the workspace manifests for an HTTP
client, an IP-range library, a pointer library or a concurrency limiter.

Found: the host declares workspace packages, `ffmpeg-static`, `node-forge` and
`systeminformation`; no HTTP client. `undici` is installed only transitively
under `packages/store-worker`'s dev dependency `miniflare`, not as a host
dependency. Adding any of these would be a new shipped dependency for a few
dozen lines and would still leave the host's policy (cap, hop count, credential
drop) as the part that matters.

## Rung 3 — platform

Searched: `fetch`, `AbortSignal.timeout`, `URL`, `node:dns/promises.lookup`,
`node:http` and the WHATWG URL parser.

Found: native `fetch` covers the request, `redirect: "manual"` exposes the 3xx
status and `Location` (probed), and `AbortSignal.timeout` is the deadline the
spec names. `dns.lookup(host, { all: true, verbatim: true })` returns every
resolved address, including both `::1` and `127.0.0.1` for `localhost` (probed),
which is what "validate every resolved address" needs. The platform leaves the
rest to us: global `fetch` has no per-request lookup hook, so the dial resolves
again after our check (the residual rebinding window is reported, not hidden);
there is no native JSON Pointer, no address-range predicate and no semaphore.

## Rung 4 — ecosystem

Searched: npm registry for `ipaddr.js`, `ssrf-req-filter`, `jsonpointer`,
`p-limit`; and `undici`'s `Agent` `connect.lookup` option.

Found: all four packages exist (`ipaddr.js` 2.5.0, `ssrf-req-filter` 1.1.1,
`jsonpointer` 5.0.1, `p-limit` 7.3.3). `ssrf-req-filter` patches
`node:http.request`, not `fetch`; `ipaddr.js` parses arbitrary address forms for
two range tests; `jsonpointer` and `p-limit` each replace a few dozen lines.
`undici`'s custom `lookup` would close the rebinding window, but only by adding
`undici` as a direct host dependency and reimplementing the request on its
`Agent` — the platform already gives the request we need, and the window is a
reported limit rather than an undisclosed one.

## Rung 5 — comparison

| Option | Fits | Rejected because |
|---|---|---|
| `undici` Agent with custom `lookup` | closes DNS rebinding | new direct dependency; replaces native fetch |
| `ssrf-req-filter` / `ipaddr.js` | address checks | new dependency; `ipaddr.js` is two range predicates we can state |
| `jsonpointer` | RFC 6901 | new dependency for ~30 lines, and we must not throw on malformed escapes |
| `p-limit` | concurrency | new dependency for one counter and one queue |
| Native fetch + `dns.lookup` + small local helpers | whole policy in one owner | chosen |

## Rung 6 — probe

Probed with `node` against a loopback server and the URL parser:

- `new URL("http://[::ffff:169.254.169.254]/x").hostname` canonicalises to
  `[::ffff:a9fe:a9fe]`, so a mapped IPv4 literal has to be decoded from hex
  before the link-local test; the dotted form alone would pass.
- `fetch(..., { redirect: "manual" })` returned status 302, type `basic`, and
  `Location: /next`, so following hops ourselves is possible.
- `dns.lookup("localhost", { all: true, verbatim: true })` returned `[::1,
  127.0.0.1]`, so "allow loopback" must allow both families.
- `AbortSignal.timeout` passed to `fetch` aborts a pending request (asserted by
  the suite's timeout cases); the body reader races the same signal, because an
  injected seam's stream is not wired to it.

The suite drives the policy with an injected seam and one real loopback server:
exactly 1 MiB accepted, 1 MiB + 1 refused mid-stream, three redirects followed
and a fourth refused, a scheme change refused, a cross-origin credential
dropped, metadata/link-local refused before any call, four in flight with a
fifth waiting, and one source serialised.

## Rung 7 — build

Built: `fetch-source.ts` owns the whole policy — destination check per hop,
manual redirects, credential construction and cross-origin drop, byte-counted
body cap, JSON content-type check, `AbortSignal.timeout`, a module-level
four-slot semaphore and a per-source tail, returning a redacted reason rather
than throwing. `pointer.ts` is the RFC 6901 walk with misses instead of
exceptions. Both are consumed by the custom provider, not by the settings UI.
