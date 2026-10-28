# The asset finder, unified — one frame, one card, one state vocabulary

- **Date:** 2026-10-28
- **Status:** implemented. Plan: [`2026-10-28-asset-finder-unification.md`](../plans/2026-10-28-asset-finder-unification.md).
- **Supersedes in part:**
  - [`2026-10-21-asset-finder-design.md`](2026-10-21-asset-finder-design.md) §1:
    the numbered pager and the single mixed grid's layout paragraph do not
    survive; sources, the source port, credentials and licensing do.
  - [`2026-10-25-fonts-and-assets-design.md`](2026-10-25-fonts-and-assets-design.md)
    R5/R6's presentation: the search, filters and provider chips move into the
    finder's shared toolbar, and the preview becomes the frame's detail column.
    The catalogue, trio semantics and apply outcomes stand.
- **Related:** `DESIGN.md` §5 (the closed control vocabulary) and §2/§3 (type and
  layout scales), `docs/architecture/ownership.md`, the asset-finder browser
  spec, and the host's `ASSET_SOURCES` registry.

## What this is, and is not

**This is** one coherent change to the finder's surface: a centred window with
one frame (tab rail → toolbar → content → footer), one card with per-kind
previews, one selection model, one action-state vocabulary, one animated
skeleton, and one place for state and errors. Every tab browses on open, grids
append as the author scrolls, and no tab invents its own search position,
button shape or pager.

**This is not** a new source, a new host route, a new persisted shape, or a
second renderer. It adds one empty-query branch to the existing Unsplash source
and rewrites presentation and its state wiring. The source port, credentials,
licensing, asset import, presets and every host route keep their owners.

## Rulings taken 2026-10-28

Provenance: R1–R8 are the user's decisions in the session that produced this
document; the request opened with "unify the UI/UX language & behaviors".

**R1 — One UI/UX language across every tab.** The user's list named the
symptoms: every tab has its own layout, the tab strip shows no selection,
buttons lack hover/selected/in-progress/success/failure states, several tabs
have no loading indication, and search bars sit in different places. The fix is
structural, not a coat of paint.

**R2 — One shell, thin tab adapters.** The finder owns the frame, card, states,
selection and paging. A tab contributes filters, a preview renderer, an optional
detail column and its actions. The alternatives (shared chrome only; a
descriptor-driven framework) were rejected: the first leaves the drift, the
second is a framework for six known tabs.

**R3 — The Images tab browses Unsplash's Editorial feed.** The user's words:
"Maybe use Unsplash trending/featured list?" The feed is `GET /photos`; it needs
the same access key as search, so a machine without a key keeps the honest
needs-credential state instead of an empty grid.

**R4 — Paging may follow the source; its language and position may not.** The
user's words: "Infinity scrolling or paginated feed can be changed to fit the
asset sources requirements. But the design language/position need to be
consistent." Infinite scroll is the default. A source that genuinely needs
explicit paging gets its control in the footer's status slot, with the same
shape; never a second position or a second pager style.

**R5 — Connections is reachable from the finder when it is needed.** The user
asked for a button to the connection settings modal "somewhere appropriate",
then narrowed it: the button shows only when a source that requires a credential
is missing it or is not working. It is an icon button in the toolbar's right
group, using the existing `onOpenConnections` wiring; it is absent when every
keyed source is healthy.

**R6 — `DESIGN.md` gains the conformance rules.** Once the overhaul lands, the
rules that let a future tab conform are part of the same change, not a later
essay: one frame, fixed search slot, one card, state vocabulary, browse-on-open,
skeleton, paging slot, selection and tab order.

**R7 — The rest of the app receives the same audit next.** Queued behind this
change and filed as `vg-773`; the `DESIGN.md` rules are its checklist.

**R8 — Double-clicking a media card opens a preview modal.** The user's words:
"add a double click on grid item to open photo/video preview modal". It applies
to image results and Wallpaper Engine items; a palette, icon, gradient or font
card has nothing to enlarge and keeps its single-press selection. The preview
carries the same actions as the finder, and a footer **Preview** button gives the
same modal a keyboard-reachable route.

## The surface

