# 0007 — A static glass panel samples an image background itself

- **Date:** 2026-10-30
- **Status:** accepted
- **Paths:** `src/web/packages/scene-fabric/src/background-media.ts`

## Problem

A panel is served `?panel=1`, so unmarked glass samples `"static"`. That mode
must name a picture that does not move. A video supplies one through
`background.media.fallbackFrame`; an image is already a still. The static
branch reads only the video's extracted canvas, so glass over an image paints
nothing and falls back to the board paint — the card goes flat the moment a
video theme is switched to an image background.

## Rung 1 — internal owner

Searched: `mountBackgroundMedia`, `BackdropMedia.paint`, `artboardBackdrop`,
`glass.backdropFor`, `panelGlassSampling`, and the history of static sampling
(`226acf66`). Found: `background-media.ts` owns the element the sampler draws
and already switches on `sampling`; `artboard-backdrop.ts` supplies the paint
underneath; `glass.ts` clears a static backdrop when the media paints nothing.
The owner exists and the branch is one expression — no second sampler belongs
here.

## Rung 2 — installed dependencies

Searched: scene-fabric's imports and `fabric/es` object model. Found: the media
layer is plain DOM, not a Fabric object, and Fabric contributes nothing to how
it is drawn. No dependency is involved in the choice.

## Rung 3 — native platform

Searched: `<img>` and `drawImage` semantics (`CanvasImageSource`,
`HTMLImageElement.complete`/`naturalWidth`). Found: `drawImage` accepts an
image as a still the moment it decodes, and an image element never advances.
The static picture exists natively; the code was discarding it.

## Rung 4 — public solutions

Searched: "CSS backdrop-filter behind a static image versus a video", the
`filter-effects-2` backdrop-root algorithm, MDN `backdrop-filter`, and the
Chromium `edgeMode` change. Found: the platform's glass always filters whatever
was painted behind it (copied into the backdrop root image) and has no notion
of a static source. The static/dynamic split is Yunari's bandwidth policy for
panels, not a platform capability to reuse.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Sample `fallback` for every static panel | Current code | An image has no `fallback`; glass paints nothing | reject |
| Give images a `fallback` copy extracted like a video's | Reuses one source variable | Extracts a copy of a still: second canvas, second decode, and a stale copy when the image is replaced | reject |
| Use the mounted element unless it is a video | The element is already the picture static sampling wants | None: one predicate, and `showFallback`'s `<img>` replacement keeps working | accept |

## Rung 6 — smallest probe

Added a jsdom case to `background-media.fallback.dom.test.ts`: an image
background painted with `"static"` returns `false` and draws nothing before the
change, and draws the mounted `<img>` afterwards. The case is the executable
evidence; it fails on the old expression.

## Decision

`paint` reads the still from the mounted element unless that element is a
video, in which case it reads the declared frame (or frame 0). An image is its
own static picture, so no second copy is made and no sampler learns about image
backgrounds elsewhere.
