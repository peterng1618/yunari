# Ownership map

Canonical map of which module owns each cross-cutting concept. Check this before
adding a new owner, parallel abstraction, registry, persistence path or manager.
If implementation moves an owner, update this map in the same change.

**A concept has exactly one owner, and the owner's membership is not a second
module's decision.** Naming a member to *read* it — `IDS[0]`, `for (const id of
IDS)`, a type derived from it — is a consumer, and the rule working. Re-spelling
the set, or a subset of it, somewhere else is a **second owner**, and it fails
quietly: the two agree until someone adds a member, and then the new one is
simply never seen by whoever re-spelled it. That is not drift and is not fixed
by making one list read the other; it is fixed by deleting the second decision.

**This map is the first half of that rule, and a gap in it is a hole in the
rule.** A module that owns a vocabulary but appears nowhere below is invisible
here, so nothing warns a reader not to decide the membership elsewhere —
`object-actions.ts` was exactly that, and the Arrange menu picking two of its
eight actions is what it cost. **If you add a module that owns an enumeration,
add the row in the same change.**

`npm run ownership:sweep` checks the rule mechanically and reports candidates,
not verdicts. **It reads one shape of vocabulary and only one**: a `const` array
or a `Readonly<Record<…>>` of three or more kebab-case ids, re-spelled by two or
more of them in a module outside the owner's own directory. A vocabulary written
any other way — a `type` union, or ids joined by dots rather than hyphens — is
invisible to it, which is a different blind spot from the module that exports no
vocabulary at all, which the copy-path paragraph below records.
**Adjudicate every hit** — a consumer and a second owner look the same to it, and
roughly half of what it finds is a consumer. Its self-test runs in
`npm run gates:self-test`.

## Uniqueness is necessary, not sufficient

**One owner does not mean the right owner.** A row can be perfectly unique and
still be shortsighted: `panel.ts` can faithfully enforce a rule that ought to live
somewhere else, and nothing above will notice, because the sweep proves
*uniqueness* and says nothing about *correctness*. **A green sweep is a warrant
for one decider, not for this decider.** As features grow, the assignments made
early are the ones most likely to have been made without the whole architecture
in view.

So the two questions are separate and both are real:

| question | who answers it |
|---|---|
| Does this concept have exactly one decider? | `npm run ownership:sweep` — mechanical, in the gate |
| Is that decider the right one? | **a person, reading.** No script can answer it |

`scripts/ownership-enforcement.mjs` is a starting point for the second question
and **is deliberately not wired into any gate**: it takes each concept's
distinctive words and reports the modules the map does not name, which flags 77
of 92 rows. In this codebase a concept's vocabulary and its enforcement are the
same words — `glass.ts` says `fill` and `shadow` because it paints things — so
presence cannot separate an owner from a consumer. **A gate that flags 84% of
rows trains people to ignore it.**

**What would actually answer it, and is enumerable by hand:** for each row, find
the code that would *reject* a wrong value for that concept — the guard, the
validator, the `refuse` — and ask whether it lives in the module the map names.
A guard in an unnamed module is a missing row or a wrong owner, and telling those
two apart is the judgement the map cannot make for itself.

## Editor

| Concept | Owner |
|---|---|
| Canvas mount/disposal, artboard paint | `editor/src/editor-shell.ts` |
| **Which displays a theme can be seen through** — their ids and aspect ratios, and the screen rect one becomes | `editor/src/display-lens.ts` |
| The stage camera — zoom, pan, framing, and the lens it frames through | `editor/src/viewport-manager/` |
| **The editor's own fit** — the author framed to the display's screen rather than to the host: its own containment and centring, a rule of its own rather than the renderer-core one, and the one place its refusals live (a board with no frameable area refused as `computeArtboardTransform` refuses it) | `editor/src/viewport-manager/` |
| `EditorInteraction` contract consumed by product panels | `editor/src/editor-interaction.ts` |
| Text creation | `editor/src/text-manager/` |
| Image import | `editor/src/image-manager/` |
| Generic canvas stack order | `editor/src/layer-manager/` |
| Object lock/unlock | `editor/src/object-lock-manager/` |
| Scene undo/redo history | `editor/src/history-manager/` |
| Editor session composition and disposal | `editor/src/editor-session.ts` |
| **The document a session edits** — the authored theme envelope, every write to it and the fan-out each write makes, the picture a save ships, and the package's own file protocol: new, open, save, release and replacement | `editor/src/editor-document.ts` |
| **A globals edit reaching every consumer** — the one `#globalsChanged` fan-out every palette and type-preset setter and deleter goes through, so a consumer cannot be dropped by not being edited | `editor/src/editor-document.ts` |
| Product shortcuts | `editor/src/shortcut-manager/` |
| Theme download | `editor/src/persistence-manager/` |
| **The stored-document base and the library save protocol** — what a save carries, and the conflict it can be refused on | `editor/src/theme-library-manager/` |
| Chart selection/settings/bindings — projected by `panel.ts`, rendered by `chart-fields.tsx`, written by `index.ts` | `editor/src/chart-manager/` |
| **The plan-and-player artboard-to-viewport transform** — contain/cover scale, letterbox bars, cover crop; the editor's case is a separate rule, above | `renderer-core/src/artboard.ts` |
| Theme metadata — **the Document pane's authoring controls** | `editor/src/panes/document/metadata-fields.tsx` |
| Artboard size, presets and the size note — **the Document pane's authoring controls** | `editor/src/panes/document/artboard-fields.tsx` |
| **The background layer's authoring** — its colour (the letterbox fill under `theme` bounds, and the no-media fill otherwise), media, bounds, offsets and horizontal/vertical flips, described by its inspector column and written through `EditorDocument.setBackground`; the media is always `cover`, so there is no fit or scale | `editor/src/selection-inspector/background-column.ts` |
| Semantic layer projection | `editor/src/editor-shell/layer-tree.ts` |
| **Which object and arrange actions exist** — their ids, labels and icons | `editor/src/object-actions.ts` |
| **Which of a manager's refusals a menu advertises** — eligibility as the hand-kept agreement with each manager's own refusal, now checked by a witness that drives both | `editor/src/object-actions.ts` |
| **The chrome glyph vocabulary** — the one icon family, the one weight rule, and the named glyphs the shell and the panes draw | `editor/src/editor-shell/icons.ts` |
| Applying an arrange action to a multi-selection | `editor/src/arrange.ts` |
| Palette-token authoring and reference reassignment | `editor/src/palette-manager/` |
| New-object defaults (text, charts, shapes) and the shape list | `editor/src/new-object-defaults.ts` |
| **The card units a document can be built from, and what they are called** — the card vocabulary and its names | `editor/src/card-library.ts` (`CARD_LIBRARY`) |
| **The tags an author picks from before a catalogue answers** — the offline style vocabulary, which a reachable catalogue replaces rather than extends | `editor/src/theme-tag-seed.ts` (`THEME_TAG_SEED`) |
| The Add panel's construction actions | `editor/src/new-object-panel.ts` |
| Shape material fields (fill, stroke, border, shadow, radius) and each shape's own geometry | `editor/src/selection-inspector/panel.ts` |
| **Which sections a selection gets** — the questions a kind is asked and the order they are asked in, total over every selection kind by construction | `editor/src/selection-inspector/per-kind-column.ts` |
| **The refusal a document edit earns** — stale, locked, unknown or invalid, decided before anything is written | `editor/src/selection-inspector/view.ts` (`editRefusal`) |
| Frosted-glass control (enable, blur radius), and which subjects are offered one at all | `editor/src/selection-inspector/glass.ts` |
| Glass lifecycle re-resolve, asked for by that control | `editor/src/editor-shell.ts` (`EditorShell.refreshGlass`) |
| **Which bindings resolve** — the ones whose source has left the document, dropped on load | `editor/src/editor-shell.ts` (`dropDanglingBindings`) |
| Type-preset authoring and reference reassignment | `editor/src/type-preset-manager/` |
| Open-package asset bytes and controls | `editor/src/asset-manager/` (`index.ts` bytes), `editor/src/panes/add/file-section.tsx` (the pane) |
| **Whether an asset is still referenced** — the reference that decides a deleted asset can go, and the walk a binding's own resolution reads with it | `editor/src/asset-manager/index.ts` (`assetReferencedBy`, `sceneObjects`) |
| **Shared colour parsing** — hex, rgba and hsva conversion, and the refusal that returns `undefined` for a value that is not a colour | `editor/src/components/ui/colour-maths.ts` |
| Editor runtime binding refresh | `editor/src/live-runtime.ts` |
| v2 parsing/file boundary | `editor/src/persist.ts` |
| Structured editor diagnostics | `editor/src/error-manager/` |
| Selection and rotation handle styling, and what its own handles write — a Line's four scalars (`x1`/`y1`/`x2`/`y2`) with the Shift-snap constraint, and the authored text-box height | `editor/src/controls-manager/` |
| Active-object and selection deletion | `editor/src/deletion-manager/` |
| OS clipboard copy/cut/paste/duplicate | `editor/src/clipboard-manager/` |
| Group and ungroup | `editor/src/grouping-manager/` |
| **Entered-group reachability** — the `selectable`/`evented` a group writes on every object outside it, and the values it restores on exit | `editor/src/grouping-manager/` (`applyReachability`, `restoreReachability`) |
| Canvas dock (former floating toolbar) — the object actions alone, filtered to what the selection can run (`vg-463` moved the eight arrange actions out) | `editor/src/editor-shell/canvas-dock.tsx` |
| Selection snapshot, the document's identity and dock eligibility, and the layer writes: `name`, `visible` and the lock, plus the move — the restack and the reparent, which Fabric's own group math performs (`vg-461`) | `editor/src/editor-shell/bridge.ts` |
| **The block the column leads with, under the subject** — the arrange actions for a multi-selection and the reason a subject is offered no frosted-glass section, with its own closing edge | `editor/src/selection-inspector/selection-lead.tsx` |
| Selection geometry, appearance, runs and text layout | `editor/src/selection-inspector/` |
| Authoring-time value-run tokens | `editor/src/run-placeholder.ts` |
| The languages an author may pick | `editor/src/theme-languages.ts` |
| Which theme a host displays | `host/src/settings/active-theme.ts` |
| The consumer's clock zone | `host/src/settings/display.ts` |
| Theme thumbnails — store, location in the theme folder, and route | `host/src/themes/thumbnails.ts` |
| **The id an imported package lands under** — the slug, the suffix ladder, and the additive rule that never overwrites a theme already there | `host/src/themes/import.ts` |
| Thumbnail capture in the editor | `editor/src/thumbnail-capture.ts` |
| Shell chrome, rail and panes — the composition root: the persistent host nodes it builds and the `ShellLayout` API it returns | `editor/src/editor-shell/shell-layout.tsx` |
| **The header's File, Edit and View menus** — the menubar and the Edit menu's own row table | `editor/src/editor-shell/shell-menu-bar.tsx` |
| **The shell state the imperative session writes and React subscribes to** — the selection snapshot, the `?` sheet and the publish surface, each a store of its own | `editor/src/editor-shell/shell-stores.ts` |
| **The host's publishing answer** — whether the LAN is on, the pairing credential, a refusal and a pending toggle, read and toggled in one place | `editor/src/editor-shell/hosting-store.ts` |
| Shell palette | `editor/src/editor-shell/palette.ts` |
| Drag-time snapping and smart guides | `editor/src/snap-manager/` |
| Rotation-angle and size indicators | `editor/src/indicator-manager/` |
| Per-image crop session | `editor/src/crop-manager/` |
| Imported and rehydrated image pixel bound | `editor/src/image-manager/` |
| **What a fresh object id looks like** — sanitising, truncation, and the `-N` bump past ids already in the document | `renderer-core/src/theme/widget.ts` (`createWidgetIdAllocator`) |
| **Minting a new identity for one object** — choosing the prefix that says what kind of thing it is | the manager that creates the kind (`text-manager`, `chart-manager`, `image-manager`, `grouping-manager`, `new-object-panel`) |
| **Minting ids for a *copy*** — object ids and binding ids together, minted past the destination | `renderer-core/src/theme/widget.ts` (`createWidgetIdAllocator`), used by `editor/src/card-library.ts` and `editor/src/clipboard-manager/` |
| **The store surface** — the four things a cell can do and which of them a build runs, the five facets' filter rules, the query, the pager's page arithmetic, and the item's own surface | `editor/src/store-mode/` |
| **The Host mode's surface, and the editor's seam to the host's settings** — the settings page rebuilt in React, and the routes it reads for this PC's devices, a display's preferences and one theme's answers | `editor/src/host-settings-mode/` |

