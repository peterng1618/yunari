# 0070 — Host is the machine's one name

- **Date:** 2026-11-01
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/ui-copy.ts`, `src/web/packages/editor/src/editor-shell/shell-layout.tsx`, `src/web/packages/editor/src/editor-shell/shell-entry.ts`, `src/web/packages/editor/src/theme-library-client.ts`, `src/web/packages/editor/src/host-settings-mode/region.tsx`, `src/web/packages/host/public/settings.html`, `src/web/packages/host/src/server.ts`, `src/web/packages/host/src/tray/actions.ts`

## Problem

The shell's third mode is `Host`, while the machine, the settings page heading and
the local display row say `This PC`. Two names for one surface fail quietly: a
tray link, a deep link and a row label can each address a different name and no
type or test notices. The persisted display id must keep addressing the same
stored assignments, so only the name changes.

## Rung 1 — internal owner

Searched: `codegraph explore "ShellMode MODE_NAMES parseShellEntry LOCAL_DISPLAY_LABEL local display label"` (the worktree has no index, so source search followed), then `rg "This PC|this-pc|thisPc"`.

Found: `ui-copy.ts` owns `modes` and `hostSettings` words; `shell-layout.tsx` owns
`ShellMode`, `MODE_NAMES` and `MODE_ORDER`; `shell-entry.ts` owns the accepted
query value; `host/src/settings/displays.ts` owns `LOCAL_DISPLAY_ID` and
`host/src/server.ts` owns `LOCAL_DISPLAY_LABEL`, which the active-theme route
serves. No module beyond these owns a second label or mode vocabulary.

## Rung 2 — installed dependencies

Searched: React `ToggleGroup`, Base UI tabs and the existing `uiCopy` table.

Found: the control binds each segment's value and id from the mode string, so a
mode rename propagates to both without a compatibility layer. No dependency
supplies product naming.

## Rung 3 — native platform

Searched: URLSearchParams in `shell-entry.ts`; host tray link construction.

Found: `?mode=` is parsed once at mount and nothing persists it, so the accepted
value can change cleanly. The persisted display id is separate and remains
`this-pc`, because per-display assignment files and the host route key on it.

## Rung 4 — public solutions

Searched: the product ruling in issue #44 and the existing SDD ruling R100 in
`ui-copy.ts`; Windows' own "This PC" vocabulary.

Found: Windows names the machine "This PC", but the product already named the
mode "Host" and the binding ruling makes the machine and the mode one name. No
upstream API is involved. Keeping an alias would preserve the two-name state the
issue reports, so a clean break is the fitting answer for pre-release internals.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Rename mode value and copy to `host` | One name; test ids follow the value | Update tests, deep links and tray URL | chosen |
| Keep `this-pc` as an accepted alias | No migration work | Keeps two names; issue remains | rejected |
| Rename display id to `host` | One name everywhere | Breaks persisted assignment keys and the host route | rejected |

## Rung 6 — smallest probe

What executable probe settled, or why behavior was already established: the
rename is a compile-time union change. Typecheck and the editor shell suites fail
on any missed call site, and the host suite reads the served label, so no
disposable probe is needed.

## Decision

Use `host` as the mode value, query value, copy key and local-display label. Keep
`LOCAL_DISPLAY_ID = "this-pc"` and every persisted display key unchanged. Update
tests, the tray deep link and the settings page to the one name; do not keep a
`this-pc` alias.
