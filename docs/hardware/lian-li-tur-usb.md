# Lian Li TUR_USB LCD panels

- **Family:** TUR_USB (shared with other Lian Li/TURZX screens; this document
  covers the Lian Li members)
- **Models:** Lian Li 9.2" LCD, USB `1cbe:a092`, wire geometry 464×1920 ·
  Lian Li Universal Screen 8.8", USB `1cbe:a088`, wire geometry 480×1920
- **Firmware verified:** `lianli92_0001_2026041401` on the 9.2" (reported by
  opcode 10, `version`). No firmware has been observed on the 8.8".
- **Transport:** USB bulk, configuration 1, interface 0, OUT endpoint `0x01`,
  IN endpoint `0x81`
- **Driver:** `src/web/packages/host/src/panels/tur-usb-panel.ts`,
  `tur-usb-video.ts`, `panel-protocol.ts`
- **Last hardware verification:** 2026-10-31

**Update this document with every new fact.** A firmware string, a command the
driver starts using, a failure and its cause, an opcode's real meaning — record
it here with the date and how it was measured. Correct anything this document
states wrongly; do not leave a corrected claim in place. Put unverified guesses
under *Open questions* rather than in the body as fact.

## Why this protocol exists

The panel is a self-contained player. The host sends it a JPEG for a still, or
an H.264 elementary stream the panel decodes itself; the panel scales and
rotates the picture. The host never sends raw pixels and never rasterises for
this device.

The protocol was recovered from L-Connect 3 (`lianli.slv3.dll`, version
1.5.0.146) and confirmed against three independent open-source drivers
(`deyloop/lianli_207_lcd`'s `PROTOCOL.md`, `andyjusa/hydroshift2-rs`, and the
TURZX Python reference). Every constant below is agreed by all of them.

## Packet format

A command is a **500-byte plaintext block, DES-CBC encrypted, inside a 512-byte
frame**.

| Bytes | Content |
|---|---|
| 0 | Opcode |
| 1 | 0 |
| 2–3 | Magic `1a 6d` |
| 4–7 | Timestamp, 32-bit **little-endian** (device does not verify it) |
| 8–11 | Payload length, 32-bit **big-endian** (commands that carry a payload) |
| 8 (or 12) | Single-byte parameter (`brightness`, `frame-rate`, `rotate`) |
| 12 | StartPlay's final-block flag |
| 13 | StartPlay's play count |
| 500–509 | PKCS7 padding |
| 510–511 | Trailer `a1 1a` (a frame without it is refused) |

- **Encryption:** DES-CBC, key and IV both the literal ASCII `slv3tuzx`,
  PKCS7 padding.
- **Payload is appended after the 512-byte frame and is not encrypted.** The
  length field covers the payload's own bytes.
- **Node's `crypto` cannot produce this cipher on Node 24** — DES moved to
  OpenSSL's legacy provider and `createCipheriv("des-cbc")` throws
  `ERR_OSSL_EVP_UNSUPPORTED`. The host uses `node-forge` (already present for
  the local CA).
- A reply is read as up to 512 bytes. **A command's reply is not guaranteed**:
  a frame push frequently renders with no readable ack, so `read` returning
  nothing is normal, not an error.

## Opcodes

