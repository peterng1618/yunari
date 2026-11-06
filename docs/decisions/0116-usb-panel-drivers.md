# 0116 — USB panel drivers

- **Date:** 2026-11-06
- **Status:** accepted
- **Paths:** `src/web/packages/extension-api/src/device.ts`
  `src/web/packages/extension-api/src/manifest.ts`
  `src/web/packages/host/src/extensions/runtime/device-broker.ts`
  `src/web/packages/host/src/extensions/runtime/usb-backend.ts`
  `src/web/packages/host/src/extensions/runtime/serial-backend.ts`
  `src/web/packages/host/src/panels/panel-families.ts`
  `src/web/packages/host/src/panels/plugin-panel-family.ts`
  `src/web/packages/host/src/panels/plugin-panel-device.ts`
  `src/web/packages/host/src/panels/panel-manager.ts`
  `src/web/packages/host/src/server/displays-routes.ts`
  `src/web/packages/host/src/server/panel-preview-route.ts`
  `src/web/packages/host/src/server/themes-routes.ts`

## Problem

A panel-family plugin declares vendor/product ids, geometry, commands, render
modes and transports; the host drives the glass. The quiet failure is authority:
a plugin holding its own USB/HID/serial handle owns a process-wide resource and
can wedge or write the device outside consent and revocation.

## Rung 1 — internal owner

Searched: `PanelFamily`, `PanelDevice`, `PanelHint`, `PanelControls`,
`PanelOpenOptions` (`panels/panel-device.ts`), `createPanelRunner`
(`panels/panel-runner.ts`), `PANEL_FAMILIES`/`familyFor`/`attachedDevices`
(`panels/panel-families.ts`), `panel-manager.ts`, the drivers
`tur-usb-panel.ts`, `kraken-z3-panel.ts`, `turzx-panel.ts`, `docs/hardware/`.
Found: the port, registry, runner and three built-in drivers already own
geometry, commands, cadence and transports; a new family is a driver module plus
one spread. Nothing admits a plugin family; no mediated handle API, device
consent or token exists.

## Rung 2 — installed dependencies

Searched: `packages/host/package.json`; `usb` in `tur-usb-panel.ts` and
`kraken-z3-panel.ts`; `node-hid` in `kraken-z3-panel.ts`; `serialport` in
`serial-transport.ts`.
Found: `usb` ^3.2.1, `node-hid` ^3.4.0 and `serialport` ^13.0.0 already
enumerate, claim and transfer for the built-ins. They donate transports, not
authority: each returns a handle owned by the calling process, so none supplies
consent, revocation or a serializable device reference.

## Rung 3 — native platform

Searched: Node `child_process.fork` IPC and `serialization: "advanced"`.
Found: a handle cannot cross — advanced serialization throws
`could not be cloned`, default JSON serialization degrades it to a plain object;
bytes do cross as `Uint8Array` with advanced serialization. Node has no sandbox
for a native USB stack, so host mediation is the control, not a sandbox.

## Rung 4 — public solutions

Searched from prior knowledge, no live fetch: Orca's host-mediated device API
(the runtime hosting this worktree), Chrome's `chrome.usb`/`chrome.hid`/
`chrome.serial`, and WebHID/WebUSB.
Found: Orca hands a task an opaque reference and transfers host-side. Chrome and
the web platform grant access after a user gesture, with vendor/product filters
and per-call transfers; the requester never receives a native descriptor. All
three keep handle ownership outside the requester.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Plugin imports `usb`/`node-hid`/`serialport` in its child | Full device access | Consent, revocation, containment unenforceable | Rejected |
| Serialize a handle over IPC | Plugin owns the device | Node refuses it | Rejected |
| Host broker; plugin names vpids/transport; token crosses | Handle stays in host; crash stops one runner | Token table, transfer API, consent record | Chosen |
| Built-ins only | Smallest change | Refuses the declared plugin family | Rejected |

## Rung 6 — smallest probe

Forked a temp child outside the repo with advanced serialization. The parent
held a fake backend mapping `dev-1` to one frame; the child received token
`tok-1`, requested a frame and got `Uint8Array [0xff,0xd8,0x00,0x42]`. Handing
`process.stdin` alongside the token threw `could not be cloned`; default JSON
serialization delivered the frame as a plain object. Exit `0` with
`{"tokenWasOpaque":true,"handleCrossed":false,"handleRefused":true,"bytesCrossed":true}`.

## Decision

Broker every handle in the host (`device-broker.ts` over `usb-backend.ts` and
`serial-backend.ts`); the plugin gets an opaque token and calls `usb.*`, `hid.*`
and `serial.*` transfers validated against the declared vpids or serial path.
Adapt a plugin family to the existing `PanelFamily` / `PanelDevice` /
`PanelRunner` port through `plugin-panel-family.ts` and
`plugin-panel-device.ts`, register it in `PANEL_FAMILIES`, and leave
`panel-manager.ts`, the preview and the display/theme routes reading that port.
Frame bytes travel as buffers with advanced serialization; no handle crosses, so
a driver crash or timeout stops only that display's runner. This is host
mediation, consent and revocation, not an OS sandbox.
