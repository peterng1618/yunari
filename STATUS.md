# Yunari status

Updated: 2026-10-25
Branch: `peterng1618/Build-systray`

## Current objective

The **system tray host** ([`spec`](docs/superpowers/specs/2026-10-25-systray-design.md), [`plan`](docs/superpowers/plans/2026-10-25-systray.md)) is in flight: run the host hidden at sign-in with a tray icon that opens the editor's existing surfaces, pairs a display, reports and starts installed external programs, and exits the host.

- **Active plan:** `docs/superpowers/plans/2026-10-25-systray.md`

## Active work

- **Tasks 1–3 are done** (menu model, external programs, sign-in entry); Phase 1 continues with the Windows tray.
- **Controller next:** the 5-second snapshot poll, action dispatch and 10-second notices are still to be built.
- **Windows adapter** renders the model through a hidden PowerShell WinForms `NotifyIcon` fed by JSON lines on stdin.
- **Linux adapter** stages the pinned `systray2@2.1.4` x86-64 binary; no new npm dependency and no runtime install.
- **External programs:** LHM and RTSS rows exist only when installed or running; RTSS starts only on an explicit click.
- **Deep links** reuse `?mode=`/`?publish=1` on the existing editor page, never a new route.

## Last completed change

- **Sign-in entry:** `host/src/serve/host-autostart.ts` owns a hidden `Yunari.vbs` on Windows and an XDG autostart entry on Linux, and removes the legacy `YunariHost` task first.
- **Hidden and readable:** the VBS is UTF-16LE with a BOM, so a non-ASCII path is not mojibake; an empty `APPDATA`/`XDG_CONFIG_HOME` counts as unset, never a relative path.
- **`hostEntry`** starts the same host with `--tray -n`; a trailing backslash is doubled so the appended flags survive, and the server's `registerAutostart` calls `autostart.enable(entry)`.
- **Tests:** 14 in `packages/host/src/serve/host-autostart.test.ts`; 29 pass across both serve suites, `@yunari/host` typecheck, Biome and `status:check` exit 0.

## Next

1. Task 4: Windows tray and icon.
2. Task 5+: Linux adapter, editor deep links and `--tray` wiring.
3. Raise the stale AGENTS.md port range (4215–4237) with the user; 4239 and 4245 are now used.
4. Run a live adapter check with a game (RTSS or PresentMon) and a live Steam store lookup when the user can.

## Blockers / unverified

- **No live Steam store request:** the Phase 7 e2e uses a fixture; the endpoints were only probed by hand. No live frame or game reading either.
- **Player conversion and catalogue refresh:** a custom temperature key converts in the editor preview only (vg-717); a source added while the editor is open needs a reload (vg-722).
- **No live weather backend and no Windows Geolocator run**; fixtures and units are tested only.
- **Credential removal from the Sources page** is jsdom-tested only; jpg/webp media artwork is unverified.
- **Presence still reads every foreground process as a game** (vg-723), so a store lookup can be asked about a browser once per spelling.
