# 0010 — The TURZX screen control is brightness, and neither 131 nor 130 is wired

- **Date:** 2026-10-30
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/turzx-protocol.ts`,
  `src/web/packages/host/src/panels/turzx-panel.ts`

## Problem

`screenOn` was `[131, ef, 69, 0, 0, 0, 0]` — the sleep opcode with a zero length
field — and `screenOff` was the sleep opcode itself. A panel that sleeps cannot
be woken by a packet that says nothing, so "screen on" was at best a no-op.

## Rung 1 — internal owner

Searched: `screenOn`, `screenOff`, `TURZX_COMMAND`, and the `screen` control in
`turzx-panel.ts`. Found: `turzx-protocol.ts` owns the command table and
`turzx-panel.ts` owns the `screen` control that picks a row from it. The
adapter already carries `brightnessWeight` for the settings packet, which is the
state a brightness-based screen control needs.

## Rung 2 — installed dependencies

Searched: the host's runtime dependencies. Found: none — the command table is
this module's.

## Rung 3 — native platform

Searched: Node serial write behaviour for a device that leaves the bus. Found:
nothing to reuse; a write to a vanished port never settles, which is itself the
measurement below.

## Rung 4 — public solutions

Searched: the vendor's own application (`UsbMonitorL.exe`, SHA-256
`530c9134c312b61ebc562aacba0b914bbb4033d5271feeae1da2164853cd6d27`,
decompiled with ILSpy 9). The transport wrapper (`른.cs:3088`) builds a 10-byte
header — opcode, `ef 69`, four-byte big-endian length, one mode byte, two
reserved bytes — then the payload. Two bare commands exist:

- `뮗.cs:6992` — opcode 131, sent from the power-mode handler on suspend
  (`붶.cs:10760`) and from the exit sequence (`붶.cs:10198`);
- `뮗.cs:6983` — opcode 130, sent in one place only, `뮗.cs:5409`: the
  ready-video handshake logs `ReadyVideo` and waits 2 s after it, with the panel
  still attached.

Before both, the vendor writes brightness 0 (`붶.cs:10164`). Nothing in the
vendor's code sends either command as a user-facing screen toggle.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep 131 / 131-with-zero-length | Sleep cannot be undone from the host | None to state | reject |
| 131 to sleep, 130 to wake | Assumes a wake channel the bus does not have | A port to write 130 on | reject |
| Brightness 0 to blank, last weight to restore | Uses opcode 123, which is already verified on hardware | None | accept |

## Rung 6 — smallest probe

Measured on rom1.88 with `turzx-sleep`: HELLO answers `chs_5inch.dev1_rom1.88`
and QUERY_STATUS answers `needReSend:0|renderCnt:481`; writing the sleep packet
removes the panel from `SerialPort.list()` (only `COM4`, `COM1` remain) and the
next write never settles. The panel returned only after a later enumeration, not
by anything the host sent. The screen is therefore not writable once asleep, and
the host has no wake path at all.

## Decision

`screen` writes brightness — zero to blank, the level this host last set to
restore — and no sleep or wake opcode is named in the command table. A setting
that cannot be undone from the host is not offered as a control.
