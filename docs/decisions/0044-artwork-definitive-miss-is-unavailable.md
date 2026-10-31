# 0044 — A definitive artwork miss is reported as unavailable, not as a wait

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:**
  - `src/web/packages/host/src/providers/media/smtc-helper.ts`
  - `src/web/packages/host/src/providers/media/provider.ts`
  - `src/web/packages/host/src/providers/media/smtc-helper.test.ts`
  - `src/web/packages/host/src/providers/media/smtc-helper.windows.test.ts`
  - `src/web/packages/host/src/providers/media/provider.test.ts`

## Problem

The SMTC helper already knows two artwork misses are definitive: the image
exceeded the framing cap, or the retryable miss repeated to its limit. Both
branches cache the negative and emit nothing:

```powershell
if ($chunks.Count -gt ${SMTC_ARTWORK_RAW_BYTES}) { return @{ status = 'over' } }
...
if ($attempt['count'] -ge $ArtworkRetryLimit) {
  $lastArtwork[$sessionId] = $key
  $artworkAttempts.Remove($sessionId)
}
```

The provider cannot see that fact, so `media.artwork` answers the retryable
message forever:

```ts
return this.#artworkUrl === undefined
  ? { sensorId, timestamp, status: "missing", message: WAITING_ARTWORK_MESSAGE }
  : text(this.#artworkUrl);
```

A display binding `media.artwork` therefore waits for a picture the helper has
already proved it will not read. The fact must travel from the branch that owns
it to the sample that reports it, without turning a genuinely pending read into
a permanent failure.

## Rung 1 — internal owner

Searched: CodeGraph/Read for `Try-EmitArtwork`, `Get-ArtworkResult`,
`WAITING_ARTWORK_MESSAGE`, `smtcArtworkLine`, `#ingest`, `#sampleOf`,
`parseFrameUnavailable`; read `media/smtc-helper.ts`, `media/provider.ts`,
`media/artwork.ts`, `frame/rtss.ts`, `frame/provider.ts`,
`renderer-core/src/types.ts`.
Found: `Try-EmitArtwork` is the one place the definitive/retryable distinction
exists, and `#sampleOf` is the one place `media.artwork` status is produced.
Prior art in this repo for a helper-reported reason is RTSS:

```ts
[Console]::Out.WriteLine('{"kind":"unavailable","reason":"' + $reason + '"}')
```
```ts
/** The reason from an `unavailable` line, or undefined for any other line. */
export function parseFrameUnavailable(line: string): string | undefined {
```

That line describes the whole adapter, not one track. `SensorStatus` already
donates `"missing" | "stale" | "error" | "unavailable"`; no new vocabulary is
needed.

## Rung 2 — installed dependencies

Searched: the host's installed dependencies and `packages/host/src/providers/`;
no package reads SMTC or maps media status. The only donated behaviour is
`@yunari/renderer-core`'s `SensorStatus` union and the sample shape.
Found: nothing owns this acquisition or this status decision; there is no
dependency to reuse or extend.

## Rung 3 — native platform

Searched: `GlobalSystemMediaTransportControlsSessionMediaProperties.Thumbnail`
(Windows.Media.Control), the existing PowerShell line protocol, and
`ConvertTo-Json` in the helper.
Found: `Thumbnail` is an `IRandomAccessStreamReference` and the platform exposes
no state saying the thumbnail is permanently unreadable; an absent thumbnail
and a failed read are the integration's to classify. The helper's stdout is
already the only channel back (the supervisor has no command channel), so the
platform leaves the fact unsolved.

## Rung 4 — public solutions

Searched: Microsoft Learn "Integrate with the System Media Transport Controls"
and the `Thumbnail` property reference; W3C Media Session API
(`MediaMetadata.artwork`, the fetch-image algorithm); the
`Gyom03/windows-media-sessions` line-delimited JSON protocol; the
`cascadiacollections/shoutkit` PR #100 artwork load policy.
Found: SMTC exposes only the stream reference. W3C says "If no images are
fetched in the fetch image algorithm, the user agent MAY have fallback behavior
such as displaying a default image" — a display fallback, not a per-track
failure signal to the caller. The `windows-media-sessions` protocol carries
`thumbnail` as optional data with no failure state. Shoutkit #100 does separate
transient misses from failures ("retry transient misses, and fall back to
station art when album-art loading fails"), which is the same distinction this
issue needs. No existing protocol can be reused here; the acquirer must emit
it.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Reuse RTSS's `kind: "unavailable"` | Same wire shape | Describes the whole helper, has no session/track identity, would mark a healthy session unavailable | Rejected |
| Provider synthesizes `unavailable` after N polls | No protocol change | Duplicates the helper's retry count, invents a timing rule, and can call a slow-but-real thumbnail permanent | Rejected |
| Emit `artwork-miss` with `sessionId` and `reason` from the existing definitive branches | The fact stays at its owner; provider maps it to status | Provider must map the session to the selected track identity | Chosen |
| Put full track identity in the miss line | One line is self-contained | Re-spells `trackKeyOf` normalization on both sides and can drift | Rejected |

## Rung 6 — smallest probe

The existing Windows harness runs the real `SMTC_ARTWORK_FUNCTIONS` with
`Get-ArtworkResult` stood in, which is enough to observe the definitive
branches without a live thumbnail. It is extended to require one
`artwork-miss` line for over-cap, one for an exhausted retry, and none for a
retry that later succeeds. The provider tests drive the same lines through
`#ingest` and assert the resulting samples.

## Decision

`Try-EmitArtwork` writes `{"kind":"artwork-miss","sessionId":…,"reason":"over"|"exhausted"}`
at the two points where it already caches a definitive negative. The provider
parses that line, keys it by the selected track identity (the session line that
preceded it supplies the track), and:
- answers `status: "unavailable"` with a reason when the selected track has a
  definitive miss, and
- keeps `status: "missing"` and "Waiting for this track's artwork." for a
  merely-not-yet miss.

A definitive miss also suppresses the one artwork-request restart, since the
helper has nothing left to read for that track. No value, text or URL is
invented.
