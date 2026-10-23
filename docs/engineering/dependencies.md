# Dependency provenance

Provenance behind `THIRD-PARTY-NOTICES.md`. Re-audit the installed graph before release.

Scope, stated in `THIRD-PARTY-NOTICES.md`: the packages a workspace
`package.json` declares directly, never the installed closure, `@yunari/`
workspace packages excluded. The **Declared dependencies** table below lists
what the manifests declare — nothing reached only transitively is in it, and not
every declared package is listed — while the **Vendored source** table is
outside that scope, recording source copied into the tree that no manifest
declares. The closure half is this file's own **Release rule** below.

## Declared dependencies

| Package | Version/pin | Licence | Role |
|---|---|---|---|
| `echarts` | 6.1.0 | Apache-2.0 | charts |
| `culori` | 4.0.2 | MIT | colour parsing, conversion and hex formatting; no dependencies of its own |
| `@types/culori` | 4.0.1 | MIT | devDependency: types for culori 4, which ships none |
| `fabric` | 7.4.0 | MIT | scene graph |
| `lucide-react` | 1.48.0 | ISC, plus MIT for Feather-derived icons used | editor action-bar icons |
| `lineicons` | 1.3.2 | MIT | devDependency: the finder's Lineicons results, read by `scripts/generate-lineicons.mjs` into a generated manifest; no runtime import |
| `fflate` | 0.8.3 | MIT | theme ZIP codec |
| `ffmpeg-static` | 5.3.0 | GPL-3.0-or-later | host: re-encodes theme video; source offered at <https://github.com/eugeneware/ffmpeg-static> |
| `@biomejs/biome` | 2.5.14 | MIT OR Apache-2.0 | format/lint |
| `vite` | 8.3.0 | MIT | build/dev |
| `typescript` | 7.0.2 | Apache-2.0 | build |
| `vitest` | 5.0.0 | MIT | tests |
| `@playwright/test` | 1.63.0 | Apache-2.0 | browser tests |
| `jsdom` | 26.1.0 | MIT | DOM tests |
| `canvas` | 3.2.3 | MIT | native raster test dependency |
| `@types/node` | 22.10.2 | MIT | types |
| `@types/node-forge` | 1.3.11 | MIT | types for `node-forge` |
| `node-forge` | 1.4.0 | BSD-3-Clause (of `BSD-3-Clause OR GPL-2.0`) | host: issues the local CA and leaf a display's secure origin needs |
| `qr` | 0.7.2 | MIT OR Apache-2.0 | QR symbol for the display link |
| `jsqr` | 1.4.0 | Apache-2.0 | devDependency: decodes the QR round-trip |
| `@google/design.md` | 0.4.0 | Apache-2.0 | devDependency: lints `DESIGN.md` in the design gate |
| `@playwright/mcp` | 0.0.83 | Apache-2.0 | devDependency: Playwright MCP server used as an agent tool |
| `class-variance-authority` | 0.7.1 | Apache-2.0 | editor component variants |
| `clsx` | 2.1.1 | MIT | editor class-name joins |
| `tailwind-merge` | 3.7.0 | MIT | editor class-name overrides |
| `react-dom` | 19.3.0 | MIT | editor shell chrome |
| `@base-ui/react` | 1.8.0 | MIT | editor shell primitives |
| `tailwindcss` | 4.3.3 | MIT | editor dev styling |
| `@tailwindcss/vite` | 4.3.3 | MIT | editor dev |
| `@types/react` | 19.3.0 | MIT | types |
| `@types/react-dom` | 19.3.0 | MIT | types |
| `better-auth` | 1.7.12 | MIT | store worker: OAuth sign-in and session storage |
| `aws4fetch` | 1.0.20 | MIT | store worker: SigV4 signing for R2 presigned uploads |
| `@cloudflare/vitest-pool-workers` | 0.23.0 | MIT | devDependency: runs the Worker suite inside workerd |
| `@cloudflare/workers-types` | 5.20261022.1 | MIT OR Apache-2.0 | devDependency: Worker runtime types |
| `wrangler` | 4.152.0 | MIT OR Apache-2.0 | devDependency: Worker dev and deploy CLI |
| `vitest` (nested, `packages/store-worker`) | 4.1.12 | MIT | devDependency: the pool peers on `^4.1.0`; the workspace runs 5.0.0 |
| `tsx` | 4.23.15 | MIT | devDependency: runs `src/web/scripts/*.mjs` that import workspace TypeScript packages |

`node-forge` 1.4.0 was added on 2026-10-18 with `docs/decisions/0070`. Its
licence is dual, `(BSD-3-Clause OR GPL-2.0)`, verified from the installed
package's `package.json`; **BSD-3-Clause is the one taken**, which is permissive
and carries no source obligation. It has no dependencies of its own, which is
most of why it was chosen over the alternatives the note compares.

It carries one advisory, recorded here because a dependency list is where a
reader looks for it: [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv),
high, CWE-347, RSA PKCS#1 v1.5 signature **verification** accepting extra nested
`DigestAlgorithm` elements. The affected range is `<= 1.4.0` and no patched
version is published. The host uses `node-forge` to *generate and sign*
certificates and never calls its verifier — every certificate it issues is
verified with `node:crypto`'s `X509Certificate.verify()` and then by the browser
that has to accept the chain. `docs/decisions/0070` records the reasoning and
the alternatives it was weighed against.

`@google/design.md` 0.4.0 is Apache-2.0. Its installed `package.json` carries no
`license` field (and the registry publishes none), so the licence was verified
from the package's own `LICENSE` file, which is the Apache License, Version 2.0
text. It ships a CLI (`bin.design.md` → `dist/index.js`) used by
`scripts/design-md.mjs --lint`; `npm run design:check` runs it.

