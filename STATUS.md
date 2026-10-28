# Yunari status

Updated: 2026-10-28
Branch: `peterng1618/asset-finder-hub` (worktree `asset-finder-hub`)

## Current objective

The asset finder's UI/UX overhaul: one shell, one card, one skeleton and one control set across every tab, then the Unsplash feed, the font and Wallpaper Engine panes, the preview modal and the DESIGN.md rules.

## Active work

- **Plan is running:** `docs/superpowers/plans/2026-10-28-asset-finder-unification.md`, Phase 4.
- **Phase 2 is complete:** each tab accumulates its own question, rows and selection; the grid appends on scroll and the pager is deleted.
- **Phase 3 is complete:** the Unsplash Editorial feed and both browser panes (Images, Fonts) draw through the shared frame and card.
- **Phase 4 in progress:** the Wallpaper Engine library and the media preview are panes of the same frame; the DESIGN.md rules remain.

## Last completed change

- **A media preview over the finder:** double-clicking a photo or Wallpaper Engine item opens the enlarged result, with its facts and the tab's own actions.
- **Two routes, one surface:** the footer's Preview icon button opens the same modal for a previewable selection.
- **Escape closes the preview, not the finder:** the finder refuses to close while the preview is over it, and focus returns to the card.
- **Proof:** 54 DOM tests, 32 finder browser tests (1 skipped), `npm run gate` exit 0; both red proofs failed first.

## Next

1. Execute Task 4.3: the DESIGN.md rules and the phase close.

## Blockers / unverified

- **Preview port 4174 is held by the `fix-font-trio` worktree:** run browser proofs with `YUNARI_EDITOR_URL` against a private preview port.
- **`npx playwright` is broken by `@playwright/mcp`'s alpha Playwright** (`vg-774`); run `node node_modules/@playwright/test/cli.js`.
- **Open rows:** `vg-773` (the rest of the app's UI/UX audit), `vg-774`.
