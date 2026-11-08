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
    fontFamily: system-ui, sans-serif
    fontSize: 10px
    lineHeight: 1.2
  xs:
    fontFamily: system-ui, sans-serif
    fontSize: 11px
    lineHeight: 1.3
  sm:
    fontFamily: system-ui, sans-serif
    fontSize: 12px
    lineHeight: 1.4
  md:
    fontFamily: system-ui, sans-serif
    fontSize: 13px
    lineHeight: 1.3
  lg:
    fontFamily: system-ui, sans-serif
    fontSize: 15px
    lineHeight: 1.3
  xl:
    fontFamily: system-ui, sans-serif
    fontSize: 19px
    lineHeight: 1.2
omitted:
  - section: colors
    reason: The palette resolves per theme at runtime; one YAML value per role would be false. The role names are normative in the Colors section; their per-theme values live in the runtime palettes.
  - section: components
    reason: The control vocabulary is normative as prose and implemented in packages/editor/src/components/ui/; tokens would be a second owner of it.
---

# Yunari design language

**Normative.** Every editor surface is built from what is written here. A new
surface that needs something absent from this file changes this file in the same
commit rather than inventing a local exception.

Scope: **the editor**. The player has its own chrome rules, and the canvas —
inside the artboard — is the author's design, not ours.

## Overview

**The editor is quiet so the dashboard is loud.** The themes this product makes
are dark, saturated and dense with data. Every part of the editor that is not
the artboard recedes: one accent, used for one thing at a time, and no surface
competing with the artboard for attention.

Two consequences decide most arguments:

- **Chrome does not decorate.** If a border, shadow or colour does not
  distinguish one thing from another, it is not there.
- **Text is not the interface.** A control that can be a glyph is a glyph; a
  label appears where a glyph would be ambiguous, and in a tooltip where the
  glyph is standard.

## Colors

Colour is a **runtime palette**, not a set of literals. Six palettes ship:
`editorial`, `graphite`, `ember`, `moss`, `plum` and `light`. Graphite is the
default; an OS reporting a light appearance gets `light`; the author may
override either in Settings.

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
| `--attention` | Work in flight: unsaved or unpublished changes, a pending operation, a reading awaiting the author |
| `--warn` | Something needs attention; not an error |
| `--hot` | Destructive. Delete, and only delete |
| `--ok` | A reading inside its healthy range, such as a theme under its size bound |
| `--error` | A reading whose bound is crossed and therefore blocks the action |

**`--accent` is rationed.** At most one accent-filled element is visible in a
region at a time: the selected rail slot, the focused control, the selected row,
the primary button. Two accents in one region means neither is the accent.

**`--hot` marks destructive affordances only.** It never marks "important", and
a disabled destructive control stays `--faint` rather than dimming red.

**`--attention` marks work in flight, never an action or a fault.** It appears
only on an unsaved or unpublished indicator, an operation still running, a
control whose action is out, or a reading that is stale and waiting for the
author. It never fills a button, never shares an element with `--accent`, and
does not stand in for `--warn` (something needs attention) or `--hot`
(destructive).

**`--ok` and `--error` are readings, not affordances.** They state a value's
relation to its bound — a theme at 60% of its limit is `--ok`, one past 100% is
`--error` — and never *fill* a control. A control's success or failure is a
reading of its action's result, so the state set below paints the control's
ink; the fill stays the control's own. A reading that blocks an action carries
`--error`; the control it blocks still uses its own vocabulary, and a fault that
is not destructive never borrows `--hot`.

**A sensor key's availability is a dot before its name.** Green (`--ok`) means
the host reports the key now, red (`--error`) means the theme binds it but the
host does not report it, and grey (`--faint`) means unknown — the host has not
answered, or the key is neither reported nor bound. The row's accessible name
repeats the state, because colour alone does not reach every author.

## Typography

Three families, each with one job.

| Family | Job | Where |
|---|---|---|
| UI sans (`system-ui` stack) | Everything a person reads as language | Labels, menus, headings, panel copy |
| UI mono (`ui-monospace` stack) | Everything a machine produced or will parse | Values, coordinates, token names, chord marks, counts |
| Theme fonts | The author's typography | Inside the artboard only; never in chrome |

