# Design mockups

**`current/` is the target.** The editor is being rebuilt towards the original
visual direction as those twenty-five files draw it, and they are **checked at
every plan gate** — not read once and remembered. The three originals below them
are the record of the first cut, not the target.

## The current set — `current/`

The editor as it renders today, in the original visual direction, with nothing
in any file addressed to the reader: no heading, no caption, no note about what
is illustrative. One file per view, so no file needs a specimen — and the
settings modal's four panels are four of those files, because each panel is
drawn once, where a second copy of the frame in one file would make a
`[style*="…"]` selector address more than one element and the reader refuses to
guess between them.

| File | Shows |
|---|---|
| [`current/shell.html`](current/shell.html) | The whole shell in its Editor mode: the header with the mode switch, the menubar, the five-slot rail, the Add pane, the stage and its floating clusters, the inspector, the status strip |
| [`current/settings.html`](current/settings.html) | The settings surface on its own, with §7's three tabs and the six-palette grid |
| [`current/settings-keyboard.html`](current/settings-keyboard.html) | The same modal with §7's Keyboard panel showing: its header bar and return-to-default action, and the reference's own rows with their chord marks and per-row controls |
| [`current/settings-about.html`](current/settings-about.html) | The same modal with §7's About panel showing: what the editor is, and the version facts this build can read |
| [`current/controls.html`](current/controls.html) | The inspector column as it renders, in the reference palette: wells, a slider, segmented rows, the read-only treatment, a refusal |
| [`current/controls-editorial.html`](current/controls-editorial.html) | The same column on the editorial ground — the same file with the token table swapped, so a hard-coded colour cannot hide in it |
| [`current/type-presets.html`](current/type-presets.html) | The Tokens pane as two library lists — paint tokens and type presets, nothing inline — with the selected preset's name, role, bound face, Unbind and size fields in the inspector |
| [`current/store-themes.html`](current/store-themes.html) | The shell in its Themes mode, Your themes half: the mode switch in the header, the two halves as tabs beside the search box, the five facet buttons and the sort, a four-column gallery of cells carrying their origin badge, and the numbered pager |
| [`current/store-browse.html`](current/store-browse.html) | The same mode's Store half with the Sensors facet chosen — two values, so every cell drawn reads both: the **same cell box** as the local half, with its kind, its counts and its dates, Install, Installed and Update, the pager's five-nearest-pages case with its ellipses, and the line that says which kinds this build skipped |
| [`current/store-facets.html`](current/store-facets.html) | The one new control on its own: a facet button open, drawn on Shape because that is the facet with three groups — orientation, aspect ratio and pixel size, each with its counts, each group's values summing to the catalogue, and `Other` carrying the long tail |
| [`current/store-detail.html`](current/store-detail.html) | The item's own surface, drawn as the viewer it is: one modal for every kind, 960px wide with a fixed preview stage the theme is contained in, no title bar, and the sensors, shape and tags as three pill groups plus the actions in a 270px right panel |
| [`current/host-settings.html`](current/host-settings.html) | The shell in its This PC mode: the displays and the theme each shows, the device groups and their names, the display settings, and one theme's unanswered question |
| [`current/asset-finder-entry.html`](current/asset-finder-entry.html) | Where the finder opens from: the Assets pane's Find assets control, and the File menu's Find assets and Import file entries |
| [`current/assets-pane.html`](current/assets-pane.html) | The Assets rail slot and its pane: the two import intents, the finder link, and one row per file grouped by kind with its thumbnail, metadata, in-use state and, when chosen, its Lucide action glyphs |
| [`current/assets-font-import.html`](current/assets-font-import.html) | The same pane after a local font file is imported: the declared file, the metadata form it cannot answer for itself, and Create type preset |
| [`current/assets-preview.html`](current/assets-preview.html) | An image or video opened from Preview, almost fullscreen at the finder's own box in the theme viewer's shape: a fixed stage taking every pixel the facts do not, and a 270px right panel of badges, pills and the eligible actions |
| [`current/asset-finder-fonts.html`](current/asset-finder-fonts.html) | The finder on Fonts in the shared layout: search, source chips, the same result grid, trio and family tiles from two providers, and the selected trio's preview panel with the author's sample text, every role's before→after and Apply to theme |
| [`current/asset-finder-font-family.html`](current/asset-finder-font-family.html) | The same grid after a font-name search: a trio and the family that matched, with the family's cuts, sample and two outcomes — Add as type preset or Apply to an existing preset — in the preview panel |
| [`current/asset-finder-icons.html`](current/asset-finder-icons.html) | The finder on Icons with two sources enabled: the chip row with per-source counts, the mixed round-robin grid with a source badge on every tile, Load more, and the import action |
| [`current/asset-finder-wallpaper-engine.html`](current/asset-finder-wallpaper-engine.html) | The finder on Wallpaper Engine, the one fixed local source: the install it read, the still-at-rest filter, and rows whose action is the outcome — Convert to image, Convert to video, or no conversion for a preset |
| [`current/asset-finder-scene-export.html`](current/asset-finder-scene-export.html) | The conversion sheet over the finder: the PNG/MP4 choice with the video values to type into Wallpaper Engine, the five steps with Delete the dynamic text left open, the export watcher's two folders, and the credit |
| [`current/asset-finder-sources.html`](current/asset-finder-sources.html) | The sources panel: one group per category, each source's locality and licence, an enabled one, one needing a key, one disabled, and Wallpaper Engine fixed at Always on |
| [`current/asset-finder-states.html`](current/asset-finder-states.html) | The finder with nothing to show: a failed source kept as a struck chip and named in a banner, a source needing a key, and the empty grid that offers only the controls that change the answer |
| [`current/settings-connections.html`](current/settings-connections.html) | The settings modal's fourth panel: stored keys shown as a four-character hint with Verify and Clear, an unconnected source's Save, and a rejection that names the status it saw |
| [`current/save-cleanup.html`](current/save-cleanup.html) | The save confirmation on Save to library or Save package: the unused files it found, the opt-in removal that is off by default, and the Recycle Bin warning |

