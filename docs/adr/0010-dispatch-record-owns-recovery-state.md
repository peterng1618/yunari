# ADR-0010: A live dispatch record owns recovery state

**Status:** Superseded 2026-10-29 — Orca orchestration's durable Run/Task/Dispatch
records own recovery state; dispatch-record files, the PreCompact/SessionStart
hooks and `scripts/sdd-checkpoint.mjs` are retired. Kept as history.

## Context

Subagent-driven execution keeps its dispatch state — which agent is working,
against which base commit — only in the controller's context. The SDD ledger
records rulings and completions, never what is running, so after compaction a
resumed controller cannot distinguish an agent still running from one that
finished from one whose work was lost. That ambiguity produced a working-tree
edit nobody could account for.

Claude Code's `PreCompact` cannot make the model take a turn, so state cannot be
requested from the controller at compaction time. `SessionStart` stdout does
reach context, so the read-back half can be an injection.

## Decision

- **A live dispatch record is the sole authority for which plan is active.**
  Several plans may be active at once across worktrees; no shared file names
  one. A record under any plan makes that plan active. Ledger mtime is not a
  signal at all.
- The record is written by the controller, one file per in-flight agent, under
  the plan's git-ignored SDD workspace. `SubagentStart`/`SubagentStop` carry
  `agent_id` and `agent_type` but not the task, plan or base commit, so lifecycle
  hooks cannot author the record — they can only audit it.
- A record older than its TTL is an **expired recovery artifact**, not evidence
  of a live agent. Expired records are reported as expired rather than dropped,
  because "nothing was ever dispatched here" and "a dispatch was abandoned here"
  are different facts and only the second one is actionable.
- Controller-oriented recovery hooks no-op inside a subagent. Project hooks run
  in subagents, so a worker that compacts must not receive instructions about
  reconciling other agents. `agent_id` presence is the discriminator.
- Recovery state stays inside the SDD workspace, which is self-ignoring. It is
  scratch, not tracked project content.

## Consequences

A live dispatch stays recoverable regardless of how long its ledger has been
quiet, and a dispatch recorded against the wrong plan is surfaced as a
contradiction instead of silently becoming that plan's authority.

The one failure recovery cannot repair is a dispatch the controller never
recorded: a `SubagentStop` audit for unrecorded agent ids is the only mechanism
that could catch it, and is not implemented.
