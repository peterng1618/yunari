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

- **One frame for every tab:** `FinderFrame` owns the rail (fixed order), toolbar (search, filters, sources, pager, tools), content and footer; `FinderSearch`, `FinderSegmented`, `FinderChip`, `FinderActionButton` and `ConnectionsButton` are the shared controls.
- **Connections is drawn only while a keyed source reports a missing or refused key**, and is the toolbar's icon rather than an inline link.
- **A pane that owns its own search or footer draws neither**, so the font catalogue and Wallpaper Engine keep their own field.
- **Proof:** asset-finder unit files 13 / 135 passed; `asset-finder.spec.ts` 18 passed + 1 skipped against a private preview; `npm run gate` exit 0.

## Next

1. Execute Phase 2 of the plan: `TabData`, `FinderGrid`, then the shell's append path.
2. Then Phase 3: the Unsplash Editorial feed and the Images proof.
3. Then Phase 4: fonts, Wallpaper Engine, the preview modal and the DESIGN.md rules.

## Blockers / unverified

- **Preview port 4174 is held by the `fix-font-trio` worktree:** run browser proofs with `YUNARI_EDITOR_URL` against a private preview port.
- **`npx playwright` is broken by `@playwright/mcp`'s alpha Playwright** (`vg-774`); run `node node_modules/@playwright/test/cli.js`.
- **Open rows:** `vg-773` (the rest of the app's UI/UX audit), `vg-774`.
