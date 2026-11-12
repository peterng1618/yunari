# SignalRGB bridge — device seam for Yunari

Status: agreed 2026-11-12. Owner of this document: Yunari (it owns the device and the API).
The SignalRGB plugin in `signalrgb-plugins` implements the other half.

## Why

SignalRGB and Yunari cannot both open the Kraken Z (`1e71:3008`): SignalRGB switches the
composite device to its `HybridUSB` protocol and blocks Yunari's bulk interface, and when both
write, the glass scrambles (measured 2026-11-12). One process must own the device.

Yunari becomes that owner. It already owns the LCD (HID control on interface 1 + bulk frames on
interface 0). This seam adds **LED lighting** and **fan/pump control** to Yunari and lets
SignalRGB drive them through a virtual device, so SignalRGB keeps its canvas/effects and Yunari
keeps the glass.

The seam is generic: a *device sink* is anything Yunari owns that has a display, lighting and
controls. Kraken Z is the first implementation; future devices register the same way.

## Architecture

```
SignalRGB ──UDP 7788 (colours, 30 Hz)──> Yunari host ──HID iface 1──> Kraken LEDs
SignalRGB ──HTTP (controls, discovery)──> Yunari host ──HID iface 1──> Kraken pump/fans
                                            │
                                            └──iface 1 control + iface 0 bulk──> Kraken LCD
```

- Yunari opens `1e71:3008` once and serialises every write (LCD commands, lighting reports, fan
  reports) through that single owner.
- SignalRGB sees only a **network** device published by the bridge plugin; the real Kraken device
  is disabled in SignalRGB so it never opens the HID interface.
- Loopback only. Nothing on this seam is exposed to the LAN.

## Device descriptor (HTTP)

SignalRGB sees **one hub** named "Yunari". Every device Yunari owns that has lighting becomes a
subdevice, so each one can be placed independently on the SignalRGB layout canvas — the same model
as the Jungle Leopard L10 hub with its ports.

`GET http://127.0.0.1:5227/api/devices` →

```json
{
  "hub": { "name": "Yunari", "vendor": "Yunari" },
  "devices": [
    {
      "id": "kraken-z",
      "kind": "kraken",
      "name": "NZXT Kraken Z",
      "lighting": {
        "ledCount": 40,
        "udpPort": 7788,
        "channels": [ { "name": "Kraken Z", "leds": 40 } ],
        "layout": { "shape": "ring", "width": 4, "height": 4 }
      },
      "controls": { "pump": true, "fans": true, "telemetry": true },
      "display": { "kind": "panel", "width": 320, "height": 320 }
    }
  ]
}
```

- `devices` order defines the UDP **device index** (0-based). Devices without lighting are still
  listed, but the plugin creates no channel for them.
- `layout.shape` is `ring` (perimeter of `width`×`height`) or `strip` (`width` LEDs per row,
  `height` rows). The plugin turns it into `setControllableLeds` positions.
- `id` is stable across restarts; the plugin keys its saved layout by it.
- Unknown fields are ignored by the plugin; missing devices answer `404`.

## Colour frames (UDP)

- Port **7788**, bind `127.0.0.1` only. Port is configurable in Yunari settings; the plugin reads
  it from the descriptor field `lighting.udpPort` (default 7788).
- One datagram per frame, little-endian:

| Offset | Size | Content |
|---|---|---|
| 0 | 4 | magic `YRGB` (`0x59 0x52 0x47 0x42`) |
| 4 | 1 | version = 1 |
| 5 | 1 | device index (0 = first descriptor entry) |
| 6 | 2 | LED count, uint16 LE |
| 8 | 3×N | RGB triples, one per LED, in channel order |

- Sender caps at 30 Hz. Receiver keeps the newest frame and writes it at its own pace; datagrams
  older than the last one received for that device are dropped, never queued.
- No acknowledgement. A malformed or short datagram is dropped silently and counted.

## Controls (HTTP)

- `POST /api/devices/kraken-z/controls` with `{"pumpPercent": 0-100, "fanPercent": 0-100}`.
  Values are clamped; Yunari writes the `72 01` / `72 02` reports. Answer `204`.
- `GET /api/devices/kraken-z/telemetry` → `{"liquidTempC": 0.0, "pumpRpm": 0, "fanRpm": 0,
  "pumpPercent": 0, "fanPercent": 0}` from the `74 01` → `75 01` status report. Poll at ≤1 Hz.
- `POST /api/devices/kraken-z/lighting-mode` with `{"mode": "canvas" | "forced" | "off",
  "color": "#rrggbb"}`. `forced` writes the colour at 1 Hz; `off` writes black once; `canvas`
  resumes UDP frames. Answer `204`.

## Ownership rules

- The SignalRGB plugin never opens HID or bulk interfaces; it only speaks HTTP and UDP to loopback.
- The real Kraken device must be disabled in SignalRGB (Devices list) so the shipped
  `Nzxt_Kraken_Z3_AIO.js` never opens it. The plugin's README documents this.
- If Yunari is not running, the plugin keeps rendering but sends nothing; it must not block or
  throw from `Render`.
- If the Kraken disappears, Yunari reports it through the descriptor list; the plugin hides the
  device on the next discovery refresh.

## Verification

- Yunari: unit tests for the datagram parser, control clamping, and write serialisation; one
  hardware run showing LCD + LEDs + fan reports on the same handle.
- Plugin: self-check for the datagram builder and the LED layout; one hardware run with an effect
  driving the ring while the LCD plays a Yunari theme.
