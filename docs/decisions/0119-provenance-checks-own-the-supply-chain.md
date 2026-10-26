# 0119 — Provenance checks own the supply chain, not a release checklist

- **Date:** 2026-10-25
- **Status:** accepted 2026-10-25
- **Paths:** `scripts/stage-npm-package.mjs`,
  `scripts/check-third-party.mjs`,
  `scripts/check-workflows.mjs`,
  `scripts/verify-ffmpeg.mjs`

## The problem

Four separate supply-chain gaps shared one shape: a fact was known when a
person looked, and nothing checked it again. The staged npm manifest wrote
caret ranges from the lockfile; `THIRD-PARTY-NOTICES.md` checked package names
but not versions or licences; the publish workflow ran install scripts with
`contents: write` and `id-token: write` and could publish from a non-tag
dispatch; `ffmpeg-static` downloaded a binary whose hash nobody compared. An
audit allowlist also called a production advisory dev-only.

The non-obvious part is where the check belongs. A review checklist is read
once and rots; a gate that fails on drift is read every run. The check must be
cheap enough to run in `npm run gate`, and precise enough that a real version
change fails rather than a formatting difference.

## Rung 1 — Yunari

Searched: `scripts/stage-npm-package.mjs`, `scripts/audit-policy.mjs`,
`scripts/check-doc-references.mjs`, `scripts/reuse-gate.mjs`;
`THIRD-PARTY-NOTICES.md`; `docs/engineering/dependencies.md`;
`docs/engineering/audit-allowlist.json`; `.github/workflows/publish.yml` and
`release.yml`; `package.json` overrides; `gates:self-test`.

Found:
- `stage-npm-package.mjs` reads workspace versions and emits a manifest; it
  writes the range form rather than the exact locked version.
- `audit-policy.mjs` checks an allowlist but the zod entry's reason was wrong.
- `check-doc-references.mjs` and `reuse-gate.mjs` are the model for a self-test:
  a pure function, a `--self-test` path, and a gate entry.
- The notices file lists names only; nothing reads installed metadata.
- `publish.yml` has one job holding both install and publish permissions,
  checkout without `persist-credentials: false`, and no tag guard.
- Overrides for `undici` and `sharp` leave `npm ls` invalid; zod is not
  overridden.
- `ffmpeg-static` is installed with scripts and executed without a hash.

## Rung 2 — dependencies

Searched: root and workspace `package.json`, `package-lock.json`, the installed
tree, and `npm ls --all`.

Found: `@biomejs/biome`, `typescript`, `vite`, `vitest`, Playwright, `tsx`,
`canvas`, `jsdom`; runtime `culori`, `echarts`, `fabric`, `fflate`,
`node-forge`, `systeminformation`, `zod`, `sharp`, `undici`. `ffmpeg-static`
is the one postinstall binary download. There is no lockfile-integrity checker
or notices generator installed.

## Rung 3 — platform

Searched: npm `package.json` fields (`version`, `license`, `dependencies`),
`npm ls --json`, `npm audit --json`, GitHub Actions workflow schema, Git object
SHAs.

Found:
- `npm ls --json` gives the resolved tree, including overridden edges, so a
  notices check can compare installed name/version/licence without a new
  parser.
- `npm audit --json` distinguishes production and development paths; the
  allowlist can require a real path rather than a hand-written claim.
- GitHub Actions `uses:` accepts a full 40-character commit SHA. `gh api
  repos/<owner>/<repo>/git/ref/tags/<tag>` resolves a tag to its commit.
- The workflow schema has job-level `permissions`, and `actions/checkout`
  exposes `persist-credentials`.
- `git rev-parse` and `git cat-file` are enough to prove a staged version
  exists, but the notices check only needs installed metadata.

## Rung 4 — ecosystem

Searched: GitHub "Secure use reference" and OWASP "GitHub Actions Security
Cheat Sheet"; npm "Generating provenance statements"; `actions/checkout`
README; `npm-package-json-lint`; `license-checker`; `npm-license-crawler`;
`package-lock` integrity discussions.

Found:
- GitHub recommends workflow-level `permissions: {}` (or least privilege),
  job-scoped elevation, full-SHA action pinning, and
  `persist-credentials: false` unless a later git operation needs the token.
  OWASP adds `impostor-commit` checking when pinning a SHA.
