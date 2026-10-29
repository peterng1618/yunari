# 0003 — Video trim and loop blend

- **Date:** 2026-10-30
- **Status:** accepted
- **Paths:**
  `src/web/packages/editor/src/editor-session.ts`,
  `src/web/packages/editor/src/panes/assets/video-trim-modal.tsx`,
  `src/web/packages/editor/src/asset-finder/modal.tsx`,
  `src/web/packages/host/src/server.ts`,
  `src/web/packages/host/src/themes/normalize-video.ts`

## Problem

A video longer than the publish envelope is refused after the author has picked
it, and the refusal tells them to trim without offering a tool. A trimmed clip
is also a loop whose seam is visible, because the stored asset loops the last
frame back to the first. The product already owns one encoder and one
normalization route; the trim must not become a second video pipeline.

## Rung 1 — internal owner

Searched: `normalizeVideo`, `videoRefusals`, `VIDEO_LIMITS`, `ImportVideoModal`,
`importPickedVideo`, `importWallpaperItem`, `assets-pane.tsx`,
`asset-finder/modal.tsx`. Found: `theme-package/video-envelope.ts` owns the
limit, `host/themes/normalize-video.ts` owns ffmpeg and re-probing,
`editor-session.ts` owns the import transaction, `ImportVideoModal` owns the
progress surface, `assets-pane.tsx` owns a picked file, and the finder owns a
Wallpaper Engine video's "Set background" action. No trim surface exists.

## Rung 2 — installed dependencies

Searched: `ffmpeg-static` usage and `normalize-video.ts`. Found: the host
already ships, hash-verifies and spawns ffmpeg for normalization and panel
encoding, and already re-probes its own output. `xfade`, `trim` and `setpts` are
filters in that same binary, so no dependency is added.

## Rung 3 — native platform

Searched: HTML media element, `MediaRecorder`, WebCodecs. Found: `<video>` is
the only native way to preview the selected span and seek to the in/out points.
`MediaRecorder` cannot cut without re-encoding the whole clip and produces a
container the envelope does not accept; WebCodecs would be a second encoder with
its own codec/container work. The preview is native; the render stays on the
host's existing encoder.

## Rung 4 — public solutions

Searched: "ffmpeg crossfade video to itself seamless loop", "xfade trim
setpts loop", "Wallpaper Engine video loop crossfade", and "Loop Studio in/out
export crossfade". Found:

- `workshop-wallpaper-bridge` renders a cached looping mp4 and crossfades its
  last ~1.2 s into its first ~1.2 s so the seam is blended away.
- The accepted StackOverflow answer uses `trim + setpts + xfade` with the first
  second replayed over the end; the output is one blend shorter than the input.
- Waypaper Engine's Loop Studio exposes draggable In/Out markers and a midpoint
  crossfade on export.

These agree on the same shape: trim a span, then dissolve the last blend into
the first blend of that span.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Browser `MediaRecorder` trim | No host change | Re-encodes, wrong container/profile, quality loss, no ffmpeg envelope | reject |
| Panel-only blend in `tur-usb-video`/`turzx-video` | Reuses panel encoders | The player page still loops the stored asset with a hard seam | reject |
| Host trim + xfade in the existing normalizer | One encoder, one route, one re-probe, player and panel both benefit | Route must carry the span; normalizer must build a filter graph | accept |
| Trim by truncating the file | Cheap | Cannot cut MP4 without re-muxing and produces a non-conforming loop | reject |

## Rung 6 — smallest probe

Ran ffmpeg-static on the committed 31.5 s fixture with `-ss 0 -t 5` and the
`split + trim + setpts + xfade` graph at a 1 s blend. It exited 0 and wrote a
4.00 s, 320x180, High profile, yuv420p, 30 fps MP4: the span lost exactly one
blend, and the output passed the same `videoRefusals` shape the host re-probes.

## Decision

Raise `VIDEO_LIMITS.maxDurationMs` to 60 s. Every picked video — and every
Wallpaper Engine video set as a background — opens a trim surface that previews
it with draggable start/end handles. A `.mpkg` does not: its video is already
prepared by the host, so there is no bare span to choose. The whole-file
shortcut stays available while the video fits the cap and is disabled past it,
because the host would refuse that file and the author should see the choice
closed rather than make it and read a refusal.

The editor sends `startMs`/`endMs` on the existing normalize route;
`normalizeVideo` trims and, for a trimmed span, computes a 1 s loop crossfade
with ffmpeg's `split/trim/setpts/xfade`. A re-encode without a trim keeps
today's behaviour and gets no blend. The normalizer still re-probes its output
and still refuses a span shorter than the blend.
