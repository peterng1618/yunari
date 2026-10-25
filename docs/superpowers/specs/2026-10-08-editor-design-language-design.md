# The editor's design language, and the React rewrite under it

- **Status:** draft; §5.2, §5.3 and §7.2 are amended by
  [`2026-10-25-fonts-and-assets-design.md`](2026-10-25-fonts-and-assets-design.md)
  — the Assets pane returns as a fifth rail slot, Add loses its file section,
  and type-preset properties move to the inspector.
- **Supersedes in part:** [`2026-10-03-dashboard-authoring-design.md`](2026-10-03-dashboard-authoring-design.md)
  §4, §8, §9 and the Sequencing table — see §11. Its §N markers are not renumbered.
- **Normative companion:** [`../../design/design-language.md`](../../design/design-language.md)
  — the visual language this spec builds. The bible states the rules; this spec
  states the work.
- **Decision:** [`../../decisions/0039-the-editor-ui-is-react-and-only-the-canvas-is-imperative.md`](../../decisions/0039-the-editor-ui-is-react-and-only-the-canvas-is-imperative.md)

## The position

The nine-plan redesign delivered the *capability* half of this product and almost
none of its look. That is not a guess: §9 of the superseded spec says Tailwind's
`@theme` "carries the spacing, radius, type and elevation scales", and the
measurement is that **nothing consumes them.** Zero uses of `--text-*`,
`--radius-*`, `--spacing-*` or `--shadow-*` exist anywhere in the workspace —
editor, player, host and `renderer-core` alike — while `editor-shell.css` holds
**73 unique hex values and 294 px literals** across 58 selectors. What landed was
the *declarations*. Colour landed properly (`var(--shell-*)`, 106 uses, six
working palettes); everything else did not.

The root cause is structural, and it is the reason this spec is a rewrite rather
than a restyle: **the editor's UI is split across two rendering models, so a
design language cannot be applied to it once.** 17 surfaces are React; the panel
family where most of the product's *controls* live is imperative DOM. A control
vocabulary built for the React half reaches the other half only as a stylesheet
over native `<select>` and `input type=range` — 23 of the former.

This spec fixes both: the language is written down normatively, and the surfaces
it applies to become one kind of thing.

**The user's ruling during this design, recorded because it closed the fork the
earlier plan left open:** *"Reactify everything. I'm tired with half-baked
measures and dutch taping."*

## What this design must never become

- **A restyle.** If the language can be applied by editing `editor-shell.css`,
  the measurement above says it will be applied to 40% of the editor and the
  panels will keep their own look. That is the failure this spec exists to
  prevent, and it is what happened last time.
- **A React canvas.** See §2.4. Nothing here changes what owns the scene.
- **A surface that hides a setting to look simpler.** §8.1 of the superseded
  spec stands: convenience is ordering and grouping, never a smaller surface.
- **A look invented twice.** Every rule this spec implements is in the bible.
  Where the two disagree, the bible wins and this spec is wrong.

## 1. The design language is normative and separate

`docs/design/design-language.md` is the durable artifact: the type scale, the
spacing steps, radius and elevation levels, the colour roles, the closed control
vocabulary, the icon rules, the layout rules, the copy rules, and the list of
what is forbidden.

**Why it is a separate document and not a section here.** The superseded spec's
§9 was four sentences inside a change-specific document, and it is exactly the
part that did not happen. A rule that lives inside the spec that produced it
dies when that spec closes. A rule that lives in its own normative file is read
by the next change instead of being re-derived, and a change that needs something
absent from it must amend it in the same commit.

**Preserve the original visual direction** (bible §7.8): artwork-led stage,
compact diagram tiles, fine dividers, restrained floating clusters and visual
palette previews. Correct contract mistakes within that composition. Do not
replace it wholesale with a blank artboard, text-heavy grids or enlarged generic
controls to satisfy an unmeasured readability assumption. Stage texture and
column-count changes require rendered evidence, not blanket bans.

**Acceptance of this section is therefore about the bible's existence and use,**
not about its prose: every plan that follows cites it, and no surface ships a
value that is not in it.

## 2. Every editor surface is React; the canvas is imperative

### 2.1 The boundary

React renders UI. Fabric owns objects and the render loop. **No Fabric object is
ever mirrored into React state.** React reads a *projected* view — ids, names,
kinds, counts, eligibility — through the editor-shell bridge, which already
works this way: `bridge.ts` projects the live selection on demand and notifies,
and `CanvasDock` renders from it without holding a copy.

