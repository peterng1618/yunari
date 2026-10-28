# Third-party notices

Yunari is MIT licensed; see [LICENSE](LICENSE). This is the current development
inventory, not a release-grade transitive audit. Provenance:
[`docs/engineering/dependencies.md`](docs/engineering/dependencies.md).

**Scope: direct dependencies only — the packages a workspace `package.json`
declares in `dependencies`, `devDependencies` or `optionalDependencies`,
`@yunari/` workspace packages excluded — never the installed closure.
`peerDependencies` are not an inventory: a peer states a requirement on a
package this project does not itself install or ship, so it is not a direct
dependency.** A package reached only through another
package's own dependencies has no entry here, and its absence is not a missing
notice; the closure is enumerated at release time, by the release rule in
[`docs/engineering/dependencies.md`](docs/engineering/dependencies.md). Every
direct dependency is a row in one of the two tables below, with the version the
lockfile resolves and the licence its installed `package.json` declares — or,
where that manifest declares none, the licence named by its `LICENSE` title;
`npm run third-party:check` (`scripts/check-third-party.mjs`) compares every
row against both and names each drift. A platform-optional package is installed
only on the platform it serves: its row and lockfile version are required
everywhere, its licence is compared where it is installed, and the check says
in its output when it could not read one here. The prose sections that follow
are provenance, not notice rows.

## Runtime/editor

| Package | Version | Licence | Use |
|---|---|---|---|
| `echarts` | 6.1.0 | Apache-2.0 | charts |
| `fabric` | 7.4.0 | MIT | scene graph |
| `fflate` | 0.8.3 | MIT | theme ZIP packages |
| `ffmpeg-static` | 5.3.0 | GPL-3.0-or-later | host: re-encodes theme video; source offered at <https://github.com/eugeneware/ffmpeg-static> |
| `react` | 19.3.1 | MIT | editor shell chrome |
| `react-dom` | 19.3.1 | MIT | editor shell chrome |
| `@base-ui/react` | 1.9.0 | MIT | editor shell primitives |
| `lucide-react` | 1.61.0 | ISC | editor action-bar icons; four Feather-derived icons are also MIT, see Runtime icons |
| `lineicons` | 1.3.2 | MIT | development-only: generates the asset finder's Lineicons manifest; no runtime import |
| `systeminformation` | 5.33.16 | MIT | host hardware metrics (no dependencies of its own) |
| `node-forge` | 1.4.0 | BSD-3-Clause OR GPL-2.0 | host: encodes and signs the local CA and leaf that give a display a secure origin; BSD-3-Clause is the one taken (no dependencies of its own) |
| `undici` | 7.30.1 | MIT | host: pins the DNS address checked by a custom source's policy to the connection that fetches it (decision 0116) |
| `usb` | 3.2.1 | MIT | host: opens the bulk endpoint a USB panel is driven over (decision 0130). Native module with per-platform prebuilt binaries and no runtime dependencies |
| `node-hid` | 3.4.0 | MIT OR X11 | host: writes the 64-byte control reports a Kraken Z's LCD takes (decision 0131); MIT is the one taken. The Lian Li panels use `usb` alone; this one is only for the HID interface Windows owns, which libusb cannot claim. Native module, prebuilt per platform |
| `qr` | 0.7.2 | MIT OR Apache-2.0 | QR symbol for the display link (no dependencies of its own) |
| `class-variance-authority` | 0.7.1 | Apache-2.0 | editor component variants |
| `clsx` | 2.1.1 | MIT | editor class-name joins |
| `tailwind-merge` | 3.7.0 | MIT | editor class-name overrides |
| `better-auth` | 1.7.12 | MIT | store worker: OAuth sign-in, sessions and its own `user`/`session`/`account` tables |
| `culori` | 4.0.2 | MIT | colour parsing and conversion (no dependencies of its own) |

Preserve applicable Apache-2.0 and MIT licence/NOTICE obligations.

### LibreHardwareMonitor (bundled external program)

