# 0123 — the background colour belongs to the media it sits behind

- **Date:** 2026-11-07
- **Status:** accepted
- **Paths:**
  `src/web/packages/renderer-core/src/theme/document.ts`
  `src/web/packages/renderer-core/src/theme/envelope-keys.ts`
  `src/web/packages/renderer-core/src/theme/envelope-semantics.ts`
  `src/web/packages/renderer-core/src/theme/fabric-envelope.ts`
  `src/web/packages/renderer-core/src/theme/fabric-envelope-validate.ts`
  `src/web/packages/renderer-core/src/theme/facet-record.ts`
  `src/web/packages/renderer-core/src/scene/plan.ts`
  `src/web/packages/editor/src/background-media-memory.ts`
  `src/web/packages/editor/src/editor-document.ts`
  `src/web/packages/editor/src/selection-inspector/background-column.ts`
  `src/web/packages/editor/src/palette-manager/index.ts`
  `src/web/packages/editor/src/panes/tokens/paint-fields.tsx`
  `src/web/packages/editor/src/display-lens.ts`
  `src/web/packages/editor/src/viewport-manager/index.ts`
  `src/web/packages/editor/src/new-document-chooser.tsx`
  `src/web/packages/host/src/themes/theme-media.ts`
  `src/web/packages/mcp/src/tools/draft.ts`

## Problem

`background.color` is one theme-level value, so two background media cannot
carry two colours: switching the shown asset repaints the board with the last
colour instead of the one authored for that picture. The media's own fit
(`bounds`) was already per-asset working data in the sidecar; colour has no
equivalent. The shape is persisted, so the type, published schema, validator
and every reader must move together or a save and a display will disagree.

A blank theme has no media and still needs a board paint (the starter's page
colour), so the colour cannot simply be deleted from `background`.

## Rung 1 — internal owner

Searched with CodeGraph: `Background BackgroundMedia setBackground
setBackgroundAsset rememberBackgroundMedia planArtboard backgroundPaintOf`,
plus `background?.color` across `src/web`. Found one envelope writer
(`EditorDocument.setBackground`) and one per-asset memory
(`background-media-memory.ts`, sidecar decision 0106). Readers are
`planArtboard`, `backgroundPaintOf`, host `theme-media.ts`, the background
column, the palette-reassignment path and the token-usage count. Nothing owned
a single "the colour" value per media; the media memory already owns the rest
of the media's working fields.

## Rung 2 — installed dependencies

No dependency models Yunari's envelope. `exactOptionalPropertyTypes` and the
repo's own validator helpers are the only structures involved; no package adds
a rule this change could reuse.

## Rung 3 — native platform

JSON Schema draft 2020-12 can express `background.color` and
`backgroundMedia.color` but cannot compare the two properties across the parent
and child. The exclusivity rule therefore stays in the hand-maintained
validator, next to the unknown-key and range checks that already live there.

## Rung 4 — public solutions

Comparable theme/document formats either keep one palette-level background or
attach per-layer fills; neither offers a migration-free way to move a key while
preserving an old reader. The repo's own version policy (major read, old shape
refused, no converter) is the applicable prior art; it is reused rather than
re-designed.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Move colour to `backgroundMedia` and delete `background.color` | One owner | Blank themes lose their page paint | Rejected |
| Keep `background.color` and read it as a fallback for a media with no colour | Small diff | Two copies of one value can disagree; forbidden by the model | Rejected |
| Colour lives on the media when one is declared, on the background otherwise | One owner at a time; blank themes keep their paint | The writer must move the value across the two slots | Chosen |
| Per-asset colour only in the sidecar | No envelope change | Not persisted in the theme or its package | Rejected |

## Rung 6 — smallest probe

The existing suites already exercise both slots: `starter.test.ts` proves a
blank theme carries a page paint with no media, and `facet-record.test.ts` /
`theme-media.test.ts` read the paint behind a media. No new executable probe is
needed; the rule moves into one normalisation in `EditorDocument.setBackground`
and one validator check.

## Decision

`BackgroundMedia` gains `color?: StyleValue`. `Background.color` remains only
for a background with no media. The validator and the published schema refuse
a document that carries both, and the editor's one envelope writer moves the
value into the media when an asset is chosen and back to the background when it
is cleared. Readers select the slot through one helper,
`backgroundPaintValue(background)` in `document.ts`, never by falling back. The
schema version moves to `2.1.0`; the old media-plus-colour shape is refused with
a stated reason and no converter is written.

## Preview lens

The preview camera's opening lens is chosen by nearest aspect to the artboard
(`display-lens.ts`), and construction performs the fit itself. The new-theme
chooser drops its lens question; the artboard it creates already determines the
lens. Reused the catalogue and its parsed aspect rather than adding a second
ratio list.
