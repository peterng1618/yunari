# 0027 — Automated checks at submission, moderation after report

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/store-worker/src/routes/me.ts`, `src/web/packages/store-worker/src/routes/admin.ts`, `src/web/packages/store-worker/src/routes/public.ts`, `src/web/packages/theme-package/src/index.ts`

## Problem

A valid package can carry objectionable pixels past every automated validator:
a thumbnail is an image and a background is a video, and nothing the host
checks reads what they depict. A verified author's item auto-merges on green
validation, so nobody looks at it before it is listed (#183). Who looks, and
when, was undecided.

## Rung 1 — internal owner

Searched: `routes/me.ts` (version request, upload, finalize, unpublish),
`routes/admin.ts` (approve, reject, remove, restore), `routes/public.ts`
(every read), `db/items.ts`, `theme-package/src/index.ts`, and the store-worker
tests for upload, finalize, thumbnail and admin actions.

Found: submission already refuses an invalid envelope, an over-byte package, a
non-PNG or oversized thumbnail, an item name over 200 bytes, a bad version plan,
an over-quota author and a body that does not match its declared length. The
package bytes are hashed and stored but the ZIP is never opened server-side.
There is no report table or report route; the owner's `remove` action is the
only takedown, and it carries a reason the author sees.

## Rung 2 — installed dependencies

Searched: the Workers ZIP and image facilities, plus the `@yunari/theme-package`
reader.

Found: the package reader parses the archive and media on the author's machine
at import; the store worker does not import it. Opening and decoding every
uploaded archive and video in the Worker would add CPU time, memory and attack
surface without answering the actual question: no installed decoder says
whether an image is objectionable.

## Rung 3 — native platform

Checked: `DecompressionStream`, `ImageDecoder` and `createImageBitmap` in the
Worker runtime.

Found: the formats are decodable, but a decoder yields dimensions and pixels,
not a moderation verdict. Native decoding cannot replace a report or a human.

## Rung 4 — public solutions

Searched: the three options put to the owner on 2026-10-31 — human review before
listing, automated checks only with post-report handling, or an external
moderation service.

Found: the owner chose automated checks with post-report handling. Verified
authors keep auto-merge; nobody is required to look at pixels before an item is
listed.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Automated submission checks; review only after a report | matches the existing status machine and owner actions | a report intake route does not exist yet | chosen |
| Human review of every submission | contradicts verified auto-merge and adds a queue with no owner | staffing and SLA outside the codebase | rejected |
| Third-party image moderation | no reviewer role needed | a new credential-bearing external dependency, and video still unread | rejected |

## Rung 6 — smallest probe

The store-worker suites already prove every automated refusal: envelope,
size, thumbnail, quota, rate limit and content-length. They also prove the
owner's `remove` transition sets a reason the author is refused with. No test
asserts anything about pixels, because nothing reads them.

## Decision

- Submission is gated only by automated checks: schema, version, quotas, byte
  caps, thumbnail format and size, ownership and length. A verified author's
  item still publishes on green finalize.
- Objectionable imagery is handled after listing, on report. Until the report
  intake exists, the owner's `remove` action is the takedown path, and its
  reason reaches the author.
- No human pre-list review and no external moderation service are added. A
  report route and its triage are follow-up work; the policy decision is that
  they happen after listing, never before it.
