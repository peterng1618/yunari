# TURZX 5" serial panel: transport, support record, controls, video overlay

- **Status:** draft
- **Date:** 2026-10-29
- **Area:** host panel subsystem, Host settings, rasteriser and player

## Intent

Yunari drives a TURZX/Turing 5" serial panel as a display, records what
hardware and firmware that support was verified against, exposes the safe
hardware controls the panel accepts, and — in a second phase — plays a theme's
video background on the panel itself while sending only the UI as an overlay.

The panel is a display the host draws, like the Lian Li and Kraken families
already merged into the panel subsystem. It has no browser and no credential;
the host owns its pixels and its hardware.

## Baseline

`peterng1618/turzx-5-inch-display-support` already contains the USB panel work
merged from `lian-li-9.2-monitor-support`:

- `PanelDevice` (geometry, open, present, close) and the `PanelHint` identity.
- `PANEL_FAMILIES` rows for the two Lian Li screens and the Kraken Z73.
- `panel-manager` with one runner per panel, `panel-runner` capture/compare/send,
  `panel-raster` (headless Chromium) and `panel-image` (ffmpeg decode).
- Display records of kind `panel`, with `PanelHardware` identity and
  `samePanel`/`normalizePanel`/`createPanel`.
- Host settings Panels section and `GET/POST /api/displays/panels`.

This design extends that subsystem; it does not replace it.

## Verified hardware facts