## The originals — the record

The original visual direction, kept for provenance and **not the current
target**. Each carries a one-line label at the top saying so, and **the
originals are never edited again** — not to correct a value, not to remove a
specimen, not to follow a ruling. What they hold is the first cut, and Git
stores the rest.

| File | Shows |
|---|---|
| [`editor-shell.html`](editor-shell.html) | The first shell, with the settings specimens below it |
| [`inspector-controls.html`](inspector-controls.html) | The first control vocabulary, in the reference palette |
| [`inspector-language.html`](inspector-language.html) | The first light-palette column, with a historical group comparison |

Open them in a browser. Each is self-contained — one file, no build, no server.

## What they are, and what they are not

- **They are the design language, drawn.** [`../../../DESIGN.md`](../../../DESIGN.md)
  is the normative text; these are its worked example. Where the **current set**
  and DESIGN.md disagree, **DESIGN.md wins and the file is stale** — correct it
  in the same commit that corrects DESIGN.md. The originals are never corrected,
  by this rule or any other.
- **They are not pixel baselines.** [`../../evidence/screenshots/`](../../evidence/screenshots/)
  holds rendered evidence from built bundles and is explicitly not cross-platform
  golden files; neither is this. Platform font metrics, scrollbar widths and
  device pixel ratios differ, and a difference in those is not drift.
- **They are not a specification of behaviour.** They show one state of each
  surface. Behaviour lives in the spec and, finally, in the code.
- **The current set's copy is the product's own**, taken string by string from
  `ui-copy.ts` or the component that owns the words, so the drawing and the
  editor cannot disagree about what a surface is called. The originals' copy is
  illustrative — it predates the surfaces it draws — and the copy rules are
  DESIGN.md §9. **The asset finder, Assets pane, type-preset, save-cleanup and
  Connections drawings are the exception until their plans land**: no component
  owns those words yet, so their copy is the spec's wording and moves into
  `ui-copy.ts` with the implementation, which is what a gate compares the built
  surface against.

