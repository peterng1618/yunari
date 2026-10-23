# 0097 — The Wallpaper Engine library is read by the host

- **Date:** 2026-10-21
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/server.ts`,
  `src/web/packages/editor/src/editor-session.ts`,
  `src/web/packages/editor/src/editor-shell/shell-layout.tsx`

## The problem

An author owns Wallpaper Engine themes and wants one as a Yunari background. A
downloaded theme is a packed `scene.pkg` that Wallpaper Engine's own editor
refuses to open, and Yunari does not render Wallpaper Engine scenes. The shape
is therefore: read a library that lives on disk, classify what can be flattened,
and for a scene hand the author to the one tool that can export it — without
driving that tool, patching it, or writing into its files.

The non-obvious part is where the decision belongs. The browser cannot read
`D:\Games\Steam\…`; the host can. Every filesystem decision — locating the
install, scanning item directories, reading the container, unpacking one
project, launching the editor, and scoping the export watch — sits behind host
routes. The browser addresses an item by `workshopId` and never by a path.

## Rung 1 — Yunari

Searched: `editor/src/asset-manager/`, `host/src/themes/` (`store.ts`,
`import.ts`, `thumbnails.ts`, `trash.ts`), `theme-package/src/`, `renderer-core`
`Artboard.backgroundMedia`, `scene-fabric/src/background-media.ts`, and the
asset finder's registry (`host/src/assets/sources.ts`, `source.ts`).

Found: asset ingestion with size caps and the reference model; theme import and
thumbnail stores; a background-media model with `fit` and playback
(`autoplay muted loop playsInline`); package-member validation including the
landed `credits.json`; and the finder's source port, whose `local` category and
`wallpaper-engine` body already exist with no source behind them. Found no
Steam library scanner, no `.pkg` reader, no scene classifier and no transcoder
of its own.

## Rung 2 — dependencies

Searched: the workspace manifests and installed packages for a Steam library
reader, a VDF parser, a `.pkg` reader and a video probe/transcode binding.

Found: none installed. Prior art outside the tree is `rePKG` (.NET, pkg
extraction) and Steam-Library-Manager-style VDF parsers. Neither is worth a
dependency for a line reader over `libraryfolders.vdf` and a table walk over the
container. FFmpeg is already the store's normalizer question (0091); this work
does not add a second encoder.

## Rung 3 — platform

Searched: Node's `fs`, `path`, `child_process.execFile`, `os.tmpdir()`.

Found: `fs` covers the directory scan and the byte copy; `execFile` already runs
`reg query` in `themes/trash.ts`; VDF is a plain key/value text format with a
`"path"` line per library; `.pkg` is a table of name/offset/length followed by
contiguous bytes. No native API adds anything, and the platform gives no export
or render entry point (rung 4).

## Rung 4 — ecosystem

Searched (recorded in the spec's §10 survey):
`"automate Wallpaper Engine export"`, `"wallpaper engine scene renderer linux"`,
`"rePKG scene.json"`, `"Wallpaper Engine mobile video export"`.

Found: only screen-capture tools and UI automation, which the vendor blocks
deliberately — `wallpaperui.exe` refuses remote-debugging arguments with an
explicit message, and its full flag set contains no export, render or encode
command. The export capabilities exist only as CEF-bound JavaScript entries
(`startVideoExport`, `exportMobilePkg`, …) reached from the app's own UI. **No
project renders a Wallpaper Engine scene headlessly**; doing so would be an
engine port (particles, HLSL materials, FBO passes, text rasterizer), which the
spec closes as R2.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Render scenes in Yunari | one pipeline | months: shader compiler, particle RNG, text rasterizer | every unported feature renders visibly wrong; 98% of scenes affected | rejected (R2) |
| Decode `.tex` to an image | no export dialog | LZ4 + BC1/BC3/BC7 decoders; 42 of 48 still scenes carry layer effects the decoder would miss | 88% of the still set wrong | rejected |
| Automate the app | reuses its renderer | DLL injection or patching; vendor refuses debugging | breaks on every update; violates R1 | rejected |
| Read the library; export scenes through Wallpaper Engine's own UI | every filesystem decision on the host; no dependency | one guided sheet and a watcher | export-dialog location is unverified (§14.2) | **chosen** |

## Rung 6 — probe

Measured on the local install (Wallpaper Engine 2.8.42, 2026-10-21) — the
figures are the fixtures' source of truth:

- 447 workshop content directories, 421 `workshopcache.json` rows, 28 with no
  readable `project.json`, 23 `ispreset` rows that are not wallpapers.
- 225 subscribed scenes; the container reader parsed 224. Still at rest: 48
  (21%), of which 8 carry text and 5 failed only on keyframes.
- 19 of the parsed scenes carry a keyframed property; adding `model` and `light`
  to the still test changes the count by zero.
- 0 of 447 `project.file` values name an image; the image outcome is proven by
  fixture, not by this library.
- Video wallpapers: 156, median 22.2 MiB, 92 (59%) under the 32 MiB cap, largest
  456 MiB.

## Rung 7 — build

The smallest build that holds: one host module (`wallpaper-engine/`) behind five
routes, one finder body and its export sheet. No new dependency — the container
reader is a bounds-checked table walk, the still test is a recursive key check
over `scene.json` plus referenced model members, and the VDF read is a line
reader.

## Decision

The host reads the library; the editor lists it and guides the export. Yunari
never drives Wallpaper Engine (R1), never renders a scene (R2), and never writes
a second directory or a configuration file. The one write is the unpack into
`projects/myprojects/<workshopId>/`, because a downloaded scene cannot be opened
in Wallpaper Engine's editor until its `.pkg` is unpacked and its `file` field
restored to `scene.json`.
