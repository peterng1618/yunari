# Yunari Agent Environment Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Yunari's accumulated agent setup and development docs with a lean, code-derived foundation.

**Architecture:** Preserve recovery data outside Git, remove obsolete docs and their executable dependencies, then have a fresh agent derive replacement docs from current code. Retain validation whose subjects still exist.

**Tech Stack:** Markdown, Node.js scripts, npm workspaces, Vitest, Playwright, Orca, Superpowers, GitHub Issues.

**Spec:** `docs/superpowers/specs/2026-10-29-agent-environment-reset-design.md`

## Global Constraints

- Current code/tests/manifests define current truth; do not migrate historical intents or narratives.
- Move both backlog JSONL files unchanged to `C:\Users\peter\.yunari\backlog-reset-2026-10-29\` before deleting docs.
- GitHub Issues owns future tracking; Orca owns worktrees/runtime; Superpowers owns plan lifecycle.
- Do not modify user-global agent configuration.
- Keep `DESIGN.md` conformant with Google design.md: normative YAML token frontmatter and `##` Markdown guidance; remove custom `§N` markers and citation machinery.
- Docs/comments explain non-obvious current invariants only; no diary or repeated rationale.

## Review Focus

- Interrupted deletion could lose the only backlog copy; verify SHA-256 and file counts before removal.
- A surviving script may reference a deleted doc and fail only in CI; scan all executable references and run the full gate.
- Fresh docs may repeat old assumptions; review factual claims against current source.
- Removing mockup tests must not remove product behavior suites; inspect the final test inventory.
- Rewriting `DESIGN.md` may drift from Google design.md structure or CSS tokens; run official lint plus token sync checks.

---

### Task 1: Preserve recovery data and map executable dependencies

**Files:**
- Move: `docs/product/backlog.jsonl`, `docs/product/backlog-archive.jsonl` to `C:\Users\peter\.yunari\backlog-reset-2026-10-29\`
- Read: repo scripts, workflows, package manifests, test configs

**Interfaces:**
- Produces: verified external backlog recovery copy and dependency inventory for Task 2.

- [ ] Confirm Git worktree is clean and destination does not already exist.
- [ ] Create destination; move both backlog files there. Record SHA-256 hashes and line counts before and after; require equality.
- [ ] Inventory executable references to `docs/`, mockup helpers, backlog checks, evidence checks, and decision gates. Identify exact removals and retained checks.
- [ ] Commit no changes in this task; preservation and inventory are its checks.

### Task 2: Remove obsolete setup, docs, and dependent tooling

**Files:**
- Delete: existing `docs/` except this active plan and its spec; delete `.claude/`, `.codex/`, `AGENTS.md`
- Delete: `scripts/backlog-check.mjs`, `capture-freshness.mjs`, `reuse-gate.mjs`, `ownership-sweep.mjs`, `ownership-overlap.mjs`, `ownership-enforcement.mjs`
- Delete: mockup-only test modules/specs and their tests under `src/web/tests/e2e/`
- Modify: `src/web/package.json`, `vitest.config.ts`, `tsconfig.e2e.json`, `.gitignore`, workflows and scripts with deleted paths
- Retain: `scripts/design-md.mjs`, `design-tokens.mjs`, licence/dependency/workflow/security checks

**Interfaces:**
- Consumes: Task 1 verified recovery copy and inventory.
- Produces: tree with no executable dependency on deleted artifacts; `DESIGN.md` temporarily retained for Task 3 rewrite.

- [ ] Remove the listed setup/docs and mockup-dependent tests, including `mockup-values.test.ts`, mockup readers/parity helpers, drawing comparison specs, and tests importing only those helpers. Keep product behavior tests and fixture-driven design tests that do not read deleted mockups.
- [ ] Remove backlog, evidence, ownership-census, and reuse-gate commands from package scripts and `gates:self-test`; remove `.claude` hooks with their owning config rather than relocating them.
- [ ] Simplify `design-md.mjs` to official Google design.md lint and CSS/frontmatter sync: delete `--cite`, its deleted-spec dependency, all citation/marker checks and tests, and package invocation. No replacement section-anchor system.
- [ ] Move `docs/engineering/audit-allowlist.json` to `schema/audit-allowlist.json` and update `scripts/audit-policy.mjs`; keep its self-tests and CI behavior.
- [ ] Remove stale doc references from executable source/comments and update README/CI paths. Do not rewrite runtime logic.
- [ ] Run `npm run gates:self-test` from `src/web/`; expected: retained self-tests pass with no missing-file error.
- [ ] Run `npm run typecheck`; expected: no imports or config entries name deleted test helpers.
- [ ] Commit explicit paths with message `chore: remove accumulated agent and doc tooling`.

### Task 3: Fresh-agent code-derived documentation

**Files:**
- Create: `AGENTS.md`, `docs/README.md`, `docs/product.md`, `docs/architecture.md`, `docs/development.md`, `docs/operations.md`
- Rewrite: `DESIGN.md`, root `README.md` documentation sections
- Create: `docs/superpowers/specs/.gitkeep`, `docs/superpowers/plans/.gitkeep`

**Interfaces:**
- Consumes: cleaned current codebase and retained design checks from Task 2.
- Produces: lean documentation set named by the approved spec.

- [ ] Launch one fresh agent with no conversation context. Brief it to inspect current code/tests/manifests/CI and draft the exact files above. It may read the approved reset spec and active plan but no other surviving historical doc, deleted-doc recovery copy, or Git history. Supply only the approved constraints and current gotcha topics: Windows file URLs/symlinks, Playwright built bundles/fixed ports/PowerShell grep quoting, host binary/build order, capture flags, Node versions, Vite Rolldown chunking, Fabric ownership, and no fabricated telemetry.
- [ ] Fresh agent derives product/architecture from current source; documents only observable current behavior and non-obvious invariants. `AGENTS.md` states GitHub Issues + Orca + Superpowers ownership and concise comment/doc rule without recreating a local backlog.
- [ ] Rewrite `DESIGN.md` from current editor CSS/components into standard Google design.md form: YAML frontmatter tokens plus `##` Markdown application guidance; remove `§N` markers, historical rationale, and dead links. Run `npm run design:check`; expected: official lint, token, and CSS sync checks pass.
- [ ] Review every new doc for unsupported claims, diary language, duplicate process, and links to removed artifacts. Keep `docs/README.md` a short map, not a second architecture doc.
- [ ] Run a tracked-file search for deleted paths (`docs/product/backlog`, `docs/decisions`, `docs/design/mockups`, `docs/evidence`, old agent hooks). Expected: no live references; historical commit text is not scanned.
- [ ] Commit explicit paths with message `docs: initialize lean code-derived project guidance`.

### Task 4: Whole-reset verification

**Files:**
- Verify all changed files and final Git diff

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: verified reset and explicit list of any unrun checks.

- [ ] Run `npm run gate` from `src/web/`; expected: exit 0. If a retained test exposes a reset-specific break, fix the dependency rather than deleting product coverage.
- [ ] Run builds affected by removed test/config references, at minimum `npx vite build packages/editor` and `npx vite build packages/host`; expected: exit 0.
- [ ] Confirm backlog files remain at the external destination with original hashes and neither JSONL file remains tracked.
- [ ] Inspect final docs and diff for accidental runtime changes, stale references, or retained diary narratives.
- [ ] Report verification results and unrun browser suites; do not claim visual verification from unit/build checks.
