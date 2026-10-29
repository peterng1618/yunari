# Superpowers specs

Superpowers owns Yunari's design/spec workflow. New design/spec artifacts belong
here; do not create a parallel `.agents/specs/` system.

## Where a spec stands

Every spec opens with a `- **Status:**` line. It states **where the spec stands,
never what is left** — task counts, commit shas and "Task 4 open" all have a
single owner already (the spec's Acceptance section, its plan, the ledger,
`.superpowers/sdd/` dispatch records), and repeating them here would be a second
copy to keep in sync.
Keep it to one state plus, at most, a link to the plan.

| Status | Means |
|---|---|
| `draft` | Written and reviewed, no plan yet, and not the active work |
| `active` | Its plan holds a live Orca Dispatch |
| `in progress` | Its plan exists but has no live dispatch record |
| `implemented` | Every acceptance item is met or explicitly carried elsewhere |
| `backlog` | Review notes, not accepted requirements — `2026-09-24-editor-behaviour-review.md` |

`implemented` is a claim about evidence, not about checkboxes, and it is the only
state that needs a judgement: a spec is not implemented because its tasks look
done, but when its Acceptance section records what was actually observed. Write
that observation in the same commit that lands the last item, and set the status
in that commit — the two move together, so neither can go stale alone.

## Archiving

Specs stay here after their work ships. `docs/product/requirements.md` and
`docs/architecture/ownership.md` link **into** this directory (`Design: [...]`
lines), and a shipped spec is the design record for the requirement it produced —
moving it breaks those links and orphans the requirement.

Move a spec to `archive/` only when its requirements have been promoted into
`docs/product/requirements.md` **and** its plan is archived, and update the
inbound `Design:` links in the same commit. Nothing in the directory currently
qualifies. `archive/` mirrors `plans/archive/`; create it with the first move.

Delete a spec only when it is neither a current contract, nor a requirement's
design record, nor a useful review backlog — and then delete its `Design:` links
too, reporting the requirement as having lost its design.
