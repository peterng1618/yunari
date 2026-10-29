# 0005 — A paired panel is retried, its state is reported, and it can be reconnected

- **Date:** 2026-10-30
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/panel-manager.ts`, `src/web/packages/host/src/panels/panel-runner.ts`, `src/web/packages/host/src/main.ts`, `src/web/packages/host/src/server.ts`, `src/web/packages/editor/src/theme-library-client.ts`, `src/web/packages/editor/src/host-settings-mode/client.ts`, `src/web/packages/editor/src/host-settings-mode/region.tsx`, `src/web/packages/editor/src/host-settings-mode/panel-controls-section.tsx`, `src/web/packages/editor/src/editor-shell/icons.ts`, `src/web/packages/editor/src/ui-copy.ts`

## Problem

A panel display stops updating after its device goes away: a restart drops
the USB interface for ~15 s, the vendor app can take the port and release it,
and a power cut re-enumerates the device. The runner keeps writing to a dead
stream (`Cannot call write after a stream was destroyed`), the entry is never
removed, and nothing reopens the device. The owner has no status readout and no
manual recovery.

Every panel family has the same problem because it is a lifecycle problem, not
a protocol one. A phone display does not need it: the display's browser
initiates its own connection.

## Rung 1 — internal owner

`serve/display-launcher.ts` already reconciles every paired local display on a
15 s timer, launching a window when the monitor is attached. `PanelManager`
already owns `reconcile()` (start every panel record with no runner),
`start`/`stop`/`refresh`, and the per-display promise chain. The missing parts
are a timer that calls it, a rule that removes a dead entry, a status read, and
a reconnect action. `PanelRunner` is the one place every frame failure passes
through, so it is where consecutive failures become "lost".

## Rung 2 — installed dependencies

`serialport` reports port errors; the USB families report write failures. No
dependency provides lifecycle recovery. `lucide-react` (already installed)
supplies the three status icons.

## Rung 3 — native platform

`setInterval` (unref'd) is the same mechanism `display-launcher` uses for its
paired monitors. No OS device-notification API is used: a panel that is
re-plugged must be probed, and the existing `family.open()` already probes.

## Rung 4 — public solutions

Searched for this shape — "Node.js serial port reconnect after unplug",
"USB device reconnect polling interval", "display manager retry disconnected
device" — with no reachable search backend in this environment. The prior art
inside the repo (`display-launcher`'s reconcile loop) is the closest
comparable implementation and is reused.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Watcher over device/driver events | Immediate | Not available for the USB bulk families; per-family glue | Reject |
| Per-family reconnect code | Precise | Duplicates lifecycle in every adapter; breaks the `PanelFamily` seam | Reject |
| `PanelManager` retry timer + runner failure threshold | One seam for all families | Three failed frames (~3 s) before a panel counts as lost | **Reuse** |
| Retry only after a command fails | Simple | A panel that loses power with no command never returns | Reject |

## Rung 6 — probe

Unit probes: `panel-runner.test.ts` asserts three consecutive send failures
call `onLost` once and stop feeding; `panel-manager.test.ts` asserts a lost
panel leaves the entry and is restarted by the next `reconcile`, a restart
command detaches, `status` answers connected/connecting/disconnected, and
`reconnect` stops then starts. `server.test.ts` asserts the active map carries
the panel state and the reconnect route reaches the manager. No hardware.

## Decision

- `PanelRunner` counts consecutive failed sends; at three it reports once, stops
  ticking and calls `onLost`.
- `PanelManager` removes a lost entry (clearing its timer, best-effort stop) and
  a periodic `reconcile()` — 15 s, matching `display-launcher`, unref'd — opens
  every panel record again. A restart command detaches on purpose so the loop
  reopens after the interface returns. Repeated identical failure messages are
  logged once per state change.
- `PanelManager.status(displayId)` answers `connected`, `connecting` or
  `disconnected`; `reconnect(displayId)` stops and starts now. A close that
  failed drops the entry and attempts the open anyway: an entry left behind
  holds a runner that is not running, which the retry pass skips, and the status
  would answer `connecting` forever. (TURZX's close propagates a dead
  transport's error; the Lian Li and Kraken closes swallow it, which is why only
  the TURZX panel got stuck.)
- `/api/themes/active` adds `panel: { status, commands }` to a panel record's
  row; `POST /api/displays/:id/panel/reconnect` reaches `reconnect`.
- The editor's Host mode draws a status line with a lucide icon, a **Reconnect**
  button, and the existing controls door, for any panel display whether or not
  the device is attached. The map is polled while the mode is open so the state
  updates by itself.
