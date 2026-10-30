# 0013 — Split the asset key bag by kind and bound the run style keys

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/renderer-core/src/theme/envelope-keys.ts`, `src/web/packages/renderer-core/src/theme/envelope-semantics.ts`, `src/web/packages/renderer-core/src/theme/fabric-envelope-validate.ts`

## Problem

The decider admitted one key bag for every asset kind, so an image could carry
`family`, `weight`, `style` and `format` while the published schema refused
them there. The run-style validator bounded `fontSize` alone, so a theme could
carry a zero leading or a non-numeric tracking value the editor refuses to
write. Both drift silently: the document opens in the editor and is refused by
the published contract, or it loads and renders differently from what the
inspector would allow.

## Rung 1 — internal owner

Searched the theme package for every reader of `knownKeysFor`,
`validateAssets`, `fontPresetFaces` and the run-style block. Found: the schema
already splits `$defs/nonFontAssetReference` from `$defs/fontAssetReference`,
and `envelope-keys-disagreement.test.ts` compares decider shapes to schema
shapes; the editor's `run-edits.ts` owns the write-side bounds — fontSize is
positive and whole, lineHeight is rounded to two decimals and must exceed zero,
letterSpacing is a signed number. `envelope-semantics.ts` already refused
`subset` on a non-font, which proved the per-kind split was the intended shape
rather than a new design. The role requirement (`requireTrioRoles`) is a
separate gate and is left as it is; see the deferred row.

## Rung 2 — installed dependencies

Searched the installed JSON Schema and TypeScript types under `schema/` and
`renderer-core/src/theme/document.ts`. Found: `FontAssetReference` carries
`family`, `weight`, `style`, `format` and `subset`; the non-font branch does
not. No dependency or code generator produces either registry, so the two must
be compared by the existing drift test rather than generated.

## Rung 3 — native platform

Searched JSON and number handling. Found: `JSON.parse` can produce any number,
including `NaN` only through programmatic construction, and no platform
validator inspects a document's intended per-kind shape. The bound therefore
belongs to the product validator.

## Rung 4 — public solutions

Searched the published schema, `DESIGN.md` §2 and the editor's own run-style
rows. Found: the schema is the published contract and already splits the two
asset shapes; the inspector's bounds are the authored rule. No external
validator supplies product bounds, and adding a JSON Schema validator would
re-derive what the decider already decides.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| One bag plus a special case per font key | Smallest edit now | Grows one refusal per key and keeps the drift invisible | Rejected |
| Per-kind bags in the decider | Matches the schema and the existing drift test | None material | Chosen |
| Bounds only in the editor | No change to the read path | A hand-edited or imported theme still loads with values the editor cannot produce | Rejected |

## Rung 6 — smallest probe

The existing disagreement test answers both registries for every shared bag;
adding the two asset shapes makes it compare each kind rather than their union.
The validator test builds an image carrying `family` and a run carrying a zero
leading and a string tracking value, which is the executable check behind the
new rules.

## Decision

Split `assetReference` into `nonFontAssetReference` and `fontAssetReference`,
choose the bag from the asset's own `kind`, and remove the one-key `subset`
special case. Bound `lineHeight` above zero and require `letterSpacing` to be a
finite number, matching the editor's refusal. The three role requirement stays
opt-in until a ruling says legacy roleless themes must be refused.
