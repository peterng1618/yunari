# 0015 — the UI sans stack has a CSS owner

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `scripts/design-md.mjs`

## Problem

DESIGN.md's six typography entries each declare `fontFamily:
"system-ui, sans-serif"`, but no CSS token carries that stack and `--sync`
ignores the field. The front matter is therefore a transcription no check
keeps honest: change the chrome stack and the normative document silently
lies.

## Rung 1 — internal owner

Searched: CodeGraph for `fontFamily`, `--font-`, `--shell-display`,
`checkSync`.

Found: `editor-shell.css`'s `@theme static` owns the scale
(`--text-*`); `--shell-display` is the palette's display face, a different
fact. `scripts/design-md.mjs` owns the front-matter ↔ `@theme static`
comparison for `--space-*`, `--radius-*` and `--text-*`. Nothing owned the
UI sans stack, so the check could not otherwise see it.

## Rung 2 — installed dependencies

Searched: `@google/design.md`'s typography schema and linter behaviour.

Found: the linter accepts and ignores `fontFamily`; it does not require it.
The format gives no sync mechanism, so the repository's own `--sync` is the
owner that must compare it.

## Rung 3 — native platform

Searched: Tailwind v4 `--font-*` namespace.

Found: a `--font-ui` declaration in `@theme static` is a font-family theme
token; the browser resolves it like any custom property. CSS alone cannot
compare the front matter with itself — that is the script's job.

## Rung 4 — public solutions

Searched: design-system token pipelines (Style Dictionary, Tokens Studio)
for how a normative typography table stays in step with CSS.

Found: they generate one side from the other or fail a sync check; none
lets both sides drift. Yunari's existing `--sync` is that check, so the
token joins it rather than a new pipeline being adopted.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Declare `fontFamily` omitted | drops a fact section 2 states | none | reject (user ruled against) |
| Sync against `--shell-display` | wrong fact: serif display face | misleading document | reject |
| Add `--font-ui` and sync each entry | one owner, one check | tag the new token | accept |

## Rung 6 — smallest probe

`node scripts/design-md.mjs --sync` currently passes with the field
ignored; the self-test gains two cases — a missing `fontFamily` and a
disagreeing one — so the new rule is shown able to fail before it ships.

## Decision

`editor-shell.css` declares `--font-ui: system-ui, sans-serif` in
`@theme static`. `--sync` requires every typography entry to declare
`fontFamily` and compares each against that token; a missing field or a
different stack is a finding.
