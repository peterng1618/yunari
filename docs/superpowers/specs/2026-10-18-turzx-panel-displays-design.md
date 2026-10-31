# TURZX panel displays — design

- **Status:** **rough capture, 2026-10-18 — long-term roadmap only.** Not queued,
  no plan, and **not approved for one**: this needs its own brainstorm first. It
  exists so the protocol research is not lost. **Sequenced after the theme store**
  (user ruling 2026-10-18), which itself follows the per-display plan.
- **Register:** no row. Nothing here is a defect against shipped behaviour.
- **Depends on:** `2026-10-18-per-display-themes-design.md`. A panel would be a
  **third** display kind in that model, and the first display the host has to draw
  for rather than serve JSON to.

## What this is, and is not

**It is** a capture of what it would take to drive a TURZX / Turing Smart Screen
USB panel from the host: the wire protocol as the reference implementation
practises it, the constraint that decides the whole shape, and the decisions
nobody has made yet.

**It is not** a design. No interface below is settled, no task is implied, and
nothing here should be read as a commitment to build it. Where a number appears it
is either read from the reference source or arithmetic from it, and both are
labelled.

## What the device is

A USB-C panel that takes **pixels over a wire protocol**. It has no URL, no DOM,
no session token, no service worker and no `127.0.0.1`. So it is neither of the two
kinds `2026-10-18-per-display-themes-design.md` defines: not `paired` (nothing to
pair, no credential) and not `local` (nothing is resolved through loopback and no
browser is launched). It is closer to `local` in that it is attached to this PC and
needs no pairing, which is why the third kind would likely be a sibling of it.

**The reference implementation is a Python project**, `mathoudebine/turing-smart-screen-python`,
which is **GPL-3.0-or-later**. Only protocol facts are taken from it here — no code,
no vendoring. A wire protocol is not copyrightable and an independent implementation
of one is not a derivative work, but if any of that project's code were ever copied
into this repo the licence would reach the whole product, so the rule is: read it for
the protocol, write our own TypeScript, and record that in the decision note.

## The protocol, from the reference implementation

**Three families, not one.** They share a serial base but not a packet format, and
the newer and faster panels are not serial at all.

