# Yunari status

Updated: 2026-10-25
Branch: `main`

## Current objective

Build the type-and-asset authoring rework: the queued [`spec`](docs/superpowers/specs/2026-10-25-fonts-and-assets-design.md) and [`plan`](docs/superpowers/plans/2026-10-25-fonts-and-assets.md) add the Assets rail pane, host font sources, the finder preview, explicit preset actions and opt-in cleanup.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-25-fonts-and-assets.md` — executing Phase 4; Tasks 1–9 complete, Task 10 next.
- **Queued:** `docs/superpowers/plans/2026-10-12-the-backlog-drain.md`, with 244 rows still `open`.
- **Release readiness is closed:** spec `2026-10-25-release-readiness-design.md` is landed, plan archived, and nothing in it waits on a task.
- **Game identity is closed:** [`spec`](docs/superpowers/specs/2026-10-24-game-identity-and-display-catalogue-design.md), plan archived, decision [0110](docs/decisions/0110-game-identity-is-a-local-catalogue-match.md).
- **System tray merged:** [`spec`](docs/superpowers/specs/2026-10-25-systray-design.md) and plan are landed; the rows, clicks and the staged Linux binary still need a live run.
- **`vg-724` is open for art only:** naming for Steam, Epic, GOG, itch, Xbox and GDK Store packages landed; catalogue-matched non-Steam titles still report no artwork.

## Last completed change

- **Task 9 landed:** the declared-asset library lives in the Assets pane; import routes by kind and intent, and a font is refused as a background.
- **`file-section.tsx` is gone:** video normalization, replace, remove, both refusals and the `changed()` notifier moved to the pane rather than being dropped.
- **Placed files now land at the canvas centre** through Fabric's `centerObject`, and the pane's count follows every declaration change, including trio and preset-face adoption.
- **`vg-731` is the one expected red:** no drawing names `yunari-asset-preview` since `775e2f54`, and the parity spec now says so.
- **Evidence:** editor 185 files / 2582 tests, typecheck and biome exit 0; editor-rail 34 passed, and `packaged images` green.

## Next

1. Execute the fonts-and-assets plan, Phase 1 through Phase 7, one task per dispatch.
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
