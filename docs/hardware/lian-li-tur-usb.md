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
| 15 | `frame-rate` | Parameter byte 8. Sent as 30 on open, then reset to the clip's own rate before video playback (1–60). |
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
glass is a landscape strip. `transpose=1` (90° clockwise) is the measured upright
orientation for the attached 9.2" with rotate mode 2.

### Feed

1. Ask `h264-block` (17) for the block size.
2. Ask the clip's own frame rate from ffmpeg's stderr (`<n> fps`, clamped 1–60)
   and send it as `frame-rate` (15).
3. `stop-play` (123).
4. Send `play-block` (121) for each block, length big-endian at 8–11, byte 12
   set to 1 only on the block that ends the file.
5. **Wait the block's own share of the clip's playing time** (10% ahead of
   realtime, 30 ms floor, measured from the write), then read the ack.
6. If reply byte 8 is above 3, poll `buffer-level` (122) every 50 ms until
   depth ≤ 2, with a 30 s ceiling. With a paced feed this is a ceiling that
   is never reached, not the clock.
7. At end of file, rewind and keep sending — playback never stops at EOF.

**The clip's playing time is the clock; the ring depth is the ceiling.** A
feed that writes blocks as fast as the acks allow runs about ten times
realtime (48 ms between blocks, measured 2026-10-31), fills the ring to four,
then stalls in a drain for ~2.2 s while it waits for the decoder to play back
down to two — and the glass runs dry before the feed resumes. That is the
picture that pauses for a second or two and then jumps. Paced to the clip's own
length, the same block stream is uniform and no drain fires.

### Measured on the 9.2"

With the vendor's feed: no cancelled block, no restart and no drain timeout over
ten minutes; depth oscillates 2–4 in a steady ~2.07 s drain. Camera frames of
the glass 16 s apart differed (PSNR 24 dB), so the picture advanced.

Unpaced, on 2026-10-31: block gaps were 48 ms for five blocks, then a 2.17 s
hole, repeating; overlay pushes took 100 ms and 1,300 ms in alternation. Filmed
at 30 fps the glass barely changed across 21 s (frame-difference median 0.35,
maximum 1.39 on an 8-bit grey crop) — a still picture with occasional nudges.
Paced to the clip: gaps p50 142 ms with a 195 ms maximum, overlay pushes ~60 ms,
and the same film showed continuous motion (median 0.63, maximum 45.7).

## Quirks and failure modes

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
