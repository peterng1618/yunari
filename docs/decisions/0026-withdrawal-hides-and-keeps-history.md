# 0026 — A withdrawal hides the item and keeps its history

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/store-worker/src/routes/me.ts`, `src/web/packages/store-worker/src/db/items.ts`, `src/web/packages/store-worker/src/routes/public.ts`, `src/web/packages/store-worker/tests/unpublish.spec.ts`

## Problem

A listed item can be withdrawn by its author or removed by the owner. What the
withdrawal does to the listing, the package URL, the bytes, the download counter
and copies already installed was undecided (#184), so a reader could not tell
whether a 404 meant "gone" or "still billed to the author".

## Rung 1 — internal owner

Searched: `routes/me.ts` (`unpublish`, `publish`), `routes/admin.ts`
(`remove`, `restore`), `db/items.ts` (`setStatus`, `bumpDownloads`,
`publishedListings`), `routes/public.ts` (every public read) and
`tests/unpublish.spec.ts`.

Found: the transitions already exist and are guarded by `setStatus`'s `from`
precondition. Unpublish moves only `status`; `item_version`, `downloads`,
`favorite` and the R2 objects are untouched. Every public read filters
`status = 'published'`, and `bumpDownloads` carries the same predicate, so a
download attempted after withdrawal is refused and does not count. Republish
restores the same versions and the same counter.

## Rung 2 — installed dependencies

Searched: D1/SQLite semantics used by the guarded writes, and the R2 helper
`openObject`/`cancelBody`.

Found: there is no cascade on `status`; the row and its versions are one
record. A refused package stream is cancelled rather than left half-sent.

## Rung 3 — native platform

Searched: the host's install path (`packages/host/src/themes/install.ts`) and
the display's read of installed themes.

Found: an installed theme is copied into the host's library and rendered from
those local bytes; rendering never calls the store. A withdrawn package URL
therefore cannot break a copy that is already installed.

## Rung 4 — public solutions

Searched: the three options put to the owner on 2026-10-31 (keep counter and
installs; remove item and counter; block installs only).

Found: the options were a product choice rather than a library question. The
owner chose the first: the listing and new installs stop, the record survives.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep the record, counter and bytes; refuse new installs | current code already does exactly this | make the counter rule explicit in a test | chosen |
| Delete the item and its counter | destroys history and restore | a second deletion path through versions, favourites and R2 | rejected |
| Block installs only, leave the listing | leaves objectionable content public | contradicts every public read's `published` filter | rejected |

## Rung 6 — smallest probe

`tests/unpublish.spec.ts` seeds a published item at 4 downloads, withdraws it,
and reads every public path as 404 while asserting the counter, favourites,
versions and R2 objects survive. The test now also asserts the refused package
GET left the counter at 4, which is the one behaviour the original case did not
name.

## Decision

A withdrawal is a status transition, not a delete:

- the item leaves every public read — listing, `item.json`, thumbnail and
  package URL — and new installs stop;
- the version rows, package bytes, thumbnail, favourites and the download
  counter stay, so a republish restores the same item;
- a download attempted after withdrawal is refused before the body streams and
  does not increment the counter;
- copies already installed keep working, because the host renders from its own
  library and never calls the store at display time.

`removed` remains the owner's verdict and is refused by author republish; the
author's own `unpublished` state is the reversible one.
