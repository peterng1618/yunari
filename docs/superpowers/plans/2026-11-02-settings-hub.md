# Settings Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the user selected inline implementation and is asleep; do not wait for a plan review). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the Host mode's one-column settings page and the editor's Settings modal with one wide Settings mode built from grouped navigation and page-specific multi-column layouts.

**Architecture:** Rename `ShellMode`'s `host` to `settings`; hold the active settings page in the shell; render one `SettingsRegion` with a grouped vertical nav and one page component per destination. Reuse the host region's clients/sections and the modal's four bodies. The editor body stays mounted behind `hidden`; mark it inactive so product shortcuts cannot edit it.

**Tech Stack:** React 19, `@base-ui/react/tabs` (vertical, `keepMounted`), Tailwind utilities, the editor's control set, Vitest/jsdom, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-02-settings-hub-design.md`

## Global Constraints

- No new runtime dependency.
- Immediate writes; no save button. A count no read answered is absent, never `0`.
- `renderer-core` stays Fabric/DOM-free; the player imports no editor code.
- Secrets never leave the host; the credential value is never rendered.
- All visible copy lives in `ui-copy.ts`; no new inline sentences.
- Run commands from `src/web/`. `npm run gate` must exit 0 and needs no network.
- Do not add a second horizontal navigation bar under the header.
- Keep every file under 800 lines (new files; existing over-stop files are grandfathered).

## Review Focus

1. A dirty document: Editor ↔ Settings must not prompt; Settings → Themes must.
2. The hidden editor: a product chord (Ctrl+Z, Delete) dispatched in Settings must not edit the document.
3. A page switch after a draft: half-typed source fields, armed shortcuts and preview-ratio input survive.
4. Refused reads/writes: the reason still appears; a failed host read never renders an empty list as fact.
5. Keyboard users: entering Settings focuses the active nav item; the nav and hidden pages have correct `aria-current`/`hidden`.

---

### Task 1: Rename the mode and wire entry points

**Files:**
- Modify: `src/web/packages/editor/src/editor-shell/shell-layout.tsx` (type, names, order, status branch, region call, guard)
- Modify: `src/web/packages/editor/src/editor-shell/shell-entry.ts`
- Modify: `src/web/packages/editor/src/editor-shell/rail.tsx` (gear prop type only if needed)
- Modify: `src/web/packages/editor/src/shortcut-manager/index.ts` (inactive editor guard)
- Modify: `src/web/packages/editor/src/editor-shell/shell-entry.test.ts`
- Modify: `src/web/packages/editor/src/shortcut-manager/index.dom.test.ts`

**Interfaces:**
- Produces: `type ShellMode = "editor" | "themes" | "settings"`.
- Produces: `type SettingsPage` in `settings-mode/nav.ts` (Task 2).
- Consumes: `SettingsRegion` replacing `HostSettingsRegion` (Task 2).

- [ ] Update `ShellMode`, `MODE_NAMES`, `MODE_ORDER`, the status branch and `parseShellEntry` to `settings`; update the deep-link test to `?mode=settings`.
- [ ] Add `data-yunari-editor-inactive` to the editor body when `mode !== "editor"`.
- [ ] Extend `isModalOpen()` in `shortcut-manager/index.ts` to also match `[data-yunari-editor-inactive]`; add a DOM test proving a product binding does not fire while the attribute is present and fires after removal.
- [ ] Change `requestMode`: Editor ↔ Settings is free; only `next === "themes"` with a dirty session prompts.
- [ ] Run `npx vitest run packages/editor/src/editor-shell/shell-entry.test.ts packages/editor/src/shortcut-manager/index.dom.test.ts`; expect PASS.
- [ ] Commit.

### Task 2: Move the host region under `settings-mode/` with grouped nav and host pages

**Files:**
- Move: `src/web/packages/editor/src/host-settings-mode/**` → `src/web/packages/editor/src/settings-mode/**`
- Create: `settings-mode/nav.ts`, `settings-mode/page.tsx`, `settings-mode/host-state.ts`
- Create: `settings-mode/pages/displays-page.tsx`, `hardware-page.tsx`, `units-page.tsx`, `readings-page.tsx`
- Modify: `settings-mode/region.tsx`
- Test: `settings-mode/region.dom.test.tsx`

**Interfaces:**
- `SettingsPage = "displays" | "hardware" | "units" | "readings" | "appearance" | "keyboard" | "asset-sources" | "about"`.
- `SETTINGS_PAGES: readonly { id: SettingsPage; group: "this-pc" | "editor"; label: string; glyph: LucideIcon }[]`.
- `SettingsRegion(props: { mode; page; onPageChange; onStatus; host clients; editor settings props })`.
- `useHostSettings(props)` returns the reads, writes and derived values the host pages consume.

