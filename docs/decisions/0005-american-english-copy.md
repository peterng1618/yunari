# 0005 — product copy uses American spelling

- **Date:** 2026-10-30
- **Status:** accepted
- **Paths:**
  `src/web/packages/editor/src/ui-copy.ts`,
  `src/web/packages/editor/src/favorites-client.ts`,
  `src/web/packages/renderer-core/src/charts/settings-fields.ts`,
  `src/web/packages/renderer-core/src/theme/envelope-semantics.ts`,
  `src/web/packages/renderer-core/src/theme/fabric-envelope-validate.ts`,
  `src/web/packages/host/src/server.ts`,
  `src/web/packages/host/src/assets/routes.ts`

## Problem

The interface mixed British and American spellings — "Colours" beside "Color
Hunt", "licence" in a fact row, "centre" in a chart hint. One language has to
own the copy a person reads.

## Rung 1 — internal owner

Searched the editor's `uiCopy` record, `settings-fields.ts`, the envelope
validators and the host's refusal strings. Found: `ui-copy.ts` is the editor's
single copy owner; chart hints are declared beside their settings; validation
messages are written where the refusal is raised. There is no separate
localisation catalogue to extend.

## Rung 2 — installed dependencies

No dependency renders or transforms these strings, so none donates a spelling
rule.

## Rung 3 — native platform

`Intl` formats values, not product prose. There is no native spelling service.

## Rung 4 — public solutions

Searched "American vs British spelling UI copy style guide" and read the
Microsoft Writing Style Guide and Google developer documentation style guide.
Both name US English as the default for product text and keep identifiers and
external names as their source spells them.

## Rung 5 — integration comparison

Only the rendered text changes. Persisted and wire names (`licence`,
`favourite`, `colourMode`, asset route ids) stay: renaming them would break
theme envelopes and host routes for a spelling nobody sees. Official names —
"Ubuntu Font Licence", an external licence URL — keep their owner's spelling.

## Rung 6 — smallest probe

The existing copy assertions (`actions.test.ts`, the modal suites) read the
rendered sentences. The probe is that suite before and after the change: every
assertion names the American text and stays green.

## Decision

Product copy uses American English ("color", "license", "center", "favorite",
"canceled", "normalized"). Identifiers, persisted keys, route ids and official
names keep their existing spelling.
