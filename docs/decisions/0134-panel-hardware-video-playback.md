# 0134 — A panel that decodes video plays the theme's video itself

- **Date:** 2026-10-29
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/`

## The problem

A Yunari theme may carry a video background. The panel path captured one JPEG
per second and sent it, so a video theme would advance at about 1 fps — a
slideshow, not a video. The owner asked for L-Connect's behaviour: smooth motion
on the panel.

Guessing at the ceiling was wrong once already: an earlier note described these
panels as streaming only, which is true of the *still* path and false of the
device. The vendor SDK settles it.

## Rung 1 — Yunari

`panels/panel-device.ts` had one presenting method, `present(jpeg)`. The
rasteriser captures the player page, so the only cadence the host could offer
was its capture cadence: one frame per second (`DEFAULT_PANEL_INTERVAL_MS`).

The theme envelope already carries a video background:
`background.media` names an asset id, and `theme-package` already refuses videos
outside the publish envelope. `ffmpeg-static` is installed and its binary is
hash-verified before use (`themes/normalize-video.ts`).

## Rung 2 — dependencies

No new dependency. `ffmpeg-static` is present, gated by `ffmpeg:check`, and
already spawns for `normalize-video`.

## Rung 3 — platform

`node:zlib` supplies the PNG writer used for the existing overlay clear;
`node:child_process` runs ffmpeg. Nothing else is needed.

## Rung 4 — ecosystem

Read: `lianli.lcd207.dll` decompiled (classes `WinUsb`, `LCD92Controller`,
`H264`), the vendor's own `.h264` assets under
`C:\Program Files\Lian-Li\L-Connect 3\Assets\*\video\`, and
`sgtaziz/lian-li-linux` (`crates/lianli-devices/src/winusb/lcd/core.rs`,
`crypto.rs`).

Found:

- **The device decodes H.264 itself.** `WinUsb.PlayH264` (the base class the
  9.2" inherits) reads the file in **202752-byte** blocks and sends each block
  with opcode **121 (`StartPlay`)**, the block length big-endian at bytes 8–11,
  byte 12 set to 1 on the final block, then a 30 ms pause and a buffer-level
  check (`QueryBlock` 122, wait while byte 8 > 2). `StopPlay` is **123**;
  `GetH264Frame` (118) is not a frame counter on this firmware.
- `LCD92Controller` sets the panel frame rate to the clip's fps
  (`SetFrameRate`, 15) when it is between 1 and 119, then starts playback.
- L-Connect's shipped clips are elementary H.264 at the panel's own resolution
  (`480x480` for the HydroShift panels). Conversion is
  `ffmpeg -vcodec libx264 -x264opts bframes=0 -threads 4 -preset ultrafast`.
- The vendor's `Rotate` command (13) carries two bits and toggles the video
  surface between the two 90° orientations; it does not add a third.

## Rung 5 — comparison

| Option | Motion | Fit | Verdict |
|---|---|---|---|
| JPEG per frame at 20–30 fps | capture-bound (~22 fps at best), huge wire cost | reuses `present` | rejected: the panel treats 0x65 as a still, and one capture per frame costs a core |
| H.264 streamed with `StartPlay` | native decode, 30 fps measured | one new adapter path | **taken** |
| Vendor ffmpeg conversion | same as above | `ffmpeg-static` already installed and hashed | taken for conversion |

## Rung 6 — probe

Measured on the attached 9.2" (`1cbe:a092`), L-Connect closed, host display
record removed so the device was free:

- A 533 KB elementary H.264 stream, 3 blocks of 202752 bytes, played on the
  panel and looped. 270 block writes over 12 s with no transfer error.
- The panel accepts the stream only at its wire geometry. A 1920×464 frame is
  smeared; a 464×464 frame is stretched to the panel.
- **Orientation**: the panel maps a 464×1920 frame onto the physical landscape
  strip with a fixed quarter turn. The probe concluded the composition had to be
  turned **90° counter-clockwise** (`transpose=2`); the first integrated run
  showed that frame upside down, and **90° clockwise (`transpose=1`) is the
  upright one.** The probe's clip was turned by hand before encoding, so its
  frame carried the turn twice. The integrated path is the measurement to trust:
  the composition is fitted to the landscape view, cropped there, and turned
  once.
- **The panel's own quarter turn is sticky.** It survives power cycles, so a
  host that does not set it inherits whatever L-Connect left, and the still
  theme can come up upside down with nothing on the host explaining why. The
  command is opcode 13, one byte at offset 8; two bits are carried, but only the
  low bit changes the picture. Measured pairs against a still theme:
  rotate 0 or 1 → upside down at the record's 90°; rotate 2 → upright at 90°.
  `open()` therefore pins mode 2 before the first frame.

## Decision

`PanelDevice` gains an optional capability, present only on devices that decode
video:

```ts
interface PanelVideo {
  start(mp4: Uint8Array, placement: PanelVideoPlacement): Promise<void>;
  presentOverlay(png: Uint8Array): Promise<void>;
  stop(): Promise<void>;
}
```

Absence is the capability. The runner keeps sending still JPEGs for a device
without it; a device with it plays the theme's video and receives only the UI as
a PNG overlay, which is how L-Connect composes a video theme.

The adapter owns every device quirk: the clockwise composition into 464×1920,
the 202752-byte block size, `StopPlay` before the first block, the endless
rewind at end of file, and the 2 s reads with the reply queue flushed — the same
transport policy `0133` established for still frames, because it is the same
device.

A display's own rotation stays above the adapter. For the 9.2" the measured
upright pair is **panel rotate mode 2 with the record's 90° rotation**; a new
record created with 0° would render the same theme turned, and that is a display
setting rather than a device fact.

## Implementation result

Three things the first integrated runs corrected, each recorded because the
encoder is the only place the device's composition differs from the player's:

- **The frame was boxed in the wrong space.** The filter scaled to the record's
  portrait geometry *and then* turned it, so the stream was 1920×464 and the
  glass showed noise while the UI overlay stayed correct. The turn's input has
  to be the landscape composition (`scale=h:w,transpose=1`); only then is the
  wire frame 464×1920.
- **The turn was the other way round** — see the orientation bullet above.
- **The authored pan was lost.** The player applies `background.media`'s
  `offsetX/offsetY`; the device draws the frame itself, so a bare cover crop
  showed a centred picture the owner had not authored. `PanelVideo.start` now
  takes a `PanelVideoPlacement`, and the filter applies `scene-fabric`'s
  `placement` rule in ffmpeg expressions: cover, pan within the overhang, and
  the zoom floor that makes an offset reachable when the source's aspect leaves
  none.
- **The feed must not end at end of file.** The vendor's driver rewinds and
  keeps writing while playback is wanted (`isRepeat`); a stream that simply
  stops plays once and rests on its last frame. The adapter feeds blocks from a
  background loop and serialises them against overlay pushes, because two
  writes on one endpoint cancel each other.

Verified end to end on the attached 9.2" with the "Lian Li Video Demo" theme:
the panel plays its clip upright at the encoded rate, the host's UI arrives
above it at the runner's 1 s cadence, the clip loops, and the framing matches
the editor's.

## Not verified

- Long-run stability past the 12 s probe.
- Any panel other than the 9.2".
- Whether the panel resumes its stored still image on `StopPlay` or holds the
  last decoded frame.