```
┌──────────────────────────────────────────────────────────┐
│ Fonts  Icons  Images  Colours  Wallpaper Engine       ×  │  tab rail, 48px
├──────────────────────────────────────────────────────────┤
│ [ Search fonts….......... ] [All|Trios|Families]  ⊙ ⚙    │  toolbar, 48px
├──────────────────────────────────────────────┬───────────┤
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐             │  detail   │  content
│  │     │ │     │ │     │ │     │             │  column   │  (only this
│  └─────┘ └─────┘ └─────┘ └─────┘             │  (Fonts)  │  region scrolls)
│            append skeletons on scroll        │           │
├──────────────────────────────────────────────┴───────────┤
│ 12 results · 2 sources            [Secondary] [Primary]  │  footer, 52px
└──────────────────────────────────────────────────────────┘
```

The four regions never move between tabs. A tab may add controls inside the
toolbar, a column in the content region, and actions in the footer; it may not
add a region, move the search field, or draw its own grid frame.

### The window

- Centred in the viewport: `top: 50%; left: 50%; transform: translate(-50%,
  -50%)`, `width: min(1180px, calc(100vw - 48px))`,
  `height: min(800px, calc(100vh - 48px))`. This replaces the work-area
  anchoring (`top/right/bottom/left` offsets that left the window 54px off the
  rail and 8px off the opposite edge), which is the reported "not centred".
- Padding `0`; each region owns its padding. Radius `--radius-lg`, border
  `--edge`, elevation `--elev-3`, scrim `--elev-scrim`.
- Below 720px viewport width the window becomes full-viewport with no radius.
  This is a degradation, not a second layout: the regions stay in order.
- The popup clips (`overflow: hidden`); the content region is the only
  scroller.

### The tab rail

- Fixed order: Fonts, Icons, Images, Videos, Colours, Wallpaper Engine; a
  category the registry adds later appends alphabetically after these. The tab
  strip no longer follows `ASSET_SOURCES` order.
- A tab is 40px tall, `--text-sm`, `--radius-sm` top corners, 12px horizontal
  padding. Rest: `--muted`. Hover: `--text` and `--edge` raised to `--muted`
  behind it. Selected: `--panel-2` lift, `--text`, and a 2px `--accent`
  underline. Focus: §5 rule 4's accent boundary.
- Selected styling keys off Base UI's `data-active`. Today's `data-[selected]`
  is dead: Base UI 1.9 emits `data-active`, so no tab has ever looked selected.
- The close × occupies a fixed 28px slot at the right; the tab list scrolls
  under it with matching right padding, so the two never collide.

### The toolbar

- One row: search field first, always; then the tab's filters; then a flexible
  spacer; then source toggles and the Connections button on the right.
- Every control in the row is 28px tall, `--radius-md`, `--text-sm` or
  `--text-xs` as §5 specifies. No `rounded-full` pill buttons, no `<select>`
  drop-down inside the finder.
- Search: `type="search"`, `min-width: 220px`, `max-width: 360px`, placeholder
  `Search <category>…` derived from the tab label, `aria-label` the same words.
  The value is the active tab's query; a tab keeps its own query.
- Filters are the **bare Segmented** form already used by the header's mode
  switch: a `--panel-2` well holding labels, the chosen one lifted to `--stage`
  with `--text`. Used for mutually exclusive choices (font kind, font sort,
  colour kind, wallpaper kind).
- Source toggles are **multi-select chips**: `--radius-md`, well surface, label,
  a leading 8px dot or check, `aria-pressed`. On: accent border and dot. Off:
  `--faint` label. Hover raises `--edge`. A 3px `--hot` dot marks a source that
  failed or needs a credential; the sentence is in the footer.
- The Connections button is an icon button at the row's right end: 28px square,
  `--radius-md`, `CONNECTIONS_GLYPH`, `aria-label` and `title` "Connections".
  It is drawn only when the active tab has a source that declares `requires`
  and is either blocked with `needs-credential` or has failed. A healthy keyed
  source, or a tab with no keyed source, draws no button. Its slot is reserved
  so the row does not jump when it appears.

### The content region

- Padding `--space-16`. The grid fills the region and scrolls; everything else
  stays put.
