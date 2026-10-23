---
name: Yunari
description: The editor's visual language — the one normative design document.
version: alpha
spacing:            # --space-* — the steps a surface may write
  4: 4px
  6: 6px
  8: 8px
  10: 10px
  12: 12px
  14: 14px
  16: 16px
  20: 20px
  24: 24px
  32: 32px
rounded:            # --radius-*
  sm: 4px
  md: 6px
  lg: 8px
  xl: 10px
typography:         # --text-* with their stated line-height companions
  2xs:
    fontFamily: "system-ui, sans-serif"
    fontSize: 10px
    lineHeight: 1.2
  xs:
    fontFamily: "system-ui, sans-serif"
    fontSize: 11px
    lineHeight: 1.3
  sm:
    fontFamily: "system-ui, sans-serif"
    fontSize: 12px
    lineHeight: 1.4
  md:
    fontFamily: "system-ui, sans-serif"
    fontSize: 13px
    lineHeight: 1.3
  lg:
    fontFamily: "system-ui, sans-serif"
    fontSize: 15px
    lineHeight: 1.3
  xl:
    fontFamily: "system-ui, sans-serif"
    fontSize: 19px
    lineHeight: 1.2
omitted:
  - section: colors
    reason: The palette resolves per theme at runtime (ADR-0035); one YAML value per role would be false. The roles and their per-theme values are normative in the Colors section below.
  - section: components
    reason: The control vocabulary is normative as prose and implemented in packages/editor/src/components/ui/; tokens would be a second owner of it.
---

# Yunari design language

**Normative.** Every editor surface is built from what is written here, and a
new surface that needs something absent from it changes this file in the same
commit rather than inventing a local exception. The design record for *why* is
[`docs/superpowers/specs/2026-10-08-editor-design-language-design.md`](docs/superpowers/specs/2026-10-08-editor-design-language-design.md);
this file is what that spec produced and what later work reads instead of
re-deriving.

Scope: **the editor**. The player has its own chrome rules, and the canvas —
inside the artboard — is the author's design, not ours.

## Overview

<!-- §1 -->

**The editor is quiet so the dashboard is loud.** The themes this product makes
are dark, saturated and dense with data. Every part of the editor that is not
the artboard recedes: one accent, used for one thing at a time, and no surface
of its own competing with the artboard for attention.

Two consequences that decide most arguments:

- **Chrome does not decorate.** If a border, shadow or colour does not
  distinguish one thing from another, it is not there.
- **Text is not the interface.** A control that can be a glyph is a glyph; a
  label appears where a glyph would be ambiguous, and in a tooltip where the
  glyph is standard.

## Colors

<!-- §4 -->

Colour is a **runtime palette**, not a set of literals. Six palettes ship
(`editorial`, `graphite`, `ember`, `moss`, `plum`, `light`); graphite is the
default, an OS reporting a light appearance gets `light` instead, and the author
may override either in Settings.

A surface never writes a hex value. It writes one of these roles, and the
palette resolves it:

| Role | Meaning |
|---|---|
| `--bg` | The window behind everything |
| `--stage` | The area around the artboard |
| `--panel` / `--panel-2` | A panel, and a control inside it |
| `--yunari-control-bg` | A control's own fill, between `--panel-2` and the ground; a palette whose control surface differs declares its own |
| `--hdr` | The header and the dock chrome |
| `--edge` / `--edge-2` | A boundary, and a fainter one (dividers inside a section) |
| `--text` | Primary text |
| `--muted` | Secondary text, labels, inactive icons |
| `--faint` | Tertiary: counts, hints, disabled glyphs |
| `--accent` | The one thing the author should do or has done |
| `--warn` | Something needs attention; not an error |
| `--hot` | Destructive. Delete, and only delete |

**`--accent` is rationed.** At most one accent-filled element is visible in a
region at a time: the selected rail slot, the focused control, the selected row,
the primary button. Two accents in one region means neither is the accent.

**`--hot` marks destructive affordances only.** It never marks "important", and
a disabled destructive control stays `--faint` rather than dimming red.

## Typography

<!-- §2 -->

Three families, each with one job.

