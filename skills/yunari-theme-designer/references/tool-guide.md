# Tool guide

Every tool answers through the MCP server. Host calls are loopback HTTP; drafts
live in the server process. A stopped server loses drafts; `save_theme` writes
the theme library, and `preview_theme` saves the draft first on both paths.

## 0. Install and status

`yunari mcp install` (bundle) or `yunari-mcp install` (standalone) registers the
server and installs this skill. It asks for agents, scope, the skill, tool
approval and the host URL; every question has a flag (`--agent`, `--scope`,
`--skill`/`--no-skill`, `--auto-approve all|none`, `--url`). `--yes` takes every
default and a piped run without it exits 2 instead of waiting. `yunari mcp
status` reports the host, the registered entry and whether the installed skill
matches the packaged copy. Reinstall to update.

## 1. Discover

Start with these and state what the host answered. Never guess a display id,
sensor key or asset source.

| Tool | Use |
|---|---|
| `yunari_status` | host URL, reachability, theme and display counts, asset sources, sensor count |
| `list_displays` | display id, label, kind, shape, rotation, active theme; a panel's geometry, status and commands |
| `list_sensors` | semantic keys, family, label, unit, value kind and whether this host measures each key; polls by default, pass `measured: false` to skip. Its `families` summary gives per-family key counts and a `contextual` flag — read it before choosing readings |
| `list_themes` | stored ids and names before opening or saving |
| `list_asset_sources` | source ids, labels, categories, credential requirements |

An unreachable host is reported, not retried blindly. Give the user the probed
ports, `YUNARI_URL` and `--url`.

## 2. Ask

Follow `references/questionnaire.md`. One question per gap.

## 3. Decide

Apply `references/design-rules.md`. State the target display, viewing distance,
focal reading, palette and reading budget in one short message.

## 4. Assets

| Tool | Use |
|---|---|
| `search_assets` | query, optional source ids, optional page; rows carry an opaque `assetRef`, name, kind, preview URL, licence and source URL. Font rows also carry the lead face (`family`, `weight`, `style`, `format`, `subset`); Wallpaper Engine rows are video only |
| `preview_asset` | one image result as image content. A font has no image preview; a video row has no image content, but its `preview` URL is the still, so inspect that before importing |
| `import_asset` | declare an asset from an `assetRef` **or** a local `path`; video may carry `startMs`/`endMs` |
| `remove_asset` | remove a declared asset with its bytes and credit, when nothing references it; refuses one an object, the background or a font face still uses |

Rules:

- Search the finder first. Import a local file only when the user named that
  file; import generated media only when the user asked for generation.
- Font search matches family names, not descriptions; multi-word queries often
  return nothing. Search a single family word.
- Wallpaper Engine is a local library, not a provider: its rows come from this
  PC's subscriptions and only `video` items can back a theme.
- A font row imports its lead cut and carries its face metadata into the
  declaration. `set_type_tokens` must name that face's `assetId`, family and
  weight, or the player has nothing to register for the role.
- A finder import keeps the source's name, licence and source URL in the credit.
  A local import takes the licence the user stated (`license`, `author`) and
  never invents one; no stated licence is recorded as unknown, not emptied.
- `assetRef` is opaque. Do not parse it, build one, or persist it in the theme;
  the draft keeps the declared asset bytes and path.
- Video goes through the host's normalizer; do not re-encode it yourself.
- Never put a remote URL in the theme. Only declared, imported assets travel
  with the document.
- Remove assets you probed but did not use before saving; `remove_asset` refuses
  one that is still referenced, so clear the reference first.

## Tool facts that change the design

Current behaviours, each has cost a save or preview when missed.

- **A font row declares more than it downloads.** The lead face (family, weight,
  subset) may differ from the file the import fetches — often Latin at 400.
  Pairing rows import their lead face; single-family rows the listed cut, often
  the lightest. Name the row's declared family and weight and pass the import's
  `assetId`; the cut is the row's (`set_type_tokens` has no subset). A declared
  subset (`latin-ext`, `vietnamese`, `cyrillic-ext`, `math`) can exclude basic
  Latin while `document.fonts` reports loaded — a fallback serif in the preview
  means it did. The mismatch goes either way, so a preview URL is not evidence of
  the imported cut; prefer a `latin` row, or a `curated-fonts` pairing row whose
  lead is `latin`. Weight is numeric: a string is accepted but fails the save as
  `unresolved-asset-ref`.
- **`set_type_tokens` takes flat role keys.** Pass
  `{ "heading": { "family", "weight", "face" } }`, not a `roles` wrapper:
  unknown keys are stripped, so a nested call succeeds and leaves the starter
  tokens unchanged. Check the returned `typeTokens` changed.
- **A value run already carries its unit.** A bound value defaults to
  `unitDisplay: "short"` and appends its unit. Do not add a second `%`, `°C` or
  `Mb/s`; write the value with `unitDisplay: "none"` and a separate unit run only
  when the unit needs its own style.
