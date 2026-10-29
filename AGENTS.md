# Yunari — agent guide

Yunari is a Windows-first hardware-monitoring dashboard. One Node host reads
this PC's sensors and serves three browser surfaces over local HTTP/HTTPS: a
display-only player, a desktop editor, and settings.

## Ownership and process

- **Orca is the runtime.** Do the work in the Orca worktree you were given. Do
  not switch to the primary checkout or rewrite another worktree's files.
- **Superpowers owns the lifecycle.** Brainstorm, spec, plan, execute and verify
  through the installed Superpowers skills. The active design and plan live in
  `docs/superpowers/specs/` and `docs/superpowers/plans/`.
- **GitHub Issues is the backlog.** Do not create a local backlog, decision log,
  evidence tree or task database in the repository. Repository docs describe
  current behaviour; history belongs in Git.
- **CodeGraph first.** If `.codegraph/` exists at the repository root, query it
  before grep or file reads for code questions: `codegraph explore "<symbols or
  question>"`, or the `codegraph_explore` MCP tool. Skip it when no index exists.

## Reuse before build

**Search before designing or writing a mechanism.** Yunari is a product, not a
reason to rebuild its platform. A problem that looks small has often already
cost another project its sampling, ordering, invalidation, disposal and ownership
design. Skipping that search causes rework, not speed.

A **mechanism boundary** is a place where a wrong integration fails quietly:
rendering, persistence, scheduling, hardware protocols, media, security or shared
lifecycle ownership. Before changing one, work all seven rungs and record the
evidence in `docs/decisions/NNNN-<slug>.md` **before implementation**:

1. **Internal owner.** Use CodeGraph and source to find the responsible module,
   its callers, existing helpers and prior art in this repo. Extend the owner;
   do not add a parallel mechanism.
2. **Installed dependencies.** Read the relevant dependency source, types and
   tests for behavior already donated, including lifecycle and edge cases.
3. **Native platform.** Check browser, Node, OS, database and runtime APIs.
   Native availability alone does not settle integration fitness.
4. **Public solutions.** Search current library docs, upstream source/issues,
   standards and comparable implementations for this problem shape under similar
   constraints. Record queries, sources and what each solution actually handles.
   Do not stop at a package-name list or the first plausible API.
5. **Integration comparison.** Compare candidates against Yunari's renderer,
   host, persistence, performance, security and ownership requirements. Name the
   unsolved parts; a library existing is not proof that the integration work is
   discharged.
6. **Smallest probe.** When behavior decides the design, run a disposable
   executable probe before committing to an adapter or custom implementation.
7. **Build or reuse decision.** Reuse the first option that fits correctly;
   otherwise implement the minimum behind the responsible seam. Record why the
   rejected options do not fit.

The note states current evidence and the decision, not a research diary. Keep it
with the change. Do not recreate a hook or a second decision register.

## Architecture guardrails

- **One owner per concept.** Before adding a type, key, default, action, route,
  helper, schema value, registry or persistence path, find its existing owner
  and consumers. The owner decides membership and invariants; consumers import
  and use them, never re-spell a subset. One owner must also be the *right*
  owner: place the rule at the responsible seam, not merely in one place.
- **Respect extension seams.** Add a provider, panel family, asset source or
  renderer capability through its existing contract and registry. Do not leak
  protocol-specific decisions into managers or UI. A new implementation should
  not force consumers to learn its internals.
- **Reuse must have consumers.** Creating a canonical module without moving
  callers leaves duplication intact. Delete the losing path.
- `renderer-core` stays Fabric/DOM-free. The player may use `scene-fabric`, never
  editor UI/managers or an interactive `Canvas`.
- Fabric JSON is the persisted scene. No second simplified scene tree or
  write-back model.
- Persist authored state only. Telemetry, built ECharts options, playback,
  selection and viewport state are runtime/derived/transient; raw ECharts options
  never enter persisted theme data.
- Providers acquire; the host owns scheduling, buffering, history and fallback.
  Missing or non-`ok` telemetry is never fabricated as zero/default data.
- Validate hostile or invalid input at its trust boundary. Refuse invalid numbers
  rather than coercing them to zero; reject unsafe package paths, unsupported
  versions and unbounded input before mutation.
- Pre-release internal architecture may break cleanly. Do not add compatibility
  glue solely to preserve a superseded internal design.

## Commands

Run every npm command from `src/web/`. The repository root has no
`package.json`.

