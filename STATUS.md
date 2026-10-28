# Yunari status

Updated: 2026-10-28
Branch: `peterng1618/asset-finder-hub` (worktree `asset-finder-hub`)

## Current objective

The asset finder's UI/UX overhaul is complete. Next: the same audit across the rest of the app (`vg-773`).

## Active work

- **Plan complete:** `docs/superpowers/plans/2026-10-28-asset-finder-unification.md`; nothing is in flight.
- **The finder is one surface:** one frame, card, skeleton, control set and state vocabulary across every tab.
- **DESIGN.md owns the rules:** §5's "Asset finder tabs" is the checklist for every tab added later.

## Last completed change

- **One frame for every tab:** fixed tab order, one toolbar search, one card, one animated skeleton, one footer status line.
- **Browse on open, append on scroll:** Unsplash browses its Editorial feed with no term; pages append and the pager is gone.
- **Fonts, Images and Wallpaper Engine are panes:** their filters, selections and writes use the shared frame via `fontActions()` and `wallpaperActions()`.
- **Media preview:** a double-click or the footer's Preview button opens a photo or wallpaper result over the finder; Escape returns to the card.
- **Proof:** 32 finder browser tests (1 skipped), four red proofs failed first, `npm run gate` exit 0 (453 files, 6906 tests).

## Next

1. Apply the same audit to the rest of the app (`vg-773`).
2. Drain the backlog: a reproduction pass first, not a fix pass.
3. The queued multi-device display objective.

## Blockers / unverified

- **Preview port 4174 is held by the `fix-font-trio` worktree:** run browser proofs with `YUNARI_EDITOR_URL` against a private preview port.
- **`npx playwright` is broken by `@playwright/mcp`'s alpha Playwright** (`vg-774`); run `node node_modules/@playwright/test/cli.js`.
- **Open rows:** `vg-773` (the rest of the app's UI/UX audit), `vg-774`.
