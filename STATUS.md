# Yunari status

Updated: 2026-10-28
Branch: `main`

## Current objective

The asset finder's UI/UX overhaul is complete. Next: the same audit across the rest of the app (`vg-780`).

## Active work

- **No plan is running:** the finder plan and the font-family-weights plan are complete; the backlog drain is next.
- **The finder is one surface:** one frame, card, skeleton, control set and state vocabulary across every tab.
- **DESIGN.md owns the rules:** §5's "Asset finder tabs" is the checklist for every tab added later.
- **The curated catalogue carries every published weight** (1,003 faces), and trio import adopts each role's full ladder (`0131`).
- **The Design Tokens pane is redesigned** (`0130`) and the type-token model is in (`0128`).
- **Display motion is in:** one fixed 30 fps refresh loop, a transition pump, skip-unchanged bound text (`0129`).

## Last completed change

- **The finder overhaul merged:** one frame for every tab, browse-on-open, append-on-scroll, Fonts/Images/Wallpaper Engine panes, and a media preview that Escape returns from.
- **Review close-out:** one fresh whole-branch review found no Critical; its four state-wiring defects and two spec drifts are fixed, each RED→GREEN.
- **Keys and state:** Connections follows any keyed source's failure, a missing key's body offers it, and the failed mark stays on the card that failed.
- **Cards:** a photo or font states its own licence, and the footer's primary action is the accented one.
- **Proof:** 148 finder DOM tests; 28 desktop + 2 phone browser tests; `npm run gate` exit 0 (453 files, 6911 tests).

## Next

1. Apply the same audit to the rest of the app (`vg-780`).
2. Drain the backlog: a reproduction pass first, not a fix pass.
3. Triage the browser cases already red on this tree (`vg-773`–`vg-777`); the multi-device display objective stays queued.

## Blockers / unverified

- **Browser arm unverified as a whole:** `npm run test:e2e` collects nothing (`vg-777`); run specs with `node node_modules/@playwright/test/cli.js test`.
- **The transition pump is unit-proven only:** no capture shows a gauge mid-transition on a real display.
- **Not verified in a browser:** the two-press delete was linted, not driven by a person on a touch screen.
- **Open rows:** `vg-770`–`vg-785`; starter role weights stay read-only while `Segoe UI` and `Consolas` are undeclared.
- **`vg-756` and the store-worker token handoff:** closing `return-page.ts` needs a nonce or a pinned-port decision.
