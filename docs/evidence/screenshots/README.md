# Visual evidence screenshots

Visual evidence from built bundles; **not** cross-platform pixel baselines.

```bash
cd src/web
npm run build
npm run build:fixture -w @yunari/editor
YUNARI_CAPTURE=1 npx playwright test --project=desktop-chromium --grep "<selected capture title>" --workers=1
```

**A capture that sits beside a drawing is a copy of the file the action wrote, and nothing in the
repo makes that copy.** Every action writes `<name>-<project>.png` into this directory — the
`YUNARI_CAPTURE_DIR` default — and nowhere else; the file beside the drawing is those bytes under
the drawings' own name. Refreshing one is therefore two steps, and the second is manual:

```bash
cp ../../docs/evidence/screenshots/<the action's file> \
   ../../docs/design/mockups/current/<the drawing's file>
```

| Action's file (this directory) | Beside the drawing (`docs/design/mockups/current/`) | Taken at | Surfaces |
|---|---|---|---|
| `editor-shell-add-desktop-chromium.png` | `shell-capture-add.png` | `ec44f99be57336456cf984b4ebb66910fcf38216` | `src/web/packages/editor/src/editor-shell/`, `src/web/packages/editor/src/panes/`, `src/web/packages/editor/src/components/ui/`, `src/web/packages/editor/src/card-library.ts`, `src/web/packages/editor/src/ui-copy.ts` |
| `shell-palette-graphite-desktop-chromium.png` | `shell-capture-graphite.png` | `ec44f99be57336456cf984b4ebb66910fcf38216` | `src/web/packages/editor/src/editor-shell/`, `src/web/packages/editor/src/panes/`, `src/web/packages/editor/src/components/ui/`, `src/web/packages/editor/src/card-library.ts`, `src/web/packages/editor/src/ui-copy.ts` |
| `editor-shell-glyphs-desktop-chromium.png` | `shell-capture-glyphs.png` | `ec44f99be57336456cf984b4ebb66910fcf38216` | `src/web/packages/editor/src/editor-shell/`, `src/web/packages/editor/src/panes/`, `src/web/packages/editor/src/components/ui/`, `src/web/packages/editor/src/card-library.ts`, `src/web/packages/editor/src/ui-copy.ts` |
| `settings-appearance-desktop-chromium.png` | `settings-capture-graphite.png` | `ec44f99be57336456cf984b4ebb66910fcf38216` | `src/web/packages/editor/src/editor-shell/settings.tsx`, `src/web/packages/editor/src/editor-shell/settings-keyboard.tsx`, `src/web/packages/editor/src/editor-shell/icons.ts`, `src/web/packages/editor/src/editor-shell/editor-shell.css`, `src/web/packages/editor/src/components/ui/`, `src/web/packages/editor/src/ui-copy.ts` |
| `settings-appearance-editorial-desktop-chromium.png` | `settings-capture-editorial.png` | `ec44f99be57336456cf984b4ebb66910fcf38216` | `src/web/packages/editor/src/editor-shell/settings.tsx`, `src/web/packages/editor/src/editor-shell/settings-keyboard.tsx`, `src/web/packages/editor/src/editor-shell/icons.ts`, `src/web/packages/editor/src/editor-shell/editor-shell.css`, `src/web/packages/editor/src/components/ui/`, `src/web/packages/editor/src/ui-copy.ts` |
| `settings-keyboard-desktop-chromium.png` | `settings-keyboard-capture-graphite.png` | `ec44f99be57336456cf984b4ebb66910fcf38216` | `src/web/packages/editor/src/editor-shell/settings.tsx`, `src/web/packages/editor/src/editor-shell/settings-keyboard.tsx`, `src/web/packages/editor/src/editor-shell/icons.ts`, `src/web/packages/editor/src/editor-shell/editor-shell.css`, `src/web/packages/editor/src/components/ui/`, `src/web/packages/editor/src/ui-copy.ts` |
| `settings-keyboard-editorial-desktop-chromium.png` | `settings-keyboard-capture-editorial.png` | `ec44f99be57336456cf984b4ebb66910fcf38216` | `src/web/packages/editor/src/editor-shell/settings.tsx`, `src/web/packages/editor/src/editor-shell/settings-keyboard.tsx`, `src/web/packages/editor/src/editor-shell/icons.ts`, `src/web/packages/editor/src/editor-shell/editor-shell.css`, `src/web/packages/editor/src/components/ui/`, `src/web/packages/editor/src/ui-copy.ts` |
| `settings-about-desktop-chromium.png` | `settings-about-capture-graphite.png` | `ec44f99be57336456cf984b4ebb66910fcf38216` | `src/web/packages/editor/src/editor-shell/settings.tsx`, `src/web/packages/editor/src/editor-shell/settings-keyboard.tsx`, `src/web/packages/editor/src/editor-shell/icons.ts`, `src/web/packages/editor/src/editor-shell/editor-shell.css`, `src/web/packages/editor/src/components/ui/`, `src/web/packages/editor/src/ui-copy.ts` |
| `settings-about-editorial-desktop-chromium.png` | `settings-about-capture-editorial.png` | `ec44f99be57336456cf984b4ebb66910fcf38216` | `src/web/packages/editor/src/editor-shell/settings.tsx`, `src/web/packages/editor/src/editor-shell/settings-keyboard.tsx`, `src/web/packages/editor/src/editor-shell/icons.ts`, `src/web/packages/editor/src/editor-shell/editor-shell.css`, `src/web/packages/editor/src/components/ui/`, `src/web/packages/editor/src/ui-copy.ts` |
| `control-set-desktop-chromium.png` | `controls-capture-graphite.png` | `ec44f99be57336456cf984b4ebb66910fcf38216` | `src/web/packages/editor/control-fixture.html`, `src/web/packages/editor/src/control-fixture.tsx`, `src/web/packages/editor/src/components/ui/`, `src/web/packages/editor/src/editor-shell/editor-shell.css` |
| `control-set-editorial-desktop-chromium.png` | `controls-capture-editorial.png` | `ec44f99be57336456cf984b4ebb66910fcf38216` | `src/web/packages/editor/control-fixture.html`, `src/web/packages/editor/src/control-fixture.tsx`, `src/web/packages/editor/src/components/ui/`, `src/web/packages/editor/src/editor-shell/editor-shell.css` |

