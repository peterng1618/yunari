# 0037 — An unreadable display file is reported, not shown as empty

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/server.ts`

## Problem

`display-clients.json` holds the host's displays and their credentials.
`readDisplays` already refuses writes when the file cannot be read, and `list()`
fails closed to an empty array. The active-theme map therefore answers the same
`displays: []` for a fresh install and for a corrupt file, and a settings page
cannot tell the two apart: it draws a healthy empty library while every repair
refuses. The flag must travel with the same read that produced the list.

## Rung 1 — internal owner

Searched: CodeGraph for `DisplayStore`, `readDisplays`, `activeThemeMap`, and
`listDisplays`; read `host/src/settings/displays.ts`,
`host/src/server.ts`, `editor/src/theme-library-client.ts`.
Found: `readDisplays` is the one reader and already returns `{ displays, failure }`.
`DisplayStore` exposed only `list()`, discarding `failure`; `activeThemeMap` is
the route's one owner of the answer. Extending `DisplayStore` keeps the fact at
the reader that produces it rather than adding a second read or a parallel
reader.

## Rung 2 — installed dependencies

Searched: Node's `fs/promises` types and the existing atomic-write helper.
Found: no failure signal beyond the thrown error the store already converts into
`failure`; nothing donated for surfacing it to a browser.

## Rung 3 — native platform

Searched: Node `fs` error codes, HTTP status semantics.
Found: a 500 on the whole route would hide the readable default theme and every
other setting on the page; there is no status that says "this one file is
corrupt" without a body field.

## Rung 4 — public solutions

Searched: HTTP API conventions for partial-data warnings (`207 Multi-Status`,
JSON:API errors, `Warning` header), and comparable local-dashboard settings
surfaces.
Found: no standard carries a per-file repair instruction to a settings page;
`207` describes multiple resources, not one partially readable store. A body
boolean beside the list is what clients actually consume.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Fail the route with 500 | Breaks every other setting on the page | Separate partial responses | Rejected |
| `Warning` header | Invisible to the page's render path | Client plumbing, no repair text | Rejected |
| Second `list()` caller reading the file again | Races and two reads | Duplicate failure parsing | Rejected |
| `state()` on the store, one flag in the map | Same read, same owner | None | Chosen |

## Rung 6 — smallest probe

Covered by tests rather than a disposable probe: `displays.test.ts` asserts
`state()` distinguishes missing (`unreadable: false`) from corrupt
(`unreadable: true`), and `server.test.ts` asserts the route answers
`displayFileUnreadable: false` for a fresh host and `true` after the file is
corrupted, reading the same instance.

## Decision

Reuse `readDisplays` and its `failure` through a `DisplayStore.state()` method;
`activeThemeMap` answers `displayFileUnreadable`, and the editor's settings page
names the file and the repair. The flag is always present (`false` when
readable) so a client never has to infer, and absent on an older host so it
reads as nothing to report.
