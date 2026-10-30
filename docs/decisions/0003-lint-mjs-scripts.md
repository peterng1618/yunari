# 0003 — Lint every `.mjs` script in the one Biome run

- **Date:** 2026-10-30
- **Status:** accepted
- **Paths:** `scripts/dead-code-sweep.mjs`, `scripts/scratch-gate.mjs`

## Problem

`biome.json`'s `files.includes` named TypeScript, TSX, JSON and CSS, so the
repository's only lint gate never read the `.mjs` scripts that perform its own
checks. An unused import or variable could land in a script the gate runs while
`npm run gate` still exited 0.

## Rung 1 — internal owner

Searched `biome.json`, `src/web/package.json`'s `gate` script and the existing
include of `src/web/packages/host/src/themes/ffmpeg-hash.mjs`. The linter is
already the owner; one `.mjs` file was listed by hand, which is the pattern that
leaves every other script out.

## Rung 2 — installed dependencies

Read the installed Biome configuration schema and ran `biome check` against the
script directories. Biome already provides file globs and the
`noUnusedImports` / `noUnusedVariables` rules this repo enables; no dependency
is added.

## Rung 3 — native platform

None. The includes list is configuration, not a platform capability.

## Rung 4 — public solutions

Searched the installed Biome configuration schema for `files.includes` glob
semantics and the rule names. The supported answer is a glob in the existing
config; a second linter or a per-directory wrapper would duplicate the gate.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep the hand-listed file | Reads one script | Every new script is outside the gate | Reject |
| Include `**/*.mjs` for `scripts/` and `src/web/` | One run covers every script | One formatting pass over existing scripts | Reuse |
| Separate script-lint command | Could run only scripts | A second gate command to remember | Reject |

## Rung 6 — smallest probe

`biome check` over the script directories reports the two real errors this
change fixes (`dead-code-sweep.mjs`'s unused loop variable,
`scratch-gate.mjs`'s unused `sep` import). After the fixes it exits 0, and an
unused variable appended to a `.mjs` file makes the gate exit 1 naming it.

## Decision

Add `scripts/**/*.mjs` and `src/web/**/*.mjs` to `files.includes`, and fix the
two findings the widened include exposes.
