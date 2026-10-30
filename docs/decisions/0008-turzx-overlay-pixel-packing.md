# 0008 — The TURZX overlay sends 20-bit colour, not 12

- **Date:** 2026-10-30
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/turzx-protocol.ts`

## Problem

`overlayUpdate` packs each pixel as three bytes with four bits per channel plus
a four-bit alpha, a port of the `turing-smart-screen-python` reference. That
quantizes blue and green to 16 steps and red to 16, so a glass tint or a gauge
arc bands; the host added a 4x4 Bayer dither to trade the band edge for noise.
Three bytes per pixel is fixed by the protocol, so the question is what the
remaining bits of each byte are for.

## Rung 1 — internal owner

Searched: `overlayUpdate`, `overlayHeader`, `overlayTrailer`, `turzx-panel`
`presentOverlay`, and the dither comment naming the 2026-10-29 measurement.
Found: `turzx-protocol.ts` owns the pixel packing, the segment walk and the
body layout; nothing else in the host re-encodes an overlay. The dither exists
only because of the 4-bit assumption.

## Rung 2 — installed dependencies

Searched: host dependencies for an encoder. Found: none — the protocol is
written by hand; `ffmpeg` handles video only. No library is involved.

## Rung 3 — native platform

Searched: Node `Buffer`/typed-array writes. Found: nothing to reuse; the byte
layout is the device's contract and has to be stated here.

## Rung 4 — public solutions

Searched: the vendor's own application. `UsbMonitorL.exe`
(SHA-256 `530c9134c312b61ebc562aacba0b914bbb4033d5271feeae1da2164853cd6d27`,
.NET, Dotfuscator) was decompiled with ILSpy 9; its encrypted string constants
were decoded by reimplementing its own `뗯.b` (per-character XOR keyed from
`633624654 + a_ + 188`). `렎.cs`'s diff encoder writes each changed pixel as:

```
byte0 = (B & 0xFC) | (alphaHighNibble >> 2)
byte1 = (G & 0xFC) | (alphaHighNibble & 3)
byte2 = R
```

— six bits of blue, six of green, eight of red, four of alpha. The alpha bits
are in the same positions as the reference's; the extra bits are the low bits
of blue and green and the low nibble of red. Its segment walk (three-byte
offset, two-byte width), body layout and command opcodes match this module.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep 4-4-4 plus dither | Current | Banding replaced by a fixed texture | reject |
| 6-6-8 from the vendor's encoder | Same three bytes; a superset of the current top nibbles | None; a device that reads four bits sees the same image | accept |
| Add a second full-colour format | Not offered by the protocol | A mode the device does not have | reject |

## Rung 6 — smallest probe

The packing is provable in a unit test (exact bytes for a grey patch), and the
panel's use of the extra bits is provable on hardware with a 64-step grey
gradient overlay. The unit test is the change's own evidence; the device read
is a separate observation, recorded where the probe runs, not assumed here.

## Decision

Write blue and green as six bits and red as eight in the same three bytes the
device already takes, with the alpha nibble where it was. The dither goes: at
64 green/blue steps it hides nothing and adds texture to a smooth surface. A
device that honours only four bits per channel renders exactly what it renders
today, so the change cannot make the overlay worse.