The UI sans stack is the `--font-ui` token in `editor-shell.css`'s `@theme
static` block, and every `typography` entry's `fontFamily` above transcribes
it; `--sync` fails when one drifts from the other.

**Values are mono; labels are sans.** This is the largest difference from a
form-shaped panel, and it is not decorative: a mono value is scannable by column
and cannot be mistaken for prose. A number a person types is mono. A number that
is prose ("three parts") is sans.

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
Paint, and the group headings in the Add pane. An eyebrow is `--text-2xs`, `600`,
`letter-spacing: .11em`, muted, and it always labels a region, never a control.
Nothing else is uppercase: a chord is printed as the platform prints it, and a
menu row is sentence case.

Weights: `400` body, `500` emphasis inside a row, `600` titles and eyebrows,
`650`–`700` only for the brand mark and a primary button. Nothing is bolder than
`700`.

The persisted model is a **type token** that names a face: family, an optional
weight and an optional declared face asset. Size, line height and tracking live
on the run's own style, so one face worn at two sizes needs one token, not two.
The three roles are the token ids — `heading`, `body`, `mono` — and the theme
always carries all three.

## Layout

```
┌───────────────────────────────────────────────────────────────┐
│ header   brand · modes · File│Document│View ······ ⌘⇧P Publish│
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
**32px** in the settings surface. Density varies by which of those three a
surface is, not by taste.

**The store's gallery is justified rows, not a masonry.** Cards are collected
until their natural widths at the level's target height pass the pane; the row is
then scaled as a whole so its cards and 12px gutters together equal the pane's
width — flush at both edges. Each card's height is the row's, and its width is
that height times the theme's own ratio, contained rather than cropped. A 4:1
Lian Li theme therefore takes the width it needs to stay legible, and a square
theme takes a normal slot instead of reserving a square's area out of every row.
A final row whose cards fit keeps the target height and stays short on the right.

**The density is a named level, and the column count follows the pane.** The
header's slider, at the bar's far end, offers four levels — Compact, Comfortable,
Roomy, Spacious — targeting 150, 204, 270 and 360px cards, a quarter denser than
the gallery's first sizes at every step. The level is the view
preference that persists; the count is recomputed on every resize as
`floor((width + 12) / (target + 12))` clamped to 2–12. Four named levels rather
than a numeric well, because a stored count stops following the window the
moment it is chosen. The track is 120px and its reading column 84px, the width
that holds the longest level's word without moving the header.

**A card's foot is one row.** The name is semibold at the left; the updated day
sits at the right of the same row. Attending the card fades the day out and fades
the card's controls in over the same space, so the row never grows and the card
never repeats a line beneath itself. A facts band exists only for facts the name
row cannot carry: an online item's kind and download count, or an origin pill.

**The store's item modal is 960 × 760, and its facts sit in a 270px right
panel.** The width is not the editor dialog's 560: this surface's subject is a
picture. The stage is flush to the box's edges, one height for every item, with
the panel beside it rather than below. The theme is contained at its own ratio,
letterboxed against a ground darker than the modal's surface. A stage sized to
the item would change the modal's height between items, which a viewer must not
do. A short viewport caps the box at 90vh so the foot stays on screen.

**The asset preview is the Finder's box, with the same 270px panel.** Its
ceiling is `min(1132px, 100vw − 48px) × min(852px, 100vh − 48px)`, because its
subject is the file at the size it will be used. The facts sit where a person
already looks, and only the stage changes between the two surfaces.

### The header

**Document-level and editor-level actions only.** A command that has a rightful
home elsewhere is not repeated here — Insert lives in the Add pane, so the
header has no Insert menu, and Edit lives in the Layers pane's footer
toolbar, so the header has no Edit menu.

- Left: brand mark, then the **mode switch**, then one **toolbar** of icon
  buttons in three groups, each divided by a short vertical rule:
  - **The document's lifecycle**: New theme, New from template, Open, Open
    recent, Import theme — make one, open one, bring one in.
  - **The open document's actions**: Save, Save as, Activate, Export theme,
    Export selection as widget — keep it, then send it out.
  - **The editor's tools**: Find assets, then one readings-source toggle. The
    toggle keeps the `monitor-activity` glyph in both states; its selected
    state is the live source and its unselected state the theme's sensors,
    while its tooltip and accessible name say which source is shown. A press
    flips it.
  Every button carries its word as the tooltip and the accessible name, so no
  visible label is repeated beside it. The buttons are not rows nested in a
  menu: a command changed while designing is one gesture away, not two. The
  toolbar carries no selection command: copy, cut, duplicate, delete, group and
  arrange act on individual elements and stay on the surfaces that own a
  selection.
