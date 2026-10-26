# Yunari status

Updated: 2026-10-26
Branch: `peterng1618/fix-font-trio`

## Current objective

Build the type-and-asset authoring rework: the [`spec`](docs/superpowers/specs/2026-10-25-fonts-and-assets-design.md) and [`plan`](docs/superpowers/plans/archive/2026-10-25-fonts-and-assets.md) add the Assets rail pane, host font sources, the finder preview, explicit preset actions and opt-in cleanup — all landed.

## Active work

- **No plan is running:** `2026-10-25-fonts-and-assets` is complete and archived; `superpowers:finishing-a-development-branch` owns the merge and push, which need the owner.
- **Queued:** `docs/superpowers/plans/2026-10-12-the-backlog-drain.md`, with 259 rows still `open`.
- **Release readiness is closed:** spec `2026-10-25-release-readiness-design.md` is landed, plan archived, and nothing in it waits on a task.
- **Game identity is closed:** [`spec`](docs/superpowers/specs/2026-10-24-game-identity-and-display-catalogue-design.md), plan archived, decision [0110](docs/decisions/0110-game-identity-is-a-local-catalogue-match.md).
- **System tray merged:** [`spec`](docs/superpowers/specs/2026-10-25-systray-design.md) and plan are landed; the rows, clicks and the staged Linux binary still need a live run.
- **`vg-724` is open for art only:** naming for Steam, Epic, GOG, itch, Xbox and GDK Store packages landed; catalogue-matched non-Steam titles still report no artwork.

## Last completed change

- **The fonts-and-assets plan is closed:** the spec now states the two facts the code settled (no `subset` field, no catalogue description) and the plan moved to `archive/`.
- **Nine ledger carries are filed** as `vg-737`–`vg-745`, each re-verified at HEAD before writing — two carried claims were stale and dropped.
- **Register and docs:** `npm run backlog:check` exit 0, 745 items across both registers, all valid; spec header cites the archived plan.
- **Evidence:** `npm run gate` exit 0 on the final tree — unit 414 files / 6074 tests (1 skipped), worker 12 files / 73.
- **Captures:** three registered store captures recaptured and inspected; the eleven beside the drawings are stale and filed as `vg-745`.

## Next

1. Run `superpowers:finishing-a-development-branch` on `peterng1618/fix-font-trio`: the merge into `develop` and any push are the owner's call.
2. A live tray run by the owner: inspect the menu's rows, toggle Auto start, open each editor surface, start RTSS, and Exit.
3. Run the staged Linux tray binary on a Linux desktop session; it was never executed here.
4. Work `vg-724`'s art half and `vg-727`, `vg-728`, `vg-729`.
5. Resume the backlog-drain plan at Phase 0 now that nothing else is running.

## Blockers / unverified

- **The publish path is unverified end to end:** no workflow dispatch, no trusted-publisher run and no first publish, which stays a one-time local token publish; the release-token choice is open.
- **No real N−1 migration is exercised:** at `2.0.0` the only older shape is the legacy integer; the dispatcher is a forward obligation.
- **No live fullscreen game check:** window evidence is unit-tested through injected readings and a fixed foreground seam.
- **Epic, itch, Xbox and Store readers are fixture-tested only**, and both live Steam reads stay fixture-tested.
- **Two dependency deviations remain:** `ffmpeg-static` installs with scripts but no playback was exercised, and `npm ls` marks the overridden edges `invalid`.
