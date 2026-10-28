# Yunari status

Updated: 2026-10-28
Branch: `peterng1618/fix-font-trio` (worktree `fix-font-trio`)

## Current objective

Two plans are complete — the type-token model and the display's own motion — and local `main` at `1d0b9b9` carries both; next is the backlog drain.

## Active work

- **No plan is running:** the type-token plan's six phases and the display-animation plan's seven tasks are done; `main` (at `b3a2b98`) is merged in here, and local `main` now points at this branch's tip.
- **The Design Tokens pane is redesigned** (`0130`): painted like the paint list, a usage figure and a linked users list on both token kinds, headings Paint tokens / Type tokens, the rail says Design tokens, and Delete takes two presses against an empty reassignment box.
- **The type-token model is in:** a token names a face whereas size, line height and tracking belong to each run (`0128`).
- **Display motion is in:** one fixed 30 fps `startSceneRefresh` loop, a transition pump in `YunariChart`, skip-unchanged bound text, and no chart-rate setting anywhere (`0129`).
- **The type-token final review is discharged:** its one blocking defect is fixed and re-reviewed FIXED (`a84f7d90`), and its should-fix is filed as `vg-772`.
- **The live line is placed by its data:** axis at its newest reading, no delay or hold, missing readings skipped, sample frames queued at the transport (0124).

## Last completed change

- **Type rows now read like paint rows:** the redundant family/weight line is gone, leaving the specimen, the computed name and a usage figure; the paint heading says Paint tokens and the type one Type tokens.
- **One walk per token kind:** `objectTypeTokenReferences` sits beside the paint walk behind one shared `TokenUsage`, so a row's figure and the inspector's users list cannot disagree.
- **A user is a link:** each layer in the inspector shows Composition and selects that layer, through `PaneRequestStore.show("composition")` and the session's `onRevealLayer`.
- **Delete is a confirmation:** the reassignment select appears only on the first press, starts empty rather than on a token, and the second press is refused until one is chosen (`0130`).
- **Proof:** `npm run gate` exit 0 — 6,892 unit tests passed plus 1 skipped; browser green for panel labels, the rail, the four reassignment cases, the pane capture and the first rebuild case; five unrelated reds filed `vg-773`–`vg-777`.

## Next

1. Resume the backlog-drain plan at Phase 0, a reproduction pass over the register.
2. Owner test of a gauge mid-transition on a real display.
3. Triage `vg-773`–`vg-777`, which are the browser cases already red on this tree.

## Blockers / unverified

- **Browser arm unverified as a whole:** only the specs named above ran; `npm run test:e2e` collects nothing (`vg-777`), so specs run via `node node_modules/@playwright/test/cli.js test`.
- **The transition pump is unit-proven only:** no capture shows a gauge mid-transition on a real display.
- **Not verified in a browser:** the two-press delete was driven in the four reassignment cases and both panel-label audits, not by a person on a touch screen.
- **Open rows:** `vg-770`, `vg-762`, `vg-771`, `vg-772`, `vg-773`–`vg-777`; starter role weights stay read-only while `Segoe UI` and `Consolas` are undeclared.
- **`vg-756` and the store-worker token handoff:** closing `return-page.ts` needs a nonce or a pinned-port decision.
