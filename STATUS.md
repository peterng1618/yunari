# Yunari status

Updated: 2026-10-28
Branch: `peterng1618/asset-finder-hub` (worktree `asset-finder-hub`)

## Current objective

The asset finder's UI/UX overhaul: one shell, one card, one skeleton and one control set across every tab, then the Unsplash feed, the font and Wallpaper Engine panes, the preview modal and the DESIGN.md rules.

## Active work

- **Plan is running:** `docs/superpowers/plans/2026-10-28-asset-finder-unification.md`, Phase 4.
- **Phase 2 is complete:** each tab accumulates its own question, rows and selection; the grid appends on scroll and the pager is deleted.
- **Phase 3 is complete:** the Unsplash Editorial feed and both browser panes (Images, Fonts) draw through the shared frame and card.

## Last completed change

- **Fonts is a pane, not a body:** the same search, grid, skeleton and empty/error states; its filters, selection and preview live in the tab's own state.
- **One footer and one detail column:** `fontActionsOf` declares a trio's and a family's outcomes, and the preview panel is controlled by the shell.
- **Facade swap:** `fontActions()` replaces `fontPickerBody()`; `fonts-body.tsx` and `font-grid.tsx` are deleted with their tests.
- **Proof:** 62 focused DOM tests, 27 browser tests (1 skipped) and `npm run gate` exit 0.

## Next

1. Execute Task 4.1: the Wallpaper Engine pane.
2. Then Task 4.2 (the double-click preview modal) and Task 4.3 (DESIGN.md rules and the phase close).

## Blockers / unverified

- **Preview port 4174 is held by the `fix-font-trio` worktree:** run browser proofs with `YUNARI_EDITOR_URL` against a private preview port.
- **`npx playwright` is broken by `@playwright/mcp`'s alpha Playwright** (`vg-774`); run `node node_modules/@playwright/test/cli.js`.
- **Open rows:** `vg-773` (the rest of the app's UI/UX audit), `vg-774`.
