# MCP server and skill in the npm release

Date: 2026-11-03
Status: approved design, awaiting review before planning

## Problem

The MCP server (`@yunari/mcp`) and the `yunari-theme-designer` skill exist only
in the repository. The published `yunari` package stages the host, player,
editor, schema and vendor assets, but not `packages/mcp` or `skills/`. A person
who installs the released package therefore gets no agent integration, and the
only install path today is a checkout plus
`node src/web/packages/mcp/bin/yunari-mcp.js install`.

Two packaging defects follow from that:

- There is no standalone package for people who want the authoring tools
  without the desktop host.
- The installed server entry records `process.execPath`, which under fnm/nvm is
  a per-shell shim under a temp directory. A later session can find that
  interpreter missing while the server itself is intact (#408).

## Goals

- The `yunari` package contains the MCP server, its bin and the skill, and
  offers an opt-in install.
- A standalone `yunari-mcp` package offers the same server and skill without the
  host.
- One installer implementation, one version, two staged artifacts.
- The installed server survives a new shell, and drift between the installed
  skill and the packaged skill is reported rather than silent.
- Every interactive choice has a flag, so an agent or CI can install
  non-interactively.

## Non-goals

- No Windows installer or winget package.
- No per-tool approval subset beyond “all tools” or “none”.
- No automatic update mechanism; reinstalling is the update path.
- No change to the MCP tool surface or the skill's design rules.

## Package shape

The private workspace package `@yunari/mcp` remains the owner of the server and
the installer. Both published packages contain staged copies of the same build;
neither imports the other at run time.

### `yunari` (bundle)

The staged tree gains:

```
packages/mcp/bin/yunari-mcp.js
packages/mcp/dist/main.js
packages/mcp/dist/main.js.map
packages/mcp/skills/yunari-theme-designer/{SKILL.md,references/*.md}
```

The staged manifest gains:

- `bin.yunari-mcp = packages/mcp/bin/yunari-mcp.js` beside `bin.yunari`.
- MCP runtime dependencies unioned with the host's current five:
  `@modelcontextprotocol/server`, `add-mcp`, `skills`, `zod`, `culori`.
- The host dependencies `fflate`, `ffmpeg-static`, `node-forge`,
  `systeminformation` remain.

### `yunari-mcp` (standalone)

```
bin/yunari-mcp.js
dist/main.js
dist/main.js.map
skills/yunari-theme-designer/{SKILL.md,references/*.md}
package.json
LICENSE
THIRD-PARTY-NOTICES.md
```

The manifest is generated at stage time:

- `name: "yunari-mcp"`, `version` rewritten from `src/web/package.json`.
- `bin: { "yunari-mcp": "bin/yunari-mcp.js" }`, `type: "module"`,
  `engines: { node: ">=22" }`.
- Runtime dependencies: `@modelcontextprotocol/server`, `add-mcp`, `skills`,
  `zod`, `culori` — exact versions from the lockfile, as the host package does.
- No workspace dependencies; the MCP build already bundles
  `@yunari/renderer-core`, `@yunari/theme-kit` and `@yunari/theme-package`.

### Skill source resolution

`createPorts()` resolves the skill from `<packageDir>/skills/<name>` first, so
both packaged layouts are identical. A repository run falls back to the
checkout's `skills/<name>` when the package-local copy is absent. The staging
script copies the root skill into both packages. A packaged install therefore
never reads outside its own package.

## Versioning and release

- `release-please` keeps versioning `src/web` only; both packages take that one
  version and one `vX.Y.Z` tag.
- `scripts/stage-npm-package.mjs` gains a second target:
  `--out <bundle-dir> --mcp-out <standalone-dir>`. Staging one target alone
  remains supported for local smoke runs.
- The publish workflow packs both tarballs, verifies both contents, installs
  and smoke-tests both, then publishes both at the same dist-tag (`latest` or
  `next`). The first publish of each package is still owner-run.
- The skill has no independent version. `yunari-mcp status` reports the package
  version and whether the installed skill matches the bundled copy.

## Installer

Both `yunari mcp install` and `yunari-mcp install` run the same wizard in
`@yunari/mcp`. It uses Node's stdlib readline; no prompt dependency is added.

### Choices

1. **Agents** — default `claude-code`. The prompt shows the four common agents
   (Claude Code, Codex, Cursor, VS Code) and marks those whose
   `detectGlobalInstall()` answers true; “other” accepts any add-mcp agent id,
   and `--agent` repeats.
2. **Scope** — global (default) or the current project. Local writes the
   agent's project config in the current directory through add-mcp's own
   `local: true` path.
3. **Theme-designer skill** — install for the selected agents (default when an
   agent is selected), or skip. The skill is installed through the `skills` CLI
   with each selected agent id. Skill directories are agent-level, so this half
   is always a global copy, never a link; a local-scope install says so. There
   is no per-project skill copy.
4. **Auto-approve** — all tools (default) or none, per agent where add-mcp
   reports the capability. The installer passes `autoApproveTools`; it does not
   write permission files itself, and it reports fields an agent dropped.
5. **Host URL** — probe 5227–5236 now and pin the first answer; enter a URL; or
   leave the server to probe at each session.

The wizard prints a summary of every file it will write and asks for one
confirmation. Each half (server, skill) reports its own result; a partial
result is never printed as installed.

### Flags

`--agent <id>` (repeatable), `--scope global|local`, `--skill|--no-skill`,
`--auto-approve all|none`, `--url <url>`, `--yes`, `--json`.

- With `--yes`, every unspecified choice takes its default.
- Without a TTY and without `--yes`, the wizard prints the choices and exits 2
  instead of hanging.
- `--json` prints the report as one object; human output otherwise.

`uninstall` accepts the same agent/scope selectors and removes exactly what an
install with those selectors wrote. `status` stays read-only.

## Bundle CLI integration

The host launcher routes `yunari mcp <command> [flags]` to the bundled
`packages/mcp/bin/yunari-mcp.js` through `process.execPath`, forwarding
arguments and the exit code. It does not import the MCP module, so the host
bundle's imports stay unchanged.

The interactive `yunari` menu gains one row, “Agent tools (MCP)…”, which runs
`mcp install` / `mcp uninstall` / `mcp status` as a submenu. The row is present
in the bundled package only; a source checkout without the staged MCP files
omits it.

## Fragility fix (#408)

`serverEntryFor()` records:

- `command`: `realpathSync(process.execPath)` when that path exists, so an
  fnm/nvm shim resolves to the versioned interpreter directory. If the realpath
  cannot be read, the recorded path is left unchanged.
- `args`: the package's own `bin/yunari-mcp.js`, computed from the installed
  package location, never the path used to launch the installer.

`status` validates both the recorded command and the entry bin:

- both exist → present;
- either is missing → absent, with the repair (“re-run install”);
- the entry names a different package version than the running installer →
  reported as drift.

`status` also compares the installed skill's `SKILL.md` and references against
the bundled copy and reports “current”, “drifted” or “not installed”.

## Ownership

- `@yunari/mcp`: installer logic, wizard, entry resolution, status, the skill
  copy contract.
- `scripts/stage-npm-package.mjs`: package contents and generated manifests.
- `.github/workflows/publish.yml`: packing, smoke, publish order.
- Host launcher: command routing and the menu row only.

No new mechanism is added to the editor or player.

## Tests

- Stage: both trees contain the four MCP paths; the standalone manifest names
  the MCP dependencies and no workspace packages; the bundle manifest keeps its
  existing bins and dependencies.
- Installer (existing fake ports, plus an injected interpreter path): each
  agent/scope/skill/auto-approve combination, `--yes` defaults, non-TTY
  refusal, partial failure, uninstall symmetry, realpath interpreter, status
  drift states.
- Publish smoke: install each tarball in a clean directory, assert both bins
  answer `--help`, assert the registered entry's interpreter exists, run
  `status`.
- `npm run gate` covers the unit and script self-tests.

## Documentation

- `README.md` release section: `npm i -g yunari`, `yunari mcp install`;
  standalone `npm i -g yunari-mcp`.
- `docs/operations.md`: release now publishes two packages and smoke-tests
  both; reinstall is the update path.
- `skills/yunari-theme-designer/references/tool-guide.md`: install and status
  commands if they change a user-visible flow.

## Risks

- A global `yunari` install now brings the MCP runtime dependencies even when
  the person declines the install. The add-mcp and skills packages are small;
  the alternative is a second download step.
- Two tarballs must publish in the same run or the bundle's copied MCP and the
  standalone package can disagree. Version equality and the shared build
  directory are the guards.
- The first publish of `yunari-mcp` is manual, like the host package.
