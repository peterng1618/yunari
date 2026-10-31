# 0021 — A panel's overlay is photographed, not taken from the screencast

- **Date:** 2026-10-31
- **Status:** accepted
- **Supersedes:** none. Narrows 0014's screencast to the still path.
- **Paths:** `src/web/packages/host/src/panels/panel-raster.ts`

## Problem

A 464x1920 panel that plays its own video gets its UI as a PNG overlay with
alpha. On this build the overlay alternated between two sizes, measured from the
same page three seconds apart: 1,312,983 bytes, 48,881 bytes, 1,324,508 bytes.
The panel's `push-png` cap is 512,000 bytes (`tur-usb-panel.ts`), so every large
one was refused. A refused overlay drops the runner to stills and the next tick
tries the overlay again — on the glass that is the layer appearing and
disappearing. The large frames also carry the theme's video: the visible pixels
are the artwork, not the UI.

## Cause

A screencast frame is a surface the renderer had already committed.
`setOverlayMode` hides the media layer with a script; the screencast frame that
follows the switch can still be one composed before the script ran, and on a
live video it holds the artwork. The one-frame skip the mode change used is not
a guarantee about the compositor, only a guess.

## The smallest fix that holds

`captureOverlay` applies the mode and then asks for
`Page.captureScreenshot` clipped to the panel's geometry — a composite made
after the script — instead of the next screencast frame. Live stills keep their
screencast: ordering and back-pressure are what 0014 put there.

Measured on the same display after the change: three captures three seconds
apart, all 20,951 bytes, dimensions 464x1920, and no artwork in the pixels.

## Trade

An overlay costs a screenshot (about 45 ms) rather than a lookup, so a
video-compositing panel pays a screenshot per tick. That is the path main
already ran for every still, and the alternative is a refusal the device
answers with a flash.
