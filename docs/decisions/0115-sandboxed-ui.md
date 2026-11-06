# 0115 — sandboxed UI

- **Date:** 2026-11-06
- **Status:** accepted
- **Paths:** `src/web/packages/extension-api/src/frame.ts`
  `src/web/packages/extension-api/src/manifest.ts`
  `src/web/packages/extension-api/src/manifest-contributions.ts`
  `src/web/packages/extension-api/src/index.ts`
  `src/web/packages/host/src/server/extension-ui-routes.ts`
  `src/web/packages/host/src/server/extension-routes.ts`
  `src/web/packages/host/src/server.ts`
  `src/web/packages/host/src/extensions/settings.ts`
  `src/web/packages/host/src/extensions/service.ts`
  `src/web/packages/host/src/assets/routes.ts`
  `src/web/packages/renderer-core/src/assets/wire.ts`
  `src/web/packages/editor/src/plugin-frame/plugin-frame.tsx`
  `src/web/packages/editor/src/plugin-frame/use-plugin-frame.ts`
  `src/web/packages/editor/src/plugin-manager/plugin-manager.tsx`
  `src/web/packages/editor/src/plugin-manager/use-extensions.ts`
  `src/web/packages/editor/src/settings-mode/plugin-pages.tsx`
  `src/web/packages/editor/src/settings-mode/region.tsx`
  `src/web/packages/editor/src/asset-finder/plugin-body.tsx`
  `src/web/packages/editor/src/asset-finder/finder-body.tsx`
  `src/web/packages/editor/src/asset-finder/finder-model.ts`

## Problem

A plugin's UI and settings must render inside the editor without gaining the
host's origin, credentials, or another plugin's state. A wrong boundary fails
quietly: a frame with same-origin access reaches `localStorage` and the host API,
and a path resolution bug reads a file outside the install tree before any
validator sees it.

## Rung 1 — internal owner

Searched: `extension-api` manifest, capability gate, consent and host-API
tables; `host/src/extensions/` service, installer, consent store, provider
order, declarative and code asset adapters; `host/src/server/extension-routes.ts`
and the asset routes; the editor's Settings `region.tsx`, `page.tsx`,
`section-group.tsx`, `nav.ts` and the asset finder's body/model/client.

Found: the manifest already admits `settingsPages` and `ui` and the execution
profile ladder already requires `sandboxed-ui` for a `ui` entry and for an
unknown asset body. Consent fingerprints contribution identities. What does not
exist is a frame protocol, a static route for a plugin's own files, a settings
store validated against declared fields, or an editor surface that hosts the
frame. The editor owns one Settings seam (`SETTINGS_PAGES` plus `SettingsRegion`)
and one finder body seam (`FinderBody`); both are extended rather than copied.

## Rung 2 — installed dependencies

Searched: React 19 (`renderHook` support in `@testing-library/react`), jsdom 30
iframe behaviour, the existing `createJsonFile` and `createSecretStore` host
owners, and the editor's existing client/error-reader helpers.

Found: React 19 and the testing library provide hooks and DOM rendering for the
frame host. jsdom models `contentWindow` and `postMessage` scheduling but not
the browser's sandboxed opaque origin, so the tests prove protocol handling, not
the sandbox itself. No new runtime dependency is needed: the host already owns
atomic JSON files, encrypted scoped secrets, loopback/origin guards, MIME-safe
static responses and streaming. The frame host uses the browser's own
`postMessage`.

## Rung 3 — native platform

Searched: HTML `iframe` `sandbox`, `Window.postMessage`, CSP `frame-ancestors`,
and Node's `fs/promises` `lstat`/`realpath`/`createReadStream`.

Found: `sandbox="allow-scripts"` without `allow-same-origin` gives the frame an
opaque origin: no host storage, cookies, DOM access or credentialed fetches.
`postMessage` is the only channel, and `event.source` plus a per-mount nonce
identifies the peer without trusting the origin string (an opaque frame reports
`"null"`). CSP cannot stop a same-origin document from being framed, so
`frame-ancestors 'self'` is set by the static route and the editor embeds the
frame. On the host, `lstat` refuses a symlink and `realpath` refuses an
intermediate directory that escapes the install tree; `createReadStream` reads
only after both checks.

## Rung 4 — public solutions

Searched: MDN's `iframe sandbox` and `postMessage` references, the HTML
standard's sandboxed origin browsing context, Electron's `webPreferences`
sandbox guidance, and Orca's isolated plugin panel frame as the comparable
implementation.

Found: the platform sandbox plus a nonce-bound message protocol is the standard
shape; Electron's answer (a separate process and a preload bridge) buys process
isolation this dashboard does not need for trusted, locally installed packages.
Orca's panel frame confirms the same attributes and a request/response envelope.
A library (for example a postMessage RPC package) would still leave the
capability table, gesture rule and host-side revalidation to this product, so it
adds a dependency without removing the security work.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Native `iframe sandbox` + nonce `postMessage` | Matches the host's HTTP origin and React surface | Protocol, method table, gesture rule, frame tests | Reuse |
| Electron/worker process per UI | Stronger isolation | New process lifecycle, packaging, IPC surface | Rejected: cost does not fit a local UI panel |
| Third-party postMessage RPC | Envelope only | Capability/consent checks, gesture token, CSP route | Rejected: leaves the security work in place |
| `srcdoc` document | No static route | Escaping, asset URLs, CSP per document | Rejected: a URL route serves the install tree directly |

## Rung 6 — smallest probe

A disposable jsdom probe (an iframe with `sandbox="allow-scripts"` reading
`window.localStorage`) cannot reproduce opaque origins, so it proves nothing
about the sandbox. The executable checks that do decide the design are the
protocol tests (wrong source, wrong nonce, reused gesture token, throwing frame)
and the route tests (traversal, encoded separator, symlink escape). The sandbox
attribute itself is asserted from the rendered markup; browser-level proof stays
with the existing Playwright display suite.

## Decision

Use the native sandbox: `<iframe sandbox="allow-scripts">`, one nonce-protected
`postMessage` protocol, a closed frame method table checked against the plugin's
granted capabilities, a one-use gesture token minted only by a host control, and
plugin UI files served by the host from the install directory under a
`default-src 'none'` CSP. Plugin settings are either a closed declarative field
set validated by the host or a sandboxed page. An unknown asset body renders the
plugin frame only when the source's plugin holds `ui:frame`; otherwise the
finder states the refusal instead of drawing a grid.
