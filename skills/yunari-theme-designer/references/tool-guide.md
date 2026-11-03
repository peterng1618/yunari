# Tool guide

Every tool answers through the MCP server. Host calls are loopback HTTP; drafts
live in the server process. A stopped server loses drafts; `save_theme` writes
the theme library, and `preview_theme` saves the draft first on both paths.

## 1. Discover

Start with these and state what the host answered. Never guess a display id,
sensor key or asset source.

| Tool | Use |
|---|---|
| `yunari_status` | host URL, reachability, theme and display counts, asset sources, sensor count |
| `list_displays` | display id, label, kind, shape, rotation, active theme; a panel's geometry, status and commands |
| `list_sensors` | semantic keys, family, label, unit, value kind and whether this host measures each key; polls by default, pass `measured: false` to skip the poll. Its `families` summary gives per-family key counts and a `contextual` flag — read it before choosing readings |
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
| `search_assets` | query, optional source ids, optional page; rows carry an opaque `assetRef`, name, kind, preview URL, licence and source URL. Font rows also carry the lead face (`family`, `weight`, `style`, `format`, `subset`); Wallpaper Engine rows are video only |
| `preview_asset` | fetch one image result as image content and inspect it; a font or video has no image preview |
| `import_asset` | declare an asset in the draft from an `assetRef` **or** a local `path`; video may carry `startMs`/`endMs` |

Rules:

- Search the finder first. Import a local file only when the user named that
  file; import generated media only when the user asked for generation.
- Wallpaper Engine is a local library, not a provider: its rows are listed
  from this PC's subscriptions and only `video` items can back a theme.
- A font row imports the lead cut and carries its face metadata into the
  declaration. `set_type_tokens` must name that face's `assetId`, family and
  weight, or the player has nothing to register for the role.
- A finder import keeps the source's name, licence and source URL in the credit.
- A local import takes the licence the user stated (`license`, `author`) and
  never invents one. No stated licence is recorded as unknown, not emptied.
- `assetRef` is opaque. Do not parse it, build one, or persist it in the theme;
  the draft keeps the declared asset bytes and path.
- Video goes through the host's normalizer; do not re-encode it yourself.
- Never put a remote URL in the theme. Only declared, imported assets travel
  with the document.

## Tool facts that change the design

Current tool behaviours, not preferences. Each has cost a save, a preview or a
silent fallback when missed.

- **A font row declares more than it downloads.** The row carries a lead face
  (family, weight, subset) while the import fetches the row's source file, often
  Latin at 400. A pairing row imports only its lead face; a single-family row
  imports the cut it lists, often the lightest. The validator follows the row, so
  name the row's declared family and weight and pass the import's `assetId` — the
  cut is the row's, not a token field (`set_type_tokens` has no subset). A
  declared subset such as `latin-ext`, `vietnamese`, `cyrillic-ext` or `math` can
  exclude basic Latin while `document.fonts` still reports the face loaded.
  After previewing, verify the face actually rendered: a fallback serif means the
  range does not cover the text, so choose a row declared `latin`. The mismatch
  can go either way: a row may declare `vietnamese` while its id and bytes are
  `latin-400`, so a row's preview URL is not evidence of which cut imports. When
  no row for the face declares `latin`, import a `curated-fonts` pairing row,
  whose lead face is declared `latin`. The weight is numeric: a string is
  accepted by the tool but will not match the declared asset, and the save fails
  as `unresolved-asset-ref`.
- **A value run already carries its unit.** A bound value defaults to
  `unitDisplay: "short"` and appends its unit. Do not add a second `%`, `°C` or
  `Mb/s`: write the value with `unitDisplay: "none"` and a separate literal unit
  run only when the unit needs its own style, or let the binding append it.
- **A gradient's angle is a direction, not a compass.** `0` fades left to right
  and `90` bottom to top. Author a scrim by its anchor edge: a bottom fade is
  `90` with the dark stop at the bottom, a left fade is `0` with the dark stop at
  the left. Inspect the boundary in the preview.
- **An ellipse has fill only.** `add_shape` refuses a stroke on an ellipse; a ring
  is two stacked filled ellipses (outer minus inner) or a path with a stroke.
- **A date or time format is a small token set, not an ICU pattern.** `YYYY YY
  MMMM MMM MM M DD D dddd ddd HH H hh h mm ss A a`; bracket a literal, as in
  `[Today is ]dddd`. An unknown token such as `EEEE` or `d` renders as typed, so
  preview the clock.
- **`add_text` has no type-token argument.** It chooses `heading` at 36 px and
  above and `body` below, so the mono role is not reachable through it; set the
  face on the role the size selects. To pair a mono face with a display face,
  put the mono on `body` and keep those labels under 36 px.
- **A video asset cannot back an `add_image`.** It is accepted and validates,
  but the player paints an empty black rectangle; use `set_background` for a
  video and `add_image` only for a still.
- **Objects paint in insertion order, and there is no reorder tool.** A scrim
  added after a text block draws over it. Add the scrim before the text it must
  sit behind, or remove and re-add the text after the scrim.
