# 0098 — The pickers read one catalogue built from the provider wire

- **Date:** 2026-10-24
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/providers/provider.ts`,
  `src/web/packages/host/src/providers/clock.ts`,
  `src/web/packages/host/src/providers/library.ts`,
  `src/web/packages/host/src/providers/lhm.ts`,
  `src/web/packages/editor/src/editor-session.ts`,
  `src/web/packages/editor/src/selection-inspector/view.ts`

## The problem

The editor's two reading pickers each imported `SEMANTIC_KEYS` directly, so a
key a provider reports was unofferable no matter what `/api/sensors` said. The
wire also dropped the fields a picker needs to group and label: family, unit
kind, value kind, display units and media kind. The shape of the problem is one
catalogue that a disconnected editor can still answer from, updated by a
request whose failure is not an author-facing error.

## Rung 1 — Yunari
Searched: `SEMANTIC_KEYS`, `describeSemanticKey`, `groupDescriptorsByFamily`,
`semanticKeysByFamily`, `SensorDescriptor`, `ProviderRegistry.describe`,
`/api/sensors`, `chartContentView`, `projectRuns`, `ControlOption.group`.
Found: the vocabulary already carries every field and a grouping helper; the
registry already spreads a whole descriptor, so only its type lacked the fields;
`ControlSelect` already renders grouped runs. The two pickers were the only
places still importing the table rather than being handed one. The three shipped
providers (`clock.ts`, `library.ts`, `lhm.ts`) each built their descriptor fields
separately, so the shared `descriptorFieldsOf` replaced the copy in each — all
three are claimed above.

## Rung 2 — dependencies
Searched: editor and host `package.json` workspaces for any catalogue/store
package.
Found: nothing that owns a sensor list. Adding one would be a new dependency for
a fetch and a merge of two arrays.

## Rung 3 — platform
Searched: `fetch`, same-origin serving of `/editor`, the `/api/sensors` route.
Found: the editor is served from the host origin, so `fetch("/api/sensors")` is
same-origin and needs no base URL, proxy or CORS. The platform leaves the merge
rule, the fallback and the failure policy to us.

## Rung 4 — ecosystem
Searched: React data-fetching libraries (TanStack Query, SWR) for a catalogue
that is a union with a static fallback; and the host's existing client idiom
(`theme-library-client.ts`, `favorites-client.ts`).
Found: the query libraries solve caching, retry, deduplication and invalidation
— none of which this needs, because there is one request per session and the
fallback is synchronous. The host's own clients are hand-written `fetch`
wrappers; matching them keeps one construction idiom.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Import `SEMANTIC_KEYS` in each picker | No — cannot show provider keys | 0 | Reintroduces the defect | Rejected |
| TanStack Query / SWR | Cache/retry features unused | New dependency | One more owner of the same bytes | Rejected |
| A module-level singleton | One fetch for the app | Testing cannot reset it between sessions | Stale across documents | Rejected |
| Factory injected through the session's options | Matches existing clients | Small options plumbing | None observed | Chosen |

## Rung 6 — probe
Not applicable: no timing- or hardware-sensitive behaviour. The failure path is
exercised by a rejecting fetcher and a non-2xx response in
`sensor-catalogue.test.ts`; both leave `SEMANTIC_KEYS` in place.

## Decision

`createSensorCatalogue(fetcher = fetch)` holds `SEMANTIC_KEYS` until a successful
refresh, then returns the built-ins followed by wire keys the table does not
already name (built-ins win a collision, because the vocabulary is the canonical
spelling). `editor-main` builds one per editor and hands it to `EditorSession`,
which passes a `descriptors()` getter to the chart manager and the selection
inspector — a getter rather than an array so a refresh that lands after mount is
visible on the next projection. Both pickers take the list as a parameter with
`SEMANTIC_KEYS` as the default, so existing unit tests construct them unchanged.
