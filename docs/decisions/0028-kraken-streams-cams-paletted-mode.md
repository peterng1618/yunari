# 0028 — A second Kraken stream (mode B), with CAM's ring and cadence

- **Date:** 2026-11-06
- **Status:** accepted
- **Relates to:** 0020 (rejected the paletted mode for its 256 colours), 0026
  (the 140 ms mode-2 cadence, kept for mode A), 0019 (the settle, kept for
  mode A).
- **Paths:** `src/web/packages/host/src/panels/kraken-z3-panel.ts`,
  `src/web/packages/host/src/panels/kraken-palette.ts`,
  `src/web/packages/renderer-core/src/render-mode.ts`

## Problem

The Z73 is smooth but still slower than NZXT CAM on the same glass. CAM's
captured traffic is 9.1 frames/s; this driver sends 7.1. The user asked for
CAM's frame rate and CAM's picture quality, on hardware they own, and asked for
the existing behaviour to stay available: the new stream is Mode B, the old one
Mode A, chosen per display in display settings.

## Rung 1 — internal owner

CodeGraph plus the prior probe artifacts in `%TEMP%/yunari-probe`:
`KrakenPanel`, `KRAKEN_FRAME_INTERVAL_MS`, `PanelRunner`, `panel-manager.ts`,
and the capture/parse scripts. The driver owns the bucket ring, the wire format
and the cadence; the runner owns the tick and already overlaps capture with
send; the display record owns per-display choices (`shape`, `rotation`). So the
stream is a display-record field, the ring and format live in the driver, and
no second scheduler appears.

## Rung 2 — installed dependencies

Searched `src/web/node_modules` and the host package. `node-hid` and `usb`
carry reports and transfers only. Neither quantizes an image. `canvas` is a
dev dependency, and `sharp` is a transitive dev dependency of
`@cloudflare/vitest-plugin` (via miniflare). Both were measured anyway, as the
candidates a new runtime dependency would buy (see rung 5).

## Rung 3 — native platform

Node 24 provides PNG decoding and `zlib`; it has no colour quantizer. The
capture arrives as a 320×320 RGBA buffer in the host, so the device's wire
format is the only platform API involved.

## Rung 4 — public solutions

- **NZXT CAM 4.76.6**, captured in `%TEMP%/yunari-probe/camcap.pcap` and
  `boot.pcap`. CAM sends a 20-byte header with mode `0x03` and a 103,424-byte
  payload: 1,024 bytes of RGBA palette followed by 102,400 8-bit indices. It
  creates all 16 buckets at 101 slots each, deletes the target bucket twice,
  creates it, begins, writes header and payload, ends, switches with `38 01 04`,
  and never sends a settle. Frame starts are 110 ms apart (median; p10 108,
  p90 114), about 9.1 FPS. Its replies are read for every command. Its pictures
  carry a fresh palette almost every frame (343 of 350 differ), 255.3 entries in
  use on average, and 42,715 low-distance neighbouring index pairs per frame —
  it dithers.
- **liquidctl `kraken3.py`** documents the bucket table, the 101-slot
  arithmetic for a paletted payload, and the one-shot static/GIF path; it does
  not stream frames or publish a cadence. It confirms the command meanings but
  not the live sequence.
- **`image-q` 4.0.0** (MIT) is the packaged quantizer: Wu/NeuQuant/RGBQuant plus
  Floyd–Steinberg.
- **`sharp` 0.35.5** (Apache-2.0, libvips with libimagequant) is the native
  quantizer.

## Rung 5 — integration comparison

Measured on this host with a 320×320 frame; `cam` is a captured CAM picture
reconstructed to RGBA, `gradient` is a full-colour synthetic ramp.

| Option | Time per frame | PSNR (gradient) | Verdict |
|---|---|---|---|
| `image-q`, wuquant + Floyd–Steinberg | 300–800 ms | 33.7 dB | Reject: several frame budgets |
| `image-q`, rgbquant + Floyd–Steinberg | 77–530 ms | 34.8 dB | Reject: at best most of the 110 ms budget, and not stable |
| `sharp` palette PNG + read the indices | 20 ms (cam), 384 ms (gradient) | 33.8 dB | Reject: native libimagequant is fast only when the picture is already nearly paletted, and adds a platform binary |
| Hand-rolled median cut + 5-bit bin lookup + Floyd–Steinberg | **5.5–8.5 ms** | **33.1 dB** (cam frame 53.3 dB) | **Adopt** |
| Mode `0x02` at 140 ms | — | — | Kept as Mode A; the glass drops mode-2 switches below ~140 ms |
| Vendor CAM's native module or copy its code | — | — | Reject: licensing and ownership; the protocol is established from the capture |

