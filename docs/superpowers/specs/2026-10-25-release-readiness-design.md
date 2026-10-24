# Release readiness — versioning, dependency hygiene and publishing — design

- **Date:** 2026-10-25
- **Status:** approved 2026-10-25; spec awaiting plan.
- **Register:** no row. Nothing here is a defect against shipped behaviour.
- **Related:** [`STATUS.md`](../../../STATUS.md);
  [`docs/architecture/ownership.md`](../../architecture/ownership.md);
  [`docs/engineering/dependencies.md`](../../engineering/dependencies.md);
  [decision 0041](../../decisions/0041-retire-schema-v1-by-deletion.md);
  [decision 0070](../../decisions/0070-the-host-mints-its-own-local-ca.md);
  theme versioning spec [`2026-10-22-theme-versioning-design.md`](2026-10-22-theme-versioning-design.md).
- **Decision note required:** implementation touches
  `src/web/packages/renderer-core/src/theme/`, which is on the reuse gate's
  watchlist. A note numbered `0110` must claim those paths before the first
  write, and it must record all seven rungs.

## Purpose

Make the first published Yunari release possible:

1. A clean `npm install`: no avoidable deprecation warning, every fixable
   vulnerability cleared, every remaining finding explicitly accepted with a
   reason and a check that catches new ones.
2. One semantic version for the product, and one for the theme schema, each
   with a written rule for when it moves.
3. A repeatable release that produces a GitHub Release and an npm package, and
   a defined place for winget.

The user-visible outcome: `npm i -g yunari` installs a working host; `yunari
--version` prints the released version; the About tab prints the same product
version and the schema version it reads; a theme written by the previous major
schema still opens.

## Current state

Facts this design is argued from, each at its owner:

- **Product version is already owned.** `src/web/package.json` `version` is
  `0.1.0`; its `//version` comment records the vg-279 ruling. The host reads
  that field at run time (`packages/host/src/main.ts`, `productVersion`), and
  the editor bundle receives it through Vite's `define` as
  `__YUNARI_VERSION__`. Every workspace package stays `0.0.0` and private.
- **Schema version is an integer.** `SUPPORTED_SCHEMA_VERSION = 2` in
  `renderer-core/src/theme/fabric-envelope.ts`; the envelope type pins
  `schemaVersion` to it; the validator refuses any other integer
  (`fabric-envelope-validate.ts`); `schema/theme-document.schema.json` declares
  `"schemaVersion": { "const": 2 }` and `$id`
  `https://yunari.local/schema/theme-document/2.json`.
- **No migration mechanism.** ADR 0017 and decision 0022 ruled out migration;
  decision 0041 retired schema v1 by deletion because nothing was published.
  No v1 document exists outside history.
- **Theme document versions are a different fact.** `theme-package/src/version-ladder.ts`
  computes a per-document semver at submit only, from the change between two
  documents. It does not version the product or the schema.
- **No release process.** There are no git tags, no CHANGELOG, no publish
  workflow, and README says "Nothing is published yet." CI runs the gate,
  builds the three bundles and runs browser suites, but publishes nothing.
- **npm names are available.** The registry returns 404 for both `yunari` and
  `yunari-dashboard` (checked 2026-10-25). README's "`yunari` on npm is
  unrelated" is stale.
- **`npm ci` deprecations.** A clean install in a temporary copy warns for
  `prebuild-install@7.1.3` (via `canvas@3.2.3`, the latest) and
  `whatwg-encoding@3.1.1` (via `jsdom@26.1.0`; fabric 7.4.0 declares
  `jsdom: ^26.1.0` as an optional dependency).
- **`npm audit` on 2026-10-25** reports 11 findings: 2 moderate, 9 high.
  - Fixable by upgrade: `vite` 8.3.0 → 8.3.5, `vitest` 5.0.0 → 5.0.5.
  - No upstream fix: `node-forge@1.4.0` (GHSA-86w9-cpqp-85rv, runtime, host
    CA); `@google/design.md@0.4.0`'s zod v3 (dev-only design linter).
  - Transitive through Cloudflare tooling: `miniflare`, `undici`, `sharp`,
    `zod`. `wrangler@4.152.0` and `@cloudflare/vitest-pool-workers@0.23.0` are
    the latest published versions and still pin vulnerable transitive versions.
  - `@vitest/mocker` is fixed by `vitest` 5.0.5.
