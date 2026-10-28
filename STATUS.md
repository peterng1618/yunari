# Yunari status

Updated: 2026-10-28
Branch: `peterng1618/fix-font-trio` (worktree `fix-font-trio`)

## Current objective

Every published weight of a curated family is importable: trio and family imports package the family's full weight list, and the token weight field offers it ([`0131`](docs/decisions/0131-the-catalogue-carries-every-published-weight.md)).

## Active work

- **No plan is running:** [`2026-10-28-font-family-weights`](docs/superpowers/plans/archive/2026-10-28-font-family-weights.md) is complete and archived; the backlog drain is next.
- **The Design Tokens pane is redesigned** (`0130`): painted like the paint list, a usage figure and a linked users list on both token kinds, headings Paint tokens / Type tokens, the rail says Design tokens, and Delete takes two presses against an empty reassignment box.
- **The type-token model is in:** a token names a face whereas size, line height and tracking belong to each run (`0128`).
- **Display motion is in:** one fixed 30 fps `startSceneRefresh` loop, a transition pump in `YunariChart`, skip-unchanged bound text, and no chart-rate setting anywhere (`0129`).
- **The type-token final review is discharged:** its one blocking defect is fixed and re-reviewed FIXED (`a84f7d90`), and its should-fix is filed as `vg-772`.
- **The live line is placed by its data:** axis at its newest reading, no delay or hold, missing readings skipped, sample frames queued at the transport (0124).

## Last completed change

- **The curated catalogue carries every published weight:** 1,003 latin/normal faces across 174 families (was 261), with `role`/`clamped` moved onto a trio-only face subtype (`0131`).
- **A family's cuts are askable:** `AssetSource.familyCuts` and `GET /api/assets/family-cuts` answer a family's ladder, so trio import reads the weights it needs instead of every trio result carrying them.
- **Trio import brings them all:** `applyFontTrio` and `addTypeTokensFromTrio` adopt every weight of the roles' families and leave the token on the trio's recommended cut.
- **Proof:** gate exit 0; the new browser case applies `inter-poppins` and reads nine Inter weights with 700 selected.

## Next

1. Owner test: apply a trio on a real display and switch a role's weight by eye.
2. Resume the backlog-drain plan afterwards, starting with a reproduction pass.
3. Triage `vg-773`–`vg-777`, the browser cases already red on this tree.

## Blockers / unverified

- **Browser arm unverified as a whole:** only the specs named above ran; `npm run test:e2e` collects nothing (`vg-777`), so specs run via `node node_modules/@playwright/test/cli.js test`.
- **The transition pump is unit-proven only:** no capture shows a gauge mid-transition on a real display.
- **Not verified in a browser:** the two-press delete was driven in the four reassignment cases and both panel-label audits, not by a person on a touch screen.
- **Open rows:** `vg-770`, `vg-762`, `vg-771`, `vg-772`, `vg-773`–`vg-777`; starter role weights stay read-only while `Segoe UI` and `Consolas` are undeclared.
- **`vg-756` and the store-worker token handoff:** closing `return-page.ts` needs a nonce or a pinned-port decision.
