# Yunari agent environment and documentation reset

## Goal

Remove Yunari's accumulated agent configuration and development documentation, then initialize a lean replacement from the current codebase. Preserve Orca, Superpowers, and selected Yunari-specific gotchas without preserving historical narratives or superseded process.

## Sources of truth

- Current code, tests, schemas, manifests, and CI define current product and architecture.
- Existing docs may supply a non-obvious gotcha only when the rule remains relevant and is not evident from code.
- Git history retains chronology; new docs state current truth only.
- Historical decisions, intents, plans, status narratives, and incident diaries are not migrated.

## Removal and preservation

- Move `docs/product/backlog.jsonl` and `docs/product/backlog-archive.jsonl` unchanged to `C:\Users\peter\.yunari\backlog-reset-2026-10-29\` before deleting the docs tree. These files are recovery data only.
- Delete all other existing `docs/` content, including evidence, mockups, decisions, ADRs, plans, specs, probes, and generated status material.
- Remove the JSONL backlog checker, filing rules, and local register workflow. GitHub Issues owns future defects and requests; Orca links issues to worktrees.
- Remove repo-local Claude/Codex agent configuration and custom hooks. Do not alter user-global Orca, Superpowers, CodeGraph, RTK, or other environment configuration.
- Keep application/runtime code except for stale documentation references and tests or scripts whose subjects are deleted docs or mockups.

## Lean replacement

- `AGENTS.md`: concise project/toolchain facts, commands, Orca/Superpowers/GitHub Issues ownership, code guardrails, verification, Git safety, and selected gotchas. State that docs and comments explain only non-obvious invariants; no diary, chronology, or repeated rationale.
- `DESIGN.md`: retain a normative editor visual-language contract derived from current styles/components. Preserve stable `§N` markers and machine-checked token frontmatter where current tooling uses them. Remove historical rationale and references to deleted artifacts.
- `docs/README.md`: short map to current docs and Superpowers artifacts.
- `docs/product.md`: current product scope and invariants from code/tests.
- `docs/architecture.md`: current package boundaries and ownership from code.
- `docs/development.md`: setup, verification, and Yunari-specific development traps.
- `docs/operations.md`: current release, dependency/licence, host, and external-service operations.
- `docs/superpowers/specs/` and `docs/superpowers/plans/`: empty roots for future Superpowers artifacts, with no imported history.
- Retain only operational machine-readable data required by executable policy, such as the audit allowlist, with paths updated if moved.

A fresh agent drafts the replacement from the current codebase after extraction of explicitly allowed gotchas. Its output must not copy the old documentation structure or narratives.

## Tooling cleanup

- Remove backlog-specific scripts, package commands, and tests.
- Remove or simplify checks tied exclusively to deleted mockups, evidence, ownership censuses, and decision files.
- Preserve useful validation for `DESIGN.md`, licences, dependencies, workflows, security, formatting, types, and tests; rewire required paths.
- Remove dead links and doc-only comments from source without changing runtime behavior.
- Update README and CI references to the new structure.

## Execution and verification

1. Confirm clean Git state and preserve the backlog files outside the repo.
2. Extract only approved reusable gotchas and current operational facts needed for the rewrite.
3. Remove old setup/docs and dependent tooling.
4. Have a fresh agent inspect the current codebase and draft the lean docs.
5. Review replacements against code, concision requirements, and absence of historical narratives.
6. Run focused self-tests, `npm run gate`, and relevant builds. Report any unrun verification explicitly.

Success means a clean checkout has only the lean current-truth docs, no repo-local backlog mechanism or stale agent setup, and all retained executable checks resolve their inputs.
