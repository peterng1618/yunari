# 0133 — A hand-written codec for the TURZX 5" serial panel, and a diff overlay rather than a re-send

- **Date:** 2026-10-29
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/turzx-protocol.ts`

## The problem

A TURZX 5" panel (Rev C, 800×480) is a serial device, not a USB bulk endpoint.
Every write must be padded to a 250-byte multiple or the firmware ignores it;
pixels are BGRA chunked at 249 bytes and joined with a `0x00`; and the video
overlay is a *diff* the panel applies to its own composited frame, not a stream
of full images. The shape that is non-obvious is **ownership of the encoder**:
who decides chunk boundaries, padding, colour order and the visible list, and
whether an existing library can be trusted with those bytes.

## Rung 1 — Yunari

Searched: `packages/host/src/panels/` (all drivers), `panel-protocol.ts`,
`panel-image.ts`, `panel-families.ts`; grep for `serialport`, `bgra`, `latin1`,
`Uint8Array(250)`, `152250`, `chs_5inch` across `src/web`.

Found:

- The panel subsystem has **three wire shapes already**: Lian Li's DES-CBC USB
  packet (`panel-protocol.ts`), the Kraken's raw ARGB bucket write, and
  `panel-image.ts`'s ffmpeg decode to RGBA. All are USB/HID; **none is serial**.
- `panel-image.ts` is the reuse point for pixels: it already returns straight
  RGBA from the digest-verified ffmpeg, so this task only has to reorder and
  frame those bytes.
- **Nothing** in the tree sniffs a serial port, pads to 250, or encodes a
  diff/visible list. Grep found no `serialport`, no `bgra`, no `chs_`.

## Rung 2 — dependencies

Searched: `packages/*/package.json`, `npm ls serialport` on the merged tree.

Found: the host declares `usb`, `node-hid`, `node-forge`, `undici`,
`systeminformation`, `ffmpeg-static` — **no serial binding at all**, and
`npm ls serialport` is empty. `usb` cannot open a COM port: the panel is a USB
CDC gadget the OS exposes as a serial device, not a raw endpoint.

## Rung 3 — platform

Searched: Node 24's builtin module list, `node:serialport`.

Found: `require("node:serialport")` → `ERR_UNKNOWN_BUILTIN_MODULE`, and
`builtinModules` contains no serial entry. Node has `net.Socket` and `tty`, but
neither exposes baud/RTS-CTS termios on a COM device. A native binding is
required; the platform gives nothing to wrap.

## Rung 4 — ecosystem

Searched (web, 2026-10-29): `mathoudebine/turing-smart-screen-python` and its
`lcd_comm_rev_*` modules; `usausa/turing-smart-screen` (`TuringSmartScreenLib`,
.NET) and its PR #5 / issue #3 (the 5" Rev C protocol analysis by `MrFr1day`);
`phstudy/turing-smart-screen-cli`; the 3.10.0 release notes that separate the
serial models from the new USB ones; `serialport` on npm and
`serialport/node-serialport`'s LICENSE.

Found:

- **The 5" Rev C is supported by third-party drivers, so the protocol is
  known — but only in Python and C#.** `usausa`'s .NET lib added 5" support in
  2.2.0 with storage and video; `mathoudebine`'s Python library covers the
  serial revisions but states "no video or storage support for now". Neither is
  importable into a Node host, and neither's encoder is a wire-format-only
  module to port: both drag a display toolkit.
- **No JS/TS driver for this panel exists.** The ecosystem solves *talking to
  serial ports generally* (`serialport`, MIT, 13.0.0) but not *this panel's
  framing*.
- The library's own docs confirm the protocol is vendor-proprietary, so the
  bytes here are the verified probe, not a specification someone published.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| `serialport` + hand-written codec | MIT, prebuilt binding, only transport is reused | One native dep | Prebuilt binary trust | **Taken** |
| Port `mathoudebine/turing-smart-screen-python` | Covers serial frames, no video | No JS equivalent; GPL-3.0 | Licence + a toolkit in a Node host | Rejected |
| Port `usausa/TuringSmartScreenLib` | Covers Rev C including video | C#/WinForms; protocol is interleaved with UI | A second runtime | Rejected |
| Shell out to a Python driver | Works on one OS with Python | Ships a second toolchain | Repo is Node-only | Rejected |
| Full-overlay re-send per frame | No diff encoder needed | ~1.54 MB × every tick | **Probed: does not update after init** | Rejected, measured |
| Diff without a visible list | Smaller payload | Removed pixels never clear | **Probed: stale rectangles persist** | Rejected, measured |
| Directory auto-discovery of clips | Finds a user's media | Host scans storage it does not own | Wrong owner, hides the chosen file | Rejected |
| Hand-write the whole serial transport | No dependency | termios + RTS/CTS per OS | The rabbit hole this note exists to avoid | Rejected |

**The full-overlay re-send and the diff-without-visible-list rejections are the
probe results, not preferences.** The visible list replaces the visible set:
moving a rectangle cleared its old position with no explicit clear command, and
pixels that became transparent were cleared only by their absence from the list.

## Rung 6 — probe

Probed on the attached Rev C panel at `COM5` (USB `1D6B:0106`, Windows serial
`6&E9576A&5&0000`), 115200 8N1 with RTS/CTS:

- A 12-byte HELLO is ignored; padded to 250 it replies 23 bytes,
  `chs_5inch.dev1_rom1.88\0`.
- `START_DISPLAY_BITMAP` is 250 bytes of `0x2c`; every other frame pads `0x00`.
- A full static frame is PRE_UPDATE, START_DISPLAY_BITMAP, DISPLAY_BITMAP_5INCH,
  then the BGRA payload — **1,542,250 bytes on the wire**, which is exactly
  `ceil(800*480*4 / 249)` chunks, their `0x00` joins, padded to 250.
- The overlay init replies `seq_png_init_sucessneedReSend:0|renderCnt:N`; an
  update 8 ms later was dropped, 1.5 s worked, so the driver waits for the reply
  and a settle interval.
- Overlay colour is 4 bits per channel with 4 bits alpha; the offset is
  `y * 800 + x`.

## Rung 7 — build

What is built, and where it lives. The build is the hand-written codec the
Rung 5 table chose: `frame`, `parseHello`, `bgraPayload` and the verified command
table in `turzx-protocol.ts`. It is pure and has no imports — no DOM, no Fabric,
no `serialport` — because its callers are the adapter, the routes and the diff
encoder, and all three must be testable against golden vectors without hardware.
The codec lives in the host's own panel module rather than a dependency because
the bytes are this panel's probe: a library would own a wire format only Yunari
has verified, and the transport it would also drag in is the one part Rung 2
already supplies.

## Decision

**Reuse `serialport` for the transport and hand-write the codec.**

The transport is the part someone else already solved, including the per-OS
native binding; writing it would be the expensive rabbit hole. The **codec is
not** — every existing implementation is Python or C#, the only JS option is a
generic serial API, and the bytes are a probe of this specific panel. So this
task owns the bytes and nothing else: `frame`, `parseHello`, `bgraPayload` and
the verified command table live in `turzx-protocol.ts` as pure functions, tested
against the probe bytes, while `serialport` stays behind the `SerialTransport`
seam the adapter introduces.

**Rejected alternatives:**

- **Full-overlay re-send.** Measured: after init it does not update the display.
  The diff protocol is the only update path.
- **Diff without a visible list.** Measured: the panel keeps stale rectangles.
  The visible list replaces the visible set, and that is how removed pixels
  clear.
- **Directory auto-discovery of clips.** The host should act on a file the user
  chose, not scan storage it does not own; a chosen path is also the only thing
  the UI can show and the user can correct.

The hand-written codec is deliberately pure and DOM/Fabric-free so the adapter,
the routes and the diff encoder can all be tested against golden vectors without
hardware.
