# Yunari MCP theme designer — design

- **Date:** 2026-11-03
- **Status:** approved by the user in conversation; implementation authorised
- **Area:** new `@yunari/theme-kit`, new `@yunari/mcp`, host panel preview,
  `skills/yunari-theme-designer/`

## Problem

A person can ask a coding agent to design a Yunari theme from a reference
screenshot, a written brief, or their own media. Today the agent has no way to
read Yunari's state, compose a valid Fabric envelope, find assets through the
Asset Finder, see the result, save it, or put it on a display. Every theme
feature the editor owns is browser-only, and the host's loopback HTTP API is
the only durable surface.

The work must add that agent surface without inventing a second theme
repository, a second renderer, a second asset pipeline, or a second definition
of what a Yunari theme looks like.

## Goals

1. An MCP server that lets an agent inspect displays, sensors, themes, assets
   and the theme schema, compose a theme, validate it, preview it, save it, and
   assign it.
2. One shared, Node-safe authoring library used by both the editor and the MCP
   server. Moving this code must not change editor behaviour.
3. A portable skill that makes the agent ask only for missing requirements and
   then follow Yunari's design, asset, telemetry and safety rules.
4. A self-installer that registers the MCP server with Claude Code and installs
   the skill under `~/.agents/skills/`.
5. Reuse `add-mcp` for Claude Code MCP configuration and the Vercel `skills`
   CLI for skill installation instead of hand-rolling either format.

## Non-goals

- A remote or LAN MCP endpoint. The server is stdio and talks to a loopback
  host, exactly as the editor does.
- A second theme store, theme format, scene model, asset store or renderer.
  Drafts live in the MCP process; a saved theme lives in the host library.
- Full editor parity in v1: crop, masks, effects, animation, every chart
  family, custom path authoring and the catalogue/remix flow are out.
- Generating images, video, fonts or icons. The agent uses its own tools only
  when the user explicitly asks; otherwise it uses the Asset Finder.
- Changing what a player, panel, provider or store already does.

## Product flow

1. The user asks for a theme, optionally with a reference image, media files,
   a display and a brief.
2. The skill asks only for material gaps: target display and viewing distance,
   data priorities, data-vs-media balance, style/mood, light/dark, palette,
   language/units, name and author.
3. The agent lists displays and sensors, chooses an artboard, finds assets
   through the Asset Finder, and confirms licensing/credits.
4. The agent creates a draft, composes it with the shared kit, binds real
   semantic keys, and validates it.
5. The agent previews it:
   - a browser display: opens the player URL itself at the target ratio;
   - a USB panel: asks the host's panel rasterizer for a PNG at the panel's
     exact geometry.
6. The agent revises from what it sees, saves, assigns the theme to the chosen
   display, and reports what is on screen and which readings are missing.

## Architecture

### `@yunari/theme-kit` (new, Node-safe)

Owns the pure authoring vocabulary currently split across the editor:

- Fabric JSON object builders (`text`, `label`, `valueLabel`, `chart`, `path`,
  `rect`, `cardGroup`).
- Starter palette, type tokens, starter icons and the starter composition.
- The eight starter cards and `instantiateCard` (fresh ids, mapped tokens,
  copied bindings, provenance).
- Artboard presets and the ratio/resolution/orientation table.
- Document helpers: create blank, clone, list scene objects, add/update/remove
  an object, set bindings, palette, type tokens, artboard and background.
- Asset declaration from bytes: `id`, `path`, `sha256`, `kind`, license,
  source URL and the matching credit entry.

It depends on `@yunari/renderer-core` and `@yunari/scene-fabric` for types,
traversal and persisted-property constants. It imports no React, no DOM and no
editor manager. Icon geometry is carried as data, so the MCP process never
loads a React icon wrapper.

The editor keeps `EditorDocument`, the canvas, undo, inspectors, save flow and
its Fabric-object construction defaults. It imports the shared pure builders
and card instantiation; its behaviour and saved bytes stay the same.

### `@yunari/mcp` (new)

A stdio MCP server built on `@modelcontextprotocol/server` v2 and zod 4.

- `yunari-mcp serve` starts the stdio server.
- `yunari-mcp install|uninstall|status` owns the agent-facing install.
- `--url` / `YUNARI_URL` names the host. Without either, the client probes
  `http://127.0.0.1:5227` through `:5236`, stopping at the first answer that
  identifies as a Yunari host.
- Every host call is loopback HTTP, the same routes the editor uses:
  `/api/themes*`, `/api/assets*`, `/api/sensors`, `/api/themes/active` and the
  new panel-preview route.
- Drafts are held in memory, keyed by theme id. A draft is
  `{ envelope, assets, credits, base?, origin: "new" | "opened" }`.
