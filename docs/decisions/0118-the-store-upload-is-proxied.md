# 0118 — A store upload is proxied through an authenticated Worker route

- **Date:** 2026-10-25
- **Status:** accepted 2026-10-25
- **Paths:** `src/web/packages/store-worker/src/routes/me.ts`,
  `src/web/packages/store-worker/src/storage/`,
  `src/web/packages/store-worker/src/db/quota.ts`,
  `src/web/packages/store-worker/migrations/`,
  `src/web/packages/host/src/themes/store-client.ts`,
  `src/web/packages/host/src/catalogue/submit.ts`

## The problem

The author flow asked the Worker for a presigned R2 PUT, then uploaded directly
to R2. A presigned PUT signs the method, key and expiry; it does not carry a
maximum object size. Anyone holding the URL could write a multi-gigabyte object
that no version row accounted for, and the quota counted only finalized
versions. There was no cleanup for abandoned objects, and the Worker held R2 S3
credentials it no longer needed.

The shape is not "add a limit to the presign". It is choosing which party is
allowed to see the bytes: the direct path cannot bound them, and moving the
bytes through the Worker changes the request limit, the auth model and the
object lifecycle together.

## Rung 1 — Yunari

Searched: `store-worker/src/routes/me.ts` version and finalize branches;
`storage/presign.ts`; `storage/keys.ts`; `db/quota.ts`;
`migrations/0001_catalogue.sql`; `host/src/themes/store-client.ts`;
`host/src/catalogue/submit.ts`; the Worker tests.

Found:
- The version request presigns `packages/<item>/<version>.zip` with only `host`
  signed, records a `presign_event`, and returns the URL.
- Finalize reads and decodes the body, HEADs the object, then hashes it.
- Quota sums `item_version.bytes` only; pending presigns are invisible.
- `item_version` already has `package_key`, so the download path can store a
  different key without a second schema.
- The host `upload(url, bytes)` sends a bare PUT with no Authorization header.
- No scheduled handler and no cron trigger exist.

## Rung 2 — dependencies

Searched: `store-worker/package.json`, the lockfile, Workers bindings in
`wrangler.toml`.

Found: the Worker already has `aws4fetch` for presigning and D1/R2 bindings.
`aws4fetch` is not needed for a proxied upload. D1 supports the extra table and
indexes; R2 `put` accepts a `ReadableStream` body.

## Rung 3 — platform

Searched: Cloudflare Workers request/response limits; R2 Workers API `put`;
R2 presigned URL docs; D1 migrations; Cron Triggers; Cache API.

Found:
- A Worker request body on Free/Pro is limited to 100 MB; the archive cap is
  95 MiB, so the whole package fits through the Worker with headroom.
- `BUCKET.put(key, request.body)` streams the body server-side; the Worker does
  not need to buffer it.
- A presigned PUT has no size field that R2 enforces as a maximum; it has a
  5 GiB single-part object ceiling, which is not a quota.
- Cron Triggers run a `scheduled` export; a 15-minute trigger is enough to
  delete abandoned pending objects.
- The Cache API can serve `/index.json` without D1 on a hit.

## Rung 4 — ecosystem

Searched: Cloudflare's "Upload objects" and "Limits" docs; the R2 presigned-URL
guide; the Cloudflare docs issue clarifying presigned URL limits; common
direct-to-R2 upload examples; S3 presigned POST policy comparisons.

Found:
- Cloudflare documents direct presigned PUTs as the way to avoid the Worker
  request-body limit. That is exactly the trade this app cannot take: direct
  upload is unbounded by the presign.
- The docs' own caveat says a Worker cannot receive more than 100 MiB, and the
  R2 docs issue confirms the presigned path's advantage is bypassing that
  limit, not enforcing a smaller one.
- The S3 alternative, a presigned POST policy, can carry a
  `content-length-range`, but R2 does not implement POST object uploads. There
  is no equivalent policy to sign.
- Direct-to-R2 examples assume a trusted client and a separate lifecycle rule.
  A trusted client is not the store's author model.
- No ecosystem package adds size-bounded presigned PUTs; the bound has to be a
  proxy or a bucket lifecycle rule that still cannot reject before the write.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Keep presigned PUT, add a lifecycle rule | No protocol change | A 5 GiB write still lands; lifecycle is delayed | Quota bypass and storage cost before deletion | Rejected |
| Presigned POST policy with `content-length-range` | Native S3 shape | R2 does not support POST object uploads | The flow cannot be built | Rejected |
| Proxy through the Worker with `Content-Length` check | Hard bound before body read; reuses session auth | Worker request limit; upload consumes Worker CPU/bandwidth | 95 MiB must stay below the 100 MB request limit | Chosen |
| Chunked upload through several Worker requests | Bypasses the single-request limit | Multipart state, ordering and cleanup | Much larger protocol and failure surface | Rejected |
| Signed upload token checked by a separate gateway | Could bound at the edge | A second service and a second auth model | More moving parts than the Worker already is | Rejected |

## Rung 6 — probe

The audit read the Worker routes and confirmed the presign has no size field
and quota reads only finalized rows. Cloudflare's published limits put the
Worker request body at 100 MB on Free/Pro and the archive cap at 95 MiB, so the
proxy fits with 5 MiB of headroom. Task 6.2's tests are the probe: a
`Content-Length` over 95 MiB answers 413 before the body is read, a missing
length answers 411, and a valid PUT stores `pending/<uploadId>.zip`. Task 6.4
proves an abandoned object is deleted after the TTL. No live upload was made
before this note.

## Rung 7 — build

The Worker bundle gains one route and one cleanup module; `aws4fetch` and the
R2 S3 secrets leave the Worker. D1 gains `0002_proxied_uploads.sql`.
`wrangler.toml` gains a cron trigger. The host client changes its upload call
to send the session token and an explicit `Content-Length`; the package bytes
and the 95 MiB cap stay unchanged.

## Decision

The version request reserves a pending upload row and returns
`<store-origin>/api/me/uploads/<uploadId>`. The host PUTs the package to that
authenticated route with an explicit `Content-Length`; the Worker refuses a
missing or over-cap length before reading the body, streams the body to
`pending/<uploadId>.zip`, records the actual size, and leaves it pending.
Finalize reads that key, writes `item_version.package_key`, and replaces the
reservation with the actual bytes. Downloads read `package_key`.

The reason is the bound, not the proxy: a presigned PUT cannot refuse a write
before it happens, and any later cleanup still lets the bytes land. The Worker
is the only party in this system that can say no while the client is still
sending.
