# 0081 — one Settings surface: host and editor preferences as a mode

- **Date:** 2026-11-02
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/editor-shell/shell-layout.tsx`, `src/web/packages/editor/src/editor-shell/editor-shell.css`, `src/web/packages/editor/src/settings-mode/region.tsx`, `src/web/packages/editor/src/settings-mode/nav.ts`, `src/web/packages/editor/src/settings-mode/pages/`, `src/web/packages/editor/src/shortcut-manager/index.ts`

## Problem

Host settings live in a full-window mode that uses a 640px column; editor
settings live in a separate 560px modal with its own tab column. Two settings
surfaces, two navigations, and a wide window mostly unused. Issue #81 already
ruled the modal shape wrong, but a narrow pane cannot recover the horizontal
space the user asked for. The risky part is not layout: it is moving settings
across the shell's mode boundary without losing the unsaved-document guard or
letting window-level shortcuts edit a hidden canvas.

## Rung 1 — internal owner

Searched: `host-settings-mode/region.tsx`, `editor-shell/settings.tsx`,
`editor-shell/shell-layout.tsx`, `shortcut-manager/index.ts`, `rail.tsx`,
`shell-entry.ts`, `region.dom.test.ts`, `settings.dom.test.tsx`.

Found: the mode seam and dirty guard are already owned by `ShellRoot`; the host
region owns host reads/writes and publishes a status line; the settings modal
owns palette, preview, keyboard, connection and About bodies. The modal guard
for product shortcuts samples `[role='dialog']`; a mode region is not a dialog,
so the guard would not fire. No existing page navigation owner exists for the
Settings surface.

## Rung 2 — installed dependencies

Searched: `@base-ui/react/tabs` types and source (`keepMounted`, vertical
orientation), the existing `Dialog` wrapper, the control set.

Found: `Tabs.Panel` supports `keepMounted` and marks inactive panels `hidden`,
which preserves drafts without exposing them to the accessibility tree.
`Tabs.Root` supplies arrow-key navigation and `aria-selected`. The control set
already owns every field, button and choice row used by both surfaces.

## Rung 3 — native platform

Searched: HTML `hidden`, CSS grid and media queries, `aria-current`.

Found: `hidden` removes a subtree from layout and the accessibility tree; CSS
grid with `minmax()` and media queries provides the master-detail and
multi-column layouts without JavaScript measurement.

## Rung 4 — public solutions

Searched: the asset finder's frame (this repository), DESIGN.md's component
rules, and standard settings-navigation patterns (grouped vertical nav +
content).

Found: the finder already demonstrates one frame, a navigation rail, a content
region and a detail column; its tab rail is horizontal because its categories
are peers. Settings has two groups and eight destinations, and the shell already
forbids a second horizontal bar under the header, so a grouped vertical rail is
the fitting reuse.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep modal + reshape Host column | small diff | two surfaces remain; no wide editor prefs | rejected |
| Settings pane per #81 | follows the old ruling | pane cannot use horizontal space; a second nav strip | rejected |
| Settings mode + grouped nav + pages | one surface, reuses mode seam, panels and control set | move four tab bodies; extend dirty guard; block hidden-editor shortcuts | **chosen** |
| New settings framework/dependency | none | adds a second navigation and rendering owner | rejected |

## Rung 6 — smallest probe

The existing settings tests already mount the real components against a fake
credentials client; the host region tests mount with fake clients. The probe is
the adapted DOM suite: a page that is hidden keeps its draft, and a shortcut
dispatched while the editor body is inactive reaches no product handler. Both
are asserted in the implementation's tests.

## Decision

Build one Settings mode. Reuse the shell's mode seam, the host region's client
and section owners, and the control set; move the modal's four bodies into page
components. Extend the dirty guard so Editor ↔ Settings is free and only leaving
to Themes prompts. Mark the hidden editor body so the existing shortcut manager
treats it like a modal. Keep the host `/settings` fallback for a follow-up.

Rejected options either preserve the modal (failing the user's request) or add a
second navigation/rendering mechanism for a surface the shell already owns.
