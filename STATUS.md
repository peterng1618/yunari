# Yunari status

Updated: 2026-10-28
Branch: `peterng1618/asset-finder-hub` (worktree `asset-finder-hub`)

## Current objective

The asset finder's UI/UX overhaul: one shell, one card, one skeleton and one control set across every tab, then the Unsplash feed, the font and Wallpaper Engine panes, the preview modal and the DESIGN.md rules.

## Active work

- **Plan is running:** `docs/superpowers/plans/2026-10-28-asset-finder-unification.md`, Phase 3 next.
- **Phase 2 is complete:** each tab accumulates its own question, rows and selection; the grid appends on scroll and the pager is deleted.
- **Phase 3 next:** the Unsplash Editorial feed and its Images proof.

## Last completed change

- **Per-tab data:** each category owns a `TabView` (question, accumulated rows, loading, selection, message), so switching tabs restores rather than resets.
- **Append on scroll:** opening a tab asks page one of every enabled source; the grid's sentinel asks the next page of sources that have one, and the footer's pager is gone.
- **One status line:** outcome → "Searching N sources…" → failure/credential sentence with Retry → count → "End of results", and empty/error states use `FinderState`.
- **Proof:** asset-finder units 15 files / 146 passed; `asset-finder.spec.ts` 23 passed + 1 skipped against a private preview.

## Next

1. Execute Phase 3: the Unsplash Editorial feed and the Images browser proof.
2. Then Phase 4: fonts, Wallpaper Engine, the preview modal and the DESIGN.md rules.
3. Then the final whole-branch review and the branch finish.

## Blockers / unverified

- **Preview port 4174 is held by the `fix-font-trio` worktree:** run browser proofs with `YUNARI_EDITOR_URL` against a private preview port.
- **`npx playwright` is broken by `@playwright/mcp`'s alpha Playwright** (`vg-774`); run `node node_modules/@playwright/test/cli.js`.
- **Open rows:** `vg-773` (the rest of the app's UI/UX audit), `vg-774`.