- [ ] Move the directory with `git mv`; update imports in `shell-layout.tsx` and `store-mode/region.tsx`.
- [ ] Add `nav.ts` and `page.tsx`; render a vertical `Tabs.Root` with grouped headings, `Tabs.Panel keepMounted` per page.
- [ ] Split the host region's state into `host-state.ts`; keep every read, write, mounted flag, poll, and derived value.
- [ ] Compose the four host pages from the existing sections and `Group`s; apply the spec's grid classes.
- [ ] Keep the region publishing `{ displays, status }`; publish the display count only on Displays.
- [ ] Adapt `region.dom.test.tsx`: mode `settings`; keep existing assertions (pages are `keepMounted`, so selectors still resolve); add a nav-order test and a page-switch-draft test.
- [ ] Run `npx vitest run packages/editor/src/settings-mode`; expect PASS.
- [ ] Commit.

### Task 3: Move the editor settings bodies into pages and delete the modal

**Files:**
- Create: `settings-mode/pages/appearance-page.tsx`, `keyboard-page.tsx`, `asset-sources-page.tsx`, `about-page.tsx`
- Modify: `settings-mode/region.tsx` to pass storage/palette/following/overrides/releaseVersion
- Delete: `editor-shell/settings.tsx`, `editor-shell/settings.dom.test.tsx`
- Move tests: `settings.dom.test.tsx` assertions → `settings-mode/editor-pages.dom.test.tsx`
- Modify: `src/web/packages/editor/src/ui-copy-surfaces.test.ts`

**Interfaces:**
- `AppearancePage({ storage, palette, following, onPalette, onFollowing })`.
- `KeyboardPage({ storage, overrides, onOverrides })` (owns `armed` locally).
- `AssetSourcesPage()`; `AboutPage({ releaseVersion })`; `versionFacts`.

- [ ] Move `AppearanceTab` + `PreviewsTab` into one two-column page; keep the palette radio group, follow toggle, preview rows, refusals and session-only notes.
- [ ] Move `SettingsKeyboard` usage into `KeyboardPage`; keep the capture and refusal rules; hold `armed` in the page.
- [ ] Move `ConnectionsTab` to `AssetSourcesPage`; keep the credential contract and the shared Well/button classes.
- [ ] Move `AboutTab` + `versionFacts` to `AboutPage`.
- [ ] Delete the modal and its `SettingsTab` API; update shell imports.
- [ ] Move the modal test cases onto the pages; delete only modal-specific cases (Escape/focus/close); add equivalents where a shell-level guarantee still exists.
- [ ] Update `ui-copy-surfaces.test.ts` to navigate pages instead of opening tabs.
- [ ] Run `npx vitest run packages/editor/src/settings-mode packages/editor/src/ui-copy-surfaces.test.ts`; expect PASS.
- [ ] Commit.

### Task 4: Shell wiring, status, gear and finder

**Files:**
- Modify: `editor-shell/shell-layout.tsx` (page state, gear, finder, region props, status attrs)
- Modify: `editor-shell/rail.tsx` (if the callback signature changes)
- Test: `editor-shell/shell-layout.dom.test.tsx`, `editor-shell/settings.dom.test.tsx` (replace with mode cases)

**Interfaces:**
- `const [settingsPage, setSettingsPage] = useState<SettingsPage>("displays")`.
- Gear: `onModeChange("settings")` (keeps the last page).
- Finder: `setSettingsPage("asset-sources")` then `onModeChange("settings")`.

- [ ] Add the page state and pass it to `SettingsRegion`; render the region for `mode === "settings"`.
- [ ] Wire the gear and finder; sketch the status line to show the display count only on Displays.
- [ ] Replace modal shell tests with: gear selects Settings; finder selects Asset sources; dirty Editor → Settings does not prompt; dirty Settings → Themes prompts.
- [ ] Run `npx vitest run packages/editor/src/editor-shell`; expect PASS.
- [ ] Commit.

### Task 5: Layout, tokens and DESIGN.md

**Files:**
- Modify: `editor-shell/editor-shell.css`
- Modify: `DESIGN.md`
- Modify: `settings-mode/pages/*.tsx` (layout classes)

- [ ] Add `--settings-nav-width: 176px`, `--settings-page-measure: 1200px`, the nav, page and Displays grid rules; remove `--settings-tabs-width`, `.editor-shell-settings*` and `--host-settings-measure`.
- [ ] Add the DESIGN.md **Settings mode** rules (one frame, grouped nav, page measure, master-detail, no second nav bar).
- [ ] Run `npm run design:check`; fix every finding.
- [ ] Commit.

### Task 6: E2E, docs and gate

**Files:**
- Modify: `src/web/tests/e2e/editor-deep-links.spec.ts`, `editor-rail.spec.ts`, `host-player.spec.ts` and any spec naming Host mode.
- Modify: `docs/architecture.md`, `docs/product.md`, `docs/development.md` where they name the Host mode/settings modal.
- Test: the full suite.

- [ ] Update the e2e selectors and mode words to Settings; update `?mode=settings`.
- [ ] Run `npm run build`, then the affected Playwright specs.
- [ ] Run `npm run gate`; expect exit 0.
- [ ] Commit.
