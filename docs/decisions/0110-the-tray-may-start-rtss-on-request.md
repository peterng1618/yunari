# 0110 — The tray may start RTSS on an explicit request

- **Date:** 2026-10-25
- **Status:** accepted 2026-10-25; amends
  [0107](0107-frame-statistics-come-from-rtss-then-presentmon.md)'s "never
  launch" clause. Every other finding in 0107 stands.
- **Paths:** `src/web/packages/host/src/tray/external-apps.ts`

## The problem

0107 chose to read RTSS's shared memory without launching it, because RTSS is
an overlay that hooks games and the controller had forbidden launching it. The
owner now wants a tray row that reports whether RTSS is running and can start
it. That is a new mechanism boundary: the wrong shape either starts RTSS
automatically, claims ownership of a process the owner started, or turns a
status row into something that silently changes every game on the machine.

What has to be decided is narrow: when may Yunari launch RTSS, what may it do
afterwards, and what must it never do. Reading frames is unchanged.

## Rung 1 — Yunari

Searched: `rg -n -i "rtss|rivatuner"` across the repo (excluding `dist`,
`node_modules`, `vendor`); the frame provider tree; the tray work in this
spec.

Found: `RtssAdapter` in `providers/frame/rtss.ts` reads the mapping under the
0102 supervisor and reports `RTSS_NOT_RUNNING` when the process is absent.
`FrameProvider` starts adapters only while a display binds `frame.*`. No code
starts, stops or configures RTSS. There is no tray owner yet. There is no
process-status helper for an external program.

## Rung 2 — dependencies

Searched: `packages/host/package.json`; `npm ls`; the new tray modules'
proposed dependencies.

Found: no process-control, overlay, RTSS or game-hook package. The host's
runtime dependencies remain `ffmpeg-static`, `node-forge` and
`systeminformation`. A process check and a detached spawn need no package.

## Rung 3 — platform

Searched: Windows process APIs available to Node; the installed RTSS tree.

Found: `spawn` starts a GUI executable without a shell; `tasklist
/FI "IMAGENAME eq RTSS.exe" /FO CSV /NH` reports whether it runs. RTSS's
standard install is `C:\Program Files (x86)\RivaTuner Statistics Server\
RTSS.exe`; a 64-bit or portable install can be named with `--rtss-exe`.
Neither API injects, hooks or elevates. RTSS needs no elevation to start as
the logged-in owner. What the platform leaves to us: deciding who owns the
process, when it may start, and whether Yunari may stop it.

## Rung 4 — ecosystem

Searched:
- `rg -n -i "rtss|rivatuner|Start-Process"` in the 9remote and 9router
  checkouts used for the tray design.
- `npm search rtss`, `npm search rivatuner` (live).
- 0107's recorded searches for RTSS readers and PresentMon.

Found:
- 9remote and 9router have no RTSS control. Their process launching is for
  their own server and tunnel, and their tray does not manage third-party
  overlays.
- `npm search rtss` returns `@stablelib/tss` (threshold secret sharing),
  DICOM RT packages, and an RT scheduler. `npm search rivatuner` returns
  nothing. No package starts or supervises RTSS.
- 0107 found only shared-memory readers (`RTSSSharedMemoryNET`,
  `rtss-shared-memory-reader`, `rtss-reader`). They read; they do not start.
- The common pattern in the wild is the owner starting RTSS from its own
  shortcut or letting MSI Afterburner start it. Nobody solves the ownership
  question for us, which is the part that matters here.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Detached `spawn` on an explicit tray click | Starts only what the owner asked for; Yunari never owns or stops it; no dependency | A path lookup and one process check | The overlay hooks games, which the owner accepted; a game already running may not attach | Chosen |
| Auto-start RTSS with the host | No click needed | Removes the owner's choice; starts a game overlay at every sign-in | Changes every game on the machine without a request | Rejected |
| `schtasks` or a service | Could start elevated or at sign-in | A persistent OS entry outside RTSS's own installer | Yunari would own a third-party overlay's lifetime and settings | Rejected |
| Shell out to `Start-Process` | Same result as `spawn` | An extra PowerShell process and quoting surface | No gain over `spawn`; a console-capable host is started for a GUI app | Rejected |
| Inject or hook the game ourselves | Would remove RTSS's overlay | Out of scope and against the product's boundary | Anti-cheat and integrity risk | Rejected |

## Rung 6 — probe

Probe on this PC, 2026-10-25:

- `C:\Program Files (x86)\RivaTuner Statistics Server\RTSS.exe` exists.
- `Get-Process -Name RTSS` finds no process, so RTSS is installed and not
  running.
- The 0107 probe already established the shared-memory layout and that the
  adapter reports absence honestly.
- The Start action itself was **not** run during design: launching a game
  overlay is a visible change to the owner's machine and no game was running.
  The spawn shape is `spawn(exe, [], { detached: true, stdio: "ignore",
  windowsHide: true }).unref()`, which starts the executable and releases it.

The probe establishes presence and absence. It does not establish that starting
this RTSS build attaches to a running game; that is unverified until a live run.

## Decision

The tray may start RTSS **only** when the owner clicks its Start row.

- The row appears only when RTSS is installed or running.
- It is disabled while RTSS is running; the row reports the process, not a
  game-attachment guarantee.
- Start is a detached spawn of the installed executable, with no shell, no
  arguments and no elevation request.
- Yunari never auto-starts RTSS, never injects into a process, never hooks a
  game, never changes RTSS settings, and never stops RTSS on Exit.
- The existing frame reader and its `RTSS_NOT_RUNNING` report are unchanged;
  starting RTSS only removes the absence the adapter already reports.
- `--rtss-exe` names a non-standard install. A named path that does not exist
  is reported and the row is hidden rather than guessed.
