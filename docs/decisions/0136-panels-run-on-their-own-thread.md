# 0136 — Every panel's device and raster run on their own thread

- **Date:** 2026-11-14
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/panel-worker.ts`,
  `src/web/packages/host/src/panels/panel-worker-client.ts`,
  `src/web/packages/host/src/panels/panel-worker-protocol.ts`,
  `src/web/packages/host/src/panels/panel-session.ts`,
  `src/web/packages/host/src/panels/panel-manager.ts`,
  `src/web/packages/host/src/panels/panel-raster-browser.ts`,
  `src/web/packages/host/vite.config.ts`

## Problem

Every panel family's driver blocks the host's one event loop: node-hid's
`readTimeout`, PNG decode, palette quantisation, the serial writes and the
screencast's frame handling all run on the same thread as the sample tick and
every other panel. A panel's own work therefore delays the others, and the
110 ms paletted Kraken cadence is the surface where it is visible.

Measured on the authoring PC, 2026-11-14, with a temporary probe on
`createPanelRunner` (Kraken mode B, 3,247 frames):

- `present` (decode + palette + 6 HID commands + 103 KB bulk): p50 70 ms,
  p90 86 ms, p99 124 ms, max 1,139 ms.
- Frame gap: p50 118 ms, p90 134 ms, p99 176 ms, max 1,176 ms → 8.4 fps.
- 11.8% of gaps were under 105 ms; 61 frames (1.9%) followed a >160 ms stall.

A/B on the same run:

| Condition | present p50 / p99 | stalls >160 ms | gaps <105 ms |
|---|---|---|---|
| All three panels | 70 / 124 ms | 61 | 11.8% |
| TURZX disconnected | 64 / 82 ms | 3 | 3.2% |
| SignalRGB lighting off | 64 / 109 ms | 4 | 9.7% |

The multi-hundred-millisecond presents line up with TURZX overlay work
(`overlay N … bodies 1–2 MB`, `sent 250 B in 55 ms`) and with Lian Li presents
of 350 ms: each panel's synchronous work delays the others' microtasks. A
worker per panel removes that coupling.

## Rung 1 — internal owner

`codegraph_explore` and source: the responsible seam is already
`panel-manager`'s `PanelDevice` and `Rasterizer` interfaces. `createPanelRunner`
schedules and compares; it does not touch a protocol. The library's prime
suspect was proven and fixed the same way by `providers/library-worker.ts` — a
worker thread whose reads answer over `postMessage`. This change applies that
same owner to panels rather than adding a second mechanism. Plugin panel
devices already run through the extension supervisor's forked child
(`plugin-panel-device.ts`), so isolation is the rule every surface follows, not
a built-in-only privilege.

## Rung 2 — installed dependencies

`node-hid` 3.x, `usb` 2.x and `serialport` 13.x are N-API packages. A disposable
probe spawned a `node:worker_threads` worker that `require`d each from the host
install: all three loaded, and `node-hid` enumerated 26 devices from the worker.
No package offers an asynchronous control-transfer API; `node-hid`'s
`readTimeout` is synchronous by design, which is exactly why it must not run on
the host's loop.

## Rung 3 — native platform

`node:worker_threads` gives each panel its own V8 isolate and event loop, so CPU
work and blocking native calls stop serialising across panels. A thread shares
the process's USB stack; each worker opens its own device, so no handle crosses
a thread. The shared Chromium stays in the host: its browser-level client
creates one target per panel and hands the page's devtools URL to the worker.

## Rung 4 — public solutions

Comparable implementations separate device transports per controller rather
than multiplexing them on one loop: OpenRGB runs a device thread per controller
and its SDK serialises commands per device; liquidctl and `lian-li-linux` are
single-device CLIs that can afford synchronous calls because they have one
device and no render loop. Neither pattern transfers directly — Yunari is one
host with three devices and a render cadence — but both agree that the transport
is not shared between devices.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep shaving per-panel pacing (current) | None | Each new panel re-creates the contention; measured stalls remain | Reject |
| Make every driver fully async (no blocking calls) | Partial | npm HID control transfers are synchronous; PNG/palette CPU still blocks | Reject |
| Core process per panel | Strong isolation | Three more Node processes, IPC pipes, duplicate module trees | Reject |
| One worker thread per built-in panel, behind the existing `PanelDevice` / `Rasterizer` seams | Removes cross-panel blocking; keeps the runner, manager and tests unchanged; plugin panels already isolated | Per-frame capture/present bytes cross the thread boundary (~30–60 KB at 9 fps) | Accept |

## Rung 6 — smallest probe

The instrumentation above is the probe. It measures the contended cadence, then
drops one panel and one writer and shows the stalls collapse (61 → 3, p99
124 → 82 ms) while the steady rate is unchanged. The native-module worker probe
(above) settles the remaining unknown: the drivers load where they are moved.

## Decision

`panel-manager` opens a built-in panel through `panel-worker-client.ts`:
a worker thread that owns the family's device and its page rasteriser, and
answers `present`, `capture`, controls, lighting and clip messages. The manager,
runner and their tests keep the existing interfaces; the host keeps the shared
raster browser, creating the target and handing its page socket to the worker.
`PanelDevice` and `Rasterizer` are the boundary, so no driver code changes.

Plugin families keep the extension supervisor's forked child, which is already
off this loop. A family the worker cannot construct answers that fact and the
manager falls back to the in-process path for that display only, so a plugin
row is never refused because it is not built in.
