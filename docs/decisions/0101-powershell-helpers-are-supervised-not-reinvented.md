# 0101 — PowerShell helpers run under one supervisor, with the script embedded

- **Date:** 2026-10-24
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/providers/helpers/`

## The problem

Three features need Windows-only data that no Node API reaches: the current
media session (SMTC), one geolocation fix when a place has not been chosen, and
frame statistics from RTSS/PresentMon. Each is a long-running or one-shot
external process that can hang, print an unbounded line, exit with a code, and
leave children behind when stopped. Getting the lifecycle wrong is invisible
until the machine has a dozen orphaned `powershell.exe` processes — the exact
shape AGENTS.md calls a mechanism boundary.

## Rung 1 — Yunari

Searched: `providers/lhm-launcher.ts`, `transport/sse.ts`, `assets/routes.ts`.

Found: a launcher, not a supervisor. `launchChild`/`launchLhm` spawn one process,
wait for exit, and call `child.kill()` — no stdout framing, no restart, no
backoff, no tree kill, and it deliberately covers one program whose elevation
behaviour is special. Nothing else spawns processes. There is no line framing
outside SSE, which reads HTTP bodies rather than child output.

## Rung 2 — dependencies

Searched: installed packages for process supervision and PowerShell.

Found: `node:child_process` only. No `execa`, no `node-powershell`, no
`node-windows`.

## Rung 3 — platform

Searched: `node:child_process` `spawn`/`kill`, `taskkill`, Windows PowerShell
5.1, `Windows.Devices.Geolocation`.

Found: `spawn` gives pipes and a pid; stopping a tree needs `taskkill /T /F`
(a `.kill()` leaves the helper's own child processes). PowerShell 5.1 accepts
`-EncodedCommand` (UTF-16LE base64), which removes quoting from the argument
surface entirely. `Geolocator` is reachable from PowerShell through WinRT.

What the platform leaves to the caller: restart policy, backoff, a line cap, a
per-request timeout, and the decision of which process to kill. That is the
undischarged work.

## Rung 4 — ecosystem

Searched: "node spawn child process restart backoff line buffering", "node-powershell",
"execa", "node-windows", "windows geolocation npm".

Found: `execa` is a careful wrapper around `spawn` with better errors and
promise semantics, but it does not own restart, line caps or tree kill — the
parts this needs. `node-powershell` shells out to the same PowerShell with a
`.ps1` or inline command and has had no release since 2020; it adds an
unmaintained dependency for argument quoting that `-EncodedCommand` already
solves. `node-windows` is a service manager, not a supervisor. There is no
maintained npm package for the Windows location API; every example reaches it
through PowerShell or a native addon (a build toolchain this repo does not
have).

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Extend `lhm-launcher.ts` | Shares spawn plumbing | Its elevation logic is specific; adding streaming/restart muddles one program's launcher | A future LHM change reaches the helpers | Rejected |
| `execa` | Better errors | New dependency; still needs restart, cap, tree kill | Unnecessary | Rejected |
| `node-powershell` | PowerShell-shaped API | Unmaintained; adds quoting that is already solved | Abandoned dependency in a shipped product | Rejected |
| Native addon for location | Direct API | MSVC toolchain, per-Node ABI | Unbuildable for consumers | Rejected |
| `node:child_process` supervisor, ~150 lines | Owns every rule that matters | Written here | Line cap, backoff and tree kill need tests | **Chosen** |

## Rung 6 — probe

On this machine (Windows 11 22631, PowerShell 10.0.22621.1):

- `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` exists.
- An `-EncodedCommand` carrying
  `[Windows.Devices.Geolocation.Geolocator,Windows.Devices.Geolocation,ContentType=WindowsRuntime]`
  printed `geolocator_type_ok` and exited 0 — the type loads without a
  permission prompt. `RequestAccessAsync` was **not** called: that prompt is a
  user-facing side effect and the permission path stays unverified until the
  user runs it.

## Decision

One supervisor in `providers/helpers/` owns every PowerShell child:
`spawn` with the explicit absolute path and `-EncodedCommand`, stdout split into
lines with a 1 MiB cap (over-cap is dropped and reported, never buffered),
stderr treated the same way, restart with capped exponential backoff on an
unexpected exit, and `taskkill /T /F` on stop so no grandchild survives. The
script is a string constant in the module, never a loose `.ps1` — an embedded
script cannot be edited out from under a running host, and there is then no
path to resolve.

The location helper is the first consumer: one JSON line, denial and timeout
reported as reasons rather than silence. Media (Phase 4) and frames (Phase 6)
reuse the same supervisor rather than growing their own spawn logic.
