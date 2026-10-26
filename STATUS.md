# Yunari status

Updated: 2026-10-26
Branch: `peterng1618/fix-font-trio`

## Current objective

Build the type-and-asset authoring rework: the queued [`spec`](docs/superpowers/specs/2026-10-25-fonts-and-assets-design.md) and [`plan`](docs/superpowers/plans/2026-10-25-fonts-and-assets.md) add the Assets rail pane, host font sources, the finder preview, explicit preset actions and opt-in cleanup.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-25-fonts-and-assets.md` — Tasks 1–22 complete; the branch review and plan close remain.
- **Queued:** `docs/superpowers/plans/2026-10-12-the-backlog-drain.md`, with 244 rows still `open`.
- **Release readiness is closed:** spec `2026-10-25-release-readiness-design.md` is landed, plan archived, and nothing in it waits on a task.
- **Game identity is closed:** [`spec`](docs/superpowers/specs/2026-10-24-game-identity-and-display-catalogue-design.md), plan archived, decision [0110](docs/decisions/0110-game-identity-is-a-local-catalogue-match.md).
- **System tray merged:** [`spec`](docs/superpowers/specs/2026-10-25-systray-design.md) and plan are landed; the rows, clicks and the staged Linux binary still need a live run.
- **`vg-724` is open for art only:** naming for Steam, Epic, GOG, itch, Xbox and GDK Store packages landed; catalogue-matched non-Steam titles still report no artwork.

## Last completed change

- **Tasks 20–21 landed:** the asset preview draws the Finder's box and the store viewer 960×760, both with a 270px panel and one shared `ActionBox`.
- **The item modal's state badge moved off the name's row** — two badges took "Withdrawn theme" down to "Withd…" in the 238px header.
- **Evidence:** `npm run gate` exit 0 — unit 414 files / 6067 tests (1 skipped), worker 12 / 73; three registered captures recaptured and inspected, and the preview gained a browser case.
- **Gate repairs:** the curated font source formatted, the mockup row follows the redrawn shell drawing, and the preview assertion stopped spelling a px literal.
- **Rows:** `vg-735` filed (a finder credit carries no `assetId`), `vg-734` closed.

## Next

1. Run the whole-branch review, then close the fonts-and-assets plan and archive it.
2. A live tray run by the owner: inspect the menu's rows, toggle Auto start, open each editor surface, start RTSS, and Exit.
3. Run the staged Linux tray binary on a Linux desktop session; it was never executed here.
4. Work `vg-724`'s art half and `vg-727`, `vg-728`, `vg-729`.
5. Resume the backlog-drain plan at Phase 0 when the active plan closes.

## Blockers / unverified

- **The publish path is unverified end to end:** no workflow dispatch, no trusted-publisher run and no first publish, which stays a one-time local token publish; the release-token choice is open.
- **No real N−1 migration is exercised:** at `2.0.0` the only older shape is the legacy integer; the dispatcher is a forward obligation.
- **No live fullscreen game check:** window evidence is unit-tested through injected readings and a fixed foreground seam.
- **Epic, itch, Xbox and Store readers are fixture-tested only**, and both live Steam reads stay fixture-tested.
- **Two dependency deviations remain:** `ffmpeg-static` installs with scripts but no playback was exercised, and `npm ls` marks the overridden edges `invalid`.
