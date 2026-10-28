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

- **Editorial feed:** an empty term now browses `GET /photos` with the same key, instead of answering an empty page.
- **Page count:** the feed's `Link` header names the last page; a `next` link means one more, and a header-less page is judged by whether it came back full.
- **Proof:** `unsplash.test.ts` 12 passed, watched failing first.

## Next

1. Execute Task 3.2: the Images tab's browser proof.
2. Then Task 3.3: the Fonts pane facade, then Phase 4.

## Blockers / unverified

- **Preview port 4174 is held by the `fix-font-trio` worktree:** run browser proofs with `YUNARI_EDITOR_URL` against a private preview port.
- **`npx playwright` is broken by `@playwright/mcp`'s alpha Playwright** (`vg-774`); run `node node_modules/@playwright/test/cli.js`.
- **Open rows:** `vg-773` (the rest of the app's UI/UX audit), `vg-774`.
