# Yunari status

Updated: 2026-10-29
Branch: `main`

## Current objective

Panel video playback is live on the Lian Li 9.2" (`0134`), and a video background now carries a still frame plus a per-panel static/dynamic glass switch (`0135`). Next: the same UI/UX audit across the rest of the app (`vg-780`).

## Active work

- **No plan is running:** the finder plan and the font-family-weights plan are complete; the backlog drain is next.
- **`0135` is implemented and green:** `background.fallbackFrame` and `glass.sampling` are in the model, schema, validator and both inspector columns.
- **Static glass samples the declared still** instead of the live video, and paints nothing (the board paint) when the video declares no frame.
- **The repaint loop counts only dynamic panels**, so an all-static theme spends no per-frame render on video; a theme may mix the two.
- **`PanelVideo` + `PanelVideoPlacement` is the contract** the TURZX worktree should copy when its adapter lands.

## Last completed change

- **A video background carries a still frame** (`0135`): the browser extracts `frame / fps` from a hidden probe, released after one draw.
- **Glass picks its picture per panel:** `static` reads the still, `dynamic` follows the video, absent reads dynamic, and themes may mix.
- **The editor offers both rows:** fallback frame only over a video, glass sampling always, since a background can change later.
- **Proof:** `npm run test` 461 files, 7036 passing, 1 skipped; typecheck and `biome check` exit 0; the still-sampling test red-proofed before restoring.

## Next

1. Apply the same audit to the rest of the app (`vg-780`).
2. Drain the backlog: a reproduction pass first, not a fix pass.
3. TURZX worktree copies the final `PanelVideo` contract, whose adapter uploads an MP4.
4. Triage the browser cases already red on this tree (`vg-773`–`vg-777`).

## Blockers / unverified

- **Static and dynamic glass are unproven on the panel:** the browser cases pass, but no fixture theme has been pushed with either setting.
- **Long panel runs are unmeasured:** minutes so far, and the encoder holds a whole clip in memory.
- **`StopPlay`'s resting picture is unknown:** whether the panel returns to its stored still or holds the last decoded frame.
- **No Kraken upload has run:** a wrong bucket setup is a documented route to firmware bootloader, so the write path stays unexercised.
- **`npm run test:e2e` collects nothing** (`vg-777`); run specs with `node node_modules/@playwright/test/cli.js test`.
