# 0064 — Measured sensor keys come from the provider registry

- **Date:** 2026-11-01
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/server.ts`
- **Paths:** `src/web/packages/host/src/providers/registry.ts`
- **Paths:** `src/web/packages/editor/src/editor-session.ts`
- **Paths:** `src/web/packages/editor/src/selection-inspector/view.ts`

## Problem

The editor's reading picker offers every descriptor the vocabulary knows, so a
sensor this PC measures and one no provider reports look identical. The picker
must not guess from a static table: it has to learn the keys the host answered
with an `ok` reading now, and leave today's behaviour when the host does not
answer.

## Rung 1 — internal owner

Searched: CodeGraph was unavailable in this worktree (no index); grep and reads
for `/api/sensors`, `ProviderRegistry`, `describe()`, `health()` and `sample()`
in `packages/host/src/`.
Found: `server.ts` answers `/api/sensors` with `registry.describe()`, which is
the static capability list — `LhmSensorProvider.describe()` returns
`LHM_DESCRIPTORS` even when LibreHardwareMonitor is absent. `Registry.sample()`
is the existing owner that turns provider answers into `SampleEntry[]` and
already distinguishes `status: "ok"` from a gap. `ProviderHealth` is
provider-wide and cannot say which key a provider failed to read.

## Rung 2 — installed dependencies

Searched: the providers' own modules and `registry.test.ts`; Node's standard
library in `server.ts`.
Found: no installed package owns this host's readings. `ProviderRegistry` is the
installed code that already composes `describe()` and `sample()`; its `sample()`
keeps the earliest `ok` entry per key and reports a non-`ok` entry as a gap.

## Rung 3 — native platform

Searched: `node:http` route handling and `URL.searchParams` already used in
`server.ts`.
Found: the platform supplies the transport and query string only. It has no
notion of which sensor this PC measured.

## Rung 4 — public solutions

Searched: none — the question is what this host's own providers answered in
process, so no external library or standard can supply it. A public cataloguing
API would be a different sensor set, not this PC's.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| New `/api/sensors/measured` route | Separate read | A second catalogue read for the same keys; one more route to keep in step | Rejected |
| `describe()` filtered by `health()` | No extra sample | Health is provider-wide: an absent LHM still advertises its static keys | Rejected |
| `/api/sensors` samples every descriptor on every read | Existing route | Every player page load would start media/frame/game helpers and shell out for library reads | Rejected |
| `/api/sensors?measured=1` samples every descriptor | Existing route; only the editor asks | One full sample on editor boot and on returning to it | Chosen |

## Rung 6 — smallest probe

The route test drives a stub provider whose one key answers `ok` and whose other
key answers `missing`; the first is reported as measured and the second is not.
The same test is the executable check for the decision.

## Decision

Add `ProviderRegistry.measure(nowMs)`: it calls the existing `describe()` once
and then the existing `sample()` over those keys, and returns the catalogue plus
the keys whose entry is `status: "ok"`. `GET /api/sensors` keeps its present
answer; with `measured=1` it returns the measured set beside the sensors. The
editor's catalogue asks for measured keys and marks the rest unavailable; a
failed or older answer leaves the built-in behaviour untouched.
