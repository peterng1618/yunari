# Sandboxed UI plugin template

A plugin's own HTML draws its asset body and its settings page. Nothing in the
frame reaches the host directly: the frame is `sandbox="allow-scripts"` with an
opaque origin, and its only channel is the `postMessage` protocol in
`packages/extension-api/src/frame.ts`.

## What it contributes

- **`assetSources[0].body`** names the frame body instead of `"grid"`. The
  finder opens `ui` (`assets.html`) in the frame, and the page asks for
  `asset.search` and `asset.bytes`.
- **`settingsPages[0].ui`** names a second frame (`settings.html`). It reads the
  plugin's settings through `settings.get`.

Both frames must import nothing: the host serves them with
`default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self'
'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'`. A remote image
URL therefore does not render in a frame, and `fetch` is blocked. Ask the editor
for data; do not reach the network yourself.

## The protocol

1. The frame posts `{type:"yunari.frame.event", event:"ready"}`.
2. The editor answers `yunari.frame.init` with the nonce, the plugin key, the
   settings and the theme.
3. The frame posts `yunari.frame.request` with `{nonce, id, method, params}`.
4. The editor answers `yunari.frame.result` with `{id, ok, value}` or
   `{id, ok:false, reason}`.

A frame body may call `asset.search` (`{query, page}` → `{results, totalPages}`)
and `asset.bytes` (`{id}`). `asset.bytes` is the import action: the editor
fetches the bytes through the host route and places them, so the frame receives
no bytes and never sees the host's own asset pipeline.

A settings frame may call `settings.get`, `settings.set` and `ui.resize`.
`settings.set` is a write and needs a gesture token the editor mints from a
host control; the editor does not mint one for settings pages yet, so this
template reads settings and does not write them.

## Build and install

```powershell
Compress-Archive -Path examples/plugins/sandboxed-ui/* -DestinationPath "$env:TEMP/example-sandboxed-ui.zip" -Force
```

```sh
(cd examples/plugins/sandboxed-ui && zip -r /tmp/example-sandboxed-ui.zip .)
```

Settings → Extensions → install the zip, approve the `ui:frame` consent. The
source appears under Images with its own body; the settings page appears under
Settings → Extensions.

## Change it

- Keep every request method inside the table in `frame.ts`. An unknown method
  is dropped, and the editor answers nothing.
- Read the nonce from `init` before the first request. A request with a wrong
  nonce is never answered.
- Do not invent a write. A write method without a gesture token is dropped by
  `readPluginFrameMessage` before it reaches the host.
