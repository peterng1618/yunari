# 0135 — Ask the TURZX panel whether its overlay is alive

- **Date:** 2026-11-14
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/turzx-panel.ts`,
  `src/web/packages/host/src/panels/turzx-protocol.ts`

## Problem

The TURZX 5" panel's overlay stops compositing after a run of updates and never
reports it: every write keeps succeeding, the clip keeps playing, the glass
keeps showing the last composited second. Measured twice on `COM5`,
2026-11-14: frozen after 57 updates and 3.1 MB of bodies, and again after 17
updates and 1.5 MB, with `needReSend` never read.

The adapter's answers so far were both blind: a 3 s minimum gap between updates
(0133) and a periodic re-init on a byte/time budget. The budget re-init itself
failed — the panel does not answer `seq_png_init_` once its overlay task is
wedged — which threw, tripped the runner's overlay-failure counter, dropped the
panel to full-frame stills and pushed 1.5 MB of BGRA per second at it. That is
the rapid flashing seen on the glass.

## Rung 1 — internal owner

Searched: `TurzxPanel.presentOverlay`, `initOverlay`, `askStatus`,
`serial-transport.ts` `drainPending`, `turzx-protocol.ts`.

Found: the adapter owns the wire and the queue; the transport already retains
every reply the device sends. `QUERY_STATUS` (`cf ef 69 …`) was used only at
open and its answer was discarded, and the panel's unsolicited
`needReSend:0|renderCnt:1576` reply after the first overlay was read only under
`YUNARI_PANEL_DEBUG`. The protocol had no parser for it.

## Rung 2 — installed dependencies

None involved: the change is inside the adapter's own wire protocol.

## Rung 3 — native platform

Measured directly on `COM5` with a 250-byte-padded `QUERY_STATUS`, three times
in a row, while no host was running:

```
needReSend:0|renderCnt:3381   (NUL-padded to ~1 KB)
needReSend:0|renderCnt:3393
needReSend:0|renderCnt:3406
```

The panel answers the query, the answer carries a resend verdict and a render
counter, and the counter advances on its own while the panel is rendering.

## Rung 4 — public solutions

Searched the vendor app, `D:\Software\TURZX-V3.1.0-5inchENG` (TURZX V3.1.0), as
the only other implementation of this firmware's protocol. It is a .NET
assembly; `ilspycmd -p` decompiles it (string literals are Dotfuscator-encrypted,
control flow is flattened, but the command bytes and the reply parsing survive).

Found, in `UsbMonitorL.exe` → `녃.cs` (the 5" device class):

- `QuerryResend()` sends `QUERY_STATUS` (207) and reads the answer, splits it on
  `|`, parses `parts[1]` as the render count and `parts[2]` as a theme index,
  and answers "resend needed" when the reply does not carry the healthy
  `needReSend` token, or after three empty replies in a row.
- `Monitor`'s render loop compares `lastVideoCnt` with `curVideoCnt` (the
  `renderCnt` the panel just reported) between two queries. When they are equal
  the loop logs, then sets `reStartVideoMark` and `reSendInite`.
- On `reSendInite` the loop replays the video start and re-initializes the
  overlay, then sends full images — twice, 100 ms apart — and resets its
  sequence counter to 0.
- `ShowSeqImage` sends `UPDATE_BITMAP` (204) with an 8-byte header payload,
  `[seq (4 bytes BE) | position-info size (4 bytes BE)]`, and appends `ef 69` to
  the body. That is the same header this adapter already writes
  (`overlayHeader`), so the framing was never the difference.
- `SetPngPosInfo` sends `INIT_VIDEO_OVERLAY` (208) **with the encoded image as
  its body**, not as a bare frame.

So the vendor does not avoid the stall — it detects it through the panel's own
status every frame, and its recovery is fire-and-forget. This host did neither.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep the byte/time re-init budget | No feedback loop | Re-inits a healthy panel, and cannot revive a wedged one | Reject |
| Re-init only on a failed update | Reacts after the freeze | The failure is invisible; sends keep succeeding | Reject |
| Pace harder (longer minimum gap) | Trades freshness for safety | The vendor's own 10 FPS loop is not what keeps it alive | Reject |
| Query the panel after every update; re-init and repaint when it says resend, when its render counter stops, or when it stops answering | Uses the firmware's own health channel; same contract as the vendor app | Costs one 250-byte write plus a ~1 KB read per update; the reply can be missed, so it is counted rather than acted on once | Accept |

## Rung 6 — smallest probe

The three hardware `QUERY_STATUS` probes above, plus the vendor decompilation
for the semantics of each field and the recovery sequence.

## Decision

`presentOverlay` asks the panel `QUERY_STATUS` after every update and parses the
answer with `parsePanelStatus` (`needReSend:N|renderCnt:M`). The overlay counts
as stalled when the panel asks for a resend, when its render counter has not
moved since the previous answer, or when three consecutive queries go
unanswered. On a stall the adapter re-initializes the overlay **without waiting
for the init's ack** — the wedged panel is exactly the one that will not answer
— and sends the frame it already had as a full repaint in the same tick, so the
glass never shows an empty layer for a pacing gap. The byte/time budget is
deleted; nothing re-initializes a panel that says it is healthy.

Measured on `COM5` (rom1.88), no host running: the query answers in
milliseconds and its render counter advances continuously.

## Open questions

- Whether the panel ever reports `needReSend` non-zero before it freezes, or
  only after. A long run with the new loop answers this; the adapter logs the
  reason for every re-init.
- `themeIndex` in the status reply identifies the panel's own theme; the host
  does not use it and the panel's numbering is unverified.
