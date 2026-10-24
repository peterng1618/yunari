# 0111 — The installed-game catalogue is split by source, not by layer

- **Date:** 2026-10-25
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/providers/game/catalogue/catalogue.ts`,
  `src/web/packages/host/src/providers/game/catalogue/seams.ts`,
  `src/web/packages/host/src/providers/game/catalogue/game-config.ts`,
  `src/web/packages/host/src/providers/game/catalogue/epic.ts`,
  `src/web/packages/host/src/providers/game/catalogue/gog.ts`,
  `src/web/packages/host/src/providers/game/catalogue/xbox.ts`,
  `src/web/packages/host/src/providers/game/catalogue/itch.ts`,
  `src/web/packages/host/src/providers/game/catalogue/uninstall.ts`,
  `src/web/packages/host/src/providers/game/catalogue/appx.ts`,
  `src/web/packages/host/src/providers/game/catalogue/test-seams.ts`

## The problem

`game-catalogue.ts` grew to 679 lines as Tasks 1.1–1.4 added one launcher
reader each; its test reached 905. The 500-line signal asks for a split, but the
readers share a seam type, a text helper and the `MicrosoftGame.config`
extractor, and a later task adds aggregation across all of them. The shape to
decide is the module boundary, not how a launcher is read: single file, one
module per launcher, or one module per layer (types / IO / parsing).

## Rung 1 — Yunari

Searched: `providers/game/` for existing per-launcher modules and for an
aggregation owner; `readInstalledGames`, `CatalogueSeams`, `game-catalogue`.
Found: every reader lives in the one `game-catalogue.ts`, the seam type and the
shared parsers live beside them, and nothing aggregates yet. `steam-library.ts`
is the precedent for a source that owns its own reader and test; the catalogue
readers were the only ones not following it.

## Rung 2 — dependencies

Searched: `packages/host/package.json` dependencies, and every import in
`game-catalogue.ts`.
Found: nothing to add. The module uses `node:child_process`, `node:fs`,
`node:os`, `node:path` and the existing `helpers/supervisor.js`; no package
governs launcher manifest shapes.

## Rung 3 — platform

Searched: the Node APIs already imported, and the PowerShell scripts each
reader runs.
Found: a split needs no new platform capability. `path.win32.normalize` and
`toLowerCase` are the dedupe primitives, and the registry/Appx reads are still
one `runPowerShell` call each.

## Rung 4 — ecosystem

Searched: no web or registry lookup was made for this task, because the
mechanism was already chosen and proven in decision 0110 and Tasks 1.1–1.4
(fixture-tested readers over injected seams, no launcher library).
Found: nothing that changes the boundary question. A TOML or XML parser
dependency remains rejected for the same reason 0110 records: the consumed
subset is small and hand-read, and a parser is not what the split is about.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Keep one file | No | None | Grows past the stop as aggregation lands; test already 905 | Rejected |
| Split by layer (types/IO/parse) | Weak | Medium | Every launcher's rules spread across three files; one-source changes churn layers | Rejected |
| Split by source + shared seams/config | Yes | Low | Shared `game-config.ts` needs one owner, named here | Chosen |

## Rung 6 — probe

Measured: `wc -l game-catalogue.ts` = 679, `game-catalogue.test.ts` = 905,
both over the 500 signal; the largest single source section (Appx, including
its tests) is comfortably under it. The moved readers are extracted without
behaviour change, so the existing 44 catalogue tests are the probe: they pass
against the split before aggregation is added.

## Decision

One module per launcher (`epic`, `gog`, `xbox`, `itch`, `uninstall`, `appx`),
sharing `seams.ts` (seam type, defaults, text/flag helpers) and
`game-config.ts` (the GDK config extractor), with `catalogue.ts` owning the
`InstalledGame` type and `readInstalledGames` aggregation. Chosen because the
launcher is the change unit and the only thing aggregation needs to know is
each module's reader; it also matches `steam-library.ts`. The split is
mechanical, so it inherits 0110's mechanism decision rather than replacing it.
