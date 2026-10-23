# The colour picker and the gradient editor, rebuilt

- **Status:** **approved 2026-10-23.** The owner reviewed this spec, confirmed
  the ReUI port, and settled the two open questions; the implementation plan is
  written from it. No code existed before that review.
- **Specifies work against:** [`DESIGN.md`](../../DESIGN.md) — §3 (the scales),
  §4 (colour roles), §5 (the closed control vocabulary). This spec amends §5;
  it changes no `§N` marker and adds no step to §3.
- **Register:** `vg-405` is the verdict this spec serves. It links, and does not
  re-file, `vg-336`, `vg-334`, `vg-333`, `vg-246`, `vg-263`, `vg-204`, `vg-286`
  and `vg-194`. **Four of those eight — `vg-246`, `vg-334`, `vg-333` and
  `vg-194` — are archived `verified`**: they are linked as the findings this
  rebuild must not regress, not as open work.
- **Research provenance:** two untracked documents under
  `.superpowers/sdd/2026-10-12-the-backlog-drain/` — `colour-and-gradient-research.md`
  (the consensus survey and the defect measurements) and
  `colour-picker-library-research.md` (the candidate’s licence, dependencies and
  channels). The evidence a reader needs is restated here with its sources; the
  workspace does not outlive the plan.

## The position

**Both surfaces are barely usable, and the reason is the same in each: they are
the only two controls in the editor that were built before the design language
existed, and they were built as one-offs.** The measurement is not a matter of
taste — `colour-picker.tsx` writes a value on every pointer event with no settled
boundary, so a drag writes N times and is undoable zero times; the gradient
editor draws a track, a preview and per-stop fields in three different control
styles; and neither component imports anything from the control set
(`ControlWell`, `ControlRow`, `ControlText`, `ControlNumber`, `ControlSwatch`),
so the Tokens pane ends up with **three text inputs for one colour** — the pane’s
own field, the picker’s hex field and the gradient’s per-stop field — with three
different commit behaviours.

Against what the rest of the industry ships, both are missing the same thing:
the shape. A colour picker is, in one popup under the value being edited, a 2-D
saturation × brightness area, a hue strip, an alpha strip, a text field for the
exact value, a set of preset swatches and an eyedropper — each a named,
keyboard-operable channel — reporting **two** callbacks, a live one during the
gesture and a settled one when it ends. That shape is universal: Figma, Chrome
DevTools, Blender, Photoshop, Ark UI, React Aria, react-colorful and `@uiw` all
ship it, and the tools that care about expensive writes all split live from
settled. This repo has four 1-D tracks and one callback.

A gradient editor is, in one row, a track that is both the preview and the stop
manipulator, a stop per stop movable by drag *and* by a numeric position, an
explicit add and remove, and beside the track an opacity channel, a midpoint
between adjacent stops, an angle and a set of presets. Figma, Photoshop,
Illustrator’s Gradient Forge, Blender’s Color Ramp and CSS itself all agree on
that much; the disagreements are the forks listed at the end. **The midpoint is
surveyed but not built**, because none of this repo’s three gradient painters
can honour it (see “The gradient editor”).

## The decisions

Seven are the owner’s rulings — four of 2026-10-12, three of 2026-10-23 — and
are not open again here. Three more are this spec’s, argued from those rulings
and from the survey.

### Ruled by the owner

1. **The channel set is the full consensus set** — a 2-D area, hue, alpha, a
   multi-format exact-value field, preset swatches and an eyedropper.
2. **Commit semantics: live preview, settled commit, and palette edits enter
   undo once per settled change.** A drag may write the scene freely; it makes
   one history entry, at the end.
3. **`DESIGN.md` §5 gains both new controls** — the 2-D colour area and the
   gradient track — as named members with their sizes, roles and behaviour. §5
   is a gate (“The vocabulary is closed. A control is one of these, or it is not
   a control”), so a surface that draws either without the amendment is a
   mistake by §5’s own Don’t list.
