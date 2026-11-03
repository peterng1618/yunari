# 0104 — A thumbnail carries its mean luminance

- **Date:** 2026-11-03
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/themes/thumbnails.ts`,
  `src/web/packages/host/src/themes/store.ts`,
  `src/web/packages/host/src/themes/submission.ts`,
  `src/web/packages/host/src/themes/store-client.ts`,
  `src/web/packages/host/src/catalogue/submit.ts`,
  `src/web/packages/host/src/catalogue/build-index.ts`,
  `src/web/packages/host/src/main.ts`,
  `src/web/packages/store-worker/src/routes/me.ts`,
  `src/web/packages/store-worker/src/version/plan.ts`

## Problem

The library listing classified a theme by its picture's mean luminance, and
computed that mean by decoding every `thumbnail.png` on every `list()`. On a
112-theme library that measured 1.72–2.51 s against 48–49 ms without the
callback (issue #413's own probe), on the host's single thread, for a value that
changes only when the picture does. The same value is needed when a theme is
published: the Worker derives `facets_json` at finalize and cannot decode a PNG,
so a media-backed theme was filed `unclassified` even though the publisher holds
the picture.

## Rung 1 — internal owner

Searched: `createThumbnailStore`, `ThumbnailStore.read/has/write/remove`,
`thumbnailLuminance`, `ThemeStore.list`, `entryFor`,
`ThemeStoreOptions.thumbnailLuminance`, `submissionFiles`, `catalogue/submit`,
`StoreClient.finalize`, `finalizeVersion`, `facetRecordOf`,
`backgroundPaintOf`, `writeThemePackage`, `THUMBNAIL_FILE`.

Found: the thumbnail store is the one owner of the picture's file facts, and
`write` is the only path every picture takes (save capture, editor upload,
import, install, capture route). `ThemeStore.list` is the one listing path, and
`submissionFiles` is the only builder of the publish payload. `backgroundPaintOf`
already refuses a paint when media is behind the board, so the Worker's
envelope-only derivation cannot classify a media theme.

## Rung 2 — installed dependencies

Searched: `node:zlib` `inflateSync` and the store's `unfilter`, used by
`thumbnailLuminance`; `@yunari/renderer-core`'s `relativeLuminanceOf` and
`facetRecordOf`; the Worker runtime's available primitives.

Found: the decoder is already written and correct for the capture's shape, but
it is CPU work in the host process. The Worker has no `node:zlib`; a
`DecompressionStream` plus a handwritten unfilter loop would put a 16 Mpixel
decode on a finalize request and duplicate the reader.

## Rung 3 — native platform

Searched: Node `fs` atomic file replacement already used for the picture;
the PNG specification's ancillary chunk slots.

Found: nothing in the platform stores a derived value for a file. A PNG `tEXt`
chunk could hold it, but writing one rewrites the picture (CRC, length) and any
tool that re-encodes the image silently drops it. A file beside the picture is
the platform's own unit and is copied by the folder swap the store already does.

## Rung 4 — public solutions

Searched: PNG ancillary chunks (`tEXt`/`iTXt`), sidecar-file caches,
mtime-keyed in-memory caches, and Cloudflare Workers image decoding.

Found: ancillary chunks are ignorable by specification, so a cache in one is
allowed to disappear at any re-encode. An mtime-keyed map is a cache, not a
stored fact: it is empty after a restart and still costs one `stat` per theme.
Workers' image decoding is not part of the runtime, so the publisher is the only
side that can measure the picture without adding a decoder.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep decoding per listing | none — the measured cost | none | Rejected |
| In-memory map keyed by picture `(mtime, size)` | removes the decode after first read | lost on restart; one `stat` and a miss path per entry; still no value at publish | Rejected |
| Add `metadata.thumbnailLuminance` to `theme.json` | travels with the document | the document is written before the picture is uploaded, so the value changes `contentId` and the editor's `base` 409s; a `PUT /thumbnail` makes it stale without a save | Rejected |
| PNG `tEXt` chunk | travels with the picture | rewriting the bytes needs CRC work; re-encodes drop it | Rejected |
| Worker decodes the uploaded PNG | no publisher cooperation | no decoder in the runtime; up to 16 Mpixels on a request; duplicates the host reader | Rejected |
| Sidecar written by the thumbnail store, carried in the publish payload | the value is written with the picture and read by the listing; the publisher sends the same number | one tiny file per theme | Chosen |

## Rung 6 — smallest probe

`thumbnails.test.ts` writes a picture and asserts the value lands beside it,
then replaces the picture with undecodable bytes and asserts `luminance()`
still answers — which only the sidecar can do. A picture stored without a
sidecar is decoded once and the value kept. `store.test.ts` asserts a save
copies both members. `finalize.spec.ts` publishes a media-backed envelope with
`thumbnailLuminance: 0.9` and reads `light` from the stored `facets_json`; a
value of `1.4` is refused with 422 and writes no version. The listing cost
itself was measured in issue #413: 1.72–2.51 s vs 48–49 ms on 112 themes.

## Decision

`createThumbnailStore` computes the mean inside `write` and keeps it in
`thumbnail.json` beside `thumbnail.png`; `luminance(id)` reads it, and decodes
and keeps it only when the sidecar is absent or unusable. The theme store's save
copies both members. The listing's `thumbnailLuminance` seam now points at
`ThumbnailStore.luminance`, so a listing pays one small read per theme.

`submissionFiles` reads the same value and `StoreClient.finalize` sends it as
`thumbnailLuminance`; `finalizeVersion` validates it as a number in `[0, 1]` and
passes it to `facetRecordOf`, so a published media theme is classified by the
picture a viewer sees. Absent is sent as absent, never zero — a publisher that
cannot read the picture leaves the facet to the document rather than inventing
a colour.

The bundled catalogue index measures the picture its package carries with the
same `thumbnailLuminance` helper, so the online index and the local library
cannot disagree. `planVersion` no longer derives facets at all: a version
request has no picture, so it cannot answer the colour mode; `finalizeVersion`
is the one write that does.

Already-published versions keep the `facets_json` written before this change
until their next publish. The value is derived from a picture the Worker cannot
read, and inventing a second decoder there would defeat the single-owner rule.