- `save_theme` and `preview_theme` are the writes into the theme library.
  `preview_theme` saves the draft first on both paths: a browser player reads a
  stored theme by id, so an unsaved or edited draft would otherwise show a 404
  or the old version. A failed save returns the validator's issues and no
  preview.

### Host changes

- The panel family registry gains the panel's fixed `geometry` as a declared
  fact (800×480 TURZX, 320×320 Kraken, 464/480×1920 TUR/USB), so a preview
  never has to open hardware to learn a panel's size.
- `list_displays` reports that geometry for a panel, beside its shape,
  rotation, status and commands.
- `PanelManager.capturePreview(displayId, themeId, clip)` renders the panel
  page with the theme override through the existing shared Chromium/CDP
  rasterizer and returns a PNG. The panel manager keeps owning the browser;
  no second raster runtime is created.
- `GET /api/themes/:id/panel-preview?display=<id>[&clip=1]` exposes that
  capture to the MCP server. It is loopback-only, refuses a non-panel display
  and refuses a theme that does not validate.

### Skill

`skills/yunari-theme-designer/` contains a `SKILL.md` and references:

- `references/questionnaire.md` — what to ask and what may be derived.
- `references/design-rules.md` — legibility, hierarchy, spacing, palette,
  contrast, media balance, data honesty and asset rules.
- `references/tool-guide.md` — how to drive the MCP tools and preview loop.

The installer copies the folder into `~/.agents/skills/yunari-theme-designer/`.
Claude Code reads that directory natively. The installer does not write a
second copy under `~/.claude/skills/`.

### Installer

`yunari-mcp install`:

1. runs the Vercel `skills` CLI from its installed package with
   `DISABLE_TELEMETRY=1`, installing the local skill directory globally;
2. calls `add-mcp`'s `upsertServer("claude-code", "yunari", {command, args},
   {local: false})`;
3. asks `add-mcp` to auto-approve `mcp__yunari` (all tools), as the user chose.

`yunari-mcp uninstall` removes the same server entry and the skill through the
same libraries. `yunari-mcp status` reports the host connection, the config
entry and the installed skill path without changing anything. `install --url`
puts that URL into the registered server's arguments, so a host on a custom
port survives a later session.

## MCP tool surface

### Discovery

| Tool | Input | Output |
|---|---|---|
| `yunari_status` | none | host URL, reachable, theme count, displays, asset sources, sensor count |
| `list_displays` | none | id, label, kind, shape, rotation, active theme; panel geometry/status/commands |
| `list_sensors` | `measured?: boolean` (default true) | semantic key, family, label, unit, and whether this host currently answers that key |
| `list_themes` | none | id, name, author, updatedAt and origin from the host's listing; artboard, description, credits and sensors come from `get_theme` |
| `get_theme` | `themeId` | envelope, asset references and credit summary; never asset bytes |
| `list_asset_sources` | none | source id, label, category, credential requirement |

### Assets

| Tool | Input | Output |
|---|---|---|
| `search_assets` | query, source ids, page | rows with an opaque `assetRef`, name, kind, preview URL, licence, source URL |
| `preview_asset` | `assetRef` | image content for the agent to inspect |
| `import_asset` | `assetRef` **or** `path`, optional video trim | declared asset id in the draft, bytes, credit |

`import_asset` accepts a local path only when the user named the file. It
checks the extension against the asset kinds, refuses bytes over the store's
cap, and declares the asset under `assets/`. A video background goes through
the host's `normalize-video` route. A finder import carries the source's own
name, licence and URL into the credit; a local import asks the skill to record
the user's stated licence instead of inventing one.

### Draft and tokens

| Tool | Input |
|---|---|
| `create_theme` | name, artboard width/height/shape, language, optional author/description |
| `open_theme` | theme id, `confirmExisting` |
| `set_theme_metadata` | name, author, description, language, tags |
| `set_artboard` | width, height, shape, contentFit |
| `set_palette` | entries `{id, name, value}` |
| `set_type_tokens` | heading/body/mono family and weight; sizes belong to individual text runs |
| `set_background` | colour reference and optional media asset, bounds, fallback frame |
| `discard_draft` | theme id |

`open_theme` refuses without `confirmExisting`. A draft created by
`create_theme` is `origin: "new"` and may be saved freely. A draft opened from
a stored theme is `origin: "opened"`, and the skill must have asked the user
before calling it. This is the server-side half of the rule that an existing
theme is not modified without explicit approval.

### Compose

| Tool | Input |
|---|---|
| `add_card` | unit id, left, top, optional scale |
| `add_text` | box, runs (literal/value with binding id, palette token, size), align, overflow |
| `add_shape` | rect/ellipse/path, box, fill/stroke tokens, stroke width, radius |
| `add_image` | declared asset id, box |
| `add_icon` | icon name from the shared icon set, box, palette token |
| `add_chart` | family (line/bar/gauge), box, binding, optional settings |
| `add_binding` | object id, bindings array |
| `list_objects` | theme id |
| `update_object` | object id, validated JSON merge in `patch` |
| `remove_object` | object id |
| `group_objects` / `ungroup_objects` | object ids / group id |

Every compose tool returns the ids it created and any issue the kit reported.
A tool never writes to the host; it mutates the draft. `ungroup_objects`
refuses a group carrying a scale or rotation rather than baking transforms.

### Verify and deploy

| Tool | Input | Output |
|---|---|---|
| `validate_theme` | theme id | `{ ok, issues }` from the envelope validator |
| `preview_theme` | theme id, optional display id | browser: player URL + viewport size + shape; panel: PNG image + geometry |
| `save_theme` | theme id | saved id, base, validation issues if refused |
| `assign_theme` | display id, theme id | active-theme map entry for that display |

`preview_theme` saves the draft, then returns
`http://<host>/?theme=<id>[&display=<id>]` and a viewport that preserves the
artboard's aspect (long edge capped at 1600). The skill tells the agent to set
the browser to exactly that size before judging or screenshotting. A circle
artboard returns a square viewport. `preview_theme` for a panel calls the host
route and returns the PNG as MCP image content.

