# 0109 — Authoring invariants live in the document owner, not in each surface

- **Date:** 2026-11-05
- **Status:** accepted
- **Paths:** `src/web/packages/renderer-core/src/theme/document.ts`,
  `src/web/packages/renderer-core/src/theme/envelope-semantics.ts`,
  `src/web/packages/editor/src/editor-session.ts`

## Problem

The editor's controls refused shapes the MCP tools and the authoring kit
accepted: empty metadata keys, over-long names, malformed tags, a chart family
with more readings than it draws, a background edit that dropped the authored
media geometry, and a pasted asset that lost its credit. Each surface spelling
its own rule means a saved document can hold a shape the panel could never
author, and the disagreement surfaces only at save or publish.

## Rung 1 — internal owner
Found: `renderer-core/src/theme/document.ts` owns `Binding`, `BackgroundMedia`,
`ThemeMetadata`, `TAG_PATTERN`, `MAX_TAGS` and the chart family list.
`fabric-envelope-validate.ts` restates the metadata rules. The editor's metadata
panel and tags field each had a local copy of the compaction rule, and
`chart-manager/panel.ts` held the only family cap.

## Rung 2 — installed dependencies
Found: no installed validation library owns these shapes; the validator is
hand-written over the envelope.

## Rung 3 — native platform
Found: `TextEncoder` provides the UTF-8 byte count the store's name bound is
stated in; nothing else in the platform decides these rules.

## Rung 4 — public solutions
Searched: JSON Schema and zod remain candidate validators for a document
format of this size, but the codebase already validates the envelope at its
trust boundary with a purpose-built reader that reports paths and codes.

## Rung 5 — integration comparison
| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Repeat each rule per surface | Reaches every surface | Diverges on the next change | Reject |
| Shared functions in `document.ts` | One rule, every consumer | Editor and MCP must call them | Chosen |
| Move validation into the envelope validator only | Rejects at save | The panel and tools still author the shape | Reject |

## Rung 6 — smallest probe
Not needed: the divergence is reproducible by comparing the editor's control
with the MCP handler, and the shared functions are pure.

## Decision
`document.ts` exports the rules the surfaces share: `normalizeThemeMetadata`,
`themeTagsRefusal`, `themeMetadataRefusal`, `MAX_METADATA_NAME_BYTES`,
`MAX_CHART_BINDINGS`, `isChartFamily` and `chartBindingCountRefusal`. The editor
metadata panel, the MCP metadata tool and the theme-kit chart mutations call
them. The clipboard's credit port is wired to the document's existing
`creditForAsset`/`addCredit` owner so a paste records the same attribution as
an import.
