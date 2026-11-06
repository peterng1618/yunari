# NZXT Kraken Z LCD

- **Family:** Kraken Z (the LCD on the pump block)
- **Models:** NZXT Kraken Z53 / Z63 / Z73, USB `1e71:3008`, round 320×320 screen
- **Firmware verified:** `5.11.0`
- **Transport:** two interfaces on one device — **HID** control on interface 1,
  64-byte reports; **bulk** data on interface 0, endpoint `0x02`
- **Driver:** `src/web/packages/host/src/panels/kraken-z3-panel.ts`
- **Last hardware verification:** 2026-10-31
- **Last known good revision:** `988cda820713` (2026-11-06) — playing well on
  the attached Z73; its frame rate still trails NZXT CAM, which is a known gap
  rather than a regression. Compare a future playback regression against this
  revision.

**Update this document with every new fact.** Record a firmware string, a
command the driver starts using, a refusal and its cause, a timing constraint —
with the date and how it was measured. Correct anything this document states
wrongly. Put unverified guesses under *Open questions*, never in the body as
fact.

## Two channels, two stacks

The LCD cannot be driven through one handle:

- **Control is HID.** Interface 1 takes 64-byte output reports. On Windows that
  interface is owned by the HID class driver, so the host opens it through
  `node-hid`; claiming it through libusb fails with *"incompatible driver is
  installed."*
- **Data is bulk.** Interface 0, endpoint `0x02`, opened through libusb. A
  409,600-byte frame goes out in **one** bulk write (~36 ms); splitting it into
  liquidctl's 512-byte writes costs 800 round trips for the same bytes.

If NZXT CAM is running and holding the LCD, opening fails; stopping CAM releases
it.

## Control reports

All reports are 64 bytes, zero-padded. **Pass exactly 64 bytes:** a 65-byte array
is read by Windows as "report ID + 64 bytes" and the device refuses it
(`0x57`).

Open probes the firmware before anything is written:

| Send | Expected reply | Meaning |
|---|---|---|
| `10 01` | `11 01` | Firmware version |
| `30 01` | `31 01` | LCD information |

`31 01` carries the mount's quarter turns in byte `0x1A` and the brightness. The
driver does not read either: the display record owns rotation, and brightness is
not implemented for this family.

- **The firmware emits unsolicited `75 01` status reports.** A reader must match
  the exact expected reply prefix (`33 02`, `37 01`, …) rather than "the next
  report", or a stray `75 01` is read as a failed command. They arrive about
  once a second, and the OS HID queue holds 64 per handle; after an idle spell
  a command's own reply can sit behind a queue of them. Measured 2026-11-04
  with a passive second handle and with a 60 s silent run.

Reads use a 120 ms timeout and 8 attempts.

## Buckets

The firmware exposes a table of **16 buckets**, each a fixed region of the
device's frame memory. A frame is uploaded into a bucket that is **not currently
on the glass**, then the panel is switched to it.

Units: start and size are counted in **1024-byte slots**. One 320×320 RGBA frame
is 409,600 bytes plus a 20-byte transfer header = 409,620 bytes = **401 slots**;
bucket `i` therefore starts at slot `i * 401`. A paletted frame is 103,424
bytes — exactly **101 slots** — and CAM addresses bucket `i` at slot `i * 101`.
CAM writes the 20-byte transfer header into a 101-slot bucket anyway; the 20
bytes land in the next region, which the next frame deletes and recreates. All
16 paletted buckets together are 1,616 slots, the range CAM itself uses.

| Command | Bytes | Reply | Effect |
|---|---|---|---|
| Delete | `32 02 <index>` | `33 02` | Empties the bucket |
| Create | `32 01 <index> <index+1> <start LE16> <slots LE16> 01` | `33 01` | Defines the bucket |
| Begin write | `36 01 <index>` | `37 01` | The next bytes are the frame |
| End write | `36 02 <index>` | `37 02` | Closes the upload |
| Switch | `38 01 04 <index>` | `39 01` | Shows the bucket (picture mode) |
| Switch | `38 01 02 00` | `39 01` | Liquid mode, bucket 0 |
| Liquid | `36 03` | — | Puts the glass into liquid mode |

The delete, create and begin-write replies the driver checks carry success as
**byte 14 = 1**.

