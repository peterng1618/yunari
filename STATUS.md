# Yunari status

Updated: 2026-10-28
Branch: `peterng1618/asset-finder-hub` (worktree `asset-finder-hub`)

## Current objective

The asset finder's UI/UX overhaul is complete. Next: the same audit across the rest of the app (`vg-773`).

## Active work

- **Plan complete and reviewed:** `docs/superpowers/plans/2026-10-28-asset-finder-unification.md`; nothing is in flight.
- **The finder is one surface:** one frame, card, skeleton, control set and state vocabulary across every tab.
- **DESIGN.md owns the rules:** §5's "Asset finder tabs" is the checklist for every tab added later.

## Last completed change

- **Review close-out:** one fresh whole-branch review found no Critical; its four state-wiring defects and two spec drifts are fixed, each RED→GREEN.
- **Keys and Connections:** Connections follows any keyed source's failure, and a missing key's body offers Connections instead of a dead Retry.
- **Tab and mark state:** a Colours kind filter no longer clears the next tab's rows; the failed mark stays on the card that failed.
- **Card and footer:** a photo or font states its own licence, and the footer's primary action is the accented one.
- **Proof:** 148 finder DOM tests, 28 desktop + 2 phone browser tests, `npm run gate` exit 0 (453 files, 6911 tests).

## Next

1. Apply the same audit to the rest of the app (`vg-773`).
2. Drain the backlog: a reproduction pass first, not a fix pass.
3. The queued multi-device display objective.

## Blockers / unverified

- **Preview port 4174 is held by the `fix-font-trio` worktree:** run browser proofs with `YUNARI_EDITOR_URL` against a private preview port.
- **`npx playwright` is broken by `@playwright/mcp`'s alpha Playwright** (`vg-774`); run `node node_modules/@playwright/test/cli.js`.
- **Open rows:** `vg-773`, `vg-774`, and `vg-776`–`vg-779` filed from the final review.
