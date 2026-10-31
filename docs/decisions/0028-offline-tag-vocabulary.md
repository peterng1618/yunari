# 0028 — The offline tag vocabulary is the seven seed words

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/theme-tag-seed.ts`, `src/web/packages/editor/src/panes/document/metadata-fields.tsx`, `src/web/packages/editor/src/store-mode/local-source.ts`, `src/web/packages/editor/src/panes/document/tags-field.dom.test.tsx`

## Problem

Before the editor has seen the catalogue, an author has no tags to pick from and
the first proposals have nothing to be measured against (#187). The mechanism —
the catalogue's own content, fetched online — was settled on 2026-10-17; what
the offline fallback should say was not.

## Rung 1 — internal owner

Searched: `panes/document/metadata-fields.tsx`, `panes/document/tags-field.tsx`,
`store-mode/local-source.ts`, `store-mode/*`, `theme-tag-seed.ts` and the tags
tests.

Found: `THEME_TAG_SEED` is the one offline vocabulary. `MetadataFields` passes
it to `TagsField`, and `local-source.ts` unions it into the settled set so a
locally authored tag survives a round trip before any catalogue is reachable.
No validator reads the list and `TAG_PATTERN` and `MAX_TAGS` still bound input.

## Rung 2 — installed dependencies

Searched: the tag field's combobox primitive.

Found: it takes any `vocabulary: readonly string[]`; a seed list is the whole
integration. No dependency or catalogue package is involved offline.

## Rung 3 — native platform

Checked: the browser's datalist and combobox behaviour.

Found: nothing native supplies a product vocabulary; this is content.

## Rung 4 — public solutions

Searched: the owner's examples recorded in the spec — `futuristic`, `retro`,
`modern`, `elegant`, `classic`, `nature`, `cityscape` — and the options put to
the owner on 2026-10-31 (ship a starter vocabulary; ship none; derive it from
the catalogue alone).

Found: the owner chose to ship a starter vocabulary, and the seven spec examples
are that vocabulary.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| The seven seed words as the offline fallback | already wired, no validator to change | none | chosen |
| No offline vocabulary | leaves an offline author with nothing | a second empty-state design | rejected |
| Catalogue-only vocabulary | already the online mechanism | no offline answer at all | rejected |

## Rung 6 — smallest probe

`tags-field.dom.test.tsx` asserts the seed has seven entries and every entry
matches `TAG_PATTERN`; `local-source.ts` keeps a seed tag through settle.

## Decision

Ship the seven words as `THEME_TAG_SEED`: `futuristic`, `retro`, `modern`,
`elegant`, `classic`, `nature`, `cityscape`. They are a fallback, not an enum:
a reachable catalogue replaces them, a tag outside the list stays writable, and
no schema or validator gains a closed set. Revising the seed is a content change
to this one module, measured against the proposals the first authors make.