- Right: the **primary button**. `Publish` is the only filled, accent-coloured
  button in the editor, and the bar prints no shortcut beside it — the chord
  lives in the control's title and spoken label.
- **The header never shows the document's identity** and never shows a
  per-document readout. Both are on the canvas.

**The header carries the shell's mode switch, and there is no bar under it.**
The shell has three modes — the editor, the theme store and Settings — and the
switch is the header's own `Segmented` control with the labels `Editor`, `Themes`
and `Settings`. A strip under the header would be a second horizontal bar, so the
header owns the choice and its **right-hand region is per-mode**: the toolbar and
the publish control belong to the editor; a mode with actions of its own carries
them there; a mode with none shows nothing beside the switch.
The editor's own body is hidden, not unmounted, while another mode shows — a mode
switch never loses an unsaved document. Editor and Settings move freely; leaving
either for Themes asks before discarding a dirty document.

**Settings is a mode, not a dialog.** Its destinations run down a fixed
navigation column grouped as This PC — the machine and its screens — and Editor —
how the author works. The column is for choosing where to be; the page beside it
spends the width on columns of sections rather than on one long vertical list.
The mode's status line is the shell's strip, not a second bar inside the page.

`View` stays in the header because its commands — preview/live source — are
changed *while* designing, many times a session. Settings is for once-in-a-while
choices. A frequently changed control one level deeper is a tax paid on every
use, so the source choice is the toolbar's own toggle rather than a menu.

### The rail

A 46px vertical strip of glyph slots at the window's left edge, with the
settings gear pinned to the foot. **Five slots:**

| Slot | Glyph | Holds |
|---|---|---|
| Layers | stack | The scene tree, and the object actions that act on it |
| Add | plus | Everything insertable |
| Assets | folder | Every declared file, its import and placement, and the finder link |
| Tokens | palette | The theme's paints and type tokens — created and edited here |
| Document | page | Artboard, metadata |

**At most one slot is open at a time.** Asking for the open slot closes it;
asking for another replaces it. The pane occupies its own layout track beside
the rail. Opening it may resize the available stage, but never translates
objects or writes authored coordinates; the viewport owner handles fitting. The
selected slot carries the accent glyph, an accent wash, and a 2px accent bar on
the rail's inner edge.

The rail replaces a horizontal pane bar. A second horizontal bar under the
header is forbidden: two stacked rows of navigation make the first read as
chrome rather than as a choice.

### Panes

Width 246px by default. Structure, top to bottom:

1. **Title bar** — glyph, title, and the count or a single pane-level action.
2. **Body** — scrolls. Sections use the eyebrow treatment.
3. **Footer toolbar** — optional, present where a pane's items have a set of
   actions. Icon buttons at 26px, from the same registries the dock uses.

**A pane footer is bounded by its pane.** The scene tree's footer holds the
object actions and is drawn only while a layer is selected; with no subject it
is absent rather than a row of greyed commands. The footer sits at the pane's
bottom edge and is not a place for global commands, and the status bar is not
a place for tools.

**A row yields its name and its key before it yields a control, and it yields
the role last.** A Layers row that carries every control it can — the
twisty, the entry control on a group, the eye and the lock — and a bound key is
wider than the pane's body, so the row clips rather than dropping a control or
taking the leading slot below 20px. The name and key give way first; the role gives
way only once they have nothing left, and it is *clipped* rather than *covered*,
because it is often the only statement of what a row is. A role the slot paints
over says nothing; a role that ellipsises still says what it can. This is the
pane's trade at its default width, not a defect to measure away: the mark slot is
already at the floor its contents set, so narrowing it moves the clip rather than
removing it.

### The inspector

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
  own**. The column's fold handle shares the subject's row at its right end and
  stays at the column's top while the sections scroll; the row reserves the
  handle's track so the name and key never run beneath it.
- **Folding is the author's while the selection stands, but a new selection
  reopens the column.** A fold made by accident must not hide the panel the
  subject the author just chose needs, and the canvas offers no route back to a
  folded column.
- **A section with nothing in it is not rendered** — no header, no zero count.
- **Every section opens; none starts closed**, with one exception: the
  `advanced` treatment, a disclosure a caller mounts deliberately and that a
  selection never asks for, so it opens closed and counted. A reader may still
  close a section, and that disclosure survives routine updates.
- **A property a kind does not have is not shown as a field.** Where the
  capability exists but this selection cannot carry it, the row renders refused
  with the reason.
