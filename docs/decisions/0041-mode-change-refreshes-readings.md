# 0041 — A returning mode reports itself, so fresh reads have an owner

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/editor-shell/shell-layout.tsx`

## Problem

The editor reads `/api/sensors` once at boot. A source added on the Host page
while the editor stays open is therefore absent from every reading picker until
the page is reloaded — the e2e for the flow reloads the page, which hides the
gap rather than proving the promised flow. Something has to report that a mode
became visible again, and it must be the shell that owns the switch: the boot
cannot see a click that never reached it.

## Rung 1 — internal owner

Searched: CodeGraph for `createShellLayout`, `ShellRoot`, `SensorCatalogue`,
`refresh`; read `editor-main.ts`, `editor-shell/shell-layout.tsx`,
`sensor-catalogue.ts`.
Found: `ShellRoot` owns `mode` and `requestMode`, and `editor-main.ts` owns the
one catalogue instance and its boot read. `createShellLayout` had no way to
report an accepted switch, so the boot could not be told. `sensors.refresh()`
already exists and keeps the built-in table on failure.

## Rung 2 — installed dependencies

Searched: React 19 `useEffect`/state events; the shell's own external stores.
Found: nothing donates "mode became visible" — it is a product concept owned by
this switch. An effect on `mode` would fire for the initial mount too and has no
way to tell an accepted change from the entry mode.

## Rung 3 — native platform

Searched: `visibilitychange`, `popstate`.
Found: none of them describes a mode switch inside one page; using them would
miss every normal return to the editor.

## Rung 4 — public solutions

Searched: React "refresh on route re-entry", TanStack Query `refetchOnMount`,
revalidation-on-focus patterns.
Found: each needs a fetcher/route owner and a cache; this page has one
imperative catalogue, so the pattern is the callback, not the library.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Refresh inside `HostSettingsRegion` after a source write | Knows the write | Catalogue is not in its props; threading it through the Host page is a second path | Rejected |
| `useEffect` on `mode` | Small | Fires on mount and cannot tell a refused switch | Rejected |
| Callback from the switch's accepted transition | One owner, one event | None | Chosen |

## Rung 6 — smallest probe

`shell-layout.dom.test.tsx` drives the switch: a change reports once, pressing
the segment already showing reports nothing, and returning reports again. The
e2e `custom-source.spec.ts` now switches back to the editor instead of
reloading, which is the flow the product promises.

## Decision

`createShellLayout` takes an optional `onModeChange`, called only where a
switch lands — after the dirty-document guard accepts, never for the segment
already showing. `editor-main` uses it to refresh the sensor catalogue on a
return to the editor. The shell owns the event; the boot owns what the event
means.
