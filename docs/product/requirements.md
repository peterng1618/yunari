# Yunari — product requirements

Canonical current product requirements. User goals and explicit product choices take
precedence. `§N` markers are stable labels used by code/docs; never renumber.

## Goals

1. Show the PC's live state on a phone over local Wi-Fi without internet.
2. Design dashboards visually in a desktop browser, not by editing JSON.
3. Treat charts and typography as first-class product features.
4. Personal use first; optimize development speed over release polish.
5. Never show a number that was not measured.

## Non-goals

Wireless wake-up · multiple pages per device · arbitrary theme scripts ·
USB/serial displays · building a general-purpose graphics editor · animated GIF
elements · formula-driven styling · OAuth flows · mutation requests.

## §7 — Product and scope

Windows-first PC-hosted dashboard editor/player. Local metrics work without
internet; remote API/weather sensors use their endpoints. V1 supports
bitmap/SVG artwork, one video background, basic shapes, charts and rich
text/typography. Decorative drawing must not delay charts or typography.

## §31 — One renderer, shared

Editor and player use one Fabric scene implementation. `@yunari/editor` owns
interactive editor mechanics directly over the pinned `fabric/es` runtime; do
not maintain a second DOM/geometry renderer or an external editor foundation.

## §32 — Prefer Fabric-native substitutions

If exact old behaviour requires disproportionate custom integration, choose a
reasonable Fabric-native/editor-native outcome while preserving correctness,
persistence, security and accessibility invariants.

## §33 — Nothing is done until observed

Code/library claims are hypotheses. Visible changes require browser/rendered
verification plus appropriate tests. State what was not verified.

## §35 — Application shell

The editor shell migrated to React 19 over Base UI with Tailwind (2026-09-24):
header menus, rail plus pane bar, and a canvas dock, over the
unchanged imperative Fabric boundary in `mountEditorShell`. The player and host
keep their own UIs.

Fabric remains imperative behind an editor/controller boundary. Do not mirror
Fabric objects declaratively. Editor-shell theming is separate from authored
dashboard theme globals.

Each frontend package keeps its visible copy in a typed `ui-copy.ts`: labels,
dialogs, notices and user-facing errors, excluding authored theme text,
telemetry values and developer errors. The editor and player are migrated;
host/player shell styling is not. Multiple locales are not in scope for product UI copy; a theme declares the language its own text is written in.

## §43 — Feasibility

Fabric rendering is established for text, images/SVG, basic shapes and all four
chart families. `YunariChart` supports rotation, proportional resize, live
redraw and persistence. Video remains a separate background path.

## §47 — Small display bundle

Player must not import editor controls/managers. Keep an explicit bundle-size
gate. Old/low-end phones are in scope; no physical-device release gate is
required.

## §51 — Artboard

A theme has logical width/height. One uniform transform applies to all authored
content, including background alignment, strokes, typography and shadows.

## §53 — Fit modes

`contain`: show the whole artboard and fill bars. `cover`: fill viewport and
crop. The artboard's own fit is the fit of its *content*, is not an author
choice, and is always `contain`; background media carries the one fit an author
sets (§55).

## §55 — Background media

At most one video background sits beneath the transparent Fabric canvas and is
cropped/aligned by the same artboard transform. It is not a normal scene object.

## §57 — Geometry

No automatic reflow. Editor zoom is not document geometry. Fabric groups keep
and compose transforms; group/ungroup preserves world appearance. Authoring
controls use whole artboard units where practical.

## §61 — Editor controls

Generic selection, transforms, grouping, duplication/clipboard and object tools
are native `@yunari/editor` mechanics over Fabric. Do not recreate a parallel
DOM/geometry model.

Old custom-editor QoL that is absent from the fork route is **not automatically
a requirement**. Keep/replacement decisions for layers, align/distribute and
related behaviour are reviewed in [editor behaviour review](../superpowers/specs/2026-09-24-editor-behaviour-review.md) before implementation.

## §64 — Rulers, grid, guides and snapping (review)

Movement (drag) snapping, resize snapping and smart guides are present, and
their fidelity against the source they were ported from has been reviewed
(see §175 and
[snapping and guide fidelity](../superpowers/specs/2026-09-25-snapping-fidelity.md)).
A browser behaviour matrix asserts geometry, per-step re-planning, release,
no-guide and Ctrl for both gestures across shape, text and group active
targets, plus equal-spacing for movement. Pixel rulers, configurable
grid/guides and additional snapping modes are not present; treat those as
review candidates in
[editor behaviour review](../superpowers/specs/2026-09-24-editor-behaviour-review.md), not migration acceptance, until revalidated against the current
editor workflow.

## §67 — Undo/runtime separation

Authored and runtime state must remain separate: telemetry, playback, selection
and viewport never enter authored history. Chart-setting undo may be omitted if
it requires substantial custom machinery. Additional legacy history UX is not a
migration blocker unless explicitly retained after review.

