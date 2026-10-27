# Manager census

A review **of** [`ownership.md`](ownership.md), taken at `03d820d7` on 2026-10-12,
answering the user's two questions of 2026-10-09 in the order they were asked:

> Does any domain manager need clean-up — same domain spread across a few
> managers, a domain under another owner that needs to become a manager of its
> own?
>
> And the reverse: does any manager turn out to be too small or narrow a concept
> to stand on its own and should be folded into another?

**The reverse question is not re-opened here.** It was measured on 2026-10-09 by
reading `layer-manager` (68 lines), `deletion-manager` (62) and
`object-lock-manager` (129) in full: each owns one decision nobody else owns, so
no manager is too small to stand alone and a merge needs an argument about a
concept, never a line count. This census confirms that reading and adds no row
to it.

**This document modifies nothing.** It is the input to the redistribution task,
and it remains a snapshot of `03d820d7`; the work it calls for has since begun —
`248ff08f` took the library save protocol into `theme-library-manager/` and
`aff063d8` took the theme document into `editor-document.ts` — so its tables
describe that commit rather than the code as it stands.

## The instrument

`ownership.md` carries its own test, and it is the one used here:

> for each row, find the code that would *reject* a wrong value for that concept
> — the guard, the validator, the `refuse` — and ask whether it lives in the
> module the map names. A guard in an unnamed module is a missing row or a wrong
> owner.

The inventory below is taken from the code, not from the map's table and not
from the register. Every site was read at `03d820d7`; where a count is the
evidence it was computed in node over the file list rather than read off a piped
shell count.

## 1. The instrument, applied

### 1.1 Rows whose guard is in the module the map names

| Concept (map row) | The guard | Where it lives |
|---|---|---|
| Canvas stack order | `reorder`'s membership check — `owner.getObjects().includes(target)`, which is what stops Fabric inserting a group child into the root | `layer-manager/index.ts` |
| Object lock/unlock | `TRANSFORM_LOCKED`/`TRANSFORM_FREE` and `apply`; `hasControls` is the load-bearing flag | `object-lock-manager/index.ts` |
| Active-object and selection deletion | `deletable` plus "a removal that found nothing is not a deletion" (`removed === 0`) | `deletion-manager/index.ts` |
| Group and ungroup | `entry instanceof Group` and `members.length < 2` | `grouping-manager/index.ts` |
| Scene undo/redo history | `sameScene` (a no-op records nothing) and `#queued` (one restore at a time) | `history-manager/index.ts` |
| Per-image crop session | `canCrop` (image, unrotated) and `cropClipRect`'s finite/positive throw | `crop-manager/index.ts` |
| Imported image pixel bound | `boundedImportSize`'s finite/positive throw and the `MAX_IMPORT_IMAGE_EDGE` clamp | `image-manager/index.ts` |
| Text creation | `keepTypedText` refusing a multi-run object (`"refused"`) | `text-manager/index.ts` |
| Structured editor diagnostics | the `EditorErrorCategory` union and `build`, which drops an absent `cause` rather than storing `undefined` | `error-manager/index.ts` |
| Product shortcuts | `bindingMatches`/`bindingFor`, plus `defersToTextEntry` and `isModalOpen` | `shortcut-manager/index.ts` |
| Which displays a theme can be seen through | four `RangeError` throws — a missing ratio, a shape no lens frames, a missing lens, a degenerate rect | `display-lens.ts` |
| Applying an arrange action | `canArrange` and `applyArrange`, with `arrangeMinimum` exported so a gating surface cannot advertise an action the applicator refuses | `arrange.ts` |
| Which object and arrange actions exist | `eligible` per action and `actionEnabled` | `object-actions.ts` |
| The chrome glyph vocabulary | `glyphStrokeWidth` and `Glyph`, the one place a weight is set | `editor-shell/icons.ts` |
| Shape material fields | `writePanelField` (lands on a bound, refuses a fraction) and `adoptGeometry` | `selection-inspector/panel.ts` |
| Frosted-glass control | `refusalOf`, and the blur landing on `MAX_GLASS_BLUR_RADIUS` asked of the owner | `selection-inspector/glass.ts`, bound owned by `renderer-core/src/theme/glass.ts` |
| Glass lifecycle re-resolve | `EditorShell.refreshGlass` | `editor-shell.ts:587` |
| Palette-token authoring and reassignment | `reassignPaletteToken` / `paletteTokenUsage` | `palette-manager/index.ts` |
| Type-token authoring and reassignment | `reassignTypePresetToken` | `type-preset-manager/index.ts` |
| Theme download | `documentKey`'s authored-only strip and `serializeThemePackage`'s `!result.ok` throw | `persistence-manager/index.ts` |
| Authoring-time value-run tokens | `runPlaceholder` / `toAuthoringSegments` | `run-placeholder.ts` |
| The languages an author may pick | `THEME_LANGUAGES` and `languageLabel` | `theme-languages.ts` |
| OS clipboard copy/cut/paste/duplicate | `reassignIds`/`carryBindings` (`duplicate-id` prevention) and the per-type allocator | `clipboard-manager/index.ts` |
| New-object defaults | `newObjectName`, `SHAPE_KINDS`, `createNewShape` | `new-object-defaults.ts` |
| Drag-time snapping | `isSupportedActiveSelection`, the guarded bindings, `readMovementModifiers` | `snap-manager/index.ts` |
| Rotation-angle and size indicators | `formatSize` returning `undefined` on a non-finite dimension | `indicator-manager/index.ts` |
| Open-package asset bytes | `ASSET_FILE_EXTENSIONS` and the `sha256` declaration | `asset-manager/index.ts` |
| The artboard-to-viewport transform | `computeArtboardTransform`'s `RangeError` on a degenerate viewport | `renderer-core/src/artboard.ts` |

