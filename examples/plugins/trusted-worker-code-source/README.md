# Trusted-worker asset source template

A code source in the trusted-worker profile. The host forks `main.mjs`, forwards
a grid search, and asks it for the bytes of the row the author picked.

## The two exports

- **`asset.search`** takes `{query, page, source}` and answers
  `{results, totalPages}`.
- **`asset.bytes`** takes `{id, source}` and answers
  `{bytes, contentType, filename}`. `bytes` is base64.

The dotted names are JavaScript string-literal exports:

```js
export { search as "asset.search", bytes as "asset.bytes" };
```

The host resolves the handler by the method name it receives, so a plain
`export function search()` is not `asset.search`. This is the one place a
plugin's export name is a protocol name.

## What the host accepts

Every result needs `id`, `name`, `sourceUrl`, and string `preview`, `kind` and
`licence`; `subtitle` and `preset` are optional. One unreadable row refuses the
whole page, so map your provider's entries rather than passing them through.

Bytes are bounded at 32 MiB, the decoder needs padded base64, and `filename`
may not carry a path separator. Both the content type and the filename travel
as response headers.

The host prefixes every result id with `<source>:`, so `bytes` usually receives
`example-shapes:red`. Strip that prefix before looking the entry up.

## Build and install

```powershell
Compress-Archive -Path examples/plugins/trusted-worker-code-source/* -DestinationPath "$env:TEMP/example-code-source.zip" -Force
```

```sh
(cd examples/plugins/trusted-worker-code-source && zip -r /tmp/example-code-source.zip .)
```

Settings → Extensions → install, approve the `asset:provide` consent. The
source appears under Images. Searching "green" narrows it; picking a row
imports the SVG.

## Change it

- A source that fetches over the network needs `network:fetch`, a `networkHosts`
  entry and a `host` on the contribution — otherwise the consent prompt does not
  name where the search term goes.
- Code never receives a host credential. A key belongs in the plugin's own
  secret store (`secrets.get`) with the `secrets:own` capability.
- Keep the entry file at the package root; an `entry` may not escape the
  installed directory.
