# Yunari status

Updated: 2026-10-24
Branch: `peterng1618/Review-sensor-dictionary`

## Current objective

The **sensor platform** ([`spec`](docs/superpowers/specs/2026-10-24-sensor-platform-design.md), [`plan`](docs/superpowers/plans/2026-10-24-sensor-platform.md)) is the active plan: six phases from vocabulary/units/image binding through hardware, weather, media, custom sources, and frame/game presence.

- **Active plan:** `docs/superpowers/plans/2026-10-24-sensor-platform.md`

## Active work

- **Phases 1 and 2 are complete** (Tasks 1.1–1.5, 2.1–2.4) and the Phase 2 gate ran green: `npm run gate` exit 0, 345 files / 4864 tests, worker 12 / 72.
- **Phase 3 is next**: weather settings and manual place (3.1), Open-Meteo with WMO codes and icons (3.2), localized conditions (3.3), WeatherAPI/OpenWeatherMap BYOK (3.4), helper supervision and Windows location (3.5).
- **Every baseline key is now answered without LHM**: Wi-Fi, system, battery and audio (audio deferred to 4.2 with media).

## Last completed change

- **Task 2.4 (commit `168da93d`, fixes `b1438ee`, `987af425`, `a0f1ea3d`)**: Wi-Fi, system uptime/processes/hostname/OS, and battery state/charging/timeRemaining/AC/health/level/voltage now come from `systeminformation`, gated so a desktop or unreported field is a gap, never a zero.
- **Rulings**: `battery.timeRemaining` converts minutes→seconds and any `<= 0` is a gap; voltage must be positive; `audio.volume`/`audio.muted` moved to Task 4.2 because `si.audio()` has no mixer.

## Next

1. Dispatch Task 3.1 (weather settings and manual place) to a subagent.
2. Review each task's diff and evidence before dispatching the next.
3. Run the full gate at the end of each phase.

## Blockers / unverified

- **No live WeatherAPI or OpenWeatherMap response** has run; both need user keys.
- **RTSS shared memory and PresentMon streaming** are unverified on this machine, including the privilege failure path.
- **Windows Geolocator permission behaviour** from a host-spawned PowerShell is unrun.
- **Steam library-cache box-art naming** is unverified on this install.
- **Task 2.4's Wi-Fi, battery and process reads** ran against injected fakes only; shapes match `systeminformation`'s typings.