**One rule, stated here and applied everywhere below: a row names a module when
the file holding the guard is fixed by the row.** The map fixes it in two ways,
and only two:

- **A module directory** — a `*-manager/` directory, whose entry point is
  `index.ts`, so the directory and its module are the same thing and the row
  points at that one file. **All twenty `*-manager/` directories have an
  `index.ts`** (verified for each). **Seventeen rows in the table above are this
  case.** What makes them right is *not* that every guard sits in the entry file
  — `snap-manager`'s guard column names `isSupportedActiveSelection`, defined in
  the sibling `snap-manager/selection-eligibility.ts:13` and imported by
  `index.ts:28` — but that the directory is the unit the row means, so a guard
  anywhere inside it is named. All seventeen are therefore right rather than
  findings: `layer-manager`, `object-lock-manager`,
  `deletion-manager`, `grouping-manager`, `history-manager`, `crop-manager`,
  `image-manager`, `text-manager`, `error-manager`, `shortcut-manager`,
  `palette-manager`, `type-preset-manager`, `persistence-manager`,
  `clipboard-manager`, `snap-manager`, `indicator-manager`, `asset-manager`.
- **An explicitly named file** — `selection-inspector/panel.ts`,
  `renderer-core/src/theme/glass.ts`, `editor-shell/icons.ts` and the rest. Eleven
  of the table's rows are this case.

Anything else names a **shelf**: a directory that is not a module directory and
is not a file. `renderer-core/src/theme/` is one — no `index.ts`, eleven non-test
modules inside. `editor/src/selection-inspector/` is another, and it is the case
that shows the criterion is not "does it have an `index.ts`": it has one, but it
is a family of peer modules, and the map files them as peers by naming three of
its files separately (`:85` `panel.ts`, `:86` `glass.ts`, `:100` `style.ts`)
while its family row (`:99`) names only the directory. What makes a directory a
module for this rule is being **the unit the row means**, and the map's own
filing is the evidence for which that is. A guard in a sibling file inside a
shelf is unnamed, which is what §1.2 items 3, 4 and 16 are.

**The map's own habit is the evidence for the grain:** 22 rows mention a
`*-manager/` directory, and only two of them name a file inside one — `:75`, which
names all three of `chart-manager/`'s source files (`panel.ts`, `chart-fields.tsx`,
`index.ts`, each present in that directory), and `:89`, which names `asset-manager/`'s entry
(`index.ts` bytes). Every other manager row names the directory bare. `:75` is
**right, not a finding**: naming a directory's member files does not turn it into
a shelf, because the directory is a `*-manager/` directory whose entry is
`index.ts` and the files named are its own. The same map names three files inside
`editor/src/selection-inspector/` (`:85`, `:86`, `:100`) and two inside
`renderer-core/src/theme/` (`:113`, `:148`). The map does not treat a manager
directory and a shelf as the same kind of owner, so neither does this census.
**Branch taken: the distinction holds.** The other
branch — that a directory row suffices everywhere — would make all seventeen
manager rows above missing rows, which is the opposite of what the code shows.

### 1.2 Guards found in modules the map does not name

These are the finding the instrument exists for. Each is a decision that would
reject a wrong value, living outside the row that claims the concept.

**Files, directories and managers are counted separately throughout.** A *file*
is one source file; a *directory* is where a file sits; a *manager* is one of the
twenty `*-manager/` directories. "Module" is reserved for the §1.1 rule above,
which is why the counts below never say "N modules". The three counts differ
exactly where a manager holds several files, and it is why the `locked` count
reads **9 files in 7 directories, only 5 of which are managers**.

1. **The `locked` predicate has no owner.** `object-lock-manager` owns writing
   the flag and re-deriving Fabric's transform flags, and its `isLocked` is
   module-private. The test is spelled again in **11 non-test sites across 9
   files, in 7 directories — 5 of them managers** (the other two directories are
   `editor-shell/` and `selection-inspector/`, which contributes three of the
   nine files): `clipboard-manager/index.ts:310,338`,
   `controls-manager/index.ts:82,157`, `deletion-manager/index.ts:15`,
   `editor-shell/bridge.ts:185`, `indicator-manager/index.ts:93`,
   `object-lock-manager/index.ts:40`, `selection-inspector/index.ts:437`,
   `selection-inspector/per-kind-column.ts:653`,
   `selection-inspector/view.ts:634`. Polarity is still inconsistent: 8 sites
   read `=== true` and 3 read `!== true`. (`panes/composition/row-affordances.tsx`
   reads `row.locked`, a boolean projected by `bridge.ts:185` — a consumer, not a
   tenth decider. `scene-fabric/src/persist.ts:81` lists `"locked"` in
   `SCENE_PERSISTED_PROPERTIES`, which is a third decision the map has no row
   for: **what persists**.)
