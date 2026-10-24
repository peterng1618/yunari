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
- **Two rows filed by this merge:** `vg-728` (Worker test toolchain still on `@cloudflare/vitest-pool-workers`) and `vg-729` (jsdom 30 breaks 8 editor DOM cases).

## Last completed change

- **Release readiness merged:** schema `2.0.0` with the previous major migrated on read, an audit policy that fails closed, a staged npm package, release-please and the publish workflow, and a rewritten README.
- **Register merged by id:** `vg-728` and `vg-729` filed; `vg-717`, `vg-723` and `vg-726` dropped from the branch's copy because main had already verified them.
- **Decision notes renumbered:** 0112 (migrate the previous major on open) and 0113 (stage the workspace) leave main's 0110 and 0111 in place.
- **Branch gate at `c24a166b`:** 385 of 386 files and 5739 of 5741 tests; both failures are the known live-SMTC cases.
- **`status:check`, `docs:check` and `backlog:check` exit 0** after the resolution.

## Next

1. Work `vg-724`'s art half: local art for catalogue-matched non-Steam titles.
2. Work `vg-727`: a Linux foreground source plus the Linux catalogue readers and their fixtures.
3. Work `vg-728` and `vg-729`: the renamed Worker test plugin and the jsdom 30 DOM cases.
4. Start the backlog-drain plan at Phase 0.

## Blockers / unverified

- **The publish path is unverified end to end:** no workflow dispatch, no trusted-publisher run and no first publish, which stays a one-time local token publish; the release-token choice is open.
- **No real N−1 migration is exercised:** at `2.0.0` the only older shape is the legacy integer; the dispatcher is a forward obligation.
- **No live fullscreen game check:** window evidence is unit-tested through injected readings and a fixed foreground seam.
- **Epic, itch, Xbox and Store readers are fixture-tested only**, and both live Steam reads stay fixture-tested.
- **Two dependency deviations remain:** `ffmpeg-static` installs with scripts but no playback was exercised, and `npm ls` marks the overridden edges `invalid`.
