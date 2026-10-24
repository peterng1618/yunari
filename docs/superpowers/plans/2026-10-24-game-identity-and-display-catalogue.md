# Game identity and the display catalogue — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Identify a running game from local launcher data (no network) and give the player the host's sensor catalogue so custom units convert on a display.

**Architecture:** A new `providers/game/game-catalogue.ts` reads Steam, Epic, GOG, itch, Xbox and uninstall-registry installs through injected seams; `game-classifier.ts` turns a foreground reading plus that catalogue into `{ running, evidence }`; the game provider uses it for `game.running`, leaving the store lookup demand-driven. The wire→descriptor mapping moves into `renderer-core`, and the player fetches `/api/sensors` and passes descriptors to `refreshBoundText`.

**Tech Stack:** TypeScript, Node 22+, Vitest, Playwright, Biome, PowerShell helper (existing `startJsonLineHelper`).

**Spec:** `docs/superpowers/specs/2026-10-24-game-identity-and-display-catalogue-design.md`
**Decision:** `docs/decisions/0110-game-identity-is-a-local-catalogue-match.md`

## Global Constraints

- Windows-first. Do not add Linux foreground detection or Linux readers.
- No new runtime dependency. No SQLite reader; prefer JSON/TOML/registry.
- Presence path performs no network request. The store lookup remains demand-driven for `game.name` / `game.artwork` only.
- Never write to the user's installs, registry or launcher files.
- Missing launcher, malformed manifest, unreadable registry = empty list, not provider failure.
- `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`; no numeric coercion.
- All source files under 500 lines; split by responsibility if a reader grows.
- Tests: fail-then-pass for every classifier rule and every catalogue source. Fixtures, no dependence on the author's machine.
- Run from `src/web/`. Focused: `npx vitest run <paths>`. Boundary: `npm run gate` at phase ends, written to a log file and read by exit code.

## Review Focus

- A false `running:true` for a browser/terminal is the defect this plan exists to fix; every exclusion and debounce rule needs a test that fails when removed.
- A catalogue reader that throws on a malformed manifest would take the whole game provider down; every reader is wrapped and tested with garbage.
- The player catalogue must change a rendered value, not just be passed: the e2e asserts `°F` on the player surface.

---

### Phase 1 — Local catalogue

#### Task 1.1: Catalogue types, seams, and the Epic reader

**Files:**
- Create: `src/web/packages/host/src/providers/game/game-catalogue.ts`
- Create: `src/web/packages/host/src/providers/game/game-catalogue.test.ts`

**Interfaces:**
- Produces: `InstalledGame` (`source`, `name`, `installDir`, `exes`) and `CatalogueSeams` (`readFile`, `readdir`, `programData`, `appData`, `runPowerShell`, `steamApps`) per the spec's Interfaces section; `readEpicGames(seams)` returning `readonly InstalledGame[]`.

- [ ] Write failing tests: one valid `.item`, an incomplete install, a DLC (`MainGameAppName` ≠ `AppName`), a missing directory, and a malformed JSON file.
- [ ] Run them; expected FAIL (module missing).
- [ ] Implement `readEpicGames`, skipping the four rejection cases and resolving `LaunchExecutable` against `InstallLocation`.
- [ ] Run tests; expected PASS.
- [ ] Commit: `feat(host): read Epic install manifests into a game catalogue`.

#### Task 1.2: GOG registry and Xbox readers

**Files:**
- Modify: `game-catalogue.ts`, `game-catalogue.test.ts`

**Interfaces:**
- Produces: `readGogGames(seams)` and `readXboxGames(seams)`.

- [ ] Failing tests: a GOG entry with `gameName`/`path`/`exe`; a `dependsOn` DLC skipped; a registry answer that is not JSON; an Xbox `MicrosoftGame.config` naming its executable; an Xbox title with no config (sole `.exe` under `Content`).
- [ ] Implement GOG through one `runPowerShell` call that enumerates the key as JSON (seam injected in tests; no real registry in unit tests).
- [ ] Implement Xbox by walking `C:\XboxGames` one level and reading `Content\MicrosoftGame.config` or the sole `.exe`.
- [ ] Run tests; PASS.
- [ ] Commit: `feat(host): read GOG and Xbox installs`.

#### Task 1.3: itch and generic-uninstall readers

**Files:**
- Modify: `game-catalogue.ts`, `game-catalogue.test.ts`

**Interfaces:**
- Produces: `readItchGames(seams)` and `readUninstallGames(seams)`.

