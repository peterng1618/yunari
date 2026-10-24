# Release Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Yunari's first release with a clean install, one semantic product version, a semantic theme-schema version with N−1 migration, a failing audit policy, and a repeatable GitHub Release + npm publish pipeline; rewrite the README to describe the product as it is.

**Architecture:** The product version stays in `src/web/package.json` and release-please moves it. The schema version becomes a semver string with a migration dispatcher in `renderer-core`, and every open path reads through it while write paths stay strict. Dependency findings are fixed by upgrade or override where a suite proves the override, and every residual finding is named in an audit allowlist that fails both ways. A staged npm package mirrors the workspace layout, so no production path changes are needed. Winget is documented and deferred.

**Tech Stack:** TypeScript, npm workspaces, Vitest, Vite 8, Node 22+, release-please, npm trusted publishing, GitHub Actions.

**Spec:** [`docs/superpowers/specs/2026-10-25-release-readiness-design.md`](../specs/2026-10-25-release-readiness-design.md)

## Global Constraints

- Run all npm commands from `src/web/`; Node 22.12+, 24 or 26+; `npm run gate` must exit 0.
- `renderer-core` stays Fabric/DOM-free. The player never imports editor code.
- Schema format changes are **major**; minor and patch describe the artifact only.
- The product version has one owner: `src/web/package.json` `version`.
- Do not edit `AGENTS.md`; the user has not authorized it.
- No new runtime dependency. New dev dependencies need a named reason.
- Exact upgrades: `vite` `8.3.5`, `vitest` `5.0.5`.
- Conventional Commit titles; stage explicit paths, never `git add -A`.
- One active plan. Task A1 makes this plan active in `STATUS.md`.
- A write to a watched path needs a decision note claiming that exact file. Task A1 supplies notes 0110 and 0111.
- Do not publish to npm or create a GitHub Release until Task C3's dry run passes and the user has configured the npm trusted publisher.
- Every override is kept only if its suite passes; a failing override is removed and its finding is allowlisted with the failure recorded.

## Review Focus

1. **Every theme already on disk carries `"schemaVersion": 2` (a number).** The read path must normalise it to `"2.0.0"`, not refuse it; any other integer must be refused. The strict write path still refuses integers.
2. **Every document builder must write `"2.0.0"`.** A missed literal in `new-fabric-theme.ts`, `item-fixture.ts`, `persist.ts` or the Worker fixtures is caught by typecheck; a missed JSON fixture is not.
3. **Version comparison must be numeric.** `"10.0.0"` is newer than `"2.0.0"`; a string compare reads it as older.
4. **An override must not change what the Worker or fabric DOM tests actually run.** Prove with `npm ls` and the suites, not with `npm audit`.
5. **The staged package must work with no repository present.** `productVersion()`, `packagesDir`, the bin shim and the admin pages all resolve inside the tarball.

---

## Phase A — Version contracts

### Task A1: Decision notes and active-plan registration

**Files:**
- Create: `docs/decisions/0110-a-previous-schema-major-is-migrated-on-open.md`
- Create: `docs/decisions/0111-release-scripts-stage-the-workspace.md`
- Modify: `STATUS.md`

**Interfaces:**
- Produces: reuse-gate claims for
  `src/web/packages/renderer-core/src/theme/fabric-envelope.ts`,
  `src/web/packages/renderer-core/src/theme/fabric-envelope-validate.ts`,
  `src/web/packages/renderer-core/src/theme/migrations.ts`,
  `src/web/packages/host/src/server.ts`,
  `scripts/audit-policy.mjs`, `scripts/stage-npm-package.mjs`.

- [ ] **Step 1: Run the rung searches for 0110**

Search and record the result of each, including empty rungs:

