# Wallpaper Engine as a source of Yunari background media — design

- **Date:** 2026-10-21
- **Status:** implemented 2026-10-23 (plan archived; decision `0097`)
- **Author:** investigation on Wallpaper Engine 2.8.42, build `2026-06-29 14:36:02`
- **Related:** [`2026-10-12-theme-store-design.md`](2026-10-12-theme-store-design.md)
  (media normalizer, ffmpeg decision), `renderer-core`'s `BackgroundMedia`,
  `theme-package`'s member rules.

## What this is, and is not

**This is** an importer that reads the Wallpaper Engine library already sitting
on the author's disk and produces Yunari assets: images directly, videos through
the shared media normalizer, and a guided path for scene themes that uses
Wallpaper Engine's own export — PNG when the scene is still at rest, MP4 when it
is animated.

**This is not** an automation of Wallpaper Engine, and not a reimplementation of
its renderer. Both were investigated and closed; the evidence is below and the
sections after it exist because those two doors are shut.

## Rulings taken 2026-10-21

These were decided during the investigation and this spec does not re-open them.

**R1 — Yunari never drives, injects into or patches Wallpaper Engine.** The only
supported automation surface was removed by the vendor on purpose (§2). The
importer reads the library, writes one project directory of its own (§8), and
launches the editor at it. It never sends input to a running Wallpaper Engine,
never edits the app's configuration, and never touches the app's own files.

**R2 — Yunari does not render Wallpaper Engine scenes.** 98% of the local
library's parsed scenes carry a particle system, an animation layer, a text
object or an effect chain — the engine itself, not a video encoder (§3). Scene
themes resolve to a guided export.

**R3 — The disk is truth; the library cache is metadata.** The cache lists 421
items while 447 project directories exist on the same install (§1.4). A cache
miss is not an absent wallpaper, and a cache row is not a promise the files are
still there.

**R4 — Static images are a first-class outcome, not a fallback.** An item whose
payload is an image is imported as an image asset, never transcoded to a video to
simplify the pipeline, and a *scene* that is still at rest becomes an image too —
through Wallpaper Engine's own PNG export, not a decoder (§4.1).

**R5 — Attribution is a theme-package member, not a Wallpaper Engine field.**
`credits.json` is designed for fonts, icons and stock images too (§7).

**R6 — The video budget belongs to the shared media normalizer.** The importer
hands it bytes and a source description; it does not carry its own encoder
(§6).

**R7 — Discovery is host-side, the flow is editor-side.** The browser cannot
read `D:\Games\Steam\...`; the host can. The editor renders the list and the
guidance; the host owns every filesystem decision. This mirrors how
`themes/import.ts` already splits the work.

**R8 — Selecting a scene theme unpacks it without a separate confirmation**
(directed 2026-10-21, overturning this spec's earlier ruling that unpacking be an
explicit button). The unpack is the first step of the flow, not a question before
it. The directory is named by the item's workshop id, so two items can never be
asked to share one and there is no prompt to answer; the surviving limit is about
losing work: an existing directory is **reused, never written into**, and a run
that fails part-way removes only the directory it created itself.

## 1. What Wallpaper Engine is, on this disk

### 1.1 Install and library

```
<install>/                       C:\Program Files (x86)\Steam\steamapps\common\wallpaper_engine
  wallpaper64.exe                the renderer — no export capability
  bin/wallpaperui.exe            the CEF + AngularJS editor/browser
  bin/workshopcache.json         offline metadata for subscribed workshop items
  projects/myprojects/           the author's own projects
  projects/temp/{mobile,publish,edit}
```

Subscribed wallpapers live outside the install, under a Steam library:

```
<library>/steamapps/workshop/content/431960/<workshopid>/
  project.json                   type, file, title, preview, properties
  preview.jpg
  <file>                         the wallpaper's own payload
```

The app id is **431960**. A machine may have several Steam libraries;
`steamapps/libraryfolders.vdf` in the Steam root lists them.

### 1.2 What a `project.json` says, per type

Measured across all 447 local item directories:

| `type` (any casing) | Count | Payload `file` |
|---|---|---|
| `scene` | 225 | `scene.pkg` (225) |
| `video` | 156 | `.mp4` (155), `.wmv` (1) |
| `web` | 15 | `.html` (15) |
| *none* | 23 | none — these are **presets for another wallpaper** (`preset` object, `dependency` naming the parent) |

447 directories in total: the 419 above, plus **28 with no readable
`project.json`**. Those 28 are skipped, not guessed at.

**Measured again 2026-10-23, and it overrides the table's scene row:** all 227
scene descriptors name `"file": "scene.json"` (one names `gifscene.json`), 226
of the directories carry `scene.pkg`, and none carries `scene.json`. A scene's
payload is therefore `<directory>/scene.pkg` when that file exists; the named
file is used only when it does not. R3 makes the disk the truth, so the scanner
follows today's descriptor rather than the 2026-10-21 sample.

