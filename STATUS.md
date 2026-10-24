# Yunari status

Updated: 2026-10-25
Branch: `peterng1618/Build-systray`

## Current objective

The **system tray host** ([`spec`](docs/superpowers/specs/2026-10-25-systray-design.md), [`plan`](docs/superpowers/plans/2026-10-25-systray.md)) is in flight: run the host hidden at sign-in with a tray icon that opens the editor's existing surfaces, pairs a display, reports and starts installed external programs, and exits the host.

- **Active plan:** `docs/superpowers/plans/2026-10-25-systray.md`

## Active work

- **Tasks 1–11 are done**; all three phases complete, with the live acceptance run and plan close-out outstanding.
- **Controller** polls every 5 s, sends only a changed menu or tooltip, dispatches clicks and shows action or snapshot failures as 10 s notices.
- **Windows adapter** renders the model through a hidden PowerShell WinForms `NotifyIcon` fed by JSON lines on stdin.
- **Linux adapter** stages the pinned `systray2@2.1.4` x86-64 binary; no new npm dependency and no runtime install.
- **External programs:** LHM and RTSS rows exist only when installed or running; RTSS starts only on an explicit click.
- **Tray host:** `--tray` starts the tray after the server answers and stops the host from Exit, tray loss or a signal through one idempotent `stopHost`.

## Last completed change

- **SMTC no-session line:** an empty WinRT session vector exposes no `Count`, so `$sessions.Count -eq 0` never fired and the poll emitted neither `none` nor sessions; it now tests `-not ($sessions.Count -gt 0)`.
- **Verification:** `smtc-helper.windows.test.ts` passes 9 with 1 self-skip (artwork needs a live session); full `npm run gate` exits 0.

## Next

1. A live tray run by the owner: inspect the menu's rows, toggle Auto start, open each editor surface, start RTSS, and Exit.
2. Run the staged Linux tray binary on a Linux desktop session; it was never executed here.
3. Raise the stale AGENTS.md port range (4215–4237) with the user; 4239 and 4245 are now used.

## Blockers / unverified

- **No live Steam store request:** the Phase 7 e2e uses a fixture; the endpoints were only probed by hand. No live frame or game reading either.
- **No live weather backend and no Windows Geolocator run**; fixtures and units are tested only.
- **Credential removal from the Sources page** is jsdom-tested only; jpg/webp media artwork is unverified.
- **Tray menu visuals and clicks** are not verified by the agent; only live start, helper-child and termination evidence exists.
- **Editor gaps:** a custom temperature key converts in the preview only (vg-717); a source added while the editor is open needs a reload (vg-722); presence reads every foreground process as a game (vg-723).
