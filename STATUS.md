# Yunari status

Updated: 2026-10-29
Branch: `main`

## Current objective

The asset finder's UI/UX overhaul is complete, and the USB panel path now includes hardware video playback on the Lian Li 9.2" (`0134`). Next: the same audit across the rest of the app (`vg-780`).

## Active work

- **No plan is running:** the finder plan and the font-family-weights plan are complete; the backlog drain is next.
- **Panel video is live end to end:** the host resolves the assigned theme's video, the adapter encodes it, and the runner sends only the UI as a PNG overlay.
- **The panel's framing is the theme's:** the encoder applies the same cover, pan and zoom-floor rule as `scene-fabric`'s `placement`.
- **Playback loops from a background feed** because the vendor driver rewinds at end of file; block writes and overlay pushes share one endpoint lock.
- **`PanelVideo` + `PanelVideoPlacement` is the contract** the TURZX worktree should copy when its adapter lands.
- **The finder is one surface:** one frame, card, skeleton, control set and state vocabulary across every tab, with DESIGN.md §5 as the checklist for new ones.

## Last completed change

- **Panel video playback merged into main:** video themes play on the 9.2" at its own frame rate with the UI composited above them.
- **The encoder is corrected in three measured ways:** landscape crop before the clockwise turn, the authored pan inside the crop, and an endless feed instead of a one-shot write.
- **Verified on the attached panel:** upright video, upright overlay, looped past the clip's length, framing matching the editor.
- **Proof:** panel suite 66 passing; `npm run test` 455 files, 6977 passing, 1 skipped; typecheck and `biome check` exit 0.

## Next

1. Apply the same audit to the rest of the app (`vg-780`).
2. Drain the backlog: a reproduction pass first, not a fix pass.
3. TURZX worktree copies the final `PanelVideo` contract, whose adapter uploads an MP4.
4. Triage the browser cases already red on this tree (`vg-773`–`vg-777`).

## Blockers / unverified

- **Long panel runs are unmeasured:** minutes so far, and the encoder holds a whole clip in memory.
- **`StopPlay`'s resting picture is unknown:** whether the panel returns to its stored still or holds the last decoded frame.
- **No Kraken upload has run:** a wrong bucket setup is a documented route to firmware bootloader, so the write path stays unexercised.
- **L-Connect must stay stopped:** it relaunches on boot and holds the panel interface.
- **`npm run test:e2e` collects nothing** (`vg-777`); run specs with `node node_modules/@playwright/test/cli.js test`.
