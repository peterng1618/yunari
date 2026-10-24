# Yunari status

Updated: 2026-10-25
Branch: `peterng1618/Build-systray`

## Current objective

The **system tray host** ([`spec`](docs/superpowers/specs/2026-10-25-systray-design.md), [`plan`](docs/superpowers/plans/2026-10-25-systray.md)) is in flight: run the host hidden at sign-in with a tray icon that opens the editor's existing surfaces, pairs a display, reports and starts installed external programs, and exits the host.

- **Active plan:** `docs/superpowers/plans/2026-10-25-systray.md`

## Active work

- **Tasks 1–5 are done** (menu model, external programs, sign-in entry, both tray adapters); Phase 1 continues with the controller.
- **Controller next:** the 5-second snapshot poll, action dispatch and 10-second notices are still to be built.
- **Windows adapter** renders the model through a hidden PowerShell WinForms `NotifyIcon` fed by JSON lines on stdin.
- **Linux adapter** stages the pinned `systray2@2.1.4` x86-64 binary; no new npm dependency and no runtime install.
- **External programs:** LHM and RTSS rows exist only when installed or running; RTSS starts only on an explicit click.
- **Deep links** reuse `?mode=`/`?publish=1` on the existing editor page, never a new route.

## Last completed change

- **Linux tray:** `host/src/tray/linux.ts` drives the staged `systray2` x86-64 binary over JSON lines and maps a clicked `__id` through the current action map.
- **Vendoring:** `scripts/vendor-tray.mjs` checks the pinned SHA-256 before extraction and stages only the Linux binary and LICENSE under ignored `vendor/tray`.
- **View discipline:** one `onLost` per view and never after a rejected start; a lost view stops writing menus but `close()` still kills the process.
- **Tests:** 12 Linux tests; the staged binary is a 3.5 MB x86-64 ELF and `PROVENANCE.txt` carries the pinned digest.
- **Gates:** host typecheck, Biome, all tray tests and `status:check` exit 0.

## Next

1. Task 6+: the controller, editor deep links and `--tray` wiring.
2. Raise the stale AGENTS.md port range (4215–4237) with the user; 4239 and 4245 are now used.
3. Run a live adapter check with a game (RTSS or PresentMon) and a live Steam store lookup when the user can.

## Blockers / unverified

- **No live Steam store request:** the Phase 7 e2e uses a fixture; the endpoints were only probed by hand. No live frame or game reading either.
- **Player conversion and catalogue refresh:** a custom temperature key converts in the editor preview only (vg-717); a source added while the editor is open needs a reload (vg-722).
- **No live weather backend and no Windows Geolocator run**; fixtures and units are tested only.
- **Credential removal from the Sources page** is jsdom-tested only; jpg/webp media artwork is unverified.
- **Presence still reads every foreground process as a game** (vg-723), so a store lookup can be asked about a browser once per spelling.
