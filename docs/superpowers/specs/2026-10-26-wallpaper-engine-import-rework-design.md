# Wallpaper Engine import rework — design

- **Date:** 2026-10-26
- **Status:** draft for review
- **Supersedes:** decision [0118](../decisions/0118-a-scene-is-exported-by-driving-the-engine-ui.md)
  (UI-driven mobile export)
- **Amends:** [Wallpaper Engine import design](2026-10-21-wallpaper-engine-import-design.md)
  §8 (the export route)

## Why

The UI-automation export shipped but is slow and unreliable. It clicks
screen coordinates in a CEF window: fixed waits, a 40 s tile hunt with
scrolling, foreground theft, forced maximise/reflow, and a 60 s wait for a Save
dialog whose controls the host's child process cannot reach. The author's Save
click is a platform boundary, not a bug, so the automation can never be
headless and its timing is hostage to the engine's UI.

The owner chose to remove that route. What remains is the part that was never
mechanical: turning a subscribed scene into an **editable local project**, and
turning a `.mpkg` the author exported by hand into a theme asset.

## Goals

1. Remove the UI-automation export completely.
2. Give a scene one action — **convert to local project** — so the author can
   remove or disable a dynamic text element (or a theme that blocks export)
   before exporting manually.
3. Let **Import a file** accept `.mpkg`, extract its video, and import it; a
   package without a video fails in a modal, not silently.
4. Put both workflows in a **guide** reachable from the Wallpaper Engine tab.
5. Present the Wallpaper Engine library as a **card grid**, like the other
   finder tabs.
6. Make every finder load and every card action visibly in progress, finished
   or failed.

## Non-goals

- No UI automation, no engine launch, no export-folder watcher, no Save-dialog
  interaction. Decision 0124 records this boundary.
- No rendering of scene wallpapers inside Yunari.
- No new runtime dependency.

## Requirements

### R1 — Remove the automation

Delete:

- `host/src/wallpaper-engine/export-mobile.ts`, `export-mobile.test.ts`,
  `export-mobile.live.test.ts`
- host routes `POST /api/wallpaper-engine/item/:id/mobile-export`,
  `GET /api/wallpaper-engine/exports`, `GET /api/wallpaper-engine/export`
- `source.ts`'s `mobileExport`, `exportsSince`, `exportBytes`, `harvest`,
  `savedPackageSince`, `exporting`, `HARVEST_MS`, `HARVEST_POLL_MS`
- `unpack.ts`'s `launchEditor`, `startDetached`, `ProjectResult`'s `launched`
- editor `ExportSheet`, `startMobileExport`, `findExports`, `fetchExport`,
  `StartMobileExportAnswer`, `ExportFile`, `EXPORT_POLL_MS`,
  `WallpaperExportOutcome`'s export-specific plumbing, and the
  `onImportExport` prop threaded through session, facade and finder body
- the `ExportFile` type still exported from `unpack.ts`

Keep `readPackage`/`memberBytes`/`mobileVideo`; the import route uses them.

### R2 — Convert to local project

- Scene cards carry exactly one action, **Convert to local project**.
- `source.project(workshopId)` unpacks only and answers
  `{ ok: true, name, reused }`; it never spawns a process.
- A fresh unpack writes `project.json` with `title: "[yunari] <title>"`
  (single space, only when not already prefixed). The directory stays the
  workshop id. A reused project keeps its existing descriptor.
- The card's icon button swaps glyph and tooltip: `FolderInput` "Convert to
  local project" → `LoaderCircle` "Converting…" → `Check` "Converted"; it is
  disabled while running, and its success state persists for the modal session.
- The outcome is announced on the modal's status line, naming the project and
  pointing at Wallpaper Engine's **My Projects**. No sub-page and no success
  dialog.

### R3 — Import `.mpkg` and videos

**Picker.** The Assets pane's two import inputs accept `.mpkg` in addition to
`ASSET_FILE_EXTENSIONS`. `.mpkg` is not added to `ASSET_FILE_EXTENSIONS`: the
manager must keep refusing it as a raw asset, and `.mpkg` is intercepted before
`manager.import`.

**Flow.** Picking an `.mpkg` or a video opens one modal and runs it
automatically:

1. Send the file to the host, which extracts (`.mpkg` only) and normalizes in
   one call. A conforming video returns byte-identical (`reencoded: false`).
2. Import into the document.

Images and fonts keep today's direct path; only video-shaped picks use the
modal.

**Source size vs output size.** The 96 MB ceiling is the **theme envelope on
what is imported**, not a limit on what the author may pick. A source video or
package may be larger; the host accepts up to **512 MiB of source**, and the
normalizer's capped-CRF ladder keeps a 30 s loop under the 96 MB output ceiling.
The host refuses a normalized output that still exceeds 96 MB rather than
importing an asset the package writer would refuse.

