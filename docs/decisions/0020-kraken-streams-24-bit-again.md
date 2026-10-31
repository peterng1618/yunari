# 0020 — The Kraken streams 24-bit frames again, because a palette bands

- **Date:** 2026-10-31
- **Status:** accepted
- **Supersedes:** 0018. Extends 0019, which still owns the settle wait.
- **Paths:** `src/web/packages/host/src/panels/kraken-z3-panel.ts`

## Problem

0018 moved the live stream to the 8-bit paletted mode `0x03` for its quarter of
the wire bytes. On this firmware that mode does paint, but the picture on the
glass showed large flat colour patches on any theme with a gradient or a
photograph. Nothing in the capture path causes it: the same page photographed
through the browser is smooth. The panel is being handed 256 colours, and the
theme holds more.

## What the branch established

- **Mode `0x03` works.** 0018 replayed CAM's own captured payloads through the
  full bucket sequence and the glass changed, so 0006's "never paints" was
  wrong.
- **The bands are the palette, not the pipeline.** Encoding a captured page
  through the branch encoder and rendering the indices back to RGB reproduces
  the same large steps the glass shows; the source frame does not.
- **Error diffusion and ordered dithering both trade one defect for another.**
  Floyd–Steinberg turned hard steps into grain that re-randomised every frame,
  which the glass showed as flicker. A fixed 8×8 Bayer matrix between the two
  nearest palette entries, built and measured, removed the large patches and
  stayed byte-identical frame to frame (0.59 adjacent-difference rate against
  0.13 flat, 7.6 ms per frame). It is still 256 colours: finer steps, not the
  24-bit picture the browser composed.

## The comparison that decided it

The main build streams 24-bit RGBA through the same two-bucket ring. Tested side
by side on the same theme, main showed **no banding at all**, fewer pull-backs
and some tearing; the paletted build showed bands. Main's achieved rate was
already 12.9 FPS (0018's own measurement), so the paletted mode's saving is wire
time the pipeline cannot spend: mode 2 costs 64 ms per frame at a 70 ms cadence.

## Decision

`present` decodes the captured PNG and uploads it as mode `0x02`, 320×320×4,
into the two-bucket ring main ships — the branch keeps two changes that are not
about the format:

- the **screencast capture** (ordered frames, ack on consume) in `panel-raster`,
- the **10 ms settle** before the switch from 0019, which the tearing main
  showed is still worth having.

`kraken-palette.ts` and its suite are deleted. The median-cut encoder, its
palette-entry and nearest-entry refinements, and the dithering experiments leave
with it: they answer a format this panel no longer receives.
