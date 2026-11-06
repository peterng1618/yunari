# 0113 — Declarative custom sources and paging

- **Date:** 2026-11-06
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/settings/sources.ts`, `src/web/packages/host/src/providers/custom/provider.ts`, `src/web/packages/host/src/providers/custom/fetch-source.ts`, `src/web/packages/host/src/main.ts`, `src/web/packages/host/src/providers/custom/fetch-source.fixture.ts`

## Problem

Plugin manifests may declare `customSources` descriptors, and a custom source
may now span several pages behind one query parameter. The rows enter the same
provider as `sources.json`, and every page has to pass the same SSRF, redirect,
credential, byte-cap and in-flight policy. A second validator, a second HTTP
client or a page fetch outside the guard would fail quietly: a plugin row could
bypass the store's rules, or one page could skip address checking while the
first page looked safe.

## Rung 1 — internal owner

Searched: `codegraph explore "fetchSource CustomSourceProvider reload asSource normalizeSources"`.

Found: `settings/sources.ts` owns validation (`asSource`, `normalizeSources`) and the atomic store. `providers/custom/fetch-source.ts` owns the whole request policy (`run`, `resolveDestination`, `checkDestination`, `buildRequest`, `readBody`, `withSourceLock`, the four-slot in-flight limit). `providers/custom/provider.ts` owns runtimes and `reload()`. `providers/custom/pointer.ts` already resolves RFC 6901 pointers. The unsolved parts were paging and merging a second row source; the file/loop plumbing already exists.

## Rung 2 — installed dependencies

Searched: `packages/host/package.json`, `providers/custom/pinned-fetch.ts`, `pointer.ts` and its tests.

Found: `undici` 7.30.1 is installed and already used for address-pinned `fetch`; no paging or JSON-pointer package is installed. The repo's `resolvePointer` covers the pointer grammar and owns the miss behaviour field readings already depend on. Nothing donated paging semantics, and adding a package would duplicate the existing pointer owner.

## Rung 3 — native platform

Searched: Node 22 `URLSearchParams`, `AbortSignal.timeout`, `fetch`/`Response`, `URL`.

Found: `URL.searchParams.set` appends a page parameter to the same URL the policy already inspects, `AbortSignal.timeout` gives each request its own deadline, and the existing `readBody` already caps bytes during arrival. The platform leaves ordering, partial-failure and merge semantics to the caller.

## Rung 4 — public solutions

Searched: RFC 6901 (JSON Pointer), RFC 8288 (Link header), common `page`/`pageSize` API conventions, and the package registry for JSON-pointer and pagination helpers.

Found: Link-header pagination needs the server to advertise next links, which user-authored sources do not guarantee; a configured query parameter and a `maxPages` cap is the convention that works with arbitrary JSON APIs. JSON Pointer is already implemented locally with own-property-only traversal. No candidate handled the SSRF/pinning integration, so reuse would stop at parsing and leave the failing part unsolved.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Add a pagination/JSON-pointer package | Parses pointers only | Still adapts to `resolvePointer`, the pinned fetch and per-page guards | Reject |
| Fetch pages through the existing `run` per page | Reuses every guard, redirect and cap | Ordering and merge only | **Choose** |
| New parallel fetch path for paged sources | None | Re-implements SSRF, pinning, credential redirect and the global limit | Reject |

## Rung 6 — smallest probe

The existing `fetch-source` suites already exercise the guard through an injected `fetch` seam (`serve`), so the paging cases run as ordinary fixtures: two pages, a failing second page and a non-array `itemsPath` body. Each is a unit probe of the same `run` call rather than a new integration surface. No throwaway server was needed.

## Decision

Extend the existing owners. `readCustomSource` is the single validator and `asSource` delegates to it; the provider merges user rows first and skips duplicate plugin ids; `fetchSource` calls the existing `run` once per page, in order, and merges only after every page succeeds. `itemsPath` uses the existing `resolvePointer`; without it, page bodies must be arrays. A failing page fails the whole fetch, so no partial body becomes a reading.