- Grid: `repeat(auto-fill, minmax(168px, 1fr))`, gap `--space-12`,
  `align-content: start`.
- Fonts may draw a 300px detail column to the grid's right when something is
  selected. The grid narrows; the column never overlays and never scrolls
  independently of the page.
- Scroll position returns to the top when the question changes or the tab
  changes.

### The footer

- 52px minimum, top border `--edge`, padding `--space-12 --space-16`.
- Left: one status line, `role="status"`, `aria-live="polite"`, wrapping to at
  most two lines. Priority: action outcome → "Searching N sources…" → source
  failure or credential sentence → "N results · M sources" → "End of results".
- Right: the action area. Secondary first, primary last, always in that slot.
  Buttons reuse the dialog vocabulary (`ACTION_BUTTON` / `ActionBox`, tone
  `accent` for the primary), so no filled accent and no new button shape.
- A previewable selection also draws a 28px icon button, `PREVIEW_GLYPH`, before
  the text actions; it opens the preview modal and is the keyboard route to the
  same thing a double-click does.
- With no selection both actions are disabled; disabled is never the only
  signal, because the grid's selection state is what the author reads.

## The card and its previews

One `FinderCard`; the preview renderer is the only variation.

- Preview well: `aspect-ratio: 4 / 3`, `--bg` fill, `--radius-sm`, clipped.
- Title row: name (`--text-sm`, truncate) and the source mark at the right.
- Meta row: subtitle and licence (`--text-xs`, `--faint`/`--muted`), truncate.
- Previews:
  - **Image** — `object-cover`, `loading="lazy"`, `decoding="async"`. Full
    bleed. Today's `object-contain` letterboxes every photo inside a 96px box.
  - **Icon** — the existing mask rendered at 48×48 in `--text`, centred.
  - **Palette** — up to six equal-width vertical bars filling the well, in the
    palette's own order. Replaces the 2×2 grid.
  - **Gradient** — the stored sweep, full bleed.
  - **Font** — a trio stacks its three role faces at 20/15/12px; a family draws
    its lead face at 16px. Same frame as every other kind.
  - **Wallpaper Engine item** — thumbnail `object-cover`.
- States:
  - Rest: `--edge` border, `--panel-2` fill.
  - Hover: `--edge` raised to `--muted`; nothing moves or scales.
  - Focus: §5 rule 4's accent boundary, never clipped by the scroller.
  - Selected: `--accent` border + `ring-1` accent + accent tint + a 16px check
    badge in the preview's top-right corner. `aria-pressed` (or `aria-selected`
    inside the listbox) carries it for assistive technology.
  - Busy: the preview dims and a 14px `LoaderCircle` spins on the card whose
    action is running.
  - Failed: a 14px `TriangleAlert` in `--hot` in the preview corner; the
    sentence is in the footer.
- Every card is one focus stop in a roving listbox: arrows move by one and by a
  row, Home/End jump, Enter applies the primary action. The grid owns the
  keyboard model; the card owns the press.
- Double-clicking a previewable card (an image result or a Wallpaper Engine
  item) opens the preview modal without changing the selection. Other kinds
  have no double-click gesture, so nothing is a dead press.

## Selection and action states

- One selection per grid. Clicking a card selects it. A new question — text,
  filter or source toggle — clears it. Each tab keeps its own selection while
  the finder is open; switching tabs restores it.
- Actions are declared by the tab as data (`label`, `busyLabel`, `tone`,
  `onRun`), so the footer renders every tab's actions with the same shape.
- Action lifecycle, identical in every tab:
  1. No selection → both actions disabled.
  2. Press → both actions disabled, the pressed one shows a spinner and its
     `busyLabel` ("Applying…", "Placing…", "Adding…"), the card dims.
  3. Success → selection stays, actions return, footer shows `CHECK_GLYPH` and
     the outcome sentence.
  4. Failure → footer shows the sentence in `--hot`, the card shows the error
     mark, and the actions return so the author can retry.
- The outcome is announced once through the footer's `role="status"`.

## The preview modal

- Opened by double-clicking a previewable card, or by the footer's Preview
  button. It is a viewer, so it never changes the selection and never writes on
  open.
