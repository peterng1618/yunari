# 0131 — A second panel family proved the port, and content lives on the device or on the wire

- **Date:** 2026-10-28
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/`, `src/web/packages/host/src/server.ts`

## The problem

`0130` built one panel family — Lian Li's TUR protocol — behind a `PanelDevice`
port, and claimed that "a second panel family is a row in `PANEL_MODELS` and
nothing here changes". That claim was untested: the table only ever held one
protocol, so the port had never been asked to carry anything that was not a
JPEG pushed down a bulk endpoint.

Two things were then asked of it at once:

1. Drive the **NZXT Kraken Z73** already attached to this machine, a round
   320×320 LCD that is not a Lian Li panel in any part of its protocol.
2. Say whether the product should **upload content to a device's own storage**
   instead of streaming frames, which the user believed some panels do.

Both are answered here because the second explains why the first is not a
second copy of the driver.

## Rung 1 — Yunari

Searched: `packages/host/src/panels/`, `PanelDevice`, `panelModelFor`,
`openPanel`, `attachedPanels`, `display-launcher.ts`, `normalize-video.ts`.

Found:

- **The device port itself held.** `PanelDevice`'s three members (`open`,
  `present`, `close`) were enough for a device that shares none of the Lian Li
  protocol, and `panel-runner` needed no change to drive it.
- **The registry did not.** `panel-manager.ts` imported `openPanel` and
  `panelModelFor` from `tur-usb-panel.ts` directly, and its own docblock said a
  second family is "a row in `PANEL_MODELS`". That was false: the row type
  carried one width/height pair and no way to name a different transport, so a
  second family meant editing the manager. **This is the gap the validation
  found**, and it is why `panel-families.ts` exists rather than a second import.
- **`present(jpeg)` carried an unstated assumption**: that presenting is
  pushing a frame. A storing panel makes it a flash write.
- **ffmpeg is already here**, verified by digest in `themes/ffmpeg-hash.mjs`
  and spawned by `themes/normalize-video.ts`. A storing panel needs pixels, and
  this is the decoder the host already trusts.

## Rung 2 — dependencies

Searched: the installed tree for any HID library; `node-hid`; `usb`'s own
control-transfer API.

Found: **`usb` alone is not enough, measured rather than assumed.** On this
machine:

- `claimInterface(1)` → `incompatible driver is installed`. Windows owns the
  HID interface with its class driver.
- Control transfers on interface 0 are accepted (`ok 8`) but every read after
  them throws `endpoint stalled` — the answers arrive on the HID interface's
  interrupt endpoint, not as control responses.
- With interface 0 claimed, `nativeTransferOut(1, …)` → `endpoint not found`:
  libusb will not route an interrupt transfer to an interface it does not own.
- `fs.openSync` on the `\\?\HID#…` device path fails: HIDP semantics need
  `CreateFile` flags and IOCTLs Node's `fs` cannot express.

So `node-hid` 3.4.0 (MIT of `MIT OR X11`) is a real addition, not a
convenience. It is **only** for the Kraken: the Lian Li family still uses `usb`
alone.

## Rung 3 — platform

Searched: WinUSB / `hid.dll`, HID feature reports vs output reports.

Found: `hid.dll` is a Win32 C API with no Node binding outside `node-hid`;
there is no native Node capability for HID. Feature reports were tried and do
**not** work here — the firmware ignores `sendFeatureReport` and answers only a
64-byte `write()` report. That distinction cost a probe round and is recorded
in the driver.

## Rung 4 — ecosystem

Searched: liquidctl `driver/kraken3.py` and PR #479;
`ProtozeFOSS/KrakenZPlayground` wiki; `relative23/kraken-lcd`;
`jklint/liquidmotion`; `mathoudebine/turing-smart-screen-python`;
`phstudy/turing-smart-screen-cli`; `sgtaziz/lian-li-linux`;
`deyloop/lianli_207_lcd/PROTOCOL.md`; `pcmx1/thermaltake-lcd-linux`;
`mechcow/win-206-display`; `BeiyanYunyi/lcdd`.

Found — **the answer to the user's question, per family**:

