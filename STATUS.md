# Yunari status

Updated: 2026-10-28
Branch: `peterng1618/asset-finder-hub` (worktree `asset-finder-hub`)

## Current objective

The asset finder's UI/UX overhaul: one shell, one card, one skeleton and one control set across every tab, then the Unsplash feed, the font and Wallpaper Engine panes, the preview modal and the DESIGN.md rules.

## Active work

- **Plan is running:** `docs/superpowers/plans/2026-10-28-asset-finder-unification.md`, Phase 3.
- **Phase 2 is complete:** each tab accumulates its own question, rows and selection; the grid appends on scroll and the pager is deleted.
- **Phase 3 in progress:** the Unsplash Editorial feed has landed; the Images browser proof is next.

## Last completed change

- **Images proved end to end:** the tab draws photos on open with an empty term, and the request proves the browse is a real host call.
- **Its two other states:** a missing key shows the footer sentence and the Connections button, and an empty feed shows "nothing to browse", never "no results".
- **Proof:** the first test failed with browse-on-open disabled, then passed restored.

## Next

1. Execute Task 3.3: the Fonts pane facade.
2. Then Phase 4: Wallpaper Engine, the preview modal and the DESIGN.md rules.

## Blockers / unverified

- **Preview port 4174 is held by the `fix-font-trio` worktree:** run browser proofs with `YUNARI_EDITOR_URL` against a private preview port.
- **`npx playwright` is broken by `@playwright/mcp`'s alpha Playwright** (`vg-774`); run `node node_modules/@playwright/test/cli.js`.
- **Open rows:** `vg-773` (the rest of the app's UI/UX audit), `vg-774`.