- **There is no per-card column.** A card is a `Group`; groups get name,
  transform and opacity. The question "which sensor" is asked on the element
  that carries the binding.
- **A token row's edit action sits at the right of its value cell.** Every row
  that references a design token — a run's type-token or paint row, the
  background's colour, a material paint, a chart's paint — carries one icon
  button after the select, named for the token it edits, opening the value's
  editor in a popover anchored at that row: the colour area, channels and
  presets for a paint, family and weight for a type token. The button edits the
  referenced token, not the reference; it is the same write the token inspector
  performs. Every paint-token list ends with an **Add new paint token** entry,
  and a type-token list with **Add new token** — the action-row grammar the font
  rows already use: it creates through the Tokens pane's own rule, applies the
  new token to the row, and opens the Tokens pane with the token selected.
- With nothing selected the column is empty and says where to choose from.

### The stage

The artboard sits centred on the `--stage` ground and **is never drawn inside a
device frame**. The stage is the author's whole surface. Composition is
artwork-led, with fine chrome and restrained depth. Subtle palette-derived stage
texture is permitted when it stays behind the artwork and does not obscure
controls; neither texture nor a flat ground is mandatory. Authored artwork is not
a shell background to hard-code into every document. A lens changes the view
rectangle, never authored artboard dimensions.

**Three corners, one question each:**

| Corner | Question | Contents |
|---|---|---|
| Top-left | *What am I?* | The document's identity chip: record dot, theme name, edited state |
| Top-right | *How am I shown?* | Play/pause for a video background, then the display lens chips, zoom − / value / +, and fit — one cluster |

The separation is not cosmetic: **the dock acts on the selection, the corners
act on the view.** A view control that appears only when something is selected
teaches an author that the view is a property of the selection. The playback
control is the one view control that depends on the document rather than the
camera: it is absent for an image, a gradient or no media, because there is
nothing there to pause. It leads the view cluster, separated by a hairline,
because it answers the same question as the camera controls. Its state is
transient and is never written to the
theme.

**The identity's name is edited in place.** Double-click the chip's name to
replace it with a one-line field inside the same chip; Enter or leaving the
field commits, Escape cancels, and an emptied name cancels rather than becoming
the id. A rename changes the document's display name only — the stored theme id
never moves with it.

**The dock renders the action registries and decides nothing itself.** It
carries the object half alone, *filtered* — an action this selection cannot run
is absent — and asks the registry for eligibility, so the surface never
re-derives what an action can do.

**The arrange actions are the selection inspector's.** The column leads with
them for a selection of two or more, and shows none at all for a selection that
cannot arrange — a lone shape is not one. Within the row, actions that need more
than this selection has are *greyed* rather than withheld: `Distribute` beside
two objects stays discoverable instead of appearing once a third is added. One
surface owns them.

Floating clusters are `--radius-xl`, `--panel` at 95%, 1px `--edge`, elevation 1,
and sit 14–16px in from the stage's edges. **No backdrop blur**: a cluster
fills from the same `--panel` the chrome uses and separates itself from the
stage by its elevation shadow alone.

### The status bar

26px, mono, `--faint`, readouts only: object and selection counts on the left,
save state and the live indicator on the right. **No tools, no buttons, no
menus.** Anything actionable belongs to a region that owns it.

### Overflow, scrolling and motion

- **Content survives density.** Names may ellipsize in lists, but their full
  value remains in the accessible name and on focus as well as hover. Refusals,
  validation messages, units and numeric edits never ellipsize. A long name
  cannot widen a pane or hide its row actions.
- **Chrome stays still.** Pane title and footer stay outside the scrolling body;
  inspector sections share one vertical scroller. Preserve per-pane offsets and
  disclosure state across routine updates. Use native scrollbars and reserve
  their gutter where necessary; no custom scrollbar and no scroll-jacking owner.
  Every scroller in the editor and Settings chrome takes the same native bar
  from the `--yunari-scrollbar-*` tokens. The shell root states the pair once;
  the colour inherits, the width is applied to the roots' descendants, and
  portalled surfaces join at the portal root. No surface paints a scrollbar of
  its own.
- **Clusters cannot collide.** Identity may truncate its name; view controls may
  wrap or use the labelled lens chooser. Never omit a lens, zoom command or
  focused target to fit a screenshot. Pointer events belong to the controls, not
  an invisible full-stage overlay.