2. **The collection that holds an object.** Fabric's membership trap is
   documented in four places with three contracts: `layer-manager/index.ts:23`
   (`Canvas | Group`), `deletion-manager/index.ts:23`
   (`Canvas | Group | undefined`), `editor-shell/layer-tree.ts:460`
   (`Group | undefined`), `editor-shell/bridge.ts` (the same test to pick a
   child). Its companion — an `ActiveSelection` lives outside `_objects` — is
   spelled four times: `layer-manager/index.ts:29` (named `targetsOf`),
   `deletion-manager/index.ts:36`, `history-manager/index.ts:113`,
   `canvas-nudge.ts`.
3. **Which sections a selection gets.** `selectionKindOf` (`:135`),
   `KIND_QUESTIONS` (`:171`) and `perKindColumn` (`:649`) in
   `selection-inspector/per-kind-column.ts`. The map's row (`:99`) names the
   directory — a **shelf** by §1.1's rule, not the module this guard is in, and
   the map names three sibling files in that same directory when it means them.
4. **Whether an edit is permitted.** `editRefusal` at
   `selection-inspector/view.ts:441`, returning `stale`/`locked`/`unknown`/
   `invalid`. Same case as item 3: a shelf is named, the module holding the guard
   is not.
5. **The one-paint-per-chart-series invariant.** Declared by
   `chartPaintFieldsFor` in `renderer-core/src/charts/` and enforced by
   `seriesPaintFor` (`chart-manager/index.ts:38`) and the exported
   `carriedPaintFor` (`:71`). A declared invariant whose repair is one
   consumer's private arrangement.
6. **Contain-fit.** `viewport-manager/index.ts:209` (`fitScaleFor`) re-derives
   `Math.min(box.width / board.width, box.height / board.height)`, clamped to
   `MIN_ZOOM`/`MAX_ZOOM`; `fitTransformIn` (`:219`) re-derives the centring.
   `computeArtboardTransform` — the map's named owner — has **no editor caller**:
   its only callers are `renderer-core/src/scene/mount.ts` and
   `scene-fabric/src/scene.ts`.
7. **A Line's four document scalars.** `controls-manager/index.ts:107-197`
   writes `x1`/`y1`/`x2`/`y2` and binds the Shift-angle constraint. Those are
   document geometry, and the map's row for this module says handle styling.
8. **A text box's authored height.** `controls-manager/index.ts:255` calls
   `writeAuthoredBoxDimension`; it is one of **three** writers of
   `yunariText.box` — the shared helper, `selection-inspector/index.ts`, and
   `text-manager/index.ts:88-91`, which stores `width * scaleX`, the value
   `scene-fabric/src/authored-box.ts` says would grow the box on every pass.
9. **Two persisted object properties and layer reordering.**
   `editor-shell/bridge.ts` writes `name` (`:345-346`), `visible` (`:312`),
   `locked` (`:326-333`) and owns `reorderLayer` (`:369`) — while the map's row
   calls the file "Selection snapshot, the document's identity and dock
   eligibility".
10. **The stored-document base and the save protocol.**
    `editor-session.ts` holds `LibraryBase`, `#saveLibrary`, `#writeLibrary`,
    `#libraryPayload`, `#resolveConflict`, `#openLibrary`, with four sites that
    must clear the base. The map's row for "Theme download" names
    `persistence-manager/`, which owns only the file download and the dirty key.
11. **A globals edit must reach every consumer.** `#setPalette`
    (`editor-session.ts:1188-1193`), `#deletePalette` (`:1214-1219`) and
    `#setTypes` (`:1230-1232`) call six, six and three owners by hand;
    `#deleteType` (`:1269-1270`) calls two. Nothing owns the receiver list, and
    the six-owner block is now written out twice.
12. **Which of a manager's refusals a menu advertises.** `object-actions.ts`
    re-states the lock policy at six eligibility sites (`:108`, `:117`, `:126`,
    `:167`, `:174`, `:200`), each with a comment naming the manager it must
    agree with — "ClipboardManager.copy refuses a locked object; eligibility has
    to agree." The agreement is hand-maintained and nothing checks it.
13. **Is this still referenced.** `dropDanglingBindings` is
    `editor-shell.ts:126`; `assetReferencedBy` is `asset-manager/index.ts:427`;
    the palette-token walk is `scene-fabric/src/palette-references.ts`. Three
    modules, three concepts of "referenced", no row.
14. **Group reachability.** `grouping-manager` writes `selectable`/`evented` on
    every object outside the entered group, and its own comment calls this
    "`object-lock-manager`'s own idiom for *not reachable*" — a second decider
    of the same two keys, one level up from the flag.
