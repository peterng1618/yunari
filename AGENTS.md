# AGENTS.md — Yunari

Project-specific facts and guardrails for coding agents. **Orca orchestrates
execution** — worktrees, dispatch, tracking and handoffs. **Superpowers owns the
plan lifecycle** — brainstorm, spec, plan, per-task review, fix loop, finish —
and the artifacts those steps produce; do not create a parallel Yunari process.

## Project

- Repo: `peterng1618/yunari`; default branch `main`; integration branch
  `develop`; remote `origin`.
- TypeScript/npm workspace at `src/web/`. No .NET or Python toolchain.
- Node 22.12+, 24 or 26+. Vitest + Playwright; Biome formats and lints.
- Fabric 7.4.0 is the one scene renderer. The editor uses `fabric/es` directly;
  the player uses the shared `scene-fabric` layer.
- Editor shell: React 19 + Base UI + Tailwind. Fabric stays imperative behind
  the editor boundary; never mirror Fabric objects in React.

## Process and documentation

- **Work runs in parallel Orca worktrees.** Each worktree owns one plan and may
  execute it without waiting for another; never stage or commit another
  worktree's files. Parallelism is across worktrees: inside one worktree the
  plan's tasks still run one at a time, because they share a branch.
- **Two layers, one dispatch authority.** Superpowers owns the plan lifecycle
  and what happens inside a task — the brief, TDD, the per-task review gate, the
  fix loop, the ledger. Orca owns the runtime — worktrees, worker dispatch,
  durable Run/Task/Dispatch state, waits and settlement. When Orca orchestration
  is available, a plan's implementer and reviewer are Orca workers
  (`worker-start`), not harness subagents; never run both for one task.
  `worker_done` settles a Dispatch but is not the Superpowers task review, so
  ledger `Task N: complete` only after the review gate passes.
  Do not fan one prompt across several agents to compare results and pick a
  winner; a task has one implementer dispatch, chosen explicitly by model.
- **Recovery is split, not duplicated.** The SDD ledger
  (`<workspace>/progress.md`) records rulings and completions; Orca's
  Run/Task/Dispatch records what is running. After compaction, trust `git log`
  and the ledger for plan state, and `task-list` / `dispatch-show` for workers.
  There is no separate dispatch-record file.
- **Worktree creation and cleanup go through Orca.** When the runtime is
  available, `orca worktree create` is the native worktree tool for
  `superpowers:using-git-worktrees` Step 1a; do not also call `EnterWorktree` or
  `git worktree add`. A worker already inside its worktree skips creation.
  Merge and push choices stay with the human per
  `superpowers:finishing-a-development-branch`; cleanup after a land is
  `orca worktree rm`, not `git worktree remove`.
  If Orca orchestration is unavailable (it is still experimental), fall back to
  the harness subagent tool and the Superpowers workflow unchanged.
  See `docs/engineering/orchestration.md` for the concept mapping.
- **The agent environment is user-owned.** During product work, do not install,
  enable, disable, copy, edit or remove plugins, skills, hooks, MCP servers,
  Claude/Codex settings or `AGENTS.md` unless the user explicitly requests that
  exact change. Superpowers owns the plan lifecycle and its artifacts: never
  build a parallel Yunari process, a project workflow skill, an alternate
  spec/plan directory, or a duplicate of its instructions elsewhere in the repo.
  Designs/specs live in `docs/superpowers/specs/`; executable plans in
  `docs/superpowers/plans/`; completed or superseded plans move to
  `docs/superpowers/plans/archive/` once no active or queued plan depends on them.
- Durable project truth lives under `docs/`; `docs/README.md` is the canonical
  map. `§N` requirement markers are stable; never renumber them. They live in
  `DESIGN.md`, and `design:md --cite` fails when a citation names a number with
  no marker.
- **Plans are contracts, not scripts.** Organize into phases of 3–5 tasks; each
  states outcome, owning symbols/landmarks, constraints, acceptance or failure
  modes, and verification. Avoid brittle line numbers, pasted implementation
  bodies, exact assertion text, staging recipes and speculative future edits —
  unless the item is itself a required invariant. A test count recorded as
  evidence that a case was collected is such an invariant; a count predicted
  before the code exists is not.
