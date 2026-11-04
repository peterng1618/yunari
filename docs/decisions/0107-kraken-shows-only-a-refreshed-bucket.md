# 0107 — The Kraken ring only shows a bucket it refreshed

- **Date:** 2026-11-05
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/kraken-z3-panel.ts`

## Problem

The display showed a clock theme whose whole composition moved — a shift up,
then back to the centre, then down with the date clipped — while the panel page
rendered a stable, centred composition and the host logged nothing.

The page path was measured clear: a screencast of the live page held one ink
box, and the same page re-opened in the panel's own browser settled within
1.3 s. That leaves the hand-off between the composed frame and the glass. Its
three bucket commands each answer a status byte, and **the driver dropped all
three**: a refused delete leaves the bucket holding its previous graphic (the
firmware keeps the first image a bucket stored), and a refused setup was
followed by the whole 409,600-byte stream anyway. Either way the glass can show
what the driver did not intend, and neither leaves a log line.

## Rung 1 — internal owner

Searched: CodeGraph for `KrakenPanel`, `writeFrame`, `present`, `panel-runner`
and the prior decisions (0013, 0019, 0020, 0026).

Found: `kraken-z3-panel.ts` is the only module that speaks the protocol;
`panel-runner.ts` owns cadence, retry and the failure threshold. 0013 already
recorded that gating every command on its status *and rebuilding the table*
on refusal made live themes worse (a refusal cost a dropped frame plus a
`prepare()` that liquefies the glass), and was reverted for that reason. The
missing piece is not the rebuild: it is that the frame path carried on with a
table it had just been told was not what it assumed.

## Rung 2 — installed dependencies

Searched: `node-hid` typings and `usb`'s `nativeTransferOut`.

Found: `node-hid` returns whatever reports the firmware sends, including its
periodic `75 02` status broadcast; `usb` reports transfer errors and a byte
count, not the firmware's status. Neither can answer whether a bucket command
succeeded. The status byte in the reply is the only answer.

## Rung 3 — native platform

Searched: Windows and Node APIs.

Found: no framebuffer readback exists for the LCD, so what the glass shows
cannot be read back. The device's own replies, and a camera, are the only
observations; the camera on this machine reports black (lens covered), so the
replies are the instrument.

## Rung 4 — public solutions

Searched: liquidctl `kraken3.py`, its issues (#774, #908), the KrakenZPlayground
protocol wiki, and `relative23/kraken-lcd`'s `docs/firmware-notes.md` and
`driver_patch.py`.

Found:

- **liquidctl** checks the status of every bucket command and raises on
  anything but success; `_prepare_bucket` deletes a bucket **twice** when it
  already held data, and its upload sequence never leaves a refusal unchecked.
  Its only weakness, which kraken-lcd documents, is that stock releases *log*
  a refused `_setup_bucket` and then stream anyway.
- **NZXT CAM 4.76.6** (captured in 0018) sends `32 02 <idx>` twice before each
  upload — the same double delete.
- **kraken-lcd** treats a refused setup as a hard stop: "never stream after a
  refused setup"; streaming into one wedged their device into its bootloader.
  It also notes that the firmware's sporadic refusals are frequent enough that
  a driver must absorb them without a visible cleanup.
- **KrakenZPlayground** documents the same ordered sequence and the same
  "do not write the bucket being displayed" rule.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep dropping the statuses (today) | Zero cost | A refused delete or setup puts an old or undefined picture on the glass, silently | Reject |
| Read every status and rebuild with `prepare()` on any refusal | Recovers | 0013 measured it: every refusal costs a frame and a liquid flash, which dominated on a live theme | Reject |
| **Read every status; refuse the frame instead of streaming; repair with the other bucket on status 9** | Fits the existing ring and `present`'s repair | One frame lost per refusal, and the runner's own retry covers it | **Implement** |

## Rung 6 — smallest probe

Two measurements, both executable:

- The live panel page, sampled through the compositor, held one ink box
  (`x 92, y 72, 102x177`) across 20 s; a re-opened page produced a pre-settle
  frame at 0.49 s and the settled frame at 1.29 s. The only frames the host can
  send whose composition differs are those first two, so a bucket that keeps
  one and is switched to puts it back on the glass.
- liquidctl and CAM, read at source and from CAM's captured traffic, both
  delete a used bucket twice and both gate the upload on the setup.

## Decision

`writeFrame` reads the status of the delete, the create (setup), the begin and
the switch:

- A refused delete is retried once (liquidctl deletes a bucket that held data
  twice), then the frame is refused: a bucket still holding its old graphic is
  never written over or switched to.
- **A refused setup is never followed by a bulk stream.** The frame is refused
  instead, so the glass keeps what it already has rather than an undefined
  picture.
- A refused switch leaves `shown` where it was: the frame is in the bucket but
  not on the glass, and the next tick rewrites that bucket.

`present` keeps its status-9 repair — the firmware refuses the bucket it is
displaying, so a status 9 on any of those commands means `shown` is wrong and
the other bucket is the one not displayed. A refusal is never carried on as if
the table were what the last successful frame left it as, and it now names the
command in the runner's log, which is what makes the next occurrence visible.

Reading a status made the *wait* wrong in a way the drop hid. `readUntil` used
to spend a fixed **count** of reports, and the firmware broadcasts an
unsolicited `75 0x` status report about once a second that the OS queues. A
clock theme sends one frame a minute, so its next delete found ~60 broadcasts
queued ahead of its answer: the budget was spent in microseconds and the frame
was refused with `status none` — no reply at all, which the runner turned into
a reconnect. The wait is now a window in **time** (`REPLY_WINDOW_MS`), and any
report that is not the awaited `(first, second)` prefix is dropped as
liquidctl's `_read_until` does.
