# 0030 — Background modes: basic, and advanced composition

- **Date:** 2026-11-05
- **Status:** accepted
- **Paths:**
  `src/web/packages/renderer-core/src/theme/document.ts`
  `src/web/packages/renderer-core/src/theme/envelope-keys.ts`
  `src/web/packages/renderer-core/src/theme/envelope-semantics.ts`
  `schema/theme-document.schema.json`
  `src/web/packages/editor/src/selection-inspector/background-column.ts`
  `src/web/packages/mcp/src/tools/draft.ts`

## Problem

The composition added in 0029 is a new background model, and every theme that
exists today predates it. A theme must say which model it is authored under, or
an old author learns a vocabulary they did not ask for and every new theme
carries an opt-in the product never offered. The mode is a theme-format fact,
so a wrong choice fails quietly: an advanced theme read by a basic tool keeps
drawing a hard-edged full cover, and a basic theme that carries composition keys
has no reader that will honour them.

## Rung 1 — internal owner

Searched: CodeGraph and source for `Background`, `BACKGROUND_MEDIA_BOUNDS`,
`envelopeKeysFor("background")`, `validateBackground`.

Found: `Background` in `document.ts` owns `color`, `fill`, `media`; the key bag
in `envelope-keys.ts` and the published schema are held equal by
`envelope-keys-disagreement.test.ts`; `validateBackground` already refuses
unknown keys, so the mode is a bag entry plus two cross-field refusals. No
second document format exists, so no second owner is needed.

## Rung 2 — installed dependencies

Searched: zod (MCP tool input) and the JSON-schema consumer in the schema sync
test.

Found: the schema already carries `$defs/background`; a conditional
(`if`/`then`) expresses "composition keys only under `advanced`" without a new
definition. zod-v4 expresses the same rule as a refinement on the tool input;
the tool refuses before the draft holds an invalid background.

## Rung 3 — native platform

Searched: JSON Schema draft support and the host's validator entry points.

Found: the document is refused by `fabric-envelope-validate`, which the host
and the editor both call; `mode` needs nothing beyond the language's own
`enum` and `if`/`then`.

## Rung 4 — public solutions

Searched: how versioned theme/graphics formats gate additive features (W3C
JSON-LD `@version` folding, Figma plugin-data versioning, VS Code theme
`semanticHighlighting`).

Found: each makes the feature flag a stored declaration and refuses or ignores
the feature without it; none infers the mode from the presence of keys, because
presence cannot tell a stray key from an authored one.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Infer mode from keys being present | no | a stray key silently changes the model | rejected |
| New schema major version | heavy | every reader and package version moves for one flag | rejected |
| Stored `mode` key, absent = basic | fits | validator, schema, editor and MCP each refuse the wrong combination | chosen |

## Rung 6 — smallest probe

The existing validator harness accepts a background with `fill` and reports no
issue; adding `mode` and probing a basic document carrying `fill` is the test
that fails first, so no separate probe was needed.

## Rung 7 — decision

`Background.mode` is `"basic" | "advanced"` and is written only when advanced:
absence is basic, which is the model every existing theme holds and the one a
new theme starts in. In basic, `background.fill` and `background.media.composition`
are refused by the validator and the schema rather than ignored, so a document
can never claim one model and carry another. An advanced composition anchors the
picture to one of five points, sizes an edge band and fades the seam into the
fill; `resolveBackgroundComposition` turns that into the one region and mask
list every surface reads. Switching a theme to basic in the editor or the MCP
drops the keys it can no longer express; nothing is migrated and no converter
exists.
