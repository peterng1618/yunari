# Yunari status

Updated: 2026-10-28
Branch: `peterng1618/asset-finder-hub` (worktree `asset-finder-hub`)

## Current objective

The asset finder's UI/UX overhaul: one shell, one card, one skeleton and one control set across every tab, then the Unsplash feed, the font and Wallpaper Engine panes, the preview modal and the DESIGN.md rules.

## Active work

- **Plan is running:** `docs/superpowers/plans/2026-10-28-asset-finder-unification.md`, Phase 4.
- **Phase 2 is complete:** each tab accumulates its own question, rows and selection; the grid appends on scroll and the pager is deleted.
- **Phase 3 is complete:** the Unsplash Editorial feed and both browser panes (Images, Fonts) draw through the shared frame and card.
- **Phase 4 in progress:** the Wallpaper Engine library is now a pane of the same frame; the preview modal and the DESIGN.md rules remain.

## Last completed change

- **Wallpaper Engine is a pane:** the library is fetched once, filtered in memory, and drawn by the shared grid; filters, search and tools use the one frame.
- **One footer action per selection:** `wallpaperActionsOf` names a video's background or a scene's conversion, and a success marks that card done.
- **Tools stay still:** the guide and `.mpkg` import sit in the toolbar, so a listing landing never remounts the import modal.
- **Facade swap:** `wallpaperActions()` replaces `wallpaperEngineBody()`; the old body, card and body test are deleted.
- **Proof:** 59 DOM tests in the touched files, 4 Wallpaper Engine and 27 finder browser tests (1 skipped), `npm run gate` exit 0.

## Next

1. Execute Task 4.2: the double-click preview modal.
2. Then Task 4.3: the DESIGN.md rules and the phase close.

## Blockers / unverified

- **Preview port 4174 is held by the `fix-font-trio` worktree:** run browser proofs with `YUNARI_EDITOR_URL` against a private preview port.
- **`npx playwright` is broken by `@playwright/mcp`'s alpha Playwright** (`vg-774`); run `node node_modules/@playwright/test/cli.js`.
- **Open rows:** `vg-773` (the rest of the app's UI/UX audit), `vg-774`.
