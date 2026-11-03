# 0100 — Stage both MCP-bearing packages from one build

- **Date:** 2026-11-03
- **Status:** accepted
- **Paths:** `scripts/stage-npm-package.mjs`, `scripts/check-workflows.mjs`

## Problem

The release must ship the MCP server and the theme-designer skill twice: inside
`yunari` and as a standalone `yunari-mcp`. A wrong integration publishes a
tarball that installs but cannot start, or two artifacts built from different
revisions.

## Rung 1 — internal owner

Searched: `stagePackage`, `RUNTIME_DEPENDENCIES`, `runtimeDependencies`,
`packages/mcp/vite.config.ts`, `.github/workflows/publish.yml`.
Found: `scripts/stage-npm-package.mjs` already copies a workspace-shaped tree
and writes a generated manifest pinned to lockfile versions; the MCP build
already bundles `@yunari/*` sources and leaves `@modelcontextprotocol/server`,
`add-mcp`, `skills`, `zod` and `culori` external. Both facts already answer the
two package shapes, so the work extends this script instead of adding a second
packaging mechanism.

## Rung 2 — installed dependencies

Searched: `packages/mcp/package.json`, `node_modules/add-mcp/dist/lib.d.ts`,
`node_modules/skills/dist/cli.mjs`.
Found: the MCP package's three workspace dependencies are aliases resolved at
build time, so they must not appear in the published manifest. `add-mcp` and
`skills` are ordinary runtime dependencies at exact versions.

## Rung 3 — native platform

Searched: `npm publish --help`, `npm pack --help`.
Found: npm can publish workspaces with `--workspaces`, but a private workspace
is skipped and the published tree would be the source tree, not the staged one.
npm offers no "publish this directory under another name with rewritten
dependencies" step; the generated manifest remains necessary.

## Rung 4 — public solutions

Searched: the npm CLI's own publish/pack option surface above; prior art in
this repository is the existing `yunari` staging script.
Found: the established pattern is one stage directory per published package,
each with a generated manifest, both written from one checkout so a version
cannot diverge.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Publish `@yunari/mcp` directly | Workspace deps and source paths leak | Manifest rewrite, dependency bundling | Rejected |
| `npm publish --workspaces` | Skips private packages | None of the tree is staged | Rejected |
| Second staging script | Duplicates refusals and version checks | Divergent rules | Rejected |
| Extend `stage-npm-package.mjs` with `--mcp-out` | Reuses every refusal and the lockfile pinning | One new pure function | Chosen |

## Rung 6 — smallest probe

The existing `src/web/tests/scripts/stage-npm-package.test.ts` drives
`stagePackage` against a fake tree and the CLI through `spawnSync`. The same
harness drives `stageMcpPackage` and the `--mcp-out` refusal, which is cheaper
than a real release run and proves the manifest content directly.

## Decision

Extend the existing staging script. `stageMcpPackage` shares `inside`,
empty-directory and version checks with `stagePackage`; the CLI stages the
bundle and, when `--mcp-out` is given, the standalone tree. Both manifests name
the same version and lockfile-pinned dependencies.

`scripts/check-workflows.mjs` allows `install` to define the staging variables
its steps use; the standalone tree adds `MCP_STAGE` and `MCP_SMOKE` beside the
existing `STAGE`, `ASSETS` and `SMOKE`, so the allowlist names all five rather
than exempting the new step.
