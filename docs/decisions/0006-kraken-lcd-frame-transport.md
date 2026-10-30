# 0006 — Stream the Kraken Z one paletted frame per upload

- **Date:** 2026-10-30
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/kraken-z3-panel.ts`,
  `src/web/packages/host/src/panels/kraken-palette.ts`,
  `src/web/packages/host/src/panels/png-raster.ts`,
  `src/web/packages/host/src/panels/panel-image.ts`,
  `src/web/packages/host/src/panels/panel-device.ts`,
  `src/web/packages/host/src/panels/panel-manager.ts`

## Problem

The Kraken Z (1e71:3008, firmware 5.11.0) shows one still image, its colours are
rotated through the wrong channels (green appears blue, pink lime), its rotation
is inconsistent between uploads, and it never animates. A live theme must update
with its sensor text and background video, so a still per minute is not the
product. The static path also owns device-side bucket state, and writing into the
bucket currently on screen tears the image instead of erroring.

## Rung 1 — internal owner

`kraken-z3-panel.ts` owns the transfer header, the HID/bulk split and the bucket
table; `panel-runner.ts` owns cadence and dedupe; `panel-manager.ts` only passes
the device's interval through. No other module speaks this protocol, and no
parallel upload path exists.

## Rung 2 — installed dependencies

`node-hid` and `usb` provide the two transports and nothing about the protocol:
64-byte HID reports, `readTimeout`, interface claim and `nativeTransferOut`. They
do not order channels, rotate pixels, quantise colour or pace frames.

`ffmpeg-static` decodes an arbitrary still to RGBA. It cannot feed a live panel:
`decodeStill` starts a process and checks the 80 MB binary's digest on every
call, measured at 220-250 ms per 320x320 PNG on this machine, which held the
first streaming build to 2.7 FPS with every write succeeding. Keeping one
ffmpeg alive instead does not work on this build: with `png_pipe`,
`image2pipe` or `rawvideo` input, and with `-flush_packets 1`, it produced no
output byte and no output file until its stdin reached EOF, in an interactive
pipe and in a file-writing test alike. Node's own `zlib` inflates a PNG's IDAT
stream with no process at all; what remains is undoing the five row filters,
which is the PNG specification and about a hundred lines.

## Rung 3 — native platform

No Node or Windows API knows the LCD's frame format or orientation. The facts are
the device's own HID replies (`31 01` LCD info with orientation in byte `0x1A`)
and what the bulk endpoint accepts.

Node does own one necessary piece: `node:zlib` inflates the PNG the rasteriser
already produced, and PNG's filter step is a published format. The capture is
Chromium's own screenshot — `RGB` or `RGBA`, 8-bit, non-interlaced — so the
decoder refuses every other form by name rather than guessing.

## Rung 4 — public solutions and runtime evidence

- **liquidctl `kraken3.py`**: static payload is `R,G,B,0`; the image is rotated
  by `orientation * -90` from byte `0x1A` of the `31 01` reply; static transfer
  is `36 03`, bucket table, delete, setup, `36 01` + 20-byte header (`12 fa … 10`,
  mode `02`, length LE32), 512-byte bulk chunks, `36 02`, switch
  `38 01 04 <bucket>`. `_prepare_bucket` retries the next index when a delete is
  refused, and deletes twice when no bucket was free.
- **OpenKraken `device.py` / `PROTOCOL.md`**: the full per-frame static upload is
  stable on this model (2,349 frames, zero errors, Z73 firmware 5.11.0) while the
  bucket ring wedges the Z53/Z63/Z73; their streamer treats ~1 FPS as the static
  ceiling.
- **NZXT CAM 4.76.6, observed on this machine** (Frida hooks on the renderer's
  `WinUsb_WritePipe`/`WinUsb_ControlTransfer`/`WriteFile`/`HidD_*`, web
  integration streaming a Yunari theme at `frameRate: 9`): steady state is one
  **20-byte bulk header then one 103,424-byte bulk write to pipe 2**, about nine
  times a second. The header is the same 12-byte magic, then mode byte `0x03`
  and three zero bytes, then the payload length as LE32:
  `12 fa 01 e8 ab cd ef 98 76 54 32 10 03 00 00 00 00 94 01 00`.
- **The payload is a palette and an index plane.** The first 1,024 bytes are 256
  entries of `R,G,B,A`; the remaining 102,400 bytes are one 8-bit palette index
  per pixel, row-major 320x320. Decoding a captured frame with that layout
  reproduces the page, and the frame needs a 90-degree counter-clockwise turn to
  be upright, which is CAM pre-rotating for the mount the way liquidctl does.
- **There is no control command in steady state, and none to resume.** Switching
  the LCD away and back sent mode `0x01` once with a 141,517-byte payload (the
  Image/GIF asset) and resumed mode `0x03` with no HID or control transfer at
  all, so entering the streaming format is the header itself. The palette and
  indices change on every frame.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Static bucket upload per frame | Proven framing | 1 FPS, device-owned bucket state, tears on a displayed bucket | Retire |
| CAM's native SDK | Unknown | 46 MB addon cannot ship; no public spec | Reject |
| Mode `0x01` image/GIF asset | Device plays a file itself | No live sensor text; a GIF must be authored per theme | Not for live themes |
| **Mode `0x03` streaming frame** | **4x less payload than a still, no device state, ~9 FPS observed on this hardware** | Decode the PNG in process and quantise RGBA to 256 colours; host must keep sending | **Implement** |

The streaming frame is a quarter of the static upload's bytes (103,424 against
409,600), needs no bucket deletion or switch, and is the format CAM itself chose
for a live page. The cost is that the picture depends on the host: the panel
keeps the last frame but does not animate with the host gone, which matches the
product's panel runner always running while the display is assigned.

## Rung 6 — smallest probe

`kraken-palette.test.ts` pins the palette channel order, the rotation of a marked
pixel into its destination corner, and that a flat raster costs one palette
entry. `png-raster.test.ts` decodes generated PNGs that use each of PNG's five
row filters, and refuses a palette image, an interlaced image and a size the
panel did not ask for. The hardware probe is a frame sent by this driver with
CAM closed, checked against the same theme CAM currently streams.

## Decision

`present` decodes the captured PNG in process (`node:zlib` plus PNG's filter
step), encodes one 320x320 frame as a `1,024`-byte RGBA palette plus 320x320
indices, rotates it by the `31 01` orientation byte (clockwise quarter turns, as
liquidctl does), and sends the 20-byte mode-`0x03` header followed by that
payload in one bulk write. ffmpeg stays for arbitrary stills only: a per-frame
process costs 250 ms, and this build emits nothing before input EOF, so it
cannot be held open for a live stream. The bucket table, slot arithmetic and
switch commands leave the driver: they only served the static format. The runner
ticks at the device's 9 FPS rate, stated by the device as `frameIntervalMs`. The
bucket table, slot arithmetic and switch commands leave the driver: they only
served the static format, and no family keeps a frame on the device any more, so
`PanelFamily.stores` leaves with them.

## Hardware result

With CAM closed, this driver against the attached Z73 sends 47 frames and 47
headers in six seconds (7.8 frames a second against CAM's 9), with no failed
transfers in the log. One frame read off the wire decodes to the theme's own
render: the green gauge reads `38,211,161` against the page's `43,214,160` and
the flame `239,178,38` against `236,178,49`, which is median-cut error rather
than a channel swap. The payload is the page turned one quarter clockwise, the
same turn CAM's captured stream carried for this mount.