| Family | Job | Where |
|---|---|---|
| UI sans (`system-ui` stack) | Everything a person reads as language | Labels, menus, headings, panel copy |
| UI mono (`ui-monospace` stack) | Everything a machine produced or will parse | Values, coordinates, token names, chord marks, counts |
| Theme fonts | The author's typography | Inside the artboard only; never in chrome |

**Values are mono; labels are sans.** This is the single largest difference from
a form-shaped panel and it is not decorative: a mono value is scannable by
column and cannot be mistaken for prose. A number a person types is mono. A
number that is prose ("three parts") is sans.

### The scale

| Token | Size | Line height | Used for |
|---|---|---|---|
| `--text-2xs` | 10px | 1.2 | Section eyebrows, badge marks |
| `--text-xs` | 11px | 1.3 | Panel rows, hints, status bar |
| `--text-sm` | 12px | 1.4 | Control text, menu items, list rows |
| `--text-md` | 13px | 1.3 | The selection's title, panel titles |
| `--text-lg` | 15px | 1.3 | Dialog titles |
| `--text-xl` | 19px | 1.2 | Empty-state headings |

Uppercase is reserved for **section eyebrows** — Content, Position, Layer,
Paint, and the group headings in the Add pane. An eyebrow is
`--text-2xs`, `600`, `letter-spacing: .11em`, muted, and it always labels a
region, never a control. Nothing else is uppercase: a chord is printed as the
platform prints it, and a menu row is sentence case.

Weights: `400` body, `500` emphasis inside a row, `600` titles and eyebrows,
`650`–`700` only for the brand mark and a primary button. Nothing is bolder than
`700`.

## Layout

<!-- §7 -->

```
┌───────────────────────────────────────────────────────────────┐
│ header     brand · File · Edit · View ·············· ⌘⇧P Publish│
├────┬──────────────┬───────────────────────────┬───────────────┤
│rail│ pane         │        stage              │  inspector    │
│ 46 │ expanding    │  ┌ chip ─────── view ┐    │               │
│    │              │  │      artboard     │    │               │
│    │              │  │      [dock]       │    │               │
│    │              │  └───────────────────┘    │               │
│ ⚙  │              │                           │               │
├────┴──────────────┴───────────────────────────┴───────────────┤
│ status bar        counts · ··············· saved · live        │
└───────────────────────────────────────────────────────────────┘
```

### The scales

<!-- §3 -->

A 4px base. The named steps are the only ones a surface may use:
`4, 6, 8, 10, 12, 14, 16, 20, 24, 32`. A one-off `7px` is a signal that the
layout is being tuned by eye and should be re-derived.

