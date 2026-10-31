# 0042 — The pairing store owns "the live code, or a new one"

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/server.ts`

## Problem

The start-up banner runs after the server answers, and the pairing route is
readable in between. When the banner minted unconditionally it replaced a code
the route had just shown, and the claim that followed answered 404. The fix —
`current() ?? mint()` — was written twice, once in the route and once in
`main.ts`, and nothing proved the two agreed.

## Rung 1 — internal owner

Searched: CodeGraph for `PairingCodeStore`, `currentOrMint`, `pairingCodes`;
read `session/pairing-code.ts`, `server.ts`, `main.ts`.
Found: the store owns the one live window and its expiry; both callers spelled
the same policy. Prior art in the same file: `claim` already re-reads `current`
rather than holding a copy, for the same reason. The owner is the store.

## Rung 2 — installed dependencies

Searched: Node `crypto.randomInt` usage already in the file; no relevant
library behavior.
Found: nothing donated.

## Rung 3 — native platform

Searched: none applicable — this is product state.

## Rung 4 — public solutions

Searched: none needed — the decision is about one in-repo expression, not an
integration shape.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Extract a `bannerCode()` in `main.ts` | Only one caller | Route still spells its own copy | Rejected |
| Slow the banner behind a test seam | Tests the banner, not the rule | New test-only injection | Rejected |
| `currentOrMint()` on the store | One owner, both callers | None | Chosen |

## Rung 6 — smallest probe

`pairing-code.test.ts` mints through the store, then asserts `currentOrMint`
answers the same code, and that an expired window draws a new one with an
injected clock and code generator. The route and banner call the same method, so
the two cannot drift apart again.

## Decision

Add `currentOrMint()` to `PairingCodeStore`; the route and banner call it. The
store owns the window, so the read-never-rotates rule lives where the window
does.
