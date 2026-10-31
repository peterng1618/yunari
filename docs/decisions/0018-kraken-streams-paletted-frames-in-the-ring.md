# 0018 — Stream the Kraken Z with paletted frames in its bucket ring

- **Date:** 2026-10-31
- **Status:** superseded by 0020 — mode `0x03` does paint, but its 256 colours
  band on a gradient or a photograph, so the live stream is mode `0x02` again.
- **Supersedes:** 0006
- **Paths:** `src/web/packages/host/src/panels/kraken-z3-panel.ts`,
  `src/web/packages/host/src/panels/kraken-palette.ts`

## Problem

The Kraken Z (1e71:3008, firmware 5.11.0) must follow a live theme smoothly.
0006 concluded mode `0x03` "never paints this firmware" and shipped a two-bucket
RGBA ring at 12.9 FPS. On this hardware a mode-3 frame costs 36 ms against 64 ms
for a full RGBA frame, and the panel still stutters at a 70 ms cadence. The
protocol claim 0006 rests on is wrong, and the wrong claim is what makes the
driver spend 4x the wire time.

## Rung 1 — internal owner

`kraken-z3-panel.ts` owns the transfer header, the HID/bulk split and the bucket
table; `panel-runner.ts` owns cadence, overlap and dedupe. The median-cut
encoder that writes mode-3 frames was written in 8278a432
(`kraken-palette.ts`) and deleted in 60f5db33 when 0006 rejected the mode; it is
in `git show 60f5db33^`. No other module speaks this protocol, and no other
module quantises.

## Rung 2 — installed dependencies

`node-hid` and `usb` carry the two transports and nothing about the format.
`png-raster.ts` decodes the capture in process. No installed package quantises
an image; `ffmpeg-static` cannot serve a live panel (220–250 ms per frame, and
this build emits nothing until EOF).

## Rung 3 — native platform

No Node or Windows API knows the LCD's frame format. The device's own replies
are the only authority: `31 01` reports 320x320, brightness and orientation
byte `0x1A` (this unit: `0x01`, a quarter turn, which the display record's
rotation already compensates — so the driver must not rotate, in either mode).

## Rung 4 — public solutions and runtime evidence

- **liquidctl `kraken3.py`** uses mode `0x02` stills and mode `0x01` GIFs only;
  nothing in it sends mode `0x03`. It rotates static images by the orientation
  byte.
- **AIOLCDUnchained (MIT, brokenmass)** uses `RENDERING_MODE.RGBA`, a
  pre-created bucket ring, and never per-frame buckets.
- **NZXT CAM 4.76.6, captured with USBPcap over a 586 s boot** (snaplen 4096,
  bus 1 device 12): after launch CAM streams 2,968 mode-`0x03` frames at ~110 ms.
  Every frame is a **bucket upload**, not a bare stream packet:
  `32 02 <idx>` (twice, delete), `32 01 <idx> <idx+1> <start LE16> 65 00 01`
  (create at 101 slots), `36 01 <idx>` → `37 01` status 1, the 20-byte header
  `12 fa 01 e8 … 10 03 00 00 00 00 94 01 00`, the 103,424-byte payload,
  `36 02 <idx>` → `37 02`, `38 01 04 <idx>` → `39 01`. Bucket indices rotate
  and each starts at `index * 101` slots.
- **Replaying CAM's own 350 captured mode-3 payloads with that sequence paints
  the glass.** With CAM closed, a probe sent them at 110 ms and the panel played
  them (solid-colour frames photographed on the glass; a black frame turns it
  black). 0006's failures all omitted the per-frame bucket commands — a mode-3
  payload is uploaded into a bucket and shown by a switch like any still.
- **Orientation is the same in both modes.** A quadrant pattern sent as mode
  `0x02` and as mode `0x03` appears identically: the firmware shows the plane
  turned a quarter turn for this unit's reported orientation. Rotating in the
  driver as well would turn the picture twice, which is what 0006 already
  decided and still holds.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Mode `0x02` RGBA in a ring | Proven framing | 409,600 bytes/frame = 37 ms of bulk and 64 ms/frame; no slack at 70 ms | Reject |
| Mode `0x03` bare stream, no bucket commands | 4x fewer bytes | Does not paint — this was 0006's mistake | Reject |
| **Mode `0x03` into a 101-slot bucket ring** | **36 ms/frame measured; CAM's own protocol** | 256-colour quantisation; 8-bit colour depth | **Implement** |
| CAM's native SDK | Unknown | 46 MB addon; no public spec | Reject |

## Rung 6 — smallest probe

Against the attached Z73 with CAM closed: CAM's captured payloads replayed
through the full bucket sequence painted; the same payloads without it did not.
Solid and black frames changed the glass on command. A per-phase timing probe
measured `delete 6 ms, create 6 ms, start 6 ms, bulk 10 ms (mode 3) vs 37 ms
(mode 2), end 3 ms, switch 6 ms` — 36 ms against 64 ms per frame. A mode-2
401-slot bucket was refused (status 5) while a neighbouring 101-slot bucket
existed, so the table is cleared in liquid mode before the ring is built.

## Decision

`present` quantises the decoded capture to the wire's 256-entry palette plus one
index per pixel (`kraken-palette.ts`, median cut over 5-bit bins) and uploads it
as mode `0x03` into a **three-bucket ring of 101 slots**, each bucket deleted and
recreated per frame because the firmware keeps the first graphic stored in one.
The ring is deep enough that the bucket on the glass is never the one being
written. The frame is sent unturned; the display record's rotation is the only
rotation.

The encoder is the one deleted in 60f5db33, restored for this transport, with
three changes that the glass made necessary:

- **Palette entries are true means.** The restored encoder rebuilt each entry
  from its 5-bit bin, which caps a channel at 4 units of error before the
  cluster's own error is counted. The histogram now carries exact channel sums.
- **A pixel is mapped to the nearest of the 256 colours, not to its own box's
  mean.** Where the boxes are uneven the nearest mean belongs to another box,
  and the box's own mean leaves an error dithering cannot hide.
- **Each pixel is error-diffused (Floyd–Steinberg).** A 320-pixel smooth run
  holds more than 256 colours, so a nearest-entry answer draws them as hard
  bands and a fresh palette each frame makes those bands move — the flicker the
  glass showed on a gradient theme. A diffused colour can leave the cells the
  frame held, so an empty cell falls back to the pixel's own cell: the default
  (palette entry 0) is black, and that error compounds until the frame is black.
  Measured on a circle-of-gradient frame, the frame collapses to 26 of its 256
  entries without the fallback and uses 255 with it.
