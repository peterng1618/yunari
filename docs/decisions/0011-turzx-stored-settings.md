# 0011 — The panel's stored settings are one command, with brightness carried by the adapter

- **Date:** 2026-10-30
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/turzx-protocol.ts`,
  `src/web/packages/host/src/panels/turzx-panel.ts`,
  `src/web/packages/host/src/panels/panel-device.ts`,
  `src/web/packages/host/src/server.ts`,
  `src/web/packages/editor/src/host-settings-mode/client.ts`,
  `src/web/packages/editor/src/host-settings-mode/panel-controls-section.tsx`

## Problem

The panel stores what it shows at power-on, whether the image is upside down
and how long it waits before sleeping. The vendor app sets all three; Yunari's
control dialog offers only brightness, screen, restart, status and identify. A
panel mounted the other way up can only be turned over with the vendor's app.

## Rung 1 — internal owner

Searched: `PanelControlCommand`, `PanelControls.commands`, `runControl`,
`panelCommand` in `server.ts`, and the control dialog in
`host-settings-mode/`.
Found: `panel-device.ts` owns the command union, `turzx-panel.ts` owns the
bytes, `server.ts` owns the HTTP refusal, and `panel-controls-section.tsx` owns
the surface. Each is a place a new command must be named — the union is not
open for a silent pass-through.

## Rung 2 — installed dependencies

Searched: the host's runtime packages for a settings model. Found: none; the
command union is the model.

## Rung 3 — native platform

Searched: browser form primitives for the three inputs. Found: a `<select>`, a
checkbox and a `<select>` — no new component, and the styles are the ones
`source-form.tsx` already uses.

## Rung 4 — public solutions

Searched: the vendor's own settings screen (`UsbMonitorL.exe`, SHA-256
`530c9134c312b61ebc562aacba0b914bbb4033d5271feeae1da2164853cd6d27`,
decompiled with ILSpy 9). `뮗.cs:8146` builds the whole packet in one place:

```
byte[5] = { AppConfig.Brightness, AppConfig.startMode, 0,
            AppConfig.imgFlip, AppConfig.sleepDelay }
슩(125, 5, byte, 0)
```

The three settings the dialog is missing are `StartMode.Default|Image|Video`
(0/1/2, `StartMode.cs`), `imgFlip` 0/1 (`DevManagePage.cs:4814`) and
`sleepDelay`, whose list is `NoSleep` then 1–10 (`DevManagePage.cs:4963`). The
first byte is the same 0–255 weight opcode 123 carries. Nothing in the vendor's
code reads any of them back, and its settings screen sends all five bytes
whenever one changes.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| One command per field | The protocol has one packet, not three | Three writes that each rewrite the other two fields | reject |
| One `panel-settings` command carrying all three | The vendor's own packet | Brightness has no read-back and must be supplied | accept |
| Keep brightness out and send 125 with a zero byte | Blanks the panel on every mode change | None to state | reject |

**Brightness.** The packet rewrites the brightness byte, so a flip or mode
change would otherwise reset the level to whatever the host guessed. The
adapter therefore remembers the weight it last wrote (255 until the first
brightness command) and sends it with the settings. What the owner set before
this host started is unknown — the protocol cannot report it — and is replaced
by this host's first settings write.

## Rung 6 — smallest probe

The bytes are provable in unit tests: the packet's five payload bytes for a
given brightness and settings, and the refusal of values the firmware cannot
store. The panel's own observance is a hardware observation — the flip and the
power-on mode are visual states — recorded where the probe runs, not here.

## Decision

Add `panel-settings` to the command union with `startMode`, `flip` and
`sleepDelay`, sent as opcode 125 with the adapter's last brightness weight. The
dialog draws the three as one small form with one Apply, so one press is one
packet and no field can overwrite another by being sent alone.