**Type casing is inconsistent in the wild**: `Video` 12 / `video` 144,
`Scene` 37 / `scene` 188, `Web` 3 / `web` 12. Every read lowercases.

**The 23 untyped items are not wallpapers.** They carry a `preset` object and a
`dependency` field naming the wallpaper they configure. They must be excluded
before they reach a list, or the importer offers the author something that has no
payload at all.

### 1.3 Per-wallpaper user settings

The author's chosen property values — the settings the user described as "native
WE feature, user settings saved as JSON" — are stored in the install's
`config.json` under the per-user object:

```
config.json → <username> → wproperties[<absolute wallpaper file path>] = { <property>: <value>, … }
```

They are readable offline and keyed by the same path as `workshopcache.json`'s
`file` field. The importer reads them to record what a render was made with; it
**never writes them** (R1).

### 1.4 The library cache

`bin/workshopcache.json` is `{ user, version, wallpapers: [...] }` with one row
per subscribed item. Each row carries:

```
allowmobileupload, authorsteamid, favorite, file, filesize, filesizelabel,
hasrating, ispreset, local, official, preview, previewsmall, project, rating,
ratingrounded, status, subscriptiondate, tags, title, type, updatedate,
workshopid, workshopurl, youtube
```

**`ispreset` is the flag that matters, and `type` is not.** The 23 presets are
labelled `Scene` or `Web` in `type` and their `file` points at their own
`project.json`; filtering by `type` alone therefore counts thirteen extra
"scenes" that have no `scene.pkg` at all. `ispreset: true` identifies them
exactly, and the disk agrees: their `project.json` carries no `type` and a
`preset` object instead (§1.2).

This is the attribution source (§7) and the only offline source of an item's
workshop id and author. It is regenerated by Wallpaper Engine, so it can lag the
disk (R3): the importer joins it onto the directory scan by `workshopid`, and an
item with no cache row is still listed, with its attribution fields absent.

**It contains no author display name**, only `authorsteamid`. The vendor's UI
resolves names over the network each session.

## 2. Why there is no automation path

The question was whether a CLI could produce the video Wallpaper Engine's own
"send to mobile device → pre-rendered" flow produces. It cannot. The evidence:

| Probe | Result |
|---|---|
| Full command-line flag set of `wallpaperui.exe` | `-window -path -project -textures -workshopids -clearUnused -dithered -monitordetection -monitormap -language -skin -screensaver -service -startupTask -parentwindow -parentprocess -messagehandler -json -weuimain -steamlanguage -buildv -transcode -generateDepthMap -setwallpaper -CheckWebViewSupport -disablegifs -disablefx -vdesktopenabled`. **No export, render or encode command.** |
| `startVideoExport` / `cancelVideoExport` | Entries in a CEF string table (`0xac7f48`, `0xac7f60`) beside `exportMobilePkg`, `convertProjectToMobile` and ~100 other native capabilities; all reached from JavaScript through `callEditor`. There is no command-line route to any of them. |
| `wallpaper64.exe` (the renderer) | Contains no export capability at all: the only `/export/i` match is `exports`, and there is no `mp4` string. Encoding exists only in the UI process. |
| Remote debugging | Refused explicitly: *"It appears that you have added remote debugging arguments to Wallpaper Engine: %s / This is not allowed and you must remove them to continue."* — with instructions to reinstall. A deliberate vendor prohibition, not an oversight. |
| `-transcode` | A red herring. It builds `resourcecompiler64.exe -transcode -i … -o … -f ETC2 -c force -shrink N -maxmipmaps 1` — texture compression for mobile packages, not video. |
| `-messagehandler` / `-parentprocess` | A generic child-process progress pipe between a launcher and its UI, not a command channel. |

A CLI path would require injecting a DLL or patching `wallpaperui.exe`. That is
fragile across every Wallpaper Engine update, and it contradicts an explicit,
vendor-enforced refusal.

## 3. Why Yunari does not render scenes

The video export itself is trivial — allocate frames, step the scene, read back,
crossfade, encode. Every cost is in producing the frames.

Every subscribed `scene.pkg` was opened through its container and its root
`scene.json` parsed — **224 of 225**; one package has no `scene.json` member:

| Measure | Result |
|---|---|
| Scenes containing a particle system | **170 / 224 = 76%** |
| Scenes containing text objects | 52 / 224 = 23% |
| Scenes with animation layers | 7 / 224 = 3% |
| Scenes with at least one layer effect chain | 197 / 224 = 88% |
| Scenes with **no** layer effect at all | 27 / 224 = 12% |
| Objects per scene | median 7, p90 32, max 377 |
| Effect chains per scene | median 4, p90 22, max 375 |

