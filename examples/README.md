# Yunari extension examples

Runnable templates for every extension kind this host ships. Each one is
installed by hand, and `npm test` validates each one against the same reader the
host uses, so an example cannot drift from the format it demonstrates.

| Example | Kind | Install as |
| --- | --- | --- |
| `plugins/declarative` | Plugin, `declarative` profile | zip |
| `plugins/sandboxed-ui` | Plugin, `sandboxed-ui` profile | zip |
| `plugins/pexels` | Plugin, `trusted-worker`, code asset source | zip |
| `plugins/trusted-worker-code-source` | Plugin, `trusted-worker`, code asset source | zip |
| `plugins/trusted-worker-sensor` | Plugin, `trusted-worker`, sensor provider | zip |
| `plugins/trusted-worker-panel` | Plugin, `trusted-worker`, panel family | zip |
| `packs/dashboard-theme` | Dashboard theme package | zip |
| `packs/editor-theme` | Editor theme package | zip |
| `packs/widget-pack` | Widget pack | zip |
| `packs/path-preset-pack` | Path preset pack | the `.json` file |

## Install

Every plugin and theme package is a zip with its manifest (`yunari-plugin.json`
or `manifest.json`) at the zip's root — not inside a folder. Settings →
Extensions installs plugins and packs; Settings → Theme library installs a
dashboard theme, and the editor's theme picker installs an editor theme.

```powershell
Compress-Archive -Path examples/plugins/declarative/* -DestinationPath "$env:TEMP/declarative.zip" -Force
```

```sh
(cd examples/plugins/declarative && zip -r /tmp/declarative.zip .)
```

A path preset pack is not zipped: Settings → Path presets installs
`examples/packs/path-preset-pack/pack.json` directly.

## Write your own

- A plugin's `execution` profile is the most its contributions need: no code is
  `declarative`, an HTML frame is `sandboxed-ui`, and anything with a `main` is
  `trusted-worker`. `validateManifestExecution` refuses a lower one.
- A contribution's capability must be declared, and a consent screen names every
  host and device the manifest claims.
- The trusted worker's handler names are the host's method names. A dotted one
  is a string-literal export:
  `export { search as "asset.search" }`.
- Declarative sources and theme packages are data the host reads; a bug there is
  a validation error naming the field, not a crash.
