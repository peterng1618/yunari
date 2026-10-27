# 0130 — A panel is driven through a device port, and the scene is rasterised by the real player

- **Date:** 2026-10-28
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/`, `src/web/packages/host/src/server.ts`

## The problem

The host has never drawn a pixel. Every display today is a browser the host
**serves**; a USB panel is a device the host **drives**, with no URL, no session
and nothing to admit. Driving it needs three things the product does not have:
a wire protocol, a rasteriser, and a scheduler that decides *when* a frame is
worth its wire time.

The architectural request is the harder half: renderer and device transport
must be decoupled so another panel is a new device, not a fork of this one.

## Rung 1 — Yunari

Searched: `packages/` for `usb|serial|hid|canvas`, `scene-fabric`, `renderer-core/scene`,
`servE/display-launcher.ts`, `settings/displays.ts`.

Found:

- **The display record already has room for it.** `settings/displays.ts` carries
  `kind: "paired" | "local"` and `monitor?: MonitorHint`. A panel is a third
  kind with a hardware hint where a local monitor has a `MonitorHint`.
- **`serve/display-launcher.ts` already owns browser discovery and argv**
  (`findBrowser`, `browserCommand`). A rasteriser needs the same browser, the
  same profile discipline and the same "never a guessed path" rule.
- **`renderer-core/scene/plan.ts` is already pure** — authored state plus
  telemetry becomes a `ScenePlan` with no DOM and no Fabric. A panel reuses it
  unchanged, which is the whole reason the renderer half is not a rewrite.
- **`scene-fabric` is browser-only by construction.** `scene.ts` needs
  `getComputedStyle`, `document.createElement`, `window.devicePixelRatio`;
  `glass.ts` and `background-media.ts` are DOM layers by design.

## Rung 2 — dependencies

Searched: `package-lock.json`, `packages/*/package.json`, manifest of each
candidate.

Found:

- `canvas` 3.2.3 (MIT) is **already installed** as an optional peer of
  `fabric`/`jsdom`, and probes render a JPEG headlessly.
- `usb` 3.2.1 (MIT) is new. It is the only addition. `node-hid` is not usable
  here: this device binds **WinUSB**, not HID, and exposes bulk endpoints.
- `serialport` is not applicable: the 9.2" panel is bulk, not serial.

## Rung 3 — platform

Searched: the device itself, `node:crypto`, Node's built-in `WebSocket`, the
installed Chrome.

Found, all measured on this machine:

- `usb.getDevices()` → `1cbe:a092`, product `9.2"LCD-2026041401`, one interface,
  vendor class FF/00/00, **bulk IN `0x81` and bulk OUT `0x01`, 512-byte packets**.
- `node:crypto` `des-cbc` → `ERR_OSSL_EVP_UNSUPPORTED`. `node-forge` → 504-byte
  ciphertext, which is the size three drivers independently carry.
- A live `getVersion` (opcode 10) **answered** `lianli92_0001_2026041401`.
- A 1920×462 JPEG push (opcode 101) was accepted; the panel acks with a
  512-byte frame whose byte 8 is its buffer level.
- **Chrome 156 drives the pipeline with no dependency and no package**: a
  464×1920 `Page.captureScreenshot` costs ~45 ms and 8 KB.
- `fabric/es` cannot run in Node (`n.hasAttribute is not a function`);
  `fabric/node` can, but ECharts SSR then needs a DOM anyway.

## Rung 4 — ecosystem

Searched: GitHub for the protocol, for JavaScript implementations, and for
theme editors. Read `sgtaziz/lian-li-linux`, `habibrehmansg/infopanel` PR #154,
`andyjusa/hydroshift2-rs`, `deyloop/lianli_207_lcd`, `ozgurce/LianliThemeEditor`,
`kewe87/casehud`, `subscreen.dev`'s D92 page.

Found:

- **No JavaScript or TypeScript implementation exists.** The packet layer is
  ours; that was also this repo's earlier finding.
- **Three independent drivers agree on the frame**: 500-byte command,
  DES-CBC, key = IV = `slv3tuzx`, PKCS7, 512-byte frame, trailer `a1 1a`,
  magic `1a 6d` at offset 2, LE timestamp at offset 4.
- **Two hardware-tested drivers give the 9.2" as 464×1920 portrait**
  (`lian-li-linux` marks it tested; infopanel's merged PR carries the same
  numbers). Lian Li's own page says 1920×462 — that is the mounted strip, and
  the wire is its portrait rotation.
- **Nobody renders a Yunari scene.** Every project brings its own renderer and
  its own theme model, so rung 5's hard half has no prior art: the reusable
  half is the small half.
- `ozgurce/LianliThemeEditor` edits L-Connect `.template` files by driving
  L-Connect itself — the user's other lead. It is a theme **editor**, not a
  renderer, and its format is L-Connect's, so it informs nothing about driving
  the panel from our own scene.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| **Headless Chrome on the real player page** | reuses `scene-fabric`, glass, ECharts, video, fonts **as shipped** | one child process; ~45 ms/frame | a browser must exist; a crash is a dead panel | **taken** |
| `fabric/node` + ECharts SSR in the host | no child process | a second mount path; ECharts SSR needs a DOM anyway (measured) | a second renderer that drifts from the player | rejected |
| `fabric/node` + `scene-fabric` ported | one process | `scene.ts`, `glass.ts`, `background-media.ts` are DOM by design — the port *is* the project | permanent fork of the renderer | rejected |
| Drive L-Connect's own `.template` format | the vendor's own pipeline | L-Connect must run, which owns the device | our scene cannot reach it at all | rejected |

**The decision follows from what the product is.** The player renders a theme
correctly today, including the pieces hardest to reimplement — glass sampling a
video backdrop, ECharts charts, packaged fonts. Rasterising that page is
reuse; reimplementing it in Node is the rabbit hole this gate exists to catch.

## What this costs, stated rather than discovered

- **A browser is a runtime requirement** for a panel, exactly as it already is
  for a local monitor. `findBrowser` answers `undefined` on a machine with none,
  and the panel then reports why rather than showing nothing.
- **The screenshot is a browser raster, not a Fabric raster.** It is the same
  pixels the browser shows, which is the point.
- **Glass needs a backdrop to sample.** In a headless browser the media layer
  is a real DOM `<video>`, so glass works — but a paused headless video is a
  frozen backdrop. That is the same static-first-frame behaviour
  `2026-10-18-display-capabilities-design.md` already specifies for panels.

## The boundary this creates

`PanelDevice` is the port: **`geometry`, `open`, `present(jpeg)`, `close`**.
Everything a panel-specific protocol needs lives behind it, and everything a
scene needs lives above it, so a second panel family is a second implementation
of four methods plus its own model row. The host's panel manager knows only the
port.

## Not verified

- **That a frame pushed this way reaches the glass.** A push was accepted and
  acked; the panel was not observed (L-Connect was stopped for the probe, and
  the display was driven headless).
- **That 464×1920 is the wire orientation.** Two drivers agree; the vendor page
  disagrees; nothing here rotated one frame against the other and looked.
- **That the panel tolerates a sustained frame rate.** One frame was sent, not a
  stream, so `QueryBlock` flow control is read from drivers rather than measured.