- **Desktop density has a proof, not a guessed minimum.** Check the full shell at
  1280×720 and 1440×900 CSS pixels, then at 200% browser zoom. Keep every
  control reachable through scrolling or compact composition. The phone layout
  remains a separately recorded limitation, not a claim that the desktop pass
  fixes it.
- **Motion explains change, never delays it.** No animated pane width, artboard
  travel, hover scaling or automatic smooth scrolling during editing. Optional
  opacity transitions are short and disappear under `prefers-reduced-motion`.
  Saving, validation and focus changes remain immediate.

### Density and disclosure

- **Every authorable setting is present** — nothing is hidden to make a panel
  look simpler. Convenience is ordering and grouping, never a smaller surface.
- **Order and group by what a person needs**, most likely first, obscure last,
  each field with a hint where the name is not self-evident.
- **Disclosure is for the once-in-a-while, not the frequent.** A frequently used
  control stays visible; a collapsed section is for what is adjusted rarely.
- **A section header says what the section is** — the question it answers.

### Entering a group

Entering a group is a **view state, not a document change**: it says what the
author is working inside, and the scene it leaves behind is byte-identical to
the one it found. The layer list dims the rows the entered group puts out of
reach, and **the canvas dims what is outside the entered group at the same
value** — `0.45`, the opacity the unreachable rows already take — so the list
and the canvas cannot disagree about what the author can currently reach.

**The dim belongs to the view and never to the objects.** The renderer applies it
at draw time and does not touch any object's `opacity`. Fabric serialises
`opacity`, so a dim that reached an object would write view state into every
save. It does not stack: an object that is hidden *and* outside the entered
group is dimmed once, at `0.45`, not twice.

### Preserve the visual character

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

## Elevation & Depth

Four levels, and a surface sits at exactly one.

| Level | Treatment | Use |
|---|---|---|
| 0 — flat | No shadow, 1px `--edge` border | Panels, rail, header, inspector |
| 1 — raised | `0 8px 20px #00000059` | Floating clusters over the canvas |
| 2 — overlay | `0 18px 44px #00000099` | Menus, popovers, tooltips |
| 3 — modal | `0 24px 60px #000000b3` + scrim `#00000073` | Dialogs |

**Floating clusters do not blur their backdrop.** They take the chrome's own
`--panel` at 95% with no gradient and no filter, and the raised shadow is the
only thing separating them from the chrome and from the stage. The canvas reads
*around* a cluster, never through it.

## Shapes

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | 4px | Swatches, inline chips, the slider thumb's container |
| `--radius-md` | 6px | Controls, menu rows, small tiles |
| `--radius-lg` | 8px | Panels, cards, tiles in a grid |
| `--radius-xl` | 10px | Floating clusters (dock, view controls, identity chip) |
| full | 999px | Pills and toggles only |

## Components

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
| **Segmented** | A `--panel-2` well holding 2–4 labels, each taking an equal share of the well, the active one lifted to `--stage` | A small exclusive choice where both options must be readable |
| **Icon button** | A 26–30px square at `--radius-md`, glyph only | An action whose glyph is unambiguous |
| **Labelled button** | A label in `--text-sm` on the `--yunari-control-bg` fill, 1px `--edge`, `--radius-md`, `6px 12px` padding | You can answer the surface that raised it; it is chrome around an answer, not a control in a panel |
| **Rail slot** | A 36px square at `--radius-lg`, glyph only | One of the rail's slots; at most one pane is open |
| **Choice row** | A `--radius-md` row at `--panel-2` carrying a name and, where the member has one, a swatch before it and a detail after it at the right edge; the chosen row is lifted to `--stage` with the accent border | One member of a closed set; a set of colours leads with the swatch |
| **Palette card** | A `--radius-lg` card at `--panel-2` carrying the palette's swatch above its name in a three-column grid; the chosen one takes the accent border and the accent halo rather than the lift | One member of the shell-palette set, where the swatch is the picture and the name is the caption |
| **Preset chip** | A 24px rounded square at `--radius-sm` carrying only a swatch; the chosen one takes the accent border and the accent halo, its name staying the programmatic label | One member of a swatch library, where the swatch is what the author recognises |
| **Checkbox choice row** | The choice row, with a 14px box and a count in place of the swatch; the chosen row is lifted to `--stage` with a `--text` check | One member of a set you may choose **several** of |
| **2-D colour area** | A 128px-tall `--radius-sm` surface with a 1px `--edge` and the saturation × brightness plane as its fill | A pointer picks both channels; focus paints the boundary role |
| **Gradient track** | A 24px-tall `--radius-sm` surface with a 1px `--edge` and the value's own gradient as its fill; 16px stop marks fill with the stop's colour, a `--text` border, and an `--edge` ring; the selected mark takes the accent border, and a press that does not travel opens its picker | It is both the preview and the manipulator |

