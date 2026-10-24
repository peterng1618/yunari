# Yunari status

Updated: 2026-10-25
Branch: `peterng1618/Build-systray`

## Current objective

The **system tray host** ([`spec`](docs/superpowers/specs/2026-10-25-systray-design.md), [`plan`](docs/superpowers/plans/2026-10-25-systray.md)) is in flight: run the host hidden at sign-in with a tray icon that opens the editor's existing surfaces, pairs a display, reports and starts installed external programs, and exits the host.

- **Active plan:** `docs/superpowers/plans/2026-10-25-systray.md`

## Active work

- **Tasks 1–2 are done** (menu model, external programs); Phase 1 continues with the autostart entry.
- **Controller next:** the 5-second snapshot poll, action dispatch and 10-second notices are still to be built.
- **Windows adapter** renders the model through a hidden PowerShell WinForms `NotifyIcon` fed by JSON lines on stdin.
- **Linux adapter** stages the pinned `systray2@2.1.4` x86-64 binary; no new npm dependency and no runtime install.
- **External programs:** LHM and RTSS rows exist only when installed or running; RTSS starts only on an explicit click.
- **Deep links** reuse `?mode=`/`?publish=1` on the existing editor page, never a new route.

## Last completed change

- **External programs:** `host/src/tray/external-apps.ts` detects LHM and RTSS on Windows and starts them on request.
- **LHM** starts through `launchLhm`, keeps its stop on every result, and only an in-flight launch blocks a retry.
- **RTSS probes before spawning** and has no stop; failed probes read as absent, and both programs are absent off Windows.
- **Tests:** 12 pass in `packages/host/src/tray/external-apps.test.ts`.

## Next

1. Task 3: controller polling, action dispatch and notices.
2. Task 4+: Windows and Linux adapters, autostart entry, editor deep links and `--tray` wiring.
3. Raise the stale AGENTS.md port range (4215–4237) with the user; 4239 and 4245 are now used.
4. Run a live adapter check with a game (RTSS or PresentMon) and a live Steam store lookup when the user can.

## Blockers / unverified

- **No live Steam store request:** the Phase 7 e2e uses a fixture; the endpoints were only probed by hand. No live frame or game reading either.
- **Player conversion and catalogue refresh:** a custom temperature key converts in the editor preview only (vg-717); a source added while the editor is open needs a reload (vg-722).
- **No live weather backend and no Windows Geolocator run**; fixtures and units are tested only.
- **Credential removal from the Sources page** is jsdom-tested only; jpg/webp media artwork is unverified.
- **Presence still reads every foreground process as a game** (vg-723), so a store lookup can be asked about a browser once per spelling.