| Opcode | Name | Fields and effect |
|---|---|---|
| 10 | `version` | Sync/keep-alive. Every driver sends it first after opening; some firmware ignores frames before it. |
| 11 | `restart` | Not used. |
| 13 | `rotate` | Parameter byte 8. The panel's own quarter-turn state, **persists across power cycles**. Mode 2 is upright for the 9.2" with the display record's 90° rotation. |
| 14 | `brightness` | Parameter byte 8. Exists; this driver does not expose it. |
| 15 | `frame-rate` | Parameter byte 8. Sent as 30 on open, as the vendor does. **Not sent before playback**: a 15 immediately before the blocks makes the decoder leave ghost trails of moving parts (measured 2026-10-31); the stream's own timing is used instead. |
| 17 | `h264-block` | Asks the block size this panel wants. Answer: big-endian uint32 at reply bytes 8–11; fall back to 202,752 when it is zero or unanswered. |
| 38/39/40 | file open/write/delete | **Deliberately not used.** Storage writes are destructive and unneeded: this host never uploads a file. |
| 51 | `clock` | Declared, never exercised. |
| 101 | `push-jpeg` | A still, appended after the frame. |
| 102 | `push-png` | The overlay layer's picture, appended after the frame. |
| 105 | `overlay-layer` | Param 1 shows the PNG layer, 0 hides it (L-Connect's `FB1_State`). |
| 121 | `play-block` | One H.264 block: length big-endian at 8–11, final-block byte at 12. |
| 122 | `buffer-level` | The decoder's depth in reply byte 8. |
| 123 | `stop-play` | Ends playback. A block written after it starts a new playback nobody feeds. |

Vendor firmware/storage opcodes (38/39/40, 98, 100, 110, 113) are omitted from
the driver rather than merely unused: this host never writes the device's
storage.

## Still frames

1. `stop-play` (123) — a running clip would otherwise keep the decoder.
2. `push-jpeg` (101) with the JPEG appended, then read the ack.
3. Flow control: **reply byte 8 is the buffer depth**. If it is above 3, poll
   `buffer-level` (122) every 50 ms until it reaches 2 or a 30 s deadline.

The still is a JPEG at the wire geometry (portrait). `MAX_PAYLOAD` is 512,000
bytes; a larger image is refused by the host before it reaches the wire.

## Overlay layer

The panel composites a separate PNG layer over whatever is showing, including a
playing video. L-Connect leaves its own sensor dashboard there, and it survives
L-Connect exiting **and** every JPEG push — so a theme would render under a
ghost unless the host clears it at open.

- At open: `overlay-layer` param 1, then `push-png` with a fully transparent
  PNG. The layer must be made visible for the push to land; showing an empty
  layer changes nothing else.
- The panel keeps the layer visible across pushes. Enabling it before every
  push blanks the layer while the new PNG loads, so the driver enables once.
- `stop-play` leaves the layer off; the next overlay push enables it again.
- An overlay PNG carries alpha; that is what lets the video show through.
- **The overlay capture also clears the artboard plate.** A theme's background
  paint is its own DOM layer (`[data-yunari-artboard-plate]`) above the host
  fill; a theme that declares no colour falls back to black there. A capture
  that leaves the plate shown is an opaque PNG and hides the clip — measured
  2026-11-01: a fresh theme with a video background was black behind its UI,
  and the same clip played underneath once the plate was cleared. The demo
  theme only worked because it declares `palette.none`.

## Video

The panel decodes H.264 itself, so the host ships compressed blocks and then
stops: motion no longer costs a capture per frame. This is L-Connect's own feed,
copied exactly.

### Encode

L-Connect runs its bundled ffmpeg as:

```
-i "<file>" -vcodec libx264 -x264opts bframes=0 -threads 4 -preset ultrafast "<out>.h264"
```

No scale, crop, rotation, `-r`, bitrate or profile: the panel takes the source's
own frame size and rate. **`bframes=0` is a compatibility requirement** — B-frames
leave the panel's decoder waiting for frames it has not received. The host adds
two things the vendor omits: `-pix_fmt yuv420p` (the decoder reads 4:2:0 only)
and the theme's fit-and-pan filter, because the wire frame is portrait while the
glass is a landscape strip. The display record's mounting angle decides the turn
(`panel-video-turn.ts`): the attached 9.2" records 90°, which is the measured
upright orientation with rotate mode 2.

**A composed advanced background is baked into the same clip.** The clip is the
whole background picture, not just the media: `panel-video-composition.ts`
composites the resolved media region, its eased masks and the palette fill in
the turned box, then the turn goes last. Painting the fill in the page instead
cannot reach the panel, because the overlay capture hides the background media
layer by design.

L-Connect does not hand this ffmpeg a theme's MP4: it converts the theme once
and plays its own output from
`C:\ProgramData\Lian-Li\L-Connect 3\uploaded\vm-9.2-inch\landscape\*.h264`.
Those files are all 464×1920, 24 fps (`tbr 48`), already turned upright, from
1920×464 intermediates. A 1920×1080 stream sent to the panel unchanged renders
as garbled colour bands (measured twice, including after a replug), so the fit
and the transposition stay.

### Feed

1. Ask `h264-block` (17) for the block size. Match the reply by opcode: a stale
   reply read as a size once produced a 1.8 GB block, which the panel refused
   and showed its logo.
2. `stop-play` (123).
3. Send `play-block` (121) for each block, length big-endian at 8–11, byte 12
   set to 1 only on the block that ends the file.
4. Wait 30 ms, then read the ack. **The read's timeout is 100 ms**, the value
   `WinUsb.TLV3Read` passes to `reader.Read`; the block ack, the buffer-level
   poll and the reply flush all use it.
5. If reply byte 8 is above 3, poll `buffer-level` (122) every 50 ms until
   depth ≤ 2, with a 30 s ceiling.
6. Wait out the block's own share of the clip's playing time (block bytes over
   total bytes, times ffmpeg's reported `Duration:`), minus the time the block
   above already took, with 30 ms as the floor. **The wait is outside the
   endpoint lock**, or the UI overlay stalls for a whole block.
7. At end of file, rewind and keep sending — playback never stops at EOF.

**The 100 ms read is part of the feed's clock.** A read with the command
timeout (2 s) blocks for two seconds whenever the panel has nothing to say,
and the decoder plays through its ring and stops inside that hole.

**Feeding faster than the clip plays is the ghost's other cause.** Same clip,
same loop, 2026-10-31: clean at 1.0×, ghost trails from 1.1× and heavy at 1.2×.
The vendor's loop has no pace of its own; it stays near realtime only because
L-Connect feeds an 11 Mbps clip, where one 202,752-byte block is ~0.14 s of
video. A 2–4 MB clip over 8–29 s is fed 3–4× by that loop and ghosts. That is
why the car clip looked fine and the others did not.

### Measured on the 9.2"

With the vendor's feed (but still the 2 s command timeout on reads at that
point): no cancelled block, no restart and no drain timeout over ten minutes;
depth oscillated 2–4 in a steady ~2.07 s drain. Camera frames of the glass 16 s
apart differed (PSNR 24 dB), so the picture advanced.

Unpaced, on 2026-10-31: block gaps were 48 ms for five blocks, then a 2.17 s
hole, repeating; overlay pushes took 100 ms and 1,300 ms in alternation. Filmed
at 30 fps the glass barely changed across 21 s (frame-difference median 0.35,
maximum 1.39 on an 8-bit grey crop) — a still picture with occasional nudges.

With the vendor's loop and the 100 ms reads, same panel, same clip: block gaps
uniform at ~200 ms, short drains of ~170 ms every ~200–300 ms, overlay pushes
mean 159 ms (p50 159, max 265). The film's per-second frame difference held at
0.6–0.8 across the clip, against 0.35–0.8 alternating before — continuous
motion instead of a still with nudges. Before the read was shortened, a single
flush read after a drain blocked 2,003 ms, which is the hole the picture broke
on.

Paced, with no frame-rate command, 2026-10-31: Wind-Mills (8.00 s, 1.4 MB
source, 2,356,052-byte stream) with the overlay pushes on — 91 blocks, gaps p50
696 ms (max 767), **no drain at all**, overlay pushes mean 63 ms (p50 57, max
130). The glass was clean and smooth, and the same clip ghosted on the unpaced
loop.

## Quirks and failure modes

- **A `frame-rate` (15) sent just before the blocks ghosts moving parts.** The
  same stream and the same loop are clean with the 15 omitted; the panel uses
  the stream's own timing. A 15 at open, followed later by playback, is fine.
- **Feeding faster than the clip plays ghosts too.** Clean at 1.0×; trails
  appear from about 1.1× and are heavy at 1.4×. The vendor's loop has no pace
  of its own and is near realtime only because L-Connect's own clips are ~11
  Mbps.

- **A cancelled bulk OUT wedges the device.** A transfer timeout does not hand
  back a partial count; the URB is cancelled mid-block and the panel's USB stack
  then stops answering altogether. Only a replug clears it. This is why reads
  use a 2 s timeout and block writes a 30 s timeout — waiting out a drain is
  always better than cancelling. A cancelled *read* is cheaper than a cancelled
  write but still accumulates.
- **Unread IN replies back up the queue.** Once full, the panel stops accepting
  writes — a freeze that reads as a panel fault. Flush after every reply: read
  once, then keep reading zero-length answers up to a bounded count. The vendor
  driver does the same (`read_flush()`).
- **Recover a stalled endpoint with `clearHalt`, not `reset()`.** `reset()` takes
  the LED MCU beside the panel down.
- **Rotation is sticky.** Whatever L-Connect left persists across power cycles;
  the driver pins mode 2 rather than inheriting an upside-down picture with no
  record of why.
- **One writer at a time.** The video feed runs its own loop, and overlapping it
  with an overlay push produces "Cancelled" transfers. Every endpoint write goes
  through one lock.
- **Do not rewrite a cancelled block.** A cancelled block may be partly
  consumed, so re-sending the same bytes duplicates them into the elementary
  stream; the result is a ghost trail, not a stutter. Stop playback and restart
  from the clip's first block so the decoder gets a fresh keyframe.
- **The 8.8" is untested on hardware.** Its geometry and product ID are taken
  from drivers that list it; nothing here has driven one.

## Open questions

- Firmware versions other than the 9.2"'s and their differences.
- `brightness` (14) and `clock` (51) field semantics: declared from vendor code,
  never exercised.
- The exact payload cap per firmware. 512,000 bytes is the vendor's measured
  limit; it may differ on other models.
- Whether the 8.8" accepts the same `transpose`/rotate-mode pairing.
