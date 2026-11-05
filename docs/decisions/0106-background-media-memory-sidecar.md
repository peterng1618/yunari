# 0106 — Background media memory rides the theme save as a sidecar

- **Date:** 2026-11-05
- **Status:** accepted
- **Paths:**
  `src/web/packages/editor/src/background-media-memory.ts`
  `src/web/packages/editor/src/editor-document.ts`
  `src/web/packages/editor/src/editor-session.ts`
  `src/web/packages/editor/src/editor-session-options.ts`
  `src/web/packages/editor/src/editor-session-video.ts`
  `src/web/packages/editor/src/editor-session-actions.ts`
  `src/web/packages/editor/src/editor-main.ts`
  `src/web/packages/editor/src/selection-inspector/background-column.ts`
  `src/web/packages/editor/src/selection-inspector/background-edits.ts`
  `src/web/packages/editor/src/selection-inspector/options.ts`
  `src/web/packages/editor/src/theme-library-client.ts`
  `src/web/packages/editor/src/theme-library-manager/index.ts`
  `src/web/packages/host/src/themes/store.ts`
  `src/web/packages/host/src/themes/wire.ts`

## Problem

A theme has one stored `background.media`. Switching the shown asset through the
Assets pane, video import or the finder writes `{ assetId, bounds }`, dropping
pan, zoom, flips, composition and the fallback frame; the inspector's media
field instead carries the previous asset's fields. The same document therefore
behaves differently by surface, and one geometry cannot remember two pictures.
The working data must survive reopen, stay out of the authored document and the
exported package, and disappear with a pruned asset. A wrong integration writes
a second scene model or a sidecar that outlives its asset.

## Rung 1 — internal owner

Searched: CodeGraph queries `EditorDocument setBackground`, `background.media
asset switch`, `ThemeStore write credits staging`, `ThemeLibraryClient save
open`, `background media memory`, plus source and tests.

Found: `EditorDocument.setBackground` is the only envelope write for the
background. Three session paths (`editor-session.ts:518`,
`editor-session-video.ts:172`, `editor-session-actions.ts:229`) build fresh
media; the inspector path (`background-column.ts:401`) carries the old fields.
`ThemeLibraryManager.#commit` sends the document and declared bytes through
`ThemeLibraryClient.save`. `ThemeStore.write` stages a whole folder
(`theme.json`, assets, `credits.json`, thumbnail) and swaps it in with renames.
`ThemeStore.read` already has the prior art for an optional folder member:
`readStoredCredits` answers absence for a missing, corrupt or oversized
`credits.json` rather than failing the theme. `DraftStore` holds only the
unsaved document. `pruneAssets` is the one path that removes declarations and
credits. Unsolved: no per-asset background data exists anywhere.

## Rung 2 — installed dependencies

Searched: `src/web/package.json`, the host/editor package manifests, and the
existing JSON and theme-store helpers. No third-party state, sidecar or
persistence library is installed for this problem.

Found: Node's `fs/promises` and the repo's own `createJsonFile` already provide
queued atomic JSON replacement (temp file plus rename). `readContainedFile`
bounds a folder member by size. `@yunari/theme-package`'s credits reader is the
existing "optional member, absence on corruption" pattern. No dependency is
added; a package would only wrap the same rename and JSON calls.

## Rung 3 — native platform

Searched: Node `fs.writeFile`, `fs.rename`, `fs.cp`, `path` containment; the
store's staging-folder swap; browser `fetch` and `JSON`; Windows rename
contention behavior.

Found: a same-directory temp write followed by `rename` replaces a file
atomically on the local filesystem; the repo's `renameWithRetry` already handles
Windows `EPERM`/`EACCES` contention. The theme store's staging folder extends
that guarantee to the whole theme: the sidecar written into staging becomes
visible with `theme.json`, and a save that fails leaves the previous folder
untouched. A live sidecar route would instead write into a folder that can be
deleted between the existence check and the write, recreating an empty theme
folder. Native APIs leave the media semantics, filtering and defaults unsolved;
those stay in the editor.

## Rung 4 — public solutions

Searched: web search for `photo editor sidecar file stores per-image edits next
to original darktable XMP`, `application stores editor working state sidecar
JSON next to project file per asset`, and `atomic JSON file write temp file
rename Node.js fs.rename replace existing Windows`.

Found:

- darktable stores per-image editing steps in XMP sidecars beside the original
  and treats the library database as the fast authority; a sidecar can be
  backed up or moved with its image
  (<https://docs.darktable.org/usermanual/development/en/overview/sidecar-files/sidecar/>).
  It solves per-asset edit memory, but makes it portable, which this feature
  explicitly does not want.
- Ed keeps editor session state in a separate `world.state.json` that other
  applications ignore
  (<https://edtech.lu/World-Data-Model>). That is the same separation of
  authored data from working state, at project rather than per-asset scope.
- Tiled's project proposal separates session/workspace state from the project
  file (<https://github.com/bjorn/tiled/issues/1665>).
- Paddock describes durable server JSON sidecars with lazy load, empty on
  missing/corrupt data, and serialized write-through
  (<https://paddock.edspencer.net/architecture/overview/>). That is the read
  policy this sidecar follows without adopting its separate state directory.
- The atomic-write sources agree on sibling temp plus rename, and note that
  Windows cannot replace a file another handle keeps open
  (<https://warlock.js.org/v/latest/fs/guides/write-atomically/>,
  <https://github.com/receptron/mulmoterminal/blob/main/server/files/atomic-write.ts>).
  The store's existing retry covers that case.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Sidecar beside `theme.json`, written in the theme staging folder | Follows the store's existing optional-member and whole-folder-swap pattern; no new route; atomic with the document; delete and prune follow the folder/asset | Read/normalize/filter in the editor; save payload carries the map; no live persistence before save | **Chosen** |
| Per-asset map inside the theme envelope | Travels with export/import and needs no host change | Schema, validator, plan, bake and every consumer learn editor bookkeeping; package carries working data; asset ids of unused files enter the document | Rejected: violates "working data, not document data" |
| Editor `localStorage` keyed by theme and asset | No host or document change | Lost on storage clear or another browser profile; cleanup is best-effort; not a sidecar | Rejected: does not survive the requested storage boundary |
| Host settings map keyed by theme id | Keeps the theme folder clean | Not atomic with the theme; a deleted theme leaves entries; a renamed save leaves them under the old id | Rejected: a second lifecycle to clean |
| New live route writing the sidecar on every switch | Immediate persistence | A write can recreate a deleted theme folder or race the save's folder swap; second write path | Rejected: save is the only point the theme folder changes |

## Rung 6 — smallest probe

Ran a disposable Node probe in a temp directory: write
`background-media.json` with `scale: 2`, write a sibling temp with `scale: 3`,
`fs.rename(temp, target)`, read back. Result:
`{"version":1,"media":{"a":{"scale":3}}}` — the rename replaced the existing
file with no partial read. The repo's `settings/json-file.test.ts` and
`themes/store.test.ts` already cover the same replacement and folder-swap
behavior; no production probe was needed.

## Decision

Extend the document's single background write seam with per-asset working data,
and persist that map as `background-media.json` written into the theme store's
staging folder during a save. The editor owns capture, defaults, filtering,
mode-aware composition and validation; the host treats the file as a bounded,
opaque JSON member and reads absence for corrupt content. The map is not in the
envelope, the export package, or a live route. Rejected options either put
working data into the authored document, fail to survive reopen, or add a
second lifecycle/route that can outlive the theme folder.
