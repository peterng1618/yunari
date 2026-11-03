# 0094 — A Google font cut is advertised only when its file matches its keys

- **Date:** 2026-11-03
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/assets/fonts/google.ts`

## Problem

The Google source builds each cut's id — subset, weight and style — from the
Fontsource registry keys, then pins a CDN URL from those keys. The published
`variants` entry's own `url.woff2` is checked for existence but not compared
against the key path. If upstream ever lists a key whose file has a different
stem, the row advertises metadata the fetched bytes do not have: the validator
compares a type token against the row, and the player registers the face with
the row's `unicode-range`, so the mismatch is silent — the row saves, the text
falls back.

## Rung 1 — internal owner

Searched: CodeGraph for `cutsOf`, `cutIdOf`, `urlOf`, `FontCut`, and every
`bytesOf` caller.

Found: `cutsOf` in `packages/host/src/assets/fonts/google.ts` is the only place
a Google row becomes cuts; `bytesOf` rebuilds the URL from the id with `urlOf`,
so the id's three segments *are* the fetch address. The curated source has the
same shape, but its faces are generated together with their pinned URLs and a
scan of all 2,140 entries found no disagreement. One guard at the Google source
covers the rows that can drift; the curated catalogue is data, not a decision.

## Rung 2 — installed dependencies

Searched: Fontsource's registry shape (`variants[weight][style][subset].url.woff2`)
and the host's existing `SourceBytes` contract; the editor's `faceOfCut`, which
takes family/weight/style/subset from the cut.

Found: nothing else consumes the published URL — `bytesOf` uses only the id.
The dependency donates the fact needed for the check (`url.woff2`), so no new
package or parser is required.

## Rung 3 — native platform

Searched: `URL` and string path handling in Node and the browser.

Found: the platform can read the final path segment; it cannot decide whether a
cut is truthful. That rule belongs to the source.

## Rung 4 — public solutions

Searched: comparable font registries (Google Fonts CSS API, Fontsource docs,
jsDelivr versioned URLs) for how a cut's identity and file path relate.

Found: both Google's CSS API and Fontsource name the served file
`<subset>-<weight>-<style>.woff2`; the key path is the published contract. A row
whose published path disagrees is upstream drift and has no trustworthy
metadata, so skipping it is the only non-fabricating answer.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Skip a variant whose published URL stem differs from its keys | Every exposed cut is the file it names | A drifted cut disappears from the picker | Chosen |
| Take subset/weight/style from the URL stem | Keeps the cut | Re-derives id and family metadata from an unvalidated string, and the URL can be `@latest` | Rejected |
| Keep the row and fetch the published URL as-is | Bytes match the URL | The id is pinned to a different path, so `bytesOf` would still fetch the key path; the mismatch remains | Rejected |
| Trust the keys and drop the URL fields | No fetch address in a cut | Loses the only upstream check that the pair exists | Rejected |

## Rung 6 — smallest probe

The live registry for IBM Plex Mono, IBM Plex Sans, Lora, Inter and Barlow
Condensed was scanned: every published `variants` key matched its URL stem, and
the pinned files differ in weight (100 vs 400) when fetched. The guard is
therefore not driven by a current mismatch; it pins the invariant the reported
symptom depends on. The new unit test feeds a 700 `latin` key pointing at a
`latin-400` file and asserts that cut is not advertised.

## Decision

`cutsOf` skips a pairing whose published URL's final path segment is not
`<subset>-<weight>-normal.woff2`, using the same subset/weight/style it builds
the id from. No other behaviour changes.
