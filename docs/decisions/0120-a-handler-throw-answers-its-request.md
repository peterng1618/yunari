# 0120 — A handler throw answers its request; only a crash exits the worker

- **Date:** 2026-11-07
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/extensions/runtime/plugin-host.ts`

## Problem

A worker handler that throws is the worker protocol's only way to report an
expected gap (a missing API key, a provider outage). The host counted two such
throws as a crash and exited the process, so a recoverable failure on the second
attempt took that plugin's readings and asset rows away until a host restart.
The boundary is the worker lifecycle: a wrong classification turns an answer
into an outage.

## Rung 1 — internal owner

Searched: CodeGraph `plugin-host.ts`, `handle`, `dispatch`, `initialise`,
`createPluginSupervisor`, `crash`, `PluginResult`.

Found: the child owns the protocol answer (`plugin.result` with `ok: false` and
a reason) and the parent already owns crash detection: an unexpected exit,
`error` event, startup timeout or refused init settles pending calls and calls
`onCrash`. The host's provider and asset adapters already state expected gaps
as status values; the worker protocol has the same shape in `ok: false`.

## Rung 2 — installed dependencies

Searched: Node `child_process` fork events (`message`, `error`, `exit`) and the
advanced IPC serialization already selected by the supervisor.

Found: the parent's crash detection does not depend on the child's throw count;
nothing installed needs the second-throw rule. The count was local to this file.

## Rung 3 — native platform

Searched: Node `uncaughtException`, `unhandledRejection`, `process.exit`.

Found: an uncaught exception or unhandled rejection still reaches these
listeners and exits; an entry that cannot load still exits in `initialise`. A
returned rejected promise from a handler is caught by `handle` and answered.

## Rung 4 — public solutions

Searched: the supervisor contract in Node's `child_process` documentation —
`error` means the process could not be spawned or communication failed; `exit`
means the process ended. A protocol-level failure is a message, not either.

Found: the platform's own distinction is the rule this change restores; no
external plugin runtime is adopted.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Remove the throw counter | A throw answers that request; crash detection stays with the parent | None | Chosen |
| Keep a high threshold (e.g. 10) | Delays an outage | Still kills a healthy plugin | Rejected |
| Exit on the first throw | Worse than the reported defect | | Rejected |
| Add a status value to the worker protocol | A new protocol shape | The `ok: false` answer already carries it | Rejected |

## Rung 6 — smallest probe

The existing supervisor fixture forked the worker and observed the exit; the
regression test now asserts three consecutive throws leave `alive` true and
report no crash, while a real `process.exit(1)` handler still reports a crash.

## Decision

Delete the handler-throw counter and its exit branch from `plugin-host.ts`.
`handle` always answers with `ok: false` and the reason. `initialise` keeps its
exit for an entry that cannot load, and the `uncaughtException` /
`unhandledRejection` handlers still exit, so a real crash remains observable by
the parent's existing crash path.