| Family | Transport | Frame format | Models (the reference's `config.yaml`) |
|---|---|---|---|
| **Rev A** | serial 115200 8N1, `rtscts=True` | RGB565 **little**-endian | Turing 3.5", UsbPCMonitor 3.5"/5" |
| **Rev B** | serial 115200 | RGB565 **big**-endian | Xuanfang 3.5", including the flagship |
| **Rev C / Rev D** | serial 115200 | RGB565 | Turing 2.1"/2.8"/5"/8.8"; Kipye Qiye 3.5" |
| **TUR_USB** | **USB bulk**, not serial | **PNG**, JPEG fallback, H264 stream | Turing HW rev 1.x: 4.6"/5.2"/8"/8.8"/9.2" |
| **WEACT_A / WEACT_B** | serial | via `library/lcd/serialize.py` | WeAct Studio FS V1 3.5" |

**Panel sizes** (`library/display.py`, keyed by the theme's `DISPLAY_SIZE`): 0.96"
80×160, 2.1" and 2.8" 480×480, 3.5" 320×480, 4.6" 320×960, 5" 480×800, 5.2"
720×1280, 8" 800×1280, 8.8" and 9.2" 480×1920, 12.3" 720×1920.

**Rev A** (`library/lcd/lcd_comm_rev_a.py`). Handshake: send six `0x45` (`'E'`),
read six bytes. `[0x01]*6` → 320×480, `[0x02]*6` → 480×800, `[0x03]*6` → 600×1024,
**anything else → 320×480**, which is the case that matters because the official
3.5" does not answer at all. Commands are ASCII-ish: `RESET` 101, `CLEAR` 102,
`SCREEN_OFF` 108, `SCREEN_ON` 109, `SET_BRIGHTNESS` 110, `SET_ORIENTATION` 121,
`SET_MIRROR` 122, `DISPLAY_PIXELS` 195, `DISPLAY_BITMAP` 197. Packets are 6 bytes
with the bounding box packed into a bitfield across the first five and the command
in the sixth. Brightness is **inverted** (0 is brightest).

**Rev B** (`library/lcd/lcd_comm_rev_b.py`). Packets are **10 bytes, framed with the
command byte at both ends**: `[cmd, 8 payload bytes, cmd]`. `HELLO` `0xCA`,
`SET_ORIENTATION` `0xCB`, `DISPLAY_BITMAP` `0xCC`, `SET_LIGHTING` `0xCD`,
`SET_BRIGHTNESS` `0xCE`. The handshake sends the payload `"HELLO"` zero-padded, reads
10 bytes back, and checks `0xCA` at both ends. **Byte 6 of the reply is `0x0A` and
byte 7 gives a sub-revision** — `A01`/`A02`/`A11`/`A12` — where `A02` and `A12` are
the flagship and `A11`/`A12` support a brightness *range* (0–100 mapped to 0–255)
while the others take brightness as effectively on/off. The bitmap header is eight
payload bytes of **big-endian 16-bit inclusive corners**, and there is a
`sleep(0.05)` between bitmaps whose own comment says it "decreases corrupted bitmap
significantly" — a device-side timing constraint, not a politeness.

**TUR_USB** (`library/lcd/lcd_comm_turing_usb.py`) is a different world: pyusb bulk
transfer, vendor `0x1cbe`, products `0x0028`/`0x0046`/`0x0050`/`0x0080`/`0x0088`/
`0x0092`/`0x0123`, endpoints discovered on interface 0. The command packet is **500
bytes padded into a 512-byte frame and encrypted DES-CBC** with the key `slv3tuzx`
and the trailing bytes `161, 26`; the reply is read as 512. Commands: 10 sync, 11
restart, 14 brightness, 15 frame rate, 17 get H264 chunk size, 38/39/40 file open/
write/delete, 98/110/113 play, 100 refresh storage, 101 upload JPEG, 102 upload PNG,
121 play H264 chunk, 122 stream status, 123 stop stream. `send_pil_image_auto`
**prefers PNG and falls back to JPEG** past a byte budget, and H264 is streamed for
the flagship.

**Pixel encoding** (`library/lcd/serialize.py`) is four functions and no more:
`image_to_RGB565(image, endianness)` — 2 bytes per pixel, no padding, byte order
chosen by the literal `"big"`/`"little"`; `image_to_BGR`; `image_to_BGRA`; and
`image_to_compressed_BGRA`, which is 3 bytes per pixel and carries the reference's
own FIXME. Plus `chunked(data, n)`. Serial revisions send in chunks of
`width * 8` bytes.

**The bitmap command carries a bounding box, and the reference uses it.** `DisplayText`,
`DisplayBar` and `DisplayGraph` each call `DisplayPILImage(image, x, y)` with their own
widget's box (`library/lcd/lcd_comm.py`), so the reference's wire cost tracks **widget
area, not screen area**. This is the single most important design fact here, and the
next section is why.

## The same protocol is Lian Li's, not only TURZX's

Searched on 2026-10-18 because the user asked what replaces L-Connect 3, and the answer
changes this document's scope. **Lian Li's newer LCDs speak the TUR_USB protocol above,
byte for byte.**

| Device | VID:PID | Transport | Protocol |
|---|---|---|---|
| UNI FAN TL LCD, 400×400 | `04FC:7393` | HID, 512-byte reports | **its own** — see below |
| Galahad II LCD, HydroShift LCD, 480×480 | `0416:7395` | HID | not read |
| HydroShift II LCD-C, 480×480 | `1CBE:A021` | bulk `0x01`/`0x81` | **TUR_USB** |
| Lancool 207 LCD | `1CBE:A065` | bulk `0x01`/`0x81` | **TUR_USB** |
| Universal Screen 8.8" 1920×480, Vision 9.2", TL/SL-INF Flex | not read | bulk (WinUSB) | **TUR_USB**, by inference — see below |

The UNI FAN TL LCD is a genuinely different protocol, and `kewe87/casehud`'s
`internal/panel/tllcd.go` documents it: 512-byte output reports at report ID `0x02` with
an 11-byte header (command, big-endian total size, packet number, payload length, ≤501
bytes of payload), JPEG frames of 400×400 under 65535 bytes chunked over several reports,
commands 60/61/62/64 plus `0x41` write-with-acks and `0x46` streaming, and **one mutex
across every fan on the chain** because interleaved transfers corrupt frames.

The TUR_USB identity is not a resemblance. **Three independent implementations agree on
all of it**: a 500-byte header, **DES-CBC with key = IV = `slv3tuzx`**, PKCS7, a 512-byte
frame, bytes 510–511 `0xA1 0x1A`, magic `0x1A 0x6D` at offset 2, a little-endian
timestamp at offset 4, and the same opcodes — `0x65`/101 JPEG, `0x66`/102 PNG, `0x79`
play. `deyloop/lianli_207_lcd`'s `PROTOCOL.md` documents it field by field;
`andyjusa/hydroshift2-rs` encodes it in Rust with the same constants; the TURZX
reference's own source reads `VENDOR_ID = 0x1cbe`. The two panels' *product* IDs differ
(`0x0028`…`0x0123` against `0xA021`), which is why this was two research tracks until
now, and the protocol is one.

**Three consequences, and the third is the one that matters.**

1. This is not a TURZX feature. The panels people actually own are Lian Li's, and they are
   in the fast family — so the DES question cannot be avoided by choosing another vendor.
2. One implementation of the fast family serves both vendors. The slow serial families are
   the ones nobody asked for.
3. **The panels worth driving are also the ones with the harder protocol** — which this
   document already said, for the wrong reason (see the DES measurement below).

## What GitHub already has, and what it does not

Asked whether anyone has built anything that replaces the native app: **yes, many, and
none of them in JavaScript.** Read on 2026-10-18:

- `sgtaziz/lian-li-linux` — Rust. The fullest replacement: fan, RGB, LCD and pump across
  HID and wireless devices, with a Tauri GUI whose frontend is Vue/TypeScript.
- `kewe87/casehud` — Go. **The closest analogue to this product**: a sensor dashboard for
  the Lian Li LCDs, with its own renderer, fonts, theme and layout (`internal/lcd/`), and
  a device table that already splits HID from WinUSB.
- `andyjusa/hydroshift2-rs` — Rust. A **library** rather than an app: a stateless packet
  encoder plus a controller, with the protocol constants exported.
- `hyperb1iss/hypercolor` — Rust, carrying
  `docs/specs/80-lian-li-tl-lcd-wireless-driver.md` and
  `84-lian-li-universal-screen-driver.md`: the same "write a driver spec before the
  driver" convention this repo uses.
- `habibrehmansg/infopanel` — C#, with a `PANELS.md` model database and a `TuringPanel`
  device layer: the nearest thing to a panel table, and the nearest thing to the TURZX
  reference's own `PRODUCT_ID` map.
- `deyloop/lianli_207_lcd` — Python, and the only one of these with a written
  `PROTOCOL.md`.
- `CihanStudio/lian-li-windows` — PowerShell, through Windows' own HID stack.
- `totmin/galahad2lcd`, `H4rk3nz0/GalahadII_LCD_Linux`, `sbulav/galahad-linux-control`,
  `suraj-lab/lianli-hydroshift-macos`, `ozgurce/LianliThemeEditor` — Go, Python and C#.

**The negative, searched rather than assumed.** `slv3tuzx` across GitHub code search
returns **zero TypeScript files and zero JavaScript files**; the only TS/JS repositories
matching "Lian Li" are LED-only SignalRGB plugins and an Electron RGB app. So there is
**no JS/TS implementation of this protocol to depend on**, and the packet layer is ours
to write.

**And none of them renders this product's scene.** Every project above brings its own
scene model — `casehud`'s renderer draws *its* themes — so the reusable half is the packet
layer, which is the small half, and the renderer, which is the large half, has no prior
art to borrow in any language.

## The constraint that decides everything: wire time

115200 8N1 carries **11,520 bytes/s**. RGB565 is 2 bytes per pixel. So a **full frame**
costs:

| Panel | Bytes | Wire time |
|---|---|---|
| 3.5" 320×480 | 307,200 | **≈27 s** |
| 2.8" 480×480 | 460,800 | ≈40 s |
| 5" 480×800 | 768,000 | ≈67 s |
| 8.8" 480×1920 | 1,843,200 | ≈160 s |

And a region costs its own area — on a 3.5": a 120×20 text row ≈0.42 s, a 300×20 bar
≈1.0 s, a **300×120 chart ≈6.3 s**.

**This is arithmetic from the baud rate and the pixel count, not a measurement**, and
no panel is attached to the machine this was written on. But if it is even roughly
right, it settles the shape:

- On the serial families a **full repaint is minutes**, so the initial draw is a
  visible event and a theme switch is a long one.
- A chart is the expensive widget, at seconds per redraw. **The useful knob is not a
  frame rate** — it is *which region, how often*. That is a different model from
  every display this product has today, where a browser repaints whatever it likes for
  free.
- The TUR_USB family escapes the constraint entirely, because a PNG of a dashboard is
  tens of kilobytes over bulk transfer. **The larger, newer panels are the ones worth
  targeting, and they are also the ones with the harder protocol** (below).

## Why the host cannot do this today

**The host has never drawn a pixel.** `server.ts`'s `tick()` samples the union of the
active displays' semantic keys once, serialises one batch, and offers it to every
connection — the browser does all rendering. The host's entire dependency list is
`@yunari/renderer-core`, `@yunari/theme-package` and `systeminformation`. There is no
canvas, no image encoder, no serial and no USB anywhere in the workspace: a scan of
every `package.json` under `packages/` for a canvas, image, serial, USB or HID
dependency returns nothing.

So there are two real blockers, and one of them is measured rather than reasoned.

**1. A renderer in the host, able to draw a *region*.** This is the whole job, and it is
a subsystem rather than a task. The guardrails forbid the obvious shortcut — "Fabric
JSON is the persisted scene. No second simplified scene tree or write-back model" — so a
bespoke panel drawing routine is out. The candidates are headless Fabric in Node
(`fabric/node` plus a canvas implementation, reusing the real scene renderer) or a
headless browser screenshotting the player page. Both have consequences worth naming
early: `scene-fabric`'s background media is a **DOM `<video>` sibling** and glass
samples that layer through `backdrop()`, so **video backgrounds and frosted glass would
simply not exist on a panel** — which is coherent, and should be stated rather than
discovered.

**2. The fast family needs DES-CBC, and this Node cannot do it.** Measured on this
machine — Node 24.13.0, OpenSSL 3.5.4:

```
crypto.createCipheriv('des-cbc', Buffer.from('slv3tuzx'), Buffer.alloc(8))
  → ERR_OSSL_EVP_UNSUPPORTED
```

DES moved to OpenSSL 3's legacy provider, so the TUR_USB header cannot be built with
`node:crypto` by default. **But it is one startup flag, not a cryptography project**, and
that is measured rather than reasoned:

```
node --openssl-legacy-provider -e '<des-cbc, key and IV slv3tuzx, 500 zero bytes>'
  → OK, encrypted bytes: 504
```

504 is exactly the `ENCRYPTED_SIZE` constant both independent implementations carry, which
is the cross-check that this is the right primitive and not merely a cipher that runs. So
the ways out are: launch the host with the flag (or have `bin/yunari.js` re-exec itself
with it), take a pure-JS DES (`@li0ard/des`, `node-forge` — both MIT), or not support the
family. **The earlier reading of this paragraph — "the fast family is the awkward one" —
is refuted by that measurement**, and it was doing load-bearing work: it was offered as
the honest reason this is long-term. The honest reason is blocker 1 alone, the missing
renderer, which no flag fixes.

**3. Transports are a new shipped dependency either way** — `serialport` or `usb`, both
MIT — which means a licence check, `THIRD-PARTY-NOTICES.md` and
`docs/engineering/dependencies.md`, and a native build.

## What it would take, roughly

Ordered by cost, and stated as shape rather than as tasks:

1. **Decide which family is worth supporting at all.** Supporting Rev A and Rev B
   (serial, RGB565, two packet formats, two endiannesses, a sub-revision handshake) is
   a different project from supporting TUR_USB (bulk, PNG, DES). Doing all of them is
   likely three times the work of doing the one anyone actually owns — and the search
   above answers which that is: **the fast family, because it is Lian Li's.**
2. **A headless renderer that can render a region**, which is the same renderer a
   panel needs for its initial draw, and which nothing in the product has today.
3. **A dirty-region scheduler.** The host already knows which semantic keys a theme
   binds and when a reading changes, so the *information* for "which widget needs
   redrawing" exists — but nothing turns that into a box, and a wrong box is a stale
   or torn region on a wall. This is a mechanism boundary in the reuse gate's sense:
   expensive and invisible when wrong.
4. **The transport and the packet layer**, per family, with the device's own timing
   rules (the 50 ms cooldown, the serial reopen-on-error, the 10 open attempts).
5. **A third display kind in the per-display model** — `kind: "panel"`, with a panel
   hint (port, or VID/PID and serial) where a paired display has a `tokenHash` and a
   local monitor has a `MonitorHint`. No pairing, no credential, no `chartFps` default
   that means anything.

**One integration hazard worth recording now:** the reference says Rev C **cannot
reliably auto-detect its own size** and configures it from the theme instead. That is
the same shape as the per-display spec's "the monitor a display points at is a hint" —
geometry is not identity, and a panel's declared size must be treated as a hint that
can be wrong rather than as a fact.

## Open questions

1. **Which panels, and how many?** Everything downstream depends on this, including
   whether the DES problem has to be solved at all.
2. **Does a panel get a theme of its own, or the same theme rendered smaller?** A
   320×480 panel and a 1440p monitor cannot show the same composition legibly, so
   either the model gains a per-kind artboard or the panel is a second-class citizen.
3. **What is the refresh model when a region costs seconds?** "Which region, how
   often" is not `chartFps`, and pretending it is would be the mistake this capture
   exists to prevent.
4. **Is a full-screen initial draw acceptable at ~27 s?** If not, the panel needs a
   splash, or a cached frame, or the whole feature is for the fast family only.
5. **What happens to glass and video on a panel?** Recommended: refused rather than
   silently dropped, on the same reasoning as the assignment warning.
6. **Does the host render once and share, or once per display?** A panel and a browser
   showing one theme is one scene and two very different rasterisations.

## Not verified, and must be before this is planned

- **Every timing figure above is arithmetic**, not a measurement. No panel is attached
  to the machine this was written on, and nothing has been driven against one.
- **The protocol facts are read from the reference implementation's source**, and only
  from it. `lcd_comm.py`, `lcd_comm_rev_a.py`, `lcd_comm_rev_b.py`,
  `lcd_comm_turing_usb.py`, `serialize.py`, `display.py` and `config.yaml` were read;
  **Rev C, Rev D and the two WEACT revisions were only sampled**, so their packet
  formats are not described here and must not be assumed from Rev A/B.
- **That the DES key and header layout are current.** They were read from a GPL project
  that reverse-engineered a vendor protocol; the vendor can change it, and nothing here
  was confirmed against hardware or a firmware version.
- **That a panel's declared size can be trusted.** The reference's own workaround says
  otherwise for at least one revision.
- **The Lian Li rows, at the strength each was read.** The HydroShift II constants are read
  from `andyjusa/hydroshift2-rs`'s `src/protocol.rs`; the Lancool 207 field table from
  `deyloop/lianli_207_lcd`'s `PROTOCOL.md`; the UNI FAN TL LCD packet format from
  `kewe87/casehud`'s `internal/panel/tllcd.go`, which is itself ported from
  `sgtaziz/lian-li-linux`. **The Universal Screen 8.8", Vision 9.2" and the Flex LCDs are
  inferred** — `casehud` groups them with the HydroShift II as WinUSB and has not
  implemented them — so their protocol is *not* read and must not be assumed. `0416:7395`
  is read from `totmin/galahad2lcd`'s shipped config, not from a protocol document.
- **That `--openssl-legacy-provider` is acceptable to ship.** It was measured to work on
  Node 24.13.0 / OpenSSL 3.5.4 in this shell. Whether the host's own launch path can carry
  the flag — `bin/yunari.js`, any packaged form, and whether a future Node drops it — was
  not investigated.
- **That no JS/TS implementation exists.** That is a GitHub code search for the literal key
  `slv3tuzx` with `--language typescript` and `--language javascript`, both empty, plus a
  repository search. A project that implements the protocol without ever writing the key as
  a literal — reading it from a device, or obfuscating it — would not appear.

## The reuse gate: the ecosystem rungs are now run

**Partly discharged on 2026-10-18.** The earlier session could not search — web search was
unavailable and it said so rather than guessing — so rungs 4 and 5 were undischarged. The
GitHub search above is that pass, and it returns a clean negative on the rung that
mattered: **no JavaScript or TypeScript implementation of this protocol exists**, so the
packet layer is ours to write, and the transport dependency plus its licence check is the
remaining cost rather than a cipher to own.

**What that does not discharge is rung 5's harder half** — whether anyone has solved
"render a Yunari theme into a region of a panel". Nobody has, in any language: the
projects above all render their own scene model, and `casehud` is the closest and is still
Go with its own themes. The mechanism boundary this design named — a dirty-region
scheduler where a wrong box is a stale region on a wall — has no prior art to borrow.

**Still not run:** rungs 1–3 and 6–7 as a recorded pass, and any probe against hardware.
No panel is attached to this machine and nothing has been driven against one.

**The licence note stands, and matters less than it looked.** The reference is
GPL-3.0-or-later, so its *code* is unusable here; but the search found no JS/TS
implementation to consider either way, so no library licence is now deciding anything. What
a future one would decide is whether a transport implementation can be used at all rather
than merely whether it should be.