```bash
cd src/web
npm install
npm run build          # player, editor and host bundles
npm run gate           # the one command that means green (offline)
npm test               # Vitest unit suites only
npm run typecheck
npm run test:e2e       # Playwright; build first
npm run test:display   # real host + phone rendering (slow)
npm run test:rebuild   # reference composition rebuilt by hand (slow)
npm run design:check   # DESIGN.md lint + CSS token sync + token ratchet
npm run docs:check     # every plans/ reference resolves
```

`npm run gate` runs Biome check, script self-tests, docs/scratch/third-party/
workflow/ffmpeg checks, design checks, typecheck, unit tests and the Worker
suite. It must exit 0 and must not need the network.

Node support is `>=22`; Vitest 5 accepts `^22.12 || ^24 || >=26`. CI pins Node
24. `@yunari/store-worker` deliberately nests Vitest 4 because
`@cloudflare/vitest-pool-workers` peers on `^4.1.0`; do not hoist or dedupe it.

## Non-obvious invariants

- **No fabricated telemetry.** A sensor key nobody measured stays absent with a
  stated reason. It is never written as zero, a dash or a placeholder.
  `@yunari/fake-source` is a development and test fixture; a shipped bundle
  containing it is fabricated telemetry.
- **Fabric ownership is one-way.** `renderer-core` imports no Fabric and no DOM.
  `scene-fabric` is the only shared layer that creates Fabric objects. The
  player uses `StaticCanvas`; only the editor constructs an interactive
  `Canvas`. Import Fabric from `fabric/es`, never the bare `fabric` entry.
- **The player never imports editor code.** `packages/player/src/boundaries.test.ts`
  enforces this, the `fabric/es` subpath and `StaticCanvas`. The gzip budget is
  enforced separately by `packages/player/scripts/check-size.mjs` (`npm run
  size`).
- **The theme envelope is the only scene model.** Fabric JSON is persisted
  inside Yunari's versioned envelope; there is no second document format.
  Current schema is `2.0.0`. Major `2` is read; an older document without a
  migration, or any newer major, is refused.
- **Credentials stay in the host.** Provider and store credentials live under
  the host's settings directory. They are never handed to a browser.
- **LAN access is opt-in.** The host binds `127.0.0.1` by default. The editor,
  settings page and pairing admin API are localhost-only even when the LAN is
  open.
- **`DESIGN.md` is normative for editor chrome.** Add a new control or token by
  changing `DESIGN.md` and `editor-shell.css` together, then run
  `npm run design:check`. The front matter's spacing, rounded and typography
  tokens are synchronised with the `@theme static` block in
  `packages/editor/src/editor-shell/editor-shell.css`.
- **Comments and docs state current invariants.** Explain a non-obvious rule and
  why it holds. Do not narrate tickets, commit history, abandoned designs or
  "we used to" chronology.

## Platform and tooling gotchas

- **Windows paths.** Resolve module-relative paths with `fileURLToPath`, not
  `URL.pathname` (the latter yields `/D:/...`). Resolve symlinks with
  `realpathSync` before comparing an entry point, and compare drive letters
  case-insensitively. Convert `path.relative` results to POSIX when emitting
  paths.
- **PowerShell quoting.** Backticks are PowerShell escapes; a shell regex that
  worked in Bash can be silently altered. Prefer single quotes, or run the
  command through the Bash tool when a pattern contains backticks.
- **Browser tests use built bundles.** Playwright starts `vite preview` (and the
  real host); `dist/` is gitignored, so `npm run build` must run first. Ports are
  fixed with `--strictPort`; each config and own-host spec owns its port, and
  shared host state runs with `workers: 1`.
- **The host needs its own build.** `packages/host/bin/yunari.js` imports
  `dist/main.js` and refuses to start without it. Build the host after changing
  it, before running the CLI or host specs.
- **Vite 8 uses Rolldown.** `build.rollupOptions.output.manualChunks` must be a
  function; the object form fails at build time.
- **Visual captures write PNGs.** Run them serially:
  `YUNARI_CAPTURE=1 npx playwright test --project=desktop-chromium --grep "<title>" --workers=1`.
  `YUNARI_CAPTURE_DIR` changes the output directory (default
  `test-results/captures`).
- **Adding a runtime dependency** means adding its notice to
  `THIRD-PARTY-NOTICES.md` in the same change. The host keeps its runtime
  dependency list deliberately small.

## Documentation map

- `DESIGN.md` — normative editor visual language and tokens.
- `docs/product.md` — what ships and the product invariants.
- `docs/architecture.md` — package boundaries and data flow.
- `docs/development.md` — local setup, tests and tooling detail.
- `docs/operations.md` — running, security, releases and store deployment.
