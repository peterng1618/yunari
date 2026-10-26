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
| `lucide-react` | 1.61.0 | ISC, plus MIT for Feather-derived icons used | editor action-bar icons |
| `lineicons` | 1.3.2 | MIT | devDependency: the finder's Lineicons results, read by `scripts/generate-lineicons.mjs` into a generated manifest; no runtime import |
| `fflate` | 0.8.3 | MIT | theme ZIP codec |
| `ffmpeg-static` | 5.3.0 | GPL-3.0-or-later | host: re-encodes theme video; source offered at <https://github.com/eugeneware/ffmpeg-static> |
| `@biomejs/biome` | 2.5.14 | MIT OR Apache-2.0 | format/lint |
| `vite` | 8.3.5 | MIT | build/dev |
| `typescript` | 7.0.2 | Apache-2.0 | build |
| `vitest` | 5.0.5 | MIT | tests |
| `@playwright/test` | 1.63.0 | Apache-2.0 | browser tests |
| `jsdom` | 26.1.0 | MIT | DOM tests |
| `canvas` | 3.2.3 | MIT | native raster test dependency |
| `@types/node` | 22.20.5 | MIT | types |
| `@types/node-forge` | 1.3.11 | MIT | types for `node-forge` |
| `node-forge` | 1.4.0 | BSD-3-Clause (of `BSD-3-Clause OR GPL-2.0`) | host: issues the local CA and leaf a display's secure origin needs |
| `undici` | 7.30.1 | MIT | host: pins the address a custom source's policy checked to the connection that fetches it; already present transitively, now declared directly |
| `qr` | 0.7.2 | MIT OR Apache-2.0 | QR symbol for the display link |
| `jsqr` | 1.4.0 | Apache-2.0 | devDependency: decodes the QR round-trip |
| `@google/design.md` | 0.4.0 | Apache-2.0 | devDependency: lints `DESIGN.md` in the design gate |
| `@playwright/mcp` | 0.0.83 | Apache-2.0 | devDependency: Playwright MCP server used as an agent tool |
| `class-variance-authority` | 0.7.1 | Apache-2.0 | editor component variants |
| `clsx` | 2.1.1 | MIT | editor class-name joins |
| `tailwind-merge` | 3.7.0 | MIT | editor class-name overrides |
| `react-dom` | 19.3.1 | MIT | editor shell chrome |
| `@base-ui/react` | 1.9.0 | MIT | editor shell primitives |
| `tailwindcss` | 4.3.3 | MIT | editor dev styling |
| `@tailwindcss/vite` | 4.3.3 | MIT | editor dev |
| `@types/react` | 19.3.0 | MIT | types |
| `@types/react-dom` | 19.3.0 | MIT | types |
| `better-auth` | 1.7.12 | MIT | store worker: OAuth sign-in and session storage |
| `@cloudflare/vitest-pool-workers` | 0.23.0 | MIT | devDependency: runs the Worker suite inside workerd |
| `@cloudflare/workers-types` | 5.20261022.1 | MIT OR Apache-2.0 | devDependency: Worker runtime types |
| `wrangler` | 4.152.0 | MIT OR Apache-2.0 | devDependency: Worker dev and deploy CLI |
| `vitest` (nested, `packages/store-worker`) | 4.1.12 | MIT | devDependency: the pool peers on `^4.1.0`; the workspace runs 5.0.5 |
| `tsx` | 4.23.15 | MIT | devDependency: runs `src/web/scripts/*.mjs` that import workspace TypeScript packages |

`ffmpeg-static` 5.3.0 downloads its platform binary in a postinstall script, so
npm's tarball integrity covers only the package's JavaScript.
`ffmpeg-static-hashes.json` records the SHA-256 of the decompressed binary for
`darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64` and `win32-x64`, and
both `node scripts/verify-ffmpeg.mjs` (in the gate as `npm run ffmpeg:check`)
and the host's spawn gate refuse bytes the file does not describe. Each digest
was computed from the downloaded `b6.1.1` release asset and agrees with that
release's published asset `digest`; `win32-arm64` is absent because upstream
publishes no asset for it and the package's own platform table does not list
it, so that pair is refused rather than skipped. Updating the package is a
visible edit to this file (decision 0122).

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

`lucide-react` 1.61.0 is the editor's only icon source: verified from its
installed `package.json` (`license: ISC`) and its `LICENSE` file on 2026-10-26.
It has no runtime dependencies, only a `react` peer that the editor already
satisfies. Icons are imported by name so tree-shaking keeps only those the
registry uses; `packages/editor/src/object-actions.ts` is the authority on which
compiled-in icons exist and therefore on the package's licence scope. Four of
its current icons are Feather-derived and MIT rather than ISC alone. Full
licence text in `THIRD-PARTY-NOTICES.md`.