**The firmware refuses the bucket it is displaying.** Deleting or starting a
write on the shown bucket answers status **9**, `BucketIsBeingDisplayed`, and
nothing is stored — every write still succeeds on the wire. Status **18** means
the device is busy. **Status 2 means a transfer is already open**, and status
`none` is a begin-write that drew no reply at all.

**A begin-write with no reply may still have opened the transfer.** The command
landed; only its answer went missing. Until `36 02 <index>` (end) or `36 03`
closes it, every further begin answers **2**. The driver ends the transfer when
a begin answers `none` or `2`, so one missed reply costs one frame rather than
a reconnect loop (2026-11-04: the host looped `none`, `2`, `disconnected` until
this was added).

**Only status 9 means the ring is out of step.** It means a switch was dropped,
so the bucket `shown` names is the one the glass is *not* showing: the driver
writes the other bucket instead, and the picture recovers without touching the
table. The full rebuild is a last resort, for the case where neither bucket
takes a frame. A busy device (18) or a command that drew no reply (`none`) left
the table intact; the next tick deletes and recreates the same bucket anyway,
so those retry without liquefying the glass. Rebuilding for them turned one
missed command into a visible blank (2026-11-04).

A bucket that already holds an image is not overwritten in place: the firmware
keeps the first graphic stored there. So **every frame deletes and recreates its
bucket**, and the driver write path is delete → create → begin → header → pixels
→ end → switch.

## Frame format

A frame is a 20-byte transfer header followed by the pixels:

| Bytes | Content |
|---|---|
| 0–11 | Magic `12 fa 01 e8 ab cd ef 98 76 54 32 10` |
| 12 | Transfer mode |
| 13–15 | Zero |
| 16–19 | Payload byte count, **little-endian** uint32 |

Modes:

- `0x02` — 320×320, 32 bits per pixel, RGBA, alpha ignored: **409,600 bytes**.
- `0x03` — 256-colour paletted: a **1,024-byte palette** (256 entries of
  `R,G,B,A`; the firmware ignores the fourth byte and both CAM and this driver
  write 0) followed by **102,400 8-bit indices** — **103,424 bytes** in all.

Two streams paint through the same ring, and the driver offers both: mode
`0x02` is the full-colour frame, and mode `0x03` is CAM's own stream. Mode 3
was rejected in 0020 for its 256 colours; the target is now CAM's actual
output, which is this format. The display record's `renderMode` chooses
(`mode-a` is `0x02` and the default, `mode-b` is `0x03`).

**The palette is rebuilt for every frame.** CAM's captured frames carry a
different palette almost every time (343 of 350 differ), average 255.3 entries
in use, and 42,715 low-distance neighbouring index pairs per frame — it
dithers. A fixed palette bands on gradients and cannot follow a photograph.

## Frame sequence

The first frame also empties whatever CAM or a previous run left:

1. `36 03` liquid mode.
2. Switch bucket 0 to **liquid** (`38 01 02 00`) — liquid mode first, because
   the firmware refuses to delete the bucket it plays. The glass is on bucket 0
   afterwards, so the ring writes bucket 1 next.
3. Delete all 16 buckets.
4. Then for each frame, into the bucket **not** on the glass:
   delete → create → `36 01` → header + pixels → `36 02` → **wait 10 ms** →
   switch to it.

**The 10 ms settle is required for a mode-2 frame.** `36 02` answers before the
glass has the bucket's last tiles; switching on its heels shows part of the old
picture, which on a moving theme reads as a tear. Every command still reports
success, so no status check can see this. The 10 ms is the measured gap that
removes it.

**CAM's paletted frame uses a different ring.** Captured from CAM 4.76.6
(`camcap.pcap`, 142 frames): every frame deletes its target bucket **twice**,
creates it at 101 slots, begins, writes the 20-byte header and 103,424 bytes,
ends, switches with `38 01 04 <index>` — and **never waits**. It cycles all 16
buckets, one frame per bucket, with no settle. Mode B relays that sequence; on
a two-bucket ring at 110 ms the previous driver lost about 6% of switches, and
the 16-bucket ring is what CAM's cadence depends on.

The two-bucket ring alternates between buckets 0 and 1 because the firmware
refuses the one on the glass. That invariant holds in both modes; only the ring
length, the slot count and the settle differ.

