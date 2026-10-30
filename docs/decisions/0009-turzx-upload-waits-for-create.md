# 0009 — The TURZX upload waits for `create_success` before its first chunk

- **Date:** 2026-10-30
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/turzx-panel.ts`

## Problem

`TurzxPanel.upload` wrote the UPLOAD_FILE header, then every 249-byte chunk,
then read for `create_success` and `file_rev_done` together. On rom1.88 a clip
upload started this way never completes: the panel answers `create_success` and
then nothing, and the 10 s read cap ends the wait after the transfer has already
stranded. Every video start therefore failed at its first upload, and the runner
fell back to full-frame stills.

## Rung 1 — internal owner

Searched: `upload`, `readUntil`, `readReplies`, `startVideo` in
`turzx-panel.ts`, and the ack reasoning in its own comment.
Found: `turzx-panel.ts` owns the file transfer; the ordering of the header, the
chunks and the acks is decided in `upload` alone.

## Rung 2 — installed dependencies

Searched: `serialport` and the host's other runtime packages for a transfer
helper. Found: none — the port carries bytes; the protocol is this module's.

## Rung 3 — native platform

Searched: Node `Writable`/stream backpressure for the write side. Found:
irrelevant — the panel buffers its own file, and the failure is its own
acknowledgement, not flow control.

## Rung 4 — public solutions

Searched: the vendor's own uploader in `UsbMonitorL.exe` (SHA-256
`530c9134c312b61ebc562aacba0b914bbb4033d5271feeae1da2164853cd6d27`,
decompiled with ILSpy 9, Dotfuscator strings decoded by reimplementing its own
`뗯.b`). `뮗.cs`, the `슩(RootPath, Stream, string)` state machine:

- it reads the create reply and accepts it only when the text contains
  `create_success` (`뮗.cs:4258`);
- only then does it write the file's bytes (opcode 111, `뮗.cs:4490`);
- then it reads for `file_rev_done` (`뮗.cs:4436`) and compares the written size
  against the source length (`뮗.cs:4456`).

The vendor's order is create-ack, bytes, completion-ack.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep writing chunks before the create ack | Races the panel; strands | None to state — it is the defect | reject |
| Wait for `create_success`, then chunks, then `file_rev_done` | The vendor's own order | One reshape of the ack wait | accept |
| Add a fixed delay before the first chunk | Timing luck, not evidence | Would need a delay tuned per firmware | reject |

## Rung 6 — smallest probe

`turzx-diag2` writes the header and every chunk, then reads: on rom1.88 it
receives `create_success` at 0.2 s and nothing after it, and the 10 s cap ends
the wait. `turzx-diag3` is the same script with one read moved ahead of the
chunks; two runs of it both received `file_rev_done.img_show_` 0.1 s after the
last chunk. The same 3,852 bytes land in one arm and vanish in the other.

## Decision

`upload` reads the create ack before the first chunk, then waits for
`file_rev_done` after them. A firmware that emits the completion before the
create has already said it, and is not made to say it twice. The vendor's
uploader does the same, and the ordering is what the hardware test measures.
