# 0093 — preview_asset answers a video with the row's own still

- **Date:** 2026-11-03
- **Status:** accepted
- **Paths:** `src/web/packages/mcp/src/tools/assets.ts`

## Problem

`preview_asset` fetches a finder result's bytes and returns them only when the
filename says `image/*`. A video row therefore answers an error even though the
same row already carries its poster still in `AssetRef.preview`. A caller that
wants to judge a clip before importing it has to fetch that URL itself, which is
the host's job. A wrong choice here is quiet: the tool reports "not an image"
while the picture the caller asked for is already in the reference.

## Rung 1 — internal owner

Searched: CodeGraph for `previewAsset`, `AssetRef`, `encodeRef`; and the host's
asset routes.

Found: `previewAsset` is the only owner, and `AssetRef.preview` is populated by
`searchAssets` from every finder row but read nowhere — the field exists for
exactly this answer. The host already serves Wallpaper Engine stills at
`/api/wallpaper-engine/item/<id>/preview`; grid sources publish their own
preview URL (for example a Pexels poster JPEG). No second still extractor is
needed: the row's preview is the source's own answer.

## Rung 2 — installed dependencies

Searched: Node 22 `fetch` and `AbortSignal.timeout`; the host's
`extractVideoFrame` (`packages/host/src/themes/video-frame.ts`).

Found: `fetch`/`AbortSignal.timeout` are the runtime's, already used across the
MCP client. `extractVideoFrame` decodes a poster from video bytes with bundled
ffmpeg, but it belongs to theme packaging and needs the *average* frame rate of
a video the host has already normalised; pulling it into a finder preview would
download the whole clip and duplicate the source's own still job. It stays where
it is.

## Rung 3 — native platform

Searched: the browser fetch API and `Content-Type` handling; Node's `fetch`.

Found: the platform supplies both the request and the media type. It does not
decide policy: schemes, size and failure presentation stay with the tool.

## Rung 4 — public solutions

Searched: comparable MCP/asset-preview implementations (Unsplash and Pexels
integrations, MCP image-content conventions) for how a video thumbnail is
served.

Found: providers publish a dedicated poster URL per video result, and MCP image
content is returned as bytes plus `mimeType`; callers are expected to request
the poster, not the clip. No library is involved.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Fetch `AssetRef.preview` and return it as image content | Uses the field every row already carries; works for remote posters and host-served Wallpaper Engine stills | The URL must be checked for scheme, content type and size | Chosen |
| Extract a frame from the fetched video with `extractVideoFrame` | Works offline | Downloads the clip, needs ffmpeg, and ignores the source's chosen still | Rejected |
| Return the row's preview URL as JSON text | No fetch | Caller still has to fetch; the tool's contract is image content | Rejected |
| Add a host route that proxies arbitrary preview URLs | Centralises fetching | An SSRF surface in the host for a value the MCP process can fetch itself | Rejected |

## Rung 6 — smallest probe

The new `previewAsset` test starts the fake host serving a video row whose
`preview` is a loopback JPEG URL, and asserts the tool returns `image/jpeg`
bytes. Without the change the same call answers "not an image", so the test is
able to fail.

## Decision

For a result whose kind is not an image, `preview_asset` fetches
`AssetRef.preview`: http/https only, a 10 s timeout, an image content type, and
`MAX_ASSET_BYTES` as the ceiling. A missing, unreachable or non-image preview
falls back to the existing refusal. Image and SVG rows keep returning their own
bytes.
