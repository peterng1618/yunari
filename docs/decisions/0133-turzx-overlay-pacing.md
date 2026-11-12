# 0133 — Pace the TURZX overlay to what its firmware ingests

- **Date:** 2026-11-12
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/turzx-panel.ts`,
  `src/web/packages/host/src/panels/panel-device.ts`,
  `src/web/packages/host/src/panels/panel-runner.ts`,
  `src/web/packages/host/src/panels/tur-usb-panel.ts`

## Problem

The TURZX 5" panel stops draining its USB CDC OUT endpoint under a live theme.
Writes then never complete, the host's transport deadline trips, and reopening
the port meets the same device until its parent USB node is restarted (0132).
The theme's overlay diff is the only feed that triggers it, so the host has to
decide its own update rate — a wrong choice fails quietly, minutes after the
panel was left running.

## Rung 1 — internal owner

Searched: `TurzxPanel.presentOverlay`, `OpenSerialPort` (`serial-transport.ts`),
`createPanelRunner` (`DEFAULT_PANEL_INTERVAL_MS`), `TurUsbPanel.presentOverlay`,
`overlayUpdate`.
Found: the adapter owns the wire for this family; the runner owns the capture
cadence (1 s) and calls `presentOverlay` only when pixels changed; the Lian Li
adapter paces through the vendor's own stop-play per frame and the Kraken feed
is paced to the glass. No pacing rule existed for TURZX, so the overlay stream
ran at whatever the theme's pixels did.

## Rung 2 — installed dependencies

Searched: `serialport` v13 `write`/`drain`, `SerialPort.update`/`get`, and the
transport's own tests.
Found: `write` hands bytes to the OS and `drain` is `FlushFileBuffers`, so a
write resolves only once the device consumed the buffer (measured: 20–41 KB in
7–111 ms while healthy, one 38 KB body never completing in 10 s at the stall).
`serialport` offers no rate control and no "is the device ready" signal;
hardware flow control is available but the panel reports `cts: false` on a
healthy run and every write completed in milliseconds, so CTS is not what gates
it.

## Rung 3 — native platform

Searched: Windows usbser.sys behavior and the USB bulk OUT contract.
Found: a device that cannot take data NAKs the OUT transaction, and the USB
stack retries until the driver gives up; the device decides when it is ready and
Windows exposes no host-side knob that makes it consume. The platform leaves
only: send slower, or reset the device.

## Rung 4 — public solutions

Searched: Microsoft's bulk-transfer driver documentation; a CDC-ACM/usbser.sys
flow-control thread (embeddedrelated, lpc2000); "USBSER.SYS quirks explained"
(Arm community); "USB CDC device stalling" (Stack Overflow).
Found: the NAK/PING exchange is the only flow control on bulk OUT ("all the host
must do to slow the flow of data is stop issuing transfers"); usbser.sys buffers
about 16 KB IN and polls the interrupt endpoint; a device whose application does
not fetch its OUT buffer stalls the endpoint and the fix is on the device side.
No host-side API fixes a device that stopped consuming.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep sending every changed capture | Simplest | Measured: stalls the endpoint within 56–90 updates | Reject |
| Pace in the TURZX adapter, answer `false` when held back | The adapter owns this family's wire; the runner re-offers the frame | The UI refreshes at the floor, not the capture rate | Reuse (chosen) |
| Wait out the gap inside the queue instead of answering `false` | Same floor | A live feed builds a backlog; every frame arrives late and a stop queues behind the wait | Reject |
| Re-run `INIT_VIDEO_OVERLAY` periodically | Might reset firmware state | Undocumented; each cycle costs a full 1.5 MB transparent frame | Reject, untested |
| Rely on CTS/RTS hardware flow control | No privilege | The panel never asserts CTS, so it gates nothing | Reject |
| Reset the USB node automatically | 0132 measured this | Standing privilege; 0132 rejected | Reject |

## Rung 6 — smallest probe

On the authoring PC, one live theme (`object-chart` gauges, bars and a
`HH:mm` clock over a playing clip), host built with `YUNARI_PANEL_DEBUG=1`:
1.5–2.5 s between updates → the OUT endpoint stalled at update 87 (also 56–90
across earlier runs); every stalled body parsed as a valid diff at the 250-byte
frame boundary.
5 s floor → 296 updates over 31 minutes, no stall.
3 s floor → 332 updates over 22 minutes, no stall.
One update every 6 minutes over the same clip → no stall.
The still path pushed ~240 full 1.54 MB frames without a stall, so bytes and
frame count are not the trigger.

## Decision

`turzx-panel.ts` keeps a 3 s minimum gap between overlay updates; a capture
inside the gap sends nothing and answers `false`. `PanelVideo.presentOverlay`
returns that answer, and `createPanelRunner` treats `false` as "not on the
panel": it keeps the older frame as its base and offers the same pixels again,
so a held-back frame is neither counted as shown nor lost. The Lian Li adapter
answers `true` — its interface drains every overlay sent.
