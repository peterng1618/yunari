# Tool guide

Every tool answers through the MCP server. Host calls are loopback HTTP; drafts
live in the server process. A stopped server loses drafts; `save_theme` is the
only write into the theme library.

## 1. Discover

Start with these and state what the host answered. Never guess a display id,
sensor key or asset source.

| Tool | Use |
|---|---|
| `yunari_status` | host URL, reachability, theme and display counts, asset sources, sensor count |
| `list_displays` | display id, label, kind, shape, rotation, active theme; a panel's geometry, status and commands |
| `list_sensors` | semantic keys, family, label, unit, and whether this host measures each key; pass `measured: true` to poll |
| `list_themes` | stored ids and names before opening or saving |
| `list_asset_sources` | source ids, labels, categories, credential requirements |

An unreachable host is reported, not retried blindly. Give the user the probed
ports, `YUNARI_URL` and `--url`.

## 2. Ask

Follow `references/questionnaire.md`. One question per gap. Finish the
questionnaire before composing.

## 3. Decide

Apply `references/design-rules.md`. State the target display, viewing distance,
focal reading, palette and reading budget in one short message.

## 4. Assets

| Tool | Use |
|---|---|
| `search_assets` | query, optional source ids, optional page; rows carry an opaque `assetRef`, name, kind, preview URL, licence and source URL |
| `preview_asset` | fetch one finder result as image content and inspect it |
| `import_asset` | declare an asset in the draft from an `assetRef` **or** a local `path`; video may carry `startMs`/`endMs` |

Rules:

- Search the finder first. Import a local file only when the user named that
  file; import generated media only when the user asked for generation.
- A finder import keeps the source's name, licence and source URL in the credit.
- A local import takes the licence the user stated (`license`, `author`) and
  never invents one. No stated licence is recorded as unknown, not emptied.
- `assetRef` is opaque. Do not parse it, build one, or persist it in the theme;
  the draft keeps the declared asset bytes and path.
- Video goes through the host's normalizer; do not re-encode it yourself.
- Never put a remote URL in the theme. Only declared, imported assets travel
  with the document.

## 5. Create the draft

| Tool | Use |
|---|---|
| `create_theme` | name, artboard width/height/shape, language, optional author and description |
| `set_theme_metadata` | name, author, description, language, tags |
| `set_artboard` | width, height, shape, contentFit |
| `set_palette` | entries `{id, name, value}` |
| `set_type_tokens` | heading/body/mono family, weight, size |
| `set_background` | palette colour and optional media asset, bounds, fallback frame |
| `open_theme` | an existing theme, only with `confirmExisting: true` after consent |
| `discard_draft` | drop the in-memory draft; never touches the host |

The artboard matches the target display's aspect. For a panel, use the geometry
`list_displays` reports. A circle artboard is square. Set the palette and type
tokens before composing so objects can reference them by id.

## 6. Compose

| Tool | Use |
|---|---|
| `list_objects` | the draft's ids before updating or removing anything |
| `add_card` | a starter unit (`cpu-card`, `gpu-card`, `ram-gauge`, `trends`, …) at left/top, optional scale |
| `add_text` | box, runs (literal or `value` with a binding id), palette token, size, align, overflow |
| `add_shape` | rect/ellipse/path, box, fill/stroke tokens, stroke width, radius |
| `add_image` | declared asset id, box, fit |
| `add_icon` | name from the shared icon set, box, palette token |
| `add_chart` | family line/bar/gauge, box, binding, optional settings |
| `add_binding` | bind an existing object to one or more semantic keys |
| `update_object` | validated JSON merge by object id |
| `remove_object` | delete an object by id; not a saved-theme delete |
| `group_objects` / `ungroup_objects` | group ids / group id |

Compose tools return the ids they created and any issue the kit reported. Fix
reported issues before the next call. Never bind a key `list_sensors` did not
report as measured.

## 7. Validate

`validate_theme` returns `{ ok, issues }` from the envelope validator. Fix every
issue before previewing. A save of an invalid draft is refused.

## 8. Preview

`preview_theme` takes the theme id and an optional display id.

- **Browser display:** returns the player URL and a viewport size and shape.
  Set the browser or screenshot to **exactly** that size before judging or
  capturing. The ratio preserves the artboard aspect; the long edge is capped
  at 1600 px; a circle artboard returns a square viewport. A browser preview of
  the wrong size is not evidence.
- **Panel display:** returns the panel PNG as image content, plus its geometry.
  The host renders the panel page through the same Chromium pipeline that
  drives hardware: `GET /api/themes/:id/panel-preview?display=<id>[&clip=1]`.
  Inspect the image itself. Never substitute a browser screenshot for a panel,
  and never claim a panel preview without this image.

An unsaved draft that the preview path cannot read is saved first. A failed save
returns the validator issues and no preview.

## 9. Revise

Read the preview against `references/design-rules.md`: hierarchy, contrast,
safe margins, type size at the target distance, media scrim, missing readings.
Revise with `update_object` or the compose tools, then validate and preview
again. Do not save a theme you have not seen at its real size.

## 10. Save

`save_theme` writes the draft into the library and returns the id and base.

- Save freely a new draft (`create_theme`).
- A draft opened from a stored theme (`open_theme`) writes over that theme. The
  user consented before opening; ask again if the saved bytes changed since.
- Pass the overwrite option only after explicit consent for a stored theme.
  Without consent, a conflicting base is refused; re-read the theme and ask
  rather than discarding the user's stored work.
- There is no delete tool. Do not offer to remove a saved theme.

## 11. Assign

`assign_theme` takes a display id and a theme id and changes what the display
shows. Call it only when the user asked or agreed to that display receiving
that theme, and report the assignment back to them.

## Failure handling

- A tool error is the server's answer: relay it and change the next call. Do
  not retry an invalid save, an unconfirmed `open_theme` or a missing sensor.
- A missing reading is reported as missing. Never fill it.
- A refused save keeps the draft. Fix the issues and save again.
