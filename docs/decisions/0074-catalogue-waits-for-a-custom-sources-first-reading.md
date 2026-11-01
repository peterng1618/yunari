# 0074 — A catalogue read waits for a custom source's first reading

- **Status:** accepted
- **Date:** 2026-11-01
- **Paths:** `src/web/packages/host/src/providers/custom/provider.ts`, `src/web/packages/host/src/providers/provider.ts`, `src/web/packages/host/src/providers/registry.ts`

## Problem

`/api/sensors?measured=1` marks a key unavailable unless the provider answered
`ok` in the same sample. A custom source is only demanded by that sample, and
`#demand` starts its fetch without waiting, so the first catalogue read after a
source is written reports every one of its keys as unmeasured. The editor then
offers the key as disabled for a whole poll interval, so an author cannot bind
the source they just configured — the failure the `custom-source` browser spec
catches after the measured rule landed.

## Rungs

1. **Internal owner.** `CustomSourceProvider.sample` already owns demand and
   `SampleContext` already carries what a caller knows about the read.
   `ProviderRegistry.measure` is the one caller that needs the answer now.
2. **Installed dependencies.** No package owns this host's fetch lifecycle;
   `AbortSignal` and `setInterval` are the platform pieces already used.
3. **Native platform.** The fetch is already bounded by the source's
   `timeoutMs`, so waiting needs no new timeout of its own.
4. **Public solutions.** This is a provider-lifecycle question local to this
   host, not a library API; no external implementation applies.
5. **Integration comparison.** Making `sample` always await the first fetch
   would block every display's first paint on a slow source. Making the editor
   retry would put the wait in the browser and still show an unavailable key
   for a moment. A context flag lets the catalogue read wait where the answer
   matters and leaves live sampling untouched.
6. **Smallest probe.** The provider test samples the same runtime twice: once
   without the flag (a `missing` entry, as today) and once with it against a
   fixture that answers, which must be `ok` in the same call.
7. **Decision.** `SampleContext` gains `awaitFirstReading`. `measure` sets it;
   `CustomSourceProvider.sample` awaits the demand's pending fetch when the
   runtime has no reading yet. Live sampling keeps the present non-blocking
   behaviour, and a source that never answers still reports `missing` after its
   own timeout.

## Consequences

The editor's catalogue read can take up to one source's `timeoutMs` when a
source has never answered. Every other provider ignores the flag.
