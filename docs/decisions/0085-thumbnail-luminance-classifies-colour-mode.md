# 0085 — The stored thumbnail's mean luminance classifies a theme's colour mode

- **Date:** 2026-11-02
- **Status:** accepted
- **Paths:**
  `src/web/packages/renderer-core/src/theme/facet-record.ts`
  `src/web/packages/renderer-core/src/theme/facet-record.test.ts`

## Problem

A theme's colour mode is derived from its background paint. Once a picture or
video sits behind the board, that paint is not what a viewer sees, so the
gallery's light/dark filter can file a bright video theme under dark, or leave it
unclassified. The library already stores `thumbnail.png` for every captured
theme; its mean relative luminance is a direct reading of what the theme shows.

## Rung 1 — internal owner

Searched: `facetRecordOf`, `colourModeOf`, `backgroundPaintOf`,
`lightnessOf`, `createThumbnailStore`, `entryFor`, `ThemeStoreEntry`.

Found: `renderer-core/theme/facet-record.ts` owns every derived facet,
including the colour-mode thresholds. `backgroundPaintOf` owns the rule that
media behind the board yields no paint, and `facetRecordOf` already reads that
absence as `unclassified`. `host/src/themes/thumbnails.ts` owns reading and
validating `thumbnail.png`, including `pngDimensions` and the PNG signature
check. `entryFor` in `host/src/themes/store.ts` is the single place a listing
entry and the record are built.

## Rung 2 — installed dependencies

Searched: `node:zlib` (`inflateSync`), the existing `pngDimensions` reader, and
the host's thumbnail bounds.

Found: `node:zlib` is stdlib and already the only decoder the host needs.
`pngDimensions` already parses the IHDR and the project already bounds edge and
pixel counts for stored thumbnails. No image library is installed for the host,
and adding one would duplicate bounds the project already owns.

## Rung 3 — native platform

Searched: Node's `zlib` documentation for `inflateSync`, the PNG specification's
filter types, and WCAG 2's relative-luminance formula.

Found: PNG scanlines are filtered per row with five defined filters; the host's
own capture is 8-bit, non-interlaced and opaque. `inflateSync` returns the
deflated IDAT payload whole, so one pass can reconstruct rows and average
luminance. The formula is the one `colourModeOf` already applies to paint.

## Rung 4 — public solutions

Searched: `pngjs` (Node PNG decoder) and the browser `createImageBitmap` /
`OffscreenCanvas` route.

Found: `pngjs` decodes every PNG shape this case never meets and adds a runtime
dependency plus notices. `createImageBitmap` is browser-only; the listing is
built in the host process. Neither fits better than the existing header reader
plus `zlib` for the one shape the capture writes.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Decode `thumbnail.png` with `zlib` + the existing header reader | Host-owned, no dependency, same bounds | Support only 8-bit non-interlaced colour types 0/2/4/6 | Use |
| Read the paint even when media is present | No new code | Reports a surface the viewer never sees; the reported bug | Reject |
| Add `pngjs` | Decodes every PNG | Dependency, notices, more code than the supported shape | Reject |
| Render the theme in the host to sample it | Exact | A renderer in the host, duplication of the player | Reject for this slice |

## Rung 6 — smallest probe

`thumbnails.test.ts` builds PNGs with `deflateSync` and proves black/white
means, Sub/Up/Paeth reconstruction and refusal of palette or unknown-filter
bytes. `facet-record.test.ts` proves a given mean overrides a media-backed
paint. `store.test.ts` proves the listing and the read use the option, and that
a failing reader falls back to the paint's honest absence.

## Decision

`facetRecordOf` takes an optional mean luminance and classifies it on the same
`L*` bounds as the paint. `createThemeStore` gains a `thumbnailLuminance`
callback; `main.ts` supplies one that reads the stored picture through the
existing `createThumbnailStore` and decodes it with `node:zlib`. A missing or
undecodable picture keeps today's paint fallback. The decoder is deliberately
narrow: 8-bit, non-interlaced, colour types 0/2/4/6, alpha ignored — the shape
the host's own capture writes.