The two copies of each capture are the same bytes and stay that way; a drawings-adjacent file that
has drifted from its twin is a copy nobody refreshed, not a second render.

**These eleven are the captures this table registers** — the ones placed beside a drawing. The rest
of the directory is registered by the checklist below as an action's output and carries no `Taken at`
and no `Surfaces`; only these eleven are checked.

**The last two columns are the freshness check, and `scripts/capture-freshness.mjs` reads them.**
`Taken at` is the commit the capture was taken at: the commit that last wrote the action's own file
(`git log -1 --format=%H -- <that path>`), which is when the action produced those bytes, not when a
copy moved them. `Surfaces` names the repo-relative paths that produce what the image shows, read per
capture from the spec that writes it and the components the surface composes.

```bash
node scripts/capture-freshness.mjs
```

Exit 0 is every registered capture fresh, 1 is a finding, and 2 is a registry it cannot read — a
missing or malformed table is a finding rather than a silent pass. **It never compares bytes**: two
runs of one capture on one bundle differ in bytes at identical dimensions, so `cmp` would report that
capture stale on every run. A surface path with commits after the recorded sha is the finding, and the
report names the count and the newest commit.

**What the surfaces do not bound.** The three whole-shell captures are viewport frames, so they show
the stage, whose pixels come from the scene renderer rather than from the shell's own source. The
chrome each frame composes is claimed; the stage is not, and a change under `scene-fabric` moves those
pixels while this check stays silent.

Build player and editor first: Playwright previews both built outputs. Use one
worker to avoid capture collisions. Select only captures affected by the current
change and inspect only their generated images. **Player** captures use
`?static=1` and a controlled clock; editor captures use neither, and cannot —
`?static=1` is read only by the player (`packages/player/src/main.ts:66`) and the
editor installs a fixed clock only where a timing window is under test
(`tests/e2e/editor.spec.ts`). After push, prefer the **Visual evidence** Actions
artifact.