**A dialog's way out sits in its top-right corner.** The close control is a
mark at `--space-8` from those two edges, never a bottom-row action: the word
lives in its accessible name, not on it. The bottom row answers the dialog,
ordered cancel then
confirm, right-aligned. A sheet that draws its own close control is the defect,
not a variant.

**`Segmented` members divide the well equally.** Every chip takes `flex: 1`
with `min-width: 0`, so a longer label wraps or truncates inside its share
rather than widening the chip. The control set's colour, spacing, radius, type,
elevation and hairline are unchanged.

**`Segmented` has a bare form, and the header's mode switch is it.** The switch
is the well this table describes — `--panel-2` inside a 1px `--edge` at
`--radius-md`, the chosen name lifted to `--stage` with `--text` — and it carries
no row label, because the three names inside the well are the whole control. It
shares the labelled row's primitive but not its component:
`components/ui/control-segmented.tsx` is a labelled **row**, whose `ControlRow`
requires a visible label, so the header uses the same primitive with header-local
paint rather than a fourth row shape grown for one caller. Rule 5 is met by the
group's own name rather than a label column, and by the group's and each
segment's id, derived from the mode the way `useControlIds` derives one.

**The checkbox choice row is rule 7's shape where the set admits more than one
answer.** Rule 7 gives a set too large for `Segmented` as a list of choice rows,
each a **radio** in one labelled `radiogroup` — one answer, and the group owns
which. A set you may choose several of is not that shape: the row's semantics
are a checkbox, the group is a plain group, and the group owns no single checked
bit. Everything else is the choice row's — the `--radius-md` row at `--panel-2`,
the row as the whole target, the chosen row lifted to `--stage`, and a mark whose
ink is `--text` rather than the accent, because accent is rationed to one filled
element per region. The store mode's facet popover is where it is drawn; its
trigger is the well with chevron, and the count beside a value is how many items
are behind it.

**The inline reading list is a popup of choice rows, not a new control.** Typing
`@` in a text opens it at the caret; each row is one reading, filtered as the
author keeps typing. `↑`/`↓` move the highlight, `Tab` takes the highlighted
reading, `Space` stays a space, and `Escape` closes the list before it ends the
edit. The accepted reading becomes a value run, so it formats, carries its unit
and reports a missing source like any other binding — it is never copied in as
characters.

**The colour area and the gradient track take their sizes from the panel
rhythm; both channels are `role="slider"`.** The keyboard moves one channel at a
time with arrows 1, Shift/Page 10 and Home/End, and Escape closes and returns
focus; the focus boundary must measure ≥3:1 in all six palettes.

**The store's search well is 180px.** A well otherwise fills its field row's
value cell, and the store's header row is a bar rather than a field row, so this
one is sized to 180px and holds that width while the facet row beside it wraps
to a second line.

**The grid loads another batch as the scroller nears its end**, so the header
holds no page arithmetic and no pager row. The density slider beside the sort is
where the reader chooses how compact the grid feels; the columns follow the
pane's width.

