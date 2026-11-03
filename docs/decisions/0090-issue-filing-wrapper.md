# 0090 — file an off-task report through one issue-filing wrapper

- **Date:** 2026-11-02
- **Status:** accepted
- **Paths:** `scripts/file-issue.mjs`

## Problem

An agent working a task can receive a defect report or feedback about a
different part of Yunari. The report must leave the working context as a durable
GitHub issue without the agent assembling `gh` flags, labels and a body by hand,
and without it quietly fixing the unrelated thing. The failure is quiet: a
hand-built call can target the wrong repository, omit `needs-triage`, or copy the
user's words into a public issue. Issues are public, so the reporter's message
must be recapped, never pasted, and machine-specific detail must be generalized
to the context a repro actually needs: a local absolute path becomes
`<repo>/...` or "the settings directory", a computer or account name becomes
"the authoring PC", and private addresses, serial numbers and tokens are
dropped.

## Rung 1 — internal owner

Searched: `.github/ISSUE_TEMPLATE/bug.yml`, `.github/ISSUE_TEMPLATE/request.yml`,
`.github/bug-report-template.md`, `gh issue create --help`, `rg "gh issue"`.
Found: the two issue forms own the fields and the labels a filed report must
carry (`bug`, `needs-triage`; `needs-triage`). `bug-report-template.md` is the
same shape in a form `gh` can post, and its header already tells an agent to run
`gh issue create --title … --body-file … --label bug,needs-triage`. No helper
owns the call itself. `GH_REPO` is exported in this environment and points at a
different repository, so every call must pass `--repo` explicitly or the issue
lands in the wrong backlog.

## Rung 2 — installed dependencies

Searched: `gh issue create --help`, `gh --version` (2.103.3), `package.json`
scripts.
Found: `gh issue create` owns authentication, the API call, label attachment,
screenshot upload (`--attach`) and printing the new issue URL. `--body-file`
accepts a path or `-` for stdin; `--repo` accepts `[HOST/]OWNER/REPO`. `gh` is a
host tool, not a workspace dependency, so no package is added and no API token
is handled by the script.

## Rung 3 — native platform

Searched: Node `child_process.spawnSync`, `os.tmpdir`, `fs.mkdtempSync`.
Found: an argv array passes values without shell quoting, which matters because
report text crosses the PowerShell and Bash tools. A temporary body file is
needed because stdin already carries the report; `os.tmpdir()` is the only
portable location (`/tmp` is not a Node path on this box). Node does not know
which repository the report belongs to, so the wrapper must resolve it.

## Rung 4 — public solutions

Searched: `gh issue create --help`; the issue forms and template above; the
`--template` flag.
Found: `--template` selects a legacy markdown template and does not populate the
form fields or labels, so it cannot replace the wrapper. GitHub's Issue Forms
API accepts field values only through the browser form; the REST/GraphQL API
takes a markdown body, which is what the template already provides. Tracker
importers and CLI wrappers in other projects follow the same shape: one command
that owns repository, labels and body assembly.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Thin wrapper over `gh issue create`, taking an agent recap | Uses the installed CLI and the forms' labels and headings; no token or HTTP code | Resolve the repo from `origin`; refuse an interface that encourages pasting the user's words | Chosen |
| Document the raw `gh` command in `AGENTS.md` | No new file | Every agent re-assembles flags and `GH_REPO` can send the issue elsewhere; nothing keeps the report private | Rejected |
| Call the REST API directly | No CLI dependency | Re-implements auth, paging and label handling; needs a token outside the host | Rejected |
| Local backlog file or note | No network | Violates the repository rule that GitHub Issues is the only backlog | Rejected |

## Rung 6 — smallest probe

`--dry-run` prints the repository, title, labels and body without invoking `gh`;
the unit test exercises that path and the generated body for both kinds. The
live path is the documented `gh issue create` argv, not a new protocol.

## Decision

Build `scripts/file-issue.mjs` as a wrapper, not a second backlog:

- `--repo` defaults to the GitHub owner/name parsed from `origin`, falling back
  to `peterng1618/yunari`; the script never relies on `GH_REPO`.
- `--kind bug` adds `bug,needs-triage`; `--kind request` adds `needs-triage`,
  matching the issue forms.
- `--recap`/`--recap-file` is the agent's paraphrase; the old `--report`
  spelling is refused so raw user text has no accepted interface. A full
  `--body`/`--body-file` is posted unchanged, for an agent that investigated.
- The same check refuses a recap or body that names this machine's host or
  account, or carries a user-profile path, UNC share, private IP or MAC address.
  Shapes it cannot recognise (serial numbers, tokens, an unrelated computer
  name) are banned in `--help` and `AGENTS.md` instead.
- `--attach` passes a file the reporter sent to `gh issue create`; the wrapper
  does not copy it, so the upload path stays the CLI's.
- The generated body is the recap under `What`, one `Source` line (a user
  report or the agent's own finding) and branch/commit provenance. It invents no
  cause, journey or done answer; `--journey`/`--done` are added only when the
  agent supplies them.
- `--dry-run` is the preview; the script creates the issue otherwise, because
  the agent's task already authorises recording the report.