**The copy path and the fresh-object path are one job, not two, and only the copy
path has been folded in.** "A copy is a copy, not a twin" needs an id the
destination does not hold; "a new object needs an id" needs the same thing. The
seven creation sites still each inline a prefix plus a `randomUUID`, which is the
*shape* of the policy without its substance — no truncation, no sanitising, no
knowledge of what the document already holds, so a collision is possible and
silent. `ownership:sweep` cannot see this: none of the seven exports an id
vocabulary, each inlines a string literal, and the sweep reports re-spelled
vocabularies. Fold them in when a creation site is next edited.

### Packaged fonts

`renderer-core/src/theme/` owns font-face declarations and preset validation;
`editor/src/font-catalog.ts` and `editor/src/font-preview.ts` own curated
metadata and transient previews; the existing type-preset/asset boundaries own
adoption; `scene-fabric/src/font-assets.ts` owns loaded-face lifecycle. The UI
adapter does not own catalog, preview or adoption semantics.

## Ownership registry

### Shared/domain

| Concept | Owner |
|---|---|
| Samples/status | `renderer-core/src/types.ts` |
| Live presentation buffer | `renderer-core/src/data/live-source.ts` |
| Theme semantic types/validation | `renderer-core/src/theme/` |
| **What a theme *is*, read off its envelope rather than authored into it** — the colour-mode vocabulary, the aspect buckets and their tolerance, and the sensor readings and style tags the store's five facets filter on; the one layer the host's listing and a catalogue Action can both import | `renderer-core/src/theme/facet-record.ts` |
| **Listing the document's tokens by name** — one function in the token owner, each caller passing its own filter, and the raw ref returned only for a token the author deleted | `renderer-core/src/theme/` (`paletteTokenOptions`) |
| **The catalogue index's wire shape** — what `index.json` carries, what a malformed entry refuses with, the authored `item.json` header the generator reads, and the one kind identifier the generator and the editor's client must agree on | `renderer-core/src/theme/catalogue-index.ts` |
| **Where the store lives, and the URLs built from it** — the one catalogue origin and the index, item, package and thumbnail builders every client reads, so pointing the product at another store is one edit; the backend serving those paths | `renderer-core/src/theme/catalogue-location.ts`; `store-worker/src/` |
| **The catalogue id's shape** — `isCatalogueId`/`CATALOGUE_ID_PATTERN`, and the copy the store's own `.github/workflows/auto-merge.yml` carries because a workflow cannot import it | `renderer-core/src/theme/catalogue-index.ts` |
| The authored `yunariGlass` treatment and its bounds | `renderer-core/src/theme/glass.ts` (DOM/Fabric-free; rendering lives in `scene-fabric/src/glass.ts`) |
| Theme ZIP layout and bounds | `theme-package/src/` |
| **The version ladder** — the change classifier, the ignored fields and the bump arithmetic the host's submit and the catalogue CI both apply | `theme-package/src/version-ladder.ts` |
| Published development schema | `schema/theme-document.schema.json` |
| Wire protocol | `renderer-core/src/data/protocol.ts` |
| Semantic sensor keys | `renderer-core/src/data/semantic-keys.ts` |
| Chart setting descriptors | `renderer-core/src/charts/` |
| **The one-paint-per-chart-series rule** — a series' paint array, and the rejection or repair of a wrong one, held at the descriptor owner rather than by one consumer | `renderer-core/src/charts/` (`seriesPaintFor`, `carriedPaintFor`) |
| **What a valid object name is** — the emptiness and length rule two rename writers must agree on | `renderer-core/src/theme/object-name.ts` (`isObjectName`) |
| **The shape an asset path must have** — the pattern it must match, hand-spelled a second time outside this module | `renderer-core/src/theme/document.ts` (`ASSET_PATH_PATTERN`) |
| Provider contract | `host/src/providers/provider.ts` |
| **The product's version** — one number for the host CLI and the editor bundle alike, in the manifest a release already edits; the host reads it at run time and the editor's bundle is given it by Vite's `define` (`vg-279`) | `src/web/package.json` (`version`) |

