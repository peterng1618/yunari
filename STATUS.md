# Yunari status

Updated: 2026-10-25
Branch: `peterng1618/Build-systray`

## Current objective

The **system tray host** ([`spec`](docs/superpowers/specs/2026-10-25-systray-design.md), [`plan`](docs/superpowers/plans/2026-10-25-systray.md)) is in flight: run the host hidden at sign-in with a tray icon that opens the editor's existing surfaces, pairs a display, reports and starts installed external programs, and exits the host.

- **Active plan:** `docs/superpowers/plans/2026-10-25-systray.md`

## Active work

- **Task 1 (menu model) is done**; Phase 1 continues with external-program detection and the autostart entry.
- **Controller next:** the 5-second snapshot poll, action dispatch and 10-second notices are still to be built.
- **Windows adapter** renders the model through a hidden PowerShell WinForms `NotifyIcon` fed by JSON lines on stdin.
- **Linux adapter** stages the pinned `systray2@2.1.4` x86-64 binary; no new npm dependency and no runtime install.
- **External programs:** LHM and RTSS rows exist only when installed or running; RTSS starts only on an explicit click.
- **Deep links** reuse `?mode=`/`?publish=1` on the existing editor page, never a new route.

## Last completed change

- **Menu model added:** `host/src/tray/menu.ts` builds the status, Auto start, editor, external-program and Exit rows from a `TraySnapshot`.
- **External rows hide when absent** and share one `externalRow` label rule; separators appear only between non-empty groups.
- **Tooltip** repeats the status title, capped at Windows' 63 characters.
- **Tests:** 8 pass in `packages/host/src/tray/menu.test.ts`; hiding the rows makes the labelled cases fail.

## Next

1. Task 2: external-program presence and start, behind injected probes.
2. Task 3: controller polling, action dispatch and notices.
3. Task 4+: Windows and Linux adapters, autostart entry, editor deep links and `--tray` wiring.
4. Raise the stale AGENTS.md port range (4215–4237) with the user; 4239 and 4245 are now used.
5. Run a live adapter check with a game (RTSS or PresentMon) and a live Steam store lookup when the user can.

## Blockers / unverified

- **No live Steam store request:** the Phase 7 e2e uses a fixture; the endpoints were only probed by hand. No live frame or game reading either.
- **Player conversion and catalogue refresh:** a custom temperature key converts in the editor preview only (vg-717); a source added while the editor is open needs a reload (vg-722).
- **No live weather backend and no Windows Geolocator run**; fixtures and units are tested only.
- **Credential removal from the Sources page** is jsdom-tested only; jpg/webp media artwork is unverified.
- **Presence still reads every foreground process as a game** (vg-723), so a store lookup can be asked about a browser once per spelling.