- npm provenance requires `id-token: write`, a cloud-hosted runner and
  `--provenance`; it is a publish-job concern, not an install-job one.
- The licence tools (`license-checker`, `npm-license-crawler`) produce a full
  transitive report, which is more than the notices file needs. No tool checks
  the notices file against the installed direct dependencies in this project's
  format.
- Nobody in the ecosystem can verify an `ffmpeg-static` download for this
  project's platform set; the package publishes no per-asset hash manifest.
- The common failure is exactly the one here: a check that runs only in CI or
  only at release, not in the same gate a developer runs.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Keep the release checklist | No code | Zero | Rots between releases; the audit already found four drifts | Rejected |
| `npm audit` alone | Built in | Already run | Covers advisories, not ranges, notices or action pins | Rejected |
| `license-checker` full report | Proven | New dependency; large output; transitive noise | Not the direct-dependency contract the notices file states | Rejected |
| Small `check-third-party.mjs` over the workspace manifests and the lockfile | Exact direct versions and licences; no dependency | One script, its cases beside `audit-policy.test.ts` | Must parse the workspace tree correctly | Chosen |
| Hash-pin every workflow action by hand | Strong | A manual update per action | Drift returns when an action is bumped | Rejected |
| SHA pinning plus a workflow checker | Strong and checked | One script | A `uses:` in a composite action is outside its scan | Chosen |
| Trust `ffmpeg-static`'s HTTPS download | No work | Zero | A compromised release or MITM executes a binary | Rejected |
| Committed per-platform SHA-256 manifest | Verifiable before exec | Hashes must be collected per platform | An unlisted platform must refuse, not run | Chosen |
| Exact versions in the staged manifest | Reproducible installs | The stage script must read the lockfile | A workspace link has no version | Chosen |

## Rung 6 — probe

The audit read `stage-npm-package.mjs` and confirmed it emits range forms; read
the notices file and confirmed it has names only; read `publish.yml` and
confirmed one job holds both permissions and checkout persists credentials; read
`package.json` and confirmed the zod advisory is not overridden. The release
readiness record already measured the `sharp`/`undici` overrides leaving
`npm ls --all` with `ELSPROBLEMS`. No new release was run before this note.

The checks themselves are the probe: Task 8.1's test asserts a staged manifest
contains `"culori": "x.y.z"` and no caret; Task 8.2's parser asserts every
workflow `uses:` is a 40-character SHA and each job's permissions; Task 8.3
requires `npm audit` and `npm ls --all` exit 0; Task 8.4's fixture proves a
wrong ffmpeg hash is refused.

## Rung 7 — build

`stage-npm-package.mjs` and the new check scripts run in Node, not in a bundle.
`check-third-party.mjs` reads the workspace manifests, the lockfile and the
installed packages, so it runs after `npm install` and before a release.
`check-workflows.mjs` parses the workflow YAML as text, avoiding a YAML
dependency. The ffmpeg manifest is committed JSON; the verifier runs before the
host executes the binary. Every check is added to `npm run gate`, and a check
whose proof needs a fixture tree keeps it under `src/web/tests/scripts/` beside
`audit-policy.test.ts` rather than in a `--self-test` path.

Amended 2026-10-26: the three checks were first written with an in-file
`--self-test`; `check-third-party.mjs` reached 785 lines, so its cases moved to
vitest. A script with no fixture tree still carries a `--self-test` in
`gates:self-test`.

## Decision

1. Staged manifests carry exact resolved versions.
2. `check-third-party.mjs` compares installed direct-dependency names, versions
   and licences with `THIRD-PARTY-NOTICES.md`; drift fails the gate.
3. Publish and release workflows use least privilege, split install from
   publish, set `persist-credentials: false`, refuse a non-dry dispatch unless
   the ref is a `v*` tag, and pin every action to a full SHA.
4. The audit allowlist names the real production path or the advisory is fixed;
   zod is overridden to a fixed version and the Worker suite proves it.
5. `ffmpeg-static`'s binary is checked against a committed per-platform SHA-256
   manifest before execution; an unlisted platform refuses.
6. `npm ls --all` must exit 0; the overrides are re-resolved or removed.

The reason is drift: every one of these facts was true when someone checked it
and false later. A gate makes the fact a property of every build.