## §73 — Theme globals

Named typed globals cover palette, typography tokens, spacing and assets.
Palette values include CSS-compatible solids and gradients. All authored paint,
including `fill`, resolves through the palette; only non-paint properties such
as opacity and geometry remain local.

## §75 — References and identity

Compatible authored styles resolve through stable global keys; typography resolves
through named type tokens and paint resolves through palette tokens. Globals also
have editable display names. Deleting a referenced global requires reassignment.
Scene objects have one stable Yunari id.

## §77 — Widgets

Reusable subtrees expose compatible parameters/defaults. Insertion embeds a copy
with fresh ids/provenance. Import maps globals explicitly; standalone export
includes required defaults/assets.

## §81 — Chart families

Pie/donut; full/partial radial gauges; horizontal/vertical bars/progress;
multi-series line/sparkline/area. Existing charts need not change family.

## §83 — Chart styling and data gaps

Supported styling includes fills/gradients, opacity, strokes/dashes, shadows,
tracks, thresholds, labels, axes/ranges, angles/thickness, spacing and line/area
options where the family supports them. Missing/non-`ok` samples render gaps,
never zero.

**Line-only exception (0124):** a line series skips a missing reading and joins
the readings either side, so it has no break and no blank edge; other families
still draw the gap. The prohibition that matters is unchanged — a missing
reading is never drawn as zero.

## §85 — Engine gap rule

A supported setting needs a property control, persisted authored representation
and visual fixture. If ECharts cannot express a treatment, surface the gap and
get product agreement before stabilising an approximation. **Three are open**,
recorded by the reference-theme plan; each is a limit of what one engine option
can say, not a defect:

- **A line's area fill applies to the first series only**
  (`renderer-core/src/charts/line.ts:254-255`). A theme wanting several filled
  series cannot have them; the reference's three filled trend series are
  therefore not expressible, and the starter draws strokes.
- **A series `lineWidth` is a backing-pixel length, not an artboard unit**
  (`0005`). The backing scale is derived per chart from its own area, so one
  authored value renders at 1.305× on the starter's trends chart against its
  sparklines. `shadowBlur` inherits the same unit, which is why the optional
  chart glow is skipped.
- **A gauge must carry no datum when it draws no arc** (`0008`). ECharts 6.1.0
  reads its own previous progress element unguarded inside the data-diff update
  callback, so a datum outliving `progress.show: false` throws inside the
  engine. Worked around on our side of the boundary; unfixed upstream.

- Gauge angular gradients: ECharts applies gauge progress colour across the
  swept arc, so the adapter expresses the gradient as arc segments.
- Line threshold bands: resolved with the agreed mapping — authored 0–1
  offsets resolve against the line's authored `min`/`max` through
  `visualMap.piecewise`. Without an authored range the stroke stays one colour
  rather than guessing at the visible axis.
- `VisualMapComponent` must stay registered in `scene-fabric/chart-engine.ts`;
  without it ECharts accepts the option and silently draws one colour.

## §87 — Typed chart settings

Themes persist typed Yunari chart settings, not raw ECharts options. Engine
translation has one owner.

## §89 — Typography

Support inline editing, curated packaged font faces and rich
family/size/weight/style/spacing/line-height/alignment/rotation/wrapping/
clipping/fill/outline/shadow/opacity controls. Styled runs may differentiate
label/value/unit. Sensor text uses fixed boxes by default to avoid jitter.

## §91 — Typography in charts

Chart text uses shared typography tokens where supported. Use native text overlay
rather than bitmap labels when ECharts cannot reproduce a required treatment.
Handle fallback/missing fonts and changing digit widths explicitly.

## §93 — Sensors and semantic binding

Samples carry identity, timestamp, value, unit and status. Themes bind semantic
keys, never provider instances. Providers report discoverable capability;
providers acquire while the host schedules/timeouts/backoff.

## §97 — Platform boundaries and honest capability

Windows-specific hardware/startup/tray/firewall/secret code sits behind platform
boundaries. Never fabricate readings. Unavailable sensors explain why; real data
never silently falls back to synthetic data.

## §99 — Custom API sensors

Desktop wizard for HTTP(S) JSON GET polling with URL/query/headers/interval/
timeout/auth. Secrets are referenced, not embedded. JSON Pointer mappings create
numeric/string/boolean sensors with units and optional scale/offset.

## §101 — Credentials and fetching

Fetch remote APIs on the PC. Secrets use platform storage, stay out of themes and
logs, and never reach display responses. Validate destinations/redirects; bound
response size/concurrency and share requests across mapped fields.

## §105 — Renderer inputs

Theme semantics, Fabric scene, resolved assets/fonts, samples/history, viewport
and clock. Editor/player share renderer objects; charts update without rebuilding
the scene.