**Host routes.** Both take the source as a **raw binary body**
(`application/octet-stream`), under one large-body slot, with loopback +
same-origin guards:

- `POST /api/wallpaper-engine/mpkg` — reads the package, extracts
  `wallpaper.mp4` with `mobileVideo`, normalizes it, and answers
  `{ ok: true, videoBase64, reencoded, title?, workshopId? }` where `title` and
  `workshopId` come from the package's `project.json` member. It answers
  `{ ok: false, message }` for a malformed table, a missing/empty video, or a
  package that is not a Wallpaper Engine container. It needs no Wallpaper
  Engine install.
- `POST /api/themes/normalize-video` — the existing route, changed from base64
  JSON to a raw binary source so the 512 MiB source cap is reachable. It keeps
  its JSON answer (`{ ok, bytesBase64, reencoded }` / `{ ok: false, message }`).

Both return only the normalized video (≤96 MB), never the extracted source, so
a large package crosses the wire once.

**Modal states.** `preparing → importing → done | failed`, where *preparing*
reads "Extracting and preparing the video…" for an `.mpkg` and "Preparing the
video…" for a video file. The modal shows a skeleton/progress block and, on
failure, stays open with the host's own sentence. A dismissed modal imports
nothing.

**Assets pane.** The manual `Normalize video` button, its preview and its
use-normalized confirmation are removed; the modal replaces them. Picking a
video with either import button runs the same modal and still sets the
background on success.

**Wallpaper Engine tab.** A second button, **Import a .mpkg video**, opens the
same modal scoped to `.mpkg`, and on success sets it as the theme's background.

### R4 — Attribution and credits

- `AssetManager.import(file, metadata?)` accepts optional
  `{ sourceUrl?, license? }` and writes them on the declaration; no other
  import path passes metadata.
- Wallpaper Engine grid import sets `license: { name: "unknown" }` and
  `sourceUrl` = workshop URL when known, else the Steam profile URL derived
  from the Steam id. The preview modal's Attribution pills then stop reading
  **None recorded**.
- A picked `.mpkg` sets `license: { name: "unknown" }` and no source: the
  package carries neither a workshop id nor an author.
- Grid imports keep `creditsEntryOf`. When the item has an author Steam id,
  the editor resolves the persona name before writing the credit:
  `GET /api/wallpaper-engine/author/:steamId` → `{ name? }`, host-fetched from
  `https://steamcommunity.com/profiles/<id>/?xml=1`, parsed for `<steamID>`,
  cached in memory per id, 5 s timeout. A refusal or timeout omits `author.name`
  and never fails the import. A non-numeric id is refused before any request.
- `.mpkg` imports write a credit titled from the package's `project.json`
  (`[yunari]`-prefixed title if the author converted first), license
  `unknown`, no source, no author.
- Regression: a grid video import must produce both the theme credit and the
  asset attribution in the built app. The owner observed `Attribution: None
  recorded` for every such video; the repro is a test before the fix is
  trusted.

### R5 — Wallpaper Engine tab

- The body renders a card grid using the finder's geometry
  (`grid-cols-[repeat(auto-fill,minmax(140px,1fr))]`), each card shaped like a
  font tile: preview box, title, `kind · size`, source line where present, and
  **one action as a lucide icon button**, not a text button. A card grid has no
  room for a full sentence beside every tile.
- The icon button carries the action's full name as its accessible label and
  hover/focus tooltip (`ControlIconButton`'s existing tooltip):
  - video: `Wallpaper` icon, "Set as background";
  - scene: `FolderInput` icon, "Convert to local project".
- Running, success and failure swap the glyph and the tooltip:
  `LoaderCircle` + "Setting…"/"Converting…" while running, `Check` +
  "Background set"/"Converted" on success, `TriangleAlert` + the failure
  sentence on failure. The button is disabled while running; the success state
  persists for the modal session.
- Kind filters are **all / video / scene**. `image` and `web` leave the client
  kind union, copy, branches and tests; `library.ts` already skips web items
  and never classifies an image.
- A **Guide** button opens a modal with two sections:
  1. *Why convert to a local project* — what an unconverted scene cannot do,
     how to open the converted project in Wallpaper Engine, and where to remove
     or disable a dynamic text element.
  2. *How to export a `.mpkg`* — select the scene/project → right-click →
     **Send to Mobile Device** → **Export .mpkg** → **Keep original aspect
     ratio** → **Original** → Save, then use **Import a .mpkg video** here.
- Every card action reports on the modal's bottom status line (one
  `role="status"`), so a slow import is never silent.

### R6 — Loading skeletons

A shared presentational skeleton for the finder:

- card-shaped placeholders (pulse) for grid bodies;
- a text/row skeleton for list bodies;
- `aria-busy` on the region and one visually hidden loading sentence;
- `motion-reduce:animate-none` and no animation when the user prefers reduced
  motion.