15. **Shared colour parsing.** `components/ui/colour-maths.ts` holds
    `parseHex`, `toHex` and `parseColour`, imported by `colour-picker.tsx` and
    `gradient-editor.tsx`. The map lists "shared colour parsing" as a known gap
    with no owner while a module already answers it.
16. **A fresh object id.** The map names this gap itself and says "seven creation
    sites"; measured at HEAD there are **seven** inline prefix-plus-`randomUUID`
    lines, across **six** files (`chart-manager` contributes two):
    `chart-manager/index.ts:267` (`binding-`) and `:354` (`chart-`),
    `grouping-manager/index.ts:187` (`group-`), `image-manager/index.ts:123`
    (`image-`), `new-object-panel.ts:197` (`${kind}-`),
    `selection-inspector/run-edits.ts:176` (`binding-`), and
    `text-manager/index.ts:217` (`text-`). **The map's count is right.**
    `clipboard-manager/index.ts:116` spells `crypto.randomUUID()` with **no
    prefix**, so it is the odd one out rather than the eighth site — it is the
    copy path's fallback *derivation* for an unnamed object, and only that path
    goes through `createWidgetIdAllocator`. **One of the seven sits in a shelf
    and is unnamed for the same reason items 3 and 4 are**:
    `selection-inspector/run-edits.ts` is a sibling of
    `selection-inspector/index.ts`, and the map's row for that directory (`:99`)
    names the family, not this file. The other six are in manager directories or
    in `new-object-panel.ts`, both of which §1.1's rule fixes.
17. **The host's first-run page and route dispatch.** `host/src/server.ts:205`
    builds `firstRunPage()` with its own colour literals (`#14161c`, `#e8ecf3`)
    and the file carries 34 `url.pathname` reads under three rows, with no row
    for the page.

## 2. Question (a) — one line per manager

Does it own more than one concept, such that one deserves an independent
manager? Answered for all twenty, including the nos.

| Manager | (a) |
|---|---|
| `snap-manager` | **Yes — the clearest case.** One acquire-hold-plan-verify protocol implemented twice, split movement-vs-scale (the duplicated axis) instead of by the sub-domains that are genuinely separate: spacing and gesture projection. 30 non-test files, 10,701 lines (10,671 by `wc -l`; see §4). |
| `controls-manager` | **Yes.** Handle styling *and* a Line's four document scalars *and* the authored text-box height — geometry writing under a styling row. |
| `persistence-manager` | **Yes.** It owns download plus the dirty key; the save protocol it is named for (library base, conflict, payload policy) is in `editor-session.ts`. |
| `grouping-manager` | **Yes, marginal.** Group/ungroup membership, plus the entered-group reachability mode — a separate concept with its own lifecycle, its own history re-resolve and its own known defect (`vg-188`). |
| `viewport-manager` | **Yes, marginal.** Camera state (zoom/pan/fit) plus the lens framing decision, though the lens table and its guards are correctly `display-lens.ts`'s. |
| `shortcut-manager` | **Yes, marginal.** The binding table, plus the deferral predicate (`isTextEntryTarget`, `isModalOpen`, `defersToTextEntry`) — a distinct concept consumed outside the module. |
| `text-manager` | **Yes, marginal.** Text creation, plus the authored-box write, which is a scene-fabric policy. |
| `chart-manager` | **No as a manager, yes as a seam.** Settings/bindings projection and paint repair, but the paint repair exists only because the declaring owner does not enforce; that is a row question, not a new manager. |
| `asset-manager` | **No.** Bytes, extension map, reference query — one job (open-package assets). 436 lines in one file is length, not two concepts. |
| `clipboard-manager` | **No.** Copy/cut/paste/duplicate and the copy-id policy are one concept: a copy is a copy, not a twin. |
| `crop-manager` | **No.** |
| `deletion-manager` | **No.** 62 lines, one decision. |
| `error-manager` | **No.** 59 lines, 6 importers. |
| `history-manager` | **No.** |
| `image-manager` | **No.** Import plus the pixel bound; the bound is part of import. |
| `indicator-manager` | **No.** |
| `layer-manager` | **No.** 68 lines, one decision. |
| `object-lock-manager` | **No.** 129 lines, one decision — and the decision it owns is the one every other module re-spells (§3). |
| `palette-manager` | **No.** |
| `type-preset-manager` | **No.** 118 lines. |

Clearance rate: **13 of 20 own one concept**; 3 are clear multi-concept cases
(`snap-manager`, `controls-manager`, `persistence-manager`), and 4 are marginal
seams (`grouping-manager`, `viewport-manager`, `shortcut-manager`,
`text-manager`).

## 3. Question (b) — one line per manager

Is any concept it owns also decided by another manager? Answered for all twenty.

