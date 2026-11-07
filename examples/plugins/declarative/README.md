# Declarative plugin template

No code runs. The host reads the descriptors and draws them. This template
contributes all four declarative points; delete the ones you do not need.

- **`assetCategories`** adds a finder tab. `body` must be `"grid"`; the label
  and glyph are the manifest's.
- **`assetSources`** is one grid source: `request.url` may carry `{query}` and
  `{page}`, `result.*` are JSON pointers, and `totalPath` is the page count.
  This one reads the public Rick and Morty API.
- **`customSources`** is a telemetry row: a URL, a poll interval and JSON
  pointers. This one reports a GitHub repository's stars and forks. A plugin
  custom source may not use a host credential, so leave `auth` out.
- **`settingsPages`** with `fields` is a form the host draws and validates.

## Build and install

```powershell
Compress-Archive -Path examples/plugins/declarative/* -DestinationPath "$env:TEMP/example-declarative.zip" -Force
```

```sh
(cd examples/plugins/declarative && zip -r /tmp/example-declarative.zip .)
```

Settings → Extensions → install the zip. A declarative plugin needs no consent
grant and runs no worker. The Characters tab appears in the asset finder, the
repository readings join the sensor list, and the form appears under
Settings → Extensions.

## Change it

- New category: change `assetCategories[0].id` and point a source's `category`
  at it. A built-in category id (`image`, `font`, `colour`, `gradient`,
  `icon`, `local`) belongs to the host and cannot be redefined.
- New source: keep `request`/`result` pointers; the host refuses a non-HTTPS
  URL, a URL carrying user information, or a pointer that does not resolve to
  the field's type.
