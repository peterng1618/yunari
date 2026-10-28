# 0133 — The panel's PNG layer belongs to whoever drives it, so opening clears it

- **Date:** 2026-10-28
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/`

## The problem

A Yunari theme on the 9.2" panel rendered underneath L-Connect 3's sensor
dashboard: a translucent ghost of the last L-Connect theme, complete with its
frozen values. It survived L-Connect exiting, a warm reboot, and every JPEG the
host pushed. A physical USB power cycle removed it, which is not a fix — the
host must be able to take a panel over from the vendor's software and leave it
clean.

The host cannot clear what it does not know exists. Nothing in this repo or in
the three open drivers describes a second image layer, so the shape of the
problem first had to be established: is the ghost our frame, an LCD artefact, or
a buffer we never write?

## Rung 1 — Yunari

Searched: `panels/` (`panel-protocol.ts`, `tur-usb-panel.ts`, `panel-raster.ts`,
`panel-runner.ts`, `panel-manager.ts`), the display records in
`settings/displays.ts`, and the live `~/.yunari` panel record.

Found:

- `panel-raster.ts` captures the real player page with
  `Page.captureScreenshot({ format: "jpeg" })`. JPEG has no alpha channel, so
  the residue cannot be inside the bytes the host sends — **it is on the panel**.
- The driver sent only version (10), frame rate (15) and push-JPEG (101). It
  named no layer, so this is new protocol surface rather than a wrong flag.
- `panel-image.ts` decodes stills for the Kraken; it had no encoder and no PNG
  path at all.

## Rung 2 — dependencies

Searched: `packages/*/package.json`, the lockfile, `node:zlib` exports.

Found:

- No PNG encoder is installed. `canvas` is present as a fabric peer, but pulling
  a native canvas into the host to write one 3.5 KB file is a decoder-sized
  dependency for an encoder problem.
- `node:zlib` ships `deflateSync` and, since Node 22.2, `crc32` — the two
  primitives a PNG needs. The encoder is chunk framing around them.

## Rung 3 — platform

Searched: the PNG specification's chunk layout; `zlib`'s stream format.

Found: a PNG chunk is length (data only) / type / data / CRC over type+data.
PNG's IDAT is a **zlib** stream, which `deflateSync` produces. Nothing else is
required for an image whose pixels are all zero.

## Rung 4 — ecosystem

Searched: `sgtaziz/lian-li-linux`, `habibrehmansg/infopanel` PR #154,
`andyjusa/hydroshift2-rs`, `deyloop/lianli_207_lcd`, `kewe87/casehud`; L-Connect
3's own service log and bundled theme files; the vendor SDK
`lianli.lcd207.dll` (decompiled with `ilspycmd`).

Found:

- **The reference driver names the two layers**: opcode `0x65` is the background
  (JPEG) and `0x66` is the overlay (PNG). At init it clears both — a transparent
  full-size PNG and a black JPEG — and calls `stop_playback()` before each frame.
- **The SDK gives the layer its switch.** `SetLayer2Status(bool)` sends opcode
  **105 (0x69)** with byte 8 = 1/0. `PushImage(bytes, IsPng)` sends 102 for PNG
  and 101 for JPEG, and writes the length big-endian at bytes 8–11.
- **The SDK's own update path puts the dashboard on that layer**:
  `UpdateLCD(bitmapSensor)` renders the sensor bitmap to PNG and calls
  `PushImage(..., IsPng: true)`. `ApplyTemplate` enables layer 2 when the theme
  has widgets, and clears both layers before drawing a new theme.
- **L-Connect 3's service log** shows it playing an H.264 background and pushing
  a full-size PNG dashboard — matching the SDK, and the user's own reading of
  the ghost as "the dashboard layer, frozen".
- Nobody clears or writes that layer from JavaScript; as in `0130`, the packet
  layer is ours.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Enable layer 2 + transparent PNG on open | the SDK's own clear; one 3.5 KB push per open | 20 lines of PNG framing | none measured | **taken** |
| `StopPlay` (0x7B) | named by the reference driver | one command | tried on hardware: acked, ghost unchanged | rejected |
| hide/show frames (0x68) | a display setter | one command | tried: ghost unchanged | rejected |
| clear-PNG (0x67) | the obvious name | one command | tried: acked, ghost unchanged | rejected |
| Disable layer 2 (0x69 = 0) | hides the layer | one command | tried: ghost still composited | rejected |
| Power-cycle the panel | no code | none | requires the owner's hand; not a takeover | rejected |

## Rung 6 — probe

Measured on the 9.2" (`1cbe:a092`), L-Connect 3 stopped:

- A 464×1920 50%-alpha red PNG pushed with 0x66, **encoded by .NET's
  `System.Drawing`** (7095 bytes), over a green JPEG: the dashboard ghost
  disappeared and the panel showed red over green. So the layer is real, its
  clear is a PNG, and the layer must be shown for the push to land.
- The same image encoded by hand was **rejected** while `System.Drawing`'s was
  accepted. Cause: the hand-written chunk writer put `type+data` in the length
  field instead of `data` (IHDR read 17 instead of 13, IEND 4 instead of 0).
  Some decoders tolerate it; this panel's does not.
- With the length corrected, the transparent 464×1920 PNG came to 3547 bytes and
  the panel's slot was replaced.
- **The freeze after ~16 frames was ours, not the panel's.** Reads timed out
  after 250–300 ms; the panel answers in up to ~2 s, so each short read
  cancelled a pending transfer. After ~16 frames every write came back
  `Cancelled`, `clearHalt` itself hung, and only a replug recovered it. With a
  2 s read **and the reply queue flushed after every command**, 60 of 60
  consecutive frames succeeded — the reference driver's `read_flush()` exists
  for the same reason.
- The frame ack's byte 8 (buffer level) read 0 throughout, so `QueryBlock`
  draining never fired; it is kept for parity with the reference driver, not
  because this workload needs it.

## Decision

`TurUsbPanel.open()` shows the overlay layer (0x69, byte 8 = 1) and pushes one
fully transparent PNG at the panel's geometry, before the first theme frame. The
layer stays shown with nothing on it, which is the state L-Connect itself leaves
for a theme without widgets; hiding it does not clear what it holds.

The PNG is written by `tur-usb-overlay.ts` from `node:zlib` alone, with the
length/CRC rules asserted in `tur-usb-overlay.test.ts` — the malformation that
cost this its first attempt is exactly what a decoder-tolerance test would have
missed.

The same adapter reads every reply with the panel's real latency (2 s) and
flushes the reply queue afterwards, and sends StopPlay before each frame. Those
three are one policy: this panel's transport is stateful, and a short read or an
unread reply damages it in a way no later command repairs.

## Not verified

- **Another TUR-family panel.** Only the 9.2" was measured; the 8.8" row is the
  same protocol by the drivers' account, not by observation.
- **Who owns layer 2 when two programs push at once.** The host refuses to open
  a panel L-Connect holds, so the case is refused rather than arbitrated.