| Manager | (b) |
|---|---|
| `deletion-manager` | **Yes, twice.** Reads `get("locked")` inline (`:15`) rather than asking the lock manager; re-spells the membership fact and the `ActiveSelection` companion (`:23`, `:36`) that `layer-manager` owns. |
| `object-lock-manager` | **Yes.** It writes the flag but does not own the predicate: 8 other files spell the test, in two polarities. |
| `indicator-manager` | **Yes.** Reads `locked` (`:93`) *and* Fabric's `lockRotation`/`lockMovementX`/`lockMovementY`/`lockScalingX`/`lockScalingY` directly — it decides what a lock means for a tooltip, separately from the manager that derives those flags. |
| `clipboard-manager` | **Yes.** `get("locked") === true` twice (`:310`, `:338`); also consumes `deletion-manager` for cut, which is correct delegation rather than a second owner. |
| `controls-manager` | **Yes.** `get("locked") !== true` twice (`:82`, `:157`), and it is one of the three writers of `yunariText.box`. |
| `history-manager` | **Yes.** `selectedIds`/`reselect` (`:113`) re-spell the `ActiveSelection` membership rule. |
| `grouping-manager` | **Yes.** Writes `selectable`/`evented` — the lock manager's idiom — and `editRefusal` returns `"locked"` as a refusal reason in a fourth module. |
| `viewport-manager` | **Yes.** Re-derives contain and centring, which `renderer-core/src/artboard.ts` owns; the editor version has none of that guard. |
| `palette-manager` | **Yes.** `reassignPaletteToken` is the manager's, but *which* owners a globals edit must reach is decided in `editor-session.ts`. |
| `type-preset-manager` | **Yes.** Same fan-out, and the type path reaches three owners where the palette path reaches six. |
| `persistence-manager` | **Yes.** The save protocol is in `editor-session.ts`; the manager owns the download. |
| `snap-manager` | **Yes.** Reads `lockMovementX`/`lockMovementY` (`index.ts:283-284`) instead of asking the lock manager, and deliberately so — alignment follows content, not lock. That is a divergence, not a defect, and it is undocumented in the map. |
| `chart-manager` | **Yes — cross-package.** `renderer-core/src/charts/` declares the invariant; `chart-manager` enforces it. |
| `text-manager` | **Yes.** The authored box has three writers; `scene-fabric/src/authored-box.ts` claims to be "The single write every geometry surface shares". |
| `asset-manager` | **Yes, weakly.** `dropDanglingBindings` lives in `editor-shell.ts`, so "is this asset still referenced" is split across two modules. |
| `shortcut-manager` | **Yes.** `isTextEntryTarget` is consumed by `viewport-manager/navigation.ts`, which decides camera-key deferral from another manager's predicate. |
| `image-manager` | **No.** Its guard is its own and undisputed. |
| `crop-manager` | **No.** `canCrop` is shared *within* the family so the button cannot appear for a selection the session would refuse. |
| `error-manager` | **No.** The category union is owned here and everyone consumes it. |
| `layer-manager` | **No — it is the module that is copied.** The membership fact is re-spelled *out* of it, not into it. |

Clearance rate: **4 of 20 have no concept decided elsewhere** (`image-manager`,
`crop-manager`, `error-manager`, `layer-manager`). The dominant family is the
`locked` predicate, which reaches 9 files in 7 directories, 5 of them managers,
and the second is
the Fabric membership fact, which reaches 6 files.

## 4. The size measurement, re-taken

**Scope and convention, stated because a count without them is not
reproducible.**

- **Root:** `src/web`.
- **Skipped directories:** `node_modules`, `dist`, `.vite`, `coverage`,
  `test-results`, `playwright-report`, `.agent-scratch`.
- **Extensions counted:** `ts`, `tsx`, `mts`, `cts`, `js`, `jsx`, `mjs`, `css`.
- **A file is a test file when** its basename holds a `.test.` or `.spec.`
  infix, **or** its path contains a `tests`/`test`/`__tests__`/`e2e` directory
  segment. Everything else is non-test.
- **A line is a `split(/\r?\n/)` element**, so a file's trailing newline counts
  as a line and every total here runs **one higher per file** than `wc -l`.
  `snap-manager`'s 30 non-test files are **10,701** by this convention and
  **10,671** by `wc -l`; both are the same file set. Where another document cites
  a `wc -l` figure, subtract one per file to compare.

| Measure | Count |
|---|---|
| Source files scanned | 602 |
| Non-test source files | **309** |
| Non-test at or past 500 lines | **32** |
| Non-test past the 800 stop | **12** |
| Test files at or past 500 lines | 64 |

`.agent-scratch` is excluded deliberately: it is gitignored (`gitignore:75`),
untracked, and holds agent scratch rather than product source. Including it added
8 files.

**The load-bearing pair reproduces exactly** — 32 and 12 — and so does
`vg-364`'s "at HEAD on 2026-10-12 it is 32 and 12". Every variant of scope and
test predicate gives 32 and 12; only the denominator moves, and it says nothing
about any conclusion here. The denominators at other scopes, for a reader who
arrives with one: `src/web/packages` alone is 302 non-test files; adding
`tests/` and the root configs gives the 309 above.

