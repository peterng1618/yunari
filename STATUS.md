# Yunari status

Updated: 2026-10-25
Branch: `main`

## Current objective

Build the type-and-asset authoring rework: the queued [`spec`](docs/superpowers/specs/2026-10-25-fonts-and-assets-design.md) and [`plan`](docs/superpowers/plans/2026-10-25-fonts-and-assets.md) add the Assets rail pane, host font sources, the finder preview, explicit preset actions and opt-in cleanup.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-25-fonts-and-assets.md` — executing Phase 4; Tasks 1–16 complete, Task 17 (unused assets and opt-in cleanup) next.
- **Queued:** `docs/superpowers/plans/2026-10-12-the-backlog-drain.md`, with 244 rows still `open`.
- **Release readiness is closed:** spec `2026-10-25-release-readiness-design.md` is landed, plan archived, and nothing in it waits on a task.
- **Game identity is closed:** [`spec`](docs/superpowers/specs/2026-10-24-game-identity-and-display-catalogue-design.md), plan archived, decision [0110](docs/decisions/0110-game-identity-is-a-local-catalogue-match.md).
- **System tray merged:** [`spec`](docs/superpowers/specs/2026-10-25-systray-design.md) and plan are landed; the rows, clicks and the staged Linux binary still need a live run.
- **`vg-724` is open for art only:** naming for Steam, Epic, GOG, itch, Xbox and GDK Store packages landed; catalogue-matched non-Steam titles still report no artwork.

## Last completed change

- **Task 16 landed:** a font pick opens an inline metadata form and declares nothing; the file is written at Create type preset or Cancel.
- **Create type preset** writes one preset through `addTypePresetFromLocalFont` and a credit carrying the `assetId`, after the cap check; Cancel declares the file without either.
- **`importFont` validates bytes through the browser's own `FontFace`** (injectable loader for jsdom) and writes family/weight/style/format/licence/source URL; `amendFont` rewrites them in place.
- **The filename parser peels style and weight tokens from the end** (`Inter-Bold.ttf` → Inter / 700); the form refuses an empty family or a weight outside 120–900.
- **Evidence:** 2566 editor tests, focused files 113, typecheck/biome/design-tokens exit 0, `editor.spec.ts` 70 passed / 70 skipped / 0 unexpected; dead-selectors exits 1 with 16 pre-existing findings, none naming a changed file.

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
