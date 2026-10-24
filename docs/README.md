# Yunari documentation

This tree separates current project truth from change-specific Superpowers
artifacts and from Git history.

| Need | Canonical source |
|---|---|
| Fresh-session handoff / current work | [`../STATUS.md`](../STATUS.md) |
| Bugs, feedback and requests, and what is *verified* | [`product/backlog.jsonl`](product/backlog.jsonl) — the source of truth; [GitHub issues](https://github.com/peterng1618/yunari/issues) are an input surface |
| Driving the product to find what's wrong with it | [`product/tester-runbook.md`](product/tester-runbook.md) — operating procedure; [`product/tester-brief.md`](product/tester-brief.md) — what to file; [`product/probe-notes.md`](product/probe-notes.md) — the instrument traps, with evidence; [`product/probes/`](product/probes/README.md) — the reusable scripts |
| Product goals, constraints and stable requirements | [`product/requirements.md`](product/requirements.md) |
| Current system shape and boundaries | [`architecture/README.md`](architecture/README.md) |
| Who owns each concept | [`architecture/ownership.md`](architecture/ownership.md), and the review of it at [`architecture/manager-census.md`](architecture/manager-census.md) |
| Which stylesheet selectors the product still reaches | [`architecture/dead-selectors.md`](architecture/dead-selectors.md) — a reachability check of the two shipped CSS files |
| Which exports and modules nothing reaches | [`architecture/dead-code-candidates.md`](architecture/dead-code-candidates.md) — the sweep scanner's candidates at `f7900f5c`, refreshed after the sweep's removals, with the coverage it does and does not have |
| The editor's visual language, **normative** | [`../DESIGN.md`](../DESIGN.md) — scales, colour roles, the control and icon vocabulary, layout and copy rules |
| Why major architecture choices were made | [`decisions/`](decisions/) — the live register, and the one `scripts/reuse-gate.mjs` enforces; the earlier set stopped at 0010 in [`adr/`](adr/) |
| Active feature design/spec | [`superpowers/specs/`](superpowers/specs/) |
| Superpowers implementation plans | [`superpowers/plans/`](superpowers/plans/) |
| Non-obvious engineering traps | [`engineering/gotchas.md`](engineering/gotchas.md) |
| Dependency/licence provenance | [`engineering/dependencies.md`](engineering/dependencies.md) |
| Releasing the product — version bump, publish, npm and the winget deferral | [`engineering/releases.md`](engineering/releases.md) |
| Rendered verification evidence | [`evidence/screenshots/`](evidence/screenshots/) |

Implementation truth is always the code and tests. `STATUS.md` is a compact handoff, not history. Git stores chronology.
`STATUS.md` names exactly one active execution plan. Other incomplete plans are queued until that plan closes; parallelism happens inside the active phase, not across plans.
Superpowers owns change-specific design/planning and its temporary
`.superpowers/sdd/` execution ledger. Do not recreate a separate status,
lessons, spec or plan system elsewhere.
