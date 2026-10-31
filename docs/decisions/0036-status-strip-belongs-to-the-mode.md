# 0036 — The status strip's content belongs to the mode

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/editor-shell/shell-layout.tsx`, `src/web/packages/editor/src/store-mode/region.tsx`, `src/web/packages/editor/src/ui-copy.ts`

## Problem

`#status` is a sibling of the mode section and always renders the editor's
readouts: the open document's object and selection counts, the host mark, the
diagnostic message, the save state and the publish indicator. The Themes mode
therefore shows counts of a document it is not listing (#164). The This PC
branch already renders the host's own two strings and nothing else (#165),
which the user ruled is correct: each mode shows its own state.

## Rung 1 — internal owner

Searched: `editor-shell/shell-layout.tsx` (the footer, `hostStatus`,
`StoreModeRegion`, `HostSettingsRegion`), `store-mode/region.tsx`
(`StoreModeRegion`, `StoreRegion`, `Body`, `sorted`, `listed`), and
`editor-shell/status-readout.tsx`.

Found: the Host mode already publishes through a seam — its region calls
`onStatus` and the shell places the strings (`R154`). The store region contains
no status seam at all, so the footer has nothing to place for it. The store
region already owns the number that is its own reading: the visible listing
after the chosen half, facets and query (`sorted.length`), with `Body`'s `none`
meaning "not arrived or failed" — the same absence rule the editor's readouts
state.

## Rung 2 — installed dependencies

Not applicable: React state and an effect, no library behaviour.

## Rung 3 — native platform

Not applicable.

## Rung 4 — public solutions

Searched: the repository's existing pattern — `HostSettingsRegion`'s `onStatus`
and the footer's `this-pc` branch; `paneCounts`/`statusBar` in `ui-copy.ts`.

Found: region publishes, shell places. The only missing half is the store's
publication and a copy string with the same singular/plural shape as the rest of
`statusBar`.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Store region publishes its visible count; footer renders per mode | matches the host seam and the ruled per-mode readout | one effect, one copy string, one footer branch | chosen |
| Hide the footer outside the editor | smallest diff | the Host mode's line, already required by the drawing, disappears | rejected |
| Keep the editor readouts everywhere | no new seam | the store contradicts its own listing with a document's counts | rejected |
| Show save state and publish indicator in the Host mode too | answers #165 literally | the ruled readout is per mode, and the host page's drawing has its own bar | rejected |

## Rung 6 — smallest probe

The shell-layout DOM suite already drives the footer's host branch
(`data-yunari-host-status`, `data-yunari-host-display-count`). The store case is
the same reading: mount the Themes mode and assert the footer holds the store's
count and none of the editor's readouts. The region suite asserts the published
number follows the filter, and that "not arrived" publishes nothing rather than
zero.

## Decision

`StoreModeRegion` accepts an optional `onStatus(count: number | undefined)` and
publishes the visible listing count, clearing on unmount. The footer renders
three branches: editor readouts, the store count, the host's own strings. Copy
is `uiCopy.statusBar.themes`. The Host mode keeps its two strings; #165 is the
ruled behaviour rather than a loss.