### Fabric renderer

| Concept | Owner |
|---|---|
| Pure frame planning | `renderer-core/src/scene/plan.ts` |
| ScenePlan reconciliation | `scene-fabric/src/adapter.ts` |
| Canvas/artboard mount | `scene-fabric/src/scene.ts` |
| **The background layer's DOM media** — the `<video>`/`<img>` beneath the canvas, its theme/display bounds, its cover placement with offsets bounded by the overhang, its paint-time flips, and the re-placement that does not restart playback | `scene-fabric/src/background-media.ts` |
| Backdrop-glass composition, and its attach/dispose lifecycle | `scene-fabric/src/glass.ts` (editor Canvas and player StaticCanvas share it) |
| **What a panel samples** — the artboard's paint composed *under* its media, and the board rect a gradient is mapped to (0080) | `scene-fabric/src/artboard-backdrop.ts`, with the paint's third output form in `scene-fabric/src/artboard-paint.ts` |
| Scene serialization/revival | `scene-fabric/src/persist.ts` |
| `YunariChart` lifecycle | `scene-fabric/src/chart-object.ts` |
| Chart repaint cadence | `scene-fabric/src/chart-refresh.ts` |
| Chart backing limits | `scene-fabric/src/render-scale.ts` |
| ECharts registration | `scene-fabric/src/chart-engine.ts` |
| Fabric node updates | `scene-fabric/src/fabric-nodes.ts` |
| Text runs | `scene-fabric/src/text-runs.ts` |
| The authored text box (`yunariText.box`) — its two dimensions, and the one write every geometry surface shares | `scene-fabric/src/authored-box.ts` |
| Image/SVG | `scene-fabric/src/fabric-image.ts` |
| Paint conversion | `scene-fabric/src/paint.ts` |
| **Which objects point at a token** — the walk a token delete and a swap both read | `scene-fabric/src/palette-references.ts` |
| **What persists** — the scene properties a save carries, and which of an object's state is authored: `locked` is authored state and persists, and the transform flags beside it are re-derived from it rather than persisted (0083); whether `selectable`/`evented` are authored is a separate question the lock path does not answer | `scene-fabric/src/persist.ts` (`SCENE_PERSISTED_PROPERTIES`) |
| **Whether an object is locked** — the one `locked` predicate, a Fabric fact rather than lock policy, so no reader reaches up to a manager for it | `scene-fabric/src/object-lock.ts` (`isLocked`) |
| **Which collection holds an object** — the one `holderOf` helper for the owning collection (or the canvas, never the `undefined` a caller had to patch with `?? canvas`) and `targetsOf` for an `ActiveSelection`'s members | `scene-fabric/src/object-holder.ts` (`holderOf`, `targetsOf`) |