- It reuses `Dialog` and the `.editor-shell-dialog--asset-preview` box — the
  centred stage and metadata panel the Assets pane's viewer already draws — so
  the app has one picture-viewing shape rather than two.
- Stage: the result's `preview` at `object-contain` on `--asset-preview-stage`.
  A video-kind result draws `<video controls muted loop>` when a playable URL
  exists; no finder source exposes one today, so a video result shows its poster
  and the panel says it is a poster rather than implying playback.
- Panel: name, author or photographer, licence, source URL, and the tab's own
  actions with the same labels and the same busy/success/failure states as the
  footer. For a Wallpaper Engine item: title, kind, size, tags, workshop URL and
  the item's action.
- Escape closes the preview before the finder; closing returns focus to the card
  that was previewed.
- It is a separate component from `panes/assets/preview-modal.tsx`: that modal's
  subject is a declared local file with remove/replace and package usage, and
  forcing a remote result into its contract would give one modal two owners.

## Per-tab content

| Tab | Filters | Primary | Secondary | Detail column |
|---|---|---|---|---|
| Fonts | kind All/Trios/Families; sort Name/Provider | Apply trio (trio) / Apply to token (family) | Add to presets | Yes |
| Icons | — | Place on canvas | — | — |
| Images | — | Set as background | Place on canvas | — |
| Colours | kind All/Palettes/Gradients | Add to presets | — | — |
| Wallpaper Engine | kind All/Videos/Scenes | Set as background (video) / Open in Wallpaper Engine (scene) | — | — |

- **Fonts** browse on open, so the tab's first paint is a trio grid rather than
  the "type something" sentence. Selecting a card opens the detail column
  (sample text, role, cut, specimen). The detail column's Apply/Add controls
  become the footer's actions; its local choices stay in the column. The
  font-kind and sort filters are tab state, not query state.
- **Icons** browse on open (they already answer an empty query with the set).
- **Images** browse on open through the new featured branch.
- **Colours** browse on open; the kind filter and source chips were already
  there, now in the shared positions and shapes.
- **Wallpaper Engine** is a local listing, not a search: its toolbar search
  filters the already-fetched items, its kind filter works the same way, and
  its cards become select-then-footer-action like every other tab. Its Guide
  and Import `.mpkg` controls become two icon buttons in the toolbar's right
  group. Per-card done badges survive for the session.
- **Videos** has no source in the registry today; the tab is absent rather than
  empty. The layout supports it unchanged when a source arrives.
- Images and Wallpaper Engine are the previewable tabs; the other three have no
  picture to enlarge.

## Data flow

### Per-tab state

Each category keeps one record for as long as the finder is open:

- `query` — the tab's own search text.
- `rows` — the accumulated results, each paired with the page that answered it.
- `asked` — the last page number asked of each source.
- `totals` — what each source says it has, when it says anything.
- `failures` — the latest failed page per source.
- `loading` — `"first"` (replacing the grid), `"more"` (appending), or absent.
- `selected` — the selected row.
- Tab filters (font kind/sort, colour kind, wallpaper kind).
- Wallpaper Engine keeps its listing and its per-card done set instead of
  `rows`/`asked`/`totals`.

The accumulation and page arithmetic live in one pure module so they are
testable without a dialog: `nextPages(state)`, `appendAnswer(state, answer,
asked)`, `hasMore(state)`, `resetForQuestion(state, query)`, and the failure
merge. The existing `interleave` stays the one row-order owner.

### Browse on open

A tab is browsed the first time it is shown, with the empty term. Every source
already returns a catalogue for an empty query except Unsplash, which gains the
featured branch. Opening a second time restores the tab's rows and query; it
does not refetch. The initial category a caller requests (the font field opens
Fonts) wins, as today.

### Questions, filters, and reset

- Typing is debounced 200ms and ticket-guarded; a late answer for an abandoned
  question is dropped, never rendered.
- A new text query or filter clears rows, page counters, failures and
  selection, returns scroll to the top, and paints the skeleton immediately.
  A tab change instead shows that tab's own state; it browses only when it has
  none.