## Audit overrides

Measured 2026-10-26 on the tree carrying the `undici`/`sharp`/`zod` overrides
(plan 2026-10-25 performance-and-security hardening, task 8.3). `npm install`
exits 0; `npm run test:worker` exits 0 with 13 files / 130 tests; `npx vitest
run` exits 0 with 419 files / 6317 passed and 1 skipped. Outcome: `npm audit
--json` reports 3 high findings, every one allowlisted; `npm audit --omit=dev
--json` reports `node-forge` alone.

| Override | Resolved | Proving suite |
|---|---|---|
| `undici` `^7.30.1` | 7.30.1 | `npm run test:worker` — 13 files, 130 tests, exit 0 |
| `sharp` `^0.35.5` | 0.35.5 | `npm run test:worker` — 13 files, 130 tests, exit 0 |
| `zod` `^4.6.6` | 4.6.7 | `npx vitest run` — 419 files, 6317 tests, exit 0 |

`zod`'s lift has one scoped exception, `"@google/design.md": { "zod": "^3.25.0" }`:
that dev-only linter declares `zod` `^3.24.0` and cannot take v4. Without the
lift the store-worker's production `zod` stayed at 4.4.3, below the patched
4.6.6 (GHSA-mrhx-c7xc-m3w5).

The lockfile holds exactly one `undici` 7.30.1, one `sharp` 0.35.5, one root
`zod` 3.25.76 (design.md's) and one store-worker `zod` 4.6.7. The `miniflare`
requesters keep their upstream pins in the lock's dependency records:
`node_modules/miniflare` asks `undici` 7.29.1 and `sharp` 0.35.5,
`packages/store-worker/node_modules/miniflare` asks `undici` 7.29.0 and `sharp`
0.35.2, and `@cloudflare/vitest-pool-workers` asks `zod` 4.4.3 exactly. npm
11.6.2 compares the resolved version against those recorded pins, not against
the override, so `npm ls` marks the resolved `undici`, `sharp` and `zod`
`invalid`.

`npm ls --all` is **not required to exit 0 and does not**. What CI enforces
(`ci.yml`, "The dependency tree resolves") is exactly two things: there is no
`npm error missing:` line, and `ELSPROBLEMS` is the only npm error code. It
cannot tell an override from a genuine mismatch — a wrong version installed
against a manifest prints `invalid:` with `ELSPROBLEMS` and passes — so the
class table below is a human account of the six lines on a lockfile-matching
tree, not something the step checks.

Measured after `npm ci`, so `node_modules` matches the lockfile: 3 `invalid`,
3 `extraneous`, no `missing:`. A tree that has been reinstalled or pruned
differently can report extra lines; reinstall with `npm ci` before comparing.
The six lines fall into two classes:

- **override against the requester's pin** — an override is by definition a
  version outside that range, so npm reports it `invalid`;
- **platform-optional install** — a platform-gated optional parent is skipped,
  but its child carries no `os`/`cpu` gate and is installed anyway.

| Line | Class | Cause |
|---|---|---|
| `invalid undici@7.30.1` | override | `miniflare` asks 7.29.0/7.29.1 |
| `invalid sharp@0.35.5` | override | the store-worker's `miniflare` asks 0.35.2 |
| `invalid zod@4.6.7` | override | `@cloudflare/vitest-pool-workers` asks 4.4.3 exactly |
| `extraneous @img/sharp-wasm32@0.35.5` | platform-optional | sharp's optional parents `@img/sharp-freebsd-wasm32` (`os: [freebsd]`) and `@img/sharp-webcontainers-wasm32` (`cpu: [wasm32]`) are skipped here, but their dependency carries no `os`/`cpu` gate |
| `extraneous @emnapi/runtime@1.11.3` | platform-optional | dependency of the package above |
| `extraneous tslib@2.8.1` | platform-optional | dependency of `@emnapi/runtime` |

The override class is explained by the requesters keeping their upstream pins;
the suites in the table above are the proof the resolved versions run. For the
platform-optional class, `npm prune` followed by `npm install` does not remove
the three packages, and removing the `sharp` override would reintroduce the
highs on 0.35.2. The sharp packages are a devDependency lattice, so nothing in
the shipped host loads them.

Before task 8.3 the tree had the one line this invariant forbids:
`@emnapi/runtime` was `missing` under the installed `@img/sharp-wasm32`. The
fresh resolution supplied it; no `missing:` line remains.

Forward risk: a later dependency change can restore a nested pinned copy —
`npm dedupe` did exactly that — so the resolved copies are not an invariant to
rely on. B3's audit policy is the backstop that fails on the return of these
advisories.

A `jsdom` `^30.1.3` override was tried and removed: it changed
`CSSStyleDeclaration` serialisation and DOM-removal semantics, failing 8 editor
DOM cases. With jsdom 26.1.0 restored the suite is green, and
`whatwg-encoding@3.1.1` stays.

npm 11.6.2 applies overrides only during a fresh resolution. Reproduce the lock
with `rm -rf node_modules packages/*/node_modules package-lock.json && npm
install`, then reconcile with `npm install`. A resolution regenerated while a
`node_modules` tree is present records only that host's platform packages and
drops the others, so the removal is not optional. The 2026-10-26 resolution
moved `playwright` to a different depth with the same version set and took the
direct dependencies `react`/`react-dom` 19.3.1, `@base-ui/react` 1.9.0,
`lucide-react` 1.61.0, `systeminformation` 5.33.16 and `@types/node` 22.20.5;
their `THIRD-PARTY-NOTICES.md` and table rows moved with them.

`@types/node` is the one resolution change that was a regression rather than
drift. The host pinned `22.10.2` exactly while vite's peer range is `^20.19.0 ||
>=22.12.0`; before the reinstall a nested copy satisfied the host and a
hoisted `26.6.5` satisfied vite, and after it one copy could not serve both.
The host now declares `^22.12.0`, which resolves to a nested
`packages/host/node_modules/@types/node` 22.20.5 while the `*` requesters still
hoist 26.6.5, so `npm ls @types/node` exits 0 and `tsconfig.e2e.json` keeps
naming the host's nested path.

### Accepted findings that remain

| Finding | Severity | Why it is accepted |
|---|---|---|
| `node-forge` 1.4.0, GHSA-86w9-cpqp-85rv | high | No patched version exists. The host generates and signs with it, never calls the vulnerable verifier; ADR 0070 records the reasoning. |
| `zod` 3.25.76 behind `@google/design.md` 0.4.0, GHSA-mrhx-c7xc-m3w5 | high | The override lifts every other zod copy to 4.6.7, including the store-worker's production one. Only the dev-only linter's v3 copy remains; it declares `^3.24.0`, so the instance is the `@google/design.md` row below. |
| `@google/design.md` 0.4.0, via `zod` | high | Dev-only linter at its latest published version; its `zod` `^3.24.0` requirement has no patched v4-compatible release, so the override scopes the exception by name. |
| `canvas` 3.2.3 → `prebuild-install` 7.1.3 | deprecation | `canvas` is the latest release and fabric's node renderer needs it; a deprecation is not a vulnerability. |
| `whatwg-encoding` 3.1.1 via `jsdom` 26.1.0 | deprecation | jsdom 30, which drops it, fails 8 editor DOM cases; jsdom 26 requires this version and a deprecation is not a vulnerability. |

**Dependency updates.** `.github/dependabot.yml` has Dependabot propose version
updates weekly: npm minor and patch updates arrive grouped, majors individually,
and GitHub Actions updates separately. Security updates additionally require the
repository's Dependabot security-updates setting to be enabled. The audit policy
fails CI on an unallowlisted advisory and on a stale allowlist entry, so a bump
that resolves an allowlisted advisory removes that row in the same PR.

## Vendored source

| Source | Pin | Licence | Role |
|---|---|---|---|
| `@anu3ev/fabric-image-editor` | 0.10.32, commit `9efdd78a34` | MIT | adapted movement-snapping and indicator source |
| `@meteocons/svg-static` (`fill` style) | 0.1.0, `sha512-dnuXOkt1W5q+XZbyj54dzjuBcKmsC0eLv51IVaW9kzzvzwnhwv9KgNXHKgpvmdN6cX2stMo+k95iMFbcyM4x5Q==` | MIT | 23 weather SVGs staged by `packages/host/scripts/vendor-weather-icons.mjs`; served at `/api/weather/icon/<slug>.svg` |
| `systray2` (`tray_linux_release`) | 2.1.4, sha256 `24a176933952c4db79026dcec25c7acf48e5c1cee5d94bc6b87740060bc8ed00` | MIT | Linux x86-64 tray binary staged by `packages/host/scripts/vendor-tray.mjs`; run over JSON lines, never imported |

Copied, not installed: no entry appears in `package.json` and nothing enters the
transitive graph. Licence verified from the `LICENSE` blob at that commit,
`MIT, Copyright (c) 2025 Alexander Anufriev`. Full text in
`THIRD-PARTY-NOTICES.md`. The note above about the removed image-editor package
refers to the runtime dependency, which stays removed.

Meteocons' `package/LICENSE` in the pinned tarball is the MIT text,
`Copyright (c) 2020-present Bas Milius`; the vendor script copies it beside the
icons. Source: <https://github.com/basmilius/meteocons>.

### systray2 packaging review — 2026-10-25

Assessed against the pinned `systray2@2.1.4` npm tarball
(<https://registry.npmjs.org/systray2/-/systray2-2.1.4.tgz>, sha256
`24a176933952c4db79026dcec25c7acf48e5c1cee5d94bc6b87740060bc8ed00`) and the
extracted `package/LICENSE`, whose text is the MIT licence, "Copyright (c)
2017 Zack Young"; the npm metadata also says MIT.

`packages/host/scripts/vendor-tray.mjs` stages `package/traybin/tray_linux_release`
and `package/LICENSE` into `packages/host/vendor/tray` and refuses a digest
mismatch. It is not a declared dependency and never enters the transitive graph.
**Only the Linux x86-64 binary is staged** — Linux arm64 is unsupported and
would need its own binary and provenance; Windows uses the PowerShell adapter,
so it needs no file from this package. The binary is staged, not shipped in the
repository: `vendor/` is ignored, and the staging script writes
`vendor/tray/PROVENANCE.txt` beside the binary for release packaging to ship.
MIT requires the notice to travel with the binary, so release packaging must
include `vendor/tray/LICENSE` beside `tray_linux_release`.

Conclusion: redistribution is permissible with its licence file, and the host
runs it without linking or modifying it.

Open-Meteo's data is offered under CC BY 4.0. Its licence page,
<https://open-meteo.com/en/licence> (verified 2026-10-24), states the credit as
"Weather data by Open-Meteo.com" linking to <https://open-meteo.com/>. That exact
string is `OPEN_METEO_ATTRIBUTION` in
`packages/host/src/providers/weather/open-meteo.ts`, and `weather.attribution`
serves it to a theme.

The two BYOK weather backends carry the credit their own terms pages state,
verified 2026-10-24:

- WeatherAPI — "Powered by WeatherAPI.com", the text option on
  <https://www.weatherapi.com/docs/attribution/>; the page links it to
  <https://www.weatherapi.com/>. Constant `WEATHERAPI_ATTRIBUTION` in
  `packages/host/src/providers/weather/weatherapi.ts`.
- OpenWeatherMap — "Weather data provided by OpenWeather", the required wording
  in the FAQ at <https://openweathermap.org/faq>, which also requires a link to
  <https://openweathermap.org/> and the OpenWeather logo. The text is
  `OPENWEATHERMAP_ATTRIBUTION` and the link is `termsUrl` in
  `packages/host/src/providers/weather/backends.ts`; the host settings page
  renders the text as that link. The logo is not drawn by that surface.

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

### PresentMon packaging review — 2026-10-24

Assessed against the `v2.6.0` console release asset
(`PresentMon-2.6.0-x64.exe`, 980 320 bytes) and the repository's `LICENSE.txt`.

Findings:

- **PresentMon is MIT.** GitHub's licence API reports `spdx_id: "MIT"` for
  `LICENSE.txt`, whose text is the MIT licence, "Copyright (C) 2017-2024 Intel
  Corporation". Redistribution is permitted provided that notice travels with
  the binary; the release asset is a bare executable, so the vendor script
  stages the licence beside it.
- The console asset is one self-contained executable; it bundles no
  third-party binaries whose notices would also need reproducing.
- It is an ETW consumer, not a linkable library. `--output_stdout` writes CSV
  to stdout per row, `--no_csv` creates no file, and `--session_name` names the
  trace session. The host parses by header name, never by column position,
  because `--v1_metrics`/`--v2_metrics` change the set (and the frametime
  column is spelled `msBetweenPresents` in the v1 header and
  `MsBetweenPresents` in v2).
- A trace session needs the account to be in the `Performance Log Users` group
  or to be elevated. Yunari never passes `--restart_as_admin` (it would prompt
  for UAC per launch; it defaults off) and never passes
  `--stop_existing_session` (that would kill a session the user started). A
  denied session is reported `unavailable` and retried only at the next demand
  window.
- Pinned sha256 of the staged `v2.6.0` asset:
  `b2a706bc6ad475749e3b7e3409263aa1e6906d45bdcf993f6dbc0f660188f1af`.
  `packages/host/scripts/vendor-presentmon.mjs` refuses a mismatch.
- Binaries are not committed (`vendor/` is ignored); the repository tracks
  provenance.

Conclusion: redistribution is permissible with its licence file, and the
host runs it without linking or modifying it.

`systeminformation` 5.33.16 (MIT, no dependencies of its own) is the host's
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
