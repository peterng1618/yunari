# Settings hub — design

- **Date:** 2026-11-02
- **Status:** approved by the user in conversation; implementation authorised
- **Area:** editor shell, Host mode, editor settings modal, host `/settings` fallback

## Problem

The Host mode is one 640px column inside a full-window region. Host settings,
display settings, hardware, weather, custom sources and the theme's device
questions are stacked in one scroll; the selected-display scope is implicit and
lost as soon as the page scrolls. The editor's own preferences sit in a separate
560px modal with a 150px tab column. Two settings products, both narrow, neither
using the desktop window.

Issue #81 ruled that Settings should stop being a modal. That ruling is
superseded here: a narrow pane cannot use horizontal space, and the user has
asked for one settings surface that includes both host and editor settings.

## Goals

1. One **Settings** surface, reached from the header's mode switch and from the
   rail's gear, containing every host and editor preference.
2. Use the window horizontally: page-specific master-detail and multi-column
   layouts instead of one long list.
3. Keep every current behaviour: no fabricated telemetry, immediate writes,
   refusal messages in words, pairing/security rules, and the same routes.
4. Remove the modal as a second settings surface.
5. Leave the host's plain-HTML `/settings` page working; bring it to the same
   information architecture in a follow-up change.

## Non-goals

- New host routes, credentials, persistence formats or provider behaviour.
- Reworking the store mode or the editor canvas.
- Changing the host's `/settings` page in this change (follow-up).
- A native app, mobile layout redesign or a new control vocabulary.

## Information architecture

The third shell mode is renamed from `host` to `settings`. The mode switch reads
`Editor · Themes · Settings`. The rail's gear selects Settings; the finder's
needs-key path selects Settings on **Asset sources**.

A grouped vertical navigation column sits beside a wide content region:

| Group | Page | Contents |
|---|---|---|
| This PC | **Displays** | display list and selection; selected display's name, shape and rotation; panel controls; the theme's unanswered device questions; add a local display; attached USB panels; start at sign-in |
| This PC | **Hardware** | GPU / system disk / data disk slots; per-device names |
| This PC | **Units & time** | clock time zone; temperature system; the seven unit families |
| This PC | **Readings** | weather backend, place and poll; custom HTTP sources and their editor |
| Editor | **Appearance** | shell palettes and follow-the-system; preview ratios |
| Editor | **Keyboard** | the editable shortcut reference |
| Editor | **Asset sources** | provider keys (today's Connections) |
| Editor | **About** | product, schema and release versions |

Previews merges into Appearance: it is a small list and a separate destination
costs more than it earns. Connections is renamed **Asset sources** so it does
not collide with the host's **Readings** sources; the page keeps the existing
`Asset sources` heading and copy.

The display selection is local to **Displays**: it scopes the display settings,
panel controls and theme questions on that page. No other page depends on it.

## Layout

```
┌ Settings ─────────────────────────────────────────────────────────────┐
│ This PC                 │  page title + hint                          │
│   Displays           ●  │  ┌──────────┬────────────────┬────────────┐ │
│   Hardware              │  │ displays │ selected       │ attach /   │ │
│   Units & time          │  │ (list)   │ display detail │ create     │ │
│   Readings              │  └──────────┴────────────────┴────────────┘ │
│ Editor                  │                                             │
│   Appearance            │  page content, its own columns              │
│   Keyboard              │                                             │
│   Asset sources         │                                             │
│   About                 │                                             │
└────────────────────────────────────────────────────────────────────────┘
```

- Navigation column: 176px, its own scroll, grouped headings. The content
  column scrolls independently.
- Page measure: `--settings-page-measure: 1200px`, centred in the content
  column. A page may use less when its subject is small (About).
- Page rhythm: page header (`h2` + hint), then sections separated by
  `--space-24`. Section eyebrows keep the existing `--text-2xs`, 600, `.11em`
  treatment.

### Displays

Master-detail with three regions at `≥1280px`: list `300px`, detail
`minmax(0, 1.2fr)`, attach/create `minmax(300px, 0.9fr)`. At `900–1279px` the
list and detail share two columns and attach/create spans below. Below `900px`
everything stacks. The attach/create column holds **Add a local display**, the
attached **USB panels** and **Start at sign-in**; the detail column holds
**Display settings**, **Panel controls** (when the selected display is a panel)
and the theme's **questions**.

Display rows gain a status line: kind (Host / screen / panel / paired), the
theme it shows and whether it follows the Host, and the panel connection state
where the map has one. The row stays one radio in one labelled group; Remove
stays beside the row and keeps its confirmation.

### Other pages

| Page | Columns |
|---|---|
| Hardware | two: slot selects · device names |
| Units & time | two: clock and temperature · unit-family grid (two columns inside) |
| Readings | two: custom sources (flexible) · weather (`380px`); stacks below `1100px` |
| Appearance | two: palettes (three-column card grid) · preview ratios |
| Keyboard | auto-fill groups, `minmax(320px, 1fr)` |
| Asset sources | auto-fill key cards, `minmax(460px, 1fr)` |
| About | one facts card, the existing 74px read-only row |

## Behaviour

- **Immediate writes.** No save button. A write still reports through the
  shell's status bar; a refusal is still stated in words where it happened.
- **Status bar.** In Settings mode it shows the display count only while
  **Displays** is the active page, and the last write's answer at all times. A
  count no read answered is absent, never `0`.
- **Mode guard.** Editor ↔ Settings moves freely: the editor body stays mounted
  behind `hidden`, so no document can be lost. The unsaved-document prompt fires
  only when moving to **Themes** from Editor or Settings. This keeps the gear
  usable mid-edit like the modal did.
- **Hidden editor is inert.** While a non-editor mode is showing, the editor
  body carries `data-yunari-editor-inactive`. The shortcut manager treats that
  attribute like an open modal, so product chords cannot edit the hidden
  document. This also fixes the pre-existing exposure in Themes.
- **Focus.** Entering Settings moves focus to the active navigation item.
  Leaving through the mode switch leaves focus on the switch, as the primitive
  does. The modal's focus-return-to-gear rule is retired with the modal.
- **Page state.** The shell holds the active page so the gear and the finder can
  request one. The gear opens the last page the author used (Displays on a fresh
  session). The finder requests Asset sources.
- **Deep link.** `?mode=settings` opens Settings. `?mode=host` is retired; this
  is a pre-release interface and the old spelling is not kept as an alias.
- **Data.** The region keeps its current reads and writes. Pages stay mounted
  but hidden after first use, so a draft (a half-typed source, an armed binding)
  survives a page switch; hidden pages are removed from the accessibility tree
  and the tab order.

## Ownership and components

- `settings-mode/` replaces `host-settings-mode/`. The host sections move into
  page components; the modal's four content components move in from
  `editor-shell/settings.tsx`.
- `settings-mode/region.tsx` owns the nav, the page selection and the host data
  controller. The host read/write state moves to `settings-mode/host-state.ts`
  so the region stays small.
- `settings-mode/pages/*.tsx` own one page each. Reused section components keep
  their current owners (`displays-section.tsx`, `display-presentation-section.tsx`,
  `panel-controls-section.tsx`, `panels-section.tsx`, `weather-section.tsx`,
  `sources-section.tsx`, `device-name-row.tsx`).
- `settings-mode/nav.ts` is the one owner of the page list, its groups, order
  and glyphs. The nav and the panels both read it.
- `settings-mode/appearance-page.tsx`, `about-page.tsx` and
  `asset-sources-page.tsx` absorb `Settings`' tab bodies; `versionFacts` moves
  with About.
- `editor-shell/settings.tsx` is deleted. `SettingsTab` is replaced by
  `SettingsPage`.
- `editor-shell/shell-layout.tsx` gains the `settings` mode, the page state, the
  free Editor ↔ Settings transition and the revised guard. It remains the owner
  of shell mode and chrome.
- `ui-copy.ts` gains the page labels, group labels and the Settings mode name;
  the existing host and settings strings stay the owners of their sentences.
- No new runtime dependency.

## Visual rules and tokens

`DESIGN.md` gains a **Settings mode** subsection beside the asset finder rules:
one frame, a grouped vertical navigation column, a page measure, the
master-detail and two-column rhythms, and the rule that a page never adds a
second navigation bar.

`editor-shell.css` gains:

- `--settings-nav-width: 176px`
- `--settings-page-measure: 1200px`
- the nav column, group heading, page grid and the Displays grid rules

It loses the modal tab rules (`--settings-tabs-width`, `.editor-shell-settings*`)
and `--host-settings-measure`. The dead-selector sweep and the design token sync
must stay green.

## Accessibility

- Navigation is a labelled list of pages; the active page carries
  `aria-current="page"` and `aria-selected` through the primitive.
- Each page is a labelled panel; only the active one is exposed.
- Every page title is a heading; every section eyebrow follows it, never skips a
  level.
- Controls keep their labels, ids and refusal text. The Keyboard capture keeps
  Escape as its disarm key and Tab as a way out.
- Hit targets stay ≥24px; focus boundaries keep the accent contract.

## Testing

- Unit/DOM:
  - navigation renders the eight pages in two groups and moves between them;
  - the gear selects Settings; the finder selects Asset sources;
  - every existing host-region behaviour still passes through its page;
  - palette, preview-ratio, keyboard, connection and About assertions move with
    their pages;
  - Editor ↔ Settings does not prompt on a dirty document; Themes does;
  - a non-editor mode blocks product shortcuts against the hidden document.
- E2E: the mode switch reads Settings, `?mode=settings` opens it, the rail gear
  reaches it, and the host-play spec's Settings selectors still resolve.
- `npm run gate` from `src/web/` must exit 0.

## Follow-up

The host's `/settings` page (plain HTML, no build step) keeps working in this
change. A follow-up should give it the same grouped navigation and wide page
layout in `host/public/settings.html` and `yunari-page.css`, without importing
the editor bundle. That work needs its own HOST-IA review because the page is
also served to phones.
