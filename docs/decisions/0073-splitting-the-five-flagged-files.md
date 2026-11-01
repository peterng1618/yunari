# 0073 — Splitting the five flagged files

- **Date:** 2026-11-01
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/asset-finder/modal.tsx`, `src/web/packages/editor/src/asset-finder/finder-model.ts`, `src/web/packages/editor/src/asset-finder/finder-feedback.tsx`, `src/web/packages/editor/src/asset-finder/finder-toolbar.tsx`, `src/web/packages/editor/src/asset-finder/finder-asset-actions.ts`, `src/web/packages/editor/src/asset-finder/finder-preview.tsx`, `src/web/packages/editor/src/asset-finder/finder-footer.tsx`, `src/web/packages/editor/src/asset-finder/finder-body.tsx`, `src/web/packages/editor/src/asset-finder/use-font-favorites.ts`, `src/web/packages/editor/src/asset-finder/use-tab-searches.ts`, `src/web/packages/editor/src/asset-finder/use-wallpaper-tab.ts`, `src/web/packages/editor/src/asset-finder/use-font-tab.ts`, `src/web/packages/editor/src/selection-inspector/options.ts`, `src/web/packages/editor/src/selection-inspector/selection-state.ts`, `src/web/packages/editor/src/selection-inspector/background-edits.ts`, `src/web/packages/editor/src/selection-inspector/dispatch.ts`, `src/web/packages/editor/src/selection-inspector/edit-ports.ts`, `src/web/packages/editor/src/selection-inspector/projection.ts`, `scripts/oversize-files.ceiling.json`

## Problem
`packages/editor/src/asset-finder/modal.tsx` is 1480 lines, past the 800-line
stop enforced by `scripts/oversize-files.mjs`. The file mixes the dialog shell,
per-tab search state, the status/empty feedback surfaces, the toolbar and source
chips, the footer action bar, the local Wallpaper Engine body and the preview
projection. A wrong split would duplicate state ownership, drift the rendered
DOM or leave two modules owning the same derived value.

## Rung 1 — internal owner
Searched: `codegraph_explore "AssetFinder FinderFrame FinderGrid FinderStatus"`,
plus `grep` for importers of `./modal.js`.
Found: `modal.tsx` already owns every piece. `FinderFrame`, `FinderGrid`,
`FinderState`, `FinderChip`, `FinderActionButton`, `FinderSkeleton`,
`wallpaper.tsx`, `fonts.tsx`, `preview-modal.tsx` and `tab-data.ts` supply the
components and pure state helpers the split composes. External consumers import
only `AssetFinder` from `shell-layout.tsx`; `finder-controls.tsx` imports the
`ActionOutcome` type. No other module owns these views, so the pieces move out
without a parallel mechanism.

## Rung 2 — installed dependencies
Searched: the React dependency's hooks (`useState`, `useEffect`, `useRef`) and
the repo's existing hook modules.
Found: React supplies state and effects only. Nothing donates a split of this
particular component; the split is a file-organisation change, not a new
mechanism.

## Rung 3 — native platform
Searched: browser runtime support for the component's existing behaviour
(fetch, `localStorage`, `setTimeout`, `Map`, `Set`).
Found: no platform API changes the decomposition. `localStorage` access stays
behind the existing `storedDisabled` guard; the debounce timer stays the
existing `setTimeout`.

## Rung 4 — public solutions
Searched: existing `asset-finder/` sibling modules for the repo's component and
pure-module conventions; React documentation on extracting components and
custom hooks.
Found: the codebase's established pattern is plain named exports, one component
or one pure helper family per sibling file, and prop-passing rather than
context. Custom hooks are used where effect lifecycle is the responsibility.

## Rung 5 — integration comparison
| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep one file | Violates the 800-line stop; issue #260 | None | Rejected |
| Context or store for finder state | Adds a second state owner and hidden dependencies | Lifecycle and test isolation | Rejected |
| Sibling modules with explicit props and two narrow hooks | Matches existing conventions; tests import only `AssetFinder`/`SEARCH_DEBOUNCE_MS` | None | Chosen |

## Rung 6 — smallest probe
The split is proven by the existing `modal.dom.test.tsx`, which mounts the
unchanged public export and asserts DOM, accessible names and behaviour. The
`oversize-files.mjs` run and `vitest` run are the executable checks.

## Decision
Extract the model, feedback surfaces, toolbar/chips, action builders, footer,
body and preview projection into sibling modules, and move the host-backed font
favourites into a hook. `modal.tsx` keeps the `AssetFinder` export and composes
the pieces with the same props, DOM, class names, data attributes and
accessible names. No new dependency, interface or barrel is introduced.

## The host server (issue #42)

- **Paths:** `src/web/packages/host/src/server.ts`, `src/web/packages/host/src/server/options.ts`, `src/web/packages/host/src/server/limits.ts`, `src/web/packages/host/src/server/http.ts`, `src/web/packages/host/src/server/identity.ts`, `src/web/packages/host/src/server/panels.ts`, `src/web/packages/host/src/server/displays-routes.ts`, `src/web/packages/host/src/server/pairing-routes.ts`, `src/web/packages/host/src/server/settings-routes.ts`, `src/web/packages/host/src/server/secrets-routes.ts`, `src/web/packages/host/src/server/themes-routes.ts`, `src/web/packages/host/src/server/theme-writes.ts`, `src/web/packages/host/src/server/media-routes.ts`, `src/web/packages/host/src/server/wallpaper-routes.ts`, `src/web/packages/host/src/server/pages-routes.ts`, `src/web/packages/host/src/server/streaming.ts`, `scripts/oversize-files.ceiling.json`

**Rung 1 — internal owner.** `server.ts` already owns the router, the shared
responders and the route families; the existing `assets/routes.ts`,
`catalogue/routes.ts`, `catalogue/submit.ts` and `serve/static-path.ts` are the
precedent for a family module. `server.test.ts` imports only the public
construction and helper surface, so the route bodies can move without changing
assertions.

**Rung 2 — installed dependencies.** Node's `http`, `https` and `net` already
supply the server and the TLS/plain listener; no dependency donates a route
registry or context. No package is added.

**Rung 3 — native platform.** `node:http` routing is the native mechanism the
file already uses; extraction is file organisation, not a runtime change.

**Rung 4 — public solutions.** The repository's established pattern is one
plain module per route family (`catalogue/routes.ts`, `assets/routes.ts`) and
factory functions with explicit parameters rather than a framework. Express or
similar would add a dependency and a second router for no behaviour change.

**Rung 5 — integration comparison.** Keeping one file violates the 800-line
stop. A framework or a generic DI container adds a mechanism with no consumer.
The chosen shape is one factory per route family, composed by `server.ts` in
the original dispatch order; shared request helpers live in `server/http.ts`
and identity helpers in `server/identity.ts`.

**Rung 6 — smallest probe.** The unchanged `server.test.ts` is the probe: it
mounts the real server and asserts routes, statuses, headers, bodies, guards,
order and error text.

**Rung 7 — decision.** Split the route families into sibling modules under
`server/`, keep `createHostServer` as the composition and route table, and keep
every public export re-exported from `server.ts`. No new runtime dependency,
interface implementation or barrel.
