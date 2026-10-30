# 0006 — Stream the Kraken Z through a two-bucket ring

- **Date:** 2026-10-30
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/kraken-z3-panel.ts`,
  `src/web/packages/host/src/panels/png-raster.ts`,
  `src/web/packages/host/src/panels/panel-image.ts`,
  `src/web/packages/host/src/panels/panel-device.ts`,
  `src/web/packages/host/src/panels/panel-manager.ts`

## Problem

The Kraken Z (1e71:3008, firmware 5.11.0) must follow a live theme — sensor
text and background video — not show one still. The first build sent CAM's own
mode-`0x03` stream packets, and on this unit **they are accepted and shown
nowhere**: every write succeeds and the glass never changes.

## Rung 1 — internal owner

`kraken-z3-panel.ts` owns the transfer header, the HID/bulk split and the bucket
table; `panel-runner.ts` owns cadence and dedupe; `panel-manager.ts` only passes
the device's interval through. No other module speaks this protocol.

## Rung 2 — installed dependencies

`node-hid` and `usb` provide the two transports and nothing about the protocol:
64-byte HID reports, `readTimeout`, interface claim and `nativeTransferOut`.
`ffmpeg-static` cannot feed a live panel; `node:zlib` plus PNG's filter step
does, in process, which is what `png-raster.ts` already implements.

## Rung 3 — native platform

No Node or Windows API knows the LCD's frame format. The facts are the device's
own HID replies (`31 01` LCD info with orientation in byte `0x1A`) and what its
two endpoints accept.

## Rung 4 — public solutions and runtime evidence

- **liquidctl `kraken3.py`**: static transfer is `36 03`, bucket table, delete,
  setup, `36 01`, the 20-byte header (`12 fa … 10`, type `02`, length LE32),
  512-byte bulk chunks, `36 02`, switch `38 01 04 <bucket>`.
- **AIOLCDUnchained (MIT, brokenmass)**: the Z3 row is `RENDERING_MODE.RGBA`;
  it pre-creates 16 buckets, writes each frame into the next one, switches, and
  never deletes per frame. Its bucket-size arithmetic and status codes match
  what this unit reports.
- **OpenKraken / Kraken-Redux** report the bucket ring wedging the Z53/Z63/Z73
  and prefer a full upload per frame. On this Z73 the ring did not wedge: see
  the hardware result below.
- **NZXT CAM 4.76.6, observed on this machine**: its web-integration stream is
  a 20-byte mode-`0x03` header plus 103,424 bytes (a 1,024-byte RGBA palette and
  one index per pixel) about nine times a second.
- **Mode `0x03` never paints here.** Packets of that shape were sent alone, after
  an accepted still, wrapped in `36 01`/`36 02` per frame, after `36 04 00`,
  after `36 03`, after setting display output 0/1/2, and CAM's own captured
  payloads were replayed byte for byte. Every write succeeded; the glass never
  changed. The same hardware paints mode `0x02` stills at once.
- **The display-output command space**: `38 01 <id> <param>` accepts ids 0
  (blank), 1 (boot splash), 2 (liquid) and 4 (bucket); 3 answers `0x0f`
  (FlashNotValid) and 5/6 answer `0x11` (InvalidDisplayOutputID). There is no
  id CAM could have used to enable streaming that this driver has not tried.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Mode `0x03` stream frame | 4x fewer bytes | Does not paint on this firmware at all | Reject |
| Mode `0x01` image/GIF asset | Device plays a file itself | No live sensor text; a file per theme | Not for live themes |
| Full upload per frame, one bucket | Proven framing | Must leave bucket mode to free the bucket, which blanks the glass | Reject |
| **Two-bucket RGBA ring** | **Measured 12.9 FPS, no blank frame** | Two buckets of device memory, deleted and recreated per frame | **Implement** |
| CAM's native SDK | Unknown | 46 MB addon; no public spec | Reject |

## Rung 6 — smallest probe

`scripts`-free probe against the attached Z73 with CAM closed: write a solid
colour per frame, switch buckets, photograph the glass. Two buckets written with
red and green alternate on the glass, which proves the control channel orders
the switch. A rewrite of the bucket that is on the glass leaves the old picture
up, which proves the ring needs a bucket the firmware is not displaying. A
three-minute run wrote 2,316 frames with no failed command.

## Decision

`present` decodes the captured PNG to RGBA and writes it into **the bucket that
is not on the glass**, then switches to it. Two buckets at fixed offsets (`0`
and `401` slots, a frame plus its header being 401 slots of 1024 bytes) alternate;
a bucket that already holds an image is deleted and recreated first, because the
firmware keeps the first graphic stored in a bucket rather than overwriting it.

**The displayed bucket is untouchable.** Deleting it is never answered, starting
a write on it answers status `9` (`BucketIsBeingDisplayed`), and the completing
write answers `16` (`NoTransferringWasInitialized`) — all of which the wire
reports as success for the entry that precedes them. That is why the driver
alternates instead of reusing one bucket.

**The payload goes out in one bulk write.** The endpoint took all 409,600 bytes
in 36 ms, so liquidctl's 512-byte chunking (800 round trips for the same bytes)
buys nothing here.

**The first frame clears the bucket table** — after end-transfer `36 03` and
liquid mode `38 01 02 00`, because the firmware refuses to delete the bucket it
is playing — so the driver's fixed offsets cannot overlap an object left by CAM.

**The driver does not rotate the frame.** The mount angle is the display
record's `rotation`, which the player applies to the composition before the
browser is captured; the `31 01` reply reports one too, and honouring both
turned every frame twice.

The palette encoder leaves with mode `0x03`: `kraken-palette.ts` and its test
are deleted, and `present` sends the decoded plane itself. The runner ticks at
the device's 9 FPS rate, stated by the device as `frameIntervalMs`.

## Hardware result

With CAM closed, the attached Z73 ran the ring for three minutes: 2,316 frames
at 12.9 FPS, and every `32 02`, `32 01`, `36 01`, `36 02` and `38 01` answered
status `1` (Success). Webcam captures seconds apart show different frames, and
a solid-colour probe alternated red and green on the glass.

Through the host, a live video theme reached the panel end to end: 247 frames in
75 seconds (3.3 FPS — the capture, not the wire, is the limit), every frame
status `1`, and the glass changed between captures. A bucket that already held a
graphic did not change when the same bucket was rewritten without a delete,
which is why the driver recreates it each frame.

Mode `0x03` was the earlier decision on this panel and is wrong for it: 47
frames went out and the glass kept the still. The measurements that produced
that framing (header layout, payload layout, nine-a-second cadence) are real;
what they describe is CAM's own state, which a host cannot reproduce from this
firmware with the commands it accepts.
