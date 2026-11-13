# 0134 — Library reads outlive the sample tick

- **Date:** 2026-11-14
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/providers/library.ts`

## Problem

The host promises a `SampleBatch` every 1000 ms (`docs/architecture.md`, sample
path). Every surface built on that batch — the phone player, the editor preview
and every panel page the rasteriser captures — carries the same clock, so a slow
tick is visible everywhere at once as a seconds hand that jumps 2–5 s.

Measured on the authoring PC, 2026-11-14, with `YUNARI_PANEL_DEBUG=1` timing
added to the tick and to each provider:

- `[stream] tick` median 1 858 ms, max 7 769 ms.
- `[provider library]` median of the per-tick cost: avg 2 208 ms, max 7 249 ms.
  Every other provider is under 20 ms (`clock` 1 ms, `lhm` 18 ms,
  `weather` 4 ms).
- Inside the library, per family: `network` 1 538 ms avg (4 986 max),
  `graphics` 998 ms, `filesystems` 472 ms, `memory` 474 ms, `load` 106 ms,
  `speed` 40 ms. They run concurrently in `sample()` but the worker serves one
  synchronous `systeminformation` call at a time (`library-worker.ts`), so the
  tick waits for their sum.

## Rung 1 — internal owner

Searched: `codegraph_explore` for the sample cycle, tick, provider scheduling and
per-family caching; `library.ts` fields (`TickReads`, `PROCESS_COUNT_TTL_MS`,
`cpuIdentity`, `driveIndex`).

Found: the owner is `LibrarySensorProvider`. It already caches what costs more
than a tick — `cpu()` once, the drive index once, the process count for 5 s — and
`readOnce` already promises "one read per family per tick". The other providers
that are slow by nature (`weather`, `frame`, `media`) answer from a cache and
schedule their own acquisition; the library is the only provider still paying its
full read cost inside the tick.

## Rung 2 — installed dependencies

Searched: `systeminformation` 5.x source for `networkStats`, `fsSize`,
`graphics`, `currentLoad`; `library-worker.ts` and its tests.

Found: the reads are synchronous WMI/subprocess walks with no streaming or
callback form. `systeminformation` keeps its own state between `networkStats`
calls (rate = delta since the last call), which still works when the calls are
spaced by a background refresh. Nothing in the package offers a non-blocking
answer the host could use instead.

## Rung 3 — native platform

Searched: Node `worker_threads`, `perf_hooks`; Windows PDH performance counters
via Node (none exposed).

Found: a second worker thread would let two families run at once, cutting the
sum to roughly the longest call (~1.5 s here). That is still over the 1 s tick
and doubles the threads that block on WMI; it buys nothing for the contract.

## Rung 4 — public solutions

Searched: how comparable dashboards poll slow OS counters (Glances plugin
cadence, Windows Task Manager / `Get-Counter` sampling, `node-os-utils`), and
the repo's own weather/frame providers.

Found: every one of them samples slow sources on their own interval and serves
the latest completed reading to the renderer; none make the render tick wait for
the acquisition. Task Manager's 1 s view holds the previous value while a query
is outstanding.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Await all families per tick (current) | Honest timestamps | Misses the 1 s contract by 2–8×; every surface stutters | Reject |
| Two worker threads, shard families | Keeps per-tick reads | ~1.5 s sum remains; more WMI threads; still overruns | Reject |
| Raise the tick interval to 2 s | Matches reality | Changes the published contract and doubles the clock's jump | Reject |
| Cache per family, refresh in the background, stamp each entry with the time its family was read | Fits the provider's existing cache patterns; keeps the 1 s tick | One extra read in flight while the previous settles is skipped, so freshness is bounded by read cost | Accept |

## Rung 6 — smallest probe

The instrumentation above is the probe: it measures the tick, each provider and
each family read on the live host with the real themes and four surfaces
connected. It shows the library's sum, not one pathological call, is what
overruns the tick.

## Decision

`LibrarySensorProvider` keeps each family's last outcome and the instant it was
read. A tick answers from that cache and starts a fresh read of any family whose
reading is at least one tick old, without waiting for it; only the first demand
for a family waits. Each entry is stamped with its family's read time rather than
the tick's, so a cached figure never claims to be newer than it is. `readOnce`'s
per-tick map and `beginTick` go away with it.

Two more reads were on the tick and are now paid once:

- `osInfo()` (hostname, OS name, build) measured 0.4–1.2 s *every tick* and is
  cached like `cpu()` — none of those strings can change while the host runs.
- `describeDevices()` used to drop the drive index so a settings page would see
  a newly plugged drive; the next sample then paid the ~1.6 s walk again. It now
  refreshes the index and that answer becomes the cache.

The remaining per-key reads (`wifi`, `uptime`, `battery`, `processes`) stay in
the sample: they are gated on the keys a theme binds and were not part of the
overrun this note measures.

Measured after the change on the same host and themes: `[stream] tick` median
12 ms (was 1 858 ms), p90 81 ms, with the cold first tick the only multi-second
one.