- **Orca is the project's orchestrator.** Supervise with a Run:
  `orca orchestration run-create --objective "<goal>"`, `orca orchestration
  worker-start --spec "<task>" --worktree current --agent <id>`, and `orca
  orchestration check --wait --types "worker_done,escalation,question"`. A Task
  has one authoritative Dispatch; release it only after an accepted settlement
  (`orca orchestration worker-release`), and recover a lost one with
  `dispatch-show` / `task-list`. `orca skills get orchestration` is
  the full contract. `.superpowers/` is gitignored, so each worktree has its own
  ledger: keep the card line current with `orca worktree set --comment`, because
  the root's cannot see a worker's. A worker's liveness is `orca worktree show`
  or `terminal wait`, never an mtime alone. The register stays
  `docs/product/backlog.jsonl`: Orca links issues and PRs to a worktree, it does
  not own a register, so link an existing issue rather than filing a row or an
  issue per worktree.
- **A dispatched agent is pulsed, not awaited.** The silence between dispatch and a
  notification is not evidence that work is happening. Check every running subagent on a
  cadence — roughly every 30 minutes of expected runtime, and immediately after any task
  that was expected to finish sooner. A check is three pieces of evidence, not a status
  field: the agent's state, the modification times of files it owns, and process
  telemetry for anything long-running. **An empty output file proves nothing** — a healthy
  subagent's transcript lands only at completion, and a wedged one leaves the same empty
  file as a healthy one still working.
- **Three failure shapes cost this its time, and each is caught by a pulse.**
  A subagent that returns **tool-call syntax as text** rather than executing it, and stops
  mid-task with its work uncommitted. A subagent that is **resumed and replays its own
  last state** forever, reporting the same summary with an unchanged tool count. And a
  subagent that completes having done **nothing at all** — no commit, no report, clean
  tree. In every case the work is on disk and recoverable, but only if someone looks;
  check rather than waiting to be asked.
- **An uncommitted working tree after a subagent stops is work in progress, not garbage.**
  Read the diff and the report before reconstructing anything: the finished agent's context
  is lost, and its successor inherits a draft rather than a starting point. If a dispatch
  record exists and the tree is dirty, that combination is the signal.
- **A long run holds the machine.** When a subagent runs a full browser suite, expect
  other work on the box to be slow, and do not read that slowness as a defect. If another
  session shares the machine or a browser server, a single sample of a flaky spec is not a
  measurement: re-run it against a previous sample of the same commit before reporting it.
- Keep the root session through one substantial usable outcome or active phase;
  start a fresh root only at a major phase boundary, when the user asks, or when
  context is unreliable — the SDD ledger and Orca's Run state are the handoff.
  In multi-agent mode Orca orchestrates (one Run, a Task per plan task, a
  Dispatch per attempt), workers
  implement disjoint tasks, and an independent reviewer checks contract and
  evidence, reporting findings to the coordinator rather than changing process
  or environment.
- Judge a defect's size when you observe it. **File a bug issue** when any of
  these holds: the cause is not established; more than one owner could fix it;
  the fix needs a design decision; it spans subsystems; it blocks running
  work; it would need a spec rather than a task. **Fix it on the fly** when all
  of these hold: the cause is named with `file:line`, the fix sits inside one
  owner, the correct behaviour is already specified, a regression test is
  obvious, and no work is lost and no data misrepresented. Say which side you
  took and why, in the commit. **If a third attempt at the same defect fails,
  record it in the same commit and say what was tried** — the third failure is
  the trigger, not the absence of a record, so it survives compaction and a
  fresh root.
- **What goes in the register.** **File it** if the user raised it, or you found
  it and it is not the task you are doing. The test is not effort — a one-line fix
  in an unrelated file still gets a row, and a large one inside the task you are
  already doing does not — but whether fixing it now means holding two problems in
  one head. **Do not file it** if it *is* the task (the plan or ledger owns it), or
  if it is a bug you introduced *in* this task and are fixing *in* it; found
  *while* doing the task is the first rule. **Withdraw it** only having reasoned
  with the user that we should not, with `detail` recording what they said — the
  decision is theirs, an agent's hand writes it. Provenance goes in `detail` as
  prose ("the user found this testing on a phone"), because that is what a
  controller with no memory of the finding needs.
- **Filing rides the commit you were already writing.** Put a finding you are not
  fixing in that commit's message as a `Discovered, not fixed:` trailer — or
  `Found by the user, not fixed:` for the user's — and materialise the row from
  it. One line in a message being composed regardless costs nothing; opening a
  file, running a command and choosing a category at the moment your context is
  most poisoned is what loses the finding. This is also the only durable path for
  the user's own feedback, since no `UserPromptSubmit` hook is registered and a
  message otherwise lives alone in the root session's context and dies with it.