Which over-limit files are a concept problem, and which are merely long:

| File | Lines | Verdict |
|---|---|---|
| `editor/src/font-trios.generated.ts` | 28,284 | **Length means nothing.** Generated. Exempt. |
| `editor/src/editor-shell/editor-shell.css` | 2,559 | **Already `vg-274`'s.** Not this census's. |
| `host/src/server.ts` | 1,557 | **Concept problem.** ~28 dispatch sites under three rows, plus a whole page with no row. |
| `snap-manager/scaling/scale-snapping-resolver.ts` | 1,510 | **Concept problem.** The duplicated protocol (question (a), first row). |
| `snap-manager/movement-snapping-resolver.ts` | 1,453 | **Concept problem.** Same. |
| `snap-manager/spacing.ts` | 1,302 | **Merely long, and arguably under-owned.** Spacing is one of the sub-domains `vg-240` calls genuinely separate, so this is a boundary that works rather than one that failed. |
| `editor/src/editor-session.ts` | 1,284 | **Concept problem.** The library base and save protocol sit inside the composition root. |
| `renderer-core/src/theme/fabric-envelope-validate.ts` | 1,224 | **Merely long.** A validator; every line is the same job. |
| `editor/src/editor-shell/shell-layout.tsx` | 987 | **`vg-276`'s**, already filed with its own decision. |
| `snap-manager/scaling/rectangular-scale-gesture-projection.ts` | 986 | **Merely long** — projection is a separate sub-domain (§2). |
| `editor/src/ui-copy.ts` | 870 | **`vg-337`'s**, already filed as a copy-table exemption question. |
| `scene-fabric/src/glass.ts` | 847 | **Merely long.** One concept, one mechanism, already the map's row. |

Files past 500 that are *not* past 800 and are still a signal: `chart-manager/index.ts`
(598 — the paint-repair seam), `editor-shell.ts` (635 — composes eleven managers
and holds `dropDanglingBindings`), `card-library.ts` (657), `selection-inspector/`
index+panel+runs+view (737/752/671/638), `new-object-defaults.ts` (775).

## 5. The register folded in

`vg-232`–`vg-248` are the seventeen rows this family already has. Each is
re-established at HEAD below; nothing here re-files them.

**The rule is §1.1's, and it is not "a directory is not a module".** A row names
a module when the file holding the guard is fixed by the row — either a module
directory whose entry is `index.ts`, or a file the row names outright. A row that
names a **shelf** names no module. That is why the seventeen manager rows in §1.1
are right (the directory is the unit the row means, so a guard anywhere inside it
is named) while a guard in a sibling file of a shelf is a **missing row**. The
registry row `vg-234` leans on —
"Theme semantic types/validation — `renderer-core/src/theme/`" — is a shelf: no
`index.ts`, eleven non-test modules inside, and the map names two of its files
separately (`:113` `widget.ts`, `:148` `glass.ts`). So `vg-234`'s guard in
`object-name.ts` is unnamed, and the same standard governs `selection-inspector`'s
`per-kind-column.ts` and `view.ts` (§1.2 items 3 and 4), its `run-edits.ts` (item
16), and the family row `editor/src/selection-inspector/` at `ownership.md:99`.
The consequence is general: registry rows name shelves — `renderer-core/src/charts/`
(`:153`, eleven non-test modules, no `index.ts`), `host/src/transport/` (`:182`,
two non-test modules, no `index.ts`) — so the map's module-level coverage is thinner
than its row count suggests. `theme-package/src/` (`:149`) is **not** one of the
shelves: §1.1's definition makes it one (not a `*-manager/` directory, and the row
names no file), but its rationale does not — the directory holds one source file,
`index.ts`, declared as the package's `main`/`types`/`exports` entry, so naming the
directory names the module. The definition is narrower than the rationale at that
shape; the claim above rests on the two true shelves.

