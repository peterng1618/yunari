# 0025 — Text is frozen into path objects from Fabric's own layout

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/text-outlines.ts`, `src/web/packages/editor/src/object-actions.ts`, `src/web/packages/editor/src/editor-shell/bridge.ts`, `src/web/packages/editor/src/editor-shell/session-facade.ts`, `src/web/packages/editor/src/editor-document.ts`, `src/web/packages/editor/src/editor-session.ts`, `src/web/packages/editor/src/ui-copy.ts`, `src/web/packages/editor/src/error-manager/index.ts`, `src/web/packages/scene-fabric/src/index.ts`, `src/web/packages/editor/package.json`, `THIRD-PARTY-NOTICES.md`

## Problem

No action freezes a text object into vector paths (#208). A theme's export
therefore keeps a dependency on the font files at display time, and nothing the
author sees on the canvas can become geometry.

## Rung 1 — internal owner

Searched with CodeGraph (no index in this worktree, so source search) across
`object-actions.ts`, `editor-shell/bridge.ts`, `editor-document.ts`,
`scene-fabric/fabric-text.ts`, `asset-manager/`, `font-face-registration.ts`
and `subset-unicode-range.ts`.

Found: `OBJECT_ACTIONS` is the one action registry; the shell bridge projects
the selection into `ObjectTarget`; `EditorDocument` owns the envelope and the
`AssetManager` (font declarations and bytes); `scene-fabric` owns text
identification (`isTextObject`) and the text repaint pass. No existing
text-to-geometry path. `dropDanglingBindings` already drops keys whose object
left the scene, but the replacement has to remove the binding itself because it
keeps the object's id.

## Rung 2 — installed dependencies

Read fontkit 2.0.4's typings and runtime: `create(bytes)` returns `Font |
FontCollection`; `hasGlyphForCodePoint`, `glyphForCodePoint(code).path`,
`Path.transform(m0..m5)` and `Path.toSVG()` are all present. Read Fabric 7.4.0's
`src/shapes/Text/Text.ts`: `_textLines`, `__charBounds`, `_getLeftOffset`,
`_getTopOffset`, `_getLineLeftOffset`, `getHeightOfLine`, the private
`getHeightOfLineImpl`, `_fontSizeFraction` and `calcTransformMatrix` are exactly
the values its renderer uses to place each grapheme.

Found: fontkit supplies outlines only. Fabric already decided the layout; using
it is what keeps the paths where the author sees the text.

## Rung 3 — native platform

Checked the Canvas 2D and SVG APIs: `CanvasRenderingContext2D` can draw text but
exposes no way to read the resulting glyph geometry, and an SVG `<text>`
element keeps its own font dependency. Neither converts text to paths.

## Rung 4 — public solutions

Searched: “convert text to vector paths from laid-out canvas text using fontkit
glyph outlines, Fabric.js”, plus the Fontkit API reference and Fabric
discussion `fabricjs/fabric.js#10823`.

Found:

- Fontkit's own documented recipe scales each glyph path by `1, -1` and
  translates it by the run position (`font.layout` positions), then calls
  `toSVG()`. Fontkit is also what PDFKit uses for glyph extraction.
- The common Fabric recipe (Stack Overflow, “OpenType JS and FabricJS text
  convert to path”; Fabric discussion #10823, “Converting text to outlines with
  opentype, and still having it line up with the original rendered IText”)
  re-derives a baseline from font ascender/descender ratios. Both reports say
  the result is always slightly shifted from the original text, because Fabric's
  line box and baseline are not the font's ascender/descender box.
- Fabric exposes its actual per-grapheme boxes and line offsets, which is the
  same input its own renderer uses.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| opentype.js (the published Fabric recipe) | second font parser, and the cited drift | re-derive baselines; add a dependency for a format fontkit already reads | rejected |
| fontkit glyph paths placed by Fabric's laid-out boxes | exact layout source, one parser already installed for `@types/fontkit`-typed use | read Fabric's private-but-computed text state | chosen |
| rasterise the text and trace contours | no font file at display | loses vector fidelity and cannot preserve per-run colour | rejected |
| SVG `<text>` | native | still requires the font at display; not geometry | rejected |
| fontkit `font.layout()` for the whole run | shaping and ligatures | would become a second owner of line breaks, alignment, tracking and wrapping, which Fabric already performed | rejected; only the glyph outline is taken |

The chosen seam is a new `text-outlines.ts`: it reads the object's `_textLines`,
`__charBounds` and line metrics, looks up the declared face per style (subset
first in declaration order), asks fontkit for the glyph path, bakes the object's
`calcTransformMatrix()` into each path, and returns a `Group` (same id and name)
or a reason. The document replaces the text object in place, removes its
binding and records one history entry.

## Rung 6 — smallest probe

Run with Node: `fontkit.create()` on the repository's existing
`.e2e-font-cache/inter-400.woff2` reported `unitsPerEm 2048`,
`hasGlyphForCodePoint(65) === true`, produced an SVG path for “A” and
transformed it with `Path.transform(2, 0, 0, 2, 10, 20)` without error.

## Rung 7 — decision

Reuse fontkit for glyph outlines and reuse Fabric's laid-out text state for
placement; do not introduce opentype.js and do not re-derive baselines. Gradients
and pattern fills are refused (they have no single path colour), as are text in
an undeclared face, unparseable font bytes and characters the face does not
carry. `fontkit` is added to `THIRD-PARTY-NOTICES.md` as a runtime dependency of
the editor.