## Reviewed reference contract — 2026-10-08

**This section describes the three originals as they stood at that review.** It
is a historical record of what those files retain, not an instruction: the
originals are frozen, and a live correction belongs to the file in `current/`.
The current set carries the direction this contract asked for.

- **Preserve the original visual direction.** Warm illustrative artwork,
  compact diagram tiles, subtle stage texture, fine dividers, floating dock,
  lens chips and palette swatch cards remain. A contract correction is not a
  licence to flatten or replace the composition (DESIGN.md §7.8).
- `editor-shell.html` retains the original shell and side-by-side Settings
  specimens. Corrections remove stale Document-menu/Canvas-tab proposals,
  ornamental search and empty-inspector statistics. Four slots and 246px pane
  remain normative. Lens chips are illustrative, not the entire choice list;
  the dock is a separately labelled selected-state specimen.
- `inspector-controls.html` selects a **gauge chart child**, not a card group,
  retaining its wells, slider, swatch, focus/refusal examples and typography.
  Position is second; Spends is read-only. The exact chart inventory belongs
  to descriptors, not this vocabulary illustration.
- `inspector-language.html` retains a labelled historical group comparison
  beside the light chart-child treatment. It does not claim the two selections
  are equivalent. Editable values now have wells; read-only Spends says so.
- These pages are **drawn specimens, not functional product prototypes**.
  No save, import, publish, validation or live telemetry is implemented here.
  All values and timing claims are illustrative. Keyboard models, focus
  trapping and mutation safety require the real host, never a screenshot.
- Specimen palette values are illustrative, not proof that the shipped six
  palettes meet contrast. Capture the product and measure its resolved
  required text and focus boundaries.

## How a gate uses them

A plan whose phase changes a visible surface ends with a **parity capture**: the
built editor, photographed in the state the mockup shows, placed beside it, and
the differences listed. Each difference is then either **fixed**, or **licensed
by a rule that predates it** — a DESIGN.md §N, an ADR or a spec section that
positively requires the product's treatment, named in the commit. Recording a
difference **as deliberate is not a disposition**: it names no rule, and it is
the escape hatch that let a week of drift pass every check green. Where the
written rules are silent, the drawing governs and the product is the defect.

Silence is not a pass. A gate that produces no comparison has not run — the
failure this exists to prevent is exactly the one that produced the previous
pass's "the redesign is done" against an editor that looked unchanged.

The capture itself uses the existing mechanism and its rules — `YUNARI_CAPTURE=1`,
one worker, previewing built bundles, capturing only actions registered in
[`../../evidence/screenshots/README.md`](../../evidence/screenshots/README.md).

## Keeping them current

A mockup that no longer matches DESIGN.md is worse than no mockup, because it is
believed.

- **The current files are refreshed when the set of surfaces changes.** A pane,
  a tab, a section or a rail slot that appears or disappears is drawn — in the
  original's treatment, never in a treatment of the product's devising.
- **A glyph square drawn as a control starts at §5's 26px bound.** DESIGN.md's
  icon button is "a 26–30px square at `--radius-md`, glyph only", so a drawing
  that draws one as a control draws it 26px at `--radius-md` — never smaller,
  not even where the cluster around it is compact.
- **The treatment is the target and is never redrawn from the product.** Colour,
  spacing, radii, type, elevation, hairlines, flush regions and the palette,
  navigation and dock treatments are copied from the original drawings. When the
  product differs, the product is the defect.
- **Every drawn text element states its token's companion, and the page
  furniture carries no ratio.** §2 gives each of the six sizes its own
  line-height, so one page-body ratio cannot express them: the `<style>` block's
  `font` sets a size only, and each element holding its own text writes the
  `line-height` of the size it resolves to (`vg-440`). An element that omits it
  renders at `normal`, which no gate reads.
- **The originals are never edited again.** They are the record of the first cut;
  Git stores the history.