The packaged quantizers are 9–90× slower than the frame budget and no better on
this picture; `sharp`'s native path is fast only on already-paletted input. The
hand-rolled encoder stays, with the measurements above as its justification.

## Rung 6 — smallest probe

The executable probes already exist and were rerun for this decision:

- `analyse-headers.mjs` on `camcap.pcap`: 142 payloads, all mode `0x03` at
  103,424 bytes; median inter-frame gap 110 ms.
- `cam-sequence.mjs`: per frame, `32 02` twice, `32 01` with 101 slots,
  `36 01`, 20-byte header + 103,424 bytes, `36 02`, `38 01 04`, with the
  matching replies; no settle command or wait.
- `cam-palette-stats.mjs` on `real-frames/`: per-frame 256-entry palette, alpha
  0, 255.3 entries used, 42,715 low-distance neighbour pairs per frame.
- `probe-handrolled.mjs`, `probe-imageq2.mjs`, `probe-sharp.mjs`: the table in
  rung 5, including the palette, encode and PNG-decode timings.

## Decision

The display record gains `renderMode: "mode-a" | "mode-b"`, absent meaning
`mode-a`. The editor's display settings draw the toggle only for a family that
declares more than one stream; the host validates the value and restarts the
panel when it changes.

- **Mode A** is unchanged: mode `0x02`, 401-slot buckets, two-bucket ring, 10 ms
  settle, 140 ms cadence.
- **Mode B** is CAM's stream: `toPalettedFrame` builds a per-frame 256-entry
  palette and diffs the quantization error with Floyd–Steinberg; the driver
  sends mode `0x03` into 101-slot buckets across all 16, deletes twice, sends no
  settle, and runs at **100 ms**.

**100 ms rather than CAM's 110 ms, for even sampling of video sources.** The
page plays a video and the panel is fed screenshots of it: at 30 fps every
110 ms advances the source by 3.3 frames, so motion moves 3, 3, 4, 3, 3, 4
frames — a beat that reads as micro-judder on heavy motion. At 100 ms the
advance is exactly 3 frames at 30 fps and exactly 6 at 60 fps, so the sampled
motion is even. The theme's clip is 30.0 fps (ffprobe). Whether this closes the
gap is the user's visual verdict, not this note's claim.

The palette is built from exact channel sums per 5-bit bin, not from the bin
centre. A flat colour is otherwise not exactly representable, and because
Floyd–Steinberg's weights sum to 1 the residual error ramps without bound until
the nearest entry flips — measured as speckles in a flat fill and a 36.9 dB
cam-frame result; with the sums it is 53.3 dB.

## Quality guard

The earlier paletted attempt (0020) showed banding and grain, so the encoder is
checked against the two shapes that produced it, and both checks are tests in
`kraken-palette.test.ts`:

- **Banding.** On a 256-step grey ramp the largest per-pixel error is **7/255**
  (every pixel under 16) and the largest step between adjacent column means is
  **3.45/255**. A flat fill quantises to **zero** error, because its palette
  entry is the exact mean of the pixels it covers. Bands cannot form where the
  palette has a colour that matches.
- **Hairlines.** A 1 px white rule on black keeps a palette entry above 200 in
  every channel on the rule, so a chart gridline survives instead of dithering
  into the background.

Mode B is opt-in: a record that names no stream — every record that exists
today — plays Mode A, so the full-colour output is never traded away silently.

## Hardware check

Measured 2026-11-06 on the attached Z73, firmware 5.11.0, by streaming synthetic
frames and counting accepted frames (any refused command throws):

| Stream | Frames/s | Median frame time |
|---|---|---|
| Mode A | 9.09 | 110 ms |
| Mode B, back to back | 9.99 | 98 ms (including PNG generation) |
| Mode B, paced | 10.08 | 75 ms of host work per frame |

A paced 100 ms run sent 121 of 121 frames with no refused command. Mode A's
110 ms is the driver's own send cost, which is why its cadence stays at 140 ms
for the glass.

Quality is CAM's own target: a 256-colour dithered picture. 0020 rejected that
against a 24-bit ideal; the user's target is CAM's output, which is this format,
and Mode A remains for anyone who prefers full colour.