This is Fabric's own maintainer's guidance (issue #3192, and the converging
answers in #5951), not a preference: a canvas initialised once, made reachable to
components, with a store beside it updated from Fabric's events. `react-konva`'s
declarative-node shape is the counter-example, and adopting it over Fabric is how
two sources of truth for the scene appear.

### 2.2 What is rewritten

| Family | Lines | Fate |
|---|---|---|
| `selection-inspector/` | 2,714 | Rewritten as components |
| `asset-manager/` | 684 | Dissolved (§5.2), what survives is rewritten |
| `palette-manager/` | 567 | Rewritten into the Tokens pane (§5.3) |
| `type-preset-manager/` | 327 | Rewritten into the Tokens pane (§5.3) |
| `editor-shell/controls/` | — | Rewritten as the one control set of bible §5 |
| `editor-shell/`, `font-picker/`, `components/ui/` | — | Already React; restyled, not rewritten |
| `chart-manager/panel.ts` and settings-field rendering | — | Plan 3 rewrites the UI; chart descriptors, mutations and lifecycle remain chart-owned |
| `artboard-panel.ts` and document-reference rendering | — | Plan 4 rewrites the UI into Document |
| `new-document-chooser.ts`, `theme-library-dialog.ts`, persistence dialogs | — | Plan 5 completes dialog rendering on the same control set; existing I/O and validation stay owned where they are |

Line and control counts above are pre-redesign observations, not future gate
thresholds; executors remeasure at their branch point. Every hand-authored native
`<select>` and native `input type=range` inside editor surfaces is replaced by
the control set, including the font picker and dialogs. A primitive's hidden
form-integration element is not a second visible control. This is the concrete
test of whether the language was applied or merely declared.

**Scope closure is mandatory.** Plan 6's census may find a missed surface, but
cannot waive it as a deliberate difference and declare §2 complete. Hold
completion and assign the missing rendering to its existing family owner.
There is no seventh implicit rewrite hidden inside an icon-and-copy sweep.

### 2.3 Behaviour does not drift

The rewrite replaces **rendering**, not rules. Same fields, same eligibility
gates, same refusals, same read-only markers. The existing contract tests are the
instrument:

- The descriptor completeness test (a settings key with no descriptor fails to
  compile) keeps holding §8.1's "every authorable setting has a control".
- The per-kind tests (`selectionKindOf`, `KIND_QUESTIONS` totality) keep holding
  §6.
- Where a test locates imperative internals it is re-pointed at the React
  surface **in the same commit**, and a re-pointed locator must be shown to fail
  when the behaviour it guards is disabled before it is trusted.

### 2.4 `vg-149` becomes a blocker

Biome currently lints and formats no `.tsx` file, so every React surface is
outside both gates. Today that is a quirk affecting 17 files. After this rewrite
it would affect the whole editor, and the newly-React panels would sit outside
the gate the imperative ones were inside. **Linting and formatting `.tsx` is the
first task of the first plan**, before any panel moves.

## 3. The shell

### 3.1 The header

Document-level and editor-level actions only; a command with a rightful home
elsewhere is not repeated here (bible §7.1).

| Position | Contents |
|---|---|
| Left | Brand mark · `File` · `Edit` · `View` |
| Right | The publish chord, then `Publish` — the editor's only filled accent button |

Three consequences, each of which removes something that exists today:

- **No document identity in the header.** The theme name and its edited state
  move to the canvas's top-left (§4.1), because the header is not where an author
  looks to ask what they are editing.
- **No `Insert` menu.** `vg-161` and the superseded redesign both rule it leaves;
  insert has a home in the Add pane (§5.2). `insertGroups()` is already the one
  owner both surfaces rendered, so the menu's removal costs no capability.
- **No `Document` menu.** Document becomes a rail slot (§5.4), so by the same
  rule it is not repeated in the menubar.

**`View` stays, deliberately.** It holds preview/source, chart refresh rate and
run display (`shell-layout.tsx:370-403`) — controls changed *while designing*,
many times a session. Settings is for once-in-a-while choices, and a frequently
used control placed one level deeper is a tax on every use. This is the ruling
that separates §3.1 from §7.

### 3.2 The rail

A 46px vertical glyph strip with the settings gear pinned to the foot, holding
**four slots** — Composition, Add, Tokens, Document — with an expanding pane.

- **The horizontal pane bar is deleted.** Two stacked horizontal navigation bars
  make the first read as chrome rather than as a choice.
- **At most one slot is open at a time**; choosing it again closes it. The pane
  occupies the layout track beside the rail. The existing refit-on-toggle
  behaviour stays: available stage space may change, authored coordinates do
  not. No new overlay may obscure artwork or stage controls.
- **The gear is the fifth thing on the rail but is not a slot:** it opens a
  modal settings surface (§7), not a pane, because it is not part of the
  document.

### 3.3 Panes

246px. Title bar, scrolling body, optional footer toolbar. The footer holds the
actions of the pane's own items — the scene tree's footer holds the object
actions, rendered from `OBJECT_ACTIONS` and filtered by `actionEnabled`, exactly
as the dock does.

### 3.4 The status bar

26px, mono, readouts only: counts, save state, live indicator. **No tools** — the
toolbar is on the canvas (§4.3) and the dock is on the canvas. Anything
actionable belongs to a region that owns it.

## 4. The stage

The artboard is centred and **never drawn inside a device frame**. The superseded
spec's §2 framed the stage as a phone; the user reversed that mid-specification
and this spec carries the reversal.

### 4.1 Top-left — the document's identity

A floating cluster: record dot, theme name, edited state. It replaces the
header's document readout.

### 4.2 Top-right — how it is shown

The display lens chips and the zoom cluster (−, value, +, fit).

**These are view state and they were in the wrong place.** They sat in the
editing dock until this design; the dock acts on the selection, so a view control
inside it teaches an author that the view is a property of the selection. The
lens chooses a display-view rectangle, never the authored artboard size;
zoom scales the *view*. They share one cluster because both answer the same question, and they are one cluster rather
than two by convenience, which is stated so a later change can separate them
without re-arguing placement.

### 4.3 Bottom-centre — the selection dock

**The dock renders the registries and decides nothing.** Two halves, with
deliberately different treatments:

- **Object actions, filtered.** `OBJECT_ACTIONS` — duplicate, copy, cut, front,
  bring-forward, send-backward, back, lock, ungroup, group, delete. An action
  this selection cannot run is **absent**, not greyed.
- **Arrange actions, greyed.** `arrangeActions()` needs two or more objects, so
  it draws disabled and becomes live as the selection grows.

Both halves ask the registry for eligibility the same way, so the surface never
re-derives what an action can do. The asymmetry (filter vs grey) is today's
behaviour, kept because it is a decision the product already made: an action
that cannot apply to *this kind* is noise, an action that needs *more objects* is
a discoverable next step.

**Insert is not in the dock and never was.** Shapes, text, charts and images come
from the Add pane.

## 5. The panes

### 5.1 Composition

The scene tree, plus the object-action footer. Rows carry a kind glyph and a
name.

**A group gets a generic glyph.** A card on the canvas is an arbitrary group of
elements, so its row cannot depict it — this is the correction to an earlier
mockup that drew a bespoke diagram per card. Per-row affordances (rename, eye,
lock) appear on the hovered or focused row.

### 5.2 Add

Everything insertable, from `insertGroups()` — the one owner the pane and the
removed Insert menu both rendered. Cards (the 8 units of `CARD_LIBRARY`), Shapes
(the 8 `SHAPE_KINDS`), Charts (the 4 `CHART_FAMILIES`), and Text.

**Card unit tiles may carry a diagram; layer rows may not.** The card library is
a fixed set of eight, so depicting a unit is honest. A group on the canvas is
arbitrary, so depicting it is not. The distinction is the rule, not an
inconsistency.

**This pane absorbs the Assets pane** (`vg-154`). Placed images and SVGs become
layers, but declared fonts, videos and unplaced files still need a library. Keep
that declared-asset list, previews, byte replacement and reference-safe removal
inside Add. The import path, `assetReferencedBy` and document-level references
must survive the move, or a file the theme still uses becomes removable.

**Byte replacement is not selection replacement.** Swapping a declared asset's
bytes changes every use of that asset; re-pointing one selected image changes
one use. This rewrite preserves the former. The latter remains `vg-154`'s
explicit unmet capability, not a shipped claim or a reason to close the row.
The footer says "Import a file" where fonts/videos are accepted; placeable
images/SVGs may additionally be placed through the manager's existing path.

### 5.3 Tokens

The theme's **paints** and **type presets**, created and edited here.

**This is `vg-153` discharged.** That row measured four things sharing one scroll
in the Document pane — `createArtboardPanel`, `createPalettePanel`,
`createTypePresetPanel`, `createDocumentReferencesPanel` — and the ruling was to
dissolve the pane. The style libraries are not the document, so they get their
own surface: a paint list with swatches and token names and a new-paint row, and
a preset list with its resolved family/weight/size and a new-preset row.

`vg-094` is the correctness requirement inside this pane: **the preset panel must
be bound to the selection.** Today it is constructed with no canvas and no
selection and defaults to the first declared preset, so an author who sets a run
to `24-400` and opens the panel to see what that preset *is* finds `20-400`
selected and cannot tell a default from an answer.

### 5.4 Document

Artboard, background, metadata, references. **`References` keeps its read-only
marker** (`0030`), stated in the pane before it is opened rather than inferred
from absent controls.

## 6. The inspector answers the question the thing raises

The right column describes what the selection *is*, in five sections — Content,
Position, Layer, Paint, Spends — as the superseded spec's §4 requires. This spec
changes **one thing** in it, and the change is a correction to the spec's own
prose rather than to the code.

**A card is not a kind, and there is no per-card column.** The measurement:
`SELECTION_KINDS` is `["shape", "text", "chart", "image", "group",
"activeSelection"]`; `selectionKindOf()` dispatches on the Fabric class; a card
**is** a `Group`, and no card-role dispatch exists anywhere in
`selection-inspector/`. What a group gets today, in full:

| Section | A group |
|---|---|
| Content | its name |
| Position | left, top, width, height (the bleed mark this row carried went on 2026-10-18, `docs/decisions/0069`) |
| Layer | rotation — the `angle` field — and opacity |
| Paint | no material fields (`supportsPanelFields()` lists ten shape classes and no `Group`); glass present but **refused with its reason** (`!(object instanceof Group)`, `glass.ts:85`) |
| Spends | read-only: its descendants' effective paint and type presets |

That is name, transform, opacity, and what the children resolve to — which is
exactly the per-building-block model, and it is already implemented. The user's
ruling confirms it; it does not change it.

**The trade, stated because it is the whole cost:** answering *"which sensor"*
for a card costs one Enter, because the question is asked on the child that
carries the binding (a value run, or a chart). The alternative was a layout per
card shape, and a card is an arbitrary group, so the set of layouts is
unbounded. One keystroke beats an unbounded surface.

## 7. Settings

A modal surface opened by the rail's gear. **Set-once choices live here**;
frequently changed controls stay where they are used (§3.1).

| Tab | Holds |
|---|---|
| **Appearance** | The six shell palettes, and follow-the-system |
| **Keyboard** | Rebinding any chord, and the reference |
| **About** | Version and provenance |

**The shell palette chip leaves the header for this surface.** It colours the
*editor*, not the theme, so it is an editor preference. The cost is accepted
knowingly: there is no longer an at-a-glance readout of which palette is active.

## 8. Iconography

Bible §6. The load-bearing requirements:

- **Glyphs are stroke-based, `currentColor`, on a 24px grid, at one weight rule:
  the stroke rises as the size falls**, so the rendered weight stays optically
  even — 1.7px at 14px and above, 1.8px at 11–13px, 2px at 10px and below. One
  family and one rule everywhere.
- **An icon-only control carries the same string as its `aria-label` and its
  tooltip.** One owner; they cannot disagree.
- **The kind glyph set is closed when the kind list is closed** — the object-kind
  glyphs are exactly the insertable kinds.
- **Text is not the interface**: a control that can be a glyph is a glyph, and a
  label appears only where the glyph would be ambiguous.

## 9. The scales are consumed, not declared

The measured defect of the superseded §9, restated as work: the `@theme` block in
`editor-shell.css` declares `--spacing`, `--radius-{sm,md,lg}`, `--text-{xs,sm,md}`
and `--shadow-{raised,overlay}`, and **nothing in the workspace references them.**
The bible's scales must be the ones in the stylesheet *and* the ones in every
surface.

**Acceptance is a count, not a claim:** after this work, a new surface written in
the language adds **no literal px spacing value and no hex colour**, and
`editor-shell.css` no longer holds 73 unique hex values. A grep for a hex value
in a `.tsx` or a surface `.css` is the instrument.

## 10. Appearance

Six palettes (`editorial`, `graphite`, `ember`, `moss`, `plum`, `light`), the OS
appearance as the default, and the author's choice as an override. This already
works — `0035` landed it. **What changes is the readout**, not the mechanism: the
palette is chosen in Settings (§7) rather than from a header chip.

## 11. What this spec amends in the superseded spec

Propagated in the same commit as this file, per `AGENTS.md`.

| Superseded | Amendment |
|---|---|
| §4's opening line, *"A CPU card is not a rectangle. The first question about one is which sensor"* | Reads as promising a card-level column. Amended to say the question is asked on the element carrying the binding, and that a card resolves to a group. The section's *content* is otherwise unchanged and correct. |
| §8, *"A chrome that belongs to its own product, on one primitive library"* | The primitive library ruling stands (`0038`). The chrome is now specified by the bible, and the surfaces it applies to are React (§2). |
| §9, *"Tailwind v4's `@theme` carries the spacing, radius, type and elevation scales"* | True as declared, false as delivered. Amended to point at §9 here and at the bible, with the measurement. |
| The Sequencing table | Replaced — its nine plans assumed a styling pass and cannot carry a rewrite. See §12. |
| §2, *"The device is a lens on the canvas"* | Already superseded mid-spec by the user's ruling that the stage draws no device. The spec's own stale device vocabulary at lines 31–32, 269 and 289 is corrected with it. |

## 12. Sequencing

Ordered by **what unblocks what**, because unlike the superseded table this is a
rewrite and the order is load-bearing rather than presentational. One plan is
active at a time (`AGENTS.md`).

| # | Plan | Why here |
|---|---|---|
| **1** | **Gates and the control set** | `vg-149` first — `.tsx` must be linted and formatted before the editor becomes mostly `.tsx`. Then the one control set of bible §5, as React components, with the scales consumed (§9). Every later plan builds surfaces from it. |
| **2** | **The shell and the rail** | Header, rail, panes' chrome, status bar, canvas top-left/top-right clusters and the relayered dock. Deletes the pane bar and the Insert and Document menus. Visible immediately, and it is what the mockups specified. |
| **3** | **The inspector** | `selection-inspector` rewritten into §6's five sections on the control set. The largest single rewrite and the one §2.3's parity tests guard most. |
| **4** | **The panes** | Composition, Add (absorbing Assets), Tokens (discharging `vg-153`/`vg-094`), Document. |
| **5** | **Settings and appearance** | The settings surface, the palette moved into it, keyboard rebinding. |
| **6** | **Iconography and copy** | The closed glyph set, the accessible-name/tooltip single owner, the copy rules. |
| **7** | **Shell parity with the drawing** (archived: [`2026-10-10-shell-parity.md`](../plans/archive/2026-10-10-shell-parity.md)) | Added 2026-10-10, after the user ruled that the drawing is not replaced and the product is pulled to it. Plans 1–6 ran §13's gate and closed while the shell kept an 8px inset at an off-scale `12px` radius the drawing does not draw, and a graphite that is glass where the drawing is flat. Task 1 made the drawing machine-read, so the gate has a failing state; the shell's composition, radius scale and chrome treatment followed. **Closed 2026-10-11** — the whole-branch review is in its ledger, and §13's capture sits beside the drawing at `docs/design/mockups/current/`. |
| **8** | **Settings parity with the drawing** | Added 2026-10-10. Thirteen of the modal's nineteen measured regions drift from the drawing's settings section; it consumes plan 7's instrument and its radius and chrome decisions. |

**Execution order since 2026-10-10: 7 (closed 2026-10-11), 8, then 6.** The parity plans run first
because plan 6's first task is a census *of the surfaces as they landed*, and a
census of a shell whose composition and chrome are about to move would be redone
against the moved shell. Nothing in plans 7 or 8 closes plan 6's items, and
plan 6's glyph and copy work is unchanged by them.

Plans 1 and 2 of the superseded table — *Groups in the starter* and *The device
lens* — are **already landed** and are not re-run; the register's `vg-152`
records the bookkeeping error that said otherwise. Their visible outcomes (8 rows
in the starter; the lens as the zoom control) are assumed by this spec.

**Every plan above ends with a mockup-parity gate (§13).** That is not a
suggestion attached to the table; it is a completion condition of each plan, and
a plan that cannot show its parity capture is not finished.

## 13. The reference is checked, not remembered

The mockups are saved at [`docs/design/mockups/`](../../design/mockups/README.md)
as standalone pages, and they are the **target**: the whole shell, the control
vocabulary, and the language in both palettes.

**Why this section exists.** The previous pass closed with "the redesign is done"
against an editor that looked nearly unchanged. Nothing in that pass compared
what was built to what was designed — the design lived in a conversation and in
stale mockups, and the gap between them was invisible until a person opened the
product. A reference nobody checks decays into a memory, and a memory cannot be
wrong out loud.

**The gate, for every plan whose phase changes a visible surface:**

1. The plan's final task builds the bundles and **captures the surfaces it
   changed**, using the existing mechanism and its rules
   (`YUNARI_CAPTURE=1`, `--workers=1`, previewing built bundles, capturing only
   actions registered in `docs/evidence/screenshots/README.md`).
2. The capture is placed **beside the matching mockup** and the differences are
   listed in the completion report. Side by side, in the report — not a claim
   that they match.
3. Every difference is either **fixed**, or **recorded in the commit as
   deliberate** — and a deliberate difference must **name the normative source
   that requires it**, quoted, and that source can only be a bible `§N`, an ADR,
   or this spec. A third state — unnoticed — is what this gate removes; a fourth
   is what it closes: a difference kept because nothing forbade it.
4. **A gate that produces no comparison has not run.** An empty diff is a
   finding and must be stated as one, exactly as an empty output file proves
   nothing about a subagent.

**The mockup governs wherever the written rules are silent.** Silence is not
permission — it is the drawing's jurisdiction. A surface that differs from the
mockup is brought back to it unless a named rule positively requires the
product's treatment, and "the bible does not say" is the argument *against* a
divergence, never for one. This rule is written after it was missing: plans 1–5
ran this gate exactly as steps 1–4 above specify, and closed. Plan 5's Task 6
listed eleven differences and recorded ten as deliberate, each with a reason
that cited a section's **silence** as the warrant — D1 kept a horizontal tab
strip because "§7 fixes the three tabs and what each holds, not their axis";
D2 kept two-column radio rows where the drawing has a 3×2 grid of cards; D3 kept
the absence of the drawing's explanatory line; D9 kept the palette's glass where
the drawing is opaque. Every one was locally reasonable and collectively they
are a settings modal that does not look like the drawing, which the user said in
those words on 2026-10-10 ("Even the setting panel you just built looks nothing
like it"). The gate could not catch it because "with the reason" admitted any
reason. **A parity report is now read for what its citations prove, not for
whether it has one.**

**A rule the plan itself wrote cannot license that plan's divergence.** Plan 5
amended bible §5 to add the choice row, then cited §5's choice row as the warrant
for drawing the palette choice as radio rows where the mockup draws cards — and
that is the *only* one of the modal's measured differences backed by a bible
section at all. Amending the written language is legitimate: §5 is a closed
vocabulary and a plan that adds a control must name it. But a section added or
changed in the same plan is evidence of what was decided, not a rule that
required it, and it does not discharge this gate. Only a licence that predates
the divergence counts.

**Not pixel equality.** Platform font metrics, scrollbar widths, device pixel
ratios and antialiasing differ; a difference in those is not drift. The
comparison is of **language**: scale, spacing, alignment, hierarchy, colour
roles, control treatment, icon weight. `docs/evidence/screenshots/` states the
same rule for the same reason — screenshots are evidence, not golden files.

**The mockups are kept current or they are deleted.** When a ruling changes the
design, the bible, the mockup and this spec move in one commit. A mockup that no
longer matches the bible is worse than no mockup, because it is believed.

**Ruled by the user on 2026-10-10: the mockups are not replaced.** The drawing
stays the target and the shipped surface is pulled to it. So replacing the file
is **not** an available disposition for a difference this section records — the
loop above has one exit, and it is the product. The mockup may still be edited to
correct a drawing that is **stale or self-contradictory** (a sentence about
behaviour the product has since ruled differently, a control the bible has
renamed, a tab the spec has removed): that is repair. It may never be edited to
**bless a divergence the product chose**, which is what plan 2's Task 10 and plan
5's Task 6 did — twenty-two and ten differences respectively were recorded as
deliberate while the drawing was left standing, and `vg-291` carries the result.
A surface whose divergence is real is now corrected in the product, or the
objective stays open.

### 13.1 Evidence states and interaction proof

Each requirement closes as **met**, **not met**, or **blocked**, with a named
check and the rebuilt commit. A deliberate visual difference may explain a
platform glyph or an illustrative name; it cannot waive a required capability,
a missing React surface, keyboard access, contrast or safe editing.

A screenshot proves one rendered state, not the behaviour behind it. Every
surface owner also proves its applicable states: empty, populated, selected,
focused, refused, invalid, and pending/failed where I/O exists. No new synthetic
loading state is required for synchronous controls. Pending work prevents
repeat submission; failure preserves authored data and offers an existing retry
route. Success copy follows acknowledged success, not the start of a request.

**Keyboard-only walkthrough:** create/open a document, choose a rail pane,
select through Composition, edit and cancel a field, enter/exit a group, open
and close a popup, choose a palette, cancel shortcut capture, and return to the
original document without unintended history. Each region has a reachable
focus target; Escape affects one innermost owner. Plans 1–5 prove their parts;
plan 6 assembles the real-host walkthrough, not another test framework.

**Visual stress set:** all six palettes for text/focus contrast, graphite and
editorial for captured states, 1280×720 and 1440×900, 200% browser zoom, a long
Unicode name, a long unresolved reference, and the two-hundred-row Composition
fixture. Reduced-motion and forced-colours checks belong to the same browser
gate. The phone limitation remains named, never mistaken for desktop proof.

**The gate is mechanical, and plan 1 builds the model for the rest.**
`packages/editor/control-fixture.html` — built by its own invocation,
`npm run build:fixture`, so it is absent from the editor's production output and
`index.html` keeps the chunk graph it had before the fixture existed — mounts the
built control set over the built stylesheet at `/control-fixture.html` on the
editor preview, and `tests/e2e/design-language.spec.ts` asserts against it in a
real browser: every padding, margin and gap the check reads is a bible §3 step;
no element the
check reads paints a colour outside the set §4's roles resolve to, which is
`color`, `background-color`, border and outline colour on elements at least 2px
on a side — **a gradient set through the `background` shorthand passes it**, and
`background-image`, `box-shadow` and SVG `fill`/`stroke` are not read at all;
every target has §5's 24×24 hit area without overlapping a neighbour; required
text meets 4.5:1 and the boundaries §5 binds — the focus boundary and a control's
only separation — meet 3:1 in all six palettes; the gate holds one 3:1 floor of
its own beside §5's — a checked control's accent fill against the surface under
it, which is a state's mark rather than a boundary, because the switch's knob
also moves and changes colour; a **divider** carries no floor (§5's narrow
reading, `vg-200`/`vg-318`) **with a named debt**, because three cells are pinned
below 4.5:1 today (`vg-201`'s `--warn` text) as measured floors that fail if they
get worse; the slider's thumb is measured against both halves of its own track
and must beat each with its interior or its ring — the thumb is two parts
because no flat colour can, which left the unfilled half at 1.81:1 in graphite
and 1.35:1 in light;
hover raises a control's resting `--edge` to `--muted`, read from the rendered
border rather than the class and in graphite alone — both are roles, and they are
measured distinct in all six palettes, so one palette proves a rule about roles —
and a blocked well and the checked toggle do not move;
focus survives forced colours; layout holds at both viewport sizes and at 200%
zoom with the long Unicode name; and reduced motion leaves nothing animating,
after motion is first *allowed* to prove the probe can see motion at all — **a
check that cannot fail is not a check**, which is how the first version of this
one passed while proving nothing. Computed styles are read for geometry and the
rendered pixel for anything the cascade cannot answer, so the gate proves
*rendered treatment*; token provenance stays the source ratchet's
(`scripts/design-tokens.mjs`, `npm run design:check`), which is why the fixture
is a gated file too. A pinned floor is deleted when its row is ruled on. Plans
2–6 reuse the fixture and add their own surface captures beside it.

## Invariants

Untouched by this design, and restated so the rewrite cannot quietly break them.

- **Fabric stays imperative behind the editor boundary; React never mirrors an
  object.** §2.1. This is the invariant the whole decision turns on.
- **One owner per concept.** `OBJECT_ACTIONS`, `arrangeActions()`,
  `CARD_LIBRARY`, `SHAPE_KINDS`, `CHART_FAMILIES` and `insertGroups()` keep
  theirs; every surface renders from them and re-derives nothing.
- **`renderer-core` stays Fabric- and DOM-free**; the player's import boundary
  and bundle gate hold.
- **Persist authored state only.** Viewport, collapse, selection and device
  choice are transient. The render rewrite must not add persisted UI state.
- **Never fabricate a reading.** A missing or non-`ok` sample stays a gap.
- **No second scene tree, no second renderer.** Fabric JSON is still the document.
- **Editor-shell theming stays separate from authored theme globals** — the shell
  palette colours the editor, never the theme.

## Review handoff — 2026-10-08

This review edits contracts and references, not product delivery. Existing
plan-1 Tasks 1–2 remain complete; Tasks 3–4 remain active. Plans 2–6 remain
queued. No new active plan, implementation dispatch or verified backlog row is
created by a documentation correction.

| Review risk | Contract and owner | Failure proof required at execution |
|---|---|---|
| Controls look editable but have no edit API | Plan 1 Task 3: Text, Swatch, Well composition, data hooks, disabled action semantics | Type/name/commit checks on mounted controls; an unwired callback fails |
| A stale blur edits the next selection | Plan 3 Task 1: expected target revision and current eligibility | A draft from A cannot mutate B, including history/crop replacement |
| React wrapper hides imperative chart UI | Plan 3 Task 3a: both chart field-port contracts and rendering | All visible descriptors reach controls; nested writes survive reopen |
| Dialog/font UI falls between plans | Plan 5 Task 4a: chooser, library, persistence dialogs, font picker | Real journeys preserve validation, I/O failure and focus return |
| Keyboard capture conflicts or dismisses two layers | Plan 5 Task 3: effective match semantics and Dialog dismissal coordination | Alias/Shift conflicts, malformed storage, capture Escape then modal Escape |
| Palette override lies when storage fails | Plan 5 Task 2: live session preference separate from persisted preference | Both toggle directions, denied storage, OS changes, portalled surfaces |
| Asset move loses declarations or changes the wrong scope | Plan 4 Task 4: declared library and byte-replace semantics | Font/video/unplaced file survives; referenced removal refuses; failed replacement preserves bytes |
| Library browsing masquerades as selected-run state | Plan 4 Task 7: separate library item from selection reference | No preset, unresolved, multiple runs, explicit browsing and undo |
| Pretty capture waives a missing capability | §13.1 and plan 6 Task 8: met/not met/blocked evidence | Whole-editor inventory and real-host keyboard walkthrough; no closure while required items fail |

**Plans are contracts.** Their example `it(..., () => {})` blocks are named
cases, not runnable proof; an executor must supply real setup, actions and
assertions in the owning suite. Existing passing behaviour is preserved
baseline, not an invented first-run failure. Before dispatch, resolve any
proposed type against its owning source, name the task's file ownership and
confirm no overlap. Do not copy old line numbers, test counts or deleted paths
as current facts.

**Verification commands are illustrative where they contain placeholders.**
Replace title regexes with actual registered titles, inspect collection and
failure counts in runner JSON, and use scratch paths outside the repository.
Do not interpret a malformed-config error as proof of the empty-list rule, a
nonempty screenshot as proof of wiring, or a lexical guard as proof of contrast.
Rollback of deliberate breaks must restore only the change made for the proof,
never discard unrelated work. A Windows executor uses valid local paths and
shell syntax, not an assumed `/tmp` directory.

**Closeout remains conditional.** Every plan updates its evidence and hands off
to the next in order. The six-plan redesign closes only when Acceptance is met;
finishing plan 6's glyph/copy tasks is not enough. Registered but unrelated
findings remain in the product register, not duplicated in this handoff.

## Non-goals

- **No behaviour change.** No new field, no removed capability, no changed
  eligibility rule. §2.3 is the whole of it.
- **No new dependency.** React 19 and Base UI are present; `0038` stands.
- **No mobile or narrow-viewport authoring.** The editor stays desktop-only
  (`vg-172` remains an open defect about the header at 390px, and this spec does
  not claim to close it).
- **No canvas change.** Interaction, snapping, rendering and the display lens
  are untouched.
- **No player change.** The player has its own chrome.
- **No theme-format change.** Nothing here alters what a theme may carry.

## Acceptance

Rendered observation in a real browser, on a rebuilt bundle. Counts are
necessary, never sufficient; §13.1's interaction and stress proof also applies.

- **Every editor surface is React**, including chart fields, file dialogs,
  the new-document chooser, theme library and font picker; no imperative UI
  island survives under a React wrapper. Fabric and its interaction loop stay
  imperative.
- **Edits are safe transactions.** Enter and blur cannot double-save; Escape
  cancels; invalid/empty drafts never become zero; optional clearing removes
  the key; stale events cannot edit a new selection; one completed slider or
  scrub gesture creates one history entry. IME input and caret position survive
  normal publications.
- **Keyboard and contrast are observed.** §13.1's walkthrough runs on the real
  host. Normal required text meets 4.5:1 and the boundaries §5 binds — focus and
  a control's only separation — meet 3:1 in all six palettes (a **divider**
  carries none, `vg-200`/`vg-318`) **with a named debt** (three cells are pinned
  below those ratios today as measured floors that fail if they get worse, §13.1);
  forced-colours focus stays visible. Long names,
  unresolved references and 200% zoom leave controls and reasons reachable.

  **Met at `472ca4c5`** — `tests/e2e/host-walkthrough.spec.ts`'s *"§13.1's nine
  interactions in order, on the real host, and the original document comes
  back"* drives all nine interactions in §13.1's own order: a document created
  from the starter, a rail pane chosen, a selection made through Composition, a
  field edited and cancelled, a group entered and left, the stage's popup opened
  and closed, a palette chosen, a shortcut capture cancelled, and the return to
  the `e2e-hosted` fixture the walk booted on. The round trip is measured twice —
  the identity chip names the fixture and the document's own persisted envelope
  equals the one read before the walk — with 0 history entries recorded from the
  second interaction through the eighth, counted from after the create remounts
  the shell and stopped before the return trip remounts it again, and
  §13.1's other two invariants are swept in the state the walk leaves:
  the Escape that dismisses Settings affects that one owner, and every region
  still has a reachable focus target. The check runs in the `desktop-host`
  project, which boots the real host through its own `webServer`; the whole
  project was run at `c825ec75` (`--workers=1`: 47 expected, 1 skipped, 0
  unexpected), whose other specs this fix round does not touch. This is the
  clause plan 6's ledger recorded as **NOT MET**, and it is the last one keeping
  the redesign objective open. The contrast,
  forced-colours, zoom and long-name half of the item is §13.1's mechanical gate
  above, recorded met in that same ledger rather than re-run here.

- **The scales are consumed.** A ratchet over the files listed in
  `scripts/design-tokens.gated.json` — 71 of them today, counted rather than
  carried in this sentence — `npm run design:check`, not a grep over
  all sources; a file outside the list is not covered — finds a surface using a
  spacing value not in the bible's steps, or a hex colour outside the palette
  roles, **fails**. An automated check, not a review note — §9's whole point is
  that the last one was a review note.
- **No native `<select>` and no native `input type=range` remains in an editor
  surface.** Counted, before and after.
- **Every panel's existing behaviour survives its rewrite**, shown by that
  panel's own tests passing unchanged in intent, with every re-pointed locator
  demonstrated to fail when its behaviour is disabled.
- **Nothing selected → the inspector is empty and says where to choose from.**
- **A card selects as a group**: its column shows name, transform, opacity and
  its children's effective appearance, and **no property a group does not have**.
- **A text run's binding is one Enter from its card**, and the value it carries
  answers "which sensor" — the §6 trade, observed rather than argued.
- **The dock shows only what the selection can run**, and greys arrange until
  two objects are selected. Verified with nothing, one, and two selected.
- **The four rail slots each open, and only one is open at a time**, with the
  gear opening settings rather than a fifth pane.
- **The Add pane offers units and primitives, neither greyed**, and its card
  tiles depict units while the Composition pane's card rows do not.
- **The Tokens pane lists paints and presets, and its preset panel is bound to
  the selection** — the `vg-094` defect, shown fixed by selecting a run set to
  one preset and observing the panel name that preset.
- **The stage draws no device frame**, and its three corners hold identity, view
  and dock respectively.
- **Six palettes are distinguishable by surface**, by screenshot rather than by
  computed value (§9 of the superseded spec, carried).
- **Every plan's parity capture exists, and every difference it lists is either
  fixed or backed by a cited rule that requires it** (§13): each plan's
  completion report carries its capture beside the matching mockup in
  `docs/design/mockups/`, and a difference recorded as deliberate names the bible
  `§N`, ADR or spec section that positively requires the product's treatment.
  **A plan that reports parity without the two images side by side has not met
  this item**; neither has one whose deliberate differences rest on a rule's
  silence, and an empty difference list is stated as a finding rather than
  assumed.

### Where each item stands, counted

Counted on 2026-10-12 by running each item's own check rather than reading its
annotation, which is §13.1's rule for closing one — a named check and the rebuilt
commit. Fifteen hold; the last does not, and it is the only thing keeping the
redesign objective open. **Reviewed on 2026-10-13, which is a different act from
counting**: every row this section names as open was looked up in the register,
and two named blockers had already been discharged — the palette preview bar's
role, ruled by the user and landed on 2026-10-11 (`vg-321`), and `vg-325`, named
open after it had closed. Neither changes the verdict; both were costing a reader
a ruling that no longer existed. Until this section carried them, fifteen of the sixteen
verdicts lived only in the archived acceptance ledger of plan 6
([`plans/archive/2026-10-08-iconography-and-copy.md`](../plans/archive/2026-10-08-iconography-and-copy.md)),
which is a plan artifact rather than this spec's own statement.

**Re-checked against the whole browser suite on 2026-10-13, which is a third
act again.** Two whole-suite runs now exist — `3a368c6a` and `aa16a2c5`, each
273 passed, 18 failed, 214 skipped — and **their red memberships differ by nine
of eighteen**, so a whole-suite red count is the load the config names rather
than a defect list, and it is why no item here was ever closed on one. Every
acceptance-named check that was red in either sample passes at HEAD: the
control-set case once the run has built the fixture (`vg-438`), the rail's
accent bar after `8b1b9106`, and `shell-appearance.spec.ts`'s flat-chrome case
in a serial re-run at the same commit — so **the fifteen verdicts stand, and
none was resting on a check that is red**. The only persistent reds are the two
phone-`chromium` `editor-display` cases, `vg-258`, which are not the
device-frame claim this section names. The instrument is therefore the item's
own targeted run, which is what each annotation below cites; the whole-suite
pass is a smoke test over the same bundle, not the check.

- **Every editor surface is React** — the five surfaces are React and gated, and
  the one imperative UI module is ADR-0033's exemption — **met**, and it is the
  one item no gate runs: it is a reading.
- **Edits are safe transactions** — `control.dom.test.tsx` and
  `preset-list.dom.test.tsx` (43 cases) plus `inspector-sections.spec.ts` —
  **met**.
- **Keyboard and contrast are observed** — `design-language.spec.ts` (10 passed)
  and the real-host walkthrough — **met**, annotated above. That count is the
  whole-suite run at `aa16a2c5` with the fixture built; a run whose build
  skipped `build:fixture` reads 9 and the tenth failure is a missing page, not
  a violation (`vg-438`).
- **The scales are consumed** — `npm run design:check`, 71 gated files clean —
  **met for the gated subset**, with its two coverage gaps named and open
  (`vg-274`, `vg-286`). **`vg-286`'s discharge is not a task waiting on a
  session but one sentence from the ruling's own owner**, measured on
  2026-10-13: D5 ruled that test files join the gated list, no phase of the
  active plan carries it, and the membership test it names — “a test file that
  renders the shell” — is one the checker cannot evaluate, because a rule keyed
  on literals gates 275 test files and 732 violations while a rule keyed on
  imports misses the six `tests/e2e/` specs that are most of the row's own
  violators. Which of the two readings the ruling means is the sentence.
- **No native `<select>` or `input type=range`** — the panes assert zero of each
  in the running gate — **met as written**; the clause's *count* is a one-time
  ledger reading, and the residue is `vg-266`/`vg-271`, open.
- **Every panel's behaviour survives its rewrite** — the panel suites pass on the
  rebuilt bundle (`composition-panel`, `inspector-sections`, `add-pane`,
  `editor-rail`, `editor-display`, `shell-appearance`) — **met**, with plan 3's
  red-proof ledger no longer on disk.
- **Nothing selected → the inspector is empty and says where to choose from** —
  `inspector-sections.spec.ts` — **met**.
- **A card selects as a group, with no property a group does not have** — the
  same file — **met**.
- **A text run's binding is one Enter from its card** — `editor.spec.ts`'s
  round-trip case — **met**.
- **The dock shows only what the selection can run** — `editor.spec.ts`'s dock
  capture — **met**.
- **The four rail slots each open, one at a time, and the gear opens settings** —
  `editor-rail.spec.ts` and the pane captures — **met** (`vg-330` supersedes the
  gear half later and is not fixed forward).
- **The Add pane offers units and primitives, neither greyed** — `add-pane.spec.ts`
  with `composition-panel.spec.ts`'s row assertions — **met**.
- **The Tokens pane lists paints and presets, bound to the selection** —
  `preset-list.dom.test.tsx`'s `vg-094` case, and `vg-094` is closed — **met**.
- **The stage draws no device frame** — `editor-display.spec.ts` — **met**.
- **Six palettes are distinguishable by surface** — `shell-appearance.spec.ts`
  and the six committed PNGs — **met**; the "read rather than computed" half is a
  one-time human reading, not a gate.
- **Every plan's parity capture exists, and every difference is fixed or backed
  by a cited rule** — **NOT MET**. Plans 6, 7 and 8 have their captures
  registered. Plan 8's own completion report rules the second clause *"NOT met
  for the plan's closure condition"*: six of its differences are `fix` with
  owners outside that plan, and the rows that carry them are open today
  (`vg-316`, `vg-319` and `vg-322`; `vg-274` carried D9's last surviving value
  until 2026-10-13, when the three rules that stated no type were given
  `--text-sm`, so it no longer carries a live difference), and each of the
  three waits on the user rather than on a fixer. **`vg-325` was named here among them and is not
  one**: it is `verified` against `6f9b3492` and `c64ac390` in
  `2026-10-11-settings-parity.md`, and it had already closed when this list was
  written on 2026-10-12 — the row's own red proof reverts `.editor-shell-rail`'s
  `gap` to `3px` and reads the product-side failure naming the drawing's `4px`.
  So plan 8's own differences are three rows, not five — D9's four values are
  all fixed, the last of them on 2026-10-13. **The clause is every plan's, and
  that count is plan 8's alone**: measured across all eight on 2026-10-13
  (`vg-390` carries the census), plans 2, 4 and 7 also list differences whose
  owner is an open row — `vg-230` in plan 2,
  `vg-269` in plan 4, `vg-308`, `vg-310` and
  `vg-274` in plan 7 — while plans 3, 5 and 6 list none an open row owns, plan
  3's four surviving in `9ee1fc21`'s body. **Every one of those rows is a row
  the drain's Phase 1 sessions take** (D3, D5, D6, D10 and the browser-pinned
  follow-up at Task 2.5 Step 4), so this clause cannot be met before those
  sessions run; **two left the list on 2026-10-13, both because a reading
  dissolved the choice rather than answering it** — `vg-265` was a defect (the
  state slot painted over the role on every row at rest) and is fixed and
  verified at `7588f5bc`, its decision having moved one state further in to
  `vg-447`; `vg-270` was a difference that no longer existed (`0e7b3405` gave
  the well's column row its `min-w-0`) and is verified at `8eff3abf`, where a
  red proof against that same declaration reproduces it. **`vg-227` left the
  list on 2026-10-13 by the other route — a ruling implemented rather than a
  choice dissolved**: its 2026-10-12 ruling took the rail's slot to 36px and
  gave §5 a **Rail slot** row rather than stretching the icon button's range, so
  the one control larger than an icon button now has a vocabulary entry of its
  own; it is verified at `64871ccd`, where a browser case pins the slot's width
  and the accent bar's re-derived offset together and reddens on either moving
  back. **`vg-222` left the list the same day by that same route**: its ruling
  settled which of the shell's two cluster treatments is the product's — the dock
  and the view cluster came down to §3's elevation 1, which the user's later *all
  six palettes, all flat* ruling is what landed (`d0c67844`) — and the identity
  chip's own `backdrop-filter`, the last declaration of the other treatment and
  dead in the build, went with them (`f7f838dc`), so the case that reads §7.5's
  three clusters as a set now also asserts the stylesheet authors no blur for the
  build to drop. **`vg-225` left the list the same day, and it is the first on it
  that the ruling answered by amending the language rather than the product**:
  §5's closed vocabulary had no entry for a control that is a value display and
  opens a list, so it gains **Bare readout** and the zoom keeps its bare
  percentage (`61d7435b`), where a browser case reads the control's text, fill,
  four edges, glyph and the menu it opens. **`vg-260` left the list the same day
  by a third route — a ruling that accepted the difference and gave it a section
  to cite**: the user held the mark slot at 28px on the measurement that disproved
  the narrower one, so the attended row keeps its clip and §7.3 states it — a row
  yields its name and its key before it yields a control — which is the normative
  source this clause requires for a difference that survives rather than one that
  was fixed. The two
  the sessions cannot reach are `vg-316`, a Phase 2 work
  row whose residue is the `DESIGN.md` decision `vg-441`, and plan 1's ten,
  whose owner no record holds. **The capture half is now placed for every drawing**:
  `controls-capture-graphite.png` and `controls-capture-editorial.png` sit in
  `current/` beside `controls.html` and `controls-light.html` (`988d1788`), and
  `settings-keyboard-capture-*.png` and `settings-about-capture-*.png` were
  added beside their comparators while the modal's existing two were re-shot, so
  all six drawings carry a capture pair (`e412c98d`). What the item still lacks
  is the other half: no `.superpowers/sdd/` workspace survives for plans 1 or 3,
  and the archived ledger records that plan 1's ten differences "no longer exist
  anywhere" — so the comparison the second clause asks for can no longer be
  made, which is `vg-390`. No durable record named a capture for plans 2, 4 or 5
  either, which was that same row's question — **and that half is now answered**:
  `docs/evidence/screenshots/README.md` records which surfaces each of the six
  drawings and their eleven captures show, so plans 2, 4 and 5's surfaces are
  photographed (the shell's own pair, the Add pane, the three panes no drawing
  draws, the settings sheets) and what the clause turns on for them is whether a
  capture the record attaches to a later parity plan counts. Plan 4's three
  undrawn panes and plan 6's missing drawing are the residue it cannot reach at
  all, because there is no matching mockup to carry a capture beside — **and
  they are not merely unreachable: the drawings' own README carries a rule that
  requires the panes to have been drawn** (“The current files are refreshed when
  the set of surfaces changes. A pane, a tab, a section or a rail slot that
  appears or disappears is drawn”). That sentence names four things, so it binds
  the three panes and not plan 6's glyph sheet. So this residue is a three-way
  choice rather than a gap: draw the panes and the clause becomes reachable for
  them; narrow this item to the six current drawings; or carry the residue.
  Drawing them is the ruling owner's act, because a drawing is the acceptance
  instrument rather than a description of one.
  **What discharges it, stated so the rows are not read as questions for the
  user:** `vg-316` is the control set's own fill, re-measured on
  2026-10-13 and confirmed a decision rather than a fix — the token carries
  three palettes' tints and editorial's licensed equal rung, so "use `--panel2`"
  would kill the tints or blank the controls in editorial. **The gap behind that
  row is filed as `vg-441`, and it is why the close path the row states is not
  available**: DESIGN.md defines no labelled button at all — `button` occurs at
  `:110`, `:150` and `:203` and always as the primary one, and §5's vocabulary is
  closed with no labelled button in it — so the Close's fill is one of three
  divergent properties on a control no rule assigns, and neither the product's
  treatment nor the drawing's can be called wrong by a cited rule; the row now
  waits on a DESIGN.md decision rather than on a §4 colour-role correction.
  `vg-319`'s two
  remaining facts are each one sentence on the row now: §2 **reserves** uppercase
  for the shell surfaces it names, and §5 rule 2's **escape clause** may already
  cover the read-only row both sheets draw with a 16px gap. `vg-274` no longer
  carries a live difference at all: D9's four values are fixed, the last of them
  on 2026-10-13, when the three rules that stated no type were given §2's control
  text with its companion — and a browser reads the value a person sees
  (`add-pane.spec.ts`, red at `Received: "13px"` before the declaration and green
  after). What stays open on that row is its own subject, the file's gate
  membership, which the row itself calls a design decision rather than a task. **`vg-322` is not a width anyone can choose.** The user rejected
  that question rather than answering it on 2026-10-11 — "Setting should not be a
  modal but a panel like add, composition" — so its 405/507/393px measurements
  are of a container that is going away, and by its own words it "closes when
  `vg-330` does". `vg-330` is **parked by the user**, so this item cannot be met
  while that parking stands: there is no width ruling to take, and the difference
  is neither fixed nor backed by a cited rule, because a parked workstream is not
  a rule that requires it. Two acts by the user discharge that half — unpark
  `vg-330`, or narrow this item so a surface scheduled to disappear is not one of
  the differences it counts. The rest is a decision on the plans 1–3 wording:
  reproduce the comparison or narrow the item. **The palette preview bar's role is
  no longer among them**: the user ruled on 2026-10-11 that the bar depicts the
  palette's ground, `--shell-backdrop` — the product's reading — the drawing's
  five solid bars were repainted to it, and five `PARITY` rows now read a bar's
  colour where the only row before read its height (`vg-321`, withdrawn as done
  and not a defect; `mockup-values.ts:1153-1200`).

## Ruled during review

- **Reactify everything.** Every editor surface becomes React; only the canvas is
  imperative. The alternative — styling the imperative half — was rejected
  because the control vocabulary would then be built twice or the panels would
  keep their own look, which is the measured failure of the last pass.
- **The bible is a separate normative document**, not a section of a spec that
  closes.
- **A card is inspected as a group.** No per-card column; the sensor question is
  asked on the child carrying the binding. Confirmed against the code rather than
  decided fresh — the code already does this.
- **`Document` is a rail slot**, so it leaves the menubar.
- **`View` stays in the menubar.** Frequently changed while designing; Settings
  is for set-once choices.
- **The shell palette moves into Settings**, and loses its at-a-glance readout.
- **The stage's corners are separated by question**, view at the top, selection
  at the bottom.
- **The horizontal pane bar is deleted**, replaced by the vertical rail.
- **A group's layer row gets a generic glyph**; a card *unit* tile in the Add
  pane may be depicted, because the card library is a fixed set.
