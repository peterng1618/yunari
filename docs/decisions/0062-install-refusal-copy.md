# 0062 — a refused install answers with the step, never the filesystem's path

- **Date:** 2026-11-01
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/themes/store.ts`
- **Paths:** `src/web/packages/host/src/themes/import.ts`
- **Paths:** `src/web/packages/host/src/themes/install.ts`
- **Paths:** `src/web/packages/editor/src/store-mode/install-item.ts`
- **Paths:** `src/web/packages/editor/src/ui-copy.ts`

## Problem

Every `stage: "package"` install refusal is answered with the refusing owner's
own `message`. `importThemePackage` and `replaceCatalogueCopy` forwarded
`error.message` from `ThemeStore.write`, which includes whatever the platform
raised — `EPERM: operation not permitted, mkdir 'C:\Users\…\.yunari\themes\x'`
— so a person could be shown an absolute path inside their profile (issue
#194, `vg-693`).

## Rung 1 — internal owner

`ThemeStore` (`themes/store.ts`) owns the typed refusals
(`ThemeConflictError`, `ThemeIdTakenError`, `ThemeAssetLimitError`,
`ThemeValidationError`, `ThemeTooLargeError`) and raises plain `Error`s for
its own document checks. The two forwarding sites are
`writeUnderFreeId` (`themes/import.ts`) and `replaceCatalogueCopy`
(`themes/install.ts`); `themes/install.ts` already owns a copy table for the
refusals it composes itself (`INSTALL_REFUSALS`). No other module composes a
message from a store failure.

## Rung 2 — installed dependencies

Node's `fs` rejects with a `NodeJS.ErrnoException`: the platform text in
`message` and a string `code` (`EPERM`, `EACCES`, `ENOSPC`, …). That `code` is
the one signal that separates a platform failure from the store's own sentence,
so no dependency and no message parsing is needed.

## Rung 3 — native platform

Nothing here to adopt: the classification is a property of the error Node
already hands over.

## Rung 4 — public solutions

Not applicable in the usual sense — the question is product copy for one
screen, not a mechanism a library owns. The repository's own convention is the
table: `INSTALL_REFUSALS` in `themes/install.ts` composes the host's sentences
for the origin-write failures for exactly this reason ("the host cannot read
the editor's `ui-copy.ts`"). The new mapping follows that table rather than
adding a second copy owner.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Classify on `error.code` in one exported helper; typed/plain store sentences verbatim, `fs` errors logged and answered with the step | Keeps the store's own diagnosis, drops the path, logs the raw text | One helper and its two call sites | Chosen |
| Answer every store failure with generic copy | Simple | Throws away `ThemeConflictError`'s "reload it" and the asset-limit sentence | Rejected |
| Match the message text for a path or `EPERM` | No new API | Guessing at platform strings; a translated OS message or a different code slips through | Rejected |
| Strip paths from the message | Keeps other text | Leaves the platform's grammar and may still leak a partial path | Rejected |

## Rung 6 — smallest probe

`store.test.ts` feeds a coded `EPERM` error carrying an absolute path and
asserts the answer names the library and holds no `C:\`, while
`install.test.ts` drives the same failure through `installCatalogueItem`. Both
fail when the `code` check is disabled (`cmp`-identical restoration) and pass
with it.

## Decision

`storeRefusalMessage(error)` in `themes/store.ts` answers a filesystem failure
with "This PC could not save the theme to its library. Try again, or restart
Yunari.", logging the raw error, and answers every other error with its own
message. `writeUnderFreeId` and `replaceCatalogueCopy` use it, so a store
refusal keeps its diagnosis and a platform failure keeps its path off the
screen.
