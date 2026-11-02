# 0084 — Paste across themes carries objects and their declared bytes

- **Date:** 2026-11-02
- **Status:** accepted
- **Paths:**
  `src/web/packages/editor/src/clipboard-manager/index.ts`
  `src/web/packages/editor/src/clipboard-manager/asset-port.ts`
  `src/web/packages/editor/src/editor-session.ts`
  `src/web/packages/editor/src/editor-shell/bridge.ts`

## Problem

Copy and Cut are reachable but Paste is not, and the clipboard's only copy is a
Fabric object held by one `ClipboardManager`. Opening another theme destroys the
shell and the manager, so nothing survives the switch. A copied object that
carries `yunariAsset` is worse than absent: its persisted `src` is the dead
`blob:` URL of the source session, and a destination theme that receives the
reference without the bytes saves a reference to files it does not hold.

## Rung 1 — internal owner

Searched: `ClipboardManager`, `OBJECT_ACTIONS`, `EditorActionFacade`,
`createEditorShellBridge`, `EditorSession`, `AssetManager`, `object-asset.ts`.

Found: `clipboard-manager/index.ts` already owns copy, cut, duplicate, id
re-keying, binding carry and a `paste()` that reads the browser's paste event.
`object-actions.ts` is the one command registry the dock, context menu and layer
footer render. `editor-shell/bridge.ts` is the one dispatch surface, and
`EditorActionFacade` is its session seam. `AssetManager` owns declarations,
bytes, preview URLs, validation and `hydrate`; `objectAssetReference` is the
only reader of a persisted asset reference. Nothing above `ClipboardManager`
survives a theme switch: `editor-main.ts` builds a new shell and session per
document and destroys the previous clipboard.

## Rung 2 — installed dependencies

Searched: `node_modules/fabric` (`enlivenObjects`, `toObject`, `clone`),
`scene-fabric/src/persist.ts`, `card-library.ts`, `asset-manager`.

Found: Fabric's `util.enlivenObjects` revives serialized objects asynchronously
and `card-library.ts` already uses it. Fabric's `toObject` with
`SCENE_PERSISTED_PROPERTIES` is the same serialization the document saves, so a
clipboard payload can use the persisted shape rather than a second scene model.
`AssetManager.import` validates bytes and allocates a fresh id and path;
`previewUrl` supplies the URL Fabric enlivens an image from; `remove` can roll
back declarations. `resolveAssetSources` in `persist.ts` already proves that
rewriting `src` from a resolved asset before revival is the accepted path.

## Rung 3 — native platform

Searched: MDN Clipboard API and Window.localStorage.

Found: the async Clipboard API needs a secure context, transient activation and
the `clipboard-read` permission for `read()`, and custom MIME types must be
`ClipboardItem.supports()`-gated. `localStorage` is synchronous, origin-scoped,
shared by same-origin tabs and persists across sessions; it throws
`SecurityError` when the browser refuses the store. The editor is Windows-first
and served over local HTTP on a LAN address, where the Clipboard API is not a
secure context, so localStorage is the mechanism that works on every surface the
editor already supports. The in-memory held object stays the same-document
baseline.

## Rung 4 — public solutions

Searched: tldraw clipboard documentation (tldraw.dev/sdk-features/clipboard).

Found: tldraw serializes a versioned clipboard payload containing the selected
shapes, their bindings, the root ids and the assets; it inlines asset data so
content is portable between editors, then remaps shape and binding ids on paste
while reusing existing asset ids. That is the same problem shape: versioned
payload, selection-scoped serialization, bytes carried with the objects, fresh
ids at the destination. Its compression step is an optimization this editor does
not need for the first slice.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| In-memory Fabric clone only | Same document only; disappears when the shell is replaced | None | Keep as the same-document baseline |
| Async Clipboard API custom MIME | Cross-tab and cross-app | Secure-context and permission requirements fail on LAN HTTP; jsdom has no ClipboardItem | Reject for this slice |
| localStorage payload with embedded asset bytes | Same origin, same browser, across theme switches, tabs and reloads | ~5 MB practical quota; a payload over quota must be refused, not half-written | Use |
| IndexedDB payload | Larger quota | Async store lifecycle, versioning and migration for one blob | Reject while localStorage fits the slice |
| New clipboard dependency | Not needed | Dependency and notices | Reject |

## Rung 6 — smallest probe

The existing `clipboard-manager` DOM suite already proves Fabric clone, id
re-keying and binding carry. `card-library.ts` proves `enlivenObjects` revives
the persisted shape. The new cross-theme test is the executable probe for the
join: serialize a placed object with a `yunariAsset` reference, paste it through
a second manager and a second `AssetManager`, and assert that the destination
declares the bytes under a new id and that the pasted object points at it.

## Decision

Reuse `ClipboardManager` as the single owner: keep the held Fabric clone for
same-document paste, and write a versioned JSON payload to
`localStorage["yunari.editor.clipboard"]` (memory fallback when the store throws)
on copy. On paste with no held clone, parse and validate the payload, declare
every referenced image or SVG through `AssetManager` under fresh ids, rewrite
`yunariAsset` and `src` before `enlivenObjects`, then run the existing id and
binding carry. A payload that fails validation is refused before any declaration
or canvas write. Paste enters the one object-action registry and the one session
facade; the shortcut table binds Ctrl/Cmd+V but registers no dispatcher handler,
so the browser's own paste event still handles images from other applications.
