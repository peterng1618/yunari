# Background media memory — one switch path and a sidecar

**Status:** approved and implemented (2026-11-05)

## Problem

A theme stores one `background.media` object. Switching which declared asset is
shown currently reaches the document through four surfaces:

- the Assets pane's **Set as background** (`editor-session.ts`)
- video import (`editor-session-video.ts`)
- the asset finder's image auto-placement (`editor-session-actions.ts`)
- the inspector's `background.media` field (`background-column.ts`)

The first three build `{ assetId, bounds }` and discard `offsetX`, `offsetY`,
`scale`, `flipX`, `flipY`, `composition` and `fallbackFrame`. Only the inspector
carries the previous asset's geometry, so observed behaviour depends on which
surface the author used. Switching A → B → A also applies B's edits to A: one
singleton geometry cannot remember two pictures.

## Decision

### One switch path

`EditorDocument.setBackgroundAsset(assetId | undefined)` is the only way the
editor changes which background asset is shown.

- It captures the outgoing media into per-asset working data, restores the
  incoming asset's entry, and writes once through `setBackground`.
- An unseen asset starts at defaults: `bounds: "theme"`, zero offsets, scale 1,
  no flips, no composition, no frame.
- All four surfaces call it. `writeBackgroundField` loses its
  `background.media` case; the inspector funnel routes that one field id to the
  same method.
- `setBackground` keeps its whole-value contract and captures the outgoing
  media on every write, so geometry edits update working data without a second
  write path.

An entry stores every `BackgroundMedia` field except `assetId`: `bounds`,
`offsetX`, `offsetY`, `scale`, `flipX`, `flipY`, `composition`,
`fallbackFrame`.

Capture and restore are mode-aware:

- In `advanced`, the current `composition` is stored, including absence, which
  means the full-cover picture.
- In `simple`, the document has no composition. Capture keeps the entry's
  existing composition instead of erasing it; restore still omits it, so the
  saved document stays valid. Toggling back to `advanced` restores it.
- `fallbackFrame` is restored only for a video asset.
- An entry whose asset is no longer declared is never restored or written.

### Sidecar

Working data is not theme document state and is not portable. It lives beside
the theme:

```
<library>/<theme-id>/theme.json
<library>/<theme-id>/background-media.json
<library>/<theme-id>/assets/...
```

```json
{
  "version": 1,
  "media": {
    "<asset-id>": {
      "bounds": "theme",
      "offsetX": 0.1,
      "offsetY": -0.2,
      "scale": 1.4,
      "flipX": true,
      "fallbackFrame": 42,
      "composition": { "anchor": "left", "extent": 0.4, "fade": 0.2 }
    }
  }
}
```

Rules:

- **Written with the theme save, in the staging folder.** The store's existing
  scratch-folder swap makes `theme.json`, assets, credits and the sidecar one
  replacement; there is no second live write that could recreate a deleted
  theme folder or race a save.
- **Read with the theme open.** The record carries the sidecar to the editor;
  a missing, corrupt or oversized file is empty working data, never a failed
  open. Entries are filtered to the document's declared asset ids.
- **Not exported or imported.** A `.yunari-theme` package carries the current
  document and declared bytes only. Opening an imported theme starts with no
  memory.
- **Purged with its assets.** `pruneAssets` forgets the removed ids, and the
  save output only writes entries for assets the saved document keeps. An
  export cleanup updates the in-memory map but does not rewrite the library
  sidecar, because the library theme itself is unchanged.
- **Theme delete** removes the folder and the sidecar with it.
- **Save as / duplicate / remix** carry the map into the new session; the next
  save writes it under the new theme id.
- **A save that carries no working data** (an MCP save, an install) preserves
  the sidecar already in the folder. The editor always sends a map, including
  an empty one, so it can clear stale entries.
- **No new host route.** The editor already opens and saves through
  `/api/themes/:id`; adding a live sidecar route would add a second write path
  and a folder-lifecycle race for data that only matters when the theme saves.

`background-media.json` is a bounded plain-JSON object at the host boundary
(256 KiB); the editor owns its meaning and normalization. The host never
interprets media fields.

## Lifecycle

| Event | Effect |
|---|---|
| Open stored theme | read sidecar, filter to declared ids, load map |
| Construct document | capture the document's current media; document wins over a stale sidecar |
| Switch asset | capture outgoing, restore incoming or defaults, one `setBackground` |
| Edit any background field | `setBackground` captures the current asset's latest geometry |
| Save | write the map for the saved document's declared assets into the staging folder |
| Save as | same, under the new id |
| Prune | forget removed ids; next save writes the filtered map |
| Export | package omits the sidecar; in-memory map drops unused ids |
| Delete theme | folder removal takes the sidecar |
| Reopen | memory restored; switching A → B → A returns each asset's own geometry |
| New / imported theme | empty memory |

## Non-goals

- No migration and no compatibility fold. A theme without a sidecar has no
  remembered geometry.
- No MCP-side memory. `setBackground` stays an explicit full write of the
  fields it is given.
- No sync of working data between PCs or through exported packages.
- No persistence on every switch before a save. Intra-session switching works
  from the in-memory map; a save is the durability boundary.

## Tests

- Memory module: normalize corrupt input to empty, filter undeclared ids,
  capture/restore round-trip, mode-aware composition, video-only frame.
- `EditorDocument`: A → B → A restores each geometry; unseen B gets defaults;
  Simple hides composition and Advanced restores it; prune forgets entries.
- Each surface uses the one path: Assets pane, video import, finder placement,
  inspector media field.
- Store: sidecar round-trips through save/open; corrupt and oversized files
  read as absent; a save without working data preserves the existing sidecar;
  the folder swap is still atomic.
- Client/server: open returns the sidecar, save round-trips it, package export
  excludes it.
- `npm run gate` green offline.
