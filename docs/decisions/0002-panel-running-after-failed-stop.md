# 0002 — Report a panel as running only while its runner is running

- **Date:** 2026-10-30
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/panel-manager.ts`

## Problem

`PanelManager.running()` decides "running" from the presence of an entry's
runner. A stop clears the runner's own `running` flag before it closes the port,
and a failed close deliberately keeps the entry so the next change can retry.
The listing therefore keeps reporting a panel that is shutting down — or whose
shutdown failed — as running, while the same module's `commandNow` already
refuses it.

## Rung 1 — internal owner

Searched `panel-manager.ts`, `panel-runner.ts`, `panel-manager.test.ts` and the
consumers of `running()`. `PanelRunner.running` is the runner's own liveness
flag: `stop()` clears it first and `tick()` refuses after that. `commandNow`
already gates on it. `reconcile()` also uses raw entry presence, deliberately,
so a failed stop is not restarted over a held port. The listing is the one
reader that disagrees.

## Rung 2 — installed dependencies

Searched the host's dependencies and `package.json` for a supervisor or
liveness helper. None owns panel lifecycle; the runner is the existing owner.
No dependency is added.

## Rung 3 — native platform

Node exposes process and stream closure, but a serial port that failed to close
is not reported as closed by the runtime. There is no native "is this panel
alive" API; the runner's flag is the available truth.

## Rung 4 — public solutions

Searched process-supervisor state vocabulary (systemd `ActiveState` in
`systemctl(1)`, and the shutdown states of comparable supervisors). Supervisors
distinguish `active` from `deactivating`: a stop in progress is not reported as
running, and a failed stop is a failed/inactive state rather than active.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Presence-based filter (current) | Simple | Reports a stopping or failed panel as running | Reject |
| Filter on `entry.runner.running` | Uses the owner's existing flag | None | Reuse |
| Add a separate `stopping` set | Duplicates state the runner owns | Must be kept in step with the runner | Reject |

## Rung 6 — smallest probe

The two stop-failure cases in `panel-manager.test.ts` assert `running()`. They
were changed to expect an empty list and fail against the presence filter before
the one-line change; they pass after it.

## Decision

`running()` filters on `entry.runner?.running === true`. The entry still
survives a failed stop for retry, and `reconcile()` keeps its presence check so
it does not reopen a held port.
