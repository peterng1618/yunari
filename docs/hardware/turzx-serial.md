# TURZX 5" serial panel (Rev C)

- **Family:** TURZX serial panels, **Rev C** only
- **Model:** TURZX 5" panel, USB `1d6b:0106` (a generic Linux-gadget ID — the
  USB IDs do not identify the panel; HELLO does)
- **Firmware verified:** `rom1.88` (HELLO answers
  `chs_5inch.dev1_rom1.88\0`)
- **Transport:** USB CDC serial, 115200 8N1 with RTS/CTS
- **Native geometry:** 800×480 landscape, no rotation
- **Driver:** `src/web/packages/host/src/panels/turzx-panel.ts`,
  `turzx-protocol.ts`, `turzx-video.ts`, `serial-transport.ts`
- **Last hardware verification:** 2026-10-30 (probed on `COM5`)

**Update this document with every new fact.** Record a firmware string, a command
the driver starts using, a refused sequence and its cause, a timing constraint —
with the date and how it was measured. Correct anything this document states
wrongly. Put unverified guesses under *Open questions*, never in the body as
fact.

## Identity and opening

Discovery lists serial ports, opens each, sends HELLO, and accepts a reply
matching:

```
chs_<model>.dev<n>_rom<version>
```

The model string is the identity; the `rom` field is the firmware. Ports that do
not answer are closed and ignored. A port another program holds is reported, not
fatal — the TURZX vendor app is the usual holder.

After HELLO the driver sends `STOP_VIDEO`, `STOP_MEDIA` and `QUERY_STATUS` so the
panel starts from a known state. The open-time `QUERY_STATUS` text reply stays
buffered and is the first thing a later read sees; reads therefore accept by
content, not position.

## Framing

- **Every write is padded to a 250-byte multiple.** A 12-byte command is ignored
  unless padded.
- `START_DISPLAY_BITMAP` is 250 bytes of `0x2c`; every other frame pads with
  `0x00`.
- The baud rate is nominal: the panel is a USB CDC gadget, and a full frame takes
  about 0.55–0.64 s regardless.
- Replies are bursts with no framing of their own; the transport seals a burst
  after a 50 ms quiet gap. Two replies closer than that arrive as one read, and
  one reply split by more than that arrives as two. Reads accept by phrase and
  skip stale acks.

## Verified commands

| Purpose | Bytes |
|---|---|
| HELLO | `01 ef 69 00 00 00 01 00 00 00 c5 d3` |
| STOP_VIDEO | `79 ef 69 00 00 00 01` |
| STOP_MEDIA | `96 ef 69 00 00 00 01` |
| Brightness | `7b ef 69 00 00 00 01 00 00 00` + one level byte |
| Screen off / on | `83 ef 69 00 00 00 01` / `83 ef 69 00 00 00 00` |
| Restart | `84 ef 69 00 00 00 01` |
| PRE_UPDATE | `86 ef 69 00 00 00 01` |
| START_DISPLAY_BITMAP | 250 × `0x2c` |
| DISPLAY_BITMAP_5INCH | `c8 ef 69 00 17 70 0e 10` |
| DISPLAY_BITMAP_ON_VIDEO | `ca ef 69 00 17 70` |
| INIT_VIDEO_OVERLAY | `d0 ef 69 00 00 00 02` |
| QUERY_STATUS | `cf ef 69 00 00 00 01` |
| UPDATE_BITMAP | `cc ef 69 00` + size(3) + `00 00 00` + count(4) + visible size(4) |
| UPLOAD_FILE | `6f ef 69 00 00 00` |
| GET_FILE_SIZE | `6e ef 69 00 00 00` |
| DELETE_FILE | `66 ef 69 00 00 00` |
| START_VIDEO | `78 ef 69 00 00 00` |

`DISPLAY_BITMAP_5INCH` ends with a big-endian two-byte length,
`480 × 480 / 64 = 3600` (`0e 10`), taken from the reference. **Sending the
six-byte prefix alone makes the panel drop the frame**, and a frame with a zero
length field renders black (measured 2026-10-29).

Brightness is a **percentage in the API**, mapped to the byte with
`round(level / 100 * 255)`. A non-integer or out-of-range level is refused, not
coerced.

A restart drops the serial interface for roughly 15 s. The driver sends it and
returns without reading, or the queue would wedge behind it.

## Static frame

1. `PRE_UPDATE`
2. `START_DISPLAY_BITMAP`
3. `DISPLAY_BITMAP_5INCH`
4. The image payload: **BGRA** bytes (red and blue swapped from RGBA), split at
   249 bytes and joined with one `0x00` between chunks, padded to a 250 multiple.

A full 800×480 frame is **1,542,250 bytes on the wire**.

## Files and video

The panel stores a clip on its own storage and loops it. The host transcodes,
uploads if needed, then starts.

- **Path header:** command + one-byte path length + three NULs + ASCII path
  (+ int32 **little-endian** file size for an upload), padded to one 250-byte
  frame. **The command and payload must be one frame**: sending the upload header
  as its own frame fails with `create_failed`. Paths longer than the frame allow
  are refused.
- **Storage:** `/mnt/SDCARD/video/…` is preferred; `/root/video/…` is the
  fallback. The driver writes `/mnt/SDCARD/video/yunari-<hash16>.mp4`.
- **Upload body:** 249-byte chunks, each in its own padded 250-byte frame.
- **An upload needs both acks** — `create_success` (file opened) and
  `file_rev_done` (write finished) — in either order. Starting between them is
  refused: `START_VIDEO` goes unanswered and the last reply is `file_rev_done`.
