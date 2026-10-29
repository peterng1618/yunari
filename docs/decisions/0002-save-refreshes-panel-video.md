# 0002 — A theme save refreshes the panel clip

- **Date:** 2026-10-29
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/panel-manager.ts`, `src/web/packages/host/src/server.ts`

## Problem

A panel's runner resolves its theme video once, when it opens, and uploads that
clip to the device. The page behind the overlay keeps polling, so a saved theme
updates the UI immediately — but the device keeps playing the clip it was
started with. Saving a theme that a panel is showing therefore changes the
overlay and not the video. The clip must be re-read when the theme behind it is
saved, without restarting panels that do not show that theme.

## Rung 1 — internal owner

Searched `panel-manager.ts`, `panel-runner.ts`, `server.ts`,
`serve/published.ts` and `serve/display-launcher.ts` for the existing
invalidation seams. `PanelManager.refresh(displayId)` already stops and starts
a runner, and `PanelManagerOptions.videoFor(displayId)` already owns "which clip
does this display play" (the same `assignedThemeFor` fallback the player uses).
The theme save route (`PUT /api/themes/:id`) writes the store and answers; it
has no panel step. `display-launcher.reconcile` is the repo's prior art for
re-reading records on a counter-change rather than watching files.

## Rung 2 — installed dependencies

No dependency is involved. The bytes are read through `ThemeStore.readAsset`,
which the panel's `videoFor` already calls.

## Rung 3 — native platform

Node's `fs.watch` exists, but it is event- and inode-bound: an editor's atomic
save (write temp file, `rename` over the target) makes a file watch go dead or
coalesce events, and the store already writes through a staged rename. Watching
would need a directory watch, debounce and re-arm logic to cover a change the
host itself performs synchronously; the host already holds the exact moment.

## Rung 4 — public solutions

Two searches were attempted for this problem shape: "Node.js fs.watch
unreliable atomic file replace rename editor save" and "application reload
uploaded asset when source file changes instead of file watcher save endpoint".
No web search backend was reachable from this environment, so neither returned
sources. The decision does not rest on an external implementation: the trigger
is this host's own save route, and the alternative considered (a watcher over
the theme folder) is a platform facility judged on its own contract above.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Restart every running panel after any theme save | Simple | Stops unrelated panels; blinks on UI-only saves | Reject |
| Server walks displays + active-theme map, refreshes matches | Reuses `refresh` | Duplicates "which theme does this display show" and "does it have a video" outside `videoFor` | Reject |
| Manager re-reads `videoFor` and restarts only when the clip changed | Compare lives beside the resolver that produced the playing clip | One new public method; compares up to one asset per running display per save | Reuse |
| Watch the theme folder | Catches non-route writes too | Fragile on atomic saves; debounce and ownership outside the host's own write | Reject |

## Rung 6 — smallest probe

Unit probes: `panel-manager.test.ts` asserts `refreshVideo` leaves an unchanged
clip alone and restarts on changed bytes or placement; `server.test.ts` asserts
`PUT /api/themes/:id` asks every running panel to compare after a successful
save. Both run without hardware.

## Decision

Add `PanelManager.refreshVideo(displayId)`: it re-resolves `videoFor`, compares
it with the clip the running entry was started with, and calls the existing
`refresh` only when they differ. The save route asks each running panel to
compare after the store accepts the write. The comparison is the manager's
because that is where the playing clip already lives; the route keeps no second
copy of the assignment rule.
