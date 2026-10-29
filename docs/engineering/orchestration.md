# Orchestration: Superpowers inside Orca

Two layers, one owner per decision. Superpowers orchestrates **within a plan**;
Orca orchestrates **the runtime those steps run on**.

## Ownership

| Concern | Owner | Where it is recorded |
|---|---|---|
| Brainstorm, spec, plan, task briefs, per-task review gate, fix loop, final review, finish menu | Superpowers | `docs/superpowers/`, the SDD ledger |
| Worktrees, worker dispatch, Run/Task/Dispatch state, waits, settlement | Orca | Orca runtime; `task-list`, `dispatch-show` |
| Rulings, completions, deferred minors | Superpowers | `<workspace>/progress.md` |
| What is accepted | The register | `docs/product/backlog.jsonl` |

Superpowers' `subagent-driven-development` and `dispatching-parallel-agents`
are lifecycle contracts: they define what a dispatch must contain, when a review
gate blocks the next task, and how a fix loop terminates. Orca is the transport
and durable state for those dispatches. Neither replaces the other.

## Concept mapping

| Superpowers step | Orca call | Rule |
|---|---|---|
| Worktree setup (`using-git-worktrees` Step 0) | detected linked worktree | A worker already inside its worktree skips creation. |
| Worktree setup (Step 1a) | `orca worktree create --no-parent` | Orca is the native tool; do not also call `EnterWorktree` or `git worktree add`. |
| Implementer dispatch (SDD step 1) | `worker-start --spec "<task brief>" --worktree current --agent <id> --model <id>` | One Orca Task per plan task; the brief file is the requirements source. |
| Implementer report | `worker_done --outcome succeeded\|failed` | `succeeded` is DONE/DONE_WITH_CONCERNS; `failed` is BLOCKED. Never encode failure only in prose. |
| Task review (SDD step 3) | a second Orca Task + `worker-start` | The reviewer receives the brief, report and review-package paths. `worker_done` does not replace this gate. |
| Fix rounds 1–3 (resume implementer) | follow-up work on the same settled worker/terminal | The report file remains the memory if the worker was released. |
| Fix rounds 4–5 (fresh implementer) | new Dispatch, higher model | Carry the brief, report and open findings. |
| Parallel investigations (`dispatching-parallel-agents`) | one top-level worktree per domain | Never two implementers in one worktree; they share a branch. |
| Progress recovery | SDD ledger + `git log`, `task-list` + `dispatch-show` | Plan state and worker state have separate owners. |

## Conflict rules

1. **One dispatch authority per task.** Do not spawn a harness subagent for work
   already running in an Orca Dispatch, and do not start an Orca Dispatch for a
   task a harness subagent is doing.
2. **One implementer per worktree.** Orca parallelism is across worktrees and
   plans. Inside a worktree the plan's task loop stays sequential.
3. **Orca `completed` is not reviewed or merged.** The Superpowers review gate
   decides when a task is complete; `finishing-a-development-branch` presents
   the merge/PR/keep menu to the human.
4. **The ledger is not dispatch state.** Orca's Run survives restarts; the
   ledger survives compaction and restart because it is a file. Record rulings
   and completions there, workers and dispatches in Orca.
5. **Cleanup belongs to Orca.** After a land, `orca worktree rm`; never
   `git worktree remove` or a git-level prune on an Orca path.
6. **Merge, push and discard stay human decisions**, even when a worker settled
   successfully. The finishing skill's menu is the only path.
7. **Orca orchestration is experimental.** It needs Settings → Experimental.
   When it is unavailable, fall back to the harness subagent tool and the
   Superpowers workflow unchanged; do not fake Orca provenance.
8. **A settled worker is reusable, not a new agent.** Reuse the terminal for the
   next task or fix round when Superpowers says to resume; release it only after
   its findings are ledgered.
9. **No winner-picking fan-out.** Do not send one prompt to several agents in
   parallel to compare their results and keep the best. A task has one
   implementer Dispatch with an explicitly chosen model; diversity of opinion
   comes from the separate reviewer Dispatch, not from racing implementers.

## Per-plan sequence

1. Superpowers writes the plan (`writing-plans`); the plan file stays the task
   authority.
2. Create the worktree with Orca (or verify the worker is already in one).
3. Coordinator: `orca orchestration run-create`, then one Orca Task per plan
   task.
4. Per task: implementer Dispatch → `worker_done` → review Dispatch → review
   clean → ledger `Task N: complete`. Findings enter the Superpowers fix loop.
5. Final whole-branch review as one Dispatch on the most capable model; one fix
   wave; delete the plan workspace.
6. Human chooses merge/PR/keep. After a land, `orca worktree rm`.

Reference: <https://www.onorca.dev/docs/cli/orchestration> and
`orca skills get orchestration`.