A Yunari release ships LibreHardwareMonitor v0.9.6 (MPL-2.0) as an external
program, staged by `npm run vendor:lhm -w @yunari/host`. Yunari links nothing
and compiles nothing: it runs the executable and reads the JSON its web server
publishes. It is not a dependency and its source is not vendored.

MPL-2.0 permits redistribution in a larger work provided LHM's own source stays
under MPL and its notices travel with it. **The release archive omits every
licence file**, so the vendor script adds LHM's `LICENSE` and
`THIRD-PARTY-NOTICES.txt` beside the binaries; the latter carries the required
notices for the third-party binaries the archive bundles:

| Bundled binary | Notice |
|---|---|
| Aga.Controls.dll | BSD (Andrey Gliznetsov) |
| HidSharp.dll, OxyPlot.dll, OxyPlot.WindowsForms.dll, RAMSPDToolkit-NDD.dll | per LHM's `THIRD-PARTY-NOTICES.txt` |
| Microsoft.* / System.* support assemblies | Microsoft .NET, MIT |

Release packaging must include `vendor/lhm/LICENSE` and
`vendor/lhm/THIRD-PARTY-NOTICES.txt` (and so the notices above) in the shipped
distribution. PawnIO is **not** in the archive — LHM fetches it at runtime and
it is LGPL-2.1 — so a first-run PawnIO download needs its own review before
being enabled. Provenance and the pinned digest:
`docs/engineering/dependencies.md`; `vendor/lhm/PROVENANCE.txt` records the
version, source URL and sha256 of the staged release.

### PresentMon (bundled external program)

A Yunari release ships PresentMon v2.6.0 (**MIT**, Copyright (C) 2017-2024
Intel Corporation) as an external program, staged by
`npm run vendor:presentmon -w @yunari/host`. Yunari links nothing and compiles
nothing: it runs the console executable with `--output_stdout --no_csv` and
reads the CSV it writes. It is not a dependency and its source is not vendored.

MIT requires the copyright and permission notice to travel with the binary, so
the vendor script stages PresentMon's own `LICENSE.txt` beside it. Release
packaging must include `vendor/presentmon/LICENSE.txt` in the shipped
distribution. Provenance and the pinned digest:
`docs/engineering/dependencies.md`; `vendor/presentmon/PROVENANCE.txt` records
the version, source URL and sha256 of the staged release.

### systray2 / systray-portable (bundled Linux external program)

A Yunari release ships the Linux tray binary from `systray2` **2.1.4** (**MIT**,
Copyright (c) 2017 Zack Young) as an external program, staged by
`npm run vendor:tray -w @yunari/host`. Yunari does not import the `systray2`
package, links nothing and compiles nothing: it runs `tray_linux_release` over a
JSON-line protocol. It is not a dependency.

Only the Linux **x86-64** binary is staged; Linux arm64 is unsupported and needs
its own binary and provenance. The binary is staged into
`packages/host/vendor/tray` and is not committed — `vendor/` is ignored; the
staging script writes `PROVENANCE.txt` beside the binary, and release packaging
ships it. MIT requires the copyright and
permission notice to travel with the binary, so the vendor script stages
`systray2`'s own `LICENSE` beside it; release packaging must include
`vendor/tray/LICENSE` and `vendor/tray/tray_linux_release` in the shipped
distribution. Source:
<https://registry.npmjs.org/systray2/-/systray2-2.1.4.tgz>, pinned sha256
`24a176933952c4db79026dcec25c7acf48e5c1cee5d94bc6b87740060bc8ed00`.
Provenance: `docs/engineering/dependencies.md`.

## Build/test

Declared development dependencies, plus a second row where a workspace installs
its own nested copy of a name already listed above.

