# Yunari status

Updated: 2026-10-24
Branch: `peterng1618/Review-sensor-dictionary`

## Current objective

The **sensor platform** ([`spec`](docs/superpowers/specs/2026-10-24-sensor-platform-design.md), [`plan`](docs/superpowers/plans/2026-10-24-sensor-platform.md)) is the active plan: six phases from vocabulary/units/image binding through hardware, weather, media, custom sources, and frame/game presence.

- **Active plan:** `docs/superpowers/plans/2026-10-24-sensor-platform.md`

## Active work

- **Phase 1 is complete** (Tasks 1.1–1.5): open vocabulary, unit conversion and preferences, provider descriptors with editor fallback, and image binding from host-relative samples.
- **Phase 2 is next**: LHM detail mappings (Tasks 2.1–2.3) and the `systeminformation` fill (Task 2.4).
- **Charts stay canonical** this phase; only text formatting converts, so authored thresholds remain valid.

## Last completed change

- **Image binding is hardened and reviewed**: C0/DEL/backslash are refused, an in-flight load cannot overwrite a newer or restored source, and the e2e store lives under `os.tmpdir()`.
- **Unit preferences convert text only**: GHz precision, binary/decimal data and byte/bit rates; `Binding.unit`/`autoScale` validate in the envelope schema v2.
- **The editor pickers read `/api/sensors`** and fall back to the built-in table; saved keys absent from the catalogue stay selectable.
- **The host `/settings` page no longer erases stored units** when a zone changes.

## Next

1. Dispatch Task 2.1 (CPU and GPU detail mappings) to a subagent.
2. Review each task's diff and evidence before dispatching the next.
3. Run the full gate at the end of each phase.

## Blockers / unverified

- **No live WeatherAPI or OpenWeatherMap response** has run; both need user keys.
- **RTSS shared memory and PresentMon streaming** are unverified on this machine, including the privilege failure path.
- **Windows Geolocator permission behaviour** from a host-spawned PowerShell is unrun.
- **Steam library-cache box-art naming** is unverified on this install.
