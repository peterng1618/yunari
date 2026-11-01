# 0065 — Panel discovery reports a held port and stops claiming an unplugged one

- **Date:** 2026-11-01
- **Status:** accepted
- **Paths:**
  - `src/web/packages/host/src/panels/panel-device.ts`
  - `src/web/packages/host/src/panels/panel-manager.ts`
  - `src/web/packages/host/src/panels/serial-transport.ts`
  - `src/web/packages/host/src/panels/turzx-panel.ts`
  - `src/web/packages/host/src/panels/serial-transport.test.ts`
  - `src/web/packages/host/src/panels/turzx-panel.test.ts`
  - `src/web/packages/editor/src/host-settings-mode/client.ts`
  - `src/web/packages/editor/src/host-settings-mode/client.test.ts`
  - `src/web/packages/editor/src/host-settings-mode/panels-section.tsx`
  - `src/web/packages/editor/src/host-settings-mode/region.dom.test.tsx`

## Problem

Two discovery defects sit on the same boundary: what the host says exists.

An unplugged TURZX panel stays reported as attached. The adapter records a
panel's identity in `heldPanels` when it opens one, because the port the host
drives cannot be reopened. `attachedTurzxPanels` states every recorded entry
before it looks at the current port list, so the recording outlives the cable
and `GET /api/displays/panels` keeps offering a device that is gone. The
transport makes the same fact worse: `serialport` reports a disconnect through
its `close` event, and the transport listens only for `data` and `error`, so a
destroyed handle is never marked closed.

A port another process holds is silently absent. Discovery's `open` refusal is
caught and discarded with `continue`, so the settings surface has no row and no
reason, even though the start path already carries the sentence that names the
vendor app.

## Rung 1 — internal owner

Searched: `PanelHint`, `PanelFamily.attached`, `attachedTurzxPanels`,
`openTurzxPanel`, `heldPanels`, `OpenSerialPort`, `attachedDevices`,
`PanelManager.reconcile`/`detachNow`, `GET /api/displays/panels`, editor
`PanelsSection`, `docs/decisions/0005-panel-reconnect-and-status.md`.

Found: `turzx-panel.ts` owns both the held-panel recording and the discovery
pass; `serial-transport.ts` owns the `serialport` seam; `panel-device.ts` owns
the hint vocabulary; `server.ts` already passes every hint to the settings
route and editor `PanelsSection` already renders every hint it receives.
`panel-manager` owns the retry lifecycle, and decision 0005 keeps detachment
there. Discovery is the state read a record-less port has, so the missing facts
belong in `PanelHint`, not in a manager special case.

## Rung 2 — installed dependencies

Searched: `@serialport/stream/dist/index.js` (`_disconnected`, `close`,
`_write`), `@serialport/bindings-cpp/dist/win32.js`, `load-bindings.js`, and
the installed type surface used by `serial-transport.ts`.

Found: a device disconnect calls `close(undefined, DisconnectedError)`, which
emits `close` with the disconnect error. `_write` on a port that is not open
queues on the next `open` event instead of failing, which is why a write after
an unplug hangs or reports "Cannot call write after a stream was destroyed".
`lock` defaults to `true`, so another open is refused. No dependency supplies
device presence; `SerialPort.list()` is the existing probe and the adapter
already reuses it.

## Rung 3 — native platform

Searched: Node.js `EventEmitter` events, `Error.code` errno values, and the
existing `SerialPort.list()`/`isOpen` seam.

Found: `EBUSY`, `EACCES` and `EPERM` are the platform's "held" refusals (a
Windows COM port is exclusive; Linux `TIOCEXCL` gives `EBUSY`). Node exposes
`isOpen` and the close event, but no process name, so the reason can be the
host's existing vendor-app sentence and no more.

## Rung 4 — public solutions

Searched: Context7 `/serialport/website` for "opening a port already held by
another process", "close event disconnect", "isOpen", "lock" and "error event";
the returned docs name the `close` event's disconnect error, the `lock: true`
default and `isOpen`. A live web search for `node-serialport EBUSY EACCES
Windows` and "Cannot call write after a stream was destroyed" was unavailable
in this environment; the socket answered from its knowledge summary, which
agrees that the disconnect is reported by `close` and that a destroyed stream
must never be written again.

Found: the public guidance is the same shape as the installed source — close
event, mark closed, re-enumerate before reopening. No library reports a held
port as present on its behalf, so the adapter must classify the refusal.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Watch OS device notifications | Exact | No cross-platform USB-CDC notification in this stack; per-family glue | Reject |
| Report held ports from `PanelManager` | One surface | Manager would learn serial errno codes and the TURZX vendor sentence, and the port has no record yet | Reject |
| Discovery cross-checks `heldPanels` against `SerialPort.list()` and classifies held open errors | Adapter owns both facts; one discovery pass stays | A generic-id port held by another program is reported as a candidate, not proven by HELLO | **Reuse** |
| New state word for "present but held" | Explicit | A second vocabulary the settings surface does not render | Reject |
| Carry the state on `PanelHint` using the manager's existing `connected`/`connecting`/`disconnected` | Same words, same route, existing rows render it | A held hint states `disconnected` with a reason | **Reuse** |
| Separate discovery/notice path | Visible notice | A second path that can disagree with the hint list | Reject |

## Rung 6 — smallest probe

Adapter tests with the existing fake transport:

- Open a panel on `COM5`, then enumerate no ports: discovery must answer no
  hint and clear the recording, then probe `COM5` again when it returns.
- An `open` that refuses with `EACCES` / "Access denied" must produce one hint
  with the existing disconnected state and the vendor-app sentence; an open
  refusal that is not a hold (`ENOENT`) must still be skipped.
- A transport whose port emits `close` must settle its read, refuse the next
  write with the closed-port code, and remove its listeners on close.

The first two were run against the unmodified adapter and failed before the
change; the transport case asserts the missing `close` listener first.

## Decision

Keep one discovery pass in the TURZX adapter. It prunes a held panel whose path
is absent from the current listing, reports a held port as a `PanelHint` with
`status: "disconnected"` and the existing vendor-app reason when the open
refusal is `EBUSY`/`EACCES`/`EPERM` or names the port as busy/denied, and skips
other open failures. `PanelConnectionStatus` moves to `panel-device.ts` so the
hint and the manager use one vocabulary; `panel-manager.ts` re-exports it. The
serial transport listens for `serialport`'s `close` event and marks the port
closed, so a write after an unplug refuses immediately instead of hanging.

The editor reads `status` and `reason` from the hint, draws the host's reason
on a row that cannot be added, and stops claiming every attached panel is
already a display when a held port is the only row.
