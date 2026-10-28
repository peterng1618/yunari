# Yunari status

Updated: 2026-10-28
Branch: `peterng1618/asset-finder-hub` (worktree `asset-finder-hub`)

## Current objective

The asset finder's UI/UX overhaul: one shell, one card, one skeleton and one control set across every tab, then the Unsplash feed, the font and Wallpaper Engine panes, the preview modal and the DESIGN.md rules.

## Active work

- **Plan is running:** `docs/superpowers/plans/2026-10-28-asset-finder-unification.md`, Phase 1.
- **Phase 1 is complete:** the window, the card, the skeleton/state vocabulary, and the frame with its controls have landed.
- **Phase 2 next:** accumulated tab data, `FinderGrid` and the shell's append path replace paging.

## Last completed change

- **One grid:** `FinderGrid` owns the listbox, the roving tab stop, arrow-key movement by the measured column count, Enter to apply, and an append sentinel rooted on the scroller.
- **The modal draws it:** cards come from `cardModelOf`, selection is keyed by source + id, and `onNeedMore`/`appending` wait for the shell's append path in Task 2.3.
- **Proof:** asset-finder unit files 14 / 144 passed; `asset-finder.spec.ts` 18 passed + 1 skipped against a private preview.

## Next

1. Execute Phase 2 of the plan: `TabData`, `FinderGrid`, then the shell's append path.
2. Then Phase 3: the Unsplash Editorial feed and the Images proof.
3. Then Phase 4: fonts, Wallpaper Engine, the preview modal and the DESIGN.md rules.

## Blockers / unverified

- **Preview port 4174 is held by the `fix-font-trio` worktree:** run browser proofs with `YUNARI_EDITOR_URL` against a private preview port.
- **`npx playwright` is broken by `@playwright/mcp`'s alpha Playwright** (`vg-774`); run `node node_modules/@playwright/test/cli.js`.
- **Open rows:** `vg-773` (the rest of the app's UI/UX audit), `vg-774`.
