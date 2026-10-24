# Yunari status

Updated: 2026-10-25
Branch: `main`

## Current objective

Drain `docs/product/backlog.jsonl`: the queued [`spec`](docs/superpowers/specs/2026-10-12-the-backlog-drain-design.md) and [`plan`](docs/superpowers/plans/2026-10-12-the-backlog-drain.md) close the rows the reproduction pass proved discharged, take the rulings the register waits on, then do the real work; 244 rows carry `state: "open"`.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-12-the-backlog-drain.md` — queued, not started; no task dispatched.
- **Release readiness is closed:** spec `2026-10-25-release-readiness-design.md` is landed, plan archived, and nothing in it waits on a task.
- **Game identity is closed:** [`spec`](docs/superpowers/specs/2026-10-24-game-identity-and-display-catalogue-design.md), plan archived, decision [0110](docs/decisions/0110-game-identity-is-a-local-catalogue-match.md).
- **`vg-724` is open for art only:** naming for Steam, Epic, GOG, itch, Xbox and GDK Store packages landed; catalogue-matched non-Steam titles still report no artwork.
- **Windows-first boundary:** Linux catalogue readers and foreground detection are out of scope (spec D4) and owned by `vg-727`.
- **System tray merged:** [`spec`](docs/superpowers/specs/2026-10-25-systray-design.md) and plan are landed; the rows, clicks and the staged Linux binary still need a live run.

## Last completed change

- **System tray merged:** host-owned tray with a Windows WinForms adapter, a staged Linux `systray2@2.1.4` binary, external-program rows, sign-in autostart, editor deep links and `--tray`.
- **Register merged by id:** main's `vg-727`, `vg-724`, `vg-728` and `vg-729` stand; the branch's `vg-726` was dropped because main had already verified it at `15978c51`.
- **Decision notes renumbered:** the tray notes became 0114 (RTSS on request) and 0115 (host-owned shell), leaving main's 0110 and 0111 in place.
- **SMTC fix superseded:** main's array materialisation in `POLL` replaced the branch's test change; `smtc-helper.windows.test.ts` passes with the merged code.
- **Merged gate:** 408 files and 5963 tests pass with 1 skipped, Worker 73; `status:check`, `docs:check` and `backlog:check` exit 0.

## Next

1. A live tray run by the owner: inspect the menu's rows, toggle Auto start, open each editor surface, start RTSS, and Exit.
2. Run the staged Linux tray binary on a Linux desktop session; it was never executed here.
3. Work `vg-724`'s art half: local art for catalogue-matched non-Steam titles.
4. Work `vg-727`, `vg-728` and `vg-729`: Linux presence, the renamed Worker test plugin and the jsdom 30 DOM cases.
5. Start the backlog-drain plan at Phase 0.

## Blockers / unverified

- **The publish path is unverified end to end:** no workflow dispatch, no trusted-publisher run and no first publish, which stays a one-time local token publish; the release-token choice is open.
- **No real N−1 migration is exercised:** at `2.0.0` the only older shape is the legacy integer; the dispatcher is a forward obligation.
- **No live fullscreen game check:** window evidence is unit-tested through injected readings and a fixed foreground seam.
- **Epic, itch, Xbox and Store readers are fixture-tested only**, and both live Steam reads stay fixture-tested.
- **Two dependency deviations remain:** `ffmpeg-static` installs with scripts but no playback was exercised, and `npm ls` marks the overridden edges `invalid`.
