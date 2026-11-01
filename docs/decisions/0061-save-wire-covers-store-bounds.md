# 0061 — The save route's wire bound covers what the store persists

- **Date:** 2026-11-01
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/server.ts`, `src/web/packages/host/src/themes/store.ts`

## Problem

The theme save route (`PUT /api/themes/:id`) buffers one base64 JSON body under
`MAX_THEME_UPLOAD_BYTES` and then asks the store to write decoded assets. The
store accepts a 90 MiB asset total and an 80 MiB single asset, but 80 MiB of
asset is 111,848,108 bytes on the base64 wire, and the route's 96 MiB cap held
only ~72 MiB of decoded asset. A video the importer accepts at `MAX_ASSET_BYTES`
therefore saved with a 413 the writer never saw. A wrong bound here fails
quietly: the importer's success and the save's refusal disagree.

## Rung 1 — internal owner

Searched: `MAX_THEME_UPLOAD_BYTES`, `MAX_ASSET_BYTES`,
`MAX_TRASH_UPLOAD_BYTES`, `readBody`, `decodeThemeSave` and the theme routes
with grep and Read. `.codegraph/` contains only `.gitignore`, so this worktree is
not indexed.

Found: `themes/store.ts` owns `MAX_ASSET_BYTES = 80 * 1024 * 1024`;
`MAX_TOTAL_ASSET_BYTES` (90 MiB), `MAX_THEME_FILE_BYTES` (32 MiB) and
`MAX_CREDITS_FILE_BYTES` (1 MiB) are its private decoded bounds. The trash
route already needed the same wire arithmetic: `MAX_TRASH_UPLOAD_BYTES` is
`4 * ceil(MAX_TOTAL_ASSET_BYTES / 3) + 1 MiB`. `server.ts` restated 96 MiB for
the save and import bodies (`MAX_THEME_UPLOAD_BYTES`), and its save PUT reads
the body with it. The import route, and the two normalized-video checks, already
use the store's asset bound. `assets/routes.ts` reads the trash body under the
store's wire constant. Unsolved: the save body was the one transport
re-spelling a decoded bound.

## Rung 2 — installed dependencies

Searched: `packages/theme-package/src/index.ts` and its `fflate` boundary, the
host's `node:http` use, and `package.json` dependencies.

Found: `@yunari/theme-package` bounds one archive entry at `MAX_ENTRY_BYTES = 80
MiB` and expanded bytes at 180 MiB, and returns the reader's own refusal. `fflate` filters on `originalSize` but imposes no HTTP body cap.
No installed dependency donates a request-body bound; `node:http` is the
transport and leaves sizing to the application.

## Rung 3 — native platform

Searched: current Node HTTP server API reference (`nodejs.org/api/http.html`).

Found: `http.Server` has no built-in request body limit and no
`maxRequestBodySize`; `requestTimeout`, `headersTimeout` and
`maxHeadersCount` bound time and headers, not body bytes. The body is a stream
the application must count. `Buffer.toString("base64")` implements the 4/3
expansion the route must budget for. The platform leaves the bound to us.

## Rung 4 — public solutions

Searched: RFC 4648 §4 (`rfc-editor.org/rfc/rfc4648#section-4`) and Fastify's
server reference `bodyLimit` (`fastify.dev/docs/latest/Reference/Server/`).
A direct `npmjs.com/package/body-parser` fetch was refused (HTTP 403).

Found: RFC 4648 §4 fixes the exact encoded length at `4 * ceil(n / 3)`,
including padding. Fastify's `bodyLimit` defaults to 1 MiB, measures payload
bytes, and answers `FST_ERR_CTP_BODY_TOO_LARGE` when exceeded. Both cap the
wire, so a base64 JSON upload must derive its cap from decoded bounds plus
encoding and envelope overhead; neither supplies that derivation.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep 96 MiB and tighten the importer | One bound, but refuses files the product accepts | Product ruling rejects | Reject |
| Per-asset save limit | The body is one JSON object; the transport cannot reject an asset before decoding | Would need a streaming wire format | Reject |
| Cover only `MAX_ASSET_BYTES` (≈107 MiB) | Fits one 80 MiB video | A store-valid 90 MiB asset total plus a 32 MiB document still 413s | Reject |
| Derive the save wire from the store's decoded bounds | Covers every theme the writer can persist; one owner | None found | **Reuse** |
| New shared bounds package | Same value, new cross-package mechanism | No second consumer outside the host | Reject |

## Rung 6 — smallest probe

`node -e` with the constants: 80 MiB encodes to 111,848,108 bytes; the old
96 MiB body held only 75,497,472 decoded bytes (72 MiB), so the failure is real.
The store's bounds give `4 * ceil(90 MiB / 3) + 1 MiB = 126,877,696` for the
assets, and adding the 32 MiB document and 1 MiB credits caps gives
161,480,704 bytes.

## Decision

Move the derived whole-theme wire bound to its owner, `themes/store.ts`:
`MAX_THEME_WIRE_BYTES = MAX_TRASH_UPLOAD_BYTES + MAX_THEME_FILE_BYTES +
MAX_CREDITS_FILE_BYTES`. `server.ts` imports it for `MAX_THEME_UPLOAD_BYTES`
instead of restating 96 MiB. The route still rejects on the decoded side for
per-asset and total rules; the wire bound now covers every save the store can
persist. The trash route keeps its asset-only constant because it carries no
document.
