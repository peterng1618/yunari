# 0141 — Drop the retired store region from the design-token gate

- **Date:** 2026-11-16
- **Status:** accepted
- **Paths:** `scripts/design-tokens.gated.json`

## Problem

`scripts/design-tokens.gated.json` names `src/web/packages/editor/src/store-mode/region.tsx`
as a gated file. Task 13 deletes that file: the Dashboard themes page now reads
the Library's own state-filtered listing, so the theme-only store region has no
mount. The audit's gated walk then fails with `ENOENT` against a path the tree no
longer holds. The list must name files that exist, or the one command that means
green reports a red design gate forever.

## Rung 1 — internal owner

Searched: `grep -rn "store-mode/region.tsx"`, `scripts/design-tokens.mjs`,
`scripts/design-tokens.gated.json`, `package.json`'s `design:check`.
Found: the gated list is read by `scripts/design-tokens.mjs` (`DEFAULT_GATED`)
and is the only owner of the file set the token audit walks. No other module
reads the entry. The file it named is gone; nothing else in the tree references
it outside review artefacts under `.superpowers/`.

## Rung 2 — installed dependencies

Searched: `scripts/design-tokens.mjs` and its self-tests.
Found: the script treats a named path that cannot be read as a violation and
fails the run. It offers no "missing is fine" mode, deliberately — a gated file
that silently disappears would stop being audited. Removing the entry is the
supported way to retire a file.

## Rung 3 — native platform

Searched: Node `fs` behaviour used by the script.
Found: `readFileSync` on a missing path throws; there is no platform feature
that distinguishes a retired file from a mistyped one. The list is the record.

## Rung 4 — public solutions

Searched: repository precedent — how earlier deletions retired their gated
entries.
Found: `scripts/design-tokens.gated.json` is a flat allowlist; earlier phases
edited it in the same change that moved or deleted the file it named (the
allowlist's own docblock says "remove the entry" rather than keeping a shim).
No package or external standard applies.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep the deleted file as a stub | Fails the task: the file is the point | Keeps dead code and a second scene path | Rejected |
| Remove the entry | The audit walks only files the tree holds | None | Chosen |
| Teach the script to skip missing entries | Weakens the audit's own guard | A mistyped path would pass | Rejected |

## Rung 6 — smallest probe

Ran `npm run design:check` after deleting the file: it printed
`design-tokens: src/web/packages/editor/src/store-mode/region.tsx cannot be read
(ENOENT)`. That is the executable evidence that the entry, not the script, is
stale.

## Decision

Remove the entry from `scripts/design-tokens.gated.json` in the change that
deletes the file. The audit keeps failing on a missing gated path, so the
allowlist cannot drift back to naming files that do not exist.