4. **The library question was put to the owner and answered by pointing at
   ReUI’s `@reui/color-picker` (Base UI flavour)**, which was then checked. It
   is MIT (Copyright © 2025 Keenthemes Inc), it ships **no colour dependency** —
   it does its own maths — and it already has the ruled channel set and the
   ruled live/settled pair (`onValueChange` per change, `onValueCommit` once per
   settled interaction). It is a copy-in shadcn registry block, not a package,
   and it ships **no tests at all**. After ruling 7 it is the **reference for the
   interaction model only**; none of its source is copied.
5. **One trigger per colour.** The pane’s row is one well carrying a swatch and
   the stored value, and it opens the picker; the exact-value field lives inside
   the popover. The standalone 28px swatch beside the field and the pane’s own
   hex field are both removed, so one colour has one field rather than three
   across the pane, the picker and the gradient’s per-stop row.
6. **The preset rows are editor-local data** (owner ruling, 2026-10-23). A
   fixed design set — a neutral ramp and the hues — **seeds** the colour row on
   first run, but the row is a persisted library: the asset finder’s palettes
   and gradients surface adds to it, and a right-click on a preset deletes it.
   The library is **editor-local, not theme data** (owner ruling, 2026-10-23):
   it survives documents, is not in the document undo history, and is not part
   of a saved theme. The finder surface itself is a separate spec.
7. **Colour maths comes from culori, not from ported ReUI source.** Asked by the
   owner on 2026-10-23 whether a library existed instead of doing our own maths.
   Checked against package metadata: culori 4.0.2 is MIT, has **no
   dependencies**, is ESM and tree-shakeable through `culori/fn`, runs in Node,
   and parses CSS Color 4 plus named colours with an HSV mode and `formatHex8`.
   It replaces parsing, conversion and formatting. ReUI stays the reference for
   the **interaction model** — the channel decomposition, the ARIA and the
   keyboard table — and its source is not vendored.

### This spec’s decisions

8. **The picker is built on this repo’s Base UI wrappers, not installed through
   the shadcn CLI.** Installing ReUI would pull the primitive set `ADR-0038`
   removed: the registry item’s `registryDependencies` are bare shadcn names and
   this repo’s `components.json` style is `new-york`, so the CLI resolves them to
   `@radix-ui/react-slot`, `-popover`, `-dropdown-menu` and `-separator` and
   their transitives. The published file also imports
   `@/app/(create)/components/icon-placeholder`, a module that exists only
   inside ReUI’s own Next.js app, so it does not compile as shipped. The ported
   part is therefore the interaction contract — the ARIA, the keyboard model and
   the channel decomposition — rewritten in §5’s vocabulary. A 2,996-line file
   does not enter this repo whole; `AGENTS.md`’s 800-line stop applies, and no
   file in this work is exempt from it.
