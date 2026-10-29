# 0003 — A save publishes the theme; live edits do not

- **Date:** 2026-10-29
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/server.ts`, `src/web/packages/editor/src/editor-shell/shell-layout.tsx`, `src/web/packages/editor/src/editor-main.ts`, `src/web/packages/editor/src/editor-shell/publish-control.tsx`, `src/web/packages/player/src/publish-follower.ts`

## Problem

A display follows the editor's working document while the LAN is on: the
editor PUTs every debounced edit to `/api/publish`, and every page showing that
theme reloads. The owner wants the display to change when a theme is **saved**,
for both the scene and the background video, not while it is being edited. A
panel's clip upload already needs the save as its trigger (decision 0002); the
page's scene has to agree with it.

## Rung 1 — internal owner

Searched `serve/published.ts`, `server.ts` (`/api/publish`, `/api/published`,
`/` resolution, `/api/themes/:id/document`), `editor/publish-client.ts`,
`editor-main.ts`, `editor-shell/publish-control.tsx`, `player/publish-follower.ts`
and the existing publish tests. `PublishedStore` already owns the revision
every display polls and the theme id a page compares itself with. The save
route already owns the one moment a theme becomes authoritative. The live
document was a second producer of the same fact, driven by the editor.

## Rung 2 — installed dependencies

No dependency. The publish and revision state is in-process, and the store
write already happens in the route.

## Rung 3 — native platform

Node's in-memory state and the existing HTTP routes cover the trigger. No
watcher, timer or platform API is involved.

## Rung 4 — public solutions

Two searches were attempted — "application reload uploaded asset when source
file changes instead of file watcher save endpoint" and "Node.js fs.watch
unreliable atomic file replace rename editor save". No web search backend was
reachable from this environment, so neither returned sources. The alternative
that mattered (a watcher over the theme folder) is judged on its platform
contract in rung 3 of decision 0002: the host performs the write itself, so it
already holds the moment.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep the editor's debounced live PUT | What exists | Reaches displays before a save; a panel's background cannot follow it | Reject: the owner's rule |
| Editor PUTs only on save | Small editor diff | Saves made outside the editor never reach a display; the publish route becomes the save route by another name | Reject |
| Host publishes the saved envelope in the save route | Save is the one owner; any save reaches a display | Editor live-document UI and route have no caller | **Reuse** |
| File watcher on the theme folder | Reaches foreign writes | Atomic-save fragility, debounce, a second trigger for the same write | Reject |

## Rung 6 — probe

Unit probes: a successful `PUT /api/themes/:id` moves the revision a display
polls and re-reads the saved document; an edit with no save moves nothing; a
removed theme clears the last published id; a page whose theme is that id
reloads. No hardware is involved.

## Decision

The save route publishes the envelope it just stored into `PublishedStore`, and
after a removal clears the store when the removed theme was the last published
one. `PublishedStore` remains the single owner of "what a display follows" and
the revision displays poll; it no longer carries a document that is not stored.

The editor's live publisher is deleted: its per-edit PUT, the `PublishSwitch`
wiring and the surface's live/unsaved readout all describe a document that is
not saved, which is exactly what no longer goes out. The publish surface keeps
the LAN opt-in and pairing. The root page no longer overlays a published id on
the assigned theme — the published id is the saved theme, so a page's source is
its assignment (`map`) or its link, and an assignment can still move a display.
`/api/publish` has no caller and is removed with its tests.
