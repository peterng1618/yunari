# 0103 — One PowerShell script reads SMTC and the endpoint volume

- **Date:** 2026-10-24
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/providers/media/smtc-helper.ts`,
  `src/web/packages/host/src/providers/media/provider.ts`

Decision 0102 owns the supervisor; this note owns what runs inside it and why
it is not a native addon.

## The problem

Now Playing needs the Windows media session (title, artist, album, playback
state, position, duration, source app) and its artwork bytes. `audio.volume` and
`audio.muted` need the *system* output level, not a player's own volume slider.
Both live behind COM/WinRT, and the naive PowerShell call fails in two
non-obvious places: `IAsyncOperation` is not awaitable from PS 5.1 without the
`AsTask` reflection helper, and `[Console]::Out` encodes titles as the OEM
codepage, so a Vietnamese or CJK title arrives as mojibake.

## Rung 1 — Yunari

Searched: `packages/host/src/providers/`, `docs/decisions/`.

Found: nothing reads media. `providers/helpers/` holds the supervisor and the
location helper (0102), which already covers spawn, framing, backoff, tree
kill, and a 1 MiB line cap. `systeminformation` exposes no media session and no
mixer (`si.audio()` lists devices only).

## Rung 2 — dependencies

Searched: every `package.json` for media, audio or WinRT packages.

Found: none installed.

## Rung 3 — platform

Searched: `Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager`,
`Windows.Storage.Streams.DataReader`, `Windows.Media.Control.GlobalSystemMedia…Session.TryGetMediaPropertiesAsync`,
CoreAudio `IAudioEndpointVolume`, and PowerShell 5.1 `Add-Type`.

Found: all reachable from PowerShell 5.1. `AsTask` must be selected as the
**generic** 2-parameter overload (`IsGenericMethodDefinition`) — the
`IAsyncAction` overload has the same arity and throws
`MakeGenericMethod` if picked first. `DataReader` has no public constructor
PowerShell can bind; it needs
`[DataReader].GetConstructor(@([IInputStream]))` reflection. Endpoint volume is
plain COM, so `Add-Type` compiling a small `ComImport` interop works.

## Rung 4 — ecosystem

Searched npm: `node-nowplaying`, `windows-media-session`,
`node-windows-media-session`, `windows-smtc`, `@nodert-win10*`.

Found: `node-nowplaying` 0.1.0 (MIT, published 2025-03, one maintainer) is a
NAPI-RS addon around the Rust `nowplaying` crate with prebuilt binaries; the
others are 404. Its surface is per-player: `isPlaying` rather than a
playing/paused/stopped state, per-session `volume` that many apps ignore, a
base64 or path `thumbnail` rather than bytes, and no system endpoint volume.
No maintained package exposes `IAudioEndpointVolume`.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| `node-nowplaying` | Metadata, art, control in one API | New native addon, prebuilt binaries per platform | 0.1.0, one maintainer, no system volume, no stopped state, no session choice | Rejected |
| Direct WinRT/COM in the helper's caller (Node addon) | Exact API | MSVC + node-gyp toolchain | Unbuildable for consumers | Rejected |
| PowerShell script under the 0102 supervisor | Exact API, one process for both readings | Script string in a module | Reflection and encoding need pinning by tests | **Chosen** |

## Rung 6 — probe

On this machine (Windows 11 22631, PowerShell 5.1), 2026-10-24:

- One SMTC session was listed: `app=Chrome state=Paused` with a Vietnamese
  title, proving paused sessions are readable alongside playing ones.
- `[DataReader].GetConstructor(@([IInputStream]))` returned
  non-null — the reflected-constructor workaround exists and is needed.
- `[Console]::OutputEncoding = [Text.Encoding]::UTF8` made the same title
  round-trip intact through a pipe; without it the console showed `B?n Trong…`.
- CoreAudio via a compiled `ComImport` interop returned
  `volume=0.420 muted=False`, the endpoint's real level.
- An artwork read needs an actually playing app; not exercised here, so the
  streaming half stays fixture-backed until the Phase 4 Windows test runs.

## Decision

The SMTC helper is one embedded PowerShell script run under 0102's supervisor,
emitting one UTF-8 JSON line per poll with the session fields and reading the
default render endpoint's volume and mute in the same run. Artwork bytes are
requested only when the provider asks for `media.artwork`, and are read with
the reflected `DataReader(IInputStream)` constructor. `node-nowplaying` is not
adopted: it cannot answer the system-volume key, does not model `stopped`, and
trades a script this repo already supervises for a third-party binary in the
host.

The artwork cache (Task 4.2) stays content-addressed on disk under the host
cache directory, never in a theme, and is served through a route that a
display must authenticate to.
