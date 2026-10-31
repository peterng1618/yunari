# 0030 — An editor theme is a named token set, authored from Appearance

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/editor-shell/settings.tsx`, `src/web/packages/editor/src/editor-shell/palette.ts`, `src/web/packages/editor/src/editor-shell/editor-shell.css`, `DESIGN.md`, `src/web/packages/theme-package/src/index.ts`

## Problem

The store's third kind, editor theme, has no artifact (#186). `§35` separates
editor-shell theming from an authored dashboard theme's `globals`, so an editor
theme is not that `globals` under another name. Nothing in the repo is a
portable editor-theme artifact today, and the question is what one is.

## Rung 1 — internal owner

Searched: `editor-shell/palette.ts` (`shellPalettes`,
`DEFAULT_SHELL_PALETTE`), `editor-shell/settings.tsx` (the Appearance tab),
`editor-shell/editor-shell.css` (the `@theme static` token block),
`editor-shell.tokens.test.ts`, `DESIGN.md`, and the host's installed-theme
library.

Found: six shell palettes plus follow-system are selected by
`data-shell-palette`; the values are CSS custom properties, and the token
vocabulary is already normative in `DESIGN.md` and synchronised with the CSS
block by `npm run design:check`. There is no artifact: the choice is a local
setting, not a document, and the host has no editor-theme install path.

## Rung 2 — installed dependencies

Searched: `@yunari/theme-package`'s manifest and archive handling, and the
editor's ZIP reader.

Found: the container (ZIP + `manifest.json` + `theme.json` + optional
`thumbnail.png`/`credits.json`) and its byte caps are format-agnostic. Its
reader validates a `FabricThemeEnvelope`, so a token document needs its own
validator, not a second container.

## Rung 3 — native platform

Checked: CSS custom properties and `data-*` attribute switching, which is how
the palettes already apply.

Found: applying a token set is a style write; nothing platform-level decides
the artifact shape.

## Rung 4 — public solutions

Searched: the owner's options of 2026-10-31 — author from the settings
Appearance tab and publish like other kinds; make it a theme-envelope variant;
make it a third format.

Found: the owner chose authoring from Appearance and publishing like other
kinds. The three candidate shapes were put to the owner in the issue; the
chosen authoring surface implies a token document, not a Fabric scene.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| A named, versioned token set in the existing package container | reuses manifest, credits, thumbnail, size caps and store plumbing | a token validator and an apply/export path | chosen |
| A theme-envelope variant with scene fields empty | reuses the envelope validator | a scene document with nothing in it; consumers must special-case an empty scene | rejected |
| A third container format | freedom to shape it | a second archive reader, size policy and notice path | rejected |

## Rung 6 — smallest probe

Not applicable: no runtime behaviour decides the shape. `DESIGN.md` and
`editor-shell.css` already fix the token vocabulary; the implementation's first
test is that an unknown token or an out-of-vocabulary value is refused.

## Decision

An editor theme is a **named, versioned set of editor-shell token values**:

- It travels in the existing `yunari-theme-package` container, with manifest
  kind `editor-theme`; `theme.json` carries the schema version and the token
  map, and there is no artboard or Fabric scene.
- The token names and value constraints are the vocabulary `DESIGN.md` and
  `editor-shell.css` already own. An unknown token, an invalid value or a
  missing required token is refused at the package boundary.
- It is authored from the Appearance tab: the current shell palette plus
  overrides become a package, and an imported package applies by writing the
  same custom properties the palettes write.
- The store's `editor-theme` kind and the host's install path ship only after
  this authoring and apply path exists; until then both refuse the kind by name.

Implementation is tracked in issue #272; this note records the decision, not
work already done.
