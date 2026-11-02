# 0090 — MCP theme authoring and agent skill installation

- **Date:** 2026-11-03
- **Status:** accepted
- **Paths:**
  `src/web/packages/host/src/panels/panel-device.ts`
  `src/web/packages/host/src/panels/panel-families.ts`
  `src/web/packages/host/src/panels/panel-manager.ts`
  `src/web/packages/host/src/panels/turzx-panel.ts`
  `src/web/packages/host/src/panels/tur-usb-panel.ts`
  `src/web/packages/host/src/panels/kraken-z3-panel.ts`

## Problem

An external agent must read and author Yunari themes through one MCP server,
and a skill must teach the agent how to design them. A wrong integration fails
quietly in four places: a second scene or theme store, a second renderer for
previews, a hand-rolled agent-config writer, or a preview that claims a panel's
output without the panel's own page. The host's loopback HTTP API, the editor's
pure authoring builders and the panel rasterizer already own those mechanisms.

## Rung 1 — internal owner

Searched: CodeGraph for theme routes, theme store, asset finder, card library,
panel raster browser and display model; read `server/themes-routes.ts`,
`server/theme-writes.ts`, `themes/store.ts`, `themes/wire.ts`,
`assets/routes.ts`, `assets/sources.ts`, `panels/panel-manager.ts`,
`panels/panel-raster-browser.ts`, `panels/panel-raster.ts`,
`editor/card-library.ts`, `editor/new-fabric-theme*.ts`,
`editor/artboard-presets.ts`, `editor/editor-document.ts`.

Found:

- The host already owns theme read (`GET /api/themes/:id`), save
  (`PUT /api/themes/:id`), assets, sensors, displays, active theme and panel
  rendering. A second transport would duplicate these.
- The editor's card, object, starter, token and artboard builders are pure
  data functions except `insertCard` (canvas/history) and
  `new-object-defaults` (constructs Fabric objects).
- `PanelManager` owns the one Chromium runtime and builds a panel page from
  `pageFor(displayId, clip)`; `createPageRasterizer` already captures a still.
  Panel geometry is owned by each driver family, not by the display record.
- No package exports a Node-safe authoring vocabulary. The MCP server cannot
  import the editor without dragging React/DOM and editor managers into Node.

Unsolved: a shared pure authoring package, a panel preview capture, and an
agent-facing tool layer.

## Rung 2 — installed dependencies

Searched: `@yunari/renderer-core` envelope validation, scene planning and
semantic keys; `@yunari/scene-fabric` persisted property names and traversal;
`@yunari/theme-package` declared-asset and credit rules; `@modelcontextprotocol/sdk`
and its v2 split; `add-mcp` source; `skills` CLI source.

Found:

- `renderer-core` is Fabric/DOM-free and owns the envelope types, validation,
  semantic keys and artboard transform. It is safe in Node.
- `scene-fabric` owns the `yunariAsset`/`yunariPaint`/`yunariText` property
  names and scene traversal; theme-kit may import it for those constants.
- `theme-package` already owns asset-map/declaration checks and credits.
- MCP TypeScript SDK v2 ships `@modelcontextprotocol/server` (Node ≥20,
  zod ^4.2) with `McpServer`, `StdioServerTransport` and mixed text/image
  content. The host's zod override is 4.6.6.
- `add-mcp` 2.4.1 exports `upsertServer(agent, name, config, options)` and
  `removeServer`; Claude Code's global path is `~/.claude.json`, and it
  supports auto-approval rules.
- Vercel `skills` 1.7.4 installs from a local directory with
  `-g -a claude-code --copy -y`; its global canonical directory is
  `~/.agents/skills`, and it has `remove`. It requires Node ≥22.20; the
  workspace needs Node ≥22.22.2 for its DOM suite and CI pins 24.

Unsolved: neither library installs both an MCP server and a skill; no library
previews a Yunari panel page.

## Rung 3 — native platform