| Package | Version | Licence | Use |
|---|---|---|---|
| `@biomejs/biome` | 2.5.14 | MIT OR Apache-2.0 | format/lint |
| `@cloudflare/vitest-pool-workers` | 0.23.0 | MIT | Workers test pool |
| `@cloudflare/workers-types` | 5.20261022.1 | MIT OR Apache-2.0 | Worker runtime types |
| `@google/design.md` | 0.4.0 | Apache-2.0 | lints `DESIGN.md` in the design gate |
| `@playwright/mcp` | 0.0.83 | Apache-2.0 | the Playwright MCP server used as an agent tool |
| `@playwright/test` | 1.63.0 | Apache-2.0 | browser tests |
| `@tailwindcss/oxide-linux-x64-gnu` | 4.3.3 | MIT | editor dev: Tailwind's native binding for the Linux CI runner (optional; installed there only) |
| `@tailwindcss/oxide-win32-x64-msvc` | 4.3.3 | MIT | editor dev: Tailwind's native binding for Windows (optional; installed there only) |
| `@tailwindcss/vite` | 4.3.3 | MIT | editor dev |
| `@types/culori` | 4.0.1 | MIT | types for culori 4, which ships none |
| `@types/node` | 22.20.5 | MIT | types |
| `@types/node-forge` | 1.3.11 | MIT | types for `node-forge` |
| `@types/react` | 19.3.0 | MIT | types |
| `@types/react-dom` | 19.3.0 | MIT | types |
| `canvas` | 3.2.3 | MIT | native raster test dependency; may carry linked-library obligations |
| `jsdom` | 26.1.0 | MIT | DOM tests |
| `jsqr` | 1.4.0 | Apache-2.0 | decodes the QR round-trip |
| `tailwindcss` | 4.3.3 | MIT | editor dev styling |
| `tsx` | 4.23.15 | MIT | runs scripts that import workspace TypeScript |
| `typescript` | 7.0.2 | Apache-2.0 | build |
| `vite` | 8.3.5 | MIT | build/dev |
| `vitest` | 5.0.5 | MIT | tests |
| `vitest` | 4.1.12 | MIT | nested under `packages/store-worker` — the pool peers on `^4.1.0` while the workspace runs 5.0.5 |
| `wrangler` | 4.152.0 | MIT OR Apache-2.0 | Worker build/deploy |

Four entries were added on 2026-10-13 — `class-variance-authority`, `clsx` and
`tailwind-merge` to the runtime/editor table and `@playwright/mcp` to this
section. CI's `licences` job derives every non-`@yunari/` name from the
workspace manifests and fails on one absent from this file, and these four had
been declared without an entry. Their licences were read from each installed
package's own `package.json` (`.license`), which is also why they sit in two
sections: the three the editor declares in `dependencies` ship with it, and
`@playwright/mcp` is a `devDependency`.

## Vendored source

### Meteocons (weather icons)

`packages/host/vendor/weather-icons/` holds 23 SVGs from
`@meteocons/svg-static` 0.1.0, `fill` style, staged by
`npm run vendor:weather-icons -w @yunari/host`. The script pins
<https://registry.npmjs.org/@meteocons/svg-static/-/svg-static-0.1.0.tgz> by
its sha512 integrity and extracts only the slugs the provider's allow-list
names; the committed bytes are what the host serves at
`/api/weather/icon/<slug>.svg`.

Licence: MIT, Copyright (c) 2020-present Bas Milius. The complete MIT text
travels with the bytes as `packages/host/vendor/weather-icons/LICENSE`.
Source and artwork: <https://github.com/basmilius/meteocons>; attribution
"Meteocons by Bas Milius".

`packages/editor/src/snap-manager/` and `packages/editor/src/indicator-manager/`
contain adapted copies of `@anu3ev/fabric-image-editor` 0.10.32, taken from
commit `9efdd78a342a29f169a8dbf1da78c95bbf1ffe77`. It is not a dependency; the
source was adapted in place. Its licence follows in full, as MIT requires for
substantial portions.

MIT License

Copyright (c) 2025 Alexander Anufriev

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### Source marks

`packages/editor/src/asset-finder/source-mark.tsx` carries the Lucide, Font
Awesome and Unsplash marks' path data from Simple Icons (CC0 1.0,
<https://github.com/simple-icons/simple-icons>). CC0 asks for no attribution;
this entry records provenance. The marks are their owners' trademarks, used only
to label which source each result came from.

