# Trusted-worker panel family template

A family claims a pair of USB ids, states its geometry, and drives the device
through the host's broker. The ids here are placeholders; the shape is what a
real driver fills in.

## What the host calls

- **`panel.attached`** → `[{vendorId, productId, serial, label}]`, the panels of
  this family attached now.
- **`panel.open`** with `{width, height, renderMode}` → `{frameIntervalMs,
  stillFormat}`, or nothing. The worker opens the device itself with `usb.open`
  and keeps the token.
- **`panel.present`** with `{format, bytes}` — one raster frame.
- **`panel.command`** with `{command}` — one of the kinds the manifest lists.
- **`panel.close`** — release the device.

The dotted names are string-literal exports:

```js
export { open as "panel.open", present as "panel.present" };
```

## The device handle

`usb.open` returns a token. The handle never reaches the worker, so every
transfer names the token instead. The selector must match the consent row the
manifest produced: same transport, vendor id, product id, and the same
`interfaceNumber` when the family declares one.

Consent is per device (`usb:1234:5678#0`), so opening a different interface is a
different grant and the broker refuses it.

## Build and install

```powershell
Compress-Archive -Path examples/plugins/trusted-worker-panel/* -DestinationPath "$env:TEMP/example-panel.zip" -Force
```

```sh
(cd examples/plugins/trusted-worker-panel && zip -r /tmp/example-panel.zip .)
```

Settings → Extensions → install, approve `panel:drive` and `usb:device`. The
family appears in the panel picker. Because the ids are placeholders, no display
is attached and opening the family reports that.

## Change it

- Replace `vendorId`/`productId` in both the manifest and `main.mjs`; they are
  two copies of one fact and the broker compares them.
- Implement `present` with the device's own framing. A panel that decodes JPEG
  can take the frame as-is; one that wants raw pixels converts in the worker.
- Do not hold the interface while another program needs it. On Windows, a panel
  vendor's own app is the usual conflict.
- Read `docs/hardware/` before claiming a firmware version: `support` is a
  record of what was measured, not a wish.
