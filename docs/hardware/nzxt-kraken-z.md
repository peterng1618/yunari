# NZXT Kraken Z LCD

- **Family:** Kraken Z (the LCD on the pump block)
- **Models:** NZXT Kraken Z53 / Z63 / Z73, USB `1e71:3008`, round 320×320 screen
- **Firmware verified:** `5.11.0`
- **Transport:** two interfaces on one device — **HID** control on interface 1,
  64-byte reports; **bulk** data on interface 0, endpoint `0x02`
- **Driver:** `src/web/packages/host/src/panels/kraken-z3-panel.ts`
- **Last hardware verification:** 2026-11-06
- **Last known good revision:** `304a304811c4` (2026-11-06) — **the last
  revision a person watched on the glass and confirmed.** Mode B at CAM's
  110 ms was watched smooth again on a heavy-motion theme; Mode A remains the
  default. The 100 ms build that came before it was watched as worse and is
  reverted. Compare a future playback regression against this revision. A
  revision only becomes this line after the user confirms it played well —
  probe results and command timings are not a substitute for watching the
  panel.

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
| `10 01` | `11 01` | Firmware version — major/minor/patch at bytes `0x11..0x13` |
| `30 01` | `31 01` | LCD information — brightness at `0x18`, mount quarter turns at `0x1A` |
| `30 02 01 <pct> 00 00 01 <orientation>` | — | Sets LCD brightness; the current orientation travels in the same report |

The driver does not rotate the picture: the display record owns rotation and the
`31 01` quarter turns are only read, never applied to frames. Brightness is the
Brightness control, written with liquidctl's own sequence; the current
orientation is carried into the write so a brightness change does not turn the
glass. The Status control reports the firmware and the LCD's brightness and
orientation.

**Screen reuses that brightness report.** The family declares Brightness, Screen
and Status. Screen off writes the same `30 02` report with level 0, and Screen on
restores the level this host last wrote (full before the first write); asking for
a brightness also brings the glass back. No separate screen-off report is known:
zero brightness draws nothing and leaves the cable open, which is the same
tradeoff the Turzx driver made when its sleep opcode turned out to drop the
device off the bus. Stored settings and Restart stay undeclared because no
proven report carries them.

- **The firmware emits unsolicited `75 01` status reports.** A reader must match
  the exact expected reply prefix (`33 02`, `37 01`, …) rather than "the next
  report", or a stray `75 01` is read as a failed command. They arrive about
  once a second, and the OS HID queue holds 64 per handle; after an idle spell
  a command's own reply can sit behind a queue of them. Measured 2026-11-04
  with a passive second handle and with a 60 s silent run.

Reads use a 120 ms timeout and 8 attempts.

## Lighting and fan reports

Recovered from SignalRGB's shipped `Nzxt_Kraken_Z3_AIO.js` and **verified on
the attached Z73 on 2026-11-12** (firmware not re-queried during the run; the
LCD reported its usual behaviour). All of these are 64-byte reports on
**interface 1**, the same handle the LCD commands use, so they are serialised
with the bucket commands and never overlap a transfer.

**Lighting — one channel, 40 LEDs.** Two data reports carry 60 colour bytes
each, twenty LEDs per report, then a commit:

| Send | Bytes | Reply |
|---|---|---|
| Data 0 | `22 10 01 00` + 20 LEDs × **G R B** | none |
| Data 1 | `22 11 01 00` + the next 20 LEDs × G R B | none |
| Commit | `22 A0 01 00 01 00 00 28 00 00 80 00 32 00 00 01` | none |

The mask byte is `1 << channel`; the Kraken Z has channel 0 only. **The wire
order is GRB, not RGB** — the shipped plugin asks the runtime for
`getColors("Inline", "GRB")` before packing, while the SignalRGB bridge's UDP
frame carries RGB triples. The conversion belongs at this boundary.

**Fans and pump — forty appended percentages.** The same value is repeated in
40 slots; the pump's firmware floor is **25%**, so a lower request is raised to
it, while fans may stop at 0%.

| Send | Meaning | Reply |
|---|---|---|
| `72 01 00 00` + 40 bytes | pump speed, percent | none |
| `72 02 00 00` + 40 bytes | fan speed, percent | none |

