# 0060 — the LAN address is measured once and served between measurements

- **Date:** 2026-11-01
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/cli/net.ts`
- **Paths:** `src/web/packages/host/src/cli/net.test.ts`

## Problem

`lanAddress()` called `readLanSource()` on every request. On Windows
`systeminformation.networkInterfaceDefault()` shells out to `netstat -r` through
`execSync`, which blocks the host's event loop for 126–149 ms (issue #136,
`vg-597`). `GET /api/hosting` calls it, so every poll of the hosting row froze
the host that serves the display's document, its assets and its sample stream.

## Rung 1 — internal owner

`packages/host/src/cli/net.ts` owns the LAN address; `cli/hosting.ts` (the
`/api/hosting` route) and `main.ts` (the startup banner) are its only callers.
The host has no scheduler or cache module to extend — `console` is its logging
surface and `readLanSource()` its one OS reader — so the owner is this file.

## Rung 2 — installed dependencies

`systeminformation` is already the host's OS reader and its route query is the
blocking call. It offers no cached or refresh variant; the `netstat` spawn is
inside `networkInterfaceDefault()`.

## Rung 3 — native platform

Node exposes no routing table at all (`os.networkInterfaces()` lists adapters
only), so there is nothing native to read instead. Node's timers are what the
expiry already uses.

## Rung 4 — public solutions

Stale-while-revalidate is the pattern for an expensive read behind a cheap
route: serve the last measurement and refresh it out of band, so a request never
waits on the source. No package is needed for a single measured value; the
standard shape is a timestamped entry plus an in-flight flag.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| TTL entry, stale answer served while a background refresh runs | `/api/hosting` never blocks; the banner's first call still measures | An in-flight flag so refreshes do not pile up | Chosen |
| Await the measurement per request, cached | Requests still wait whenever the TTL expires | The block returns once per TTL | Rejected |
| Background interval that always remeasures | No request ever waits | Polls the OS on a timer when nobody is asking | Rejected |

## Rung 6 — smallest probe

`net.test.ts` fakes `Date` and counts `networkInterfaceDefault` calls: within the
TTL the answer is served without a second read, the expired call returns the
stale address while the refresh runs, and the next call returns the new one. The
injectable `source` path stays a pure ranking call, so cases that carry a
fixture do not touch the cache.

## Decision

`lanAddress()` keeps one measured address for 30 seconds and refreshes it in the
background when it is stale, returning the previous answer meanwhile. The
in-flight flag keeps a burst of requests to one refresh. `resetLanAddressCache()`
exists for the unit suite; the host never calls it — a DHCP move is picked up by
the next refresh.
