# Yunari status

Updated: 2026-10-25
Branch: `peterng1618/Build-systray`

## Current objective

The **system tray host** ([`spec`](docs/superpowers/specs/2026-10-25-systray-design.md), [`plan`](docs/superpowers/plans/2026-10-25-systray.md)) is in flight: run the host hidden at sign-in with a tray icon that opens the editor's existing surfaces, pairs a display, reports and starts installed external programs, and exits the host.

- **Active plan:** `docs/superpowers/plans/2026-10-25-systray.md`

## Active work

- **Tasks 1–10 are done** (menu model, external programs, sign-in entry, both tray adapters, controller, CLI flags, console-free opener, host wiring, editor deep links); Phases 1–2 complete, Phase 3 in flight.
- **Controller** polls every 5 s, sends only a changed menu or tooltip, dispatches clicks and shows action or snapshot failures as 10 s notices.
- **Windows adapter** renders the model through a hidden PowerShell WinForms `NotifyIcon` fed by JSON lines on stdin.
- **Linux adapter** stages the pinned `systray2@2.1.4` x86-64 binary; no new npm dependency and no runtime install.
- **External programs:** LHM and RTSS rows exist only when installed or running; RTSS starts only on an explicit click.
- **Tray host:** `--tray` starts the tray after the server answers and stops the host from Exit, tray loss or a signal through one idempotent `stopHost`.

## Last completed change

- **Deep links:** `shell-entry.ts` reads `mode=themes|this-pc` and `publish=1`, and any other mode value opens the editor.
- **Shell wiring:** `ShellRoot` opens on the parsed mode; one mount effect opens the existing publish surface, and `publish=1` is ignored where another mode is named.
- **Unit:** `shell-entry.test.ts` pins six query cases; the red proof (defaults unconditionally) failed 4 of 6.
- **Browser:** `editor-deep-links.spec.ts` drives the 4174 preview with `index.json`, `/api/themes` and `/api/hosting` stubbed; red proof failed 3 of 5, restored run 5 pass.
- **Gates:** editor and e2e typecheck 0, biome 0 on the four files, `shell-layout.dom` 38 pass; editor, player and host bundles rebuilt for the preview.

## Next

1. Task 11: documentation, notices and the full gate.
2. Raise the stale AGENTS.md port range (4215–4237) with the user; 4239 and 4245 are now used.
3. Run a live adapter check with a game (RTSS or PresentMon) and a live Steam store lookup when the user can.

## Blockers / unverified

- **No live Steam store request:** the Phase 7 e2e uses a fixture; the endpoints were only probed by hand. No live frame or game reading either.
- **No live weather backend and no Windows Geolocator run**; fixtures and units are tested only.
- **Credential removal from the Sources page** is jsdom-tested only; jpg/webp media artwork is unverified.
- **Tray menu visuals and clicks** are not verified by the agent; only live start, helper-child and termination evidence exists.
- **Editor gaps:** a custom temperature key converts in the preview only (vg-717); a source added while the editor is open needs a reload (vg-722); presence reads every foreground process as a game (vg-723).