| Row | At HEAD | Note |
|---|---|---|
| `vg-232` | **Confirmed, and worse.** | Six/three/two owners per path, and the six-owner block is now written twice (`:1188-1193`, `:1214-1219`). |
| `vg-233` | **Confirmed.** | `text-manager/index.ts:88-91` still stores `width * scaleX`; three writers of `yunariText.box` at HEAD. |
| `vg-234` | **Confirmed — the complaint stands.** | The second writer moved from `appearance.ts` to `selection-inspector/index.ts:384`, and the guard **is** now shared — `view.ts:456` and `bridge.ts:346` both call `isObjectName`. The code half is as the row says. The row's other half — "the validity guard lives in a module the ownership map does not name" — also stands: `object-name.ts` is a sibling inside `renderer-core/src/theme/`, a shelf under §1.1's rule, so the registry row for that directory names no module. It is the same standard §1.2 items 3, 4 and 16 are held to. Two writers and two notification behaviours survive. |
| `vg-235` | **Confirmed.** | The base, `#saveLibrary`, `#writeLibrary`, `#libraryPayload`, `#resolveConflict`, `#openLibrary` are all still in `editor-session.ts`, and the map has no row for them. |
| `vg-236` | **Confirmed.** | `bridge.ts` writes `name`, `visible`, `locked` and owns `reorderLayer`. |
| `vg-237` | **Confirmed.** | `controls-manager/index.ts:107-197` writes a Line's four scalars. |
| `vg-238` | **Confirmed.** | `firstRunPage()` and the unnamed dispatch sites are still in `host/src/server.ts`. |
| `vg-239` | **Not re-established.** | Not checked in this census — it is a one-line duplicate inside `#save`, and this task did not read `#save`. |
| `vg-240` | **Confirmed, with a corrected measurement.** | The row says "~8,300 non-test lines across eight files". Measured: the family is **30 non-test files / 10,701 lines**, five past 500 and four past the stop. The *concept* claim stands; the figures were a subset. |
| `vg-241` | **Confirmed.** | `computeArtboardTransform` has no editor caller; `fitScaleFor` re-derives contain. |
| `vg-242` | **Confirmed.** | `seriesPaintFor`/`carriedPaintFor` still enforce what the descriptor owner declares. |
| `vg-243` | **Confirmed, lines moved.** | `selectionKindOf` is now `:135`, `KIND_QUESTIONS` `:171`, `perKindColumn` `:649`; `editRefusal` is `view.ts:441`, not `:165-188`. |
| `vg-244` | **Confirmed.** | The "Packaged fonts" note still gives z-order, grouping and locks to `editor-shell.ts`; the three table rows give them to three managers, and the code agrees with the table. |
| `vg-245` | **Confirmed, and the drift is not yet real.** | `ASSET_PATH_PATTERN` is `renderer-core/src/theme/document.ts:14`; the schema hand-spells it at `theme-document.schema.json:113` and `:123`. Read at HEAD the non-font spelling is **identical**; the font one adds `\.woff2`. The divergence is possible, not observed. |
| `vg-246` | **Confirmed.** | `colour-maths.ts` exists with `parseHex`/`toHex`/`parseColour` and two importers; the map has no row. |
| `vg-247` | **Confirmed, and the count has grown.** | The row says 11 places across 8 modules with five `=== true` and three `!== true`. At HEAD: **11 places across 9 files, in 7 directories — 5 of them managers**, eight `=== true` and three `!== true`. The row counted files; a file was added since, and three of the nine sit under one directory. |
| `vg-248` | **Confirmed.** | Four spellings of the membership fact and four of the `ActiveSelection` companion; `layer-tree.ts:460` is the third `ownerOf`. |

**Not named by any row, found here:**

- `object-actions.ts` re-states each manager's lock refusal at six eligibility
  sites, with a comment per site naming the manager it must agree with. No row
  names this hand-synchronised second owner.
- `history-manager/index.ts:113` re-spells the `ActiveSelection` membership rule
  — `vg-248` names `canvas-nudge.ts:46` and three others but not `reselect`.
- `scene-fabric/src/persist.ts:81` lists `"locked"` in
  `SCENE_PERSISTED_PROPERTIES`: a decision about what persists, with no row.
- `dropDanglingBindings` at `editor-shell.ts:126` versus `assetReferencedBy` at
  `asset-manager/index.ts:427` — two concepts of "still referenced".
- `selectedIds`/`reselect` in `history-manager` must re-find objects by id after
  a revive, which duplicates `layer-tree.ts:436`'s `findById` contract.

Not this family: `vg-209` (`layer-panel.tsx`), `vg-255`
(`selection-inspector/index.ts`), `vg-276` (`shell-layout.tsx`) and `vg-337`
(`ui-copy.ts`) are the per-file size rows this phase's `vg-364` cites as its
evidence. `vg-268`/`vg-283` are the dead `FontPicker` family. `vg-364` itself is
this phase's own row and is discharged by this census plus Task 9, not by any
line here.

## 6. Candidates

**The numbers 1–10 are identifiers, not positions.** A plan and register row
`vg-364` cite candidates by number, the way a plan's task numbers are cited, so
the numbering is stable and does not change when a reader disagrees with an
order. Nothing here is presented as a reach ranking: reach is stated per
candidate, in prose, under one definition — **reach = the production files
outside the owner that hold a site the change must edit**, each measured by the
search named with it. **One candidate (1) also carries an *owner reach***, the
number of production files that import the owner at all; where the two measures
differ, the difference is the finding.

**`snap-manager` is not a candidate at all, and carries no number.** It is the
largest code problem in the census — 30 non-test files, 4 past the stop — but its
blast radius is internal: **one** external production importer
(`editor-session.ts:71`) against 30 files in the family. Its fix is a protocol
re-shape that needs a spec, not an extraction, so it appears here as the extreme
contrast between the two reach measures rather than as a row.

The order below is the order candidates were found in, and the shape label is
what Task 9 should order by.

