# 0102 — A transient panel refusal is not a mode

- **Date:** 2026-11-03
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/panel-runner.ts`

## Problem

Two panel-lifecycle rules treated the first refusal as the panel's permanent
capability, and either one left the panel unable to recover without being
reassigned:

- A clip start or overlay send that failed once set the runner to stills for
  the rest of its life. A save of the assigned theme restarts the runner and
  then publishes a revision the page follows with a full navigation; that race
  can produce one opaque overlay capture (oversize on the Lian Li) or one clip
  start against a page mid-navigation, and the panel then stayed at 1 fps
  low-resolution stills.
- `stop()` returned at the first release that threw. When a disconnected
  panel's clip stop rejected, the rasteriser and the device were never closed,
  so the host kept its own serial/HID handle. Reopening then answered
  `EACCES`/`EBUSY`, which the TURZX adapter reported as another program — the
  vendor app — holding the port. That hold is the host's own stale handle.

## Rung 1 — internal owner

Searched: CodeGraph and source for `createPanelRunner`, `PanelRunner.stop`,
`runTick`, `panel-manager.stopNow/detachNow/refreshNow`, `refreshVideoNow`,
`theme-writes` save path, `turzx-panel.close`, `tur-usb-panel.close`,
`kraken-z3-panel.close`, `serial-transport.close`.

Found: `panel-runner.ts` is the one owner of a runner's life and of the
device/rasteriser pair it acquired. The manager delegates every release to
`runner.stop()`. The adapters' own `close()` already release unconditionally
where they control the sequence (Lian Li releases the interface and device in
separate `try`s; the Kraken bulk half releases then closes). The runner was the
one place that stopped early, and the one place that made a refusal permanent.

## Rung 2 — installed dependencies

Searched: `serialport`'s `SerialPort.close` callback and `isOpen`, node-hid
`HID.close`, `usb` `releaseInterface`/`close` (through the adapters' fakes and
source). Found: each handle release is independent; nothing in the bindings
requires the clip stop or the page close to succeed first. The OS reuses the
port only after the last handle closes, so skipping `device.close()` is what
makes the next open fail.

## Rung 3 — native platform

Searched: Windows serial and HID handle semantics via the existing adapter
comments and the `EBUSY`/`EACCES`/`EPERM` mapping in `turzx-panel.ts`. Found:
access-denied is indistinguishable by code from another process holding the
port; the host cannot tell "vendor app" from "my own leaked handle", so it must
not leak one.

## Rung 4 — public solutions

Searched: retry/backoff patterns for device transport start-up and resource
release (the existing `panel-manager` retry pass, `startNow`/`reconcileNow`),
and the codebase's own prior art in `tur-usb-panel.close()` (two independent
`try` blocks) and `kraken-z3-panel` bulk `close()`. Found: the repo's accepted
pattern is "attempt every release, swallow per-handle failure when the device
is gone, and let the caller decide". A bounded retry before declaring a
capability absent is already how `panel-manager` handles a lost panel.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Leave one-shot fallbacks, rely on reassignment | Fits nothing: the report is the reassignment workaround | Owner must notice and act | Rejected |
| Restart the whole runner after a video failure | Correct recovery but loses the page and re-uploads on every hiccup; the manager owns restarts | Retry policy duplicated in the manager | Rejected |
| Retry the video path a bounded number of times inside the runner | Smallest change at the owner; keeps `onLost` for a real port loss | Three uploads for an unplayable clip, bounded | Chosen |
| Release each acquired handle independently in `stop()` and rethrow the first failure | Matches the adapters' own close pattern and the manager's reporting | None | Chosen |

## Rung 6 — smallest probe

No hardware probe was available for this report. The runner seam is executable
without a device: `panel-runner.test.ts` drives a fake `PanelDevice` and
`Rasterizer` and asserts (a) a single overlay refusal is retried, (b) a single
clip-start failure is retried, (c) three consecutive refusals end in stills,
and (d) `stop()` still closes both the rasteriser and the device when an
earlier release throws. The tests failed against the previous implementation
for the stated reasons before the change.

## Decision

Retry the clip start and the overlay send up to `VIDEO_ATTEMPTS_BEFORE_STILLS`
(3), and only then treat the device as having no video mode. Release every
handle `stop()` acquired, rethrowing the first failure so the manager reports
it. A refused overlay is reported but not counted toward `onLost`: it is an
answer from a live device, and the still path that follows will surface a
genuinely lost port.
