# 0130 — Panel controls reuse the driver's own control channel

- **Date:** 2026-11-10
- **Status:** accepted
- **Paths:**
  - `src/web/packages/host/src/panels/kraken-z3-panel.ts`
  - `src/web/packages/host/src/panels/tur-usb-control.ts`
  - `src/web/packages/host/src/panels/tur-usb-panel.ts`

## Problem

Two built-in panel families drive glass but expose no controls, while the Turzx
driver already exposes brightness and status. A second control surface would
duplicate the route, the editor dialog and the manifest command vocabulary, and
the copies would drift. The integration work is where a wrong choice fails
quietly: a brightness write that carries the wrong field layout, a query that
races the frame ring, or a byte range taken from a neighbouring product.

## Rung 1 — internal owner

Searched: CodeGraph for `PanelControls`, `PanelControlCommand`, `PanelCommand`,
`TurzxPanel`, `KrakenPanel`, `TurUsbPanel`, `panelCommand`, `PanelControlsSection`
and the family rows.

Found: the seam is complete. `PanelDevice.controls` is the optional contract;
`PanelFamily.commands` is what the editor renders; `PanelControlsSection`
already draws a brightness field and a status button from that list; the route's
`panelCommand` already admits both kinds. `TurzxPanel` implements the contract
with a private `runControl`. The Kraken and Lian Li drivers and their family rows
are the only gaps. No second mechanism is needed.

## Rung 2 — installed dependencies

Searched: `node-hid`, `usb`, `node-forge`, `KrakenControl`, `commandPacket`.

Found: `KrakenControl` already writes one 64-byte HID report and reads until a
matching prefix; `commandPacket` already builds the DES-CBC 512-byte Lian Li
frame; `node-forge` supplies the cipher. No new dependency and no lifecycle
change.

## Rung 3 — native platform

Searched: Node's `TextDecoder` and timers.

Found: `TextDecoder` decodes the Lian Li GetVer reply body without a dependency.
There is no OS or runtime API that sets an LCD's backlight, so the device
protocol is the only route.

## Rung 4 — public solutions

Searched: liquidctl `kraken3.py`, `immortalbob/lian-li-universal-screen-protocol`,
`andyjusa/hydroshift2-rs`, `turing-smart-screen-python`, L-Connect captures.

Found:

- **Kraken Z3 (liquidctl).** `set lcd screen brightness` reads `30 01`, parses
  `31 01` (brightness byte `0x18`, orientation byte `0x1A`), then writes
  `30 02 01 <percent> 00 00 01 <orientation>`. Firmware is `10 01` → `11 01`
  with major/minor/patch at bytes `0x11..0x13`.
- **Lian Li TUR_USB (immortalbob, `1CBE:A088`).** Brightness is opcode `0x0E`,
  parameter byte 8, a **0–100 percent** value (L-Connect's own constants are 0
  and 100; lian-li-linux sends raw 0–100). GetVer `0x0A` answers an ASCII,
  zero-terminated firmware name from reply byte 8.
- **HydroShift II (`1CBE:A021`, andyjusa).** Uses opcode `0x0E` with a 0–255
  byte, but it is a different product with a different header envelope. Its
  range is rejected for this family.
- **TURZX-branded panels.** Share the header, frame and H.264 commands, which
  corroborates the transport but not the brightness range on Lian Li firmware.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| New control API, route and dialog | None: duplicates every owner | Second vocabulary to keep in step | Rejected |
| `PanelControls` on each driver + family rows | Uses the existing editor and route unchanged | Driver byte work only | **Chosen** |
| Plugin family wrapping the hardware | Wrong owner; a worker for a built-in | Device handle leaves the host, consent row needed | Rejected |
| Software dimming of the captured frame | No effect on the backlight | Pretends to control hardware | Rejected |

## Rung 6 — smallest probe

No executable probe was needed: both control channels are already opened and
exercised by each driver's `open()` (Kraken `10 01`/`30 01`, Lian Li `version`),
and the byte layouts above come from captures and published drivers. Hardware
confirmation of the brightness change on the glass is a human step after the
code lands.

## Decision

Extend `PanelControls` on `KrakenPanel` and `TurUsbPanel` and declare
`"brightness"`, `"screen"` and `"status"` on their `PanelFamily` rows. Lian Li
sends the 0–100 percent directly at byte 8 and reads GetVer's ASCII body for
status. Kraken reads the current orientation from `31 01` and carries it into the
brightness write, and both controls are serialized behind the frame writer so a
manual command cannot interleave with the bucket ring. The Lian Li control
channel lives in its own module so the streaming driver stays under the size
stop; it takes the driver's own locked `request`/`exclusive` rather than a
second transport.

**Screen is the brightness opcode, not a second one.** Neither family documents a
report that blanks the glass, so off writes level 0 and on restores the level
this host last wrote — the tradeoff `TurzxPanel` already made when its sleep
opcode turned out to take the device off the bus. That reuses the one write path
the panels have proved, stays recoverable across a level request, and fills the
screen control the editor already draws for a family that declares it. The two
remaining Turzx controls, `panel-settings` and `restart`, stay undeclared: no
proven opcode carries them on these models, and a declared command with no
correct bytes is worse than an absent one, because the dialog draws it.

No new command kind, no route change and no editor change — `screen` is already
in the union, the route's `panelCommand` already admits it, and
`PanelControlsSection` already draws its two buttons. The 9.2" brightness range
is inferred from the sibling 8.8" firmware and L-Connect's constants; if the
glass behaves wrong, that mapping is the first suspect.