| Family | Mechanism | Content survives host exit |
|---|---|---|
| **NZXT Kraken Z** (`1e71:3008`) | **Onboard storage.** 16 buckets, ~24.3 MB, raw ARGB still or whole GIF | **Yes** — buckets persist, including through S5 |
| **Lian Li 9.2" / 8.8"** (`1cbe:a092`, `a088`) | **Streaming.** `push-jpeg` per frame, QueryBlock FIFO depth | **No** — one startup JPEG (`0x28`) is the only stored thing |
| **Turing / Turzx TUR_USB** | **Both.** 101/102 frames, 121 H.264; **38/39/40 file write + 98/110/113 play** | **Yes** — files on the device's SD card |
| **Turing serial Rev C/D** | Both — `0x6f` upload, `0x78` play, `StartMode` boots into stored media | **Yes** |

The user's instinct was right about Turzx and **wrong about Lian Li**: the
`0x65` push is the only animation path those panels have, and the opcodes a
wrong write bricks them with (`38`/`39`/`40`, file open/write/delete) are the
storage path — which is exactly why `0130` excluded them.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| `node-hid` for control + `usb` for bulk | The only working path on Windows | One native dep | Prebuilt binary trust | **Taken** |
| `usb` alone (control transfers) | Writes land, reads stall | none | Cannot read a single answer | Rejected, measured |
| Feature reports via `node-hid` | Device ignores them | none | Silent no-op | Rejected, measured |
| Shell out to liquidctl | Works on Linux; needs Python + hidapi on Windows | Large runtime | A second toolchain in a Node-only repo | Rejected |
| Upload a GIF and keep it forever | Best for a decorative loop | GIF encode, 24 MB budget | Stale data, flash wear | **Taken as the Kraken's mode**, with a 60 s floor |

## Rung 6 — probe

Measured on the attached Z73, firmware **5.11.0**, brightness 100 %,
orientation **90°**:

- `[0x10, 0x01]` → `11 01 28 00 …` → `5.11.0`
- `[0x30, 0x01]` → `31 01 …`, byte `0x18` = 100, byte `0x1a` = 1 (×90°)
- `[0x30, 0x04, n]` for n = 0…15 → `31 04 …` with start/size pairs
  `(0,400) (400,400) … (6000,400)` — 16 buckets × 400 units, matching
  liquidctl's 24 320-slot budget at 400 units per slot.
- Bulk endpoint `0x02` accepts an arbitrary 4-byte write; reads on it are
  `endpoint not found`, so the bulk path is write-only as expected.

**Not measured**: an actual upload. The panel is a working cooler on a machine
in use, and a wrong bucket setup is a documented route to firmware bootloader
(`liquidctl` #774/#907). The driver is written and typechecks; its upload path
is unverified until someone will accept that risk on purpose.

`liquidctl`'s `_send_data` is the reference for the upload order, and reading it
found three defects in the first draft, each now pinned by a test:

- **The table must be read before the delete, not after.** A deleted bucket
  reports start `0`, so reading it afterwards and using that start places every
  upload on bucket 0's range. `memoryOffset` is liquidctl's four-rule placement,
  and it takes the pre-delete snapshot.
- **The transfer header is 20 bytes, not 12**: the 12-byte magic, asset mode
  `0x02`, then the payload length as a 32-bit little-endian word. The pixel
  bytes follow it, and the length field sits at offset 16.
- **`0x33 0x02` is the delete's answer, not "the next report".** The firmware
  emits status reports (`75 01`) on its own, and a stray one was being read as a
  failed delete.

## Decision

**A family registry, and one verb that means "show this", not "stream this".**

- `panel-families.ts` owns the table: model id, ids, whether it stores, how to
  enumerate, how to open. `panel-manager` and `server.ts` read the registry and
  no longer import a driver, which is what makes the `0130` claim true.
- `PanelDevice` gains one optional member, `minimumIntervalMs`. A storing panel
  states its own floor (60 s for the Kraken) instead of the runner guessing at
  one family's flash cost; a streaming panel leaves it absent and keeps 1 s.
- `present(jpeg)` keeps its name and its bytes: the caller hands over a frame
  and does not decide whether it goes down a wire or into a bucket.
- `panel-image.ts` decodes a still to RGBA through the **already-verified**
  ffmpeg, and `kraken-z3-panel.ts` widens that to the ARGB the firmware reads.

**Not done, deliberately:** no `store(content)` verb. Only one family here
stores, and Turing's file API is a different shape (paths, chunked writes,
interruptible state) which nothing in this repo can be tested against. A verb
invented for one implementation is the abstraction the ladder forbids; add it
when a Turing-class panel is on the desk.
