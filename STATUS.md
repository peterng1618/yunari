# Yunari status

Updated: 2026-10-24
Branch: `peterng1618/Review-sensor-dictionary`

## Current objective

The **sensor platform** ([`spec`](docs/superpowers/specs/2026-10-24-sensor-platform-design.md), [`plan`](docs/superpowers/plans/2026-10-24-sensor-platform.md)) is the active plan: seven phases, from vocabulary/units/image binding through hardware, weather, media, custom sources, frame/game presence, and Steam store metadata.

- **Active plan:** `docs/superpowers/plans/2026-10-24-sensor-platform.md`

## Active work

- **All seven phases are complete** (Tasks 1.1–7.5); the Plan 7 boundary gate ran green.
- **Phase 7 is proven end to end**: a real host and player, a fixture Steam store, the canonical name and cover painted; offline arm 1 proves the cover fallback, not a cold lookup.
- **The earlier whole-branch review's five findings are fixed**, and its scoped re-review returned ALL CLEAR.
- **Media and custom sources remain proven** with the same live evidence recorded at Phase 6.

## Last completed change

- **Steam store metadata:** two-tier name matcher with ambiguity refusal, cached store client, provider name/cover with demand-gated fetching, and cached covers through the gated route.
- **Proof:** `game-metadata` e2e on its own host (4245) asserts the painted name/cover, one storesearch whose query is exactly name + `cc`/`l`, same-origin page requests, and offline fallback.
- **Seams:** `YUNARI_STEAM_STORE` and `YUNARI_FOREGROUND_EXE` documented in `docs/engineering/gotchas.md`; decision 0109 records the reuse gate.
- **Gate:** `npm run gate` exit 0 — web 371 test files / 5466 tests; store-worker 12 files / 72 tests.

## Next

1. Run the Phase 7 scoped final review, then close the plan.
2. Raise the stale AGENTS.md port range (4215–4237) with the user; 4239 and 4245 are now used.
3. Run a live adapter check with a game (RTSS or PresentMon) and a live Steam store lookup when the user can.

## Blockers / unverified

- **No live Steam store request:** the Phase 7 e2e uses a fixture; the endpoints were only probed by hand. No live frame or game reading either.
- **Player conversion and catalogue refresh:** a custom temperature key converts in the editor preview only (vg-717); a source added while the editor is open needs a reload (vg-713).
- **No live weather backend and no Windows Geolocator run**; fixtures and units are tested only.
- **Credential removal from the Sources page** is jsdom-tested only; jpg/webp media artwork is unverified.
- **Presence still reads every foreground process as a game** (vg-714), so a store lookup can be asked about a browser once per name.