- **The host resolves its bundles relative to the workspace.**
  `packages/host/src/main.ts` computes `packagesDir = path.resolve(here, "..", "..")`
  and serves `player/dist`, `editor/dist` and `host/public` from it; the bin
  shim loads `../dist/main.js`; `productVersion()` reads `../../../package.json`.
  A staged package that keeps the `packages/host/...` layout therefore needs no
  production path change.
- **The host's only runtime dependencies** are `ffmpeg-static`,
  `node-forge` and `systeminformation`; the renderer, player and editor are
  bundled into `dist`.

## Decisions

### D1 — One product version, moved by release-please

The product version stays in `src/web/package.json` (vg-279). The host CLI and
the editor bundle keep reading it from there. No schema number, theme version
or package version is presented as the product version.

Levels follow semver:

| Level | Covers |
|---|---|
| `major` | An incompatible CLI, storage, config or theme-format change. |
| `minor` | A new user-visible capability that keeps existing data working. |
| `patch` | A fix, dependency/security update, documentation or internal change. |

Conventional Commits already map to this: `feat` → minor, `fix`/`perf`/
`refactor` → patch, `!` or `BREAKING CHANGE` → major. Before 1.0, semver allows a
breaking change in a minor bump; release-please applies that rule.

**release-please**, not semantic-release. It opens a release PR, so the full
gate runs on the exact commit that will be tagged, and the release notes are
reviewable before publication. semantic-release would publish on every merge
with no approval surface, which this repo's review and evidence rules rule out.

The first public release is **`0.1.0`**, the value already owned. README states
the product is early and unstable, and 0.x is the honest signal. `1.0.0` waits
until the theme format and CLI stop moving.

### D2 — Schema semver names the major, and N−1 is accepted

The envelope's `schemaVersion` becomes a semver string. The initial value is
**`"2.0.0"`**: the format is the one currently numbered 2, and no document
changes shape. `SUPPORTED_SCHEMA_VERSION` becomes a full version constant, with
the major derived from it rather than written a second time.

Reading rules:

- A document whose major equals the current major is accepted.
- A document whose major is exactly one less is **migrated in memory**, then
  validated as current.
- A document two or more majors older, or any newer major, is refused with the
  sentence it already prints for a newer schema.
- Saving, exporting and publishing always write the current version.

At `2.0.0` there is no earlier supported major: v1 was deleted and no v1
document exists. N−1 is therefore a forward obligation. The dispatch seam and
its invariant land now; real migrations begin when `3.0.0` exists.

**Every envelope format change is a major bump** while the reader rejects
unknown members. A new member, a removed member, a renamed member or a changed
constraint cannot be read by an older major. Minor and patch describe the
schema artifact — descriptions, `$id` corrections, tooling — not document
compatibility. Relaxing strict unknown-member rejection so a minor can be
forward-compatible is a separate design and is a non-goal here.

The schema file keeps its canonical name `schema/theme-document.schema.json`
and moves its `$id` to `…/theme-document/2.0.0.json`; `const` becomes
`"2.0.0"`. When a major lands, the outgoing file is copied to
`schema/archive/theme-document-<major>.schema.json` before the current file is
rewritten. The archive is for tools and readers, never for validation.

This reverses the "no migration" stance of ADR 0017, decision 0022 and decision
0041. The reversal is intentional and takes effect at the release boundary:
before the first release a format may break cleanly because no data exists;
after it, a published document is data someone owns.

### D3 — Migrations are one dispatcher, one function per step

Add `renderer-core/src/theme/migrations.ts`:

```ts
type EnvelopeMigration = (
  input: Readonly<Record<string, unknown>>,
) => Readonly<Record<string, unknown>>;

/** Keyed by the major being migrated FROM. */
const MIGRATIONS: Readonly<Record<number, EnvelopeMigration>>;

function migrateEnvelope(input: unknown): MigrationResult;
```

`migrateEnvelope` reads the major, refuses a malformed or unsupported one,
applies the chained migrations from that major up to the current one, and
returns the migrated object plus the version it came from. It never validates;
validation stays with `validateFabricThemeEnvelope`. It never writes.

Every persisted-theme reader parses through **one** function that migrates
before validating. The plan must enumerate the readers (host theme library and
import, editor open/save, player fixture path, catalogue validator, store
worker) and route each through it; a reader that calls the validator directly
is the defect this spec exists to prevent.