- **An image-kind key binds through an existing Image object.** `add_image`
  takes only an asset id, so import a truthful fallback picture, place it, then
  replace that object's bindings with `{ "id": "image", "semanticKey":
  "weather.icon" }` (or `media.artwork`, `game.artwork`). The host's reading
  replaces the authored picture only while the key is available; an unavailable
  reading restores the fallback, so the fallback must be a picture the theme can
  stand on. `preview_theme` lists the key and reports no missing sensor when the
  reading exists.
- **A clock face needs lining figures.** Cormorant Garamond and other old-style
  faces render `1` as a small `I` and drop digits below the baseline; a time
  read at a glance needs lining figures. Preview the clock before accepting the
  face.
- **Test a display face at the smallest value size.** Bebas Neue and similar
  condensed faces can space numerals widely at 30–40 px (`4 4 ° C`); use them for
  the title and set changing values in the body face. A mono face does the same
  with a degree glyph at 64 px; put the unit in its own run one step smaller.
- **`add_text` applies the starter's tracking by size.** About 6 px at 17 px and
  28 px at 36 px, with no tracking argument; a caption can overflow its box or
  truncate. Size the run down or widen the box, and inspect the rendered line.
- **`list_objects` is summary-only.** It returns id, type and name, not runs or
  styles; read the object's detail from the envelope (`open_theme`).
- **A chart's defaults are not valid to save.** `add_chart`'s default line
  settings carry literal colours, which the validator refuses as
  `unresolved-global-ref`. Pass `settings` whose `stroke` and `area` are
  `{ "ref": "palette.<token>" }`. A chart's `box` positions its centre, not its
  top-left, unlike the other compose tools. A line chart starts empty because
  history begins when the player loads; judge the trace after about 30 s, and
  never let a chart alone prove a value at first paint.
- **A video row's `preview` URL is its still.** `preview_asset` has no image for
  a video; inspect that still before importing.
- **Wallpaper Engine:** single-keyword searches work and multi-word searches
  often return nothing; a clip over 60 s needs `startMs`/`endMs`; the source
  must be an H.264 MP4; imports over 80 MB are refused, so trim. A row can
  advertise `video/mp4` while the bytes are Matroska, and only the import tells
  you — if one clip is refused, try the next rather than the same file trimmed.
- **A second draft changes the import call.** With more than one draft open,
  `import_asset` requires an explicit `themeId`.
- **Background offsets stop at ±1.** A positive `offsetY` moves the picture
  down, revealing its top; a positive `offsetX` moves it right, revealing its
  left. The pan is bounded by the cover overhang, so choose a source whose
  subject survives the crop at that limit.
- **A theme language localizes the date, not contextual text.** With
  `language` set, `date.today` renders in that language, but `weather.condition`,
  `weather.location`, media titles and game names stay as the host sends them.
  Remove a line that would mix languages rather than keep one English word in a
  localized theme.
- **A browser preview settles late.** Live values and packaged faces appear
  after the first paint; capture after about 6–8 s and confirm the readings and
  the intended face are actually present. A slower host can still show the
  connecting placeholder or skeleton values at 8 s; wait another 10 s and
  capture again rather than judging the first frame.
- **The shared icon glyphs are not ready to ship.** `add_icon` has rendered the
  starter glyphs as filled shapes far below the requested box — specks at
  24×24, solid blobs, and one glyph that drew nothing — while `validate_theme`
  stays silent. Inspect the icon at the real viewport, or leave it out.

## 5. Create the draft

| Tool | Use |
|---|---|
| `create_theme` | name, artboard width/height/shape, language, optional author and description |
| `set_theme_metadata` | name, author, description, language, tags |
| `set_artboard` | width, height, shape, contentFit |
| `set_palette` | entries `{id, name, value}` |
| `set_type_tokens` | heading/body/mono family and weight, plus the imported face's `assetId`; a text run carries its own size |
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
| `add_card` | a starter unit (`group-time-card`, `group-cpu-card`, `group-gpu-card`, `group-ram-card`, `group-vram-card`, `group-trends-card`, `group-storage-card`, `group-network-card`) at left/top, optional scale |
| `add_text` | box, runs (literal or `value` with a binding id), palette token, size, align, overflow |
| `add_shape` | rect/ellipse/path, box, one palette `token`; radius on a rect, path points and stroke width on a path — other combinations are refused |
| `add_image` | declared asset id, box |
| `add_icon` | `icon` from the shared icon set, box, palette token |
| `add_chart` | family line/bar/gauge, box, binding, optional settings |
| `add_binding` | replace an object's `bindings` array with one or more semantic keys |
| `update_object` | validated JSON merge by object id, under the `patch` field |
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

A preview saves the draft into the library first, on both paths: a player reads
a stored theme by id, so an unsaved or edited draft would otherwise show a 404
or the old version. A failed save returns the validator issues and no preview.

**Wait for live data before judging a browser preview.** The page sets
`data-yunari-live="true"` on `document.documentElement` once the first sample
batch has been ingested; before that the readings are placeholders and the
connection strip is showing. A capture taken before that marker is not evidence
of a layout defect.

**A chart's history starts when its player loads.** A line or area trace is
empty at first paint because no samples have accumulated yet — that is the
absence of data, not a render bug, and it must never be filled with invented
values. If the design depends on the trace, leave the preview open for about
30 seconds after the live marker and judge it then; otherwise judge the frame
and note that the trace was not yet populated.

## 9. Revise

Read the preview against `references/design-rules.md`: hierarchy, contrast,
safe margins, type size at the target distance, media scrim, missing readings.
Revise with `update_object` or the compose tools, then validate and preview
again. Do not save a theme you have not seen at its real size.

## 10. Save

`save_theme` writes the draft into the library and returns the id and base. It
takes only the draft id; there is no overwrite flag.

- Save freely a new draft (`create_theme`).
- A draft opened from a stored theme (`open_theme`) writes back to that theme
  id. The user consented before opening; ask again if the saved bytes changed
  since.
- The save carries the base the draft was opened with. If the host holds a
  newer save, it is refused; re-read the theme and ask rather than discarding
  the user's stored work.
- A saved theme with no library picture gets one rendered by the host, whichever
  client saved it; the editor's own canvas capture replaces it when it arrives.
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
