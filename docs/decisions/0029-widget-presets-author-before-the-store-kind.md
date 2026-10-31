# 0029 — Widget presets are authored before the store carries the kind

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/theme-package/src/index.ts`, `src/web/packages/editor/src/editor-document.ts`, `src/web/packages/editor/src/object-actions.ts`, `src/web/packages/editor/src/editor-shell/bridge.ts`, `src/web/packages/editor/src/ui-copy.ts`

## Problem

The store's second kind, `widget-preset`, has a settled shape but no producer
(#185). Its shape is a theme envelope minus the artboard: a scene subtree plus
its `bindings`, `globals` and `assets`. Shipping the kind before anything can
author one would put a catalogue entry behind a file no editor writes.

## Rung 1 — internal owner

Searched: `theme-package/src/index.ts` (`writeThemePackage`,
`readThemePackage`, `MAX_ARCHIVE_BYTES`), `editor-document.ts` (envelope
ownership, asset manager, bindings writer), `object-actions.ts` and the shell
bridge (`OBJECT_ACTIONS`, `ObjectTarget`, `run`), `scene-fabric`'s scene and
asset-reference helpers, and the store's catalogue kind reader.

Found: one authoring path produces a package, and it writes a whole
`FabricThemeEnvelope` with an artboard. The catalogue already knows
`widget-preset` as an unknown kind and refuses it by name; the host install
refuses it too. Nothing authors or reads a widget package.

## Rung 2 — installed dependencies

Searched: `@yunari/theme-package`'s archive writer and reader, `fflate`'s ZIP
API, and `@yunari/renderer-core`'s envelope validator.

Found: the archive writer enforces the byte caps, entry cap, expanded cap and
declared-asset check. The envelope validator is what decides scene validity;
a widget document can reuse it by validating the same scene fields with the
artboard omitted, rather than growing a second geometry validator.

## Rung 3 — native platform

Checked: the browser's `Blob`/`URL.createObjectURL` download path already used
by theme export.

Found: saving a package needs no new platform capability.

## Rung 4 — public solutions

Searched: the owner's options of 2026-10-31 — ship the store kind with a
placeholder sample; build a save-as-preset flow before the kind ships; or drop
the kind.

Found: the owner chose to build the authoring flow first.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Author from the editor selection, then ship the kind | one scene model, one package container | selection subtree extraction and asset pruning | chosen |
| Ship the kind with a hand-made sample package | store kind exists sooner | a sample the editor cannot produce or edit; a second source of truth | rejected |
| Drop the kind | no new work | removes a decided product surface | rejected |

## Rung 6 — smallest probe

No probe is needed for the decision: the shape is already stated by the design
and no unknown platform behaviour decides it. The implementation's probe is its
round-trip test — write a selection as a package, read it back, compare the
subtree, bindings and asset list.

## Decision

Build the authoring workflow first, then the store kind:

- The artifact is a `yunari-widget-package` v1 ZIP with `manifest.json`,
  `widget.json`, optional `thumbnail.png` and `credits.json`, and `assets/`.
  `widget.json` is the theme envelope's scene fields without an artboard.
- The editor exports the current selection: the selected objects and their
  descendants, the bindings keyed by those object ids, the globals they use, and
  only the assets they reference. Object ids are preserved so bindings stay
  coherent.
- Extraction and asset selection extend the existing envelope and asset owners;
  no second scene model and no parallel package format.
- The store's `widget-preset` kind and host install ship only after this
  authoring path exists. Until then both refuse the kind by name, as they do
  today.

Implementation is tracked in issue #271; this note records the decision, not
work already done.
