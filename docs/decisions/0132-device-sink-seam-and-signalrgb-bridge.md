# 0132 — One device sink seam, and the SignalRGB bridge on it

- **Date:** 2026-11-12
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/device-sink.ts`,
  `src/web/packages/host/src/panels/kraken-lighting.ts`,
  `src/web/packages/host/src/panels/kraken-z3-panel.ts`,
  `src/web/packages/host/src/panels/panel-device.ts`,
  `src/web/packages/host/src/panels/panel-manager.ts`,
  `src/web/packages/host/src/signalrgb/bridge.ts`,
  `src/web/packages/host/src/server/devices-routes.ts`,
  `src/web/packages/host/src/server/options.ts`,
  `src/web/packages/host/src/settings/signalrgb-bridge.ts`,
  `src/web/packages/host/src/server.ts`,
  `src/web/packages/host/src/main.ts`

## Problem

Yunari already owns `1e71:3008` for the LCD. Lighting and fan writes must share
that one handle and its serialised write queue, and SignalRGB must reach them
over loopback without opening HID itself. Two silent failures are possible: a
second handle (scrambled glass, dropped reports) and a write interleaved into an
LCD command sequence (a `22` report read as a bucket reply, or a `75 01` read as
an answer to the wrong command). A bolt-on Kraken route would also mean a second
device registry, which the seam must not have.

## Rung 1 — internal owner

Searched: `panel-device.ts` (`PanelDevice`, `PanelControls`, `PanelFamily`),
`panel-manager.ts` (`Entry.device`, `exclusive` in the driver), `server.ts` and
`server/displays-routes.ts` (how panel routes reach the manager), and the shipped
plugin source at
`%LOCALAPPDATA%\WhirlwindFX\SignalRgb\cache\plugin_cdn\main\Plugins\Nzxt\Nzxt_Kraken_Z3_AIO.js`.

Found: the Kraken driver already owns `HID.HID`, `openBulk()`, `KrakenControl.readUntil`
and one `exclusive` promise chain used by every LCD command. `PanelDevice` is the
device seam every driver already implements, and `PanelManager` holds the one open
instance per display. What was missing is a vocabulary for lighting/controls, and
a way for routes and the receiver to reach the opened device without opening it.

## Rung 2 — installed dependencies

Searched: `node-hid`, `usb`, `node:dgram` (Node 22+), existing `panel-*` tests.

Found: `node-hid` writes a fixed 64-byte report and `readTimeout` matches what
the driver already uses; `usb` is only needed for the bulk LCD path and is not
reopened. `node:dgram` supplies a UDP socket with `bind` on `127.0.0.1`; it
donates no frame coalescing, so the receiver keeps one pending frame itself.
No dependency is added.

## Rung 3 — native platform

Searched: Node's `dgram` and `Buffer` APIs, `setInterval`.

Found: `dgram.createSocket("udp4")` binds loopback and delivers one datagram per
message. It gives no ordering/sequence number beyond UDP delivery order, so
"newest wins" is implemented as a single pending buffer replaced on arrival.

## Rung 4 — public solutions

Searched: the shipped SignalRGB plugin above (the public reference for this
device, plain JS) and its `Validate` (`interface === 1`), `StreamLightingPacketChanneled`,
`SubmitLightingColors`, `SetFanSpeed`, `setPumpSpeed` and `getStatus`.

Found: the plugin's exact report bytes, the pump's 25% floor, the 40-byte fan
payload, the `74 01` → `75 01` status field offsets, and one correction to the
task brief: the plugin asks the device for **GRB** (`getColors("Inline", "GRB")`),
so the HID payload is reordered per LED even though the UDP contract carries RGB.
It also confirms `Size()` is 4×4 for the layout shape, and 40 LEDs on one channel.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Second HID handle opened by the bridge | Drives LEDs without touching the driver | Two handles on one composite device; no shared queue; contradicts the measured scramble | Rejected |
| Kraken-specific HTTP routes calling `openKraken` | Shortest route code | A second registry and a second open path; violates one-owner | Rejected |
| Extend `PanelDevice` with a `sink` descriptor owned by the driver, manager exposes opened sinks | Uses the existing open instance, its control object and `exclusive` queue | A small registry surface and UDP receiver | Chosen |
| Plugin/extension route | Generic by construction | Would need a broker token and a second write path for a built-in device | Rejected for now |

## Rung 6 — smallest probe

Behaviour was established from the shipped plugin source (a public artifact) and
the existing fake-HID suite. Hardware acceptance of the `22`/`72`/`74` reports is
the remaining probe; it is scheduled against the open device after unit tests.

## Decision

Extend the existing panel seam rather than add a parallel one:

- `panels/device-sink.ts` is the device vocabulary (lighting metadata, telemetry,
  controls, `DeviceSink`), and `PanelDevice.sink` is its one attachment point.
- `panels/kraken-lighting.ts` owns the byte layout and clamping from the shipped
  plugin; `KrakenPanel` exposes a `sink` whose writers call the existing
  `exclusive` queue, so LCD, LED and fan reports cannot interleave.
- `panels/panel-manager.ts` answers the sinks of currently running devices,
  sorted by stable id; that order is the UDP device index.
- `signalrgb/bridge.ts` owns the UDP socket, newest-frame coalescing, counters and
  the forced/off/canvas modes. `server/devices-routes.ts` is the loopback HTTP
  surface over the same sinks. Neither opens hardware.
- `GET /api/devices` was already the assignment surface's route, so the
  descriptor rides in that answer beside `available`/`assigned` rather than
  taking the path; the subpaths that act on one device are the new routes.
  Both consumers ignore fields they do not read.
