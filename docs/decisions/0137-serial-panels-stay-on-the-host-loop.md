# 0137 — A driver whose transport completes on the host's loop stays on it

- **Date:** 2026-11-15
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/panel-device.ts`,
  `src/web/packages/host/src/panels/panel-session.ts`,
  `src/web/packages/host/src/panels/turzx-panel.ts`

## Problem

0136 moved every built-in panel's device onto a worker thread. The TURZX 5"
driver talks over `serialport`, and its Windows binding completes I/O on
`uv_default_loop()` — the process's loop, which belongs to the host's main
thread. Running that driver on a worker makes the main thread enter the worker's
V8 isolate without its lock. The host aborts within a second of opening the
panel with `FATAL ERROR: HandleScope::HandleScope Entering the V8 API without
proper locking in place`.

## Rung 1 — internal owner

`panel-session.ts` owns the "a built-in family runs on its own thread" rule;
`PanelFamily` owns what a driver is. The fix belongs in that pair, not in the
manager: the manager already asks the session to open the panel.

## Rung 2 — installed dependencies

`@serialport/bindings-cpp` 13.0.0 (the version `serialport` 13.0.0 installs):

- `src/poller.cpp:25` — `uv_poll_init(uv_default_loop(), poll_handle, fd)`.
- `src/serialport_win.cpp:427,614` — `uv_async_init(uv_default_loop(), async,
  EIO_AfterWrite / EIO_AfterRead)`.

The completion handlers run on the default loop's thread and call the N-API
callback for the environment that created the binding. Off the main thread that
environment belongs to another isolate. 13.0.1 has the same three calls, so an
upgrade does not fix it. `node-hid` 3.4's read thread uses a typed
`ThreadsafeFunction` and `usb` 3.2's Rust binding was shown safe by probe, so
only the serial transport is affected.

## Rung 3 — native platform

Node exposes no serial API; the OS handle needs a DCB (baud, RTS/CTS) that only
`DeviceIoControl` can set. A worker thread cannot move libuv's default loop, and
a child process is the only platform-level way to put this driver on a loop of
its own.

## Rung 4 — public solutions

- `node-serialport/bindings-cpp` source and issues: no worker-thread mode; the
  default-loop use is unconditional.
- Comparable hosts run one device per process when a transport is not thread
  safe (OpenRGB's per-device threads use their own SDK; liquidctl is a
  one-device CLI), i.e. they never share a loop with a binding that posts to it.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Child process for serial families | Strong isolation | New entry, IPC protocol, lifecycle, packaging; one more Node process | Reject for now |
| Keep the serial driver on the host loop, everything else on threads | Correct; the in-process path already exists as the plugin fallback | TURZX work still shares the host loop, as it did before 0136 | Accept |
| Replace `serialport` | Removes the cause | No worker-safe Windows binding was found; a Win32 binding of our own is a new mechanism | Reject |

## Rung 6 — smallest probe

A worker that opens COM5 through `serialport` with the host's own options
(`rtscts: true`, `autoOpen: false`, `port.open(callback)`) reproduces the fatal
in under a second; the same worker opening the Lian Li panel through `usb` and
reading a bulk endpoint survives a completed transfer. Driver-level
reproduction: the built `panel-worker.js` opening the TURZX record crashes,
opening the Kraken record does not.

## Decision

A `PanelFamily` may declare `threadSafe: false`; `panel-session` then opens it
in the host, on the path plugin families already use. The TURZX rows declare it,
naming `serialport`'s default-loop completions as the reason. Everything else
keeps running on its own thread. A serial driver that must leave the host loop
needs its own process, not a thread.