`build:fixture` is the design-language parity fixture
(`packages/editor/control-fixture.html`). It is a separate invocation on purpose:
building it inside `npm run build` would ship test scaffolding in the editor's
production output and move `index.html` onto a shared chunk it does not otherwise
need. Run it before any capture or browser run that names the
`design-language-*.spec.ts` specs; without it the ones that mount the fixture
404 and the rest are unaffected.

Pick the project the capture's spec lives in: `desktop-chromium` for the
preview-server captures (editor and player), `desktop-host` for the ones that
drive the real host (the settings page), and `own-host` for the ones that start
their own host on their own port (the publish loop and the invalid-theme boot).

**The parity capture lives beside its drawing.** Spec §13's gate asks for the
surfaces a plan changed to be photographed and placed beside the matching mockup,
so the shell-parity pair is kept in the drawings' own directory —
`docs/design/mockups/current/shell-capture-add.png` (the shell with the Add pane
open and nothing selected, the state `shell.html` draws) and
`shell-capture-graphite.png` (the whole shell in the drawing's own palette) —
and both come from the registered actions above, copied here by the step at the
top of this file: the first from
`captures the shell with the Add pane open and nothing selected`, the second from
`captures each palette's own surface` (the `shell-palette-graphite` file).
**Plan 6's glyph close adds a third to that pair**: `shell-capture-glyphs.png`
is the same state on the drawing's own ground, from `captures the shell glyphs
and words with the Add pane open`.

**Plan 8's captures sit beside the three settings drawings the same way**, one
pair per sheet, all of them copies of `captures the settings modal's three
tabs` (the `settings-appearance` file, with and without `-editorial`).
`settings.html` draws the Appearance panel alone, so
`docs/design/mockups/current/settings-capture-graphite.png` and
`settings-capture-editorial.png` are that panel in the drawing's own palette and
in the light ground a hard-coded hex would show on; `settings-keyboard.html` and
`settings-about.html` are the comparators plan 8 Task 4 added for the modal's
other two panels, so `settings-keyboard-capture-graphite.png`,
`settings-keyboard-capture-editorial.png`, `settings-about-capture-graphite.png`
and `settings-about-capture-editorial.png` are those panels. A PNG beside a
drawing is skipped by the drawings gate rather than parsed — it enumerates
`*.html` (`tests/e2e/mockup-values.ts`'s `currentDrawings`).

**Plans 1 and 3's control-set pair sits beside the controls drawings the same
way**: `docs/design/mockups/current/controls-capture-graphite.png` is the set on
the ground `controls.html` draws (its `#0b0e12` paper, `#72e0c0` accent) and
`controls-capture-editorial.png` the editorial ground `controls-editorial.html` draws
(its `#fffdf7` paper), both the three-panel state the drawn sheets hold, copied
from `the control set renders in the design language` (the `control-set` file, with
and without `-editorial`).

**Which plan each drawing answers for, because the mapping is many-to-many and the per-plan passages above name only some of it.** The design-language spec's eight plans are the control set (1), the shell and rail (2), the inspector (3), the panes (4), settings and appearance (5), iconography and copy (6), shell parity (7) and settings parity (8). `controls.html` and `controls-editorial.html` draw plan 1's set, which plan 3's column is built on; `shell.html` draws plans 2, 3 and 7 at once — its Position, Paint and Spends sections are the inspector's, and it is the drawing both parity plans were pulled to; the three settings sheets draw plans 5 and 8. **Plan 6 has no drawing of its own**, so `shell-capture-glyphs.png` is its evidence and was placed beside the shell. **Plan 4's panes are drawn only where `shell.html` shows the Add one** — Composition, Tokens and Document appear in no drawing, so `pane-composition`, `pane-tokens` and `pane-document` sit in this directory beside no drawing. Nothing above is a claim that a plan's *own* report names its capture; it records which surfaces each image shows.

## Editor visual-action checklist

Update/add a capture when a change affects a listed domain. Show the action's
result, not merely a mounted editor.

| Domain | Visible action | Capture / title regex |
|---|---|---|
| Workspace | Load starter document | `editor` / `captures the mounted editor` |
| Selection/bindings | Select chart; change semantic key/transform | `editor-chart-binding` / `captures selected chart binding controls` |
| Live bindings | Open a bound text document and observe its preview value | `editor-live-text` / `refreshes bound text without saving its sampled value` |
| Live bindings | Select a bound text run, format its value and pin its zone | `editor-text-reads` / `captures the controls that give a text run its reading` |
| Layers/arrange | Select a semantic layer and expose its layer/arrange controls | `editor-layer-arrange` / `captures semantic layer controls` |
| Chart settings | Change family-specific scalar setting | `editor-chart-binding` / `captures selected chart binding controls` |
| Chart creation | Create a chart, read its palette-backed settings, and reopen them | `editor-chart-creation` / `creates a chart with palette-backed settings that save and reopen` |
| Artboard | Change dimensions or preview fit | `editor-artboard` / `captures changed artboard controls` |
| Artboard | Change gradient/literal artboard paint | `editor-artboard-gradient` / `renders palette gradients` |
| Session | Show dirty New/Open confirmation | `editor-dirty-replacement` / `captures dirty document replacement confirmation` |
| Session | Ask New's size before the replacement question | `editor-new-document-chooser` / `captures the new-document chooser's own surface` |
| Open | Valid, invalid or incompatible file | add when changed |
| Open library | Show the editor's theme-library chooser, both groups open | `editor-library-chooser` / `captures the theme-library chooser over a stubbed library` — the spec answers `**/api/themes` with `page.route`, because `openLibrary` awaits `client.list()` before it opens anything |
| History | Save changed document or undo visible drag | add when changed |
| Editor mechanics | Transform/group/duplicate/delete/reorder | `editor-snap-resize` / `snaps a resized object`; `editor-snap-resize-ctrl` / `Ctrl-resizes near a neighbour without snapping or showing a guide`; `editor-toolbar` / `captures the canvas dock over a selected object`; `editor-canvas-context-menu` / `captures the canvas context menu over a selected object` |
| Object tools | Add/edit shape, text, image or SVG | `editor-arc-and-wedge` / `captures an arc and a wedge on the canvas` |
| Right column | Select a card and open its Position section | `editor-inspector-card` / `captures the sectioned column a card gets` |
| Right column | Select a free shape and read its own column | `editor-inspector-shape` / `captures the sectioned column a shape gets` |
| Right column | Select the starter's gauge and read the chart's column | `editor-inspector-chart` / `captures the chart's column` |
| Right column | Read the same gauge column in the reference palette | `editor-inspector-chart-graphite` / `captures the chart's column in the reference palette` |
| Panel authoring | Insert a panel and set its fill, border, radius and shadow | `editor-panel-authoring` / `authors a panel from the Add panel` |
| Glass authoring | Turn frosted glass on for a panel over a real backdrop and set its blur radius | `editor-glass-authoring` / `gives an ordinary panel a real, measured backdrop blur` |
| Starter composition | Select the starter's frosted CPU card and read its live value | `editor-starter-cpu-card` / `ships the starter's frosted CPU card` |
| Starter backdrop | The new document's frosted card over its packaged photograph | `editor-starter-backdrop` / `the starter's frosted card reads a real backdrop` |
| Composition panel | The row's role, mark and bound key, with a card entered | `composition-panel-starter` / `carries the document's binding, and selecting a card and entering it are separate acts` |
| Composition panel | The panel at two hundred loose shapes | `composition-panel-two-hundred` / `two hundred loose shapes, re-measured` |
| Composition panel | The Document pane's own controls over a selected card | `composition-panel-document` / `keeps the document's own controls reachable while a card is selected` |
| Assets | Import, replace and reopen a packaged image | `editor-assets-desktop-chromium` / `imports and round-trips packaged images` |
| Assets | Open the finder on Fonts and read the catalogue body | `editor-finder-fonts` / `captures the finder on Fonts` |
| Assets | Search Icons across two sources and read the mixed grid | `editor-finder-icons` / `captures the finder's mixed icon grid` |
| Assets | Read a source's failure beside the other source's rows | `editor-finder-failure` / `captures the finder's failed source` |
| Assets | Read the Connections tab's provider row | `editor-finder-connections` / `captures the Connections tab's provider row` |
| Assets | Normalize a declared video and read the host's refusal beside it | `editor-video-normalize` / `normalizes a declared video without replacing its master` |
| Assets | Browse this PC's Wallpaper Engine library and read each kind's own action | `editor-finder-wallpaper-engine` / `captures the finder on Wallpaper Engine` |
| Assets | Open a still scene and read the PNG settings and the text step | `editor-finder-scene-still` / `captures a still scene's export sheet` |
| Assets | Open an animated scene and read the five-second MP4 settings | `editor-finder-scene-animated` / `captures an animated scene's export sheet` |
| Palette | Edit or reassign a palette token | `editor-palette-solid` or `editor-palette-reassignment` / `edits an artboard palette token|reassigns palette references` |
| Type presets | Edit, reassign or apply a font trio | `editor-type-preset`, `editor-type-reassignment` or `editor-font-trio` / `edits a global type preset|reassigns text type presets|captures curated font trio` — two files, `-desktop-chromium` (graphite) and `-editorial-desktop-chromium`, because the face and trio choosers are wells whose boundary and popup read against the paper they sit on |
| Background layer | Author a background image in the selection inspector's background column | `editor-background-media` / `authors a packaged background image through the inspector` |
| Viewport | Resize or change zoom | `editor-zoom-readout` / `tracks the camera's zoom in the stage readout` |
| Viewport | Read the same composition at a two-device-pixel ratio | `editor-reference-dpr2` / `the fitted, reference-size and DPR views` |
| Glass authoring | Turn a second panel's treatment on over an already-treated one | `editor-reference-overlap` / `rotated and overlapping panels both keep compositing` |
| Document | Save, reopen and take a New document | `editor-reference-new` / `a new document is the reference composition` |
| Document | Insert, style, glass and bind, then save, close and reopen | `editor-reference-journey` / `insert, style, glass, bind and text survive save` |
| Capture | The picture the thumbnail path produces, at 2x on the library's ground | `editor-reference-capture` / `the capture path shows the glass and the packaged assets` |
| Keyboard | Hover a dock action and read the chord its tooltip names | `keyboard-tooltip` / `every canvas action's tooltip names the chord that runs it` |
| Keyboard | Read the reference sheet, opened with `?` over an entered group | `keyboard-reference` / `? opens the sheet, and the document behind it does not change` |
| Keyboard | Arm a row in the settings modal's Keyboard tab and read its ring | `keyboard-armed-row` / `the Keyboard tab arms a row into the modal's trap, on a ring that clears contrast on every palette` |
| Shell appearance | Choose each of the six palettes and read the surface | `shell-palette-` / `captures each palette's own surface` |
| Settings modal | Open the rail's gear and read each tab, in both palettes | `settings-appearance`, `settings-keyboard`, `settings-about` / `captures the settings modal's four tabs` — six files from one action, each tab in graphite and `-editorial` |
| Shell | Mount the shell with the Add slot open and nothing selected | `editor-shell-add` / `captures the shell with the Add pane open` |
| Panes | Show each of the four rail panes and read its own surface | `pane-composition`, `pane-add`, `pane-tokens` and `pane-document` / `captures each pane of the four-slot rail` — four files from one action |
| Glyphs | Mount the shell with the Add slot open and read every glyph's weight and every icon-only control's tooltip | `editor-shell-glyphs` / `captures the shell glyphs and words` |
| Design language | Mount the control set over the built stylesheet and read it in a panel | `control-set` / `the control set renders in the design language` — two files, `-desktop-chromium` (graphite, the ground the mockup is drawn on) and `-editorial-desktop-chromium` |
| Feedback | Error, notice, disabled action or compatibility message | add when changed |

## Theme store

| Domain | Visible action | Capture / title regex |
|---|---|---|
| Theme store | List the catalogue on the online half and read a cell's kind badge and download count | `store-online-catalogue` / `lists the catalogue, its kind badge and a thousands-separated count` |
| Theme store | Narrow the online grid with a style tag, and read the tag only one item holds | `store-online-facet` / `narrows the online grid, and the tag one item holds is still offered` |
| Theme store | Read a cell's three install answers against the library | `store-online-install-states` / `draws Installed, Update and Install for the library's three cases` |
| Theme store | Read the line naming a kind the catalogue read skipped | `store-online-refusal` / `names the identifier the catalogue declared` |
| Theme store | Open an online item and read its counts and install action | `store-online-modal` / `shows its counts and its install action` |
| Theme store | Press Install on an item the library does not hold, and read the cell after the host answers `ok` | `store-online-install-installed` / `draws the item as Installed once the host answers ok` |
| Theme store | Press Update on an item the library holds at an older version, and read the cell before and after | `store-online-install-updated` / `reads Update before the press and Installed after` |
| Theme store | Read a cell after the host refuses its install | `store-online-install-refused` / `leaves the cell as it was and states the host's reason` |
| Theme store | Submit a library theme with no identity, and read the one-time code and verification link | `store-submit-code` / `signing in shows the host's one-time code and its verification link` |
| Theme store | Read a submitted library theme's pull request link, and the control after it | `store-submit-submitted` / `a submitted theme shows its pull request link and the control no longer offers Submit` |
| Theme store | Read a library theme's surface after the host refuses its submission | `store-submit-refused` / `a refused submission states the host's own sentence` |
| Theme store | Read the version a submission published, and the caption after the library is re-read | `store-submit-version` / `a submitted theme states the version it published, and the caption reads it back` |
| Theme store | Read a remix's credit, for a parent the index lists and for one it does not | `store-remix-credit` / `a remix credits its parent, linking it when listed and naming it when not` |
| Theme store | Turn Mine on and read an unpublished row's name and its state word | `store-mine-listing` / `Mine lists an unpublished item` |
| Theme store | Open a published row and read the Unpublish control before the press | `store-mine-unpublish` / `Unpublish action in the item modal` |
| Theme store | Open an unpublished row and read the Republish control before the press | `store-mine-republish` / `Republish action restores the item` |

The catalogue, the library, `/api/themes/install`, `/api/themes/submit`, both
`/api/github/device` routes, `/api/store/session`, `/api/store/mine` and the
`/api/store/items/:id/unpublish|publish` commands are all answered by
`page.route`, so these sixteen show a routed fixture and not the live origin —
the real catalogue is empty until phase E and the author's own rows need a
deployed Worker. Each cell's picture is a 1×1 PNG served by the fixture at the
panel ground, so the empty picture boxes are the stand-in, not a defect in the
catalogue's thumbnails or their CDN. The three `store-mine-*` files are written
by `src/web/tests/e2e/store-mine.spec.ts`; the rest of the table by
`editor-rail.spec.ts`.

## Settings page (`/settings`, real host)

| Domain | Visible action | Capture / title regex |
|---|---|---|
| Settings scope | Choose a theme whose bindings need a device | `settings-theme-question` / `captures the question a theme raises` |
| Theme library | Save the starter to the library and read the picture the host stored | `host-theme-thumbnail` / `stores the picture the editor captured` |
| Player | Play the saved reference composition at the reference's own size | `player-reference` / `plays the reference composition on the real host` |
| Player | The phone showing the theme the editor has open, after an edit reaches it | `publish-loop-live` / `an edit reaches the display` |

The capture is the whole page, so the Devices and Display sections (including
the units choice) are evidence from the same file.

Mechanics ported from the retired editor fork need captures only when Yunari
changes their rendered outcome. Keep this table aligned with the specs that
carry the captures: `src/web/tests/e2e/editor.spec.ts`,
`reference-theme.spec.ts`, `glass-authoring.spec.ts`,
`inspector-sections.spec.ts`, `composition-panel.spec.ts`,
the `design-language-*.spec.ts` specs and `publish-loop.spec.ts`.