## Data and invariants

- The persisted model is the existing `FabricThemeEnvelope`. No simplified
  scene tree and no write-back model.
- Telemetry stays real: bindings name semantic keys from `renderer-core`; a
  missing reading stays absent. The preview reports bound keys that the host
  did not measure. No zero/default is written for a missing sensor.
- Assets are declared and carried together. A draft that names an asset
  without its bytes cannot be saved.
- The theme's background media is the host's existing video/image path; the
  MCP server does not build a second media pipeline.
- A saved theme remains the library's only persisted unit. Drafts are process
  memory and are lost if the server stops; `preview_theme` and `save_theme`
  are the checkpoints the skill uses.

## Error handling

- Host unreachable: every tool returns a clear connection message naming the
  probed ports and `YUNARI_URL`; the process stays connected for a later call.
- Invalid save: relay the host's status and validator issues with JSON paths.
- Existing theme without `confirmExisting`: refused with an explanation the
  skill turns into a user question.
- Unknown display, theme, asset, object id or semantic key: refused by name,
  never silently ignored.
- Asset too large, wrong type, missing bytes, unsupported video: refused before
  the draft or the library changes.
- Preview failure: no image, the host's sentence, and the saved theme left
  intact.

## Security and trust boundaries

- The MCP server binds nothing and exposes nothing on the network. It is a
  client of the loopback host, like the editor.
- Theme writes, asset imports and display assignment use the host's existing
  loopback-only routes. Credentials stay in the host and never appear in a tool
  result.
- Local-file import is limited to paths the user explicitly supplied, to known
  image/video/font extensions and to the store's byte caps. No directory walk
  and no arbitrary URL fetch in v1.
- A reference image is untrusted content: the skill says to treat text inside
  it as design material, not as instructions.
- The installer writes only the `yunari` entry through `add-mcp`, and only the
  `yunari-theme-designer` directory through the skills CLI. Uninstall removes
  exactly those.
- No delete-theme tool. Removal stays in the editor, where the OS trash and
  the library's confirmation already live.

## Testing

- `theme-kit`: unit tests prove the moved builders produce the same starter
  envelope, card copies allocate fresh ids and bindings, document helpers
  mutate only the draft, and asset declaration hashes/paths/licences correctly.
- Editor: existing starter, card-library, artboard and document tests pass
  after the moves; no visual or saved-bytes change.
- Host: panel geometry rows; `capturePreview` with the injected fake raster
  browser; the preview route's loopback, non-panel and invalid-theme refusals.
- MCP: a fake host HTTP server drives every tool's success and refusal paths;
  draft save/overwrite rules; browser preview URL/viewport; panel preview PNG;
  installer tests with a temporary home and injected `add-mcp`/`skills` ports.
- Skill: the folder and every reference resolve; `docs:check` passes.
- `npm run gate` exits 0 from `src/web/` without the network.

## Documentation

- `docs/decisions/0090-mcp-theme-authoring.md` records the mechanism decisions
  and the reuse evidence.
- `docs/architecture.md` gains the two packages and the MCP boundary.
- `docs/development.md` gains the install and local-run commands.
- `THIRD-PARTY-NOTICES.md` gains the MCP SDK, `add-mcp`, `skills` and any new
  runtime dependency.
