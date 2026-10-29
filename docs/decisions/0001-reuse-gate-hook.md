# 0001 — Enforce reuse notes before mechanism writes

- **Date:** 2026-10-29
- **Status:** accepted
- **Paths:** `scripts/reuse-gate.mjs`

## Problem

The reuse rule was repeatedly skipped when an early search found a plausible
API. Enforcement must require evidence at the mechanism boundary without making
ordinary UI, copy or test edits pass through a decision gate.

## Rung 1 — internal owner

Searched pre-reset `scripts/reuse-gate.mjs`, `.claude/settings.json`,
`src/web/package.json` and decision-note format, then compared the lean docs.
The old gate already owns pre-write enforcement; restore that mechanism rather
than add another checker. Its historical comments and live-note fixtures do not
fit the reset and are not restored.

## Rung 2 — installed dependencies

Node's filesystem, path and child-process modules cover stdin JSON, tracked
paths and note claims. No dependency is needed.

## Rung 3 — native platform

Claude Code `PreToolUse` hooks can deny `Edit`, `Write` and `MultiEdit` before a
write. Exit 2 supplies the refusal reason; `onFailure: block` prevents a missing
or broken hook from silently disabling enforcement. Unexpected input remains
fail-open inside the script so malformed tool payloads do not block all edits.

## Rung 4 — public solutions

Searched the current Claude Code hook configuration and lifecycle documentation
for pre-tool denial, Windows shell execution and failure behavior. The native
hook provides the required event and denial channel; no external policy service
or hook framework is needed. Presence checking cannot judge research quality;
review remains responsible for that.

## Rung 5 — comparison

| Option | Fit | Cost | Verdict |
|---|---|---|---|
| Documentation only | No reminder at the write | Lowest | Reject: previously skipped |
| Prompt/agent hook | Can judge quality | Model call per edit; nondeterministic | Reject for presence check |
| Native command hook | Deterministic, local, pre-write | Exact-path watchlist maintenance | Reuse |
| CI-only check | Covers non-agent writes | Too late to guide implementation | Keep as future complement if needed |

## Rung 6 — probe

Run the script's self-test, pipe representative hook payloads to it, validate
settings JSON and run `npm run gates:self-test`. A real hook event must also be
observed or reported as requiring configuration reload.

## Decision

Restore one repo-local command hook and the Node gate. Require an exact file
claim in `docs/decisions/NNNN-<slug>.md`; directory claims do not license future
files. Keep tests and non-watchlisted paths outside the gate.