| # | Candidate | Reach, under the definition above | Shape |
|---|---|---|---|
| 1 | **The `locked` predicate** — export one predicate from `object-lock-manager` (or drop it to a shared Fabric-facts module, which is the same question `vg-248` raises) | **11 sites in 9 files, in 7 directories — 5 of them managers**; owner reach 2 files. Search: `get\(\s*["`']locked["`']\s*\)` over non-test `.ts`/`.tsx`. | **Cross-cutting.** Every reader is a manager or an inspector surface. The ordering question is real: `object-lock-manager` may sit above some of its readers. |
| 2 | **The Fabric membership fact** — one `ownerOf`/`targetsOf` | **8 spellings in 6 files** (4 `parent instanceof Group` + 4 `ActiveSelection` companions; `layer-manager`, `deletion-manager`, `layer-tree`, `bridge`, `canvas-nudge`, `history-manager`). | **Cross-cutting.** The fact is pure Fabric knowledge, so `scene-fabric` is a candidate owner alongside `layer-manager`. `deletion-manager`'s divergent signature is the mechanism, not a style difference. |
| 3 | **The globals fan-out** — one "globals changed" signal the session owns | **7 files**: `editor-session.ts` plus the six receivers it names by hand (`editor-shell.ts`, `live-runtime.ts`, `chart-manager/index.ts`, `new-object-panel.ts`, `artboard-panel.ts`, `selection-inspector/index.ts`). Search: `setGlobals` over non-test `.ts`/`.tsx`, then read the four call paths. | **Cross-cutting.** Cheapest to fix by deleting three lists, not by adding an abstraction. |
| 4 | **The three writers of `yunariText.box`** | **3 files**: `scene-fabric/src/authored-box.ts`, `selection-inspector/index.ts`, `text-manager/index.ts:88-91`. | **Clean extraction.** `authored-box.ts` already claims the job; the other two call it and stop writing inline. |
| 5 | **The save protocol / library base** | **1 file** — `editor-session.ts`, ~250 lines. | **Clean extraction** into its own owner, and the only candidate whose move *creates* a manager rather than merging one. Its size is a fact about it, not the reason it is numbered 5. |
| 6 | **`controls-manager`'s document writes** | **1 file** for the Line scalars (`controls-manager/index.ts:107-197`); the text-box height is the same file's call at `:255` and follows candidate 4. | **Clean-ish.** Moving the Line scalars out means the controls module stops writing document state. |
| 7 | **The contain rule** | **2 files**: `viewport-manager/index.ts` (the re-derivation) and `renderer-core/src/artboard.ts` (the owner, reached by neither). | **Cross-cutting and a decision first.** The editor's fit is deliberately "the display's screen, not the host" — so this may be a second rule that needs its own row and guard rather than a caller of the first. |
| 8 | **`selection-inspector`'s two unnamed decisions** | **0 code files to edit; 2 files to name** (`per-kind-column.ts`, `view.ts`) plus one map file. | **Map row, not code.** Two rows suffice; the file is already past the stop for reasons `vg-255` owns separately. |
| 9 | **`object-actions` eligibility agreement** | **6 sites in 1 file** (`object-actions.ts:108,117,126,167,174,200`). | **Clean, and small**: eligibility should ask the manager that refuses, or the refusal reasons should be enumerated once. |
| 10 | **The map's self-contradictions and missing rows** | **0 code files.** | **Documentation.** `vg-244` (one sentence), plus rows for `object-name.ts`, `colour-maths.ts`, the persisted-property set, the reference-GC decisions and `firstRunPage`. |

Row 10 of that table is the documentation candidate, and **no other candidate is
numbered 10**. `snap-manager` is not in the table at all — it is the contrast
case, stated above, and attaching a number to it would collide with a real one.

### The dead-or-over-owning question, reported separately (brief step 6)

**A manager with production references may still hold a dead method, and that is
Phase 2's scanner's job, not this census's** — no line here reports, guesses at,
or duplicates a dead-code finding, and a manager's absence from §1–§6 says
nothing about whether every method inside it is reached.

## 7. What could not be established

- **`vg-239` was not re-established.** This census did not read `#save`, so the
  duplicated picture fallback is carried on the row's word, not on a fresh read.
- **Whether the editor's contain-fit is a deliberate different rule.** The source
  says the author is framed against the display rather than the host; whether
  that makes it a second rule or a drifted copy needs a decision, not a read.
- **Whether `scaleX` can be non-1 when `adoptResizedBox` runs.** `vg-233` records
  this as untraced, and this census did not trace it either — so the authored-box
  writers remain a contradiction in source rather than a measured defect.
- **Which module should own the `locked` predicate.** The import-graph ordering
  between `object-lock-manager` and its readers is the design decision `vg-247`
  waits on, and this census did not compute a topological order to settle it.
- **Whether any lock reader is wrong today.** All eleven agree on the two current
  states; the risk is the third state, not the present.
- **Reach is a count of files holding a site**, not a transitive closure: a
  module reached only through another manager's re-export would be missed, and
  the owner-reach figures are import-specifier counts on the same basis.
- **Nothing was run.** No test, no build and no browser check was executed;
  every claim here is a read of source at `03d820d7`. The register rows that
  depend on runtime behaviour (`vg-233`'s reachability, `vg-245`'s drift) are
  reported as they stand, not as measured.