Apply on first load and on a search that has no prior results to keep:
the finder's source listing, the grid search, the Wallpaper Engine fetch, and
the Fonts body. Pagination keeps existing results on screen with `aria-busy`.

## Architecture and ownership

| Concern | Owner | Change |
|---|---|---|
| `.mpkg` bytes → normalized video + metadata | `host/src/wallpaper-engine/pkg.ts`, new route in `server.ts` | extraction + normalization in one call over the existing table walk |
| Video source → normalized video | `src/themes/normalize-video.ts`, its route in `server.ts` | raw binary source, 512 MiB cap, unchanged output ceiling |
| Unpack a scene | `host/src/wallpaper-engine/unpack.ts` | title prefix; no launch |
| Steam author name | `host/src/wallpaper-engine/source.ts` + `server.ts` | fetch + cache + route |
| Library listing | `source.ts`, `library.ts` | no export members; kinds unchanged |
| Editor HTTP shapes | `editor/src/wallpaper-engine/client.ts` | remove export calls; add mpkg + author |
| Video pick flow | new `editor/src/panes/assets/import-video-modal.tsx` | state machine + presentation |
| Assets pane entry | `panes/assets/assets-pane.tsx` | accept `.mpkg`; route video picks; remove normalize section |
| WE tab | `asset-finder/wallpaper-engine-body.tsx` | cards, filters, actions, status line, guide trigger, mpkg button |
| Guide | new `asset-finder/wallpaper-engine-guide.tsx` | two static sections in a dialog |
| Skeletons | new `asset-finder/skeleton.tsx` | shared by all finder bodies |
| Credits and declarations | `editor-session.ts`, `asset-manager/index.ts` | metadata at import; author name; mpkg credit |

The editor never parses a package: the host owns the container. The host never
imports a theme asset: the editor owns the document.

## Failure modes

| Cause | Answer |
|---|---|
| Not a `PKGV`/`PKGM` table | modal: the package could not be read |
| `PKGM` without `wallpaper.mp4` | modal: no video in this package |
| Upload over 512 MiB of source | modal: source too large to import |
| Normalized output still over 96 MB | modal: the video exceeds the theme envelope |
| Normalizer refuses | modal: the host's own sentence |
| Asset manager refuses | modal: the manager's sentence |
| Steam lookup fails | import continues; credit carries `author.steamId` only |
| Convert fails | status line names `no-install` / `unreadable` / `refused`; the button returns to idle |
| Reused project | button shows `Converted`; status line says it already existed |

## Verification

- **Unit (host):** mpkg route guards (405, 403 loopback, 403 foreign origin),
  512 MiB source cap, valid `PKGM`, missing video, malformed table, metadata
  from `project.json`; a source over 96 MiB whose normalized output fits is
  accepted; a normalized output over 96 MiB is refused; author route with
  injected fetch: name, timeout, refusal, invalid id, cache; `project` returns
  no `launched`; fresh unpack prefixes the title once; reuse leaves the
  descriptor alone.
- **Unit/DOM (editor):** picker routes `.mpkg` and video to the modal and keeps
  images/fonts direct; modal step order and every failure; `.mpkg` never reaches
  `manager.import`; credits and declaration metadata for grid and `.mpkg`
  imports; card grid, icon-only actions with tooltips, filters, guide text,
  button glyph/tooltip states, status line; skeletons present on first load and
  absent once data arrives; `aria-busy` during pagination.
- **Regression:** with the author-name fetch stubbed to fail, the credit still
  lands; with attribution removed, the preview pill test fails.
- **Browser:** one Playwright pass over the WE tab using the fake source: cards
  render previews, filters reduce the grid to video/scene, the guide opens,
  action states are visible, and the status line text changes. The host route
  is exercised by its own request tests; no test starts Wallpaper Engine.
- **Gate:** `npm run gate` exit code recorded; docs checks
  (`npm run docs:check`, `npm run status:check`).

## Documentation and decisions

- New `docs/decisions/0124-<slug>.md`: the engine is never driven; Yunari
  converts and the author exports. Supersedes 0118 and the R1 clause of 0097.
- Update `2026-10-21-wallpaper-engine-import-design.md` §8 to the shipped
  route, and remove its UIA claims.
- Update any `docs/evidence` or walkthrough that presses the export button.
- `STATUS.md` names the implementation plan while it runs.

## Risks

- **512 MiB source cap, buffered:** a source larger than that is refused; the
  buffered body plus ffmpeg's temp file is the memory cost. The normalized
  output ceiling is unchanged at 96 MB. If real exports exceed 512 MiB, the next
  step is streaming the body to a temp file, not raising the cap again.
- **Steam lookup is the only outbound request this feature adds.** It is
  per-import, cached, timed out, and never blocks the import.
- **Guide text is static.** Wallpaper Engine can rename a menu item in a future
  release; the guide is documentation, not automation, so a stale label costs
  a sentence rather than a broken run.
