# 0004 — Wait for the panel's upload completion before starting the clip

- **Date:** 2026-10-29
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/turzx-panel.ts`

## Problem

The first assignment of a theme with a video background plays as full-frame
stills (about 1 fps) instead of the device-decoded clip. Reassigning to another
theme and back plays smoothly. The host reports, once:

```
Panel turzx-5-panel: The panel did not answer with "play_video_success"; last reply: file_rev_done.
```

`TURZX 5"` is a serial CDC device. `upload()` writes the clip in 249-byte
chunks, then waits only for `create_success` — the ack that the file was
opened. `startVideo` is sent immediately. The panel's real completion ack is
`file_rev_done`, which it emits after writing the last chunk; START_VIDEO sent
in between is not answered with `play_video_success`. The runner then reports
the failure and falls back to full-frame stills for the rest of that runner's
life. The next start finds the same clip already stored (`fileSize` matches),
skips the upload, and the start succeeds — the theme that was "sluggish" plays
smoothly after a switch away and back.

## Rung 1 — internal owner

Read `turzx-panel.ts` (`upload`, `startVideo`, `readFor`, `readUntil`),
`panel-runner.ts` (the still fallback after a refused `video.start`),
`serial-transport.ts` (replies are queued and retained while no read waits) and
`turzx-video.ts` (the MP4 the adapter uploads). The protocol and its reply
phrases already have one owner here; no other panel family shares the CDC
upload path.

## Rung 2 — installed dependencies

`serialport` supplies the port only. Nothing in the dependency observes the
device's file-transfer state; the ack is application protocol.

## Rung 3 — native platform

Node's serial stream gives ordered writes and queued reads. It cannot know when
the panel finished writing to its SD card. A host-side delay would be a guess;
the device's own `file_rev_done` ack is the fact.

## Rung 4 — public solutions

Searches attempted for the phrase and for this protocol shape —
`"file_rev_done" TURZX`, `"play_video_success" file_rev_done`,
`TURZX 5 inch serial video upload protocol` — returned no reachable sources in
this environment. The hardware reply recorded in the user's host console is the
evidence: after `create_success`, the next reply is `file_rev_done`, and no
`play_video_success` follows a start sent before it.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Sleep a fixed interval after the upload | Simple | Guessed duration: too short keeps the bug, too long delays every first start | Reject |
| Retry START_VIDEO until `play_video_success` | Tolerates the race | Repeats a command the panel may already be acting on; upload still not complete | Reject |
| Wait for `file_rev_done` as well as `create_success` | The device states completion | One more reply to read; must tolerate either order | **Reuse** |
| Keep starting from a still fallback | No change | The bug itself | Reject |

## Rung 6 — probe

Unit probe: `turzx-panel.test.ts` scripts `create_success` with no
`file_rev_done` and asserts START_VIDEO is never written and the start rejects
naming `file_rev_done`; the successful path scripts both acks in each order.
No hardware is needed for the ordering rule; the hardware run that produced the
console line above is the reproduction.

## Decision

`upload()` reads both acks before returning, in whichever order the firmware
emits them. `startVideo` therefore runs only once the panel says the file is
complete. The failure path is unchanged: a start that still gets no
`play_video_success` reports the error and stops the clip.