- Filters choose which sources are asked, never rewrite their persisted toggle
  choices: a colour-kind filter intersects the source set, as today.
- The last enabled source in a tab stays on; the author is told how to re-enable
  when a filter leaves every source off.

### Appending and infinite scroll

- A sentinel after the last row is observed by one `IntersectionObserver`,
  rooted at the content scroller, 400px early. It fires only when idle and a
  source still has a page.
- The request asks page `asked + 1` of every source with more, then appends the
  answer through `interleave`; earlier rows never reorder.
- While appending, four skeleton cards follow the last row. Nothing already
  shown is replaced.
- At exhaustion the sentinel is removed and the status line says "End of
  results".
- A source that fails a page stops contributing until the author retries; its
  drawn rows stay.
- If a future source needs explicit paging (a feed that cannot be addressed by
  page), its control goes in the footer status slot in the same shape; this is
  R4's allowance, not a licence for a second pager style.
- Ceiling: the grid renders every accumulated row; no virtualisation. A picker's
  working set is bounded in practice, and font specimens load only when visible
  (below). If a source can page without bound, revisit virtualisation as its own
  change.

### Late answers, failures, retries

- A failure is per source and per page; it never blanks the grid another source
  is answering.
- `needs-credential` keeps its sentence and gains the Connections button as a
  permanent affordance; the sentence's own link remains.
- The footer shows one failure sentence at a time, naming the source; "Retry"
  re-asks the failed sources' current page. When every source failed and no rows
  are drawn, the content region draws the error state with the same Retry.
- A listing failure (host unreachable) is the content region's own sentence, not
  an empty dialog.

## Loading and state vocabulary

### Skeleton

One `FinderSkeleton` mirrors the card: a 4:3 preview block, a title bar and a
meta bar, in `--panel-2` on the card frame, animated with `animate-pulse`
(`motion-reduce:animate-none`). Twelve on a first load, four when appending.
The region carries `aria-busy` and one visually hidden "Loading assets…"
sentence; nothing inside is focusable. It replaces the list bodies and both
current skeletons (`CardGridSkeleton`, `TextSkeleton`) — a text skeleton cannot
stand in for a grid.

### Status line

The footer's one line, in the priority order above. It is the only place an
outcome is announced. Source failures and credential needs are sentences, not
tooltips alone (§5 rule 3).

### Empty and error states

One state component, drawn inside the content region, never in the footer:

- **No results for a query** — "No results for “<term>”." plus **Clear search**.
- **Nothing to browse** — a sentence naming the tab and no action.
- **Every source off** — the existing sentence telling the author to turn one on.
- **Every source failed** — the failure sentences plus **Retry**.
- **Needs credential** — the sentence plus **Open Connections**.
- **Host unavailable** — the existing sentence.

## The Images tab's featured feed (host)

- `unsplash.ts` gains an empty-query branch: `GET /photos` with `page` and
  `per_page=30`. Per Unsplash's current documentation the Editorial feed no
  longer accepts `order_by`; it returns latest order. Do not send it.
- The response is a bare array of abbreviated photos. Map it through the same
  `isFree`/`resultOf` path as search, so Unsplash+ content is still dropped and
  every result still carries the Unsplash License and its page URL.
- The response carries no `total_pages`. Read the `Link` header instead:
  `rel="last"` gives the last page; `rel="next"` means at least `page + 1`;
  otherwise this page is the end. Falling back to "a full page implies more"
  only if the header is absent.
- Non-empty terms keep `search/photos`. `bytesOf` and `verifyUnsplash` are
  unchanged.
- Checked against `https://unsplash.com/documentation` on 2026-10-28.

## The Connections button

- One icon button in the toolbar's right group, drawn only when the active tab
  has a keyed source in trouble, as R5 states. It occupies a reserved 28px slot
  so the row does not reflow.
- "In trouble" is decided from the tab's own state: a source that declares
  `requires` and whose latest answer is `needs-credential`, or whose latest
  answer failed at all. A keyed source that fails on the network may be a key
  problem, and the button is the place to check; a healthy keyed source draws
  nothing.
- It calls the existing `onOpenConnections` (the finder closes, Settings opens
  on Connections). No new route, no new dialog.