## Runtime icons

`lucide-react` 1.61.0 supplies the editor's action-bar icons, imported per-icon
by name so the bundler keeps only the ones the registry uses. Its per-icon
geometry is also where the default theme's card icons come from: the starter reads the same
modules and converts them to canvas path data at author time, so no second icon set
ships and the player bundle is unchanged. **Four of the
icons currently imported are derived from the Feather project and carry MIT as
well as the package's ISC grant**: `ArrowDown`, `ArrowUp`, `Lock` and `Trash2`
(`trash-2` in the package's own list). The remainder of the package's icons are
covered by ISC alone — see `lucide-react`'s `LICENSE` for the authoritative
Feather-derived list.

ISC and MIT both require their copyright and permission notice to travel with
copies of the covered work, so both follow in full.

ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

The MIT License (MIT) — for the Feather-derived icons named above

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Assets and planned integrations

Imported assets retain their own licence requirements; record source/hash/licence
metadata.

### Starter backdrop (bundled asset)

`packages/editor/src/starter-backdrop.jpg` ships **inside** the product, as the
default theme's artboard backdrop. It is a packaged theme asset, declared by
path in the starter document and served same-origin by the host, so it is
redistributed with every starter theme a user saves.

| Field | Value |
|---|---|
| Work | “city skyline during orange sunset” |
| Photographer | Ashim D’Silva (`@randomlies`) — <https://unsplash.com/@randomlies> |
| Source page | <https://unsplash.com/photos/city-skyline-during-orange-sunset-NTTJsPPlQOk> |
| Licence | **Unsplash License** — <https://unsplash.com/license> |
| Retrieved | 2026-09-28 |
| Shipped bytes | 2330 × 1311 JPEG, q75, centre-cropped to the artboard's 1.7768 aspect; 438 590 bytes |
| sha256 | `6d4bbd987c0e6a6103eb310b2848e011e50a77be641e3e2cdd1b389d695bf59b` |

Verified 2026-09-28 from the **primary source**, not from memory. The photo
page carries the notice *"Free to use under the Unsplash License"*, links that
licence, names the photographer, and embeds the exact CDN identifier the bytes
were fetched under (`images.unsplash.com/photo-1587642314856-a00a0e4aee60`), which
is what establishes that the downloaded file and the page are the same work.
Unsplash's own Terms, §5 "License to Images", state the grant as an
*"irrevocable, nonexclusive, worldwide copyright license to download, copy,
modify, distribute, perform, and use images from Unsplash for free, including
for commercial purposes, without permission from or attributing the photographer
or Unsplash"*, excluding only the right to compile images to replicate a
similar or competing service. Attribution is not required and is given anyway.

The Terms also exclude **trademarks, logos or brands**, **recognisable people**
and **works of art or authorship** appearing in an image. The shipped crop was
inspected: a distant city skyline in silhouette at sunset, with no legible
brand mark and no person. It is redistributed unmodified apart from resize and
crop, both of which the licence permits expressly.

The licence text itself is not reproduced here because it is not a
copyleft-style licence with a notice requirement; the link above is the
authoritative text and the URL is recorded in the theme package's own asset
declaration, so it travels with the file.

The approved curated-font slice will copy pairing metadata from
[Fonttrio](https://github.com/kapishdima/fonttrio) as data, not a runtime
dependency. Fonttrio is MIT licensed; preserve its attribution when shipping
derived pairing data.

LibreHardwareMonitor and PawnIO are planned integrations, not current
dependencies. Re-review their licences if Yunari starts shipping them.

## Release rule

Before publishing, audit the complete runtime/transitive graph and ship every
required licence/NOTICE text. Verify new dependencies from primary/package
metadata when adding them. This is the closure half of the scope stated at the
top of this file: the runtime/editor table and the build/test paragraph are the
direct-dependency inventory, while the vendored-source, runtime-icon and
bundled-asset sections are not dependencies and fall outside it. The transitive
graph is enumerated at release by this rule and by the release rule in
[`docs/engineering/dependencies.md`](docs/engineering/dependencies.md).