### Host

| Concept | Owner |
|---|---|
| CLI flags | `host/src/cli/args.ts` |
| HTTP routing | `host/src/server.ts` |
| Declared package-asset HTTP reads | `host/src/server.ts` |
| **The host's first-run page, and the route that serves it** — the page a fresh install reads | `host/src/server.ts` (`firstRunPage`) |
| Static-path safety | `host/src/serve/static-path.ts` |
| SSE connection/keep-latest | `host/src/transport/` |
| Provider scheduling/failure isolation/fallback | `host/src/providers/registry.ts` |
| Device assignment and display names | `host/src/settings/devices.ts` |
| A theme's own device answers | `host/src/settings/theme-settings.ts` |
| Which catalogue item and version a theme was installed from, and whether it is still held | `host/src/settings/theme-origins.ts` |
| **The catalogue's generated index** — reading a catalogue directory, refusing an item by its own field name, and writing `index.json` deterministically | `host/src/catalogue/` |
| **The published bytes a submit bumps its version from** — reading the theme's document and package against the authenticated store baseline before the ladder computes the next version | `host/src/themes/submission.ts` (`submissionFiles`) |
| Which device slots a theme needs | `host/src/settings/required-devices.ts` |
| Which host an app folder is — the id a display re-finds it by, and the name it shows | `host/src/settings/host-record.ts` |
| Whether a host already holds an app folder | `host/src/settings/host-lock.ts` |
| Device-assignment resolution handed to providers | `host/src/server.ts` (`currentAssignment`, resolved per display in `tick`) |
| Clock/date provider | `host/src/providers/clock.ts` |
| Instant reading, offsets and the zone list | `renderer-core/src/scene/datetime/instant.ts` |
| The author's date/time format tokens | `renderer-core/src/scene/datetime/format.ts` |
| Locale-spelled month, weekday and day-period names | `renderer-core/src/scene/datetime/names.ts` |
| Measurement conversion for display, and which families convert | `renderer-core/src/scene/measurement.ts` |
| The preference a display reads at load | `player/src/theme-loader.ts` (`loadDisplayPreferences`) |
| The display's own chrome — the strips it is told by, and the room they take from the artboard | `player/src/chrome.ts` |
| Consumer device-selection page | `host/public/settings.html` |
| The theme chooser the dashboard falls back to | `host/public/library.html` |
| A saved theme as one row in a list, and the host pages' chrome | `host/public/theme-list.js`, `host/public/yunari-page.css` |
| LibreHardwareMonitor provider, tree and key mapping | `host/src/providers/lhm*.ts` |
| LHM launch and elevation reporting | `host/src/providers/lhm-launcher.ts` |
| systeminformation-backed baseline provider | `host/src/providers/library.ts` |
| LAN display sessions and pairing | `host/src/session/pairing.ts` |

## Known ownership gaps

Establish one owner when these become active work:

- stale-reading visual treatment under Fabric.

Legacy behaviour candidates such as advanced snapping remain review-only in the
[editor behaviour review](../superpowers/specs/2026-09-24-editor-behaviour-review.md).