- `aria-label` and `title` both say "Connections"; the tooltip is a convenience,
  never the only name (§5 rule 5).

## Architecture and ownership

### The frame and its parts

- `asset-finder/finder-frame.tsx` — the window's regions: tab rail, toolbar,
  content slot, footer. Presentational; no fetching.
- `asset-finder/finder-card.tsx` — the card and the per-kind preview renderer
  (replaces `row.tsx`).
- `asset-finder/finder-grid.tsx` — the grid, roving focus, the sentinel and the
  appended skeletons. Replaces `font-grid.tsx`'s windowed list; the specimen
  loading moves to a visibility-gated hook so only visible tiles register
  faces.
- `asset-finder/finder-state.tsx` — the empty/error/credential/list state
  bodies.
- `asset-finder/preview-modal.tsx` — the media viewer opened by a double-click or
  the footer's Preview button.
- `asset-finder/skeleton.tsx` — the one card skeleton.
- `asset-finder/tab-data.ts` — the pure accumulation and page arithmetic.
- `asset-finder/modal.tsx` — the dialog, per-tab state, the tab adapters (font,
  wallpaper, generic grid), the action lifecycle. It keeps wiring, not layout.
- `asset-finder/font-preview-panel.tsx` — unchanged in role; controlled by the
  modal's font state, rendered in the detail column, and no longer owns the
  primary action.
- `asset-finder/wallpaper-engine-card.tsx` — its content moves into
  `FinderCard`; the file keeps the item-to-card mapping and the done badge.

Finder-specific controls stay under `asset-finder/`; they are not promoted to
`components/ui/`, whose gate and ownership belong to the editor's general
vocabulary. `Dialog`, `ActionBox`, `ACTION_BUTTON` and `Glyph` are reused
unchanged.

### What is deleted

- `FinderPager` and the finder's use of `pageNumbers`; the store-mode pager is
  untouched.
- `fonts-body.tsx`'s own search field, fetch loop, pagination bookkeeping and
  chip row — replaced by the shared toolbar, tab data and grid.
- `wallpaper-engine-body.tsx`'s own search field, kind row, card grid and
  per-card action state — replaced by the shared frame; only the listing fetch
  and the guide/import modals remain.
- The finder's `data-[selected]` tab styling (dead), its pill buttons, its
  `<select>` sort, and its text skeleton.

### What is kept

`client.ts`, `actions.ts`, `credentials-client.ts`, `interleave.ts`,
`source-mark.tsx`, the host routes, the source port, `ASSET_SOURCES`, the
persisted shapes and the wallpaper-engine client all keep their owners.

## Failure modes

| Failure | Where it shows | What still works |
|---|---|---|
| Host unreachable | content region sentence | dialog opens and closes |
| One source fails | footer sentence + chip dot | other sources' rows and paging |
| A page past the end | the end line; that source stops contributing | other sources' rows and paging |
| A source needs a key | footer sentence + Connections | other sources, the Connections button |
| Every source fails | content error state + Retry | tabs, switching, Connections |
| A filter leaves no sources on | content sentence | the filter that undid it |
| A late answer arrives | dropped by ticket | the current question's grid |
| An action fails | footer sentence + card mark | actions return; retry is a press |
| The listing is empty | state sentence | Guide and Import `.mpkg` |

## Reuse, and what was searched

The finder is surface code, not a mechanism boundary on
`scripts/reuse-gate.mjs`'s watchlist; `components/ui/` is not edited. The change
still takes the ladder:

1. **Owner** — `asset-finder/` owns the surface; the store's pager is not reused
   (its window is the catalogue's), and the editor's general `components/ui`
   primitives are reused rather than copied.
2. **Dependencies** — React 19, Base UI 1.9 (Tabs, Dialog, ToggleGroup) and
   Tailwind tokens are already installed; no package is added.
3. **Platform** — CSS grid for the layout, `IntersectionObserver` for append and
   specimen visibility, `<img loading="lazy">` for images, `aspect-ratio` for
   the preview well. No library earns its place over these.
4. **Ecosystem** — no headless asset-picker or infinite-scroll package fits a
   host-routed, six-tab picker; virtualization was considered and deliberately
   left out (see the ceiling).
5. **Comparison** — the store mode's pager is the nearest in-repo surface; it
   pages a catalogue and is the wrong shape for a merged multi-source feed.
6. **Probe** — the centred rect, the appended count and the tab's computed
   selection style are browser-measurable; the plan's browser spec asserts each.
7. **Build** — the frame, card, grid, state and tab-data modules above.

## Landing order

1. **Frame and vocabulary.** Centred window; tab rail with `data-active`; the
   toolbar, footer, card, skeleton and state components; the generic grid tabs
   (Icons, Colours, Images search-only) move onto them; the Connections button.
2. **Grid behaviour.** Browse-on-open, append and exhaustion, the sentinel, the
   end line, Retry; the pager and the finder's `pageNumbers` use are deleted.
3. **Images feature.** The Unsplash Editorial-feed branch and the Images tab
   browsing on open, with routed fixtures.
4. **Fonts.** Browse-on-open trios, the shared grid and card, filters and sort in
   the toolbar, the detail column, footer actions; delete `fonts-body`'s frame
   and fetch.
5. **Wallpaper Engine.** The local listing in the shared frame, select-then-
   footer-action, Guide/Import as toolbar icon buttons.
6. **Conformance and proof.** `DESIGN.md` rules; the browser spec and red proofs;
   the plan's gate.

## Acceptance

- Every tab draws the four regions in the same positions; no tab draws its own
  search field, grid frame, pager or footer.
- Every tab shows content or a skeleton on open, with no typing.
- The selected tab is visibly distinct and its styling is driven by
  `data-active`.
- The window is centred within 2px of the viewport's centre on a desktop
  viewport, and sizes per the measurements.
- Palette cards draw vertical bars, not a grid.
- The Images tab draws photos on open when a key is configured, and the
  needs-credential state when it is not.
- The Fonts tab draws a trio grid on open.
- Scrolling to the bottom appends rows and skeletons; no finder pager exists;
  the end line appears at exhaustion.
- A search replaces the grid with the animated skeleton; an appending page adds
  skeleton cards without replacing rows.
- Every action button reaches disabled → busy → success/failure, announced in
  the footer; the card shows busy and failed marks.
- Double-clicking an image or Wallpaper Engine card opens the preview modal; the
  footer's Preview button opens the same modal; Escape closes it back to the
  grid with focus on the card; no other kind has the gesture, and the modal
  performs no write without a press.
- Every source failure is a sentence in the footer and a dot on its chip; the
  Retry path re-asks.
- The Connections button appears exactly when a keyed source is missing or
  failing, and is absent when none is; pressing it opens Settings on
  Connections.
- `npm run gate` exits 0 and the asset-finder browser spec passes on the built
  bundle.
- `DESIGN.md` carries the conformance rules; `vg-773` records the rest-of-app
  audit.

## Measurements

| Thing | Value |
|---|---|
| Finder window | `min(1180px, 100vw - 48px)` × `min(800px, 100vh - 48px)` |
| Window centring | 50% / 50% with `translate(-50%, -50%)` |
| Tab rail / toolbar / footer | 48px / 48px / 52px minimum |
| Control height in the toolbar | 28px |
| Grid | `auto-fill minmax(168px, 1fr)`, gap 12px |
| Card preview | 4:3 |
| Detail column | 300px |
| First-load skeleton | 12 cards |
| Appending skeleton | 4 cards |
| Search debounce | 200ms |
| Append root margin | 400px |
| Connections button | 28×28 |
| Preview modal | the existing `--asset-preview-width/height` box (1132×852 cap) |

## Non-goals

- No new asset source, host route, credential, persisted key or package.
- No change to import, credits, presets, the theme package or the stage.
- No redesign of the Assets pane, the store, the Settings modal or the
  wallpaper-engine import flow; those receive R7's audit later.
- No virtualisation, drag-and-drop, multi-select or cross-source ranking.
- No zoom, pan, slideshow or filmstrip in the preview modal; no video playback
  until a finder source exposes a playable URL.
- No compatibility shim for the old finder markup; the browser and DOM tests are
  updated with the surface, and the finder is pre-release internal UI.