- **A gradient's angle is a direction, not a compass.** `0` fades left to right
  and `90` bottom to top. Author a scrim by its anchor edge: a bottom fade is
  `90` with the dark stop at the bottom, a left fade is `0` with it at the left.
  Inspect the boundary in the preview.
- **A panel's video overlay is coarser than its preview.** The TURZX overlay
  carries 4 bits per colour channel and 4 bits of opacity, so a soft black-to-
  transparent gradient becomes a handful of flat bands that read as a grey wash.
  The browser preview and the Lian Li PNG layer keep the full ramp. A fade over
  video is therefore a background composition, not a UI scrim: the host bakes
  it into the panel clip, where the ramp keeps its precision.
- **A fill-only rect keeps no border.** `add_shape` authors `strokeWidth: 0`;
  never put a stroke on a scrim, and do not rely on a border to hide an edge.
- **An ellipse has fill only.** `add_shape` refuses a stroke on an ellipse; a ring
  is two stacked filled ellipses (outer minus inner) or a path with a stroke.
- **A date or time format is a small token set, not an ICU pattern.** `YYYY YY
  MMMM MMM MM M DD D dddd ddd HH H hh h mm ss A a`; bracket a literal, as in
  `[Today is ]dddd`. An unknown token such as `EEEE` or `d` renders as typed, so
  preview the clock.
- **`add_text` names a type role per run.** Pass `typeToken: "heading" | "body" |
  "mono"`; omit it and size decides (36 px and above is `heading`, below is
  `body`), so a mono label needs the explicit token.
- **A video asset cannot back an `add_image`.** It validates but paints an empty
  black rectangle; use `set_background` for video, `add_image` only for a still.
- **Objects paint in insertion order, and there is no reorder tool.** A scrim
  added after text draws over it. Add the scrim first, or remove and re-add the
  text after it.
