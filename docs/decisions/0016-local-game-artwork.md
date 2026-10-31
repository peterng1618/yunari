# 0016 — non-Steam game identity from local launcher art

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/providers/game/catalogue/catalogue.ts`,
  `src/web/packages/host/src/providers/game/catalogue/gog.ts`,
  `src/web/packages/host/src/providers/game/box-art.ts`,
  `src/web/packages/host/src/providers/game/provider.ts`,
  `src/web/packages/host/src/server.ts`

## Problem

A catalogue match names an Epic, GOG or itch game but stops before artwork, so
`game.artwork` stays absent for every non-Steam title. The host must serve a
launcher's own local picture without becoming a filesystem probe, and without
turning a missing picture into a broken URL.

## Rung 1 — internal owner

`codegraph explore` and source reads around `GameProvider.artworkUrl`,
`createGameArtwork`, `findBoxArt`, `readInstalledGames`, `readGogGames` and the
`/api/game/artwork/` route show one artwork owner already split in two: the
provider decides the URL, `box-art.ts` validates and reads bytes, and
`server.ts` serves them. `InstalledGame` is the one catalogue record, and
`GameIdentity` already carries the matched game's name. `serve/static-path.ts`
owns `".ico" → "image/x-icon"`; `resolveInCoverCache` already performs the
realpath-and-relative containment the new path needs. Nothing names a
launcher's picture, so the gap is one field plus one route key.

## Rung 2 — installed dependencies

The host has no imaging dependency and deliberately keeps its list small
(`packages/host/package.json`). `providers/media/artwork.ts` sniffs JPEG, PNG
and WebP only and is owned by the media provider; it has no ICO rule and no
byte conversion. No installed dependency donates launcher art.

## Rung 3 — native platform

Node provides `fs.realpath`, `fs.stat` and bounded `readFile`; the existing
`readBoxArt` cap and `resolveInCoverCache` containment apply unchanged.
Chromium and Firefox decode ICO in `<img>`; the artwork route already sends
`x-content-type-options: nosniff`, so the bytes are served under an explicit
`image/x-icon`, the same type `serve/static-path.ts` declares. ICO needs no
decode or conversion on the host, which is why no dependency is required.

## Rung 4 — public solutions

Searched: GOG forum file lists and the GOGDB manifest for install-directory
contents; Nexus-Mods `extension-gamestore-gog` source discussion; the
Reloaded-III GOG specification; the issue's 2026-10-24 probe of this PC.
Found: GOG Galaxy installs carry `goggame-<gameId>.ico` in the install root
(also `.dll`, `.info`, `.script`); a plain installer may carry only `gog.ico`,
which names no game and is not used here. Epic manifests expose only CDN art
URLs; itch manifests name an executable, not an image. Comparable managers
either read that local ICO, read Galaxy's `webcache` (a second, undocumented
store), or query a remote catalogue. The issue restricts this change to local
files, so the remote and `webcache` routes are out.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Serve `goggame-<id>.ico` from the install root | Uses the existing catalogue read, artwork route and containment helper | Needs one artwork field, one route key, an ICO content type | Chosen |
| Read GOG Galaxy's `webcache` art | Higher-quality covers | Undocumented cache, second store reader, staleness | Rejected: not the launcher's own install |
| Fetch Epic/GOG art from a CDN | Covers more titles | Violates the issue's local-only rule; adds network ownership | Rejected |
| Extract the executable's icon | Covers standalone games | PE resource parsing or a PowerShell/System.Drawing spawn per exe, cache and id ownership | Deferred: the issue's lowest-priority source |

## Rung 6 — smallest probe

On this PC (2026-10-31), `HKLM:\SOFTWARE\WOW6432Node\GOG.com\Games` holds
`PSChildName = gameId = 1918442274`, `path = D:\Games\A Space for the Unbound`,
and that root contains `goggame-1918442274.ico`. The registry id and the file
name therefore agree, and the file is in the install root as documented.

## Decision

Extend the catalogue owner with an optional `InstalledArtwork` discovered by the
GOG adapter when `goggame-<gameId>.ico` exists beside the install; the artwork
route gains a `<source>-<id>.ico` key whose file is read only after containment
in that game's install root, and the provider emits the URL from the matched
catalogue game. Steam's local cache stays first and the store cover stays last.
No remote or `webcache` source is added, and standalone executable icons remain
out of scope.
