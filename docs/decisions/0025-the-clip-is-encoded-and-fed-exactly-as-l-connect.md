# 0025 — The clip is encoded and fed exactly as L-Connect does it

- **Date:** 2026-10-31
- **Status:** accepted; amended by 0028 for the ack read's timeout
- **Supersedes:** 0024. Amends 0023 (the depth read stays; the pre-write gate
  and the realtime pacing do not).
- **Paths:** `src/web/packages/host/src/panels/tur-usb-video.ts`,
  `src/web/packages/host/src/panels/tur-usb-panel.ts`,
  `src/web/packages/host/src/panels/panel-protocol.ts`

## Problem

The panel plays the car clip clean for a few seconds and then freezes, and its
reported depth sits at 3–6 until the next block is cancelled. Nothing in this
host's own pacing has fixed it. The vendor's app plays the same clip smoothly,
so the answer is to do what the vendor does rather than to keep tuning ours.

## Evidence — decompiled from the shipped app

`ilspycmd` over `C:\Program Files\Lian-Li\L-Connect 3\lianli.slv3.dll`
(1.5.0.146, sha256 `1a1711717520…c0317`):

- `slv3.ThemeController.TransferH264` runs the bundled
  `x64\ffmpeg.exe` with exactly:
  `-i "<file>" -vcodec libx264 -x264opts bframes=0 -threads 4 -preset ultrafast "<out>.h264"`.
  **No scale, no crop, no rotation, no `-r`, no bitrate, no profile.** The
  panel is given the source's own frame size and rate.
- `slv3.ThemeController.PlayH264` reads the clip's frame rate
  (`H264.GetAvFrameNum`) and sends it as command 15 (`SetFrameRate`) before
  playback.
- `slv3.WinUsb.CheckH264Block` asks command 17 (`GetH264Block`), takes a
  big-endian uint32 from reply bytes 8–11 as the block size, and falls back to
  202,752 only when the panel answers zero.
- `slv3.WinUsb.PlayH264` (the byte[] overload): reads `blockSize` bytes,
  writes them behind command 121 with the length big-endian at 8–11, **sets
  byte 12 to 1 on the block that ends the file**, then `Delay(30)`, then reads
  the reply and, if `reply[8] > 3`, calls `waitBuffer(2)` — a 50 ms poll of
  command 122 until the depth is at most 2. At end of file it seeks to 0 and
  repeats while `isRepeat`.

## What this host did differently

| | Vendor | This host |
|---|---|---|
| Encode | source size and rate, `bframes=0`, `threads 4`, ultrafast | scaled, cropped and turned to 464×1920, forced to 30 fps, `keyint=30`, High profile, 1.5 Mbit/s cap |
| Block size | asked from the panel (cmd 17) | hardcoded 202,752 |
| Last block | byte 12 = 1 | never set |
| Frame rate | the clip's own | 30 |
| Pacing | 30 ms + drain when the ack's depth > 3 | pre-write gate + realtime sleep |

The panel decodes, scales and turns the stream itself; the vendor never
pre-sizes it. A 464×1920 High-profile stream at a forced 30 fps is a shape the
vendor never sends, and the depth trace shows the panel not draining it.

**One deliberate difference remains**: the encoder still fits the picture to
the panel's portrait frame with the theme's authored pan. That filter is this
host's product behaviour and the only measured orientation for the attached
panel (`transpose=1` with rotate mode 2); the vendor's no-filter encode would
hand the panel a landscape frame and leave the pan unimplemented. Everything
else — codec arguments, block source, frame rate, pacing, end-of-file flag —
is the vendor's.

## Decision

Encode with the vendor's arguments verbatim, query the panel's block size
(command 17) before playback, set the panel's frame rate to the clip's own,
and feed exactly as `PlayH264` does: 30 ms between blocks, the reply's depth
above 3 drained to 2, byte 12 set on the final block, and the file rewound.

Rung 1–4 are the evidence above: the internal owner is the same two files, the
installed dependency is the bundled ffmpeg, the platform offers nothing here,
and the "public solution" is the vendor binary itself. The smallest probe is
the panel: this change is measured on the glass, not argued.

## What the panel did with it

Measured on the attached 9.2", same clip that froze before: no cancelled
block, no video restart and no drain timeout over ten minutes of playback.
The reported depth oscillates between 2 and 4 in a steady ~2.07 s drain, which
is the decoder consuming two blocks at the clip's own rate — the ring is
serving realtime and never empties. Camera frames of the glass taken at 12 s
and 28 s differ (PSNR 24 dB on the strip), so the picture advanced through the
whole recording rather than resting on one frame.
