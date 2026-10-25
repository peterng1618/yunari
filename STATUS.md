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

- **Colour and gradient presets are chips:** both libraries draw a small swatch chip with the name as its programmatic label, wrapped in reading order (decision 0116, DESIGN §5).
- **A gradient stop shows its selection and opens its picker:** the chosen mark takes the accent border; a press that does not travel opens the stop's picker while a drag still adjusts it.
- **Rotated gradient paint follows its angle:** `gradientLine` flips the y component for the stored `90 - cssDegrees` convention, fixing the canvas plate and the glass backdrop sampling together.
- **Picker sampling costs less:** one channel change per pointer sample, one dirty reading per document change, and a chart redraw only when the palette ink it reads moves.
- **Evidence:** 121 focused tests green; browser checks read 12 colour chips in two rows, the picker open from a pressed stop, and a vertical sweep at angle 90 with no background media.

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
