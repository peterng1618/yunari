# 0135 — A video background carries the frame it falls back to

- **Date:** 2026-10-29
- **Status:** accepted
- **Paths:** `src/web/packages/scene-fabric/src/background-media.ts`, `src/web/packages/scene-fabric/src/glass.ts`, `src/web/packages/scene-fabric/src/scene.ts`, `src/web/packages/renderer-core/src/theme/document.ts`, `src/web/packages/renderer-core/src/theme/glass.ts`, `src/web/packages/renderer-core/src/theme/envelope-semantics.ts`, `src/web/packages/renderer-core/src/theme/envelope-keys.ts`, `schema/theme-document.schema.json`, `src/web/packages/editor/src/selection-inspector/background-column.ts`, `src/web/packages/editor/src/selection-inspector/glass.ts`

## The problem

A theme's video background is drawn by a `<video>` element, and the glass
sampler reads it per painted frame. Measured on the Lian Li 9.2" panel and its
editor preview: the glass re-blurs on every video frame, and the blur lands a
frame or more late, so a glass card over video reads as janky rather than
frosted. A display that cannot play the video — codec, autoplay policy, a
device with no video support — has no picture at all, only the board paint.

An author can already pan and flip the media. What is missing is a way to say
*which frame represents this clip* when motion is unavailable or unhelpful.

## Rung 1 — Yunari

`BackgroundMedia` carries `assetId`, `bounds`, `offsetX/offsetY`, `flipX/flipY`
(`renderer-core`), validated in `envelope-semantics.ts` and published in the
schema. `scene-fabric`'s `mountBackgroundMedia` owns the element, the
`placement` crop and the `BackdropMedia.paint` used by glass; `followFrames`
arms a `requestVideoFrameCallback` loop whose only purpose is to repaint the
canvas so glass can re-sample the moving picture.

Nothing in the envelope can name a still that represents a video.

## Rung 2 — dependencies

None. The extraction uses `HTMLVideoElement`, `CanvasRenderingContext2D` and
`requestVideoFrameCallback`, all platform APIs already used by
`background-media.ts`.

## Rung 3 — platform

The platform has **no frame-index seek**. `currentTime` is a timestamp;
`seekToNextFrame` is non-standard and not shipped. The ecosystem's answer is
`time = frame / fps`, and fps has to be discovered. `requestVideoFrameCallback`
hands `mediaTime` per presented frame, so two callbacks give the frame
interval; `getVideoPlaybackQuality().totalVideoFrames / duration` is the other
common route but requires playing the whole clip.

The platform also has `<video poster>`, but a poster is an image URL chosen at
authoring time, cannot be a frame of the uploaded clip without a host-side
extraction step, and is never visible to a canvas sampler.

## Rung 4 — ecosystem

Searched: `requestVideoFrameCallback` frame-accurate seeking
(MDN, web.dev/rvfc, StackOverflow 65475835 and 62611353), and blur over playing
video (`css-animation.com` video/canvas layer costs, `dimensa.dev`,
`hyperframes.app/docs`, AMP issue 29168).

Found:

- Frame-accurate seeking is `currentTime = frame / fps`, with fps from
  `requestVideoFrameCallback` deltas (accurate, 1× playback) or
  `totalVideoFrames / duration` (fast, approximate). Variable frame rate makes
  both approximate — acceptable for one still.
- A blur over playing video is re-computed on every video frame; the standard
  mitigation is to blur a still — a poster or a captured frame — instead. AMP
  reached the same conclusion for story backgrounds.

## Rung 5 — comparison

| Option | Fallback picture | Glass cost | Portability |
|---|---|---|---|
| Sample the live video (today) | none | a blur per video frame | works only while decoding |
| Host pre-extracts the frame into a derived image asset | yes | static | needs a host at publish; the editor and a static theme cannot produce it |
| `<video poster>` with an authored image | yes | static | a second asset the author must supply; not "a frame of this clip" |
| **Extract `frame / fps` in the browser into a canvas** | yes | static | one implementation, works in editor, player and panel still capture |

## Decision

`BackgroundMedia` gains optional `fallbackFrame`, an integer ≥ 0: the 0-based
index of the frame at the clip's own frame rate. It is written only for a video
asset; the editor shows the control only when the selected media is a video,
and the validator refuses it on a picture.

`mountBackgroundMedia`, when a video declares `fallbackFrame`, extracts the frame
once into a canvas: a hidden muted probe element, fps from two
`requestVideoFrameCallback` `mediaTime` deltas, seek to `frame / fps`,
`drawImage` capped at a 1280 px edge, then the probe is released. Every step is
best-effort — no callback API, a decode error, a refused `play()`, or no frame
within ten seconds abandons the probe and keeps today's behaviour. The still
also replaces the visible element when the video errors or its `play()` is
rejected, so a display without video support shows the author's frame rather
than the bare board.

**Which picture a panel samples is the panel's own choice.** `GlassTreatment`
gains `sampling: "static" | "dynamic"`, absent reading as `dynamic`:

- `dynamic` samples the live video, as before;
- `static` samples the extracted still — the picture an image background or a
  paint would give it — and paints nothing when no still exists, so the paint
  behind the panel shows through.

`createGlass` counts only live-sampling panels (`samplingSurfaces()`), and the
scene arms the video's repaint loop on that count, so a theme whose glass is all
static spends no per-frame render on the video. A theme may mix the two, and each
panel keeps its own mode. The editor's sampling row is offered for every glass
panel rather than only over a video, because the background can change later.

## Not verified

- Extraction when the browser refuses playback of the hidden element too; the
  fallback cannot exist if the clip cannot be decoded at all.
- Variable-frame-rate clips: `frame / fps` is approximate.
- Any display other than the Lian Li 9.2".
- The saving is per theme, not per panel: with one dynamic panel in the scene the
  canvas still repaints per video frame, and a static panel is re-blurred with
  it (from the still). No per-region dirty tracking exists to skip that.