## §111 — Minimal PC overhead

Poll the union of sensors active clients need once per cadence. Additional
displays must not multiply acquisition; reuse provider connections/discovery.

## §116 — Where work happens

| PC host | Phone/display |
|---|---|
| acquisition, remote API fetches, credentials, reconnect history | dashboard rendering, formatting, chart buffers/animation, media decoding/cache |

Normal operation needs no PC browser, bitmap streaming or video transcoding.

## §120 — Acquisition discipline

Respect provider-level grouped acquisition. Suspend unused acquisition after a
grace period unless background history is enabled.

## §122 — Rates and slow clients

Sampling, transmission and animation are separate rates. Batch updates; bound
queues; discard obsolete pending snapshots. Presentation interpolation never
pretends to be additional measurements; numeric text is not interpolated.

## §124 — One baseline

V1 has one bounded chart/history/animation baseline. Pause rendering when hidden
or disconnected. Performance presets remain future scope.

## §126 — Budgets when measurable

Add numerical budgets for real expensive paths. Use reproducible automated/
browser profiles where useful; physical-device validation is not a release gate.

## §132 — Imported artwork

Sanitize SVG before preview; preserve vector/multicolour originals; expose
size/rotation/flip/opacity/monochrome recolour. Store source/hash and supplied
licence/attribution metadata. Imported icons work offline. A future URL-import
flow may ingest Font Awesome SVG or Unsplash imagery only after remote input,
licence and attribution behaviour is defined.

## §134 — Theme format

Yunari owns a versioned semantic envelope; Fabric JSON is the persisted scene.
The development v2 envelope already establishes this scene boundary. Its globals/
property semantics remain pre-release and may break until spec 0011 completes.

Pin Fabric exactly; incompatible versions fail before revival. Persist authored
custom-chart settings only, never built ECharts/runtime state. Human-readable
scene JSON is not a goal. No v1 compatibility reader is required.

## §137 — Document and node shape

Envelope contains schema/Fabric version, id/metadata, artboard, globals, assets,
bindings, editor metadata and Fabric scene JSON. Fabric child order is paint
order; groups carry geometry and ordered children.

## §138 — Widgets in the document

Reusable subtree with local artboard, exposed style/data parameters, defaults
and preview. V1 insertion embeds a copy with fresh ids/provenance; no automatic
library-update propagation.

## §139 — Packages

ZIP packages embed required theme/widget dependencies and assets. The first
theme-package format is one v2 theme envelope plus its declared `assets/` bytes;
it rejects unexpected paths, duplicate/missing assets and bounded hostile input
before a document is revived. It may also carry the theme's own thumbnail, at the
package root in a slot the manifest names, so whoever receives the file can see
the look without installing anything. The export writes the envelope, its
declared assets and that picture and nothing else: a file in the theme folder is
not in the package for being in the folder, and a picture the library would
refuse is dropped rather than failing an import, because the theme is the thing
that matters. Licence files and widget packages follow only when they have an
authoring workflow.

The host may expose declared package assets as validated read-only bytes for the
player; the player remains ZIP-format-free.

Local folders may expose the same `theme.json` and `assets/` layout for external
asset editing. They are authoring workspaces: detect changed asset hashes and
reload deliberately, then export an immutable ZIP for sharing, libraries and a
future store. Do not silently synchronize folder and package copies.

## §141 — Validation and versioning

Validate schema/Fabric version, references, types, bounds, nesting and assets.
Unsupported versions fail cleanly without mutating the open document. Reject
traversal/symlinks/decompression bombs/executable content/external SVG resources.
Save atomically when host storage exists. New/Open must not discard dirty work
without Save/Discard/Cancel. Never export credentials/device tokens.

## §145 — Hosting and settings

Localhost administration remains available with LAN off. LAN serving is explicit
opt-in. Pair phones with short-lived/revocable sessions. Editing is localhost-only
by default. Plain LAN HTTP has no confidentiality; never suggest internet
exposure.

Settings cover units/locale/timezone, provider mapping, libraries, device
assignments, fit mode and hosting.

## §157 — Sequencing

Finish authoring-core contracts before shell modernization. Recreate a legacy
editor behaviour only after [editor behaviour review](../superpowers/specs/2026-09-24-editor-behaviour-review.md) retains or replaces it. Current completion
state and next work belong in `status.md`.

Human review is for scope expansion, product taste and external effects, not
routine architecture/sequencing.

## §170 — Dark/light variants (later)

A theme may be dark-only, light-only or dual-mode. Dual-mode themes share scene
geometry/bindings and override globals/assets/visibility rather than duplicating
the theme. Do not auto-invert bitmaps.

## §171 — Image import bounds and crop

