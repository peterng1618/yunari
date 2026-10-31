# 0017 — The library's OS reads run on a worker, not the panel's thread

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/providers/library.ts`,
  `src/web/packages/host/src/providers/library-worker.ts`

## Problem

A panel is fed from one Node process, and so is every sensor read. Profiling
the live host (`node --cpu-prof`, 54 s, three panels) and then measuring each
`systeminformation` family with a 5 ms interval watching for gaps:

| Family | Wall | Event-loop block |
|---|---|---|
| `graphics` | 437 ms | **124 ms** |
| `networkStats` | 1387 ms | **124 ms** |
| `mem` | 193 ms | 18 ms |
| `fsSize` | 236 ms | 16 ms |
| `currentLoad` (warm) | 0 ms | 0 ms |

`systeminformation` shells out with `execFileSync`/PowerShell internally, so
every sample tick holds the thread for 120–160 ms. The Kraken's bulk transfer
completes asynchronously (a libusb callback on the same loop): while the thread
is held, that completion is not delivered, so the next bucket switch waits. The
measured result on the glass was one 145–180 ms held frame about once a second,
on a wire that otherwise runs at 11.4 frames a second. A panel frame is a
scheduling problem, and a synchronous third-party call is what takes the
schedule away.

## Rung 1 — internal owner

`providers/library.ts` owns every `systeminformation` call behind one
`LibraryModule` seam; `providers/registry.ts` only calls `sample`; the panel
never reads sensors. The seam is what makes the change small: the provider asks
its module for `graphics()` and does not care where the answer was computed.

## Rung 2 — installed dependencies

`systeminformation` 5.33.16 has no asynchronous variant of these readers: every
family wraps `child_process` sync calls (`graphics.js`'s `nvidiaSmi` is
`execFileSync`). Node's own `node:worker_threads` gives a second JS thread with
no dependency, and its `structuredClone` transport carries exactly what
`systeminformation` returns (plain objects, arrays, numbers, strings).

## Rung 3 — native platform

A worker thread is native to Node and shares the process: no second install, no
port, no protocol of ours beyond request/reply ids. The one thing it does not
share is module state, and none of the read families depend on it — the rate
deltas that do (`networkStats`) are computed inside the call and returned whole.

## Rung 4 — public solutions

- `systeminformation`'s own issue tracker treats blocking sync calls as a known
  design property, not a bug to be opted out of.
- Node's documentation for `worker_threads` names exactly this case: a blocking
  API moved off the event loop so the thread can keep serving I/O callbacks.
- The host already contains an example of the same shape — `@yunari/store-worker`
  runs its own JavaScript off the serving thread — and the pattern here is the
  smaller version of it.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Read on the main thread (today) | Simplest | 120–160 ms of block per tick, once a second; panel frames held | Reject |
| Cache the families with a TTL | Existing precedent (`processReads`) | Staleness in seconds for GPU figures, and the block still lands when it refreshes | Reject |
| Skip families another provider answers | Cuts the read entirely when LHM runs | Providers are sampled concurrently; teaching the registry precedence-time knowledge is a wider change | Not now |
| Read through one worker, same `LibraryModule` seam | Blocks nothing; provider and tests unchanged | Worker lifecycle: one per host, fallback when it dies | **Implement** |

## Rung 6 — smallest probe

`siblock.mjs` (a disposable probe, not in the tree) ran each family with a 5 ms
interval measuring the largest gap: `graphics` 124 ms, `networkStats` 124 ms,
the rest ≤55 ms. A worker loading `systeminformation` through
`createRequire` answered `graphics()` with one controller, so the module is
reachable from a worker context in this layout.

## Decision

`library.ts` keeps its `LibraryModule` seam and asks a worker for every read in
production; a test that injects a module never starts one. `library-worker.ts`
owns the worker: one process-wide instance, request ids, structured-clone
values, and a fall back to the in-process module if the worker errors so a
dead thread costs speed, not telemetry. The worker is `unref`'d so a panel is
still not the reason the process will not exit.