## Cadence and rotation

- **A mode-2 switch reaches the glass about once every 140 ms; a faster switch
  is answered success and silently dropped.** Filmed at 30 fps with a barcode
  frame per tick: at 70 ms only 50–59% of the sent indices ever appeared on the
  glass (worst with the settle in place), a few per cent were still missing at
  130–135 ms, and from 140 ms every index appeared (129 barcodes sent, 130
  pictures, no pull-back, no tear held for two camera frames). Every `32 02`,
  `32 01`, `36 01`, `36 02` and `38 01` answered status 1 throughout — nothing
  on the wire reports a dropped switch. The driver therefore asks the runner
  for one frame every **140 ms** (`KRAKEN_FRAME_INTERVAL_MS`).
- The **12.9 FPS** recorded earlier (2,316 answered frames in three minutes) is
  the ring's command throughput, not the glass's update rate. Sending at that
  rate does not put that many pictures on the glass.
- One mode-2 frame costs ~90 ms of host time on this machine: 409,600 bytes of
  bulk ~52 ms, the five bucket commands ~22 ms, the 10 ms settle and the PNG
  decode the rest. The glass's ~140 ms ceiling is the larger number, so the
  device, not the host, sets the rate.
- **A mode-3 frame (103,424 bytes) on CAM's 16-bucket ring reaches the glass
  every ~110 ms.** CAM's captured frame starts are 110 ms apart (median; p10
  108, p90 114) — about 9.1 FPS. The same payload on a two-bucket ring with the
  settle measured 120 ms on 2026-10-31 (145 updates with no skips at 120 ms, 2
  missing of ~145 at 115 ms, ~6% at 110 ms), so the ring, not only the bytes,
  is part of the ceiling. Mode B uses CAM's ring and its 110 ms cadence
  (`KRAKEN_PALETTED_FRAME_INTERVAL_MS`).
- CAM's stream lands ~9 FPS with its 103,424-byte paletted frame (captured in
  0018).
- Stills are sent as **PNG** and decoded to RGBA in the host
  (`stillFormat = "png"`); a JPEG would be loss for nothing.
- **The driver does not rotate.** The mount angle is the display record's
  `rotation`, already applied when the frame is captured. The `31 01` reply also
  reports quarter turns; honouring both turns every frame twice. The record is
  the owner because a person can see and change it.

## Quirks and failure modes

- **Status 9 is the usual "nothing happened".** It means the target bucket is on
  the glass, not that the device is broken. Fix the ring, do not resend blindly.
- **A bucket is write-once until deleted.** Recreating is the only overwrite.
- **The switch races the write.** No reply exposes the tear; only the settle
  interval does.
- **A switch sent before the glass has finished the previous bucket is
  dropped, and the switch still answers status 1.** It is not a refused
  command and it does not queue; the picture simply does not change. The
  hand-off must be paced to the glass (~140 ms for a mode-2 frame), not to what
  the wire can carry.
- **Never treat "next report" as the answer.** `75 01` interleaves.
- **Read the firmware and LCD queries before trusting the handle.** They are the
  only proof that the opened HID handle is one the firmware is listening on.
- **Do not claim the HID interface through libusb on Windows.**
- **A still page produces no frames, and that is not a lost panel.** The
  panel's page is read through Chromium's screencast, which pushes a frame only
  when the page recomposes. A clock without seconds, a photo or an icon
  composites once and then stays still; a capture that waited for a *newer*
  frame timed out, three timeouts counted as three failed frames, and the
  manager restarted the page every few seconds. The rasteriser now answers the
  newest frame it already has, which the runner compares against what the
  glass holds and sends nothing.

## Open questions

- Firmware versions other than 5.11.0 and any command differences.
- The rest of `31 01`'s field layout (brightness encoding is known to exist,
  but the byte's scale is unread).
- Whether mode `0x03` has a bucket-size rule of its own, and whether other
  Kraken models share this exact bucket table.
- Why CAM's paced stream shows ~110 ms intervals when this firmware drops a
  mode-3 switch about every 20th frame at that rate; CAM may accept the drops,
  or drive the ring in a way this probe does not reproduce.
- The meaning of status 18's conditions beyond "busy".