1. Yunari: `rg -n "schemaVersion|migrat|upcast" docs src/web/packages` and read decisions 0017, 0022, 0041.
2. Dependencies: `rg -n "ajv|json-schema" src/web/**/package.json` — expect nothing.
3. Platform: JSON Schema cannot dispatch versions; the validator refuses (`fabric-envelope-validate.ts`).
4. Ecosystem: upcaster chains, dual readers, write-forward; record that 0017/0022/0041 rejected migration before release.
5. Comparison: delete-only vs dispatcher vs dual reader, with the release-boundary reason for choosing the dispatcher.
6. Probe: a temporary script outside the repo runs a synthetic 1→2→3 chain and measures it, and normalises a legacy integer `2` to `"2.0.0"`; record both results.
7. Build: the task list in this plan.

Write the note with `- **Paths:**` naming the four exact files. A directory claim covers nothing (`covers` requires equality).

- [ ] **Step 2: Run the rung searches for 0111**

1. Yunari: read `packages/host/bin/yunari.js`, `packages/host/vite.config.ts`, `packages/host/src/main.ts` (`packagesDir`, `productVersion`), and the workspace manifests.
2. Dependencies: `npm pack`, `npm publish`, workspace layout; no packaging dependency exists.
3. Platform: npm pack/publish, GitHub Release assets, trusted publishing OIDC.
4. Ecosystem: release-please vs semantic-release vs changesets; winstall/pnpm winget manifest as the portable-zip shape.
5. Comparison: separate publish package vs releasing `@yunari/host` as-is vs staging a workspace-shaped package; choose staging.
6. Probe: copy the four bundle paths into a temp directory, `npm pack`, install into another temp directory, run `yunari --version`, record the output.
7. Build: this plan's Phase C.

Write the note with `- **Paths:**` naming `scripts/audit-policy.mjs` and `scripts/stage-npm-package.mjs`.

- [ ] **Step 3: Register the plan**

Replace `STATUS.md`'s current objective with this plan and spec link, keep the bullet limits (5/5/5/5), and run:

Run: `npm run status:check` from `src/web/`
Expected: exit 0.

- [ ] **Step 4: Verify the gate accepts the claims**

Run: `node scripts/reuse-gate.mjs --self-test`
Expected: exit 0, all self-test cases pass.

- [ ] **Step 5: Commit**

```bash
git add docs/decisions/0110-a-previous-schema-major-is-migrated-on-open.md docs/decisions/0111-release-scripts-stage-the-workspace.md STATUS.md
git commit -m "docs(release): record the migration and staging decisions"
```

---

### Task A2: Schema version becomes semver

**Files:**
- Modify: `src/web/packages/renderer-core/src/theme/fabric-envelope.ts`
- Modify: `src/web/packages/renderer-core/src/theme/fabric-envelope-validate.ts`
- Modify: `src/web/packages/editor/src/new-fabric-theme.ts`
- Modify: `src/web/packages/editor/src/store-mode/item-fixture.ts`
- Modify: `schema/theme-document.schema.json`
- Modify: `src/web/packages/renderer-core/src/theme/fabric-envelope-schema-sync.test.ts`
- Modify: `src/web/packages/renderer-core/src/theme/fabric-envelope-validate.test.ts`
- Modify: `src/web/packages/store-worker/tests/{helpers,seed,versions.spec}.ts`
- Test: `src/web/packages/renderer-core/src/theme/fabric-envelope-version.test.ts`

**Interfaces:**
- Produces: `SUPPORTED_SCHEMA_VERSION = "2.0.0"` (literal type), `SUPPORTED_SCHEMA_MAJOR: number`, `parseSchemaMajor(value: unknown): number | undefined`.
- `FabricThemeEnvelope.schemaVersion` becomes `typeof SUPPORTED_SCHEMA_VERSION`.

- [ ] **Step 1: Write the failing test**

`fabric-envelope-version.test.ts` cases:

- accepts a minimal envelope with `schemaVersion: "2.0.0"`;
- accepts `"2.4.9"` (same major);
- refuses `2` (number) with a message naming `major.minor.patch`;
- refuses `"2"` and `"2.0"`;
- refuses `"3.0.0"` as newer;
- refuses `"1.0.0"` as unsupported;
- `parseSchemaMajor("10.0.0")` returns `10`, proving numeric comparison.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run packages/renderer-core/src/theme/fabric-envelope-version.test.ts`
Expected: FAIL — strings are refused as `missing-field`.

- [ ] **Step 3: Implement**

- `fabric-envelope.ts`: export the three facts above; keep `schemaVersion` pinned to the literal.
- `fabric-envelope-validate.ts`: replace the integer check with a semver-string check; compare majors with `parseSchemaMajor`; keep the existing newer/unsupported sentences, substituting the full version.
- `new-fabric-theme.ts`, `item-fixture.ts`: import the constant instead of the literal `2`.
- `scene-fabric/src/persist.ts` already reads the constant; confirm no literal remains.
- `schema/theme-document.schema.json`: `$id` → `…/theme-document/2.0.0.json`, `schemaVersion` → `{ "const": "2.0.0" }`.
- Worker test fixtures use `"2.0.0"`.

- [ ] **Step 4: Update the affected existing tests and run them**

Run: `npx vitest run packages/renderer-core/src/theme packages/editor/src packages/store-worker`
Expected: PASS, including the schema-sync test reading the new `const`.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0. Every remaining `schemaVersion: 2` is a type error.

- [ ] **Step 6: Commit**

```bash
git add schema/theme-document.schema.json src/web/packages/renderer-core/src/theme src/web/packages/editor/src/new-fabric-theme.ts src/web/packages/editor/src/store-mode/item-fixture.ts src/web/packages/store-worker/tests
git commit -m "feat(schema): make the theme schema version semantic"
```

---

### Task A3: Migration dispatcher and the reader

**Files:**
- Create: `src/web/packages/renderer-core/src/theme/migrations.ts`
- Create: `src/web/packages/renderer-core/src/theme/migrations.test.ts`
- Modify: `src/web/packages/renderer-core/src/theme/fabric-envelope-validate.ts`
- Modify: `src/web/packages/renderer-core/src/index.ts`

**Interfaces:**
- Produces:
  - `type EnvelopeMigration = (input: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>`
  - `MIN_SUPPORTED_SCHEMA_MAJOR: number`
  - `SCHEMA_MIGRATIONS: Readonly<Record<number, EnvelopeMigration>>` (empty at 2.0.0)
  - `runSchemaMigrations(document, fromMajor, toMajor, migrations): MigrationResult`
  - `migrateFabricThemeEnvelope(input, migrations?): MigrationResult`
  - `readFabricThemeEnvelope(input, options?): FabricEnvelopeValidationResult`
- `MigrationResult` is `{ ok: true, document, fromMajor } | { ok: false, issue: ValidationIssue }`.

- [ ] **Step 1: Write the failing tests**

`migrations.test.ts` cases:

- `runSchemaMigrations` applies a synthetic 1→2 then 2→3 chain in order;
- a missing step refuses without returning a partial document;
- a migration that fails to set the target major is refused;
- a non-object input is refused with the existing parser sentence;
- a legacy integer equal to the current major (`2`) normalises to `"2.0.0"`; an integer `3` is refused;
- `migrateFabricThemeEnvelope` returns a current document unchanged;
- it refuses a newer major and a major below `MIN_SUPPORTED_SCHEMA_MAJOR`;
- `readFabricThemeEnvelope` accepts a current document and a legacy integer `2`, and returns the validator's refusal for an unsupported one;
- invariant: `MIN_SUPPORTED_SCHEMA_MAJOR === Math.max(2, SUPPORTED_SCHEMA_MAJOR - 1)` and every major from `MIN_SUPPORTED_SCHEMA_MAJOR` to `SUPPORTED_SCHEMA_MAJOR - 1` has a migration.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run packages/renderer-core/src/theme/migrations.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `migrations.ts`**

The dispatcher reads `schemaVersion`. A legacy integer equal to the current major is rewritten to `SUPPORTED_SCHEMA_VERSION`; any other integer, a non-string, or a non-semver value is refused through the same sentence the validator uses. It then compares majors numerically, chains `SCHEMA_MIGRATIONS` upward, and verifies the result's major before returning. No migration writes; no validation happens here.

- [ ] **Step 4: Implement `readFabricThemeEnvelope`**

In `fabric-envelope-validate.ts`: migrate, convert a migration failure to its issue list, then call `validateFabricThemeEnvelope`. Keep `validateFabricThemeEnvelope` strict so write paths cannot smuggle an old document. Export both from `index.ts`.

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run packages/renderer-core/src/theme/migrations.test.ts && npm run typecheck`
Expected: PASS and exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/web/packages/renderer-core/src/theme/migrations.ts src/web/packages/renderer-core/src/theme/migrations.test.ts src/web/packages/renderer-core/src/theme/fabric-envelope-validate.ts src/web/packages/renderer-core/src/index.ts
git commit -m "feat(schema): migrate the previous schema major on read"
```

---

### Task A4: Route open paths through the reader

**Files:**
- Modify: `src/web/packages/editor/src/editor-shell.ts` (`mountEditorShell`)
- Modify: `src/web/packages/host/src/themes/store.ts` (`readStored`)
- Modify: `src/web/packages/player/src/theme-loader.ts`
- Modify: `src/web/packages/host/src/catalogue/build-index.ts`
- Modify: `src/web/packages/theme-package/src/index.ts` (`parseThemePackage`)
- Modify: `src/web/packages/host/src/server.ts` (publish route)
- Test: the nearest existing suite for each reader, plus `src/web/packages/host/src/themes/store.test.ts`

**Interfaces:**
- Consumes: `readFabricThemeEnvelope`, `validateFabricThemeEnvelope` from Task A3.
- Rule: **open/read paths migrate; write paths stay strict.** Publish migrates and then publishes the migrated envelope.

- [ ] **Step 1: Classify every call site**

Confirm the split and record it in the commit message:

- migrate: `mountEditorShell` in `editor-shell.ts`, `readStored` in `themes/store.ts`, `theme-loader.ts`'s response reader, both `build-index.ts` readers, the package reader in `theme-package/src/index.ts`, and the publish route in `server.ts` (publish the migrated envelope);
- strict: the editor's `snapshot`, the save guard in `themes/store.ts`, the package builder in `theme-package/src/index.ts`, and `requestVersion` in `store-worker/src/routes/me.ts`.

If a call site does not fit, stop and report rather than forcing it.

- [ ] **Step 2: Write failing reader tests**

For each changed reader, add cases to its existing suite:

- a current `"2.0.0"` document still succeeds;
- a legacy integer `2` document succeeds and is returned as `"2.0.0"`;
- a `"1.0.0"` document is refused today with the unsupported sentence (no migration exists yet);
- a `"3.0.0"` document is refused as newer;
- publish returns the migrated envelope rather than the raw input (a spy or a legacy-integer document is enough).

- [ ] **Step 3: Run and confirm failure**

Run: `npx vitest run packages/host/src/themes/store.test.ts packages/player/src packages/host/src/catalogue`
Expected: FAIL on the new cases that assert the routed behaviour.

- [ ] **Step 4: Implement the routing**

Replace imports and calls as classified. In the publish route, use the returned `envelope` for the published bytes. Do not change save, snapshot, package-write or upload validation.

- [ ] **Step 5: Run the affected suites**

Run: `npx vitest run packages/host packages/player packages/editor packages/theme-package packages/store-worker`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/packages/editor/src/editor-shell.ts src/web/packages/host/src/themes/store.ts src/web/packages/player/src/theme-loader.ts src/web/packages/host/src/catalogue/build-index.ts src/web/packages/theme-package/src/index.ts src/web/packages/host/src/server.ts
git commit -m "feat(schema): migrate persisted themes when they are opened"
```

---

## Phase B — Dependency hygiene

### Task B1: Upgrade Vite and Vitest

**Files:**
- Modify: `src/web/package.json`
- Modify: `src/web/package-lock.json` (through `npm install`)

**Interfaces:** none.

- [ ] **Step 1: Change the two versions**

`vite` → `8.3.5`, `vitest` → `5.0.5`. Change nothing else.

- [ ] **Step 2: Regenerate the lockfile**

Run: `npm install` from `src/web/`
Expected: exit 0, lockfile updated.

- [ ] **Step 3: Run the gate**

Run: `npm run gate`
Expected: exit 0. If a suite fails, read the failure before touching anything else.

- [ ] **Step 4: Confirm the findings are gone**

Run: `npm audit --json` and inspect that `vite` and `vitest` no longer appear.
Expected: neither package in `vulnerabilities`.

- [ ] **Step 5: Commit**

```bash
git add src/web/package.json src/web/package-lock.json
git commit -m "fix(deps): upgrade vite and vitest past their advisories"
```

---

### Task B2: Override the fixable transitive findings

**Files:**
- Modify: `src/web/package.json` (`overrides`)
- Modify: `docs/engineering/dependencies.md`
- Modify: `src/web/package-lock.json` (through `npm install`)

**Interfaces:** none.

- [ ] **Step 1: Add the overrides**

```json
"overrides": {
  "undici": "^7.30.1",
  "sharp": "^0.35.5",
  "jsdom": "^30.1.3"
}
```

- [ ] **Step 2: Install and prove what actually resolved**

Run: `npm install && npm ls undici sharp jsdom`
Expected: the overridden versions appear in the Cloudflare and jsdom trees; no `invalid` marker.

- [ ] **Step 3: Run the suites each override can break**

Run: `npm run test:worker`
Expected: PASS. If it fails, remove the `undici` and/or `sharp` override, re-install, and record the failure in `dependencies.md`.

Run: `npx vitest run packages/renderer-core packages/scene-fabric packages/editor`
Expected: PASS with the jsdom override. If fabric's DOM tests fail, remove the jsdom override, re-install, and record that `whatwg-encoding` stays.

- [ ] **Step 4: Run the gate**

Run: `npm run gate`
Expected: exit 0.

- [ ] **Step 5: Record the measured result**

In `docs/engineering/dependencies.md`, add a short table: override, version, suite that proved it, and every accepted finding that remains with its reason (node-forge → ADR 0070; `@google/design.md` zod v3; `canvas` → `prebuild-install` deprecation).

- [ ] **Step 6: Commit**

```bash
git add src/web/package.json src/web/package-lock.json docs/engineering/dependencies.md
git commit -m "fix(deps): override the fixable transitive advisories"
```

---

### Task B3: Audit policy that fails closed

**Files:**
- Create: `scripts/audit-policy.mjs`
- Create: `docs/engineering/audit-allowlist.json`
- Create: `src/web/tests/scripts/audit-policy.test.ts`
- Modify: `src/web/package.json` (`audit:check`, `gates:self-test`)
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- CLI: `node scripts/audit-policy.mjs [--report <file>] [--allowlist <file>]`, exit 0 clean, 1 finding, 2 unreadable input.
- Pure export: `evaluateAuditReport(report, allowlist): { ok: boolean, unmatched: Finding[], stale: AllowEntry[] }`.

- [ ] **Step 1: Write the failing test**

`audit-policy.test.ts` cases:

- a finding outside the allowlist fails;
- an allowlisted `(package, advisory)` passes;
- an allowlist entry matching nothing is reported stale and fails;
- a `via` string entry is matched against the dependency it names;
- an unreadable report exits 2;
- `--self-test` prints and exits 0 over its built-in cases.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/scripts/audit-policy.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the script and allowlist**

Read `npm audit --json` unless `--report` is given. Match each vulnerability's `via` entries by package and GHSA id (or `"*"` for all advisories of one package). Fail on unmatched findings and on stale entries. Every allowlist entry carries `package`, `advisory`, `reason`, `reviewed`.

- [ ] **Step 4: Populate the allowlist from a measured audit**

Run: `npm audit --json` and list what remains after B1 and B2. Allow only those findings, with their measured advisory ids and reasons. Do not copy the spec's list without re-measuring.

- [ ] **Step 5: Run the policy and the self-test**

Run: `node ../../scripts/audit-policy.mjs` from `src/web/`
Expected: exit 0.

Run: `node ../../scripts/audit-policy.mjs --self-test`
Expected: exit 0.

- [ ] **Step 6: Wire it**

Add `"audit:check": "node ../../scripts/audit-policy.mjs"` and append
`node ../../scripts/audit-policy.mjs --self-test` to `gates:self-test`.
Add an `audit` job to `ci.yml`: checkout, Node 24, `npm ci`, `node ../../scripts/audit-policy.mjs` from `src/web`. It is its own job, not part of `npm run gate`, because the gate must run offline.

- [ ] **Step 7: Commit**

```bash
git add scripts/audit-policy.mjs docs/engineering/audit-allowlist.json src/web/tests/scripts/audit-policy.test.ts src/web/package.json .github/workflows/ci.yml
git commit -m "feat(release): fail CI on an unallowlisted dependency finding"
```

---

## Phase C — Release pipeline

### Task C1: Stage the npm package

**Files:**
- Create: `scripts/stage-npm-package.mjs`
- Create: `src/web/tests/scripts/stage-npm-package.test.ts`

**Interfaces:**
- CLI: `node scripts/stage-npm-package.mjs --out <dir> [--expect-version <version>]`.
- Output manifest: name `yunari`, version from `src/web/package.json`, `bin: { "yunari": "packages/host/bin/yunari.js" }`, `type: module`, `engines.node: ">=22"`, `license: MIT`, runtime dependencies `ffmpeg-static`, `node-forge`, `systeminformation`.
- Copy: `LICENSE`, `THIRD-PARTY-NOTICES.md`, `packages/host/{bin,dist,public}`, `packages/player/dist`, `packages/editor/dist`, `schema/`.

- [ ] **Step 1: Write the failing test**

`stage-npm-package.test.ts` builds a fake source tree in a temp directory with the required paths, runs the staging function against it, and asserts:

- every required path is copied;
- the manifest version equals the source manifest's;
- `--expect-version` mismatch exits non-zero;
- a missing `host/dist/main.js` exits non-zero and names it;
- the staged `bin` target exists and its `../dist/main.js` resolves.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/scripts/stage-npm-package.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Factor a pure `stagePackage({ source, out, version }): Result` for the test, and a CLI wrapper that reads the real tree. Refuse to write inside the repo; the output directory must be outside it.

- [ ] **Step 4: Prove the real package end to end**

From `src/web/`, build the three bundles, then isolate: `npx vite build packages/player`, `npx vite build packages/editor`, `npx vite build packages/host`.

Run: `node scripts/stage-npm-package.mjs --out <a new directory outside the repo> --expect-version 0.1.0`
Then in that directory: `npm pack`.
Then in a fresh temp directory: `npm init -y`, `npm install <tarball>`, `./node_modules/.bin/yunari --version`.
Expected: prints `0.1.0`, exit 0.

- [ ] **Step 5: Boot the installed host**

Run the installed binary with `--no-browser -p 4321`, then fetch `/api/health`, `/editor` and `/`. Expected: all answer; stop the process.

- [ ] **Step 6: Commit**

```bash
git add scripts/stage-npm-package.mjs src/web/tests/scripts/stage-npm-package.test.ts
git commit -m "feat(release): stage the workspace as the yunari npm package"
```

---

### Task C2: release-please

**Files:**
- Create: `release-please-config.json`
- Create: `.release-please-manifest.json`
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Config: one package at `src/web`, `release-type: node`, `package-name: yunari`, `include-component-in-tag: false`.
- Manifest: `{ "src/web": "0.1.0" }`.

- [ ] **Step 1: Verify the current action contract**

Read the release-please documentation or its repository README (Context7 or the action's own README) and confirm: action major version, config/manifest filenames, the `node` release type's lockfile handling, and the tag shape produced with `include-component-in-tag: false`. Record the checked version in a comment in the workflow. If a fact cannot be verified, stop and report.

- [ ] **Step 2: Add the three files**

Workflow triggers on `push` to `main`, permissions `contents: write` and `pull-requests: write`, and uses the verified action version. No other package is listed.

- [ ] **Step 3: Verify the files parse**

Run: `node -e "JSON.parse(require('node:fs').readFileSync('release-please-config.json','utf8')); JSON.parse(require('node:fs').readFileSync('.release-please-manifest.json','utf8'))"`
Expected: exit 0.

- [ ] **Step 4: Prove the first release PR touches only the intended files**

When the workflow first runs, inspect the release PR: it must change `src/web/package.json`, `src/web/package-lock.json` if the action updates it, and `src/web/CHANGELOG.md`. Any other path is a configuration defect — stop and fix it.

Then confirm both readers still follow the manifest:

Run: `node packages/host/bin/yunari.js --version`
Expected: prints exactly `src/web/package.json`'s `version`. The editor's About row is already pinned to `__YUNARI_VERSION__` by `settings.dom.test.tsx`, and `vitest.config.ts` reads that value from the same manifest.

- [ ] **Step 5: Commit**

```bash
git add release-please-config.json .release-please-manifest.json .github/workflows/release.yml
git commit -m "ci(release): open release PRs from conventional commits"
```

---

### Task C3: Publish workflow

**Files:**
- Create: `.github/workflows/publish.yml`

**Interfaces:**
- Triggers: `release: types: [published]` and `workflow_dispatch` with `dry_run` default `true`.
- Permissions: `contents: write`, `id-token: write`.
- Steps: checkout (depth 0, the gate needs history), Node 24, `npm ci`, `npm run gate`, build player/editor/host, stage with `--expect-version "${GITHUB_REF_NAME#v}"`, `npm pack`, install-and-smoke in a temp directory, `npm publish --provenance --access public --tag latest` (or `--tag next` for a prerelease; `--dry-run` when `dry_run`), then upload the tarball and a zip of the staged directory to the Release with `gh release upload`.

- [ ] **Step 1: Write the workflow**

Use the staged directory as the publish root. The smoke step installs the tarball, runs `yunari --version`, starts the host on a fixed high port with `--no-browser`, curls `/api/health`, `/editor` and `/`, and kills it. Fail on any non-200.

- [ ] **Step 2: Verify the workflow with a dry run**

Dispatch with `dry_run: true` on the release tag. Expected: gate green, package staged, tarball installs, host boots, `npm publish --dry-run` succeeds, no asset uploaded. Record the run URL.

- [ ] **Step 3: Configure the trusted publisher (user action)**

Record in the release documentation: the npm package owner must configure the trusted publisher for `peterng1618/yunari`, workflow `publish.yml`. If OIDC is unavailable, create an `NPM_TOKEN` secret as the fallback and say so in the runbook. Do not add a token to the workflow until it is needed.

- [ ] **Step 4: Inspect the dry-run tarball**

Run `npm pack --dry-run` in the staged directory and record the file count and size. Confirm the tarball contains `packages/host/dist/main.js`, both other bundles, the admin pages, `LICENSE` and `THIRD-PARTY-NOTICES.md`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/publish.yml
git commit -m "ci(release): publish the staged package and attach release assets"
```

---

## Phase D — Documentation and close

### Task D1: Release documentation and ownership

**Files:**
- Create: `docs/engineering/releases.md`
- Modify: `docs/architecture/ownership.md`
- Modify: `docs/engineering/dependencies.md` if Task B2 left anything unrecorded

**Interfaces:** none.

- [ ] **Step 1: Write the runbook**

Cover: how a release is proposed and merged; how the publish workflow is dispatched; trusted-publisher setup and the token fallback; what the assets are; how to update npm (`npm i -g yunari@latest`); what a bad release costs (npm unpublish window, then `npm deprecate`; never reuse a version); the tag and package version must match; and the winget deferral with its executable requirement.

- [ ] **Step 2: Add the ownership rows**

Add product version (already), schema version + migration owner (`renderer-core/src/theme/migrations.ts`), release bump owner, and publish/stage owner.

- [ ] **Step 3: Verify the doc checks**

Run: `npm run docs:check && npm run ownership:sweep`
Expected: exit 0 for both.

- [ ] **Step 4: Commit**

```bash
git add docs/engineering/releases.md docs/architecture/ownership.md
git commit -m "docs(release): write the release runbook and ownership rows"
```

---

### Task D2: Rewrite the README to current state

**Files:**
- Modify: `README.md`

**Interfaces:** none.

- [ ] **Step 1: Verify every fact before writing**

Read the current sources, not the old README: `node packages/host/bin/yunari.js --help`; `docs/architecture/README.md`; the package descriptions in `src/web/packages/*/package.json`; `packages/host/src/main.ts` for the app folder and bundle paths; `STATUS.md` for the sensor and store state; `docs/engineering/releases.md` for the release path.

- [ ] **Step 2: Rewrite with this outline**

1. What Yunari is and the three processes (host, editor, phone player).
2. Status: pre-release, `0.x`, theme format may change; from the first tag, the previous schema major is migrated on open.
3. Requirements: Windows-first, Node 22.12+/24/26, a Chromium browser for tests.
4. Install and run from source: the exact build commands, default `http://127.0.0.1:5227`, default app folder.
5. First phone: LAN off by default, `--host 0.0.0.0`, pairing, the HTTPS root certificate, PWA install, trusted-network warning.
6. What it does: editor and Fabric scene, theme library and store, sensors (baseline through `systeminformation`, extended through LibreHardwareMonitor), displays/devices, Wallpaper Engine, Steam presence and store metadata, weather/media/custom sources, charts/text/glass.
7. CLI reference: the flags printed by `--help`, not a hand-maintained copy.
8. Releases: package name `yunari`, GitHub Releases, `npm i -g yunari@latest`, link to the runbook. If the first publish has not happened, say it is pending — do not claim it works.
9. Architecture: one paragraph plus the package table.
10. Development: install, build, test, gate, Playwright Chromium, capture environment variables.
11. Docs map and licence/third-party notices.

- [ ] **Step 3: Delete stale claims**

The old line "`yunari` on npm is unrelated" must be gone. Do not add winget as available. Do not edit `AGENTS.md`.

- [ ] **Step 4: Verify**

Run every command block in the README that claims to work from a fresh checkout, or mark it explicitly as a release path that needs the published package. Run `npm run docs:check` and `npm run gate`.
Expected: exit 0 for both.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: rewrite the README to the current product"
```

---

### Task D3: Close the plan

**Files:**
- Modify: `STATUS.md`
- Move: this plan to `docs/superpowers/plans/archive/`
- Modify: the spec's status line to landed

**Interfaces:** none.

- [ ] **Step 1: Record the final evidence**

Run `npm run gate` and record the actual counts. Run the audit policy and record the remaining allowlisted findings. Do not predict counts.

- [ ] **Step 2: Replace STATUS's "Last completed change"**

One to five bullets for this plan's final commit, one line each, never wrapped. Update Current objective, Next and Blockers. Remove the plan from active work.

- [ ] **Step 3: Verify status and docs**

Run: `npm run status:check && npm run docs:check`
Expected: exit 0.

- [ ] **Step 4: Archive**

Run: `git mv docs/superpowers/plans/2026-10-25-release-readiness.md docs/superpowers/plans/archive/`. Update any reference that pointed at the old path, and set the spec's status to `landed 2026-10-25` with the actual commit ids. Re-run `npm run docs:check` and `npm run status:check`; both must exit 0.

- [ ] **Step 5: Commit**

```bash
git add STATUS.md docs/superpowers/plans/archive/ docs/superpowers/specs/2026-10-25-release-readiness-design.md
git commit -m "chore(release): close the release-readiness plan"
```
