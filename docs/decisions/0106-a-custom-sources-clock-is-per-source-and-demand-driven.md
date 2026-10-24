# 0106 — A custom source's clock is per source, driven by demand and owned by one runtime map

- **Date:** 2026-10-24
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/providers/custom/provider.ts`

## The problem

`CustomSourceProvider` turns user-authored HTTP fields into semantic readings,
and it is the first provider whose acquisition cadence is per *configuration
entry* rather than per provider. It has to start and stop a timer per source,
count demand across every key that source contributes, distinguish a fresh
`error` from a `stale` last-good value, apply `scale`/`offset` exactly once, and
keep one source's failure and one credential out of every other sample and
reason. A wrong answer here is invisible: a doubled timer still returns data, a
stale value still renders, and a credential re-scaled per sample still plots —
until the fetch bill or the wall shows it.

## Rung 1 — Yunari

Searched: `packages/host/src/providers/` for timer, demand, grace and staleness
patterns, and for an existing per-entry scheduler.

Found: three relevant owners. `weather/provider.ts` owns a single provider timer
with a `now` seam, a demand timestamp, an idle window, staleness at
`max(3 × interval, 30 min)`, and redaction at composition (`health()` and
sample messages).
`media/provider.ts` owns a demand grace period and a `stop()` that a later
`sample()` may restart. `registry.ts` owns the asked-key union but is a
per-cycle scheduler, not a per-source timer. None handles more than one source,
and no runtime map of configuration entries exists.

## Rung 2 — dependencies

Searched: workspace manifests and `package.json` for `p-limit`, `node-cron`,
`async-mutex` and any scheduler.

Found: none declared. `fetch-source.ts` already serialises one source against
itself through a per-id tail and bounds the whole host to four requests, so a
scheduler dependency would duplicate an owner that already exists.

## Rung 3 — platform

Searched: `setInterval`/`setTimeout` with `unref`, `AbortController`,
`AbortSignal.any`, and fake timers under Vitest.

Found: `setInterval` gives the per-source cadence; `unref` keeps an idle host
exitable; `AbortController` plus `AbortSignal.any` (probed: aborting the
controller aborts a signal joined with `AbortSignal.timeout`) lets `stop()`
cancel a request that is already dialling without removing the fetch client's
own deadline. Vitest's fake timers advance `Date.now` with the timer queue, the
same seam the weather suite already uses.

## Rung 4 — ecosystem

Searched: npm for `node-cron`, `p-limit`, `async-mutex`, `cockatiel` as
alternatives to timers plus a runtime map.

Found: each is a general scheduler/limiter. None knows about semantic-key
demand, per-source intervals or provider health, so adopting one moves the
decision out of the provider without removing it, and adds a shipped dependency
for a few dozen lines. Rejected.

## Rung 5 — comparison

| Option | Fits | Rejected because |
|---|---|---|
| One provider-wide timer at the shortest interval | simple | fetches every source at one cadence, ignoring each source's own `intervalMs` |
| `node-cron` / `p-limit` / `async-mutex` | scheduling/limiting | new dependency; still leaves demand, staleness and health here |
| Recursive `setTimeout` per runtime | re-scheduling | `setInterval` is the stated cadence and a reload replaces the runtime anyway |
| `setInterval` per runtime in a `Map<sourceId, SourceRuntime>` | whole contract in one owner | chosen |

## Rung 6 — probe

Probed with `node`:

- `AbortSignal.any([controller.signal, AbortSignal.timeout(1000)])` reports
  `aborted: false` before, and `aborted: true` with `AbortError` after
  `controller.abort()`, so the provider's cancellation composes with the fetch
  client's deadline.
- `setInterval` returns a handle carrying `unref` under both Node and Vitest's
  fake timers, so the same call keeps an idle host exitable and stays
  deterministic under the suite.

The suite drives the provider with a fake fetch seam over IP-literal URLs (no
DNS), a mutable store and a credential store, and asserts against timer
advances rather than real sleeps: no fetch before demand, one fetch at the
first demand, one per interval after, no doubling across `reload()`, three
missed intervals becoming `stale` and a later success returning `ok`, two
sources isolated, scale/offset applied once, and a missing credential fetching
nothing.

## Rung 7 — build

Built: `custom/provider.ts` owns a `Map<sourceId, SourceRuntime>`. `reload()`
re-reads the store, retires every old runtime (timer cleared, in-flight aborted)
and rebuilds descriptors and runtimes, so a reload cannot double a timer.
`sample()` is a cache read that registers demand and starts the first timer and
fetch at once; a timer stops once no key has been asked for three intervals
(the demand grace). Each field's pointer result is scaled/offset once at
acquisition and stored; a miss is `missing`, a type mismatch is `error` with no
coercion, and a source's failure reaches only its own samples and `health()`.
A reason names a field's pointer verbatim as user-authored configuration,
bounded to 64 characters with the whole message capped at 120; only a value
that fails the JSON-Pointer grammar falls back to the field id. `health().available` follows
whether the store has a valid source, so a partially failing provider is still
available and its redacted failure rides in `message`. Credentials resolve
through `CredentialStore` at fetch time only, and a missing one is a reason
rather than a request without it. `stop()` retires every runtime, aborts
in-flight requests, refuses a reload still pending on the store and reports
the provider stopped rather than source-less. `main.ts`
constructs the provider, awaits `reload()` and stops it beside the other
providers.
