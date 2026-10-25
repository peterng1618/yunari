# 0116 — A loopback admin request must prove it is same-origin

- **Date:** 2026-10-25
- **Status:** accepted 2026-10-25
- **Paths:** `src/web/packages/host/src/server.ts`,
  `src/web/packages/host/src/serve/static-path.ts`,
  `src/web/packages/host/src/providers/`,
  `src/web/packages/renderer-core/src/theme/`

## The problem

The host's admin API is reachable only from the loopback interface, but "the
peer is loopback" is not the same claim as "the request came from the host's
own page". A browser lured to `evil.example` can resolve that name to
`127.0.0.1` and send requests whose peer is loopback and whose `Host` is
`evil.example`. The existing `isForeignOrigin` encodes the right check but was
applied route by route; `/api/themes/import` and the Wallpaper Engine routes
never called it. A theme asset was typed by its file extension, so an imported
package could serve `assets/x.html` as same-origin HTML.

The same boundary owns outbound fetches for custom sources. Checking a resolved
address and then letting `fetch` resolve again leaves a rebinding window, and a
redirect can walk from a public host into RFC1918 or loopback.

## Rung 1 — Yunari

Searched: `isForeignOrigin`, `isLoopbackRemote`, `contentTypeFor`,
`resolveStaticPath`, `refusalReason`, `isBlockedAddress`; every `/api/` branch
in `server.ts`; `serve/static-path.ts`; `providers/custom/fetch-source.ts`;
`theme-package` and `renderer-core/src/theme`.

Found:
- `isForeignOrigin` in `server.ts` already requires a loopback `Host` and an
  agreeing `Origin`, but only `install`, `normalize-video` and a few routes call
  it.
- `contentTypeFor` maps a path extension, and the asset route trusts the
  package's declared `kind` only for storage, not for the response type.
- `resolveStaticPath` is lexical; a symlink inside a bundle root escapes it.
- `isBlockedAddress` refuses only link-local/metadata; loopback, RFC1918 and
  CGNAT are deliberately allowed for the first URL.
- `refusalReason` resolves DNS, then `fetch` resolves again.

## Rung 2 — dependencies

Searched: `packages/host/package.json`, the workspace lockfile, and the
workspace tree for an HTTP framework or security middleware.

Found: the host uses `node:http` directly. There is no Express/Fastify/Hono
stack, no `helmet`, no `express-rate-limit`. `undici` is present transitively
through the toolchain and can be a direct dependency without adding a new
package family.

## Rung 3 — platform

Searched: Node `http`, `net`, `fs.realpath`, `URL`, `dns.lookup`; the fetch
standard; CSP and `X-Content-Type-Options`; undici's `Agent`/`connect.lookup`.

Found:
- `http.IncomingMessage.headers.host` and `.socket.remoteAddress` are enough to
  make the same-origin decision before dispatch.
- `net.Server.maxConnections`, `socket.setTimeout` and `socket.destroy` bound a
  pre-handshake connection without an application timer per request.
- `fs.realpath` plus a prefix check contains a resolved path; `lstat` identifies
  the link itself.
- `nosniff` and `Content-Security-Policy: sandbox; default-src 'none'` stop a
  directly navigated SVG/HTML from running on the host origin.
- `undici.Agent({ connect: { lookup } })` lets the connection use the address
  the policy checked rather than resolving a second time.

## Rung 4 — ecosystem

Searched: GitHub Security Lab "localhost dangers: CORS and DNS rebinding";
NCC Group Singularity's DNS-rebinding prevention notes; OWASP "SSRF Prevention
in Node.js"; the `host-validation` npm middleware; Express `trust proxy` and
Host-header guidance; undici connection options.

Found:
- The shared rule is Host allowlisting for loopback services, not a CORS
  header. DNS rebinding survives CORS because the browser believes the origin
  is the attacker's domain; the `Host` header still carries that domain.
- `host-validation` implements exactly the Host/Referer allowlist and returns
  403, but it is Express middleware and this host has no Express.
- OWASP's Node SSRF guidance names the same failure shapes found here:
  validating a hostname string, trusting the first DNS answer, and ignoring
  redirects. It recommends resolving and classifying every hop and pinning the
  connection, which is what `undici` exposes.
- No package solves the theme-asset kind/extension problem; that is a data
  model decision, not a middleware one.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| One pre-dispatch Host/Origin guard plus per-surface checks | Reuses the existing `isForeignOrigin`; no dependency; applies to reads and writes | Must keep `/api/host` exempt | A missed exemption breaks LAN discovery; a missed route reopens the hole | Chosen |
| `host-validation` middleware | Proven Host/Referer check | Adds Express; this host is raw `http` | Rewrites the request pipeline for one predicate | Rejected |
| Require a CSRF token on every admin write | Strong against cross-site writes | Does not protect reads with side effects; changes the editor's API | Pairing and polling still exposed | Rejected |
| Bind the admin server to a Unix socket / named pipe | No network origin at all | Windows browser cannot reach it; breaks the editor | A platform-specific launcher | Rejected |
| Extension-based content type plus `nosniff` | Minimal change | Still serves a misnamed file with a safe type only if the type is correct | HTML injection if the extension wins | Rejected |
| Declared-kind MIME allowlist plus CSP sandbox | The package's own data model decides | Validation must agree with the route | A new kind needs a map entry | Chosen |
| Check then fetch with the default resolver | No new dependency | Rebinding window remains | SSRF via a second DNS answer | Rejected |
| Pinned `undici` lookup per hop | Closes the window; redirects re-pin | `undici` becomes a direct dependency | Must keep the injected fetch seam for tests | Chosen |

## Rung 6 — probe

Baseline reading, 2026-10-25: the existing `isForeignOrigin` predicate and the
`isBlockedAddress` table were read in source and exercised by the existing host
tests; the audit recorded the routes that do not call them. No new runtime
measurement was taken before this note. The regression tests in Tasks 1.1, 1.2,
1.3, 1.5 and 2.3 are the probe: each asserts the hostile request is refused and
the legitimate localhost/LAN request still answers.

## Rung 7 — build

The guard and media-type map are ordinary TypeScript in the host bundle. Static
containment uses `fs` at runtime, not a build step. Pinned DNS is a direct
`undici` import, resolved by the workspace lockfile. No asset or generated file
is added.

## Decision

1. Apply one pre-dispatch guard to `/api/*` for a loopback peer with a
   non-loopback `Host`, exempting `/api/host`; keep `isForeignOrigin` for the
   routes that need an Origin check even on a LAN peer.
2. Let the declared asset kind own the response MIME and refuse a kind/extension
   mismatch in validation and again at the route; add `nosniff` and a sandbox
   CSP to every theme asset.
3. Put Wallpaper Engine routes behind `isLoopbackRemote`; keep them editor-only.
4. For outbound sources, allow private addresses only when the first URL was
   private; classify every redirect hop and pin the checked address through
   `undici`.
5. Contain static and theme reads with `realpath`, bound large bodies with a
   one-at-a-time gate, and redact admin error bodies.

The same-origin test is the load-bearing piece: CORS does not defend a loopback
service, and the `Host` header is the one value a rebinding page cannot forge.
