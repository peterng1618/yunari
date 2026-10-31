# 0032 — The mounting angle turns every panel's clip

- **Date:** 2026-11-01
- **Status:** accepted
- **Amends:** 0031 (the turn is right for the TURZX; it is not that family's
  rule, and it is now one owner).
- **Paths:** `src/web/packages/host/src/panels/panel-video-turn.ts`,
  `src/web/packages/host/src/panels/turzx-video.ts`,
  `src/web/packages/host/src/panels/tur-usb-video.ts`,
  `src/web/packages/host/src/panels/tur-usb-panel.ts`

## Problem

0031 composed the display's mounting angle into the TURZX clip, with the rule
written inside `turzx-video.ts`. The TUR USB family has the same contract — the
panel decodes the clip itself and the page applies the record's angle — but its
encoder hard-codes `transpose=1`, so a record at any angle other than the
attached 9.2"'s 90° turns the overlay and leaves the clip behind. A second copy
of the rule in the second encoder would drift from the first: the box swap, the
turn direction and the refusal are one decision about one concept.

## Rung 1 — internal owner

The angle already crosses the driver boundary once, in
`panel-device.ts` (`PanelVideoSource.rotation`, `PanelVideo.start`'s third
parameter), and `main.ts` reads it from the display record. What each encoder
owns is the picture composition, which differs: `turzx-video.ts` fits a numeric
crop from `placement()` into 800×480; `tur-usb-video.ts` builds ffmpeg
expressions and crops to 1920×464 because the wire is portrait. `scene-fabric`'s
`displayBox` owns the semantics both are copying: a turned layer swaps its edges
and turns about its centre.

## Rung 2 — installed dependencies

`ffmpeg-static`'s `-vf` vocabulary (`transpose=1`, `transpose=2`,
`hflip,vflip`) is the same for both encoders. The dependency donates the
operations, not the rule for when each one applies.

## Rung 3 — native platform

Neither device takes an orientation for a stored clip: the TURZX command table
has no rotate opcode for files, and the TUR USB rotate opcode (13) turns the
whole output, which the driver already pins. The host has to put the angle into
the stream either way.

## Rung 4 — public solutions

Searched: `mathoudebine/turing-smart-screen-python` (issue #90), `RexPhoe/open-turzx`
(`DEVLOG.md`), and L-Connect's own output directory. Found: every driver that
mounts a panel turned corrects the picture on the host side; none has a device
command that rotates a stored clip. L-Connect's own uploads are already turned
for its fixed mount, which is why the Lian Li path's hard-coded 90° looked
correct on the one panel measured. No public implementation shares the rule
between families; that is an internal ownership decision, not a capability gap.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Leave the Lian Li hard-coded at 90° | No change | Every other record angle turns the overlay alone | Reject |
| Copy 0031's rule into `tur-usb-video.ts` | Small diff | Two owners of one rule; the box swap and the refusal drift | Reject |
| **Move the rule to `panel-video-turn.ts` and have both encoders apply it** | **One owner, applied to each wire geometry** | Each encoder still owns its own crop and scale technique | **Adopt** |
| Turn the clip after uploading | The device could loop a file | No command rotates a stored clip | Reject |

## Rung 6 — smallest probe

The Lian Li's measured upright stream at record 90° is the existing
`transpose=1` filter; after the move, `panelH264Args(…, 90)` must produce that
same `-vf` string, and the real-ffmpeg corner-marker probe from 0031 covers the
other three angles once its box is the Lian Li's. Both are asserted in
`tur-usb-video.test.ts`, and a hardware check that the 90° panel is unchanged
follows the restart.

## Decision

`panel-video-turn.ts` owns `videoTurn`, `turnedBox`, `turnFilter` and the
refusal sentence. `turzx-video.ts` and `tur-usb-video.ts` ask it for the box
their layer is laid out in and the fragment that turns it, each keeping its own
crop and scale. `tur-usb-panel.ts` forwards the angle the runner hands it.

Skipped: a shared filter-string builder. The two crops are not the same shape
(numeric window versus ffmpeg expressions), and one builder would have to know
both.