A test asserts that every major the reader accepts below the current one has a
migration, so a new major without its migration fails at test time. The test
proves the dispatcher with an injected migration table; the shipped table is
empty at `2.0.0`.

### D4 — Fix what upstream allows; accept the rest in writing

Dependency changes, in order:

1. **Direct upgrades:** `vite` 8.3.5, `vitest` 5.0.5.
2. **Targeted overrides**, each accepted only if its suite stays green:
   - `undici` to the newest patched 7.x (7.30.1) for the Cloudflare tree.
   - `sharp` to `^0.35.5`.
   - `jsdom` to `^30.1.3`, which drops `whatwg-encoding`, if fabric's DOM tests
     and the jsdom environment pass.
   - Do not override `zod` across a major.
3. **Accepted, documented, allowlisted:**
   - `node-forge` — ADR 0070 records that the host never calls the vulnerable
     verifier and checks every certificate with `node:crypto`.
   - `@google/design.md`'s zod v3 — dev-only linter; the package is the latest
     published version and needs v3.
   - `canvas`'s `prebuild-install` deprecation — `canvas@3.2.3` is the latest
     and fabric's node renderer needs it. A deprecation is not a vulnerability.

An override that breaks a suite is removed, and the finding joins the accepted
list with that fact recorded. Overrides are not force-fitted to make a report
green.

### D5 — A new vulnerability fails CI

Add `scripts/audit-policy.mjs` and `docs/engineering/audit-allowlist.json`.
The script runs `npm audit --json`, and fails when:

- a finding's package and advisory are not covered by an allowlist entry;
- an allowlist entry no longer matches a finding (so stale exceptions are
  removed rather than kept);
- the audit report itself cannot be read.

Each allowlist entry carries `package`, `advisory` (GHSA or a title
substring), `reason`, and `reviewed` (date). The script has `--self-test` in
`npm run gates:self-test`. It runs as its own CI job, **not** inside `npm run
gate`, because the gate must stay runnable offline; the self-test runs in the
gate.

### D6 — Releases are GitHub-native; npm is the install path

**Recommendation: npm CLI plus GitHub Releases now, winget after a packaged
executable exists.**

Flow on `main`:

1. release-please opens a release PR that bumps `src/web/package.json` and
   writes `src/web/CHANGELOG.md`.
2. Merging the PR tags `vX.Y.Z` and creates a GitHub Release with generated
   notes.
3. A `publish` workflow runs on the tag: `npm ci`, `npm run gate`, build
   player, editor and host, then assemble a **staged package** outside the repo:

   ```text
   package.json          # name "yunari", version from src/web/package.json
   LICENSE
   THIRD-PARTY-NOTICES.md
   packages/host/bin/yunari.js
   packages/host/dist/
   packages/host/public/
   packages/player/dist/
   packages/editor/dist/
   schema/
   ```

   The staged package mirrors the workspace layout, so `packagesDir`,
   `productVersion()` and the bin shim resolve without production code changes.
   Runtime dependencies declared: `ffmpeg-static`, `node-forge`,
   `systeminformation`; `engines.node >= 22`; `license: MIT`.
4. Publish to npm as `yunari` with provenance and npm trusted publishing
   (OIDC). If OIDC cannot be configured, fall back to an `NPM_TOKEN` secret.
   `latest` is the release tag; prereleases use `next`.
5. Attach the `.tgz` and a `.zip` of the staged package to the GitHub Release.

Users install and update with `npm i -g yunari@latest`. `npx yunari` also works
but a long-running host is better installed.

The staged package **excludes** the optional vendored binaries (`vendor/lhm`,
`vendor/presentmon`) and the `vendor:*` staging scripts. Features that need
them keep their existing explicit "not available" reason. README documents
the separate staging step for LHM.

### D7 — winget is a later phase, not a release blocker

WinGet's `zip` + `NestedInstallerType: portable` requires a real `.exe` nested
path; a `.cmd` wrapper is not a valid portable target. The pnpm manifest is the
working shape. Yunari therefore needs either:

- a Node single-executable application (`node --experimental-sea-config`) that
  embeds the built host, or
- a ZIP whose root holds an executable plus the app, or
- an Inno Setup/MSI installer with a dependency on `OpenJS.NodeJS.LTS`.

