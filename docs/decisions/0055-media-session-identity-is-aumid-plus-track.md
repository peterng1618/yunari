# 0055 — A media session is identified by its AUMID plus its track identity

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:**
  - `src/web/packages/host/src/providers/media/smtc-helper.ts`
  - `src/web/packages/host/src/providers/media/smtc-helper.test.ts`
  - `src/web/packages/host/src/providers/media/smtc-helper.windows.test.ts`
  - `src/web/packages/host/src/providers/media/provider.ts`
  - `src/web/packages/host/src/providers/media/provider.test.ts`

## Problem

Two SMTC sessions from one application share `SourceAppUserModelId`. The helper
emits that AUMID as `sessionId` for every session line and artwork line, so the
provider's session map overwrites one window with the other and the helper's
`$lastArtwork`/`$artworkAttempts` caches thrash between them. A paused window
can then supply the selected title and artwork while another window plays.

## Rung 1 — internal owner

Searched: CodeGraph/Read for `SmtcSession`, `sessionId`, `trackKeyOf`,
`#sessions`, `#currentId`, `$lastArtwork`, `Try-EmitArtwork`, `Get-SessionLine`,
`parseSmtcLine`, `smtcArtworkLine`, `smtcArtworkMissLine`.
Found: the helper owns the identity it writes into `sessionId` and the artwork
dedupe maps; `MediaProvider.#sessions` and `#currentId` consume that identity
opaque and `trackKeyOf` already names a track by
`sessionId + title + artist + album`. One owner (the helper) can change the
identity without a second key format.

## Rung 2 — installed dependencies

Searched: the host's dependencies and `providers/media/` tests.
Found: no dependency reads SMTC or supplies a session identity. The line
protocol is Yunari's own; nothing to reuse.

## Rung 3 — native platform

Searched: reflected members of
`Windows.Media.Control.GlobalSystemMediaTransportControlsSession` under Windows
PowerShell 5.1 on this machine; Microsoft Learn for the class,
`SourceAppUserModelId`, `GetSessions` and the session manager.
Found: the class exposes exactly one identity property,
`SourceAppUserModelId`; no session id, index, GUID or lifetime token. The
per-session media properties (`Title`, `Artist`, `AlbumTitle`) come from the
same session object and are the only other stable per-session values. The
platform does not solve distinguishing two sessions of one app.

Probe:

```powershell
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
[Windows.Media.Control.GlobalSystemMediaTransportControlsSession,Windows.Media.Control,ContentType=WindowsRuntime].GetMembers()
```

The member list contains `get_SourceAppUserModelId` and no id-like property.

## Rung 4 — public solutions

Searched: `GlobalSystemMediaTransportControlsSession session identifier
distinct sessions same app SourceAppUserModelId`; `Windows SMTC GetSessions
multiple Chrome tabs same AUMID identify session`; Microsoft Learn "Integrate
with the System Media Transport Controls"; the `win-gsmtc` Rust manager; the
`Barrryy/SMTC-reader` and `myshowsme/myshows-scrobbler` probes;
`Salyts/Taskbar-Fluent-Media-Player` issue #34.
Found: Microsoft documents multiple SMTC tabs per app but publishes no session
id. `win-gsmtc` keys sessions by AUMID and states it is "assumed to be unique
per session", which reproduces this bug. `SMTC-reader` notes "An application
may own several sessions" and keeps a local enumeration index, which is not
stable across polls. The taskbar widget issue shows the same ambiguity resolved
by preferring a playing session, not by a stronger identity. No ready-made
identity exists to reuse.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep the AUMID as the key | No source change | Two same-app windows still overwrite each other | Rejected |
| AUMID + media-properties digest | Uses only per-session values the OS provides; stable across polls while the track is unchanged | Two windows showing the same track still share a key | Chosen |
| AUMID + enumeration index | Distinguishes any two windows | `GetSessions` order is unspecified and can change between polls, so identity would flip | Rejected |
| AUMID + position/state | Distinguishes more cases | Both values change during playback, so identity changes every poll | Rejected |
| Ask the user to choose a window | Correct by construction | Adds UI and persistence for a selection the OS does not expose | Rejected |

## Rung 6 — smallest probe

The reflection above settled that no per-session id exists. The existing
Windows helper harness executes the real `Get-SessionLine` with a stood-in
WinRT read; it is extended to run the same fake session twice with different
media properties and show the two emitted `sessionId` values differ while the
AUMID prefix stays. Provider tests drive two same-AUMID session lines through
`#ingest` and read distinct samples.

## Decision

`Get-SessionLine` derives `sessionId` as `AUMID + ':' + hash(title + artist +
album)`. The hash keeps the id short enough for the artwork framing reserve
(the whole script already runs against the 32k `-EncodedCommand` cap) while
making two windows of one app distinct for as long as their tracks differ.
`Get-ArtworkResult` is given that same id, so artwork and definitive-miss lines
name the window that emitted them. The per-id artwork caches are cleared at 64
entries because the id now carries its track; without that they would grow with
every track change for the helper's lifetime. The provider still treats
`sessionId` as opaque; it now also selects the most recently seen playing
session, so a track change that creates a new id cannot leave the old id
selected for the three-second session TTL. Two windows showing the same track
remain indistinguishable; the OS provides nothing further, and the selection is
then equivalent because the readings are the same.