- **The register is two files, split by state**
  ([`docs/product/backlog.jsonl`](docs/product/backlog.jsonl) holds what can still
  be worked; [`backlog-archive.jsonl`](docs/product/backlog-archive.jsonl) holds
  `verified` and `withdrawn`). Split by state rather than by count, because a count
  is a chore with no trigger: a row leaves the live file at the moment it reaches a
  closed state. **The archive is grepped, not read** — it is the anti-double-report
  record, so grep it before filing a row.
- **`verified` is enforced two ways, and the check is the stronger one.** A
  `verified` row needs a `check` naming a word from its own `title`, so a check of
  a capability *nearby* is not a check of this finding — that mistake cost two
  false "landed" reports, both caught by the user testing. It also needs
  `artefacts` naming a sha that resolves and is an ancestor of HEAD, which answers
  a question the check cannot: whether that work still exists on the mainline
  rather than on a branch that was lost. The check proves the named problem was
  addressed; the sha proves the commit is real. Neither substitutes for the other.
- A GitHub issue is an input surface for jotting an idea down, and never the
  register itself. A filed issue is pulled into the register when asked; an issue
  is closed with a comment naming the row and the check that ran, and the close
  reason alone records nothing. Do not duplicate a finding in specs, status or
  reports; plans may link it.
- A filed request is `undecided` until judged, and `covered` once the register
  owns it. An accepted request closes with a link to the spec, plan or row that
  now owns it; a declined one closes as `not planned` **and carries its reason in
  a closing comment** — the close reason alone says nothing, and a decision
  nobody can read is a decision lost. The register alone decides acceptance, so the
  queue keeps one owner. When an
  issue waits on a named plan or an unanswered decision, set `blocked` and say
  what it waits on.

## Architecture guardrails

- **One owner per concept.** Before any cross-cutting change, read
  `docs/architecture/ownership.md` and the existing owner before adding a type,
  key, default, action, route, helper, style property or schema value.
- `renderer-core` stays Fabric/DOM-free. The player may use `scene-fabric`, never
  editor UI/managers or an interactive `Canvas`.
- Fabric JSON is the persisted scene. No second simplified scene tree or
  write-back model.
- Persist authored state only. Telemetry, built ECharts options, playback,
  selection and viewport state are runtime/derived/transient, and raw ECharts
  options never enter persisted theme data.
- Providers acquire; the host owns scheduling, buffering and fallback. Missing or
  non-`ok` telemetry is never fabricated as zero/default data.
- Pre-release internal architecture may break cleanly; no compatibility glue
  solely to preserve superseded internal designs.

## Reuse before build

**Yunari is a product, not a framework to rebuild the platform under.** The
default failure is not a hard bug — it is judging a problem "simple", writing it
from scratch, and discovering three tasks later that it was a rabbit hole that
someone else had already mapped. That is the expensive kind of wrong: it looks
like progress while it compounds, and the refactor to undo it costs more than the
search would have. **Explore first, always.** A capability that *exists* has
still not been discharged by existing.

**The gate is about integration, not existence.** "A native feature exists" is
not an answer, and neither is "we could write it ourselves". The question is
whether anyone has solved *this shape* of problem — in this renderer, against
this host, under these constraints — and what they learned doing it. A capability
that still needs sampling, ordering, invalidation, disposal and ownership
decisions is exactly the undischarged case, because **that is where the work is**.
Native APIs usually work, which is precisely why checking one is not the end of
the search.

A **mechanism boundary** is an owner where a wrong decision is expensive and
invisible — nothing fails, it just renders wrong or leaks. Watchlist:
`scripts/reuse-gate.mjs`.

Before designing a change to one, work all seven rungs (owner, dependencies,
platform, ecosystem, comparison, probe, build) and record each result, including
the rungs that found nothing. **Rung 3 passing does not discharge rungs 4–5** —
that conditional is what made the rule skippable.

Land a note at `docs/decisions/NNNN-<slug>.md` before the first write; the hook
refuses until one claims the path. Template, and what needs no note:
[`docs/decisions/README.md`](docs/decisions/README.md). **The searches are the
evidence** — a note listing three libraries without saying what was searched, or
that nobody solved this shape, is worth nothing.

## Code and files

