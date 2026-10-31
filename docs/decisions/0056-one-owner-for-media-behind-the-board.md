# 0056 — media behind the board is one ground rule

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/renderer-core/src/theme/facet-record.ts`

## Problem

A document with media behind its board has no readable ground. Two packages
spell that one-field presence check: `renderer-core`'s colour-mode facet
answers `unclassified`, and the host's library listing omits the `ground`
string. A rename or a widening of "media behind the board" in one copy silently
leaves the other reading the token's paint, so a cell can show a ground the
facet refuses to classify.

## Rung 1 — internal owner

Searched: no CodeGraph index in this worktree; grep for `background?.media`
across `src/web`. Found exactly the two readers named in #159
(`renderer-core/src/theme/facet-record.ts` `groundOf`, host
`src/themes/store.ts` `groundOf`) plus `host/src/main.ts`, which reads the media
asset to serve a panel clip rather than to decide the ground. `facetRecordOf`
already derives the record from the envelope in `renderer-core`, and the host
already imports it; the paint resolution (`resolveStyleValue`,
`cssArtboardPaint`) already lives in `renderer-core`. Nothing else owns
"background layer paint".

## Rung 2 — installed dependencies

Searched: no dependency surface reads Yunari's envelope. `resolveStyleValue`
and `cssArtboardPaint` are already the renderer-core owners of reference
resolution and CSS paint form, so the new owner composes them rather than
adding a resolver.

## Rung 3 — native platform

Searched: no browser, Node or OS API describes a theme's background layer; the
rule is domain data. No platform primitive applies.

## Rung 4 — public solutions

Searched: no public package models Yunari's theme envelope, so no upstream
implementation covers this rule. Comparable schema libraries validate presence;
they do not decide that presence makes a derived colour unreadable. That
derivation is Yunari's.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Predicate in `renderer-core` used by both | The layer both import already owns the envelope and the paint resolver | Both readers still branch on the predicate | Rejected: leaves the absence rule written twice |
| `backgroundPaintOf` in `renderer-core`, returning paint or `undefined` | One function decides media absence and reference resolution; reader only parses or converts | None | Chosen |
| Predicate in the host | Host owns a renderer concept and renderer-core would import the host | Inverted dependency | Rejected |
| Duplicate copies kept | No new code | Drift risk is the issue | Rejected |

## Rung 6 — smallest probe

The existing suites already exercise both answers (`facet-record.test.ts` "never
guesses when there is media behind it"; host `store.test.ts` "carries each
theme's ground"). A probe is unnecessary: the behavior is established and the
change only moves the decision to one function.

## Decision

Export `backgroundPaintOf(envelope)` from
`renderer-core/src/theme/facet-record.ts`. It answers `undefined` when the
background layer declares media, otherwise the document-resolved paint. The
colour-mode facet reads it for lightness and converts nothing; the host's
listing converts it with `cssArtboardPaint`. Both tests assert the same
document answers `unclassified` and carries no ground, so a drift fails.
