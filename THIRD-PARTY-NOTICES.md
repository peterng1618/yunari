# Third-party notices

Yunari is MIT licensed; see [LICENSE](LICENSE). This is the current development
inventory, not a release-grade transitive audit. Provenance:
[`docs/engineering/dependencies.md`](docs/engineering/dependencies.md).

**Scope: direct dependencies only — the packages a workspace `package.json`
declares in `dependencies` or `devDependencies`, `@yunari/` workspace packages
excluded — never the installed closure.** A package reached only through another
package's own dependencies has no entry here, and its absence is not a missing
notice; the closure is enumerated at release time, by the release rule in
[`docs/engineering/dependencies.md`](docs/engineering/dependencies.md). **The
form varies by section, not by package**: a table for the runtime/editor
dependencies and a paragraph for the build/test ones, so an entry is a row only
where its section is one.

## Runtime/editor

| Dependency | Licence | Use |
|---|---|---|
| Apache ECharts 6.1.0 | Apache-2.0 | charts |
| Fabric.js 7.4.0 | MIT | scene graph |
| fflate 0.8.3 | MIT | theme ZIP packages |
| ffmpeg-static 5.3.0 | GPL-3.0-or-later | host: re-encodes theme video; source offered at <https://github.com/eugeneware/ffmpeg-static> |
| react 19.3.0 | MIT | editor shell chrome |
| react-dom 19.3.0 | MIT | editor shell chrome |
| @base-ui/react 1.8.0 | MIT | editor shell primitives |
| lucide-react 1.48.0 | ISC AND MIT (Feather-derived subset) | editor action-bar icons |
| Lineicons 1.3.2 | MIT | development-only: generates the asset finder's Lineicons manifest; no runtime import |
| systeminformation 5.33.13 | MIT | host hardware metrics (no dependencies of its own) |
| node-forge 1.4.0 | BSD-3-Clause (of `BSD-3-Clause OR GPL-2.0`) | host: encodes and signs the local CA and leaf that give a display a secure origin (no dependencies of its own) |
| qr 0.7.2 | MIT OR Apache-2.0 | QR symbol for the display link (no dependencies of its own) |
| class-variance-authority 0.7.1 | Apache-2.0 | editor component variants |
| clsx 2.1.1 | MIT | editor class-name joins |
| tailwind-merge 3.7.0 | MIT | editor class-name overrides |
| better-auth 1.7.12 | MIT | store worker: OAuth sign-in, sessions and its own `user`/`session`/`account` tables |
| aws4fetch 1.0.20 | MIT | store worker: SigV4-signs R2 presigned upload URLs |
| culori 4.0.2 | MIT | colour parsing and conversion (no dependencies of its own) |

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

## Build/test

Declared development dependencies: @biomejs/biome 2.5.14 (MIT OR Apache-2.0),
TypeScript 7.0.2 (Apache-2.0), Vite 8.3.0 (MIT), Vitest 5.0.0 (MIT),
@playwright/test 1.63.0 (Apache-2.0), jsdom 26.1.0 (MIT), canvas 3.2.3 (MIT),
@types/node 22.10.2 (MIT), @types/node-forge 1.3.11 (MIT), @types/react 19.3.x (MIT), @types/react-dom
19.3.x (MIT), tailwindcss 4.3.3 (MIT, editor dev styling), @tailwindcss/vite
4.3.3 (MIT, editor dev), jsqr 1.4.0 (Apache-2.0), @google/design.md 0.4.0
(Apache-2.0, lints `DESIGN.md` in the design gate), @playwright/mcp 0.0.83
(Apache-2.0, the Playwright MCP server used as an agent tool), @cloudflare/vitest-pool-workers 0.23.0 (MIT, Workers test pool), @cloudflare/workers-types 5.20261022.1 (MIT OR Apache-2.0, Worker runtime types), wrangler 4.152.0 (MIT OR Apache-2.0, Worker build/deploy), tsx 4.23.15 (MIT,
runs scripts that import workspace TypeScript), and a nested vitest 4.1.12 (MIT) under `packages/store-worker` — the pool peers on `^4.1.0` while the workspace runs 5.0.0. Native `canvas`
may carry linked-library obligations.

Four entries were added on 2026-10-13 — `class-variance-authority`, `clsx` and
`tailwind-merge` to the runtime/editor table and `@playwright/mcp` to this
section. CI's `licences` job derives every non-`@yunari/` name from the
workspace manifests and fails on one absent from this file, and these four had
been declared without an entry. Their licences were read from each installed
package's own `package.json` (`.license`), which is also why they sit in two
sections: the three the editor declares in `dependencies` ship with it, and
`@playwright/mcp` is a `devDependency`.

## Vendored source

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

## Runtime icons

`lucide-react` 1.48.0 supplies the editor's action-bar icons, imported per-icon
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