**The slider row's well is 40px and not 36, and the arithmetic is what fixes
it.** The well carries an editable field, so the 24×24 target below binds it: the
control pads its wells with `px-[var(--space-6)]` (`control-well.tsx`'s
`wellClasses`, the 6px step at `editor-shell.css`'s `--space-6`) and the border
1px, leaving the field `well − 12 − 2` — 22px at 36 and 24 at 38, which is the
floor, so 40 keeps a pixel either side of the box that rule measures. A well's
horizontal padding is 6, which is what `wellClasses` writes
(`padding:4px 6px`).

### Rules that make it readable

1. **A value inside a well means editable.** Structural borders on panels and
   disclosures do not mean editable: a disclosure says how much the section
   holds, never whether it may be written. A value with no well is not editable,
   and that is never stated in a tooltip alone.
2. **Read-only rows are label + mono value, baseline-aligned, right-aligned.**
   They share the grid with controls so a section does not jump between shapes.
   **The grid is a 74px label column and one value cell**, and the cell is one
   track whatever fills it: a well, a select, a slider and a segmented group
   occupy the same geometry, so a section's boxes share a left edge rather than
   each starting where its own content ends. A row a surface shapes
   differently — a switch row whose label fills the row inside a panel box, a
   control spanning the row under its own heading — is not a field row and keeps
   the shape it is drawn with.
3. **A refused capability renders with its reason.** A property the kind does
   not have is omitted; an existing capability this selection cannot use keeps
   its row. The reason is visible and connected with `aria-describedby`.
   `aria-disabled` alone blocks nothing: pointer, keyboard, scrub and commit
   paths must all refuse mutation. A natively disabled control is acceptable
   only when its reason remains readable without focusing it. The dock's
   registry-filtered object actions remain the explicit exception: an action
   this selection cannot run is *filtered* — absent from the dock — rather than
   refused in words.
4. **Keyboard focus is an accent boundary, not only a translucent halo.** Keep
   the 3px accent-at-18% halo as decoration; the solid focus boundary must have
   at least 3:1 contrast against adjacent colours in all six palettes. Never
   remove the browser outline without a visible replacement. In forced-colours
   mode use a system-colour outline; a box shadow may disappear. Focus cannot be
   clipped by a scroller or covered by a floating cluster.
5. **Every control has a label, a programmatic name, and an id.** A control with
   neither `aria-label` nor a `<label for>` is a defect, not a style choice.
6. **Hover raises `--edge` to `--muted`.** On a control that carries a resting
   `--edge` — the well, the toggle — the border brightens. On a glyph-only
   control with no resting border — the icon button — it is the border it
   acquires on hover. Nothing moves, nothing scales.
7. **A set too large for `Segmented` is a list of choice rows, each a radio in
   one labelled `radiogroup`.** The row is the whole target, the group owns which
   one is chosen, and the group's own keyboard model walks the rows in reading
   order — a multi-column layout changes the grid and never the arrow keys. **A
   swatch library is the same set drawn as preset chips**: the swatch alone, the
   name as the control's programmatic label, wrapped in reading order, with the
   group's arrow keys unchanged.

### Control states

Every button on every editor surface carries the same states, and each state has
one owner rather than one spelling per surface:

| State | Set by | Drawn with |
|---|---|---|
| rest | — | the control's own surface and `--edge` |
| hover | `:hover` | `--edge` raised to `--muted`; a glyph-only control acquires that border. Nothing moves or scales. |
| focus | `:focus-visible` | the accent boundary (rule 4) |
| selected | `aria-pressed="true"` / `aria-checked` | `--accent` ink over its 14% wash |
| disabled | `disabled` / `aria-disabled` | `--faint` ink; a refused capability keeps its visible reason (rule 3) |
| in progress | `data-yunari-control-state="busy"` + `aria-busy="true"` | `--attention` ink; the label names the work, and the control is natively disabled so a second press cannot ride the first |
| success | `data-yunari-control-state="success"` | `--ok` ink |
| failure | `data-yunari-control-state="failure"` | `--error` ink |

The caller sets the last three through `controlStateAttributes` in
`components/ui/control-state.ts`. One stylesheet rule keyed on
`data-yunari-control-state` paints them for every surface, and the `@theme
static` block owns the three state tokens: `--control-state-busy` (resolving
`--attention`), `--control-state-success` (`--ok`) and `--control-state-failure`
(`--error`). A control that cannot carry a state,
or draws it differently, says why in a comment beside it: a synchronous action
has no busy or outcome, a dismissal has no outcome, and a state that is a
*reading of something else* — a source's health — is drawn as that reading
rather than as the button's own outcome.

### Asset finder tabs

The finder is one surface with one vocabulary. **A tab is a category of asset,
never a provider**, and it fills the frame rather than drawing its own.

1. **One frame, in this order:** tab rail, toolbar, content, footer. A tab may
   add filters, a card preview, a detail column and its actions; it never adds a
   region or moves a control the other tabs share (`finder-frame.tsx`).
2. **Search is the toolbar's first control**, 256px wide (`w-64`, capped by the
   toolbar) and the same in every tab that has one; its placeholder names the
   tab ("Search photos…"). A tab with nothing to search draws no field, and no
   other control takes its place.
3. **Every tab browses on open.** Selecting a tab asks its sources an empty term
   and draws the answer; a source that cannot answer an empty term says why in
   the content region. A blank tab is a defect.
4. **One card anatomy:** a 4:3 preview well, then name and source mark, then
   meta and the item's own licence — an icon library's single licence stays on
   its source. The preview renderer is the only permitted variation between
   kinds (`finder-card.tsx`).
