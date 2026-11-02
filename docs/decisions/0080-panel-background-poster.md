# 0080 — A panel's background poster is a host cache, not authored data

- **Date:** 2026-11-02
- **Status:** accepted
- **Paths:**
  - `src/web/packages/host/src/themes/normalize-video.ts`
  - `src/web/packages/host/src/themes/video-frame.ts`
  - `src/web/packages/host/src/themes/theme-media.ts`
  - `src/web/packages/host/src/server/theme-writes.ts`
  - `src/web/packages/host/src/server/themes-routes.ts`
  - `src/web/packages/host/src/server/options.ts`
  - `src/web/packages/host/src/server.ts`
  - `src/web/packages/host/src/main.ts`
  - `src/web/packages/host/src/panels/panel-page.ts`
  - `src/web/packages/host/src/panels/panel-manager.ts`
  - `src/web/packages/scene-fabric/src/background-media.ts`
  - `src/web/packages/scene-fabric/src/scene.ts`
  - `src/web/packages/player/src/main.ts`
  - `src/web/packages/player/src/panel-sampling.ts`

## Problem

A video panel's page loads the theme's background video only so a static glass
card has one frame to sample. With a 3840×2160 loop the shared renderer is
saturated: a second panel page cannot navigate, a new `<video>` never reaches
`loadedmetadata`, and the still a glass card stands on never lands. The device
plays the clip itself, so the page decodes a picture nobody displays.

The page needs one picture: frame `fallbackFrame ?? 0` of that video. It must
not need the video source at all. The picture has to be invalidated exactly
when its inputs change — the video background or the declared frame — and must
survive saves that change neither.

## Rung 1 — internal owner

Searched: `mountBackgroundMedia` / `extractFrame` / `backdrop` in
`scene-fabric`, `panelPageUrl`, `panelGlassSampling`, `createPanelRunner`'s
overlay branch, `ThemeStore.write`, `createThumbnailStore`,
`normalizeVideo`.

Found:

- `background-media.ts` already extracts frame `media.fallbackFrame ?? 0` with
  a hidden probe `<video>`; the work is correct but needs the video downloaded
  and decoded. Static glass paints that canvas.
- `panelPageUrl` and `panelGlassSampling` carry `?panel=1`, which only says the
  glass default is `"static"`. Kraken-style still panels also use `panel=1`
  and do need the live picture, so `panel=1` cannot mean "use a poster".
- `createPanelRunner` uses the overlay (page picture hidden) only when
  `device.video` exists and the clip was uploaded. That is the exact set of
  pages that never show the theme's own picture.
- `ThemeStore.write` stages the folder whole and renames it in; any file the
  save did not write is dropped. A poster inside the folder would have to be
  rewritten on every save.
- `createThumbnailStore` is the existing derived-picture-in-folder precedent,
  but the editor re-uploads it after each save, which confirms the wipe.
- `normalizeVideo` already owns the bundled ffmpeg binary, its digest gate and
  the temp-directory run.

Unsolved: a persisted picture keyed by the derived inputs, and a way to tell
a panel page to stand on it.

## Rung 2 — installed dependencies

Searched: `ffmpeg-static` usage and `normalize-video.ts`, its tests and
`ffmpeg-hash.mjs`; `fflate` package writer/reader; Fabric's canvas path.

Found:

- The bundled ffmpeg (`ffmpeg-static`) is already a host runtime dependency,
  hash-verified on every spawn. `-ss` before `-i` seeks by keyframe and decodes
  forward frame-accurately; `-frames:v 1` then writes one image.
- `fflate` only carries package members; it offers nothing for frames.
- Fabric has no video object at all; the background is a DOM layer, which is
  why the picture is mounted and sampled outside the canvas.

## Rung 3 — native platform

Searched: HTML media APIs, ffmpeg CLI, browser capture.

Found:

- `<video poster>` is the native pre-play still, but the element still fetches
  and preloads the video; it does not remove the 4K decode.
- `requestVideoFrameCallback` + `drawImage` (today's probe) needs the decode to
  happen first, which is the failure.
- `Page.captureScreenshot` would need the same page decode.
- ffmpeg runs out of process on the host, where the bytes already live.

## Rung 4 — public solutions

Searched: a web search was attempted for ffmpeg frame extraction and for the
`<video poster>` contract; this session's search backend returned no results
and said so, so the evidence here is the bundled binary's own behaviour plus
the probe below. Comparable players and media servers generate poster/story
board images at ingest with ffmpeg for the same reason: the client should not
decode a large source to show one still. That is the shape adopted, not a
copied API.

Found: ffmpeg's documented seek-then-first-frame invocation; no library in the
dependency set that does poster extraction itself.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Ship the poster in the theme package | A member older readers refuse; stale whenever the video changes | Manifest + reader change, editor export plumbing | Rejected |
| Poster file inside the theme folder | Survives delete with the theme, but `store.write` wipes it every save | Rewrite on every save, or a store change | Rejected |
| Host cache named by theme + asset + frame | No format change; the name itself is the invalidation check | Regenerate on miss; drop on the save that changes an input | **Chosen** |
| Extract on every page mount | No cache to invalidate | ~0.4 s ffmpeg per panel start, every restart | Rejected |
| Keep the probe, raise timeouts | No new moving part | Does not remove the decode that starves the renderer | Rejected |

## Rung 6 — smallest probe

Ran the bundled binary against the reported 4K theme
(`4K-Project-Fiora---Audio-Responsive.mp4`, 28.9 MB, 3840×2160):

```
ffmpeg -hide_banner -nostdin -y -ss 0 -i <video> -frames:v 1 \
  -vf scale=1280:720:force_original_aspect_ratio=decrease \
  -f image2 -update 1 out.png
```

- frame 0: exit 0, 397 ms, 1.20 MB PNG
- 10 s seek: exit 0, 515 ms, 1.25 MB PNG

A 1280-edge PNG under an 8 MB cap holds the picture; the cost is paid once per
change, not per panel start.

## Decision

- Cache entries are named by their inputs: a still is
  `<theme-id>~<video-asset>~f<frame>.png`; a panel-sized clip is
  `<theme-id>~<video-asset>~<width>x<height>-cover.mp4`. A missing name is the
  pre-flight failure, so the requesting route regenerates it. A long asset name
  is hashed, so the suffix that names the frame or the panel size survives. The
  `cover` suffix also retires clips encoded by the earlier fit-inside copy.
- A save drops that theme's cached media only when the video background's asset
  or declared frame changed, or the save carried the video's bytes. It never
  extracts; the next panel request does.
- Overlay panels (device plays the clip) mount the still as the background
  picture instead of the video. Still panels mount a clip encoded to cover the
  rectangle the page's cover fit, pan and zoom will paint, so one encoded pixel
  reaches one panel pixel; fitting the clip inside the panel instead made the
  page magnify it (a 16:9 source on a 320x320 Kraken became 320x180 and looked
  soft). Neither page fetches the theme's 4K source.
- The page asks for that rectangle's size: the viewport grown by each axis's
  pan overhang and the authored media scale, capped at 4096.
- A failed cached picture falls back to the theme's declared asset, so an
  extraction failure degrades to current behaviour rather than a blank panel.
- A theme with an image background ignores the override and uses its own
  picture.