Probed on the attached Rev C panel at `COM5` (USB `1D6B:0106`, Windows serial
`6&E9576A&5&0000`; the reference's auto-detect uses the same gadget IDs).

### Framing

- 115200 8N1 with RTS/CTS. The panel is a USB CDC gadget, so the baud value is
  nominal; a full frame takes about 0.55–0.64 s regardless.
- **Every write is padded to a 250-byte multiple.** A 12-byte command is ignored
  unless padded. `START_DISPLAY_BITMAP` is 250 bytes of `0x2c`; every other frame
  pads with `0x00`.
- Commands are ASCII-imperative and some reply in text.

### Commands (verified)

| Purpose | Bytes |
|---|---|
| HELLO | `01 ef 69 00 00 00 01 00 00 00 c5 d3` |
| STOP_VIDEO | `79 ef 69 00 00 00 01` |
| STOP_MEDIA | `96 ef 69 00 00 00 01` |
| Brightness | `7b ef 69 00 00 00 01 00 00 00 <0–255>` |
| Screen off / on | `83 ef 69 00 00 00 01` / `83 ef 69 00 00 00 00` |
| Restart | `84 ef 69 00 00 00 01` |
| PRE_UPDATE | `86 ef 69 00 00 00 01` |
| START_DISPLAY_BITMAP | 250 × `2c` |
| DISPLAY_BITMAP_5INCH | `c8 ef 69 00 17 70` |
| DISPLAY_BITMAP_ON_VIDEO | `ca ef 69 00 17 70` |
| INIT_VIDEO_OVERLAY | `d0 ef 69 00 00 00` + one payload byte `02` |
| QUERY_STATUS | `cf ef 69 00 00 00 01` |
| UPDATE_BITMAP | `cc ef 69 00` + size(3) + `00 00 00` + count(4) + visible size(4) |
| UPLOAD_FILE | `6f ef 69 00 00 00` |
| GET_FILE_SIZE | `6e ef 69 00 00 00` |
| DELETE_FILE | `66 ef 69 00 00 00` |
| START_VIDEO | `78 ef 69 00 00 00` |

HELLO replies 23 bytes: `chs_5inch.dev1_rom1.88\0`. The model string is the
identity; the `rom` field is the firmware.

### Geometry

Native landscape **800×480, no rotation**. A rendered `F` was upright unrotated.
The overlay offset is `y * 800 + x` (the reference's formula uses the portrait
height as the row stride, which is the landscape width).

### Static frame

PRE_UPDATE, START_DISPLAY_BITMAP, DISPLAY_BITMAP_5INCH, then a full-image
payload: BGRA bytes, chunked 249 bytes and joined with `0x00`, padded to a
250 multiple. A full frame is 1,542,250 bytes on the wire.

### File and video

- Files upload in 249-byte chunks, each in its own padded 250-byte frame, after
  `UPLOAD_FILE` with a one-byte path length, three nulls, the ASCII path, and the
  file size as int32 little-endian. Verified: `create_success`, size matches,
  `START_VIDEO` replies `play_video_success`, and the clip plays and loops.
- **Command and payload belong in one frame.** Sending the upload header as a
  separate frame fails with `create_failed`.
- Preferred storage is `/mnt/SDCARD/video/…`; `/root/video/…` is the fallback.

### Video overlay

- Init: PRE_UPDATE, START_DISPLAY_BITMAP, DISPLAY_BITMAP_ON_VIDEO, a fully
  transparent full image, `INIT_VIDEO_OVERLAY` with payload `02`, then a raw
  payload `ef 69`. The panel replies
  `seq_png_init_sucessneedReSend:0|renderCnt:N`.
- **The first update after init must wait.** An update sent 8 ms after the init
  reply was dropped; 1.5 s worked. The driver waits for the reply and then a
  settle interval.
- Per-frame update payload: for each row, changed non-transparent segments
  (`offset` 3 bytes + `width` 2 bytes + 3 bytes of 4-bit BGRA each), then the
  visible segments of the current overlay. The hex string is chunked 249 bytes
  and joined with `0x00`. The trailer is `ef 69`, with the reference's alignment
  fix when the payload length is 0, 248 or 249 modulo 250.
- **The visible list replaces the visible set.** Moving a rectangle from one
  position to another cleared the old one without any explicit clear command.
  Pixels that become transparent are cleared by their absence from the list.
- Full-overlay re-sends after init do not update the display; the diff protocol
  is the only update path.
- Overlay colour is 4 bits per channel with 4 bits of alpha. UI colours are
  quantised; text antialiasing is coarse.

## Architecture

Before the first write, `docs/decisions/0133-serial-panel-and-video-overlay.md`
records the mechanism-boundary decision, the probe evidence and the rejected
alternatives (full-overlay re-send, diff without a visible list, directory
auto-discovery).

### Transport

A new host dependency, `serialport` (MIT), behind a small `SerialTransport`
seam:

```ts
interface SerialTransport {
  write(bytes: Uint8Array): Promise<void>;
  read(timeoutMs: number): Promise<Uint8Array>;
  close(): Promise<void>;
}
```

The seam exists so the TURZX adapter is unit-testable with a fake transport and
so the dependency is not imported by anything above the adapter. Adding the
dependency requires the licence entry in `THIRD-PARTY-NOTICES.md` and
`docs/engineering/dependencies.md`.

### Discovery

`1D6B:0106` is a generic Linux-gadget ID, so the USB IDs alone do not prove a
panel. Discovery lists every serial port, opens it, sends HELLO, and accepts a
reply containing `chs_`. The reply supplies model and firmware; the port
supplies the USB IDs and serial. Ports that do not answer are closed and
ignored. A port already held by another process is reported, not fatal.

### Family registry

Each driver module owns its rows; the central file only aggregates.

- `panels/tur-usb-panel.ts` exports `TUR_FAMILIES` (Lian Li rows and the TURZX
  row) with the support metadata.
- `panels/kraken-z3-panel.ts` exports `KRAKEN_FAMILIES`.
- `panels/panel-families.ts` becomes
  `[...TUR_FAMILIES, ...KRAKEN_FAMILIES]` plus `familyFor` and
  `attachedDevices`.

Adding a family is a new module and one import line; adding a model is a row in
its family's module. Directory or glob auto-discovery is rejected: static
imports are the Node and Vite bundling contract, and a loader hides what ships.

The TURZX row uses `turzx-5` as its model id, `TURZX` as maker, `Rev C` as the
hardware revision, `["1.88"]` as the supported firmware, and the date its
implementation last changed.

### Panel port

The existing `PanelDevice` port stays the contract. Two optional capabilities
are added:

```ts
interface PanelControls {
  readonly commands: readonly PanelCommand["kind"][];
  run(command: PanelCommand): Promise<string>;
}

interface PanelVideo {
  start(mp4: Uint8Array): Promise<void>;
  presentOverlay(png: Uint8Array): Promise<void>;
  stop(): Promise<void>;
}

interface PanelDevice {
  // existing members unchanged
  readonly controls?: PanelControls;
  readonly video?: PanelVideo;
}
```

Absence is the capability: a panel without controls has no Controls surface, and
a panel without video falls back to static frames. The manager and runner never
branch on a family name.

`PanelHint` gains optional `model` and `firmware`, filled from HELLO by the
TURZX adapter; other families leave both absent.

The TURZX adapter decodes the JPEG or PNG with the existing `panel-image`
helper, converts to the wire format, and owns every device quirk. Nothing above
the adapter knows about 250-byte padding, BGRA, `0x2c` or diff segments.

### Records

The persisted `panel` record stays **identity-only**:
`{ vendorId, productId, model, serial? }`. Model and firmware are read from HELLO
when the panel opens; storing them would add a writer and a value that goes
stale without notice. The record's model is still written from the family table,
never from the request body.

The support record (maker, hardware revision, supported firmware, updated date)
is code, in the family row. It is the statement of what the implementation was
verified against.

Firmware mismatch: the Panels surface shows the supported set and the detected
value; a detected value outside the set shows a warning naming the risk that the
protocol changed. Controls stay available, because brightness, screen and restart
are recoverable; firmware-update commands stay out of scope.

### Manager and runner

- `PanelManager.command(displayId, command)` resolves the running runner and
  delegates to `device.controls.run`, or throws `PanelNotRunningError`.
- `PanelRunner.tick()` gains an in-flight guard. A 1.5 MB frame takes ~0.6 s, so
  a tick that overlaps a previous send or a control command would interleave
  bytes on one interface. A control command waits for the current send; a tick
  is skipped while one is in flight.
- Runner stop closes the device. For a video panel, stop sends `STOP_VIDEO`
  first, so a removed display does not keep looping a video.
- A theme assignment change restarts the runner, so a switch between a static
  theme and a video theme re-evaluates the capture mode.

### HTTP

`GET /api/displays/panels` items gain:

- `heldId` — the display record that already holds this device, when one does.
- `support` — `{ maker, hardwareRevision, supportedFirmware, updatedAt }`.
- `firmware`, `model` — from HELLO.
- `commands` — the adapter's supported command kinds.

`POST /api/displays/:id/panel/command` takes `{ kind, level?, on? }`:

- 404 unknown display; 400 the record is not a panel.
- 409 the record is a panel but its runner is not holding the device.
- 400 an unsupported `kind`, a `level` that is not an integer in 0–100, or a
  missing `on`.
- 200 `{ ok: true, reply }`, where `reply` is the device's text (may be empty).

The host refuses invalid numeric input rather than coercing it.

## Hardware controls

Commands, all TURZX-only in this spec:

| Kind | Input | Wire |
|---|---|---|
| `brightness` | 0–100 percent | `Math.round(level / 100 * 255)`, 0–255 |
| `screen` | on/off | on `83 … 00`; off `83 … 01` |
| `restart` | none | `84 … 01`; the interface drops ~15 s |
| `status` | none | `QUERY_STATUS`; returns the status text |
| `hello` | none | `HELLO`; returns `chs_5inch.dev1_rom1.88` |

The UI speaks percent because that is the useful unit; the adapter owns the
byte mapping. Restart asks for a second confirming click, because the panel
disappears for a while.

The Controls surface is a `PanelControlsSection` below
`DisplayPresentationSection`, shown when the selected display matches an
attached panel with `commands` non-empty. It opens the existing Base UI `Dialog`
primitive: identity and firmware line with the mismatch warning, brightness
slider/number and Apply, screen on/off, restart with confirmation, query
status/identify with the raw reply, and inline errors.

## Video background (phase 2)

### Host flow

1. Resolve the display's assigned theme and its video asset from the theme
   store; validate it with the existing `video-envelope` reader.
2. Transcode to the device format with the already-shipped `ffmpeg-static`:
   H.264, 800×480, no audio, MP4. Cache by content hash so a re-open does not
   re-encode.
3. Check the device file size; upload when different; start; init the transparent
   overlay; settle ≥1.5 s before the first update.
4. On any failure, fall back to static full-frame `present(jpeg)` and report the
   failure once.

The uploaded filename carries the content hash, and the previous upload is
deleted after a successful start, so the panel does not accumulate clips.

### Capture

The rasteriser gains a transparent capture mode: PNG screenshot with a
transparent default background, plus a page flag that hides the video element.
The capture then holds only the UI, with alpha where the video shows through.

The player uses the video's first frame as the glass texture, per the design
ruling. It draws frame 0 to a canvas on `loadeddata`, so the browser player, the
editor preview and the panel overlay all show the same glass. Glass is never a
live backdrop over video.

### Update

Each tick: capture PNG → decode RGBA with `panel-image` → diff against the
previous overlay → send one `UPDATE_BITMAP` frame. The visible list replaces the
visible set, so removed elements clear without a separate command.

### Lifecycle

- Video mode is chosen only when the theme has a video background and the device
  declares `video`.
- A static theme on the same panel uses full-frame `present`.
- Runner stop sends `STOP_VIDEO`; the device returns to its stored static image.
- An unplugged panel keeps its record; the runner stops and the record shows as
  detached.

## Phasing

**Phase 1 — static panel, registry, controls.** Serial transport and discovery,
the TURZX family row, static frames, the support record and firmware mismatch,
the controls route and modal, and the in-flight guard. This phase alone makes
the panel a working Yunari display.

**Phase 2 — video background.** Upload/start, transparent overlay capture,
diff updates, glass first frame, fallback to static. It depends on Phase 1's
transport and runner.

Each phase gets its own tasks in the implementation plan; the spec is not split.

## Error handling and safety

- A panel that cannot be opened reports once and stops its runner; it does not
  spin on the interface.
- A control command that arrives while a frame is in flight waits; one that
  arrives with no runner is refused, not queued for later.
- Brightness, screen and restart are recoverable. Firmware-update commands, the
  `PRE_UPDATE` firmware sequence and raw command entry are not exposed.
- Restart is confirmed before it is sent.
- Upload failures leave the previous video playing; the fallback is static frames.
- A serial port held by another process yields a named error, not a silent
  absence.

## Verification

- **Unit:** command validation, percent-to-byte mapping, kind membership,
  `PanelNotRunningError`, and the diff encoder against golden vectors taken from
  the verified probe bytes (segments, visible list, 250 padding, trailer fix).
- **Adapter:** upload, start, init and update byte sequences against a fake
  `SerialTransport`.
- **Routes:** 200/400/404/409 mapping and reply passthrough with a fake manager;
  invalid levels refused rather than coerced.
- **Editor DOM:** the Controls section appears only for a controllable attached
  panel; brightness sends; invalid input is blocked; restart asks for
  confirmation; the firmware mismatch warning appears.
- **Browser:** an overlay capture of a video theme has transparent pixels where
  the video is and carries the UI; glass shows frame 0.
- **Hardware (manual):** a static theme displays; brightness, screen and restart
  act on the panel; a video theme plays with the UI overlay and survives a
  rectangle moving.
- The full gate runs at the phase boundary, with its exit code recorded.

## Non-goals

- Controls for the Lian Li or Kraken families; they stay unchanged in this spec.
- Firmware update, bootloader access, or raw command entry.
- Rev A/B/D protocol support and the 8" panel.
- Portrait orientation and rotation of the panel.
- Audio, video editing, or a video cropping UI.
- A live glass backdrop over video; the ruling is first frame.
- Persisting the detected firmware; it is read live.

## Risks and unverified

- A firmware newer than `1.88` may change the protocol silently; the mismatch
  warning is the only signal, and `1.88` is the only verified value.
- Overlay colour is 4-bit per channel, so UI colours and antialiased text are
  coarser than the theme. This is a device limit.
- The refresh cadence is bounded by the capture and the wire; the runner's
  one-second floor is the starting point, not a measured optimum for video.
- The panel was probed while the vendor application was closed; the vendor app
  claims the port exclusively.
- Concurrent host panels each own one interface; the runner's in-flight guard is
  per panel, not global.

## Acceptance

Phase 1 is implemented when:

- The attached panel is discovered by HELLO, listed in Host settings, and can be
  added as a display.
- A static theme's frame appears on the panel at the expected orientation.
- The support record shows maker, hardware revision, supported firmware and the
  implementation date; the detected firmware is shown, and a value outside the
  supported set warns.
- Brightness, screen on/off, restart, status and identify work from the modal.
- A control command never interleaves with a frame.
- Unit, route, adapter and editor tests pass; the full gate's exit code is
  recorded.

Phase 2 is implemented when:

- A theme with a video background plays on the panel, with the UI overlay
  updating over it.
- Moving and removing overlay elements clears their old pixels.
- Glass shows the video's first frame in the browser player, the editor and the
  panel.
- A video failure falls back to a static frame with one reported error.
- The diff encoder's golden vectors and the transparent-capture browser test
  pass.