- **Start** answers `play_video_success`. The clip then loops on the panel with
  no host involvement.
- Re-uploading the same clip is skipped when `GET_FILE_SIZE` reports the stored
  byte count already matches. The reply is a bare decimal number; a missing file
  has no verified answer, so an unparsable reply means "upload".

### Transcode

The panel is fed 800×480 H.264 in an MP4 with no audio. Any source size is
cropped and scaled to 800×480 and its audio is dropped; a failed transcode is
an error, and the runner falls back to static frames.

The transcode:

```
-i <in> -an -vf <crop from placement,scale=800:480> -r 30 -c:v libx264
-profile:v high -pix_fmt yuv420p -crf 23 -movflags +faststart -f mp4 <out>
```

The crop window comes from `scene-fabric`'s `placement()` so the panel shows the
same edge the player does; when the source size cannot be read, a centred cover
is used. Encodes are cached under the temp directory keyed by source hash and
pan, so a reboot re-encodes.

## Video overlay

The UI is a transparent PNG layer composited over the playing video.

Init sequence, after `play_video_success`:

1. `PRE_UPDATE`, `START_DISPLAY_BITMAP`, `DISPLAY_BITMAP_ON_VIDEO`
2. A **fully transparent** full BGRA frame
3. `INIT_VIDEO_OVERLAY` (`… 02`) and the raw trailer `ef 69`

The panel answers `seq_png_init_sucessneedReSend:0|renderCnt:N`. **The first
update must wait after the init reply:** an update sent 8 ms later was dropped;
**1.5 s** worked. A full overlay re-send after init does not update the display —
the diff protocol is the only update path.

### The diff

Per frame, `UPDATE_BITMAP` is an 18-byte header and a body:

- Header: `cc ef 69 00`, image size (3 bytes BE), three zero bytes, update count
  (4 bytes BE), visible-list byte size (4 bytes BE).
- Body for each changed non-transparent segment: pixel offset (3 bytes BE,
  `y * 800 + x`), width (2 bytes BE), then three bytes of **4-bit BGRA per pixel**
  (4 bits per channel plus 4 bits of alpha).
- Then every visible segment of the current overlay, same record shape.
- The whole body is chunked at 249 bytes, joined with `0x00`, padded to 250, and
  closed with `ef 69`.

Behaviour that matters:

- **The visible list replaces the visible set.** Moving a rectangle clears its
  old position with no explicit clear command; a pixel that becomes transparent
  is cleared by its absence from the list.
- **A span keeps a one-pixel gap** when the pixel after the gap is visible, so
  text does not explode into single-pixel runs.
- **The aligned trailer.** When the unframed body is longer than 250 bytes and
  its remainder modulo 250 is 0, 248 or 249, the panel re-clears the padded tail;
  the trailer then becomes `00 00 00 01 00 00 ef 69` and the image-size field
  gains 7. 250 bytes itself takes the plain `ef 69` trailer.
- **Colour is 4 bits per channel** (and 4 bits of alpha). Smooth gradients become
  16 flat bands; a 4×4 Bayer offset is added before quantising, trading the band
  edge for a fixed texture. The changed-pixel test runs first, so dithering does
  not inflate the wire.
- The panel cannot run QUERY_STATUS in the middle of a frame update; a query
  between updates stopped rendering during probing.

## Controls

Brightness, screen on/off, restart, status and hello. Status and hello are the
only controls with a text reply; brightness, screen and restart are write-only
and return an empty reply — a host sentence must never be shown as the device's
answer. Status is recognised by `needReSend` / `renderCnt` in the reply.

## Quirks and failure modes

- **Pad every write to 250 bytes**, including short commands; the panel silently
  ignores the rest.
- **One frame per command**: a command header and its payload split across writes
  is a refusal (`create_failed`).
- **Wait for both upload acks before starting.** `create_success` alone is not
  "written".
- **Respect the 1.5 s overlay settle.**
- **The visible list is the clear mechanism** — do not invent a clear command.
- **Keep one writer.** All commands run through one queue; a status query slipped
  between an update's header and body breaks the frame.
- **Do not query status during video.** Unverified on hardware; the class's own
  note says a query is never appended after a frame.
- **A held port is not a missing panel.** Close the vendor app, then retry.

## Other revisions are different devices

The reference implementation supports Rev A, Rev B, Rev C/D and TUR_USB
families, and they do **not** share a packet:

- **Rev A** — 6-byte packets, RGB565 **little**-endian, handshake six `0x45`;
  brightness **inverted** (0 is brightest).
- **Rev B** — 10-byte packets framed with the command byte at both ends;
  RGB565 **big**-endian; differs again per sub-revision for brightness.
- **Rev C/D** — serial RGB565; this document's command set.
- **TUR_USB** — see `lian-li-tur-usb.md`; USB bulk, DES-encrypted, JPEG/PNG/H.264.

Do not apply this document's opcodes to a Rev A or Rev B panel. The driver claims
only Rev C firmware `1.88`.

## Open questions

- The `seq_png_init_failed` spelling has never been captured on hardware; only
  `seq_png_init_sucess` is verified. A run that sees a refusal must record the
  exact text.
- `GET_FILE_SIZE`'s reply for a file that does not exist is unverified.
- Whether `QUERY_STATUS` works while the overlay is playing is unverified.
- UPDATE_BITMAP's `count` field: the verified probe sent 0 first and the panel
  accepted it, so the field's meaning is unverified.
- Whether other 5" boards report different `chs_<model>` strings, and which
  firmware ranges the command set covers.
