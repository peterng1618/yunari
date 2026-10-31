# 0023 — The Worker suite runs on `@cloudflare/vitest-plugin`

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/store-worker/package.json`, `src/web/packages/store-worker/vitest.config.ts`, `src/web/packages/store-worker/tsconfig.json`, `src/web/packages/host/package.json`, `schema/audit-allowlist.json`

## Problem

A clean `npm install` warns that `@cloudflare/vitest-pool-workers@0.23.0` is
deprecated and renamed to `@cloudflare/vitest-plugin` (#217, `vg-728`). The
store-worker suite ran on the deprecated package, and the workspace carried a
nested Vitest 4 only because that package's peer range was `^4.1.0`.

## Rung 1 — internal owner

Searched: `packages/store-worker/vitest.config.ts`, `tsconfig.json`,
`package.json`, and every test importing `cloudflare:test`.

Found: the suite's configuration is one file; the tests use `cloudflare:test`
only for `env`, `SELF` and `applyD1Migrations`, all still exported by the new
package's `cloudflare:test` declaration. No test or helper depends on the
deprecated package name.

## Rung 2 — installed dependencies

Read: `@cloudflare/vitest-plugin@1.4.11`'s manifest and types.

Found: it exports `cloudflareTest` and `readD1Migrations` from the package root
— the same two names the config already used — and peers on
`vitest ^4.1.0 || ^5.0.0`, so the workspace's 5.0.5 satisfies it without a
nested copy. It also depends on `wrangler 4.156.0`, so this package's own
`wrangler` moves to the same version and one copy is installed.

## Rung 3 — native platform

Searched: npm's workspace hoisting and the lockfile's nested-copy record.

Found: removing the nested `vitest` devDependency and declaring only the
plugin lets npm resolve the workspace's copy; `npm ls vitest` shows one 5.0.5.
No platform feature is involved.

## Rung 4 — public solutions

Searched: the rename's migration notes and `@cloudflare/codemods`'s
`vitest:pool-workers-to-vitest-plugin`.

Found: the official migration is the package rename plus the `types` path
(`@cloudflare/vitest-pool-workers/types` → `@cloudflare/vitest-plugin/types`),
which is exactly what the config and tsconfig needed. The codemod also rewrites
`cloudflare:test`'s `env`/`SELF` to `cloudflare:workers`; those imports are
deprecated but still exported, and rewriting thirteen test files is not needed
to leave the deprecated package or to run the suite. The deprecation is a
follow-on, not part of this rename.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Stay on `vitest-pool-workers@0.23.0` | known-good | npm warns on every install; no future updates | rejected by the ruling |
| Rename package, keep nested Vitest 4 | minimal | two Vitest majors in one workspace for a peer range that no longer requires it | rejected: the ruling says hoist |
| Rename package, hoist Vitest 5, bump wrangler | one toolchain | verify Worker suite and typecheck | chosen |
| Codemod every `cloudflare:test` import to `cloudflare:workers` | removes deprecation | thirteen files and a fetch-shape change unrelated to the rename | deferred |

## Rung 6 — smallest probe

`npm run test:worker` — 13 files / 130 tests pass on the plugin before the
docs and notices were updated. `npm run typecheck` passes against
`@cloudflare/vitest-plugin/types`. `npm ls --all` exits 0 with no `invalid`
entries, and `npm ls vitest` shows a single 5.0.5.

## Rung 7 — decision

Adopt `@cloudflare/vitest-plugin@1.4.11`, drop the nested Vitest 4 so the
workspace's 5.0.5 is the only copy, move `wrangler` to the plugin's own
4.156.0, and point the tsconfig `types` at the new package. The notices file
records the new package and the single Vitest row.

Re-measuring the audit found eleven new node-forge advisories and a published
fix (1.4.2), so the host's direct dependency moves from 1.4.0 to 1.4.2 and the
allowlist row that said no patched release existed is removed. The remaining
rows are the two zod findings: the override already lifts every copy except
`@google/design.md`'s dev-only v3. `npm run audit:check` reports every finding
allowlisted and no stale rows.
