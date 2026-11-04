# 0020 — A refused Kraken begin-write ends the transfer it may have opened

- **Date:** 2026-11-04
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/kraken-z3-panel.ts`,
  `docs/hardware/nzxt-kraken-z.md`

## Problem

The Kraken looped on the live host:

```
The Kraken refused a frame upload (status none).
The Kraken refused a frame upload (status 2).
disconnected; retrying.
stills at 320x320.
```

The first `36 01` (begin write) after every reopen drew no reply, the next two
answered status 2, and the runner's three-strike rule reopened the panel, which
repeated the same sequence. Nothing on the wire distinguished "the device never
received the command" from "the reply was missed" — and the driver treated both
as a closed device.

## Rung 1 — internal owner

Searched: CodeGraph for `KrakenPanel`/`FrameRefused`, `panel-runner.ts`,
`docs/hardware/nzxt-kraken-z.md`, decisions 0006/0013/0019.
Found: `kraken-z3-panel.ts` owns the protocol; `writeFrame` is the only begin
path. It throws without touching the transfer. `panel-runner` counts three
consecutive failures and hands the display back to the manager, which reopens
the device. `0013` rules that bucket-command refusals must not rebuild the table
per frame.

## Rung 2 — installed dependencies

Searched: `node-hid` usage in `KrakenControl`, `usb` bulk uploader.
Found: `node-hid` delivers one input report per read and reports no firmware
status. `usb` reports wire errors only. Neither can tell whether the firmware
opened a transfer from a command whose reply was missed.

## Rung 3 — native platform

Searched: Windows HID input queue behaviour in the driver's comments and probe.
Found: the firmware pushes an unsolicited `75 01` report about once a second;
with no reader those fill the per-handle queue (the platform exposes no way to
observe firmware state). The queue alone does not explain a missed begin — a
probe with 60 s of broadcasts still aligned eventually — so the missing piece
had to be the firmware's transfer state.

## Rung 4 — public solutions

Searched: liquidctl `kraken3.py`; liquidctl issues #444, #774, #864, #907;
kraken-lcd `docs/firmware-notes.md` and `driver_patch.py`; KrakenZPlayground
`krakenz_interface.h`.
Found:

- liquidctl reads every bucket status and raises on non-success; it never
  streams after a refused setup (kraken-lcd reports streaming after a refusal
  wedges the device into its bootloader).
- kraken-lcd drains the report queue before every command and reads until the
  *matching* reply, because a broadcast taken as the reply shifts the whole
  conversation. It also confirms status broadcasts are once per second.
- KrakenZPlayground names `CONFIRM_FAIL = 0x02` but does not document the
  firmware's transfer lifecycle.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Ignore the refusal and retry the same bucket (current) | No new commands | Leaves the device in a transfer state that answers 2 forever; loop | Reject |
| Rebuild the table after any refusal | Recovers eventually | `0013` measured this: blank glass and lost frames on every miss | Reject |
| Increase the read budget | Fewer missed replies | Does not clear a transfer that was opened; queue-timing dependent | Reject alone |
| **End the transfer with `36 02` when begin drew no reply or answered 2** | One command on the failure path only | None; the success path is unchanged | **Adopt** |
| Read until `37 03`, not "the next report", for `36 03` | Follows the documented reply-matching rule | None | **Adopt** |

## Rung 6 — smallest probe

Against the attached Z73 (firmware 5.11.0), with the host panel disconnected:

- `36 01 03` answered status 1; an immediate second `36 01 03` answered
  **status 2**; `36 03` then `36 01 03` answered 1, and `36 02 03` then
  `36 01 03` answered 1. **Status 2 is "a transfer is already open", and both
  `36 03` and `36 02` close it.**
- After 60 s of no reads, `75 01` broadcasts filled the queue and the first
  commands exhausted their 8 reads; replies then shifted by several commands.
  The frame still completed, but the probe shows a begin reply can be missed
  exactly where the host reports `none`.
- A passive second HID handle watched the reconnected host send `delete`,
  `create`, `begin`, `end`, `switch` for one frame, every status 1, then only
  `75 01` reports. The device itself is healthy.

## Decision

When a begin-write draws no reply, or answers status 2, the firmware may hold an
open transfer. `writeFrame` now sends `36 02 <bucket>` and reads `37 02` before
throwing. The next tick starts from a closed transfer instead of being refused
with 2, so one missed reply costs one frame rather than a reconnect loop.

`prepare` also reads the `37 03` reply to `36 03` instead of discarding "the
next report", matching the rule already stated in `docs/hardware/nzxt-kraken-z.md`
and keeping a broadcast from shifting the reply stream.

The status-9 repair and 0013's carry-on rule are unchanged: only the two states
that can leave a transfer open are closed.
