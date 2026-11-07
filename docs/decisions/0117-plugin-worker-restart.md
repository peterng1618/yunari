# 0117 — restart a crashed plugin worker, bound a provider poll

- **Date:** 2026-11-07
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/extensions/runtime/supervisor.ts`, `src/web/packages/host/src/extensions/providers.ts`

## Problem

`startPluginSupervisors` forks one worker per executable plugin. A worker that
exits after a healthy start is reported once through `onCrash` and stays out of
service until the host restarts, so every provider, asset source and panel
family that plugin owns goes dark for the rest of the session. Separately, one
provider `sample` has no budget of its own: it waits for the supervisor default
(35 s, sized to allow a 30 s host API call), which stalls every display's
sampling cycle behind one hung plugin. The choice of who owns a worker's
lifetime and whose clock a poll runs on decides whether a bad plugin degrades
one provider or the host, so it is a mechanism boundary.

## Rung 1 — internal owner

Searched: `codegraph explore "createPluginSupervisor PluginSupervisor start stop onCrash"`; read `runtime/supervisor.ts`, `extensions/providers.ts`, `extensions/asset-sources.ts`, `panels/plugin-panel-device.ts`, `extensions/runtime/plugin-revocation.ts`.

Found: `createPluginSupervisor` is the one owner of a child's lifetime. It
already owns fork, the ready/init handshake, request timers, the stderr detail,
one-crash reporting and an idempotent `stop()`. Its adapters (`PluginSensorProvider`,
the code asset source, the panel device) hold the same long-lived
`PluginSupervisor` object, and `main.ts` starts the supervisors once and shares
the map across all three registries. `revokePluginRuntime` stops a supervisor
and deletes it from that map, which must keep working while a restart is
pending. No restart or backoff code exists anywhere in the host: the only
"restart" mentions are comments about a new child generation. The child process
object is already the generation token for IPC, so reusing the object is safe
and preserves stale-message fencing.

What remains unsolved: nothing in the supervisor decides whether a dead child
should be replaced, and `request` has one timeout for every caller.

## Rung 2 — installed dependencies

Searched: `node:child_process` API surface through the existing import and
`@types/node`; the host's dependency list (`packages/host/package.json`).

Found: `fork()` returns a `ChildProcess` with `exit`, `error`, `connected`
and `kill()`, and `send()` on a disconnected child throws. There is no
supervision, restart policy or backoff in the module; a caller that wants
replacement implements it. No installed dependency provides process
supervision, and adding one would be new runtime surface for a loop this small.

## Rung 3 — native platform

Searched: Node's `child_process`, timers and IPC semantics; OS process
facilities are not part of the host's runtime (the host is a single Node
process).

Found: Node supplies everything the mechanism needs (fork, exit event,
timers) but no policy. Node's timer is the only clock that can cancel a pending
restart on `stop()`. The platform leaves the decision — which exits are
restartable, how long to wait, when to give up — to the owner.

## Rung 4 — public solutions

Searched and read:

- systemd.service(5), `Restart=`, `RestartSec=`, `RestartSteps=`,
  `RestartMaxDelaySec=` (`https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html`).
  Restarts only when the process exits/killed/times out and the stop was not
  issued by systemd; `RestartSec=` defaults to 100 ms; exponential growth is
  opt-in from systemd 254 via `RestartSteps=` steps between `RestartSec=` and
  `RestartMaxDelaySec=` (example: 10s, 20s, 40s, 80s, 160s then constant).
- PM2 restart strategies
  (`https://pm2.keymetrics.io/docs/usage/restart-strategies/`): with
  `exp_backoff_restart_delay`, the delay grows ×1.5 from the configured base
  (100 ms example) to a 15 000 ms cap, and resets after 30 s of stable uptime;
  `restart_delay` is the fixed-delay alternative.
- VS Code extension host: issue #141765 "Restart the local extension host
  automatically after a crash" (closed 2022), `nativeExtensionService.ts`
  calling `_localCrashTracker.shouldAutomaticallyRestart()` and
  `startExtensionHosts()`; the prompt after the tracker refuses says
  "Extension host terminated unexpectedly 3 times within the last 5 minutes".
  Local restarts are immediate, limited by crash count in a time window, not
  by a delay; an intentional restart is a separate command path.

What each handles: systemd distinguishes operator stop from a crash and makes
delay policy explicit; PM2 bounds recovery latency with a cap and resets on
stability; VS Code avoids restart storms with a time-window budget. None
provides an object that Yunari's adapters already hold, so each is prior art
for the policy, not a component to import.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Leave the worker dead after `onCrash` | No: one crash disables the plugin for the session | None | Rejected; issue 450 |
| Re-run `startPluginSupervisors` on `onCrash` | Poor: it rebuilds every plugin's supervisors and the adapter maps already hold the old objects | Registry replacement, duplicate children, no backoff per plugin | Rejected |
| New host-level process manager | Over-built: one owner already exists and every adapter already talks to it | New lifecycle object, new wiring, two owners of a child | Rejected |
| Restart inside `PluginSupervisor` on unexpected exit, with capped exponential backoff | Fits: the supervisor already owns fork/exit/stop, its object identity is the generation fence, and `stop()` already means "intentional" | Restart timer cancellation, a failed restart retry, and a distinct `onRestart` report | Chosen |
| Add a second timeout in `ProviderRegistry` | Duplicates the supervisor's request timer, which already kills a silent worker | Two timers racing per poll | Rejected |
| Per-provider budget on the supervisor request | Fits: the supervisor owns a worker request's lifetime; `sample`/`describe` are the only short polls | Comment the ceiling and keep panel/asset requests at the default | Chosen |

## Rung 6 — smallest probe

`extensions/runtime/supervisor.test.ts` forks a real temp plugin, lets it
start, makes it exit, and observes the second fork plus a successful request
through the same supervisor object. Run before the production change it fails
(one fork, the request rejects "not running"); after it passes. The delay test
injects `restartBaseMs`/`restartMaxMs` and records the `onRestart` arguments,
so growth and cap are asserted on the computed values rather than on wall
clock. `extensions/providers.test.ts` uses a real supervisor, a small injected
provider budget and a plugin whose `sample` never answers, then asserts the
provider fails at that budget, the supervisor is dead, and a later sample
succeeds after the restart.

## Decision

Restart inside the existing supervisor, reusing the same `PluginSupervisor`
object and the child object's generation fence. Only a child that exited after
a successful `start()` and after `stop()` was not called is replaced; an initial
start failure is reported by the caller and left out, because a detached retry
loop would keep a rejected plugin alive. The delay is
`min(base × 2^(attempt−1), max)` with a 1 s base and 60 s cap; a failed restart
attempt schedules the next one; a successful start resets the attempt counter;
`stop()` clears the timer. The provider adapter passes a 10 s budget for
`describe`/`sample`; panel commands and asset transfers keep the 35 s default,
and the host API's 30 s deadline is unchanged. No second timeout owner and no
new dependency.