Searched: Node stdio, `fetch`, `node:crypto`, `node:child_process`, Chromium
devtools protocol, the player page and panel page.

Found:

- Node provides stdio JSON-RPC transport, loopback fetch and SHA-256; it does
  not provide MCP framing, agent config formats or skill discovery.
- Chromium via CDP can render the real player page and capture a PNG; the host
  already drives it without a second browser download.
- The player accepts `?theme=<id>` and the panel page accepts
  `?display=<id>&panel=1`, so a browser preview and a panel preview both read
  the product's own renderer.

Unsolved: the agent's own browser cannot reproduce the panel clip/overlay
pipeline, so panels need the host's capture.

## Rung 4 — public solutions

Searched (2026-11-03):

- `neon-solutions/add-mcp` README, source `src/lib.ts` and `src/installer.ts`:
  24 agents, per-agent config shapes, global/project scope, `upsertServer`,
  `removeServer`, auto-approval.
- `vercel-labs/skills` README and `docs/commands.md`: local path sources,
  global install, agent selection, `--copy`, `remove`, `~/.agents/skills`.
- `echohello-dev/skillet` README and `docs/usage.md`: local paths, global
  install, lockfile, skills only.
- `artisan-build/hitch`, `am-will/everymcp`, `RodrigoTomeES/getmcp`,
  `jtianling/mcps-manager`, `IrfanSadiqRahat/mcpx`: MCP installers with
  different breadth; only `mcpx` claims both MCP and skills, and it is young.
- `modelcontextprotocol/typescript-sdk` v2 docs: `@modelcontextprotocol/server`,
  stdio transport, image content, zod 4.

Found: no maintained, comprehensive tool covers MCP registration and skill
installation together. `add-mcp` is the strongest MCP-config owner;
`skills` is the strongest skill-directory owner.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Hand-rolled Claude config + skill copy | One agent, no extra deps | Must track `~/.claude.json`, permissions, skill paths; duplicates two maintained tools | Rejected |
| `add-mcp` + `skills` | MCP registration across agents and skill install/remove; offline after install | Two dependencies, notices; verify the skill lands in `~/.agents/skills` | **Chosen** |
| `hitch` | MCP only, credential-focused, pre-release | Skills out of scope | Rejected |
| `everymcp` / `getmcp` / `mcpsmgr` | MCP only, early projects | Skills out of scope; smaller evidence | Rejected |
| `mcpx` | MCP + skills in one CLI | One issue, unproven maintenance; unsuitable as the installer owner | Rejected |
| Host-side Chromium vs MCP-side Chromium | Host already owns one runtime and the panel page | None | **Host capture for panels** |
| MCP-side Playwright for all previews | Second browser lifecycle; cannot see panel clip/overlay | Panel fidelity | Rejected |
| Browser-only preview | Agent uses its own browser at the exact ratio; no host code | Panel page differs | **Chosen for browser displays** |

## Rung 6 — smallest probe

Executed during implementation before the installer is written:

- `node` probe of `add-mcp`'s `upsertServer`/`removeServer` against a temporary
  home, verifying the Claude Code global entry and its removal.
- `node` probe of the `skills` CLI against a temporary home with a local skill
  directory, verifying the installed path is
  `~/.agents/skills/yunari-theme-designer/SKILL.md` and that removal removes it.
- An MCP stdio handshake with the v2 server proving `initialize`, `tools/list`
  and one tool call complete without a host.

If a probe fails, the design falls back to the library's documented API only
after recording the failure here; no second hand-rolled installer is added
silently.

## Decision

Build `@yunari/theme-kit` as the one pure authoring vocabulary shared by the
editor and the MCP server; build `@yunari/mcp` as a stdio client of the existing
loopback host; extend the panel family rows with their fixed geometry and the
panel manager with a preview capture that reuses the shared rasterizer; install
the server with `add-mcp` and the skill with the Vercel `skills` CLI into
`~/.agents/skills/`. Rejected alternatives either duplicated a theme, renderer
or installer mechanism, or could not represent a panel's real output.
