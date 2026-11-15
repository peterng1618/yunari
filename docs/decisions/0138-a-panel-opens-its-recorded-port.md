# 0138 — A panel opens the port its record names, and a stalled port is released

- **Date:** 2026-11-15
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/turzx-panel.ts`,
  `src/web/packages/host/src/panels/serial-transport.ts`,
  `src/web/packages/host/src/panels/panel-device.ts`,
  `src/web/packages/host/src/panels/panel-manager.ts`

## Problem

Two failures share one cause: the TURZX driver treated every serial port that
reported any USB ids as a candidate, and the serial transport could leave a
stalled write's handle inside the process. A retry then opened an unrelated CDC
adapter (and reported its "access denied" as the panel's status) and could not
reopen the panel's own COM port, which the host still held.

## Rung 1 — internal owner

Searched: `codegraph_explore "openTurzxPanel hasIds tur-usb-panel discovery
retry closePort"`, then `turzx-panel.ts`, `serial-transport.ts`,
`panel-manager.ts`, `settings/displays.ts`, `panel-device.ts`.

Found: `turzx-panel.ts` owns discovery and the open; `panel-manager.run` already
holds the display record's hardware when it calls `family.open`. `samePanel` in
`settings/displays.ts` is the host's one identity rule (serial when both sides
report one, else the ids). `PanelOpenOptions` carried only the cache directory
and render mode, so the record's device never reached the driver.

## Rung 2 — installed dependencies

Searched: `node_modules/@serialport/stream/dist/index.js` (`close`),
`@serialport/bindings-cpp` behavior recorded in `docs/decisions/0137`.

Found: the stream's own comment states that in-progress writes error when the
port is closed. Closing during a stalled write is supported and is the only way
to release the OS handle; a write callback that never arrives otherwise keeps
the handle for the process's lifetime. No upgrade changes this.

## Rung 3 — native platform

Searched: Node's `fs`/libuv and Windows handle semantics as already documented in
`serial-transport.ts`'s write deadline.

Found: nothing above the binding can force a Windows COM handle shut; the
binding's `close` is the platform's release point, which is why the deadline has
to call it rather than only rejecting.

## Rung 4 — public solutions

Not searched for a new dependency: the candidate set and the handle both belong
to the serial owner above, and no library can release a handle the current
binding owns. `docs/decisions/0137` already records why `serialport` cannot
leave the host's loop.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Filter by the record's identity in the driver | One owner (`samePanel`), every family can read `PanelOpenOptions.device` | Families that ignore the field remain permissive | Chosen |
| Filter by family ids only | Fixes the reported adapter, but a second gadget with the same generic ids still competes | A retry can still open a neighbour | Rejected as insufficient |
| Keep probing every port and rank the failures | Needs a second notion of "the panel's port" in the manager | Duplicate identity rule | Rejected |
| Release the handle in `panel-manager.stop` only | The stall path's close can fail or never settle | Retry still meets its own handle | Rejected |

## Rung 6 — smallest probe

Existing unit seams: a fake `SerialTransport` records which path `open` was
called with, and `FakePort.writeHangs`/`drainHangs` reproduce a stalled endpoint
under fake timers. New cases failed before the change and pass after it.

## Decision

`PanelOpenOptions.device` carries the display record's `PanelIdentity`; the
TURZX driver opens only the listed port `samePanel` accepts, and discovery only
considers ports carrying the family's declared ids. The serial transport closes
the OS handle when a write deadline fires. Rejected options either duplicate the
identity rule or leave the handle owned by this process.