Fabric 7.4.0 metadata/LICENSE confirms MIT and no runtime dependencies. Use
`fabric/es`; player and editor both use it directly, with no adopted
image-editor package or its transitive graph.

`lucide-react` 1.48.0 is the editor's only icon source: verified from its
installed `package.json` (`license: ISC`) and its `LICENSE` file on 2026-09-25.
It has no runtime dependencies, only a `react` peer that the editor already
satisfies. Icons are imported by name so tree-shaking keeps only those the
registry uses; `packages/editor/src/object-actions.ts` is the authority on which
compiled-in icons exist and therefore on the package's licence scope. Four of
its current icons are Feather-derived and MIT rather than ISC alone. Full
licence text in `THIRD-PARTY-NOTICES.md`.

## Vendored source

| Source | Pin | Licence | Role |
|---|---|---|---|
| `@anu3ev/fabric-image-editor` | 0.10.32, commit `9efdd78a34` | MIT | adapted movement-snapping and indicator source |

Copied, not installed: no entry appears in `package.json` and nothing enters the
transitive graph. Licence verified from the `LICENSE` blob at that commit,
`MIT, Copyright (c) 2025 Alexander Anufriev`. Full text in
`THIRD-PARTY-NOTICES.md`. The note above about the removed image-editor package
refers to the runtime dependency, which stays removed.

LibreHardwareMonitor/PawnIO are not current dependencies or redistributed.
Earlier planning research found LHM MPL-2.0 and PawnIO modules under GPL/LGPL;
re-open the analysis before bundling, downloading or installing them.

### LibreHardwareMonitor packaging review — 2026-09-24

Assessed against the `v0.9.6` release archive
(`LibreHardwareMonitor.zip`, 6.6 MB, 43 files) and the repository's own
`LICENSE` and `THIRD-PARTY-NOTICES.txt`. Scope: redistributing LHM inside a
Yunari release so it ships as the default extended-sensor source.

Findings:

- **LHM itself is MPL-2.0.** File-level copyleft: redistribution is permitted,
  including in a larger work, provided LHM's own source stays MPL and its
  notices travel with it. Yunari links nothing and modifies nothing.
- **The archive ships no licence or notice file at all**, while bundling
  third-party binaries whose licences require notices: `Aga.Controls.dll`
  (BSD), `HidSharp`, `OxyPlot`, `RAMSPDToolkit-NDD` and the .NET support
  assemblies. Shipping the archive as-is would omit notices those licences
  require, so **Yunari must add LHM's `LICENSE` and `THIRD-PARTY-NOTICES.txt`
  plus the per-dependency notices** to its own distribution.
- **No PawnIO driver binary is in the archive** (no `.sys`; the `PawnIo`
  module is fetched separately at runtime and is LGPL-2.1). Bundling the
  archive therefore does not itself redistribute PawnIO, but a first-run
  download of the PawnIO module would, and that path needs its own review
  before being enabled.
- LHM runs with a GUI and enables its web server through an in-app menu, not a
  command-line switch, so shipping it as the *default* source means Yunari
  launching a desktop application on the user's machine.

Conclusion: redistribution is **permissible with notices added**, and is not
blocked by licence. **Decided by:** user, 2026-09-24 — bundling approved, so
Yunari releases ship LHM with its notices. The third-party notices are listed
in `THIRD-PARTY-NOTICES.md`, and the vendor script stages LHM's `LICENSE` and
`THIRD-PARTY-NOTICES.txt` because the release archive omits them. Release
packaging must include those files. A PawnIO module download (LGPL-2.1,
fetched by LHM at runtime) remains separately unreviewed and must not be
enabled without its own assessment.

`systeminformation` 5.33.13 (MIT, no dependencies of its own) is the host's
hardware-metrics source: verified from the package's own `LICENSE` and `npm
view` metadata on 2026-09-24. It reads platform counters; it is not a vendored
or linked third-party executable.

## Bundled assets

Not packages, and not vendored source: third-party **content** the product
redistributes. Licence, provenance and the full notice live in
`THIRD-PARTY-NOTICES.md`; this table is the index.

| Asset | Where | Licence | Provenance |
|---|---|---|---|
| Starter backdrop, “city skyline during orange sunset” by Ashim D’Silva | `packages/editor/src/starter-backdrop.jpg`, declared by the starter document as `assets/starter-backdrop.jpg` and served same-origin by the host | Unsplash License (<https://unsplash.com/license>) | photo page <https://unsplash.com/photos/city-skyline-during-orange-sunset-NTTJsPPlQOk>, retrieved 2026-09-28, sha256 `6d4bbd98…5bf59b` |

It is bundled rather than fetched for two reasons that are load-bearing, not
cosmetic. A remote URL taints the canvas, and every pixel-reading path —
`toDataURL` for the thumbnail, `getImageData` for the glass budget and the
e2e probes — throws on a tainted one, so a CDN backdrop would silently break
thumbnails and make the glass unmeasurable. And a local-first product whose
default theme needs a CDN to look right is a defect on an offline display.

**Re-verify before any re-crop or re-encode.** The `sha256` in the theme's
asset declaration is checked against the file by
`new-fabric-theme.test.ts`; changing the bytes without updating the declaration
fails that test rather than shipping a claim that is no longer true.

## Release rule

Before publishing: enumerate the runtime/transitive graph from the lockfile,
verify licences from primary metadata, ship required notices, and separately
review any external executable/driver distribution.
