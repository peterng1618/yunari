# Engineering gotchas

Non-obvious failure modes worth checking before repeating expensive investigations. Git keeps the incident history; this file keeps the reusable rule.

## Verification

- **Check the claim, not the handoff.** Status/docs can be wrong.
- **Disable a fix before trusting its regression test.** A test that still passes
  is asserting something else.
- **Render visible work and look.** Geometry/object-count tests can pass over
  missing or malformed pixels.
- **“Some ink exists” is not enough.** Compare the spatial result needed by the
  feature, not merely non-transparent pixel count.
- **Measure library/harness behaviour when it decides architecture.** Reading
  source or warnings is not a substitute for a one-line experiment.
- **A fresh-object identity comparison is not a change detector.** Compare the
  fields that matter or preserve stable identities deliberately.
- **An optimization needs an assertion.** If nothing tests that work is skipped,
  nothing notices when it stops being skipped.
- **Browser E2E does not exercise the host.** Preview-server success says nothing
  about host routing/asset behaviour.
- **Rebuild after reverting deliberate test breakage.** Playwright previews
  build output, not source.

## Libraries and duplication

- **Read a dependency for what it already donates before reimplementing it.**
  Fabric already supplied serialization hooks, revival, defaults and dirty
  propagation that early custom code got subtly wrong.
- **One owner must have real consumers.** Creating a canonical module without
  repointing callers leaves duplication intact.
- **Prefer mechanisms to reminders.** Derive, type-check or test synchronization.
- **Persist authored state, not derived state.** Derived renderer/runtime values
  become stale and can leak telemetry into saved data/history.
- **Try the smallest executable probe before writing an adapter.** Library
  serialization/default behaviour overturned several source-reading assumptions
  in minutes.

## Editor architecture

- **Do not build generic editor mechanics when a foundation can own them.**
  Selection, controls, grouping, clipboard and object tools are not Yunari's
  product.
- **Evaluate a candidate against the true blocker first.** The earlier Fabric
  rejection was about two renderers; once Fabric became the one renderer, that
  premise disappeared.
- **Evaluate small libraries as source when a fork is acceptable.** Missing npm
  exports/types are weak objections if the source already implements the needed
  behaviour and permanent divergence is acceptable.
- **A capability model must express the distinctions the product needs.** Split
  broad capabilities instead of piling exceptions onto one flag.
- **Do not render controls that cannot work.** Conversely, authorable properties
  need a property control.
- **Refuse invalid input rather than coercing it.** Empty/bad numeric input can
  otherwise become a destructive zero.

## Rendering

- Canvas and DOM differ in culling, text inheritance, image decoding and media
  behaviour; parity must be checked fixture by fixture.
- Fabric chart objects need explicit ECharts disposal and Fabric invalidation.
- Live/derived chart data must never enter serialized authored properties.
- Video does not belong inside the Fabric scene when it forces full-scene frame
  repaint; keep it on a separate aligned background layer.

## Store sign-in and catalogue

- A sign-in can only return to a loopback address, so a host opened at a LAN
  address or a custom hostname cannot sign in. Open it at `localhost`, `127.x`
  or `[::1]`: the host normalises any of those to `127.0.0.1:<port>` for the
  Worker, so the return always lands on `127.0.0.1`.
- The catalogue origin lives once, in `CATALOGUE_ORIGIN`
  (`renderer-core/src/theme/catalogue-location.ts`); the host's download
  allow-list reads the same constant. Until the Worker is deployed, every
  catalogue read fails against that address rather than falling back to a
  local directory.

## Game identity

- **`game.running` means an identified game, not `pid !== 0`.** The classifier
  tries the installed catalogue, then runtime markers beside the executable,
  then a known engine window class while fullscreen. Window evidence needs two
  consecutive fullscreen readings of the same pid and class.
- **The catalogue is local and read-only.** Steam's app manifests, Epic's
  `.item`, GOG's registry keys, itch's `.itch.toml`, Xbox's
  `MicrosoftGame.config`, and Microsoft Store's `Get-AppxPackage` for GDK
  packages only: a Store package counts only when it carries a
  `MicrosoftGame.config`. A missing source, or one that throws, contributes an
  empty list; it never takes the provider down.
- **Game identity is Windows-only.** The foreground helper is PowerShell over
  `GetForegroundWindow`, and there is no Linux foreground source, so no Linux
  catalogue reader exists.
- **`NON_GAME_PROCESSES` carries the exclusion rule.** A fullscreen Explorer, the
  shell, the host itself and an unresolved `ApplicationFrameHost` are not games;
  a UWP title is resolved to its `Windows.UI.Core.CoreWindow` child first.
- **The helper line's `class`, `fullscreen` and `d3dFullscreen` are optional.**
  An older line without them still parses, and a missing class or fullscreen
  flag means window evidence cannot fire.
- **Only window evidence needs a real fullscreen game.** The injected foreground
  supplies no window, so it proves catalogue or store identity only;
  `tests/e2e/game-metadata.spec.ts` uses that seam, while `game-artwork.spec.ts`
  uses a Steam-root fixture and stubs the page's stream.

## Toolchain

- Bare gitignore rules match at any depth.
- `npx <name>` may execute an unrelated public package; verify the binary name.
- Node 25 may warn against Vitest's engine range while still running; use the
  supported Node versions instead of debugging the warning.
- `document.fonts.check()` is not a reliable font-availability test.
- A chart whose visible content is animated may paint nothing at time zero;
  deterministic captures must control time deliberately.
- A modular ECharts build silently ignores a component that was never
  registered: `visualMap` needs `VisualMapComponent` in `use()`, and without it
  `setOption` succeeds and draws the wrong thing. Verify a new option in the
  rendered output, not by reading back the option object.
- Playwright previews built bundles. A source change with no rebuild produces
  failures that look like logic bugs.
- `spawn` reports failure asynchronously through an `error` event; a try/catch
  around it catches nothing and an unhandled event ends the process. Handle the
  event.
- A Windows binary manifested `requireAdministrator` cannot be started from a
  non-elevated process; the spawn fails with `EACCES`. Read the manifest rather
  than reporting the bare code.
- External binaries hit `EACCES` under this environment's sandbox while system
  executables run, so "the environment cannot execute binaries" is not a valid
  conclusion without comparing a control.

## Environment overrides

- **`YUNARI_STEAM_ROOT`** names the Steam install the host reads instead of the
  registry's `HKCU\Software\Valve\Steam\SteamPath`. It overrides only the root
  used by the game provider and `/api/game/artwork/`; unset changes nothing.
  `tests/e2e/game-artwork.spec.ts` sets it to a temp root so the real host reads
  a fixture library and cache without touching this machine's Steam.
- **`YUNARI_STEAM_STORE`** points the store-metadata client at one origin for
  its search, details and portrait requests; unset keeps Valve's store and CDN.
  `tests/e2e/game-metadata.spec.ts` uses it to play all three from a fixture, so
  the proof needs no network.
- **`YUNARI_FOREGROUND_EXE`** reports that executable as the running game
  instead of spawning the Windows foreground helper, and its file stem is the
  local name searched for. The version-info ProductName read is skipped for the
  seam. Unset changes nothing. Same spec.
- **`YUNARI_CAPTURE=1`** and **`YUNARI_CAPTURE_DIR`** are the capture switches;
  their rules live in [`docs/evidence/screenshots/README.md`](../evidence/screenshots/README.md).

## Documentation

- A claim about the environment belongs in a doc only after a control
  experiment; "the sandbox prevents it" was wrong once and would have hidden a
  real elevation requirement.