5. **Every control carries the state set in Control states**, and a finder
   control adds no state of its own.
6. **One animated skeleton for every wait**, drawn as cards in the grid; an
   appended page adds skeleton cards rather than replacing the rows
   (`skeleton.tsx`).
7. **Append, don't page.** Reaching the grid's end asks the next page. A source
   that can only page explicitly puts its control in the footer's status slot,
   and that control keeps the same shape in every tab that needs one.
8. **States live where they are read.** Empty, error and credential sentences
   sit in the content region; an action's outcome sits in the footer's one
   `role="status"` line. The status line never repeats a body sentence.
9. **Selection is single.** The selected card takes the accent border, a ring and
   a check; the footer carries its actions; a new question clears it, and each
   tab keeps its own selection while the finder stays open.
10. **Tab order is fixed:** Fonts, Icons, Images, Videos, Colours, Wallpaper
    Engine. A category the registry adds later appends rather than inserts.
11. **Double-click opens the media preview**, and the footer's Preview icon
    button is the same surface's keyboard route. Only a result with something to
    enlarge takes the gesture and the button; every other kind keeps its
    single-press selection.
12. **Finder controls come from `finder-controls.tsx`.** A new pill, button,
    chip, pager or skeleton style is a change to this file, not to the tab.

### Editing and recovery

- **Draft is not authored state.** Text and number fields retain the draft while
  typing, including an empty string, a minus sign and an incomplete decimal.
  Enter or blur commits one valid changed value; Enter followed by blur cannot
  commit twice. Escape restores the last authored value without history. IME
  composition is not an Enter commit.
- **Validation belongs to the field's owner.** Finite numbers and the owner's
  bounds are required; invalid input is never coerced to zero or silently
  clamped. Show the reason beside the field, mark `aria-invalid`, and preserve
  the rejected draft until corrected or cancelled. Optional numeric fields
  distinguish clearing the authored key from writing zero.
- **Gestures have one undo boundary.** Sliders and scrubs may preview through the
  existing imperative write funnel. Release commits one changed value;
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

**Glyphs are stroke-based, `currentColor`, drawn on a 24px grid, at one weight
rule: the stroke rises as the size falls, so the rendered weight stays optically
even.** One family, one rule, everywhere — **1.7px at 14px and above, 1.8px at
11–13px, 2px at 10px and below.** A filled glyph carries one of two things, and
never a licence for looks: the escape where a stroke would read faint at the
size (the live check at 12px, the record dot), or the **on/off channel of a
binary state** — the layer row's locked lock, the font picker's favourited star.

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
  elements, so its row cannot depict it. It gets the stack glyph and its name. A
  *card unit* in the Add pane is not arbitrary — the card library is a fixed set
  of eight — so its tile wears the unit's own glyph, one per unit, and no two
  units share one.
- **Destructive actions use `--hot`, never `--accent`.**

## Do's and Don'ts

**Do**

- Present every authorable setting. Convenience is ordering and grouping, never a
  smaller surface.
- Order and group by what a person needs, most likely first, each field with a
  hint where the name is not self-evident.
- Use disclosure for the once-in-a-while, not the frequent.
- Make a section header say what the section is — the question it answers.
- Use sentence case for menu rows; section eyebrows are the only uppercase.
- Print the platform's mark for a chord and use the platform's name for its
  announcement: `⌘⇧P` is printed; "Command Shift P" is what a screen reader says.
- State a refusal in the selected thing's own terms: "Not offered for a group" —
  not "invalid", not silence.
- State a missing reading as **a gap, stated once, quietly**. Never a zero, never
  a dash that could read as data.

**Don't**

- Put a hex value in a surface. Colour comes from a role.
- Add a second horizontal navigation bar.
- Put a tool in the status bar, or a global command in a pane footer.
- Add a per-card inspector column, or a glyph that claims to depict an arbitrary
  group.
- Draw a device frame or notch around the artboard.
- Hide an existing capability because this selection cannot use it, instead of
  refusing it in words; inventing a property its kind does not have is equally
  wrong. The dock's registry-filtered object actions are the one exception: an
  action this selection cannot run is absent from the dock.
- Move a frequently used control to a settings surface.
- Invent a control not in the component table, or an icon outside the icon
  rules, without amending this file in the same commit.
- Assert a capability the code does not have. A control that announces a
  dismissal it cannot perform is a defect in copy, not a cosmetic one.