| Step | Use |
|---|---|
| 4 | Inside a control (an icon button, a well's vertical padding) |
| 6 | Between the rows of one section; a well's horizontal padding |
| 8 | Between a label and its control |
| 12–14 | Section padding, panel gutter |
| 16 | Between sections |
| 20–24 | Between regions; dialog padding |
| 32 | Empty-state breathing room |

Row rhythm: a control row is **26px** tall in a panel, **30px** in a dialog,
**32px** in the settings surface. Density does not vary by taste — it varies by
which of those three a surface is.

**The store's gallery grid is 272px minimum per column.** The number is not the
local half's own: it is derived from the **online** half's busiest facts band —
its badge, its counts and its four actions — so a person switching halves does
not watch the grid change shape. It is fixed by the drawing
(`docs/design/mockups/current/store-themes.html`), which states where it comes
from, and the grid is `repeat(auto-fill, minmax(272px, 1fr))`: the column count
follows the width, so no breakpoint is invented for it.

**The store's item modal is 960px wide and its stage is 420px tall.** Both are the
drawing's (`docs/design/mockups/current/store-detail.html`). The width is not the
settings modal's: 560 is a text sheet's box and this one's subject is a picture —
960 against 560, with the stage flush to the box's edges rather than inset by the
sheet's padding. **The stage is one height for every item** and the theme is
contained in it at its own ratio, letterboxed against a ground darker than the
modal's own surface; a stage sized to the item would make the modal change height
as a person steps between items, which is the one thing a viewer must not do.

### The header

<!-- §7.1 -->

**Document-level and editor-level actions only.** A command that has a rightful
home elsewhere is not repeated here — Insert lives in the Add pane, so the
header has no Insert menu.

- Left: brand mark, then the **mode switch**, then `File`, `Edit`, `View`.
- Right: the publish chord, then the **primary button**. `Publish` is the only
  filled, accent-coloured button in the editor.
- **The header never shows the document's identity** and never shows a
  per-document readout. Both are on the canvas (§7.5).

**The header carries the shell's mode switch, and there is no bar under it.** The
shell has three modes — the editor, the theme store and the host — and the switch
between them is the header's own control, a §5 `Segmented` with the labels
`Editor`, `Themes` and `Host`. A strip under the header would be the second
horizontal bar §7.2 forbids, so the header owns the choice and its **right-hand
region is per-mode**: `File`/`Edit`/`View` and the publish control are the
editor's, a mode with actions of its own carries them there, and a mode with none
shows nothing beside the switch. The editor's own body is hidden, not unmounted,
while another mode shows — a mode switch never loses an unsaved document, and it
asks before it leaves a dirty one (`docs/decisions/0074`).

Why `View` stays: the things in it — preview/source, chart refresh, run display
— are changed *while* designing, many times a session. Settings is for
once-in-a-while choices. A frequently changed control one level deeper is a tax
paid on every use.

### The rail

<!-- §7.2 -->

A 46px vertical strip of glyph slots at the window's left edge, with the
settings gear pinned to the foot. **Four slots:**

| Slot | Glyph | Holds |
|---|---|---|
| Composition | stack | The scene tree, and the object actions that act on it |
| Add | plus | Everything insertable, and placing a file |
| Tokens | palette | The theme's paints and type presets — created and edited here |
| Document | page | Artboard, metadata |

**At most one slot is open at a time.** Asking for the open slot closes it;
asking for another replaces it. The pane occupies its own layout track beside
the rail. Opening it may resize the available stage, but never translates
objects or writes authored coordinates; the viewport owner handles fitting.
The existing open/close layout behaviour survives the rewrite, rather than
introducing an overlay that hides artwork or controls. The selected slot carries the accent glyph, an accent
wash, and a 2px accent bar on the rail's inner edge.

The rail replaces the horizontal pane bar. A second horizontal bar under the
header is forbidden: two stacked rows of navigation make the first one read as
chrome rather than as a choice.

### Panes

<!-- §7.3 -->

Width 246px by default. Structure, top to bottom:

1. **Title bar** — glyph, title, and the count or a single pane-level action.
2. **Body** — scrolls. Sections use the §2 eyebrow.
3. **Footer toolbar** — optional, and present where a pane's items have a set of
   actions. Icon buttons at 26px, from the same registries the dock uses.

**A pane footer is bounded by its pane.** The scene tree's footer holds the
object actions; it is not a place for global commands, and the status bar is not
a place for tools.

**A row yields its name and its key before it yields a control, and it yields the
role last.** A Composition row that carries every control it can — the twisty,
the entry control on a group, the eye and the lock — and a bound key is wider
than the pane's body, so the row clips rather than dropping a control or taking
the mark slot below 28px. The name and the key give way first; the role gives way
only once they have nothing left, and it is *clipped* rather than *covered*,
because it is the only statement of what a row is on four rows in five: a role
the slot paints over says nothing at all, where a role that ellipsises still says
what it can. This is the pane's trade at its default width and not a defect to be
measured away — the mark slot is already at the floor its own contents set, so
narrowing it moves the clip rather than removing it.

### The inspector

<!-- §7.4 -->

Right column, 276px. **The selection's column answers the question the selected
thing actually raises**, and describes what the thing *is*:

| Section | The question |
|---|---|
| **Content** | What is it, and what does it show? |
| **Position** | Where does it sit, and how big? |
| **Layer** | How does it present? |
| **Paint** | What ink? |

- The column opens with **the subject**: its kind's glyph, then its name at
  `--text-md`, and the binding key beneath the row when one is bound — a
  multi-selection, which has no kind of its own, draws the name alone. It does
  not open with a chrome label, and **the kind is that glyph, not a line of its
  own**: `vg-466`, the user's item 9, took the type label away for the icon.
- **A section with nothing in it is not rendered** — no header, no zero count.
- **Every section opens; none starts closed**, with one exception: the
  `advanced` treatment, a disclosure a caller mounts deliberately and that a
  selection never asks for, so it opens closed and counted. Position used to be
  closed for the same kind of reason — geometry is set once — but a new object's
  position is what it is usually selected *for*, so that asymmetry cost more than
  it saved. The column stops deciding this for the author; a reader may still
  close a section, and §8 keeps that disclosure.
- **A property a kind does not have is not shown as a field.** Where the
  capability exists but this selection cannot carry it, the row renders refused
  with the reason (see §5.3).
- **There is no per-card column.** A card is a `Group`; groups get name,
  transform and opacity. The question "which sensor" is asked on the element
  that carries the binding.
- With nothing selected the column is empty and says where to choose from.

### The stage

<!-- §7.5 -->

The artboard sits centred on the `--stage` ground and **is never drawn inside
a device frame**. The stage is the author's whole surface. Preserve the
reference's artwork-led composition, fine chrome and restrained depth. Subtle
palette-derived stage texture is permitted when it stays behind the artwork
and does not obscure controls; neither texture nor a flat ground is mandatory.
The warm gradient is illustrative authored artwork, not a shell background to
hard-code into every document. A lens changes the view rectangle, never
authored artboard dimensions.

**Three corners, one question each:**

| Corner | Question | Contents |
|---|---|---|
| Top-left | *What am I?* | The document's identity chip: record dot, theme name, edited state |
| Top-right | *How am I shown?* | The display lens chips, and zoom − / value / +, and fit |
| Bottom-centre | *What can I do?* | The selection dock |

The separation is not cosmetic: **the dock acts on the selection, the corners
act on the view.** A view control that appears only when something is selected
teaches an author that the view is a property of the selection.

**The dock renders the action registries and decides nothing itself.** It
carries the object half alone, *filtered* — an action this selection cannot run
is absent — and asks the registry for eligibility, so the surface never
re-derives what an action can do.

**The arrange actions are the selection inspector's** (`vg-463`). The column
leads with them for a selection of two or more, because that column has just
named the subjects they act on, and shows none at all for a selection that cannot
arrange — a lone shape is not one. Within the row the actions that need more than
this selection has are *greyed* rather than withheld: `Distribute` beside two
objects stays discoverable instead of appearing once a third is added. One
surface owns them, and it is this one: the dock no longer carries the eight that
used to sit beside its object half.

Floating clusters are `--radius-xl`, `--panel` at 95%, 1px `--edge`, elevation 1,
and sit 14–16px in from the stage's edges. **No backdrop blur**: the drawing
fills a cluster from the same `--panel` the chrome uses and separates it from
the stage by its elevation shadow alone.

### The status bar

<!-- §7.6 -->

26px, mono, `--faint`, readouts only: object and selection counts on the left,
save state and the live indicator on the right. **No tools, no buttons, no
menus.** Anything actionable belongs to a region that owns it.

### Overflow, scrolling and motion

<!-- §7.7 -->

- **Content survives density.** Names may ellipsize in lists, but their full
  value remains in the accessible name and is available on focus as well as
  hover. Refusals, validation messages, units and numeric edits never
  ellipsize. A long name cannot widen a pane or hide its row actions.
- **Chrome stays still.** Pane title and footer stay outside the scrolling body;
  inspector sections share one vertical scroller. Preserve per-pane offsets and
  disclosure state across routine updates. Use native scrollbars and reserve
  their gutter where necessary; no custom scrollbar and no scroll-jacking owner,
  with one exception — the shell's own two scrollers, the pane's body and the
  inspector, restyle that native bar from the three `--yunari-scrollbar-*`
  tokens (`vg-458`), which is what those tokens were declared for. No other
  surface paints a scrollbar, and none is a scroll-jacking owner.
- **Clusters cannot collide.** Identity may truncate its name; view controls
  may wrap or use the existing labelled lens chooser. Never omit a lens, zoom
  command or focused target to fit a screenshot. Pointer events belong to the
  controls, not an invisible full-stage overlay.
- **Desktop density has a proof, not a guessed minimum.** Check the full shell
  at 1280×720 and 1440×900 CSS pixels, then at 200% browser zoom. Keep every
  control reachable through scrolling or compact composition. The phone
  layout remains a separately recorded limitation (`vg-172`), not a claim
  that this desktop pass fixes it.
- **Motion explains change, never delays it.** No animated pane width, artboard
  travel, hover scaling or automatic smooth scrolling during editing. Optional
  opacity transitions are short and disappear under `prefers-reduced-motion`.
  Saving, validation and focus changes remain immediate.

### Preserve the reference's character

<!-- §7.8 -->

The original visual direction is a constraint, not disposable presentation.
Keep artwork dominant, controls compact, glyph tiles quick to scan, dividers
fine, and floating clusters restrained. Palette choices retain visual swatches.
Accessibility strengthens that treatment; it does not authorize replacing it
with large generic buttons, text-only tiles or a blank placeholder artboard.

Four-column insert grids remain the reference. Measure labels, hit areas and
contrast at the real pane width before changing column count; reduce columns
only for an observed overflow or readability failure. Preserve glyph-led shape
and chart tiles, with full accessible names and focus/hover descriptions. Lens
chips remain compact where they fit; overflow composition preserves the full
choice set without dictating a permanently larger chooser.

### Entering a group

<!-- §7.9 -->

Entering a group is a **view state, not a document change**: it says what the
author is working inside, and the scene it leaves behind is byte-identical to the
one it found. Both surfaces say so the same way. The layer list dims the rows the
entered group puts out of reach, and **the canvas dims what is outside the entered
group at the same value** — `0.45`, the opacity the unreachable rows already take —
so the list and the canvas cannot disagree about what the author can currently reach.

**The dim belongs to the view and never to the objects.** The renderer applies it at
draw time and does not touch any object's `opacity`. That is not a stylistic
preference: Fabric serialises `opacity`, so a dim that reached an object would write
view state into every save, which the project's guardrail against persisting anything
but authored state forbids. It does not stack either — an object that is hidden *and*
outside the entered group is dimmed once, at `0.45`, not twice, which is the rule the
layer list already states for a hidden row inside an unreachable one.

## Elevation & Depth

### Elevation

Four levels, and a surface sits at exactly one.

| Level | Treatment | Use |
|---|---|---|
| 0 — flat | No shadow, 1px `--edge` border | Panels, rail, header, inspector |
| 1 — raised | `0 8px 20px #00000059` | Floating clusters over the canvas |
| 2 — overlay | `0 18px 44px #00000099` | Menus, popovers, tooltips |
| 3 — modal | `0 24px 60px #000000b3` + scrim `#00000073` | Dialogs |

**Floating clusters do not blur their backdrop.** They take the chrome's own
`--panel` at 95% with no gradient and no filter, and row 1's shadow is the only
thing that separates them from the chrome and from the stage. The canvas reads
*around* a cluster, never through it.

## Shapes

### Radius

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | 4px | Swatches, inline chips, the slider thumb's container |
| `--radius-md` | 6px | Controls, menu rows, small tiles |
| `--radius-lg` | 8px | Panels, cards, tiles in a grid |
| `--radius-xl` | 10px | Floating clusters (dock, view controls, identity chip) |
| full | 999px | Pills and toggles only |

## Components

<!-- §5 -->

The vocabulary is closed. A control is one of these, or it is not a control.

| Control | Looks like | Means |
|---|---|---|
| **Well** | `--panel-2` fill, 1px `--edge`, `--radius-md`, text or value inside | You can change this |
| **Well with chevron** | A well, plus a `▼` in `--faint` | Opens a list |
| **Bare readout** | A value in tabular figures, no well and no chevron — the readout itself is the trigger | Opens a list, and is also the value it reports |
| **Well with unit** | A well, value right-aligned in mono, unit in `--faint` at the right edge | A number with a fixed unit |
| **Slider + well** | A 3px track, an accent fill, a 10px thumb, and a 40px well | A bounded number |
| **Swatch well** | A well containing an 11px radius-4 swatch, then the token name, then a chevron | A paint reference |
| **Toggle** | A 26×14 pill, accent when on | A boolean that applies immediately |
| **Segmented** | A `--panel-2` well holding 2–4 labels, the active one lifted to `--stage` | A small exclusive choice where both options must be readable |
| **Icon button** | A 26–30px square at `--radius-md`, glyph only | An action whose glyph is unambiguous |
| **Labelled button** | A label in `--text-sm` on the `--yunari-control-bg` fill, 1px `--edge`, `--radius-md`, `6px 12px` padding | You can answer the surface that raised it; it is chrome around an answer, not a control in a panel |
| **Rail slot** | A 36px square at `--radius-lg`, glyph only | One of §7.2's four panes; at most one is open |
| **Choice row** | A `--radius-md` row at `--panel-2` carrying a swatch and a name; the chosen row is lifted to `--stage` with the accent border | One member of a closed set where each member has its own colour |
| **Checkbox choice row** | The choice row, with a 14px box and a count in place of the swatch; the chosen row is lifted to `--stage` with a `--text` check | One member of a set you may choose **several** of |

**`Segmented` has a bare form, and the header's mode switch is it.** §7.1's
switch is the well this table describes — `--panel-2` inside a 1px `--edge` at
`--radius-md`, the chosen name lifted to `--stage` with `--text` — and it carries
no row label, because the three names inside the well are the whole control and
the header drawing draws no label beside them. It shares the labelled row's
primitive but not its component: `components/ui/control-segmented.tsx` is a
labelled **row**, whose `ControlRow` requires a visible label, so this is the same
primitive with header-local paint rather than a fourth row shape grown for one
caller. Rule 5 below is met by the group's own name rather than by a label column,
and by the group's and each segment's id, derived from the mode the way
`useControlIds` derives one (`docs/decisions/0074`).

**The checkbox choice row is rule 7's shape where the set admits more than one
answer.** Rule 7 gives a set too large for `Segmented` as a list of choice rows,
each a **radio** in one labelled `radiogroup` — one answer, and the group owns
which. A set you may choose several of is not that shape: the row's semantics are
a checkbox, the group is a plain group, and the group therefore owns no single
checked bit. Everything else is the choice row's — the `--radius-md` row at
`--panel-2`, the row as the whole target, the chosen row lifted to `--stage`, and
a mark whose ink is `--text` rather than the accent, because §4 rations accent to
one filled element per region. The store mode's facet popover is where it is
drawn; its trigger is the well with chevron, and the count beside a value is how
many items are behind it.

**The store's search well is 180px.** A well otherwise fills its field row's value
cell (§5 rule 2), and the store's header row is a bar rather than a field row, so
this one is sized by the drawing that fixes it
(`docs/design/mockups/current/store-themes.html`) and holds that width while the
facet row beside it wraps to a second line.

**The store's page-size well is 76px**, for the same reason and from the same
drawing: the pager is a bar rather than a field row, so the per-page choice is
sized by what the drawing fixes instead of by a field row's value cell.

**The store's pager row is 158px wide, and the arithmetic is what fixes it.** The
drawing draws the per-page label *beside* its well, not above it, so the row is
§5's 74px label column, §3's 8px gap and the 76px well — 74 + 8 + 76 — and the
label and the well share the bar's one line, as the drawing's own 43px bar has
them. A row given only the well's 76px wraps the well to a second line and makes
the bar 61px (`pager.tsx`).

**The slider row's well is 40px and not 36, and the arithmetic is what fixes it.** The well
carries an editable field now, so the 24×24 target below binds it: the control pads its wells with
`px-[var(--space-6)]` (`control-well.tsx`'s `wellClasses`, the 6px step at
`editor-shell.css`'s `--space-6`) and the border 1px, leaving the field `well − 12 − 2` — 22px at
36 and 24 at 38, which is the floor, so 40 keeps a pixel either side of the box that rule measures.
**§3's table names the same step**: a well's horizontal padding is 6, which is what both drawings
draw (`padding:4px 6px`) and what `wellClasses` writes.

**Rules that make it readable:**

1. **A value inside a well means editable.** Structural borders on panels and
   disclosures do not mean editable: a disclosure says how much the section
   holds, never whether it may be written. A value with no well is not editable,
   and that is never stated in a tooltip alone.
2. **Read-only rows are label + mono value, baseline-aligned, right-aligned.**
   They share the grid with controls so a section does not jump between shapes.
   **The grid is a 74px label column and one value cell**, and the cell is one
   track whatever fills it: a well, a select, a slider and a segmented group
   occupy the same geometry, so a section's boxes share a left edge rather than
   each starting where its own content ends. A row a surface's own drawing shapes
   differently — a switch row whose label fills the row inside a panel box, a
   control spanning the row under its own heading — is not a field row and keeps
   the shape it is drawn with.
3. **A refused capability renders with its reason.** A property the kind does
   not have is omitted (§7.4); an existing capability this selection cannot use
   keeps its row. The reason is visible and connected with `aria-describedby`.
   `aria-disabled` alone blocks nothing: pointer, keyboard, scrub and commit
   paths must all refuse mutation. A natively disabled control is acceptable
   only when its reason remains readable without focusing it. The dock's
   registry-filtered object actions remain the explicit exception (§7.5).
4. **Keyboard focus is an accent boundary, not only a translucent halo.** Keep
   the 3px accent-at-18% halo as decoration; the solid focus boundary must have
   at least 3:1 contrast against adjacent colours in all six palettes. Never
   remove the browser outline without a visible replacement. In forced-colours
   mode use a system-colour outline; a box shadow may disappear. Focus cannot
   be clipped by a scroller or covered by a floating cluster.
5. **Every control has a label, a programmatic name, and an id.** A control with
   neither `aria-label` nor a `<label for>` is a defect, not a style choice.
6. **Hover raises `--edge` to `--muted`.** On a control that carries a resting `--edge` — the well, the toggle — the border brightens. On a glyph-only control with no resting border — the icon button — it is the border it acquires on hover. Nothing moves, nothing scales.
7. **A set too large for `Segmented` is a list of choice rows, each a radio in one labelled `radiogroup`.** The row is the whole target, the group owns which one is chosen, and the group's own keyboard model walks the rows in reading order — a multi-column layout changes the grid and never the arrow keys.

### Editing and recovery

- **Draft is not authored state.** Text and number fields retain the draft
  while typing, including an empty string, a minus sign and an incomplete
  decimal. Enter or blur commits one valid changed value; Enter followed by
  blur cannot commit twice. Escape restores the last authored value without
  history. IME composition is not an Enter commit.
- **Validation belongs to the field's owner.** Finite numbers and the owner's
  bounds are required; invalid input is never coerced to zero or silently
  clamped. Show the reason beside the field, mark `aria-invalid`, and preserve
  the rejected draft until corrected or cancelled. Optional numeric fields
  distinguish clearing the authored key from writing zero.
- **Gestures have one undo boundary.** Sliders and scrubs may preview through
  the existing imperative write funnel. Release commits one changed value;
  cancellation restores the start value and adds no history. A selected object
  disappearing or changing mid-gesture cancels; it never edits its successor.
- **Stable identity keeps work in place.** A telemetry update cannot replace a
  focused input, reset its draft or caret, reopen a section, or move its scroll
  position. A genuine target change may end editing, with no stale commit.

### Keyboard and target size

- Tab order follows visible reading order. Composite controls use their
  installed primitive's keyboard model, not one Tab stop per decorative child.
  Section headers are buttons exposing `aria-expanded`; toggles expose their
  checked state; every icon-only action works without hover.
- Escape closes the innermost active layer or cancels the active edit, once.
  Closing a popup returns focus to its trigger. If that trigger was removed,
  focus returns to the nearest surviving control in its owning region.
- Dense chrome targets have at least a 24×24 CSS-pixel hit area. A small glyph
  may sit inside a larger target; adjacent targets must not overlap. No
  drag-only route to an action already reachable through commands is accepted.
- Required labels, refusals and selected-state text meet 4.5:1 contrast for
  normal text. **3:1 binds two boundaries, and only these two:** the focus
  boundary (rule 4), and a boundary that is a control's **only** separation —
  the single mark that tells the control apart from what surrounds it. Anything
  else is a **divider**, and a divider may be deliberate low-contrast style.
  Classify one by asking what else marks the thing it bounds: a well's resting
  `--edge` sits beside a fill, a hover-raise to `--muted` and a label, and a
  dialog's frame beside a fill, a shadow and a radius, so in each case the
  border is one mark among several rather than the control's only separation.
  `--faint` is decorative or genuinely inactive, never the sole carrier of
  required information.

### Icons

<!-- §6 -->

**Glyphs are stroke-based, `currentColor`, drawn on a 24px grid, at one weight
rule: the stroke rises as the size falls, so the rendered weight stays optically
even.** One family, one rule, everywhere — **1.7px at 14px and above, 1.8px at
11–13px, 2px at 10px and below.** A filled glyph carries one of two things, and
never a licence for looks: the escape where a stroke would read faint at the
size (the live check at 12px, the record dot), or the **on/off channel of a
binary state** — the layer row's locked lock, the font picker's favourited star
(`vg-024`).

Rules:

- **An icon replaces a word only when the word is unambiguous from the glyph.**
  Where it is not, the glyph carries a tooltip and the label is in the accessible
  name. Where even that is ambiguous, it stays a word.
- **Every icon-only control has an `aria-label`, and the tooltip is that label.**
  One string, one owner — a glyph button whose tooltip and accessible name can
  disagree is a defect.
- **An icon set is closed when the kind list is closed.** The object-kind glyphs
  are exactly the insertable kinds; a new kind adds one glyph or the set is
  wrong.
- **A group gets a generic glyph.** A card on the canvas is an arbitrary group of
  elements, so its row cannot depict it. It gets the stack glyph and its name.
  A *card unit* in the Add pane is not arbitrary — the card library is a fixed
  set of eight — so a unit tile may carry a diagram of what it builds.
- **Destructive actions use `--hot`, never `--accent`.**

## Do's and Don'ts

<!-- §10 -->

- A hex value in a surface. Colour comes from a role.
- A second horizontal navigation bar.
- A tool in the status bar; a global command in a pane footer.
- A per-card inspector column, or a glyph that claims to depict an arbitrary group.
- A device frame or notch around the artboard.
- Hiding an existing capability because this selection cannot use it, instead of refusing it in words; inventing a property its kind does not have is equally wrong. **The dock's registry-filtered object actions are the one exception** (§5 rule 3, §7.5): an action this selection cannot run is *filtered* — absent from the dock — rather than refused in words.
- Removing a frequently used control to a settings surface.
- Inventing a control not in §5, or an icon not in §6, without amending this file
  in the same commit.

## Density and disclosure

<!-- §8 -->

- **Every authorable setting is present** — nothing is hidden to make a panel
  look simpler. Convenience is ordering and grouping, never a smaller surface.
- **Order and group by what a person needs**, most likely first, obscure last,
  each field with a hint where the name is not self-evident.
- **Disclosure is for the once-in-a-while, not the frequent.** A frequently used
  control stays visible; a collapsed section is for what is adjusted rarely.
  Choosing wrong here is the mistake §7.1 exists to prevent.
- **A section header says what the section is** — the question it answers.

## Copy

<!-- §9 -->

- **Sentence case** for menu rows, section eyebrows excluded (they are
  uppercase by §2).
- **The platform's mark for a chord, the platform's name for its announcement.**
  `⌘⇧P` is printed; "Command Shift P" is what a screen reader says.
- **A refusal states the reason in the selected thing's own terms.** "Not
  offered for a group" — not "invalid", not silence.
- **Never assert a capability the code does not have.** A control that announces
  a dismissal it cannot perform is a defect in copy, not a cosmetic one.
- A missing reading is **a gap, stated once, quietly**. Never a zero, never a
  dash that could read as data.