The choice is deferred until after the npm package and zip exist and the first
release has run. Winget submission then uses the GitHub Release asset URL and
SHA256, and `wingetcreate update` for later versions. No winget work is in this
plan beyond documenting the path.

## Release files and ownership

| Fact | Owner |
|---|---|
| Product version | `src/web/package.json` `version` |
| Product version readers | host `productVersion`, editor Vite `define` |
| Schema version | `renderer-core/src/theme/fabric-envelope.ts` |
| Envelope migration | new `renderer-core/src/theme/migrations.ts` |
| Published schema document | `schema/theme-document.schema.json`, `schema/archive/` |
| Release bump + notes | `.github/workflows/release.yml`, `release-please-config.json`, `.release-please-manifest.json` |
| Publish + stage | `.github/workflows/publish.yml`, `scripts/stage-npm-package.mjs` |
| Audit policy | `scripts/audit-policy.mjs`, `docs/engineering/audit-allowlist.json` |
| Release documentation | new `docs/engineering/releases.md` |

`docs/architecture/ownership.md` gains the schema-version, migration and
release rows. `docs/engineering/dependencies.md` records the overrides and the
accepted findings. README's install section and stale npm-name note are
rewritten in the same change that publishes the first package.

## Testing and evidence

- **Unit:** semver parse and bump rules for the product; schema major
  extraction; migration dispatch with an injected table; refusal of an
  unsupported or malformed major; "every accepted older major has a migration".
- **Unit:** versions are read from one owner — a test that changes the
  manifest value sees both the host answer and the editor define follow it.
- **Schema sync:** `fabric-envelope-schema-sync.test.ts` and
  `envelope-keys-disagreement.test.ts` pass with the semver `$id` and `const`.
- **Audit policy:** its self-test, plus a red-proof that a synthetic finding
  outside the allowlist fails.
- **Package smoke (the proof that matters):** `npm pack` the staged package,
  install the tarball in a temporary directory outside the repo, run
  `yunari --version` (asserting the released version), start the host with
  `--no-browser`, fetch `/editor` and a player route, then stop it. This runs
  in CI on the release tag.
- **Browser:** existing dev-mode suites stay the behavioural evidence; the
  package smoke proves the packaged layout.
- **Red-proofs:** remove the migration dispatch so an older-major fixture is
  refused; remove a read routed through the migration so the direct-validator
  call is caught; add a fake finding to prove the audit policy fails closed.
- **Gate:** `npm run gate` exit 0 on the release commit, CI green on the
  release PR.

Screenshots are not required: no authored surface changes except About already
printing the product and schema versions, whose existing capture is re-taken
only if its text changes.

## Non-goals

- 1.0.0 and any support window beyond N−1.
- Forward-compatible minor schema changes, preserving unknown members on
  round-trip, or dual readers beyond N−1.
- Publishing the internal workspace packages (`@yunari/editor` and friends).
- A winget manifest, Node SEA, MSI/Inno installer, or code signing in this
  plan.
- Auto-merging release PRs, or publishing on every merge.
- A schema package on npm. The schema is a file in this repo and an artifact of
  the app package; if third-party tooling needs it on npm, that is a later
  request.

## Risks and unverified items

- **Trusted publishing and release-please settings are unverified against
  current docs** (web search was unavailable). Confirm before the first
  publish: npm OIDC workflow name must match; GitHub Actions must be allowed to
  create PRs; the tag pattern release-please emits.
- **Overrides may break the Worker toolchain.** `@cloudflare/vitest-pool-workers`
  pins exact transitive versions; an override is accepted only after
  `npm run test:worker` passes.
- **`jsdom` 30 with fabric 7.4.0** is untested. Fabric declares `^26.1.0`; an
  override must pass the DOM suites or be dropped.
- **`npm pack` size** may be large (editor and player bundles). Measure it; a
  size ceiling is out of scope but the number goes in the release notes.
- **The npm name is unclaimed today, not reserved.** Register the package owner
  and trusted publisher before the first release.
- **First release `0.1.0` is a judgement**, not a compatibility claim.
- **`AGENTS.md` carries the same stale npm claim** ("plain `yunari` is
  unrelated on npm"). It is deliberately **not** edited: that file is
  user-owned and changes only on an explicit request. The README is corrected;
  the AGENTS line waits for the user.

## Landing note

Not yet implemented.
