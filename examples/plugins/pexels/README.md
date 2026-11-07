# Pexels image source

A trusted-worker plugin that adds Pexels to the asset finder's Images tab.
It demonstrates the whole executable-source path: a code contribution, host
API secrets, host-mediated network search, and asset bytes.

## Build the package

The install route takes a zip with `yunari-plugin.json` at its root.

```powershell
# Windows
Compress-Archive -Path examples/plugins/pexels/* -DestinationPath "$env:TEMP/pexels.zip" -Force
```

```sh
# POSIX
(cd examples/plugins/pexels && zip -r /tmp/pexels.zip .)
```

## Install and enable

1. Settings → Extensions → install `pexels.zip`.
2. Approve the consent prompt. It names the hosts `api.pexels.com` and
   `images.pexels.com`, the `asset:provide`, `network:fetch`, `secrets:own` and
   `settings:own` capabilities, and the `pexels` source.
3. Get a free key at <https://www.pexels.com/api/>.
4. Settings → Extensions → Pexels → paste the key → Save. The key goes to the
   plugin's encrypted secret store and is never returned to the browser.
5. Open the asset finder, choose Images, and pick the Pexels source. An empty
   search shows Pexels' curated feed.

Set the key before the first search: the worker reports a missing key as a
failed page.

## What it talks to

- `api.pexels.com` receives the search term and the key.
- `images.pexels.com` serves the photo bytes, which arrive through the host's
  `network.fetchBytes` under the same declared-host policy as the search.

Pexels allows 200 requests an hour and 20,000 a month. Photos are used under
the [Pexels license](https://www.pexels.com/license/); the finder records the
photo page as the asset's source.
