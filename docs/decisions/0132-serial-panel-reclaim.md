# 0132 — A panel that stops answering is released, and can be reset

- **Date:** 2026-11-10
- **Status:** accepted
- **Paths:**
  - `src/web/packages/host/src/panels/serial-transport.ts`
  - `src/web/packages/host/src/panels/turzx-panel.ts`
  - `src/web/packages/host/src/panels/panel-device.ts`
  - `src/web/packages/host/src/panels/panel-device-reset.ts`
  - `src/web/packages/host/src/server/panel-reset-route.ts`
  - `src/web/packages/host/src/server/displays-routes.ts`
  - `src/web/packages/host/src/server/options.ts`
  - `src/web/packages/host/src/server.ts`
  - `src/web/packages/editor/src/settings-mode/client.ts`
  - `src/web/packages/editor/src/settings-mode/host-state.ts`
  - `src/web/packages/editor/src/settings-mode/panel-controls-section.tsx`
  - `src/web/packages/editor/src/settings-mode/pages/displays-page.tsx`
  - `src/web/packages/editor/src/ui-copy.ts`

## Problem

A TURZX panel whose USB endpoint stops consuming data leaves every write
pending forever. `OpenSerialPort.write` has no deadline, so the probe or runner
that started the write holds the COM handle indefinitely. Every later open then
answers `EACCES` ("Access denied"), and the host reports its own stale handle as
another program holding the port. Only killing the process clears it, and the
panel itself stays unusable until a machine restart.

Measured on the authoring PC, 2026-11-10:

- With the host running, a second process could not open `COM5`
  (`Access to the path 'COM5' is denied`).
- Stopping the host freed the port at once; a fresh host re-took it within six
  seconds and reported `Access denied` again.
- An isolated `serialport` write and a .NET `SerialPort` write both failed with
  `ERROR_SEM_TIMEOUT` ("The semaphore timeout period has expired"), i.e. the
  device's OUT endpoint is not consuming — not another application's lock.
- Restarting the COM child device (`pnputil /restart-device
  USB\VID_1D6B&PID_0106&MI_00\…`) left the wedge. Restarting the **parent
  composite device** (`USB\VID_1D6B&PID_0106\…`) cleared it; HELLO then answered
  `chs_5inch.dev1_rom1.88` immediately.

## Rung 1 — internal owner

Searched: `OpenSerialPort`, `write`, `close`, `identify`, `openTurzxPanel`,
`attachedTurzxPanels`, `heldPanels`, `heldOpenReason`, `createPanelRunner`,
`stopNow`, `detachNow`, decisions 0002, 0005, 0065.

Found: `serial-transport.ts` is the one owner of the `serialport` seam and the
only place a write deadline can live. `turzx-panel.ts` owns discovery, the
open-time commands and the held-port sentence. `panel-runner.ts` already
attempts every release on stop (its comment records the 2026-11-03 instance of
this same leak), but it awaits a write that never settles, so the release is
never reached. The manager's retry loop is already correct once the port is
released. Nothing in the repo resets a USB device.

## Rung 2 — installed dependencies

Searched `@serialport/stream/dist/index.js` and
`@serialport/bindings-cpp/dist/win32.js`:

- `WindowsPortBinding.close()` nulls `fd` before awaiting `asyncClose`, so a
  failed close is invisible above it and the OS handle cannot be retried.
- `SerialPort.close()` rejects a write that is in progress but does not bound a
  write the USB stack has not completed.
- No dependency provides a write deadline, a device reset or an elevated
  helper.

## Rung 3 — native platform

Searched: `COMMTIMEOUTS` via .NET `SerialPort.WriteTimeout`, `DeviceIoControl`
on the COM handle, `pnputil /restart-device`, `devcon restart`, and the UAC
manifest of the vendor application.

Found: Windows itself gives a bounded write failure (`ERROR_SEM_TIMEOUT`) when
the device stops taking data; the Node binding simply never surfaces a timeout
unless the caller sets one. `IOCTL_SERIAL_RESET_DEVICE` (0x001B009C) answered
`ERROR_INVALID_PARAMETER` on this driver and an adjacent control code hung the
probe, so the COM handle is not a reset path. A child-device restart does not
clear the wedge; a **parent** composite-device restart does. `pnputil` and
`devcon restart` require elevation (`devcon restart` → "Restart failed" from an
unelevated shell), and the TURZX vendor application's manifest is
`requireAdministrator` — that is why it never meets the wedge.

## Rung 4 — public solutions

No web search was used: the failure is on this machine's hardware and the
platform behaviour above was measured directly. The vendor's own troubleshooting
note ("check WMI, close other RGB software") describes a different failure and
offers no reset.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Bound writes in the transport | Owner is the serial seam; stops the self-trap for every caller | Does not reset a wedged device | Reuse (required) |
| Bound close in the transport | Surfaces a close that never happened | Cannot force an OS handle closed | Reuse |
| `IOCTL_SERIAL_RESET_DEVICE` from the host | No elevation needed | Not implemented by usbser (probe: invalid parameter; another code hung) | Reject |
| Equip the host with a permanent elevated helper | Silent reset | Installs a privileged mechanism on the machine; security review demanded | Reject |
| Prompted elevated parent-device restart | Uses the measured reset; one UAC prompt per use; no standing privilege | A prompt the owner can decline; no feedback from the elevated process | Reuse |
| Replug-only message | No privilege | Owner must reach the cable | Keep as fallback in the message |

## Rung 6 — smallest probe

Executed on the authoring PC: session-hung-vs-host-stopped COM5 open (proved the
host's own handle), `serialport` and .NET writes against the wedged device
(proved `ERROR_SEM_TIMEOUT`), child vs parent `pnputil /restart-device` (only
the parent cleared it), and a HELLO round trip after the parent restart (proved
the panel was fully alive). The transport tests use a fake port whose write
callback never fires.

## Decision

1. `OpenSerialPort.write` gets a 10 s deadline (a 1.5 MB frame is ~0.6 s on the
   wire); on expiry the transport is marked closed, later writes fail fast, and
   the error names a device that stopped accepting data.
2. `OpenSerialPort.close` gets a 5 s deadline and reports a close that failed
   instead of resolving as if it succeeded.
3. `openTurzxPanel` keeps the held-port sentence only for an open refusal
   (`EACCES`/`EBUSY`) and names a panel that opened but did not answer.
4. A panel that is attached and disconnected can be reset from Host settings:
   the host resolves the record's PnP instance id from the port listing (never
   from the request), resolves the parent composite id, validates both against
   the USB instance-id shape, and runs `pnputil /restart-device <parent>` through
   `Start-Process -Verb RunAs`. The retry loop reopens the panel.
