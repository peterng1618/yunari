# 0031 — Delete the unread crop and connection-pruning surfaces

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/scene-fabric/src/artboard-crop.ts`, `src/web/packages/scene-fabric/src/index.ts`, `src/web/packages/scene-fabric/src/artboard-crop.test.ts`, `src/web/packages/host/src/server.ts`, `src/web/packages/host/src/cli/net.ts`, `src/web/packages/host/src/server.test.ts`

## Problem

Two surfaces outlived their only reader:

- `scene-fabric` still exports `outsideEdges`, `outsideBoxes`, `countable`,
  `EDGE_TOLERANCE`, `right` and `bottom` from `artboard-crop.ts`, although the
  player's crop notice was removed and the editor's artboard panel reads only
  `outsideCount` (#129).
- The host's combined port still implements `closeIdleConnections` and the
  per-connection `answering` bookkeeping behind it, although the move calls
  `closeAllConnections` and nothing in production calls the idle-only method
  (#138). Only tests invoked it.

## Rung 1 — internal owner

Searched: every `artboard-crop` import across the workspace, and every
`closeIdleConnections` / `closeAllConnections` reference in the host.

Found: `outsideCount` and `sceneBoxesOf` have production callers
(`editor-session.ts`, `artboard-fields.tsx`). The other four exports have tests
only. `closeAllConnections` has a production caller in `cli/hosting.ts`'s
`move`; `closeIdleConnections` has tests only. The `answering` set, the
`request` listeners that fill it and the four-tuple `nameOf` map exist solely to
let the idle-only method distinguish an in-flight response.

## Rung 2 — installed dependencies

Searched: Node's `net.Server` and `http.Server` close methods.

Found: `closeAllConnections()` is the documented way to destroy every
connection. `closeIdleConnections()` is a separate, finer capability; Node does
not call it from `close()`, so keeping it was keeping an API rather than a
behaviour.

## Rung 3 — native platform

Not applicable: no platform API is being chosen. The deletion removes a
duplicate way to reach a capability the platform already provides.

## Rung 4 — public solutions

Not applicable: the question is whether this codebase keeps an unread wrapper,
not how to solve the underlying problem. The public APIs (`outsideCount`,
`closeAllConnections`) are already the solution.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Delete the unread exports and the idle-only method | removes the duplication and the stale justification | none; Git keeps the history | chosen |
| Keep them for a planned surface | speculative | a public surface with no consumer, and a test that proves only itself | rejected |
| Deprecate but keep | same surface, plus noise | none of the deletion benefit | rejected |

## Rung 6 — smallest probe

For the host, the move's own tests (`server.test.ts`) pass without the idle-only
method: 413 tests. For the crop module, `artboard-crop.test.ts` passes after
the cases that only exercised the removed exports are deleted: 7 tests.

## Decision

Delete `outsideEdges`, `outsideBoxes`, `countable`, `EDGE_TOLERANCE`, `right`
and `bottom` from the `scene-fabric` barrel and from `artboard-crop.ts`
(`countable`, `right` and `bottom` stay private because the count still uses
them). Delete `closeIdleConnections`, the `answering` set, the `request`
listeners and the `nameOf` four-tuple from the host's port listener; the port
keeps only the set of accepted sockets that `closeAllConnections` destroys.

Both deletions remove a surface no product reads. Reintroducing either is a
normal change with its own decision, not a compatibility concern.