- [ ] Failing tests: an itch app folder with `.itch.toml`; a folder with no executable; an uninstall entry with `InstallLocation`, one without, one with a non-game `DisplayName` already excluded by the source (no filter beyond empty fields).
- [ ] Implement a minimal TOML-key reader for `.itch.toml` (only `[[actions]]`/`path`/`exe` or the directory scan the plan's spec allows); if the format cannot be read confidently, fall back to the app directory's executables and record that in a comment.
- [ ] Implement the uninstall-registry reader through `runPowerShell`, one call returning key value objects.
- [ ] Run tests; PASS.
- [ ] Commit: `feat(host): read itch and uninstall-registry installs`.

#### Task 1.4: Microsoft Store (Appx) reader

**Files:**
- Modify: `game-catalogue.ts`, `game-catalogue.test.ts`

**Interfaces:**
- Produces: `readAppxGames(seams)`, source `"appx"` in `InstalledGame`.

- [ ] Failing tests: a non-framework package with an `InstallLocation`; a framework package skipped; a package with no install location skipped; a GDK package whose `MicrosoftGame.config` names an executable; a non-array/failed answer yields `[]`.
- [ ] Implement one `runPowerShell` call running `Get-AppxPackage` and projecting `Name`, `PackageFullName`, `InstallLocation`, `IsFramework`, plus a `Test-Path` for `MicrosoftGame.config` inside the same call. Skip frameworks and empty install locations; `exes` = the config's executable under `InstallLocation` when the config is readable, else `[]` (the install root still matches).
- [ ] Run tests; PASS.
- [ ] Commit: `feat(host): read Microsoft Store packages into the catalogue`.

#### Task 1.5: One catalogue, deduplicated

**Files:**
- Modify: `game-catalogue.ts`, `game-catalogue.test.ts`, `src/web/packages/host/src/providers/game/steam-library.ts` (only if an adapter is needed)

**Interfaces:**
- Produces: `readInstalledGames(seams): Promise<readonly InstalledGame[]>`, Steam entries first, later duplicate executables dropped (case-insensitive, `path.win32.normalize`).

- [ ] Failing test: Steam plus Epic naming the same exe keeps Steam; two sources with different exes both survive; a source that throws does not lose the others.
- [ ] Implement the aggregation with per-source `try/catch`.
- [ ] Run the whole `game-catalogue` suite plus `steam-library` tests; PASS.
- [ ] Phase gate: `npm run gate` to a log file; exit code 0.
- [ ] Commit: `feat(host): aggregate installed games across launchers`.

---

### Phase 2 — Classifier and presence

#### Task 2.1: Foreground helper reports class and fullscreen

**Files:**
- Modify: `src/web/packages/host/src/providers/helpers/foreground.ts`, its test
- Modify: `src/web/packages/host/src/providers/game/provider.ts` only if the reading type is re-exported

**Interfaces:**
- Produces: `ForegroundReading` gains `class?: string`, `fullscreen?: boolean`, `d3dFullscreen?: boolean`; `parseForegroundLine` keeps accepting lines without them.

- [ ] Failing tests: parse a full line; parse an old line; a non-boolean field is dropped rather than coerced.
- [ ] Extend the P/Invoke block with `GetClassName`, `GetWindowRect`, `MonitorFromWindow`, `GetMonitorInfo`, `SHQueryUserNotificationState`; emit the three fields.
- [ ] Resolve packaged apps: when the foreground class is `ApplicationFrameWindow`, find the child `Windows.UI.Core.CoreWindow` (`FindWindowEx`) and report that window's pid, path, name and class instead of the frame host. A missing child keeps the frame host (classifier then answers false).
- [ ] Failing tests for the parse side: a frame-host line is not special-cased in the parser (the helper resolves it); a line whose class is `ApplicationFrameWindow` still parses.
- [ ] Run helper tests; PASS. (The PowerShell script body is not executed by unit tests; state that in the report.)
- [ ] Commit: `feat(host): report window class and fullscreen state from the foreground helper`.

#### Task 2.2: Runtime markers and the classifier

**Files:**
- Create: `src/web/packages/host/src/providers/game/game-classifier.ts`
- Create: `src/web/packages/host/src/providers/game/game-classifier.test.ts`

**Interfaces:**
- Produces: `classifyForeground(reading, catalogue, state)` returning `GameEvidence`; `GAME_WINDOW_CLASSES`, `GAME_MARKER_FILES`, `NON_GAME_PROCESSES` exported for tests.

- [ ] Failing tests: catalogue match by install root and by exact executable; an `appx` install-root match (Microsoft Store / Game Pass); an unresolved `ApplicationFrameWindow` reading is false; marker file present; class+fullscreen on the second sample only; fullscreen browser (`chrome`, class `Chrome_WidgetWin_1`) false; class alone false; excluded process false even with markers.
- [ ] Implement with a bounded directory listing for markers (injected `readdir`), normalized Windows path comparisons, and the sample counter supplied by the caller.
- [ ] Run tests; PASS.
- [ ] Commit: `feat(host): classify a foreground process as a game locally`.

#### Task 2.3: Provider presence uses the classifier

**Files:**
- Modify: `provider.ts`, `provider.test.ts`

**Interfaces:**
- Consumes: `readInstalledGames`, `classifyForeground`.
- Produces: `GameProviderOptions.catalogue?: () => Promise<readonly InstalledGame[]>` (defaults to `readInstalledGames`); `game.running` follows `GameEvidence.running`.

- [ ] Failing tests: a foreground `chrome.exe` reports `running:false` and still answers `game.app`; a catalogued exe reports `running:true` with no store lookup (assert the store fake was not called); the second consecutive fullscreen sample flips `running` true; a catalogue failure leaves the provider available.
- [ ] Implement: read the catalogue once per demand window, keep a per-foreground sample counter, reset both on teardown, keep the store path untouched.
- [ ] Run `provider` + `game-classifier` + `game-catalogue` suites; PASS.
- [ ] Phase gate: `npm run gate` to a log file; exit code 0.
- [ ] Commit: `feat(host): game.running means an identified game`.

---

### Phase 3 — Shared descriptor mapping

#### Task 3.1: Move the wire mapping into renderer-core

**Files:**
- Create: `src/web/packages/renderer-core/src/data/sensor-catalogue.ts`
- Create: `src/web/packages/renderer-core/src/data/sensor-catalogue.test.ts`
- Modify: `src/web/packages/renderer-core/src/index.ts` (export)

**Interfaces:**
- Produces: `descriptorFromWire(entry): SemanticKeyDescriptor | undefined`, `descriptorsFromWire(sensors): readonly SemanticKeyDescriptor[]` (built-ins first, collisions won by the vocabulary).

- [ ] Move the existing editor logic and its tests; no behaviour change.
- [ ] Run `renderer-core` tests; PASS.
- [ ] Commit: `refactor(renderer-core): own the sensor wire-to-descriptor mapping`.

#### Task 3.2: Editor catalogue uses the shared mapping

**Files:**
- Modify: `src/web/packages/editor/src/sensor-catalogue.ts`, its test

- [ ] Replace the local mapping with the shared import; keep fetch/refresh/failure behaviour identical.
- [ ] Add one test asserting the editor catalogue for a wire payload equals `descriptorsFromWire(payload)`.
- [ ] Run editor catalogue + picker tests; PASS.
- [ ] Commit: `refactor(editor): use the shared sensor catalogue mapping`.

---

### Phase 4 — Player catalogue (vg-717)

#### Task 4.1: Player loads the catalogue and repaints with it

**Files:**
- Create: `src/web/packages/player/src/sensor-catalogue.ts`, its test
- Modify: `src/web/packages/player/src/main.ts` (only the `startHostedTheme` wiring and imports)

**Interfaces:**
- Produces: `loadDisplayCatalogue(fetch: typeof fetch): Promise<readonly SemanticKeyDescriptor[]>` — built-ins on any failure; same-origin `GET /api/sensors`, session-authenticated fetch.

- [ ] Failing test: a payload adds a custom descriptor; a 500 returns built-ins; a malformed body returns built-ins.
- [ ] Wire into `startHostedTheme` before `refresh` is defined; pass `descriptors` as `refreshBoundText`'s seventh argument.
- [ ] Run player unit tests; PASS.
- [ ] Commit: `fix(player): convert custom source units with the host catalogue`.

#### Task 4.2: Prove the conversion on a player surface

**Files:**
- Modify: `src/web/tests/e2e/<existing player host spec>` or create `game-display-catalogue.spec.ts` per the existing e2e conventions
- Modify: `docs/evidence/screenshots/README.md` only if a capture is added

- [ ] Start the real host with a fixture custom source reporting a `°C` reading; publish a theme binding it with a `°F` display unit.
- [ ] Assert the player's rendered text contains `°F` and not `°C`.
- [ ] Revert the descriptor pass locally and confirm the spec fails; restore and confirm pass (record both runs).
- [ ] Commit: `test(e2e): a display converts a custom source unit`.

---

### Phase 5 — Close-out

#### Task 5.1: Docs truth

**Files:**
- Modify: `docs/engineering/gotchas.md` (the fixed-foreground seam note, the new helper fields)
- Modify: `docs/engineering/dependencies.md` only if a dependency changed (it must not)

- [ ] Document the catalogue sources, the Windows-only boundary, and the exclusion rule.
- [ ] Run `npm run docs:check`; exit 0.
- [ ] Commit: `docs(host): state which local sources identify a game`.

#### Task 5.2: Register and status

**Files:**
- Modify: `docs/product/backlog.jsonl`, `docs/product/backlog-archive.jsonl`
- Modify: `STATUS.md`

- [ ] Close vg-723, vg-724 and vg-717 as `verified` with a `check` naming a word from each title and `artefacts` holding this plan's merge-boundary commit (ancestor of HEAD).
- [ ] Leave the Linux half of vg-724 open as its own row (or record the deferral in vg-724's replacement row) with provenance.
- [ ] Update STATUS: current objective, active work (≤6 bullets), last completed change (≤5), next, blockers — one line per item.
- [ ] Run `npm run status:check` and `npm run backlog:check`; both exit 0.
- [ ] Commit: `docs(backlog): close the game identity and display catalogue rows`.

## Self-review

- Spec coverage: D1 (2.2/2.3), D2 (1.1–1.5), D3 (2.2), D4 (out of scope, 5.2), D5 (3.1/3.2), D6 (4.1/4.2). Acceptance 1–5 map to 2.3, 1.5/2.3, 2.2/2.3, 4.2, phase gates.
- Every task ends with a runnable check; no predicted test counts.
- Types named once: `InstalledGame`, `CatalogueSeams`, `GameEvidence`, `descriptorsFromWire`, `loadDisplayCatalogue`.