The 12% with no effect is not a measurement of *static* themes — §4.1 defines
that, and it is 21%. Effect chains also attach at the material level rather than
on the object, which this census did not inspect; the one effect-free scene that
was opened ("Water effect 13") still ships
`materials/background.tex`, a `flowmask.tex`, a ripple material and a flow-image
shader. It is not a still picture.

A single representative theme needs three effect chains (a five-pass godrays
downsample/cast/gaussian/combine, plus pulse and water ripple), HLSL `frag`+`vert`
pairs compiled on load, three named FBOs with half-scale downsampling, a mask
texture, and a bloom post-process.

Rebuilding means shipping an HLSL→SPIR-V→WebGL compiler, Wallpaper Engine's
material/pass/FBO/bind model, its particle integrator **and seeded RNG**, its text
rasterizer, camera parallax/shake/fade, and scene scripts. That is months against
2% of scenes, and every unported feature renders visibly wrong — worse than
having no feature.

## 4. What each item resolves to

The importer resolves an item to exactly one of these outcomes, first match wins:

| Outcome | When | What happens |
|---|---|---|
| **image** | `project.file` names an image — `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.bmp` | imported as an image asset, bytes unchanged |
| **video** | `type: video` and the payload is `.mp4` / `.wmv` | handed to the shared media normalizer (§6), then imported as an asset |
| **web** | `type: web` | **not imported.** Listed as unsupported with the reason, because rendering it needs a browser the host does not own |
| **scene, still at rest** | `type: scene` and the still test passes (§4.1) | **not imported.** The flow (§8) exports it as **PNG** |
| **scene, animated** | `type: scene` otherwise | **not imported.** The flow (§8) exports it as **MP4** |
| **preset** | no `type`, has `preset` | **not listed at all** (§1.2) |

### 4.1 "Still at rest", and how a still becomes an image

A still theme is a *scene* whose picture does not change without input. The
author's definition, given 2026-10-21, names the elements that come with it:

> a still background with a clock and/or parallax background layers and/or
> interactive mouse elements … sounds [are] one of the element[s] that makes it
> still considered a "still at rest" package, too.

These are not exceptions being tolerated one by one. They are elements that make
no difference on a non-interactive display: parallax and mouse layers only move
when the pointer does, sound is not in the picture, and a clock is whatever the
frame caught it at. Their presence beside a texture does not stop the theme being
a static image **in Yunari's terms** — a theme we flatten to one frame and
accept the result.

So the test is not "the picture never changes". It is: does anything animate on
its own?

> **Still at rest** = the scene has **no particle object**, **no animation
> layer**, and **no property carrying keyframes**.
>
> The first two are the `particle` and `animationlayers` object keys. The third is
> an `animation` key anywhere in the tree: Wallpaper Engine stores a keyframed
> property as `{ "c0": [ { "frame": 0, "value": … }, … ] }` under `animation`, so
> an object whose `origin`, `alpha` or shader constant has one moves by itself.
> Sprite-sheet animation and animated models under `models/*.json` belong to the
> same class and join the test once their JSON is parsed. Everything else a
> scene can hold does not enter it.

Measured by reading each package's `scene.json` through the real container reader
(§8.1), over the 225 subscribed scenes of which 224 parsed: **48 are still at
rest (21%)**, of which 8 carry text, 6 carry sound and 6 have no layer effect at
all. Five more scenes passed the particle and animation-layer test and failed on
keyframes — they are the cases that would have shipped as a frozen image of a
moving thing. Adding `model` and `light` to the test changes the count by zero —
no still scene carries either key — so the test is those three.

**A clock must not reach the background, in either format.** Text does not
disqualify the theme, but it must not be exported into the asset. Yunari draws
its own clock, so a burnt-in one is at best a duplicate and at worst a wrong
time — frozen at one instant in a PNG, and looping the same minute forever in an
MP4. Both are worse than the weather label it often sits beside. So the export
carries one required author step, named before it happens rather than after:
**delete the dynamic text objects in the editor** — clock, weather, media label
— and export without them. The classifier reports whether the scene carries text
(§5.2) so the sheet knows when to say it; an imported image or video item gets
the same sentence as guidance, because its clock is already baked in and cannot
be checked for.

This changes nothing about the classification: a scene with a clock and no
particles is still a static-image theme. It changes what goes into the frame.