9. **Interpolation is not exposed.** Photoshop and Figma’s shader surfaces offer
   an interpolation space and CSS now defaults to Oklab, but **this repo’s
   renderer draws CSS gradient strings in sRGB through ECharts and Fabric**, so a
   control offering Oklab would promise something nothing honours — the failure
   §5’s Don’t list names. It is recorded as an upgrade path, not built, and its
   reference is [Oklab](https://bottosson.github.io/posts/oklab/) (Ottosson) —
   noted by the user 2026-10-20, filed `vg-644`. The condition to build it
   differs by renderer: a DOM gradient can carry `in oklab`, a canvas one
   cannot, since `CanvasGradient.addColorStop` takes no colour space.
10. **Stops keep free positions and duplicates are represented, not refused.**
   Figma, CSS and Illustrator all treat a position as a free value and a stacked
   stop as a deliberate hard edge. Refusing a non-ascending entry would silently
   destroy an author’s work, and the drag path and the numeric path must agree
   about it: two stops at one offset render as two distinguishable stops.

## The picker

**Shape.** One popover under the value being edited, opened from that value’s
own swatch, containing:

| Channel | Control | ARIA |
|---|---|---|
| Saturation × brightness | the **2-D colour area** (§5 amendment) | `role="slider"`, two channels announced, `aria-valuetext` naming both and the colour |
| Hue | a gradient-painted track | `role="slider"` with min/max/now |
| Alpha | the same track, over a checkerboard | `role="slider"`, value as a percentage |
| Exact value | **Well** (`ControlText`), with the format the value is stored in | labelled, `aria-invalid` when refused |
| Presets | **Choice row** in one labelled `radiogroup` | per §5 rule 7, “never colour alone” |
| Eyedropper | **Icon button** (`ControlIconButton`, glyph only) | `aria-label` from `uiCopy` |

**Keyboard follows the APG slider model** — arrows by one step, Page Up/Down and
Shift+arrow by ten, Home/End to the ends, Escape to close and return focus — and
the wheel-less surface keeps Blender’s rule that a modifier is part of the model
rather than a hidden trick. Naming: channels are named in words from `uiCopy`
(`Saturation`, `Hue`, `Alpha`, `Value`), which is `vg-336`’s ruling, and **test
ids stay separate from accessible names** — naming is not a test hook.

**Focus is a boundary, not a UA outline.** §5 rule 4 requires a solid boundary at
≥3:1 against adjacent colours in all six palettes. A UA outline drawn over an
arbitrary gradient cannot satisfy that by construction, so each channel paints
§4’s boundary role at its own focus, and the ratio is **measured in the browser
before the work is called done** — it is unmeasured today, and this spec does not
assert a number it has not taken.

## The preset library

**It is editor-local data, and one owner owns it.** `preset-library/index.ts`
holds the store; the picker and the gradient editor subscribe to it; the asset
finder’s palettes-and-gradients surface (a separate spec) calls its add
functions. It is stored under `yunari.editor.presets` as
`{ version: 1, colours: [{ id, name, value }], gradients: [{ id, name, angle, stops }] }`.
It is **not** in the theme envelope, **not** in the document undo history, and
**not** saved with a theme.

- **Seeding is once.** When the key is absent, the colour list starts as the
  fixed design set (the neutral ramp and the hues) and the gradient list starts
  as the fifteen named swatches from <https://cssgradient.io/swatches/>, read on
  2026-10-23 and transcribed in `preset-library/defaults.ts`. A CSS `90deg`
  gradient persists as `angle: 0`, because the editor's stored angle is
  `90 - cssDegrees`. The seed values are authored as `rgb(r g b)` strings, not
  hex literals: `defaults.ts` is editor source inside the token gate's reach and
  the gate's remainder is already at its ceiling, so the store normalises the
  seeds to hex when it reads them. Deleting every preset
  writes an empty list, and the defaults do **not** come back: presence of the
  key, not emptiness, is what seeding tests.
- **Adds are validated and de-duplicated.** `addColours(entries)` formats each
  value through `parseColor`/`formatColor`, skips an entry that is not a colour
  and one whose value already exists, and returns
  `{ added: number, library }`. `addGradient(entry)` accepts a finite angle and
  at least two stops whose offsets are finite and inside `0–1` and whose colours
  parse; a duplicate angle-and-stops pair is skipped; it returns
  `{ added: boolean, library }`. Refusal is a skip, never a coerced value.
- **Deleting is a first-class action.** Right-clicking a preset opens the same
  controlled Base UI `ContextMenu` the canvas uses, with one row, **Delete
  preset**, in `--hot`. `Shift+F10` and the ContextMenu key open it from the
  focused preset, and Delete on a focused preset performs the same removal, so
  the action is not pointer-only.
- **An empty library draws no row.** A true zero is stated by the absence of the
  section, not by a placeholder or a fabricated default.
- **Storage failure is not data.** A refused read falls back to the in-memory
  snapshot, and a refused write keeps the in-memory change for the session; the
  store never invents entries.

## The gradient editor

**One row, one owner.** The track is the preview *and* the manipulator; the stops
are the document. The angle field, which today lives in the pane while the
component that draws the gradient lives beside it, moves into this component’s
own row (the alternative — a component with a gesture and no control for it —
is the shape the current file already suffers from).

| Part | Control |
|---|---|
| The track | the **gradient track** (§5 amendment), the value’s own gradient painted on it |
| A stop | a stop mark on the track; selected by click and by keyboard, movable by drag and by a numeric **Well with unit** (`ControlNumber`, `%`) |
| Adding a stop | a click on the track, or the add **Icon button** |
| Removing a stop | the remove **Icon button**, or Delete — never drag-away alone, because a pointer-only gesture is unreachable for a keyboard author |
| Angle | **Well with unit** (`ControlNumber`, `deg`) |
| Presets | **Choice row** from the editor-local gradient library; choosing one applies its angle and stops as one settled change |

**Midpoints are deliberately not built (owner ruling, 2026-10-23).** A palette
gradient persists as `{angle, stops[{offset, color}]}` and is painted by
Fabric’s `Gradient`, a CSS `linear-gradient()` string and
`CanvasGradient.addColorStop` — none of them accepts a midpoint, so the control
could not change a single rendered pixel. Building it means adding midpoint
state to the theme schema and synthesising stops in all three paths, a separate
feature with its own migration. **The condition to build it** is a renderer that
honours a colour hint, or a decision to synthesise stops.

**Gradient presets are built** because the asset finder now supplies their
content: a picked gradient appends to the editor-local library, the row draws
one choice row per preset, and choosing a row applies `{angle, stops}`.

**Alpha is inside the stop’s colour** — the theme already stores 8-digit hex,
CSS and DevTools put alpha inside the value, and a separate
opacity-stop model (Photoshop’s) is a second stop list this product does not
need.

## One owner for the value

The three text inputs for one colour become **one commit path**: the pane’s
single well is the picker’s trigger, the picker’s field is the only place the
value is typed, and both go through the same parse, the same refusal channel and
the same settled-write boundary (ruling 5). Concretely:

- **The colour parser gets one owner, and the owner sits below both
  consumers.** Measured at the base: `parseHex` and `parseColour` live in
  `editor/src/components/ui/colour-maths.ts`, consumed by `colour-picker.tsx`,
  `gradient-editor.tsx` and one test — and a second, tuple-returning `parseHex`
  lives in `renderer-core/src/charts/fill.ts`. Two implementations of one
  concept, neither importing the other. **The first instinct — `colour-maths.ts`
  owns it and `fill.ts` consumes it — cannot be built**: `renderer-core` imports
  nothing from `editor` and the editor bundles `renderer-core` from source
  through a Vite alias, so that direction is a cycle. The primitive therefore
  moves **down** into `renderer-core/src/color.ts`, which wraps culori
  (ruling 7): it owns turning a value into channels and refusing what is not a
  colour, formatting back to 8-digit hex, and exposing HSV channels (culori’s
  `hsv` mode). **`colour-maths.ts` retires rather than moving**: every conversion
  in it is culori’s, so the editor keeps no hand-written colour maths at all.
  `fill.ts`’s second parser retires into the wrapper. **The shared
  contract is the `Rgba` object, not the chart path’s 3-tuple** (amended
  2026-10-23): alpha is authored state and a 3-tuple silently drops it, so
  `fill.ts` and `facet-record.ts` read `r`, `g`, `b` off the returned object
  instead of indexing a tuple. `ownership.md`’s Editor row for
  “shared colour parsing” moves with the primitive, because the map is the owner
  of record and a row that names the old home is the contradiction the map
  exists to prevent.
  **Corrected on self-review, 2026-10-13.** This bullet cited `vg-246` as an
  open gap; the row is archived `verified`, and the map no longer lists colour
  parsing under Known ownership gaps — it names the owner in the Editor table,
  which is what that row's close accomplished. Its own text left one half
  unmeasured — “whether other colour parsing exists that the survey did not
  find” — and that half is `renderer-core`'s second parser, filed as **`vg-439`**
  with the two signatures and the import direction this bullet now turns on.
- **The gradient-CSS formula is written once.** It exists in
  `gradient-editor.tsx` and again in `paint-list.tsx` (including the `90 - angle`
  mapping). One function, one owner, two consumers.
- **A refused colour stays editable**, through the “invalid but still editable”
  channel the control set already gained (`vg-263`), with the message announced
  rather than only coloured.
- **Undo has one entry per settled change**, through the split the picker’s
  `onValueCommit` provides. Whether palette edits enter `EditorHistory` at all is
  answered by the owner’s ruling 2: they do, once per settled change, which means
  the history owner must be able to serialise a palette change — today it
  serialises the Fabric scene only. **Decided 2026-10-23:** an `EditorHistory`
  entry carries `{ scene, globals }`. `EditorDocument` attaches a globals port
  (`read`/`write`) to the history manager after construction, because the shell
  is built before the document. Undo restores the scene and the globals
  together; a live drag writes without saving, and the settled callback records
  one entry.

## What this amends in `DESIGN.md`

Two members added to §5, and only two: the **2-D colour area** and the
**gradient track**, each with its size on §3’s steps, its §4 colour roles, its
focus boundary and its keyboard model. §5’s own row grid (a 74px label column and
one value cell) governs how both are reached from a pane row. The amendment keeps
§5’s marker under the `## Components` heading, because `scripts/design-md.mjs
--cite` fails when a marker sits under a heading the spec’s section mapping does
not name.

**Both files join the token gate.** `scripts/design-tokens.gated.json` does not
list `colour-picker.tsx` or `gradient-editor.tsx` today; the rebuilt files do,
together with their tests, per `vg-286`’s ruling that tests join the gated list.
**Measured on 2026-10-13, with the method stated because the plain command does
not show it**: add both files to a copy of the gated list and run
`node scripts/design-tokens.mjs --gated <copy>` — it reports **17 hex-literal
violations, every one of them in `colour-picker.tsx`** (the hue strip's
`#f00`–`#f0f` run, the alpha checkerboard's `#666`/`#999`, the area's
`#fff`/`#000`, and one `#3a3f4b`), and **none in `gradient-editor.tsx`**, whose
own raw `#000` outline `vg-334` had already fixed. No off-scale `px` violation
fires on either file, because the sizes are `h-28`-style classes and inline
`width: 28`, which the property rule does not catch. The checker as it runs today
says nothing about either file: it reads the gated list and the ceiling paths, so
an ungated file is not in its run at all. **Corrected on self-review,
2026-10-13**, from 18-between-two-files to 17-in-one — a count no command
produced, which is what the rule against citing counts is for.

## Before the first write

- **A decision note at `docs/decisions/0098-*.md`** — `scripts/reuse-gate.mjs`
  gates `components/ui/`, so the hook refuses until a note claims the path. The
  note carries the seven rungs; the two research documents are rungs 3–5’s
  evidence, including the rungs that found nothing, and rung 4 now also records
  the culori comparison and why it beat the alternatives.
- **Licence provenance**: culori’s MIT notice into `THIRD-PARTY-NOTICES.md` and a
  `## Dependencies` row in `docs/engineering/dependencies.md`. No vendored-source
  row is added, because no ReUI source is copied.
- **The owner confirms the approach.** Done 2026-10-23: the owner first
  confirmed the ReUI port, then (after asking whether a colour library existed)
  chose culori for the maths. ReUI remains the interaction reference only.

## What this does not cover

- **Colour-space switching.** The field accepts what culori parses — hex,
  `rgb()`, `hsl()`, named colours and the rest of CSS Color 4 — but the value is
  stored and shown as 8-digit sRGB hex, so a wide-gamut input is clamped rather
  than preserved. A DevTools-style space switcher is not built, and the
  `renderer-core` wrapper, not `CSS.supports`, is the authority for what is
  accepted.
- **Gradient midpoints.** Dropped by the owner’s ruling of 2026-10-23; the
  condition to build one is stated under “The gradient editor”.
- **The asset finder’s palettes-and-gradients surface.** The owner builds that
  surface under a separate spec; this spec owns only the library it feeds and
  the rows that read it.
- **The rest of the Tokens pane.** Its own layout, its list and its binding
  readout are the redesign’s, not this spec’s.
- **The chart paint path.** `renderer-core` consumes whatever value the picker
  stores; it does not gain a picker.
- **Screen-reader proof.** The ARIA and key tables follow ReUI’s documented
  model, and the upstream project has no tests. The behaviour is
  **unverified here until this repo renders it and inspects it** — it is
  acceptance, not an assumption.

## Acceptance

1. A drag on the area changes the preview live and produces **exactly one**
   history entry, at the gesture’s end — proved by count, not by inspection.
2. Every channel is reachable and adjustable with the keyboard alone, and each
   one’s value is readable as text.
3. The picker’s swatch sits at the value it edits, and there is one field for one
   colour in the Tokens pane.
4. A gradient is authored with a drag and with numbers, and the two agree —
   including two stops at one position rendering as a distinguishable hard edge.
5. The focus boundary’s contrast is measured in the browser, in all six palettes.
6. A refused colour leaves the value editable and says why, in words, through the
   announced channel.
7. `design:check`, `gates:self-test` and the token gate over both files are green,
   and both files are inside the gated list, **with their tests** — which is what
   the amendment above states and what `vg-286`'s ruling requires.
8. The browser evidence is captured for the picker and the gradient editor per
   `docs/evidence/screenshots/README.md`.
9. A colour list added through `addColours` appears in the picker’s row, a
   gradient added through `addGradient` appears in the gradient editor’s row,
   right-clicking or pressing Delete removes a preset, and all three survive a
   reload because the library is editor-local storage.

## Self-review, 2026-10-13

Run before handing the spec over, as the four checks the writing process asks for
— placeholders, internal consistency, scope and ambiguity — and it changed three
things, each corrected in place above:

- **Consistency, and the one that would have stopped a plan.** The parser bullet
  told an implementer to make `renderer-core/src/charts/fill.ts` consume
  `editor/src/components/ui/colour-maths.ts`. That import points upward across a
  package boundary — measured, `renderer-core` imports nothing from `editor`, and
  the editor bundles `renderer-core` from source — so it is a cycle, not a plan
  step. The primitive now moves down instead, and the ownership row moves with
  it. The same bullet cited `vg-246` as an open gap; the row is archived
  `verified` and the map names the owner.
- **Consistency, a count.** The token-gate paragraph stated 18 hex violations
  “between the two files”. Measured with a probe list, it is 17, all in
  `colour-picker.tsx`, and `gradient-editor.tsx` is clean.
- **Ambiguity, one clause.** The acceptance item on the gate did not name the
  tests the amendment above it adds to the gated list, so it could be read as
  passing with the files gated and the tests not.
- **Placeholders:** none. The one wildcard is the decision note's path,
  `docs/decisions/0098-*.md`. **Corrected 2026-10-23:** this review had named
  0042 and called it free, but `docs/decisions/README.md` reserves 0006, 0034 and
  0042 as absent numbers, so 0042 was never available; the highest accepted note
  is 0096.
- **Scope:** one plan. The picker, the gradient editor, the one owner for the
  value, the `DESIGN.md` amendment and the gate membership are one workstream
  against one verdict, `vg-405`.

## Resolved by the owner, 2026-10-23

Both questions below were answered before the plan was written; neither is open.

1. **Trigger:** one trigger per colour. The pane’s well carries a swatch and the
   stored value and opens the picker; exact entry lives in the popover (ruling
   5). The separate swatch and the pane’s own hex field are removed.
2. **Presets:** a fixed design set, defined in `colour-presets.ts` (ruling 6).

## Self-review, 2026-10-23

Run again after the owner’s review changed the maths source, the trigger shape
and the presets:

- **Dependency, and the one that changed the plan.** Ruling 7 replaces the
  ported ReUI maths with culori. The parser still has one owner —
  `renderer-core/src/color.ts` — but it is now a wrapper over culori rather than
  a moved hand-written parser, and `fill.ts`/`facet-record.ts` consume the same
  wrapper. No ReUI source is copied, so no vendored-source row and no ReUI
  licence notice are needed.
- **Consistency.** The picker’s paragraph still described three inputs for one
  colour and a separate swatch trigger; ruling 5 and the rewritten “One owner for
  the value” paragraph now say one well, one field in the popover.
- **Undo.** The history bullet now names the mechanism (`{scene, globals}`
  entries and a globals port onto the history manager) instead of leaving it as
  a requirement.
- **Feasibility, found while writing the plan.** Midpoints cannot be honoured by
  any of the three painters; they are removed and the upgrade condition
  recorded, by the owner’s ruling of 2026-10-23.
- **Revised the same day.** The owner then made presets editor-local data fed by
  the asset finder, restored the gradient preset row, and chose
  `cssgradient.io/swatches` as its fifteen seed gradients. The library section,
  ruling 6 and the gradient table were updated together; the finder surface
  stays in its own spec.
- **Placeholders:** none. `docs/decisions/0098-*.md` is free.
- **Scope:** one plan against `vg-405`; `vg-439` closes with the parser move.