- **An image-kind key binds through an existing Image object.** `add_image`
  takes only an asset id, so import a truthful fallback, place it, then replace
  that object's bindings with `{ "id": "image", "semanticKey":
  "weather.icon" }` (or `media.artwork`, `game.artwork`). The host replaces the
  authored picture only while the key is available; an unavailable reading
  restores the fallback, so it must be a picture the theme can stand on.
  `preview_theme` lists the key and reports no missing sensor while it exists.
- **Test a display face at the smallest value size.** A condensed face such as
  Bebas Neue can space numerals widely at 30–40 px (`4 4 ° C`); a mono face does
  the same with a degree glyph at 64 px. Use them for titles or set changing
  values in the body face, with the unit in its own run one step smaller.
- **`list_objects` is summary-only.** It returns id, type and name, not runs or
  styles; read detail from the envelope (`open_theme`).
- **A chart's defaults are not valid to save.** `add_chart`'s default line
  settings carry literal colours, which the validator refuses as
  `unresolved-global-ref`. Pass `settings` whose `stroke` and `area` are
  `{ "ref": "palette.<token>" }`. A chart's `box` is its top-left, like every
  other compose tool. A line chart starts empty because history begins when the
  player loads; judge the trace after about 30 s, and never let a chart alone
  prove a value at first paint.
- **Wallpaper Engine:** single-keyword searches work and multi-word searches
  often return nothing; a clip over 60 s needs `startMs`/`endMs`; the source must
  be an H.264 MP4; imports over 80 MB are refused, so trim. A row can advertise
  `video/mp4` while the bytes are Matroska, and only the import tells you — if
  one clip is refused, try the next rather than the same file trimmed.
- **A second draft changes the import call.** With more than one draft open,
  `import_asset` requires an explicit `themeId`.
- **Background offsets stop at ±1.** Positive `offsetY` moves the picture down,
  revealing its top; positive `offsetX` moves it right, revealing its left. The
  offset is a fraction of the cover overhang, so ±1 reaches the full pan on any
  crop; choose a source whose subject survives at that limit.
- **A region is authored inside the media's bounds box.** `inset` gives the
  media area in fractions of that box (`left`/`right`/`top`/`bottom`, each
  0–0.9, and the two sides of one axis must leave room), and `blend` fades the
  media into `fill` — the palette colour the uncovered area is painted with. On
  a panel overlay the media and its fill are one picture, so the overlay layer
  hides with them rather than painting background pixels over the UI.
- **An unnamed layer reads as its type word.** A compose call without `name`
  names the object after the id it mints — a tree of "text", "shape" and
  "icon". Pass a short, content-specific `name` on every add, and name a group
  for the component its parts form (a clock's face, ticks and hands are
  "Clock").
- **A theme language localizes the date, not contextual text.** With `language`
  set, `date.today` renders in that language, but `weather.condition`,
  `weather.location`, media titles and game names stay as the host sends them.
  Remove a line that would mix languages.
- **A browser preview settles late.** Live values and packaged faces appear
  after the first paint; capture after about 6–8 s and confirm the readings and
  the intended face are present. A slower host can still show the connecting
  placeholder at 8 s; wait another 10 s and capture again rather than judging the
  first frame.
- **The shared icon glyphs are not ready to ship.** `add_icon` has rendered the
  starter glyphs as filled shapes far below the requested box — specks at 24×24,
  solid blobs, one glyph that drew nothing — while `validate_theme` stays silent.
  Inspect the icon at the real viewport, or leave it out.

## 5. Create the draft

| Tool | Use |
|---|---|
| `create_theme` | name, artboard width/height/shape, language, optional author and description |
| `set_theme_metadata` | name, author, description, language, tags |
| `set_artboard` | width, height, shape, contentFit |
| `set_palette` | entries `{id, name, value}`; a value may be a solid colour or a gradient paint, so a scrim can be a palette token |
| `set_type_tokens` | heading/body/mono family and weight, plus the imported face's `assetId` as `face` (a string; the envelope stores `{ assetId }`); a text run carries its own size |
| `set_background` | palette colour and optional media asset, bounds, fallback frame; `fill` paints the area a region leaves, `inset` places the media in that region, `blend` fades it into the fill |
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
| `add_text` | box, runs (literal or `value` with a binding id), palette token, size, align, overflow, `name` |
| `add_shape` | rect/ellipse/path, box, one palette `token`; radius on a rect, path points and stroke width on a path — other combinations are refused |
| `add_image` | declared asset id, box, `name` |
| `add_icon` | `icon` from the shared icon set, box, palette token, `name` |
| `add_chart` | family line/bar/gauge, box, binding, optional settings, `name` |
| `add_binding` | replace an object's `bindings` array with one or more semantic keys |
| `update_object` | validated JSON merge by object id, under the `patch` field |
| `remove_object` | delete an object by id; not a saved-theme delete |
| `group_objects` / `ungroup_objects` | group ids under the component's `name` / group id |

Compose tools return the ids they created and any issue the kit reported. Fix
reported issues before the next call. Never bind a key `list_sensors` did not
report as measured.

## 7. Validate

`validate_theme` returns `{ ok, issues }` from the envelope validator. Fix every
issue before previewing. A save of an invalid draft is refused.

## 8. Preview

`preview_theme` takes the theme id and an optional display id.

- **Browser display:** returns the player URL and a viewport size and shape. Set
  the browser or screenshot to **exactly** that size before judging or
  capturing. The ratio preserves the artboard aspect; the long edge is capped at
  1600 px; a circle artboard returns a square viewport. A browser preview of the
  wrong size is not evidence.
- **Panel display:** returns the panel PNG as image content, plus its geometry.
  The host renders the panel page through the same Chromium pipeline that drives
  hardware: `GET /api/themes/:id/panel-preview?display=<id>[&clip=1]`. Inspect
  the image itself. Never substitute a browser screenshot for a panel, and never
  claim a panel preview without this image.

A preview saves the draft into the library first, on both paths: a player reads
a stored theme by id, so an unsaved or edited draft would otherwise show a 404
or the old version. A failed save returns the validator issues and no preview.

**Wait for live data before judging a browser preview.** The page sets
`data-yunari-live="true"` on `document.documentElement` once the first sample
batch is ingested; before that the readings are placeholders. A capture taken
before that marker is not evidence of a layout defect.

**A chart's history starts when its player loads.** A line or area trace is empty
at first paint because no samples have accumulated — absence of data, not a
render bug, and never filled with invented values. If the design depends on the
trace, leave the preview open about 30 s after the live marker and judge it
then; otherwise judge the frame and note that the trace was not yet populated.

## 9. Revise

Read the preview against `references/design-rules.md`: hierarchy, contrast, safe
margins, type size at the target distance, media scrim, missing readings. Revise
with `update_object` or the compose tools, then validate and preview again. Do
not save a theme you have not seen at its real size.

## 10. Save

`save_theme` writes the draft into the library and returns the id and base. It
takes only the draft id; there is no overwrite flag.

- Save freely a new draft (`create_theme`).
- A draft opened from a stored theme (`open_theme`) writes back to that theme id.
  The user consented before opening; ask again if the saved bytes changed since.
- The save carries the base the draft was opened with. If the host holds a newer
  save it is refused; re-read the theme and ask rather than discarding the user's
  stored work.
- A saved theme with no library picture gets one rendered by the host, whichever
  client saved it; the editor's own canvas capture replaces it when it arrives.
- There is no delete tool. Do not offer to remove a saved theme.

## 11. Assign

`assign_theme` takes a display id and a theme id and changes what the display
shows. Call it only when the user asked or agreed to that display receiving that
theme, and report the assignment back to them.

## Failure handling

- A tool error is the server's answer: relay it and change the next call. Do not
  retry an invalid save, an unconfirmed `open_theme` or a missing sensor.
- A missing reading is reported as missing. Never fill it.
- A refused save keeps the draft. Fix the issues and save again.