**The still path is Wallpaper Engine's own PNG export, not a `.tex` decoder.**
The editor's format list ships `{label:"ui_editor_export_modal_settings_format_png",
value:"png"}`, so a still theme renders to an exact 1920×1080 image — effect
chains, bloom and colour grading included — through the same guided flow that
produces the video.

The decoder was considered and rejected on measurement. A `.tex` is `TEXV0005`,
`TEXI0001`, a texture-info block, a header CRC and `TEXB0001` blocks of
LZ4-compressed, mip-chained BC-compressed payloads: a format enum table, an LZ4
stage and BC1/BC3/BC7 decoders. That buys the background texture and nothing
else — **42 of the 48 still scenes carry at least one layer effect**, which a
compositor would not render, so 88% of the still set would come out wrong. The
decoder is not in this design; if it is ever wanted, it is for the 6 scenes
without layer effects, and it is its own plan.

**What is not yet verified.** Sprite-sheet and model animation live inside the
`models/*.json` a scene object points at. A first pass found no object-level
`model` key in this library, so those JSONs were not walked; the 48 is therefore
an upper bound on still themes, and the classifier must reach them before the
number is trusted. The phase that builds it carries a fixture for a
sprite-animated model.

GIF wallpapers need no special case: Wallpaper Engine converts them to `.mp4`
at subscribe time and they arrive as video items.

## 5. Architecture

### 5.1 Where it lives

```
src/web/packages/host/src/wallpaper-engine/
  locate.ts      find the install and every Steam library, or report absence
  library.ts     scan item directories, merge workshopcache.json rows
  resolve.ts     item → outcome, and the payload path
  pkg.ts         the scene.pkg table reader, shared by classify and unpack
  classify.ts    the still-at-rest test (§4.1)
  unpack.ts      scene.pkg → an editable project under projects/myprojects/
  wire.ts        the JSON the browser receives
```

A sibling of `themes/`, **not** a provider. `host/src/providers/` is the hardware
telemetry acquisition layer; a wallpaper library has none of its scheduling,
fallback or slot semantics, and putting it there would make it answer to the
telemetry lifecycle for no reason.

### 5.2 Host surface

```
GET /api/wallpaper-engine
  → { available: false, reason: "not-installed" | "unsupported-platform" | "no-library" }
  → { available: true, install: "<path>", items: [ StoredItem … ] }

GET /api/wallpaper-engine/item/<workshopId>/preview
  → image bytes, with the cache row's preview path as the source

GET /api/wallpaper-engine/item/<workshopId>/asset
  → the payload bytes with its content type; for a video, the source video the
    normalizer will consume

POST /api/wallpaper-engine/item/<workshopId>/project
  → { ok: true, name, reused } after unpacking into projects/myprojects/<name>/
    and launching the editor on it
  → { ok: false, reason: "no-install" | "unreadable" | "refused" }

GET /api/wallpaper-engine/exports?since=<epochMs>
  → { files: [ { name, format ("png" | "mp4"), modified, size } … ] }
    newest first; only the three scoped directories (§8, step 5) are read

GET /api/wallpaper-engine/export?name=<name>
  → the bytes with their content type, or 404
    `name` is resolved against the three scoped directories and refused if it
    holds a separator, `..`, or any extension other than `.png` / `.mp4`
```
```

`StoredItem` carries what the editor's list needs and nothing more:

```
workshopId, title, kind (image | video | web | scene),
previewUrl?, filesize, tags[], properties (read-only),
stillAtRest?,                       // scene items only; absent when unclassified
hasText?,                           // scene items only: the text-removal step
attribution: { steamId?, workshopUrl? } | absent
```

The payload's absolute path stays in the host. The browser addresses an item by
`workshopId`, which is stable across Steam library moves; a path is not.

The one write is `/project`, which creates one directory named by the workshop id
under `myprojects/` and then launches the editor on it. The name is the id, not
the title, so a second item cannot collide with the first and the author is never
asked to invent one. `mkdir` is the existence test: if the directory is already
there it is that item's earlier unpack, the route launches it and reports
`reused: true`, and it writes nothing. A failure after the `mkdir` removes the
directory this run created and answers with the reason; it never touches a
directory it did not make. There is no import-side route: the editor fetches the
asset bytes and hands them to the existing asset manager, which already owns the
size caps and the reference model.

### 5.3 Editor surface

The background-media picker gains a source: **From Wallpaper Engine**. **The
placement is now the asset finder's** ([`2026-10-21-asset-finder-design.md`](2026-10-21-asset-finder-design.md)):
the library is registered there as the one local source, and this section
describes what that source shows. It shows
a list — thumbnail, title, kind, size — filtered by kind, with a search field
over the title. Selecting an `image` or `video` item fetches its asset and calls
`manager.import(file)`, then sets it as the artboard background, saying once
that a clock or weather label baked into it cannot be removed and should not be
there (§4.1). A `scene` item starts the flow in §8. A `web` item shows why it is
unavailable.

When the host answers `available: false` the source is not drawn at all — the
Add pane looks exactly as it does today on a machine without Wallpaper Engine.

## 6. The video budget

Yunari's existing caps are **32 MiB per asset**, **128 assets**, **128 MiB
total** (`host/src/themes/store.ts`). Measured across the 156 local video
wallpapers:

| Measure | Result |
|---|---|
| Median size | 22.2 MiB |
| Under 32 MiB | 92 / 156 = **59%** |
| At or over 32 MiB | 64 / 156 = **41%** |
| Largest | 456 MiB |
| Total for the whole video library | 7.7 GiB |

So pass-through covers a bare majority and nothing more. The importer does not
choose a profile, re-encode, or refuse on its own: it hands the source to the
**media normalizer owned by the store spec**, which already owns MP4 validity
(faststart, H.264 High, `yuv420p`, even dimensions, CFR ≤30 fps, no audio, CRF
20–23, idempotent pass-through) and still records its own encoder question —
system `ffmpeg` probed at runtime, or a bundled static build — as open. This
spec takes that owner's answer; it does not answer it a second time.

That normalizer's current rules produce a *valid* file, not a *small* one. This
spec adds one requirement to it rather than a second encoder:

> **R6a — the normalizer accepts a byte ceiling and meets it or refuses.**
> Given a source larger than the ceiling it selects a profile ladder (1080p,
> then 720p, then a lower bitrate) and reports which profile it used. If the
> smallest profile still exceeds the ceiling it returns a refusal naming the
> source size, and the editor says so before importing rather than failing
> inside the asset manager.

Until that normalizer lands, the video outcome is available only for assets
already inside the ceiling — the importer passes through and reports the rest as
"too large, awaiting media conversion". This is a sequencing dependency, not a
gap in this design.

## 7. Attribution

### 7.1 The member

The theme package gains one optional member:

```
credits.json
```

declared in `manifest.json` as `"credits": "credits.json"`, exactly as
`thumbnail` is declared today. `theme-package/src/index.ts` gains the constant,
the manifest check, the entry-size cap, and the "every file must be declared"
exception. A package that names a credits file it does not carry, or carries one
it does not name, is refused for the same reason a stray thumbnail is.

### 7.2 The shape

```json
{
  "format": "yunari-theme-credits",
  "version": 1,
  "entries": [
    {
      "kind": "wallpaper",
      "title": "Water effect 13",
      "author": { "steamId": "76561198…" },
      "source": {
        "workshopId": "820654165",
        "url": "https://steamcommunity.com/sharedfiles/filedetails/?id=820654165"
      },
      "license": "unknown",
      "changes": "Re-encoded to 1080p30, audio removed"
    }
  ]
}
```

- `kind` is a short free string, not an enumeration: `wallpaper`, `image`,
  `font`, `icon`, `sound`, `other` are the values this importer writes, and a
  later asset finder adds its own without a format change.
- `license` is `unknown` when nothing was recorded. It is never guessed and
  never omitted — an absent licence is a fact worth showing.
- `changes` records what Yunari did to the bytes. Re-encoding is a derivative
  work; the file says so.

### 7.3 What the importer writes

One entry per imported Wallpaper Engine item, built from the cache row:

```
kind      "wallpaper"
title     cache.title, or the directory name when the row is absent
author    { steamId: cache.authorsteamid }        (absent when no cache row)
source    { workshopId, url: cache.workshopurl }
license   "unknown"
changes   the normalizer's reported profile, or "Copied unchanged"
```

No author display name is written, because none is available offline (§1.4). The
credits UI renders the workshop URL as the attribution link; a display name is a
future addition that needs a Steam Web API key, and is out of scope here.

## 8. Scene themes: the guided export

A scene cannot be imported; the author must render it once with the tool that
can. The flow reduces that to a sequence of clicks, and Yunari does every part
of it that does not need the author's hands.

1. **The author selects the theme as a background.** That is the trigger. There
   is no separate "import a Wallpaper Engine theme" errand, and no confirmation
   before the unpack (R8).
2. **Yunari unpacks it, silently.** The host extracts `scene.pkg` into
   `projects/myprojects/<workshopId>/` and writes the item's `project.json`
   beside the members with its one packed-only field rewritten: `file` becomes
   `scene.json`. A subscribed descriptor names `scene.json` too (measured
   2026-10-23; the earlier sample recorded `scene.pkg`), but the directory beside
   it carries only `scene.pkg`; a source project carries the editable
   `scene.json` itself. The unpack writes the package's members — `scene.json`
   included — beside the descriptor, which is the source shape the editor opens;
   a downloaded theme cannot be opened without it (§8.1). If the directory is
   already there, it is an earlier unpack of the same item: nothing is rewritten
   and the flow goes straight on (R8).
3. **Yunari opens the editor on it** — `wallpaperui.exe`, with `-project <path>`
   if that flag selects the project (§14.1) and otherwise with the author picking
   it from the list. A launch, not a drive (R1).
4. **The sheet guides the export**, with the settings §4.1's still test chooses:

   | | still at rest | animated |
   |---|---|---|
   | Format | **PNG** | **MP4 (H.264)** |
   | Size | 1920 × 1080 | 1920 × 1080 |
   | Frame rate | — | 30 fps |
   | Duration | — | 5 s |
   | Blend | — | 1 s |

   The blend is what makes the loop seamless: Wallpaper Engine crossfades the
   last `blend` seconds into the first, which is also how stochastic content
   (particles) is made to repeat.

   **First: delete the dynamic text.** A clock, a weather label or a media title
   is a wrong time frozen in a PNG and a wrong time looping forever in an MP4,
   and Yunari draws its own clock either way (§4.1). The sheet lists the
   deletion as a step — not a suggestion — whenever the item's `hasText` is
   true, for both formats, and says nothing about it for a scene without text.
   The author deletes those objects in Wallpaper Engine's own editor, which is
   also the answer to the deferred element-removal request without any change to
   policy (R1); Yunari never edits the scene for them.
5. **The sheet watches for the result.** While it is open, it polls the host for
   files modified since it opened — `.png` or `.mp4` according to the format
   above — in `<install>/projects/temp/`, `<install>/projects/myprojects/`, and
   the Windows `Videos` folder only. The newest match is offered as the import.
   The polling scope is fixed and small on purpose; Yunari does not roam the
   author's profile.
6. **The asset arrives through the ordinary path.** A PNG becomes an image asset;
   an MP4 goes through the shared media normalizer (§6) and becomes a video
   asset. Either way the flow then sets it as the artboard's background media,
   which is where the author started.
7. If the export went somewhere else, the sheet says so and points at the normal
   **Add → File** route. That is not a Wallpaper Engine feature, and the sheet
   does not pretend otherwise.

### 8.1 Why the editor cannot open it, and why unpacking is ours to do

Wallpaper Engine refuses a downloaded scene twice, by design:

- The Installed tab hides its **Open in Editor** button for anything with a
  `workshopid`: `ng-if="!(currentSelection.localAndExternal ||
  currentSelection.official || currentSelection.workshopid)"`.
- The refusal is not only cosmetic. `ui_editor_toast_project_packed` renders as
  **"Packed wallpapers cannot be opened."**, and that key ships in 2.8.42's own
  `locale/ui_en-us.json`. The editor's `openProject` path rejects a `.pkg`, so
  the drag-and-drop `createInEditor` route does not bypass it either.
- The documented reason is the same one that makes a `.jpg` unopenable in an
  image editor: a `.pkg` is the compiled output, and the author's project data
  was never in it.

The vendor's own help page points at unpacking, and that is the one step Yunari
can take. The container is small enough to be unambiguous, and was decoded and
validated against two real packages while writing this:

```
u32 magicLen (= 8)   "PKGV0001"
u32 entryCount
per entry:  u32 nameLen   name[nameLen]   u32 dataOffset   u32 dataLen
then      the member bytes, contiguous, offsets relative to the table's end
```

Both packages checked out exactly: entries contiguous, and the last entry ending
at the file's final byte. Unpacking is a table walk and a byte copy — no
decompression, no format conversion, and **no `.tex` decoding**: a project
references its textures as `.tex` and the editor reads them natively. That is
precisely why unpacking fixes the editor but does not fix §4.1's image import.

One consequence worth naming: the unpacked copy becomes a local wallpaper in the
author's Installed tab, so the flow leaves something behind on their machine.
The sheet says so once, where it lists the export steps, rather than asking
before it starts (R8).

Element removal is a **step the author takes and Yunari only names** (§8, step
4): no scene is edited by the importer, and nothing about the removal is data
Yunari stores. The author's own Wallpaper Engine property values (§1.3) are what
the render reads.

## 9. What already exists, and must not be rebuilt

| Need | Owner today |
|---|---|
| Asset ingestion, size caps, reference model | `editor/src/asset-manager` |
| Video validity (faststart, codec, CFR, audio) | the store spec's media normalizer |
| A video as artboard background | `Artboard.backgroundMedia = { assetId, fit }`, `BACKGROUND_MEDIA_FITS` |
| Playing it | `scene-fabric/src/background-media.ts` (`autoplay muted loop playsInline`) |
| Package member validation | `theme-package/src/index.ts` |
| Thumbnails, library import | `host/src/themes/thumbnails.ts`, `themes/import.ts` |

The importer adds discovery and a file source. It adds no renderer, no encoder,
no second background model and no second package format.

## 10. Reuse gate — the seven rungs

Required because the work touches `theme-package/src/index.ts` and proposes a
change to the normalizer. Recorded here; the decision note lands before the first
write.

**Rung 1 — Yunari.** Searched for an existing library scanner, asset source,
transcoder and credits model. Found: asset manager (import, caps), theme store
(import, thumbnails, trash), background media (video playback), no scanner, no
transcoder, no credits model anywhere.

**Rung 2 — dependencies.** Searched installed packages for a Steam library
reader, a video probe/transcode binding, and a pkg reader. Found none. Prior art
outside the tree: `rePKG` (.NET, pkg extraction), `Steam-Library-Manager`-style
VDF parsers. None is a dependency worth adding for a 30-line VDF read and a
100-line container read.

**Rung 3 — platform.** Node's `fs` covers the scan; `vdf` is a plain key-value
text format; `.pkg` is a simple table-then-blob container. No native API adds
anything.

**Rung 4 — ecosystem.** Searched for prior art on automating Wallpaper Engine's
export. Found only screen-capture tools and UI automations, all of which the
author's own vendor blocks (§2). No project has solved "render a WE scene
headlessly", which is consistent with §3: it would be an engine port.

**Rung 5 — comparison.** The remaining choices are where the flow lives
(host vs editor vs new package) and whether the asset arrives as bytes over a
route or as a file path. Bytes-over-route wins because it reuses the asset
manager's caps and reference model unchanged.

**Rung 6 — probe.** Executed: a container reader against all 225 subscribed
scenes, 224 parsed (§3), the still rule against the same set (§4.1), the
container layout to the last byte on two packages (§8.1), the cache against the
disk and against `ispreset` (421 rows, 23 presets, 447 directories, §1.4), every
`project.file` against an image extension (0 of 447, §4.1), and the video sizes
against the 32 MiB cap (§6).

**Rung 7 — build.** The smallest build that holds: one host module, six routes,
one editor source. No new dependency — the container reader and the still test
are tens of lines each against formats already decoded here.

## 11. Failure modes and refusals

| Situation | Behaviour |
|---|---|
| Wallpaper Engine not installed | source not drawn; route answers `available: false` |
| Not Windows | `available: false, reason: "unsupported-platform"` — WE is Windows-only |
| Install found, no library folders | `available: false, reason: "no-library"` |
| Item directory unreadable | item omitted from the list, counted in a `skipped` figure the host reports |
| Preset item | never listed (§1.2) |
| Cache row missing for a directory | listed, with attribution absent |
| `scene.pkg` missing or unreadable | listed as `scene`, `stillAtRest` absent — an unclassified scene is exported as unchanged video, never guessed still |
| `project` route finds the directory already there | not a failure: `ok: true, reused: true`; nothing is written and the editor opens on the existing project |
| `scene.pkg` table runs past the file's end, or a member write fails | the directory this run created is removed and the route answers `unreadable`; an existing directory is never touched |
| `myprojects` not writable | `ok: false, reason: "refused"`; the flow stops and says why |
| `-project` does not select the project | the editor still opens; the sheet names the project to pick |
| Video over the ceiling | listed with the reason; import disabled until the normalizer can meet it (R6a) |
| Web item | listed as unsupported with the reason |
| Export watcher finds nothing after the sheet is closed | no error; the sheet simply closes |

No failure is silent. Every refusal names the item and the reason, in the editor.

## 12. What this does not decide

- Whether a Yunari theme can be *published* with a Wallpaper Engine derivative
  in it. The credits file records provenance; the legal question is not answered
  here.
- Author display names (§7.3).
- Web wallpapers (§4).
- Rendering scenes (R2).
- Where the unpacked project goes if the author's `myprojects` is on another
  drive or is read-only. The flow reports the failure and stops; choosing an
  alternative location is a later decision.
- The author's own projects under `projects/myprojects/`. Only subscribed
  workshop items are listed, because the premise is a theme the author has
  already downloaded. A local project has no workshop id to key it by, and
  inventing one is a separate decision.
- Any write to Wallpaper Engine's configuration (R1).

## 13. Landing order

1. **Host discovery and resolution** — `locate`, `library`, `resolve`, `pkg.ts`,
   the read routes, unit tests over fixture directories and a recorded
   `workshopcache.json` slice.
2. **The still test** — `classify.ts`, parsing `scene.json` and the referenced
   `models/*.json` for particle, animation-layer and keyframe keys, and reporting
   `hasText` for the removal step. Fixtures: a particle scene, a clock scene, a
   keyframed-property scene, a sprite-sheet model, and an unreadable package.
3. **Editor source** — the list, the image and video paths, the refusal states.
   Its surface is the asset finder's modal, so it lands with that spec or after
   it, as a registry entry rather than a section of its own.
4. **Credits member** — `theme-package` change, the importer writing entries, the
   credits surface in the theme's details.
5. **Video path** — joins the media normalizer when it lands; before that, the
   pass-through-inside-budget behaviour of §6.
6. **The flow** — the unpacker and its `POST` route, the editor launch, the
   sheet, the PNG/MP4 guidance, the watcher, and setting the result as the
   artboard background.

Phases 1–2 are independently testable and land without any Wallpaper Engine
interaction. Phases 5 and 6 are the only ones that depend on other plans. The
unpacker is a table walk with its own fixture: a real `scene.pkg`, asserted to
extract every member to the byte, to refuse a table whose last member runs past
the file's end, and to reuse — not rewrite — a directory that already exists.

## 14. Open questions

1. **Does `wallpaperui.exe -project <path>` select the project in the editor?**
   The flag exists; its semantics are unverified. It is now a convenience only:
   the unpacked project exists and is listed either way. Phase 6 verifies it and
   drops the flag if it does not hold.
2. **Where does Wallpaper Engine's editor export dialog default to?** Unknown;
   the watcher's fixed scope (§8, step 5) is designed so the answer changes
   convenience, not correctness.
3. **The one scene package of 225 that has no `scene.json` member.** The
   container read fine; the member is absent. It stays unclassified and routes to
   the video export (§11), which costs only a longer export. One item is a
   bounded gap, not a measured zero.

## 15. Acceptance

- `GET /api/wallpaper-engine` on this machine lists **396** items — 447
  directories, minus 23 presets and 28 with no readable `project.json` — of which
  **15** are web and the rest resolve to video or scene. Zero resolve to image
  here; that path is proven by fixture.
- Every listed item has a `kind`; no listed item has `kind: "unknown"`.
- An image item imports through the asset manager and appears as an asset with
  its bytes unchanged (byte-for-byte comparison).
- A video item under 32 MiB imports through the normalizer and plays in the
  player with `loop` and no audio.
- A video item over 32 MiB is listed with a reason and cannot be imported.
- A scene item starts the flow and never offers "Import".
- The still test returns **true** for a fixture with text, sound, parallax and a
  mouse-interactive layer, and **false** for one with a particle object, an
  animation layer, or a property carrying `animation` keyframes. A
  sprite-animated model in a referenced `models/*.json` also returns false.
- The classifier reports `hasText` for a scene with a text object and omits it
  otherwise; a still scene with text lists the delete-the-text step and one
  without text does not.
- Selecting a scene unpacks and launches without an intervening confirmation, and
  writes every member byte-identically into `projects/myprojects/<workshopId>/`
  beside a `project.json` whose `file` reads `scene.json`.
- Selecting the same scene twice writes nothing the second time, answers
  `reused: true`, and launches the existing project.
- A package whose table runs past the file's end leaves no directory behind and
  answers `unreadable`; a directory that was already there is unchanged
  (byte comparison before and after).
- The sheet's format follows the test: PNG for still, MP4 with 1920×1080, 30 fps,
  5 s, blend 1 s for animated.
- The export routes read only the three scoped directories, and a `name` holding a
  path separator, `..`, or an extension other than `.png` / `.mp4` is refused.
- A preset item is not listed.
- With Wallpaper Engine absent, the Add pane is byte-identical to today's,
  proven by the existing DOM test passing unchanged.
- `credits.json` round-trips through package create → validate → import, and a
  package carrying an undeclared credits file is refused.
- A fixture item whose `project.file` is `.png` resolves to `image` and imports
  byte-for-byte.
- The launch starts `wallpaperui.exe` as a child process on the unpacked project
  and then does nothing further to it — no input is sent after launch and no file
  under the install or library is written (R1). A failed launch is reported, not
  retried silently.

## 16. Measurements, reproducible

```text
workshopcache.json rows                     421
workshop content directories                447
no readable project.json                     28
presets (ispreset)                           23  (typed Scene/Web in the cache)
subscribed scenes                           225
scene.pkg parsed through the container      224 / 225
still at rest (particles, animation     48 / 224 (21%)
  layers and keyframes all absent)
  of those, carrying text                    8
  of those, carrying sound                   6
  of those, no layer effect                   6
  of those, ≥1 layer effect                  42
  scenes failing only on keyframes            5
animated (any of the three)                176 / 224 (79%)
  scenes with a particle system             170
  scenes with animation layers                7
  scenes with a keyframed property           19
  scenes carrying particle, layer,          219 / 224 (98%)
    keyframes, text or an effect
types        scene/scene 188+37, video/video 144+12, web/web 12+3
project.file with an image extension        0 / 447
video wallpapers under 32 MiB                92 / 156 (59%)
video sizes        median 22.2 MiB, max 456.4 MiB, total 7.7 GiB
```

All figures were read from this machine's installed library on 2026-10-21 with
Wallpaper Engine 2.8.42. They describe a sample, not a guarantee.