**Status.** Write `74 01` and read until a `75 01` reply (never "the next
report", because the firmware broadcasts `75 01` on its own):

| Bytes | Field |
|---|---|
| 15, 16 | liquid temperature: whole °C, then tenths |
| 18:17 | pump RPM, little-endian |
| 19 | pump percent |
| 24:23 | fan RPM, little-endian |
| 25 | fan percent |

Measured on 2026-11-12: the status reply returned **45.0 °C, 1775 → 1652 RPM
pump (50% → 35%), 1022 RPM fan at 50%**. Writing `72 01` / `72 02` was
reflected in the next status reply (pump 30%, then 35%; fan 40%, then 50%)
while the LCD kept taking frames on the same handle and reported no refusals.
Ninety YRGB colour frames were written through the same queue with zero
malformed datagrams and no LCD error. Lighting writes drew no error, but **the
LEDs were not watched** — no person was at the glass during the run, so
emission and colour order are unconfirmed visually (see *Open questions*).

## What CAM exposes beyond these reports

Recovered 2026-11-10 from the shipped `@nzxt/cam-core` addon and the packed
application code (no hardware was touched). These are the surfaces NZXT's own
software has that this driver does not use.

- **`LcdApi` methods:** `previewGraphic`, `renderGraphic`, `setBrightness`,
  `setStandbyClock`, `startLcdStreaming`, `stopRendering`, `watchLcdData`. The
  rendering and streaming methods are the content path this driver replaces with
  its own PNG decode and bucket ring.
- **`DisplayConfig { backlight, sleep, orientation }`.** The three settings CAM
  keeps per LCD device. `backlight` and `orientation` are the two values
  `31 01`/`30 02` already carry. `sleep` has no observed non-zero value: the
  `30 02` report is always written `30 02 01 <pct> 00 00 01 <orient>` by every
  driver, so bytes 4 and 5 have never been varied.
- **`setStandbyClock(device, boolean)`.** CAM wires this to a lighting-profile
  `Standby Clock` toggle and applies it to every capable device, including the
  Kraken Z. The boolean is passed into the addon; what the addon does with it is
  not recovered.
- **Device information fields.** CAM's reader names `display_backlight_level`,
  `sleep_mode`, `screen_orientation`, `number_of_buckets`, `max_flash_size` and
  `device_busy` in the LCD information response, and
  `current_graphics_mode_on_lcd_screen` in a separate state response. This is
  consistent with every value `31 01` already gives up; the status response's
  exact bytes are unmapped.
- **`0x30 0x04 <bucket>` queries a bucket.** It is the content path's query, not
  a control; this driver tracks its ring in memory instead.

**Standby clock and display sleep stay unimplemented.** The addon is a 48 MB
stripped Rust binary: its NAPI class registers the method names above, but the
callback dispatches the actual write through a trait vtable, so the report bytes
are not recoverable from the binary. Writing a guessed `sleep` byte into an LCD
controller is exactly the class of command this document's "known opcodes only"
rule excludes. A USB capture of CAM toggling the toggle is the cheap way to
close it (see *Open questions*).

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
  is part of the ceiling. Mode B uses CAM's ring and its **110 ms** cadence
  (`KRAKEN_PALETTED_FRAME_INTERVAL_MS`). Measured on the attached Z73 on
  2026-11-06: one frame costs ~75 ms of host work, so 110 ms leaves headroom.
- **The cadence is the glass's, not the source's.** Sampling a 30 fps page
  every 110 ms advances 3, 3, 4 source frames. A 100 ms tick makes that advance
  exactly 3, but it outruns the glass: the extra switches are answered status 1
  and never appear (the drop below), and the owner watched that build as
  **worse** on heavy motion than 110 ms (2026-11-06). Spending the device's
  ceiling evenly beats exceeding it.
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

- **LED emission and colour order are unverified visually.** The report bytes
  came from the shipped plugin and the device accepted them without an error,
  but nobody watched the ring during the 2026-11-12 run. A human should confirm
  red/green/blue reach the ring in the expected order.
- Whether the 40 fan slots correspond to one fan header each, or the firmware
  broadcasts one value to every header.
- Whether lighting writes are safe *during* an open bucket transfer. The driver
  serialises them so the question is untested, not accepted.
- Firmware versions other than 5.11.0 and any command differences.
- The rest of `31 01`'s field layout beyond brightness (`0x18`) and orientation
  (`0x1A`). CAM's reader names a `sleep_mode` and a `current_graphics_mode` for
  this device, so both live in one of the unread reports.
- **Bytes 4 and 5 of the `30 02` report.** Every known driver writes them `00`,
  and `DisplayConfig` carries a `sleep` field, so a sleep setting plausibly
  lives in one of them. That is a guess, not a fact: no non-zero value has ever
  been observed, and sending one is refused until a capture shows what CAM
  writes.
- **The standby-clock report.** `LcdApi.setStandbyClock(device, bool)` exists
  and CAM's UI drives it, but the bytes are behind dynamic dispatch in a
  stripped 48 MB addon. Capture with CAM running, the Standby Clock toggle
  flipped, filtering USB `1e71:3008` interface 1; the 64-byte report is the
  answer.
- The brightness write (`30 02 01 …`) is liquidctl's captured sequence; it has
  not been exercised on the attached Z73 since the control was added
  (2026-11-10).
- Whether mode `0x03` has a bucket-size rule of its own, and whether other
  Kraken models share this exact bucket table.
- Why CAM's paced stream shows ~110 ms intervals when this firmware drops a
  mode-3 switch about every 20th frame at that rate; CAM may accept the drops,
  or drive the ring in a way this probe does not reproduce.
- The meaning of status 18's conditions beyond "busy".
