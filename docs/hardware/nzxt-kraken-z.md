# NZXT Kraken Z LCD

- **Family:** Kraken Z (the LCD on the pump block)
- **Models:** NZXT Kraken Z53 / Z63 / Z73, USB `1e71:3008`, round 320×320 screen
- **Firmware verified:** `5.11.0`
- **Transport:** two interfaces on one device — **HID** control on interface 1,
  64-byte reports; **bulk** data on interface 0, endpoint `0x02`
- **Driver:** `src/web/packages/host/src/panels/kraken-z3-panel.ts`
- **Last hardware verification:** 2026-10-31

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

**The firmware emits unsolicited `75 01` status reports.** A reader must match
the exact expected reply prefix (`33 02`, `37 01`, …) rather than "the next
report", or a stray `75 01` is read as a failed command.

Reads use a 120 ms timeout and 8 attempts.

## Buckets

The firmware exposes a table of **16 buckets**, each a fixed region of the
device's frame memory. A frame is uploaded into a bucket that is **not currently
on the glass**, then the panel is switched to it.

Units: start and size are counted in **1024-byte slots**. One 320×320 RGBA frame
is 409,600 bytes plus a 20-byte transfer header = 409,620 bytes = **401 slots**.
Bucket `i` therefore starts at slot `i * 401`.

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
the device is busy. Both are treated as "this frame was not stored"; the driver
rebuilds the table next time.

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
- `0x03` — 256-colour paletted: **102,400 bytes** (8 bits per pixel).

The driver streams mode `0x02`. Mode `0x03` paints correctly through the same
ring at a quarter of the bytes, but 256 colours over a gradient or a photograph
is large flat banding, visibly worse than the frame the browser composed. A
mode-2 frame costs ~52 ms of bulk on this host; the glass then needs about
140 ms per switch (see *Cadence*), so the wire is not the limit.

The 401-slot bucket size is computed from the **mode-2** frame. A mode-3 frame
would not fit the same bucket arithmetic.

## Frame sequence

The first frame also empties whatever CAM or a previous run left:

1. `36 03` liquid mode.
2. Switch bucket 0 to **liquid** (`38 01 02 00`) — liquid mode first, because
   the firmware refuses to delete the bucket it plays.
3. Delete all 16 buckets.
4. Then for each frame, into the bucket **not** on the glass:
   delete → create → `36 01` → header + pixels → `36 02` → **wait 10 ms** →
   switch to it.

**The 10 ms settle is required.** `36 02` answers before the glass has the
bucket's last tiles; switching on its heels shows part of the old picture, which
on a moving theme reads as a tear. Every command still reports success, so no
status check can see this. The 10 ms is the measured gap that removes it.

The panel alternates between two buckets. Writing the displayed one is refused;
that is the invariant the two-bucket ring exists to satisfy.

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

## Open questions

- Firmware versions other than 5.11.0 and any command differences.
- The rest of `31 01`'s field layout (brightness encoding is known to exist,
  but the byte's scale is unread).
- Whether mode `0x03` has a bucket-size rule of its own, and whether other
  Kraken models share this exact bucket table.
- Whether a paletted (103,424-byte) frame raises the glass's switch ceiling
  above 140 ms, which would explain CAM's ~9 FPS. This driver has not measured
  mode 3 at a paced cadence.
- The meaning of status 18's conditions beyond "busy".
