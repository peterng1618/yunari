# 0057 — the reserved `none` is owned by the palette token module

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/renderer-core/src/theme/palette-tokens.ts`
- **Paths:** `src/web/packages/editor/src/card-token-mapping.ts`
- **Paths:** `src/web/packages/editor/src/editor-shell/bridge.ts`
- **Paths:** `src/web/packages/editor/src/new-object-defaults.ts`
- **Paths:** `src/web/packages/editor/src/palette-manager/token-list.ts`
- **Paths:** `src/web/packages/editor/src/panes/tokens/paint-list.tsx`
- **Paths:** `src/web/packages/editor/src/selection-inspector/panel.ts`
- **Paths:** `src/web/packages/editor/src/selection-inspector/runs.tsx`

## Problem

"A palette's tokens, minus the reserved `none`" is spelled as
`id !== "none"` at six reader sites in two packages. The exclusion is a
domain rule: `none` is the transparent reassignment target with no paint kind
of its own, so an offered row, a run colour, a card fill or a new object's
surface must not select it. A seventh site added by Task 12.4c put a bare-id
enumeration in an editor module instead of the file that already owns the
option enumeration, so the bridge's count and `PaintList`'s rows could drift
from every picker. A wrong integration fails quietly: a control opens a field
set that refuses every edit, or a card is filled transparent and cannot be
selected.

## Rung 1 — internal owner

Searched: no CodeGraph index in this worktree (`.codegraph/` holds only its
`.gitignore`); grep for `!== "none"` and `paletteTokenIds` across `src/web`.
Found six predicate sites (`palette-manager/token-list.ts`,
`card-token-mapping.ts`, `new-object-defaults.ts` twice,
`selection-inspector/runs.tsx`, `selection-inspector/panel.ts`) and the owner
`renderer-core/src/theme/palette-tokens.ts` (`paletteTokenOptions`, ruled
vg-104). `paletteTokenUsage` iterates every id including `none` because it
accounts for deletion, and `paint-list.tsx`'s delete chooser filters on the
selected id; both ask different questions and stay. `fabric-envelope-validate.ts`
already treats the reserved id specially, but it validates documents rather
than offering tokens.

## Rung 2 — installed dependencies

Searched: Fabric, ECharts and the workspace packages. None models Yunari's
palette vocabulary or a reserved transparent token. Fabric's `FabricObject`
takes a paint value, not an authored token id; ECharts takes resolved colours.
No installed dependency donates this rule.

## Rung 3 — native platform

Searched: `Object.keys`, `Object.entries`, `Array.prototype.filter` in Node and
the browser. The platform provides enumeration and filtering; it cannot know
which id is reserved, so no platform primitive owns membership.

## Rung 4 — public solutions

Searched: no public package models this theme envelope or reserves a token id
for transparency. Schema libraries validate that an id exists; design-token
tooling (W3C DTCG, Style Dictionary) enumerates groups and does not exclude a
product-reserved member for the consumer's control type. The existing vg-104
ruling already chose one enumeration function for this repo; the remaining
question is where membership lives, which is Yunari's.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Export the predicate and both shapes from `palette-tokens.ts` | The owner rules the list; renderer-core has no DOM/React; both packages already import from it | Move the bare-id list into the owner and convert six callers | Chosen |
| Keep the exclusion caller-supplied on `paletteTokenOptions` | Preserves the artboard's "every token" default | Every caller still spells the rule; the new module stays a second home | Rejected |
| Default `paletteTokenOptions` to hide `none` | One call shape | Changes the artboard, which deliberately offers every token (vg-104) | Rejected |
| A new package or dependency | Isolated | Adds a mechanism for one string comparison | Rejected |

## Rung 6 — smallest probe

The behavior is already established by the existing suites: bridge counts the
palette without `none`, `PaintList` skips it, the inspector and run editor hide
it, and the card library resolves onto a declared token rather than the starter's
transparent one. The change only moves the decision to one file, so the runnable
check is the owner's own test plus those consumer suites.

## Decision

`renderer-core/src/theme/palette-tokens.ts` exports the reserved-token
predicate `isOfferedPaletteToken` and the bare-id list `paletteTokenIds`
(`paletteTokenOptions` keeps its caller-supplied `keep`, because the artboard
and the inspector genuinely differ in which tokens they offer). Every former
spelling calls the predicate; `palette-manager/token-list.ts` is deleted and
its two readers import `paletteTokenIds` from the owner. The `solidOnly`
filter in `panel.ts` remains the caller's extra question (paint kind), not a
second membership rule.
