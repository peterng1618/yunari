# 0090 — Batch whole TURZX upload frames into one write

- **Date:** 2026-11-03
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/turzx-panel.ts`

## Problem

Assigning a theme with a video background left the panel on the previous theme
for a long upload. The clip the adapter sends is the transcoded panel video
(1.8 MB for a 13.1 MB source), and `upload()` wrote it as one serial `write` per
249-byte chunk: about 7,400 `port.write` + `port.drain` round trips, each
awaiting the port before the next chunk. The host's own full-frame path
(`present`) already writes 1.54 MB in a single call, so the panel and the USB
link were not the bottleneck; the per-chunk drain was.

## Rung 1 — internal owner

`turzx-panel.ts` owns `upload()` (`FILE_CHUNK_BYTES`, `frame`) and the
`SerialTransport` write seam in `serial-transport.ts`; no other panel family
shares the CDC upload path. `turzx-protocol.ts` owns the 250-byte framing, and
`present()` in the same adapter is the existing proof that a multi-hundred-KB
write is accepted. The fix belongs in `upload()`; the wire format does not
change.

## Rung 2 — installed dependencies

`serialport` exposes `write` and `drain`. `transportOver` resolves a write after
`drain`, deliberately: a panel ignores a frame that arrives half-sent. It does
not require one drain per protocol frame — the device reads an ordered byte
stream — and it has no built-in batching. The dependency's contract is "these
bytes are on the wire", which a larger write satisfies exactly as a small one
does.

## Rung 3 — native platform

Node's serial stream preserves write order. USB CDC is a bulk stream with
hardware flow control (the port opens with `rtscts: true`), so the device can
pace a large write; the host does not need to interleave drains to avoid
overrunning it. `present()` already demonstrates this on the same port by
sending a 1.54 MB buffer.

## Rung 4 — public solutions

Searches for `serialport node write drain per chunk throughput`,
`USB CDC bulk transfer max packet batching host` and `TURZX 5 inch upload
protocol` returned no reachable source in this offline environment. The
protocol evidence remains the device's recorded replies (0004) and the
firmware's observed tolerance for a full-frame write. There is no public
driver to reuse for this vendor protocol.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep one write per 249-byte chunk | Byte-identical | ~7,400 awaited drains per 1.8 MB clip; the fault itself | Reject |
| Raise the baud rate | Would move more bytes per second | The port's nominal baud is not what bounds a USB CDC gadget; changing it bets on firmware behaviour and is unverified | Reject |
| Write without awaiting `drain` | Removes the waits | `present`'s contract says a half-sent frame is ignored; a queue of pending writes hides backpressure and errors | Reject |
| Batch whole 250-byte frames into one write | Byte-identical stream, one drain per batch | Choose a batch size inside the driver's buffer; keep the last partial batch | **Reuse** |

## Rung 6 — probe

`turzx-panel.test.ts` uploads a 1,000-byte clip through the fake transport and
asserts the chunk writes are fewer than the five 249-byte frames, every write is
a 250-byte multiple, and the concatenated bytes equal five frames each padded
in place. Restoring the per-chunk loop makes the write-count assertion fail; the
byte comparison stays green, which is what shows the change is throughput only.
The hardware measurement that motivated it is the observed upload duration of a
13.1 MB source transcoded to 1.8 MB.

## Decision

`upload()` builds whole 250-byte frames exactly as before and copies them into a
16 KB buffer (64 frames), sending it when full and sending the remainder once.
`send()` still frames the buffer, which is a pass-through for a multiple of 250.
The panel reads the same bytes in the same order; the host performs about 1/64
as many drain round trips.