- Navigate with CodeGraph first, when available, for ownership, callers/callees,
  dependency paths and blast radius; language-server navigation for definitions,
  references and diagnostics; targeted `rg`/grep for exact strings, config keys,
  generated text and as fallback when graph data is unavailable or stale. **Read
  the actual source before editing it** — graph results locate code, they do not
  replace inspection.
- Do not dump whole files, trees, giant diffs or full test logs into context when
  a focused query or range suffices.
- Before adding a shipped dependency, verify its licence from package metadata and
  update `THIRD-PARTY-NOTICES.md` and `docs/engineering/dependencies.md`.
- Do not hand-edit `src/web/package-lock.json` (change manifests, then
  `npm install`) or `src/web/packages/*/dist/**`.
- Follow surrounding naming/import style; avoid unrelated formatting churn. No
  licence headers in source files. No re-export wrappers after moves except
  package public barrels.
- Avoid generic folders such as `helpers`, `common`, `utils`, `internal` and
  `shared`; name by responsibility.
- 500 lines is a signal and 800 is a stop for normal source files; proven
  vendored source may be an explicit exception.
- `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are enabled.
  Refuse invalid numeric input rather than coercing it to zero.

## Verification requirements

Superpowers owns the whole change lifecycle — brainstorm, spec, plan, execute
through subagents, track progress in its `.superpowers/sdd/` ledger, test, and
close the plan and spec out when it is done. These are Yunari-specific
evidence rules inside that lifecycle:

- Unit-test pure decisions and contracts; browser-test wiring and visible
  behaviour. Visible behaviour requires rendered/browser inspection, not only
  object counts or geometry assertions.
- A new regression test should fail when the fix is disabled before it is
  trusted.
- Use focused proof during implementation. Run the broad/full gate at the
  plan/milestone/merge boundary or for genuinely cross-cutting changes.
- Playwright previews built bundles; rebuild affected bundles after source
  changes and after reverting a deliberate break.
- Browser tests exercise the real host only where the test explicitly starts it.
- Screenshots are evidence, not cross-platform golden files.
- Report anything not actually verified.

## Commands

Run from `src/web/`; the scripts are `package.json`'s, so read them there rather
than trusting a copy. The one command that is not a script is the host:
`node packages/host/bin/yunari.js --no-browser`, after building it. See
*Important traps*.

## Important traps

- Host binary is `yunari-dashboard`; plain `yunari` is unrelated on npm. Build
  the host before running `bin/yunari.js`.
- Install Chromium with `npx playwright install chromium` if needed.
- Screenshot capture requires `YUNARI_CAPTURE=1` and `--workers=1`; capture
  only affected actions registered in `docs/evidence/screenshots/README.md`.
- Vite 8 uses Rolldown; `manualChunks` must be a function.
- Use `fileURLToPath` for file URLs on Windows.
- Symlinks are not reliable in tracked content in this repo.
- Bare gitignore patterns match at any depth.
- Playwright servers own fixed ports (`4173`–`4175` for the shared configs,
  `4215`–`4237` for the per-config and per-spec hosts). Two worktrees must not
  run the same Playwright project at once; a `strictPort` failure means another
  run, in this worktree or another, still owns the port.
- In PowerShell, single-quote Playwright `--grep` values containing spaces or
  `|`.

## Git

- Check status before staging. Stage explicit paths; never `git add -A` or
  `git commit -a`.
- Never discard user changes or use destructive git commands without explicit
  instruction.
- Use Conventional Commit titles, and inspect selected visual evidence before
  staging it.
- Propagate a changed decision to contradictory current docs/tests together.
- Pushing, publishing and opening a PR are external actions.
- **Creating or updating a GitHub issue is also an external action**, and the user
  has authorised it for agents: file, edit, label and close issues as
  `AGENTS.md`'s bug rule requires without asking first. It is still an external
  action, so name it in the commit and keep every claim in the body supportable —
  a cause you have not established is written as "cause not established", not
  guessed. Anything beyond an issue — a release, a wiki edit, a transfer, or
  anything on a repo other than this one — still needs the user.

## Communication and brevity

Be concise and factual. Surface assumptions, blockers, reuse decisions and
unverified behaviour early. Report outcomes and evidence, not a transcript.
Write the shortest text that preserves a decision or invariant; comments are
normally 1–3 lines and explain **why**, not what the code says. Never write
diary-style comments, debugging chronology or implementation narratives into
source, and do not repeat the same rationale across specs/ADRs/architecture/
comments. Current docs describe current truth; Git stores the story.