Imported images are downscaled on import when they exceed a maximum bound,
preserving aspect ratio, before becoming a Fabric image object. A per-image
crop tool restricts a `FabricImage` to a rectangular source window, built on
the existing `clipPath`-based fit mechanism (`fitImage`'s `cover` math in
`scene-fabric`), not a new geometry primitive or the fork's `CropFrame`.
Optional aspect lock; apply/cancel stays outside undo history until committed.

## §172 — Layer tree and one action owner

The layer panel is a tree, not a list: rows reflect group depth, groups collapse,
and selection resolves a child through its owning group. Each row always shows
that layer's lock and visibility state as icons that toggle on click; they are
state indicators, not object actions.

Object actions have **one owner** — a registry defining what each action is,
whether it is eligible for the current selection, and how it runs. Surfaces
render from that registry and never define behaviour themselves: the floating
canvas dock, the layer panel's bottom action row, and the canvas context menu.
Two renderings of one action must not be able to drift.

Persisted editor-only state belongs in the envelope's `editorMetadata`, which
already exists for it. Viewport, collapse and selection state are transient and
never enter authored history (§67).

Design: [editor UI polish](../superpowers/specs/2026-09-25-editor-ui-polish.md).

## §173 — Authored density over decoration

The editor is a professional authoring surface used for extended sessions. Its
own chrome favours information density and a consistent row rhythm over spacious
marketing-page layout, and follows Figma UI3 as its reference where Yunari has
no domain-specific answer of its own. Palette tokens, type tokens and value runs
are Yunari concepts and keep their own shape rather than being bent to fit it.

Motion is restrained and functional: short transitions on interaction feedback
and panel reveals only. Decorative, scroll-driven, staggered or spring motion is
out of scope. Motion respects `prefers-reduced-motion`, and every interactive
control has a visible focus ring.

Design: [editor UI polish](../superpowers/specs/2026-09-25-editor-ui-polish.md).

## §174 — Canvas navigation

The authoring canvas is a camera onto the workspace, not a fixed fit-to-panel
view. An author zooms (about the pointer) and pans by the conventional gestures —
scroll, space-drag, pinch, keyboard — with the artboard bounded so it cannot be
lost off-screen, and a zoom readout offering fit and 100 %. The canvas viewport
is not document geometry (§57) and never enters authored history (§67).

This supersedes the earlier decision to drop canvas zoom/pan while fit-to-panel
sufficed; precise placement is now a demonstrated authoring need. Reachable
multi-select, entering a group to select its children, keyboard nudge, and a
canvas context menu are part of the same navigation layer.

Design: [editor viewport and mechanics](../superpowers/specs/2026-09-25-editor-viewport-and-mechanics.md).

## §175 — Ported behaviour keeps its source's quality

Behaviour ported from the retired `fabricjs-image-editor` fork is not complete
until it matches the source's practical quality, not merely its shape. Porting a
subset of a subsystem, or porting it with weaker tolerances, fewer snap types or
missing affordances, counts as an unfinished port. Where a port's behaviour is
observed to be worse than the fork's original, comparing against the pinned
fork source (`9efdd78a`) is the required first step.

This applies to snapping and smart guides as shipped (§64) and to any later port.

Design: [snapping and guide fidelity](../superpowers/specs/2026-09-25-snapping-fidelity.md).

## Later

### Editor research candidates (non-requirements)

  - After [editor behaviour review](../superpowers/specs/2026-09-24-editor-behaviour-review.md) retention review, consider fork-owned rulers, guides and
    hover preselection, plus measured stress fixtures from yft-design.
  - After §35, consider a creation/assets/templates rail, central artboard,
    contextual property rail and zoom/status footer. Actions stay visibly
    labelled and keyboard-accessible; this is not a separate agent-mode UI.
  - **KWGT** is the closest existing analogue to the editor this product wants:
    a widget authoring tool whose output is a small fixed-size display, built by
    someone looking at it while authoring. Studied 2026-10-03 for the redesign;
    its lessons and where it is worse than us are recorded in the redesign spec.
    Its grouping operation is **lossy** — moving items into a group converts X/Y
    to padding — which §57's world-appearance guarantee already forbids here.
    Distinct from [yft-design] and [OpenDesign], which are canvas editors.
  - After §139 storage, consider debounced validated-envelope/package autosave,
    template thumbnails/gallery and export presets. Raw Fabric JSON alone is not
    a document store.
  - Do not adopt another editor foundation, UI-state model, literal style
    defaults, remote-asset URLs or page model.

  Sources: [yft-design](https://github.com/dromara/yft-design),
  [OpenDesign](https://github.com/clawnify/OpenDesign),
  [fabric-canvas-editor](https://github.com/onerkiz/fabric-canvas-editor).

- Icon browser over the existing importer.
- Per-device performance presets.
- Incremental native drawing beyond basic shapes.
- Thin Android WebView companion; normal browser access remains supported.
