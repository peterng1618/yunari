# Extended sensor coverage and custom sources — design

- **Date:** 2026-10-24
- **Status:** approved 2026-10-24; plan [`2026-10-24-sensor-platform.md`](../plans/2026-10-24-sensor-platform.md).
- **Register:** no row. Nothing here is a defect against shipped behaviour.
- **Related:** [`docs/product/requirements.md`](../../product/requirements.md)
  §93 (semantic binding), §97 (honest capability), §99 (custom API sensors),
  §101 (credentials and fetching), §111 (minimal overhead), §116 (where work
  happens); [ADR-0009](../../adr/0009-capability-driven-sensors.md);
  [`docs/decisions/0004-select-the-assigned-device-not-the-maximum.md`](../../decisions/0004-select-the-assigned-device-not-the-maximum.md);
  [`docs/architecture/ownership.md`](../../architecture/ownership.md).
- **Future:** a widget platform is not built now. This spec's descriptor,
  sample, image and custom-source contracts are shaped so widgets can be added
  later without a second vocabulary, a second source store or a second image
  path.

## Purpose

Widen the sensor product from a hardware summary to the readings people expect
from LibreHardwareMonitor, Rainmeter and a monitoring overlay, and make the
source side extensible without shipping a new build for every data source.

The user-visible outcomes:

1. Every physically distinct fan, temperature, voltage, battery, drive and
   network interface can be bound separately.
2. Units are the consumer's choice, not the provider's accident: GHz or MHz,
   MB/s or Mb/s, °C or °F, GB or GiB, auto-scaled where the magnitude varies.
3. Weather, Now Playing, FPS/frametime and the running game are first-class
   readings.
4. A user can add an HTTP JSON source with credentials and map its fields to
   new semantic keys, without editing Yunari.
5. A reading can drive an image (album art, weather icon, game box art), not
   only text and charts.
6. Weather and custom HTTP sources have a consumer-configurable polling rate.

## What this is not

- It is not a new hardware collector. LHM and `systeminformation` stay the
  acquisition owners (§97, §99); this spec maps and formats what they report.
- It is not a widget runtime. Widget sandboxing, packaging, streams and editor
  styling are future work. This spec defines the data contract those widgets
  would consume.
- It is not a cloud service. Every remote source is fetched by the host; no
  display talks to a third party.
- It is not a promise that every reading exists on every machine. Missing
  readings stay explicit.

## Current state

- `renderer-core/src/data/semantic-keys.ts` declares 31 built-in keys in eight
  families: `cpu`, `ram`, `gpu`, `vram`, `disk`, `network`, `time`, `date`.
  `describeSemanticKey`, `semanticKeysByFamily` and `labelForSemanticKey` read
  the static table. Disk keys are the one dynamic shape
  (`disk.<device>.<quantity>`).
- `Sample` (`renderer-core/src/types.ts`) already carries `value`,
  `textValue`, `booleanValue`, `unit`, `status` and `message`. The wire shape
  does not need to change for new value kinds.
- The host registers three providers in `packages/host/src/main.ts`:
  `ClockSensorProvider`, `LibrarySensorProvider` (`systeminformation`) and
  `LhmSensorProvider`. `ProviderRegistry` polls the requested-key union and lets
  the earliest `ok` sample claim a key.
- `LhmSensorProvider` reads LHM's `data.json`, flattens it in
  `providers/lhm-tree.ts`, and maps sensors in `providers/lhm-mapping.ts`. That
  map binds 8 of LHM's 21 sensor types and 5 of its 14 hardware types. Fans are
  collapsed to one `cpu.fan`/`gpu.fan` maximum; other fan headers, pumps,
  motherboard/VRM/chipset/coolant/drive temperatures, voltages, PSU, battery and
  power monitor are unread.
- `packages/host/src/settings/display.ts` owns the host-global display
  preference (`display.json`): an optional time zone and an optional
  `measurement` of `metric`/`imperial`. `renderer-core/src/scene/measurement.ts`
  converts temperature only, at presentation.
- `Binding` (`renderer-core/src/theme/document.ts`) has `semanticKey`,
  `precision`, `unitDisplay`, `scale`, `offset`, `format` and `timeZone`. It has
  no way to pin a unit.
- Image nodes persist a `yunariAsset` reference. The envelope's
  `bindings` map is keyed by Fabric object id and is currently hydrated for text
  and charts only (player `main.ts`, `scene-fabric/src/fabric-text.ts`,
  `chart-object.ts`). A binding on an image object has no reader.
- Credentials are a loopback-only, write-only store
  (`settings/credentials.ts`) with a hard-coded allowlist
  (`settings/credentials-registry.ts`). §99's custom sources do not exist.
- There is no weather, media, frame or game provider. There is no custom-source
  settings surface.

## Reuse gate evidence

The seven rungs were worked before this design, as the mechanism-boundary rule
requires. Results, including the rungs that found nothing:

1. **Owner.** The vocabulary and formatting owner is
   `renderer-core/src/data/semantic-keys.ts` plus `scene/measurement.ts` and
   `scene/plan.ts`. Acquisition owner is `packages/host/src/providers/`.
   Settings owner is `packages/host/src/settings/`. The design extends those; it
   does not add a second vocabulary, a second display preference or a second
   provider scheduler.
2. **Dependencies.** Hardware already comes from LHM and `systeminformation`; no
   new npm package is needed for hardware, weather or custom HTTP sources. The
   frame bridge vendors the PresentMon console application (MIT), the same
   acquisition shape as the already-vendored LHM binary. The media and location
   bridges use Windows PowerShell 5.1, which ships with Windows; no .NET build
   toolchain is added.
3. **Platform.** LHM exposes the hardware sensor set. Windows exposes SMTC
   (`Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager`),
   the Geolocator, foreground-window process identity, and RTSS/PresentMon
   frame telemetry. Open-Meteo, WeatherAPI and OpenWeatherMap serve weather;
   the latter two are BYOK. The platform supplies all the data; Yunari maps it.
4. **Ecosystem.** Rainmeter's measures and plugins (CPU, Memory, Net,
   FreeDiskSpace, NowPlaying, WebParser) and HWiNFO/Afterburner’s shared-memory
   exports were compared for coverage and mechanism. Rainmeter's NowPlaying is
   per-player, so it does not cover browsers; SMTC does. Rainmeter's weather is
   WebParser over an API, which is what the custom-source provider generalises.
5. **Comparison.** The comparable products do not expose a portable sensor
   vocabulary; they expose plugin-specific keys. Yunari keeps its semantic-key
   vocabulary and adds adapters beneath it. No existing package provides the
   Yunari descriptor/unit/image contract, so that contract is ours.
6. **Probe.** Verified on this PC: a Windows PowerShell 5.1 process can request
   `GlobalSystemMediaTransportControlsSessionManager`; Chrome playing YouTube
   produced a session with title, artist, playback status, timeline and a
   23,558-byte PNG thumbnail, and playback toggled to paused. **Not yet
   verified:** RTSS shared-memory layout and read; PresentMon console streaming
   and its privilege requirement; Windows Geolocator permission behaviour from
   the host; the board's real fan and temperature labels. These are phase-0
   probes, not assumptions.
7. **Build.** The only new maintained code is mapping, formatting, bridge
   supervision, validation and settings UI. No collector, parser or weather
   engine is written from scratch. Where an adapter needs a helper, it shells
   out to the platform tool and parses its documented output.

## Model

### Vocabulary

`SemanticFamily` becomes an open set. The built-in names stay exported as
constants so callers keep compile-time help, but a provider may contribute a new
family without a renderer release. Existing families keep their names and
order; new built-ins are added after `date`.

New built-in families: `cooling`, `motherboard`, `battery`, `psu`, `system`,
`audio`, `wifi`, `weather`, `media`, `frame`, `game`, `custom`.

Keys keep the `family.quantity[.qualifier]` shape. Dynamic keys follow the disk
precedent: the device id is a stable slug of the provider's own hardware/sensor
identity, never a position in an array.

| Family | Static keys | Dynamic keys |
|---|---|---|
| `cpu` | existing eight, plus `cpu.temp.package`, `cpu.temp.core.max`, `cpu.temp.core.avg`, `cpu.voltage`, `cpu.cores.physical`, `cpu.cores.logical` | `cpu.core.<n>.load`, `cpu.core.<n>.temp`, `cpu.core.<n>.clock` |
| `cooling` | `cooling.temp` (coolant/liquid) | `cooling.fan.<id>.rpm`, `cooling.fan.<id>.percent`, `cooling.pump.<id>.rpm` |
| `motherboard` | `motherboard.temp`, `chipset.temp`, `vrm.temp` | `motherboard.fan.<id>.rpm`, `motherboard.fan.<id>.percent`, `motherboard.voltage.<id>` |
| `gpu` | existing six, plus `gpu.temp.core`, `gpu.temp.hotspot`, `gpu.voltage`, `gpu.clock.memory` | `gpu.fan.<n>` |
| `vram` | existing three, plus `vram.temp` | — |
| `disk` | existing aggregate and data-slot keys | add `disk.<id>.free`, `.temp`, `.health`, `.read`, `.write`, `.activity` |
| `network` | existing `network.download`, `network.upload` | `network.<id>.download`, `network.<id>.upload` |
| `wifi` | `wifi.ssid`, `wifi.signal`, `wifi.linkSpeed` | — |
| `battery` | `battery.level`, `battery.state`, `battery.charging`, `battery.timeRemaining`, `battery.rate`, `battery.voltage`, `battery.health`, `battery.ac` | — |
| `psu` | `psu.power`, `psu.temp`, `psu.fan` | `psu.voltage.<id>` |
| `system` | `system.uptime`, `system.processes`, `system.hostname`, `system.os`, `system.osBuild` | — |
| `audio` | `audio.volume`, `audio.muted` | — |
| `weather` | `weather.location`, `weather.temp`, `weather.feelsLike`, `weather.conditionCode`, `weather.condition`, `weather.icon`, `weather.humidity`, `weather.windSpeed`, `weather.windDirection`, `weather.windDirection.compass`, `weather.pressure`, `weather.precipitation`, `weather.isDay`, `weather.sunrise`, `weather.sunset`, `weather.high`, `weather.low`, `weather.attribution` | — |
| `media` | `media.title`, `media.artist`, `media.album`, `media.artwork`, `media.state`, `media.position`, `media.duration`, `media.app` | — |
| `frame` | `fps.current`, `frametime.current`, `fps.low1`, `frame.app` | — |
| `game` | `game.name`, `game.artwork`, `game.running`, `game.app` | — |
| `custom` | — | `custom.<source>.<field>` |

Aggregate keys stay for compatibility: `cpu.temp` remains the package/core-max
figure, `gpu.temp` remains the core temperature, `cpu.fan`/`gpu.fan` remain the
first/hottest fan. Role-specific keys are additions, not replacements.

Dynamic ids are slugs produced by the existing `diskDeviceId`-style rule:
lowercase, non-alphanumerics collapsed to `-`, trimmed to 64 characters. When
two sensors would produce the same id, the later one takes a numeric suffix.
Identity is the provider's stable sensor identity, not the order in LHM's tree.
Per-core numbers are 1-based, matching LHM's own `Core #1` labels.

### Descriptors

`SemanticKeyDescriptor` gains:

```ts
type UnitKind =
  | "percent" | "temperature" | "clock" | "data" | "dataRate"
  | "power" | "voltage" | "current" | "rotation" | "duration"
  | "speed" | "pressure" | "count" | "text" | "boolean";

interface SemanticKeyDescriptor {
  readonly key: string;
  readonly family: string;
  readonly label: string;
  readonly unit?: string;
  readonly unitKind?: UnitKind;
  /** Units this key may be displayed in, besides `unit`. */
  readonly displayUnits?: readonly string[];
  readonly valueKind?: "number" | "text" | "boolean";
  /** The binding renders an image URL rather than a value. */
  readonly mediaKind?: "image";
  readonly expectedTier: SensorTier;
  readonly converts?: "temperature";
  readonly instant?: { readonly defaultFormat: string };
}
```

`unitKind` is the conversion contract. A key with a unit but no `unitKind` is
shown as measured and cannot be converted. A key with `mediaKind: "image"`
carries a host-relative URL in `textValue`; it is not a measurement.

Descriptors remain provider-owned. `SEMANTIC_KEYS` is the built-in default
catalogue, not the complete runtime list.

### Discovery

`GET /api/sensors` already returns every provider's descriptors. It becomes the
source of truth for pickers:

- Text-run and chart pickers request the descriptor list from the host, group by
  `family`, and show `label`. They fall back to the static built-in table when
  no host is connected or the request fails, so a disconnected editor is not
  empty.
- Custom and dynamic keys appear exactly like built-in keys. There is no
  separate “custom binding” system.
- Unknown keys remain valid in a saved theme. They render as gaps with their raw
  key, as today.

`semanticKeysByFamily()` keeps working over the built-ins for editor code that
has no host. A new grouping helper accepts an arbitrary descriptor list.

### Status semantics

Existing statuses are unchanged: `ok`, `missing`, `stale`, `error`,
`unavailable`. New providers add no status. A provider with no value returns no
entry or a non-`ok` entry with a redacted reason; it never returns zero.

## Units and formatting

### Canonical values do not change

This is deliberate. Gauge ranges, chart thresholds and author scale/offset were
written against the sampled magnitudes. Changing `ram.used` from gigabytes to
bytes would silently invalidate every authored threshold.

Canonical units stay:

- `cpu.clock`, `gpu.clock`, `cpu.core.<n>.clock` — `MHz`
- `network.download`/`upload` and per-interface rate — `Mb/s`
- `ram.*`, `vram.*`, `disk.*` capacity — `GB`, where LHM and the library mean
  2^30 bytes even though the label reads GB
- temperatures — `°C`
- fans — `RPM`; fan control — `%`
- power — `W`; voltage — `V`; current — `A`
- battery time — `s`; uptime — `s`
- weather wind — `km/h`; pressure — `hPa`; precipitation — `mm`

The spec records the GB/GiB ambiguity rather than hiding it: the formatter
offers both `GB` and `GiB` labels, and the decimal mode converts the value
correctly instead of relabelling a binary number.

### Where conversion happens

One place: presentation, after the binding's authored `scale`/`offset`, in
`renderer-core`. Providers never convert for a display preference. This keeps
the sample equal to what was measured (§97) and keeps two displays on one host
able to show different unit choices.

`scene/measurement.ts` grows from a temperature-only conversion into a
unit-preference conversion. Its public shape stays small:

```ts
interface UnitPreferences {
  readonly measurement?: "metric" | "imperial"; // temperature, existing owner
  readonly clock?: "mhz" | "ghz" | "auto";
  readonly data?: "binary" | "decimal";
  readonly dataScale?: "auto" | "mb" | "gb" | "tb";
  readonly rate?: "bits" | "bytes";
  readonly rateScale?: "auto" | "k" | "m" | "g";
  readonly windSpeed?: "kmh" | "mph" | "ms";
  readonly pressure?: "hpa" | "inhg";
}
```

`measurement` stays the temperature owner. Adding a second temperature field
would create two owners for one choice.

### Display preferences

`packages/host/src/settings/display.ts` (`display.json`) gains `units`:

```json
{
  "measurement": "metric",
  "units": {
    "clock": "auto",
    "data": "binary",
    "dataScale": "auto",
    "rate": "bits",
    "rateScale": "auto",
    "windSpeed": "kmh",
    "pressure": "hpa"
  }
}
```

The existing settings page writes it; the player reads it through the same
settings endpoint it already uses. Normalization refuses an unknown value
rather than storing a setting that does nothing.

### Binding overrides

`Binding` gains two optional fields:

```ts
readonly unit?: string;      // e.g. "GHz", "MB/s", "GiB"
readonly autoScale?: boolean; // author asks for magnitude-based prefixing
```

- A binding `unit` wins over the display preference for that binding. The
  author may pin GHz because the design needs a short string.
- `autoScale: true` asks the formatter to choose the prefix. It is meaningful
  only for keys whose descriptor allows more than one unit.
- An unsupported override is a plan-time issue, not a crash. The binding shows
  the measured unit and the issue names the key. The theme still loads.
- Absent both, the display preference applies.

### Auto-scale rules

- Clock: below 1000 MHz show MHz; at or above show GHz with one decimal
  (two below 10 GHz).
- Data: choose MB below 1 GB, GB below 1024 GB, TB above. Binary uses 1024;
  decimal uses 1000 and converts the stored 2^30-based value.
- Rate: choose kb/s below 1 Mb/s, Mb/s below 1000 Mb/s, Gb/s above. Byte mode
  divides by 8 and labels `kB/s`, `MB/s`, `GB/s`.
- Weather wind and pressure use the chosen unit; no auto prefix.

Precision runs after conversion. The binding's `precision`, when present, wins;
otherwise the formatter's default for the chosen unit applies. The existing
`unitDisplay` (`none`/`short`/`long`) keeps working.

## Provider model

The existing `SensorProvider` contract stays: `describe`, `sample`, `health`.
Three additions:

1. **Sample context.** `sample` gains an optional context carrying the
   assignment and the display's theme language. The registry groups by
   `(assignment, language)` so two displays showing different theme languages
   can receive different weather text from one acquisition cycle.
2. **Cached acquisition.** A provider owns its own poller when its cadence is
   slower or faster than the host sample cycle. `sample` returns the latest
   cached reading with its age; it does not fetch on every call. Weather (its
   configured interval), custom sources (per source) and media (1 s) all work
   this way. Hardware providers keep reading per cycle.
3. **Demand-driven suspension.** A provider polls only while its keys are in
   the requested union, with a grace period (existing §120). Media and custom
   sources stop their timers when nothing asks for them.

Polling rates are owned by the source that knows the cost:

- Hardware providers follow the host's sample cycle; they have no independent
  interval.
- Weather takes `pollIntervalMs` from its settings (default 10 minutes).
- Each custom HTTP source has its own `intervalMs` in its source definition
  (default 60 seconds, minimum 10 seconds).
- Media polls at 1 second while demanded; the interval is not user-tunable,
  because it tracks a local system session rather than a remote API.

No remote provider is polled while nothing binds its keys. Any future HTTP
sensor provider takes its interval from settings or its source definition; a
hard-coded remote cadence is refused in review.

Scheduling, failure isolation, precedence and unmapped reporting remain
`ProviderRegistry`'s. A provider failure never blanks another provider's keys.

### Helper bridges

Three features need a helper process rather than an in-process Node call:

- SMTC media (PowerShell 5.1, WinRT projection).
- Windows location and foreground-process identity (PowerShell 5.1, WinRT and
  P/Invoke).
- RTSS shared memory (PowerShell 5.1 `Add-Type` with C# P/Invoke), and
  PresentMon (vendored console binary, parsed as CSV).

All helpers share one supervision policy, owned by the host:

- Spawn only while keys need it; terminate on host shutdown.
- Locate `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`
  explicitly; `pwsh` is not assumed.
- Read stdout as line-delimited JSON; stderr is diagnostic text and is
  redacted before it can reach a browser.
- Restart with capped exponential backoff; after repeated failure, report
  `unavailable` with the last redacted reason and stop retrying until the next
  demand window.
- Bound messages and artwork/asset sizes.
- Kill the whole process tree on timeout, never leave an orphan.

The helper is a child of the host process, not of a tray application. Host
autostart already exists (`registerHostAutostart`); a tray UI is separate and is
not required for these providers to run at sign-in.

## Built-in coverage

### Hardware: LHM mapping

`providers/lhm-mapping.ts` gains bindings for the hardware and sensor types it
currently ignores. The match rule stays explicit names plus sensor type and
hardware group, never provider instance identity.

| Reading | LHM source shape | Keys |
|---|---|---|
| CPU cores | `Cpu` hardware, per-core `Load`, `Temperature`, `Clock` sensors | `cpu.core.<n>.load/temp/clock` |
| CPU package | `CPU Package`, `Core Max`, `Core Average` | `cpu.temp.package`, `.core.max`, `.core.avg` |
| CPU voltage | `Cpu` `Voltage` | `cpu.voltage` |
| Motherboard | `Motherboard` `Temperature` | `motherboard.temp` |
| Chipset / VRM | `SuperIO` or `Motherboard` named sensors | `chipset.temp`, `vrm.temp` |
| Board fans | `SuperIO`/`Motherboard` `Fan` and `Control` | `motherboard.fan.<id>.rpm/.percent` |
| AIO/cooler | `Cooler` `Temperature`, `Fan`, pump sensor | `cooling.temp`, `cooling.pump.<id>.rpm` |
| GPU hotspot | `Gpu*` `Temperature` named Hot Spot | `gpu.temp.hotspot` |
| GPU memory junction | `Gpu*` `Temperature` named Memory Junction | `vram.temp` |
| GPU memory clock | `Gpu*` `Clock` named Memory | `gpu.clock.memory` |
| GPU voltage | `Gpu*` `Voltage` | `gpu.voltage` |
| GPU fans | `Gpu*` `Fan` | `gpu.fan.<n>` |
| Drive temperature/life | `Storage` `Temperature`, `Level` | `disk.<id>.temp`, `.health` |
| Drive activity/throughput | `Storage` `Load`/`Throughput` | `disk.<id>.activity`, `.read`, `.write` |
| NIC throughput | `Network` `Throughput` per node | `network.<id>.download/upload` |
| PSU | `Psu` `Power`, `Temperature`, `Fan`, `Voltage` | `psu.power`, `.temp`, `.fan`, `.voltage.<id>` |
| Battery | `Battery` `Level`, `Voltage`, `Power`, `TimeSpan` | `battery.*` |

Fan labels are the sensor's own name. A later display-level rename map may make
`Fan #3` readable, but this spec does not add one: inventing a friendly name for
an unknown header would be worse than showing the board's own label.

`systeminformation` fills the keys LHM does not expose: battery state and time
remaining, Wi-Fi SSID/signal/link speed, uptime, process count, OS identity and
audio volume/mute. Where both can answer, LHM stays first via provider order.

The hardware tables above are covered by fixture tests built from real LHM
`data.json` captures, not hand-invented sensor names. A name absent from every
fixture is not added to the map until a capture shows it.

### Weather

Provider: `weather`. It is always registered when the LAN is on and reports
`unavailable` when no location is configured and the Windows fallback is off.

Three backends, selected explicitly in host settings (`weather.json`'s
`provider`; absent means `open-meteo`). There is no silent fallback: a provider
whose key is missing or rejected reports that, rather than spending a different
account's quota.

| Provider | Key | Credential id | Notes |
|---|---|---|---|
| `open-meteo` (default) | none | — | Current + daily high/low + sunrise/sunset; attribution required |
| `weatherapi` | BYOK | `weatherapi` | Metric request; condition codes mapped to the canonical set |
| `openweathermap` | BYOK | `openweathermap` | Metric request; condition codes mapped to the canonical set |

BYOK keys live in the existing credential store, are write-only from the
browser, and are read only inside the host process when a request is built.
They never enter a theme, a sample, a URL shown to a display, a log line or an
error message. The credentials page lists both entries with their issuing page
and a verify action; verification spends one real request.
`credentials-registry.ts` gains `weatherapi` and `openweathermap` entries, and
`CredentialKind` gains `query` for keys that ride in the query string (the
existing `bearer` and `cookie` kinds stay unchanged).

Location, in priority order:

1. **Manual place** in host settings: label, latitude, longitude. A search field
   uses Open-Meteo's geocoding endpoint regardless of the chosen weather
   backend; geocoding is not weather data and needs no key. The chosen place is
   stored. This is the documented, permission-free path.
2. **Windows location** when manual is unset and the consumer enables it. A
   PowerShell helper requests location access and one position, then reports
   denial or timeout as a reason. It is never silent.
3. Otherwise `unavailable` with “Set a place in Settings, or turn on Windows
   location.”

No IP-based lookup. It leaks the query, is wrong behind a VPN, and is less
private than an explicit place.

Acquisition: the selected backend's current-conditions endpoint, normalized to
current conditions plus today's high, low, sunrise and sunset. Request metric
units from every backend so canonical values are stable. The poll interval is
the consumer's setting: `pollIntervalMs` in `weather.json`, default 600000
(10 minutes), permitted 60000–86400000. It applies while keys are demanded; the
provider keeps the last good reading and marks it `stale` after three missed
intervals or 30 minutes, whichever is longer; back off on failure; cap the
response size; redact the URL, key and any host detail from reasons. A value
outside the permitted range is refused in settings, not clamped.

Keys and semantics:

- `weather.temp`, `weather.feelsLike`, `weather.high`, `weather.low` — `°C`.
- `weather.conditionCode` — WMO code as a number. Every backend maps its own
  condition code into this canonical set; the mapping is fixture-tested.
- `weather.condition` — localized text for the served display's theme language,
  English fallback. The text comes from the canonical code table, not from the
  backend's own strings, so switching providers does not change the wording.
- `weather.icon` — host-relative SVG URL for the code and day/night state.
- `weather.humidity` — `%`; `weather.pressure` — `hPa`;
  `weather.precipitation` — `mm`.
- `weather.windSpeed` — `km/h`; `weather.windDirection` — degrees;
  `weather.windDirection.compass` — the compass point as text.
- `weather.isDay` — boolean.
- `weather.sunrise`, `weather.sunset` — ISO instants, rendered through the
  binding's `format`/`timeZone` like the clock.

Localization: the WMO code table lives with the weather provider and is keyed by
the theme's declared language. Unsupported languages fall back to English
rather than showing a code as prose. The table is a closed 28-entry vocabulary,
not a translation platform.

Icons: a bundled open-licence SVG set, one icon per code/day-night pair, served
from a host route. The licence is verified before the set is added and recorded
in `THIRD-PARTY-NOTICES.md` and `docs/engineering/dependencies.md`. If no icon
maps, `weather.icon` is unavailable rather than a generic wrong picture.

Attribution: shown for the selected backend on the host settings page, and
available as a `weather.attribution` text key for themes that want to draw it.
Open-Meteo's terms require attribution; the BYOK providers' terms are checked at
implementation time.

### Media

Provider: `media`, backed by the PowerShell SMTC helper.

- Select the first session whose playback status is playing; otherwise the
  system's current session; otherwise `unavailable`.
- Poll every second while any `media.*` key is demanded. Read metadata only when
  the session or track identity changes; artwork only when `media.artwork` is
  demanded and the track changed.
- Keys: `media.title`, `media.artist`, `media.album`, `media.state`
  (`playing`/`paused`/`stopped`), `media.position` (`s`), `media.duration`
  (`s`), `media.app` (the source application's display name).
- `media.artwork` is an image key. Its `textValue` is a host-relative URL
  (`/api/media/artwork/<sha>.<ext>`), never an absolute URL. The host writes
  thumbnail bytes to a bounded cache keyed by content hash, serves them with
  immutable caching, and evicts oldest entries beyond a cap. A changed track
  changes the hash, so a display cannot show the previous track's art under a
  new title.
- Position is sampled, not interpolated by the provider. The player may animate
  a progress bar from its own clock, but the displayed number is a measurement.

Browser coverage: Chromium/Edge publish Media Session metadata to Windows SMTC;
this is the path that makes a web player readable without a per-player adapter.

**Probe, 2026-10-24:** Chrome playing YouTube ("Me at the zoo") appeared as one
SMTC session with `SourceAppUserModelId = Chrome`, the video title, the channel
as `Artist`, `PlaybackStatus` `Playing`, a real timeline, and a PNG thumbnail.
Toggling the player with YouTube's `k` shortcut changed the status to `Paused`.
The thumbnail was read as 23,558 bytes with a PNG signature and a stable
SHA-256. This confirms browser → SMTC → helper end to end.

The thumbnail read needs one workaround. Windows PowerShell 5.1 does not project
the WinRT stream interfaces: `AsStreamForRead`, direct `DataReader`
construction and `RandomAccessStream.CopyAsync` all fail on the `__ComObject`.
Constructing `DataReader` through its reflected `IInputStream` constructor, then
`LoadAsync` and `ReadBytes`, works. The helper uses that path and carries a
regression test for it, because it depends on the WinRT projection rather than a
public .NET API. If a future Windows build breaks it, `media.artwork` reports
unavailable and text metadata keeps working.

If a browser does not publish a Media Session, it is simply absent from the
session list; metadata is never guessed from a window title.

### Frame and game presence

One provider, `frame`, with two adapters used in priority order:

1. **RTSS shared memory.** When RivaTuner Statistics Server is running, read
   its shared-memory frame statistics: present rate, frame time and presenting
   application. No install and no elevation; RTSS already has the privileges it
   needs.
2. **PresentMon console.** Vendor the MIT-licensed `PresentMon.exe` the way LHM
   is vendored. Spawn it with stdout CSV, no file output, continuous capture;
   parse `msBetweenPresents` and the application/process columns. It requires
   membership in `Performance Log Users` or elevation; if the trace session is
   denied, report that reason once and stay unavailable. Do not prompt for UAC
   on every sample cycle.

Keys: `fps.current` (frames per second), `frametime.current` (`ms`),
`fps.low1` (the 1% low over a rolling 60-second frametime window) and
`frame.app` (the presenting application's name). `fps.low1` is a derived
statistic and its label says so; it is `unavailable` until the window holds
enough frames to mean anything (at least 1000), never a number computed from
three frames.

Game presence is a separate, lower-privilege read:

- A foreground-process helper reads the window's process id and executable path
  once a second.
- The host matches the path against installed Steam libraries
  (`steamapps/libraryfolders.vdf`, `appmanifest_*.acf`), producing
  `game.name`, `game.app` and `game.running`.
- `game.artwork` is an image key pointing at a host-served copy of the local
  Steam library-cache image for that app id. A local image is preferred and
  costs no network access. If the local cache has no image, the host falls back
  to the cached store cover described below; with neither, the key is
  unavailable.
- A non-Steam game is named by the store lookup below when one matches; with no
  match it falls back to the executable name and no art. This is honest, not a
  generic placeholder.
- `frame.app` and `game.*` may disagree if the presenting process is not the
  foreground window; each says what it actually read.

Presence is not a Discord integration. There is no public Discord game-detection
API to consume; this reproduces the useful part locally.

#### Remote game metadata (Steam store, on by default)

Local store adapters cover Steam and, later, GOG and Epic, but most stores
cannot be enumerated. The host therefore queries Valve's public Steam store
endpoints for a game it could not name locally:

- `store.steampowered.com/api/storesearch` to find a candidate by name.
- `store.steampowered.com/api/appdetails` to confirm the app and its header
  image.

Both are keyless and need no credential. **The lookup is on by default** because
the alternative is a library of unnamed executables; it is not a per-store
adapter. SteamDB is not used: it has no API and forbids scraping.

**What is sent** is the game's local name (the executable's version
information, else its file name without extension) or, for a Steam install, its
appid. Nothing
else — no account, no library list, no machine identifier. **What is kept** is a
small on-disk map from normalised name to appid (including "no match"), the
searched term, the canonical name and the first-lookup time, plus the downloaded
cover bytes. A lookup happens once per game — across restarts, not only per
process life — and the display works offline afterwards.

**Matching is tiered, and ambiguity is refused.** Normalisation folds case,
strips `™ ® ©`, punctuation and leading articles, removes Latin diacritics but
never the marks that distinguish non-Latin letters (kana voicing, Cyrillic
phonemic marks), and drops edition qualifiers as trailing words. One-word
qualifiers safe to drop bare are `definitive`, `deluxe`, `ultimate`, `complete`,
`enhanced`, `remastered`, `collector's`, `director's cut`, `goty` and
`game of the year`; `gold`, `special`, `legendary` and `anniversary` are dropped
only as part of a phrase that carries `edition`, because they are also
distinguishing title words (`Pokémon Gold`, `Halo: Anniversary`). Two search
entries carrying one appid are one candidate. A match is accepted only when the base titles are equal or
their token sets are equal after the qualifiers are dropped, and only if exactly
one candidate remains. `Doom` must not match `Doom Eternal`, and no prefix or
substring rule is used at all: a sequel's extra word is not a qualifier, so it
makes the title different. Two remaining candidates leave the game unnamed.

`game.app` is always the process's file name. When no match is found, `game.name`
stays absent and the gap says so; when one is, `game.name` is the store's
canonical name. Covers are downloaded once, cached by appid under the host's own
directory, and served through the gated `/api/game/artwork/<appid>.jpg` or
`.png` route. A display never receives a Steam URL.
Offline, a failed lookup or a rate-limited response degrades to the local
behaviour with a reason; the cache keeps working.

## Image binding

A reading can drive an image object without a new persisted node shape.

- A theme's `bindings` map is already keyed by Fabric object id. An image object
  may carry a binding whose descriptor has `mediaKind: "image"`.
- The player hydrates images the way it hydrates charts: walk the revived
  objects, find the image's own binding list, pick the first image-capable key,
  and set the image `src` from `sample.textValue`. The value is resolved through
  the display session token, the same way packaged assets are; a sample can
  never cause a display to load an arbitrary external URL.
- The authored `yunariAsset` source remains the fallback while there is no
  reading. When a reading becomes `unavailable` or `error`, the image returns to
  the authored fallback rather than keeping the last album/icon indefinitely.
- A URL is accepted only when it is host-relative: it starts with `/`, has no
  scheme and no `//` authority. Absolute URLs in a sample are refused with a
  plan issue. This is the rule that keeps artwork, weather icons and box art
  from becoming a tracking surface.
- The editor's image inspector gains a sensor picker filtered to image-capable
  descriptors. The editor preview uses its existing fake/live source; with no
  reading the authored asset shows.
- Loading is bounded by the existing asset error hook; a failed image reports a
  redacted reason and leaves the fallback.

No schema version bump: `bindings` and `yunariAsset` already exist. The
validator learns that an image object may carry an image binding and refuses a
binding whose key is not image-capable at plan time.

## Custom sources (§99)

### Persisted model

`packages/host/src/settings/sources.ts` owns `sources.json` in the host settings
directory. One file, atomic temp-file + rename, the same pattern as credentials
and displays.

```ts
interface CustomSource {
  readonly id: string;          // [a-z0-9_-]{1,32}, stable, becomes a key segment
  readonly name: string;
  readonly url: string;         // http(s), no credentials in the URL
  readonly query?: Readonly<Record<string, string>>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly intervalMs: number;  // 10_000 .. 86_400_000
  readonly timeoutMs: number;   // 1_000 .. 10_000
  readonly auth?: {
    readonly kind: "none" | "bearer" | "basic" | "header" | "query";
    readonly credentialId?: string;
    readonly headerName?: string;
    readonly queryName?: string;
  };
  readonly fields: readonly CustomField[];
}

interface CustomField {
  readonly id: string;          // [a-z0-9_-]{1,32}
  readonly label: string;
  readonly pointer: string;     // RFC 6901 JSON Pointer
  readonly type: "number" | "text" | "boolean";
  readonly family?: string;     // defaults to "custom"
  readonly unit?: string;
  readonly unitKind?: UnitKind;
  readonly scale?: number;
  readonly offset?: number;
  readonly expectedTier?: SensorTier;
}
```

Limits are part of the contract, not tuning knobs: 32 sources, 64 fields per
source, 1 MiB response, 4 concurrent in-flight fetches across all sources, one
fetch per source at a time. A value outside the limits is refused in the
settings UI, not clamped silently.

### Keys and descriptors

Field key: `custom.<sourceId>.<fieldId>`. The id segments are validated before
storage, so the key is always a legal semantic key. Collisions with built-ins or
between sources are impossible by construction; a duplicate field id inside one
source is refused.

`CustomSourceProvider.describe()` returns a descriptor per field:
`label`, `family` (the field's family or the source's name when custom), `unit`,
`unitKind`, `valueKind` and the declared tier. `sample()` returns the cached
value: number with unit, text, or boolean. Values are scaled/offset once at
acquisition; a missing pointer is `missing` with the pointer in the redacted
reason. A type mismatch is `error`, never a coercion. After three missed
intervals the last good value is `stale`, not silently fresh; after a
successful fetch it returns to `ok`.

### Credentials

The source's `auth.credentialId` is a reference, never a value. The credential
store stays the owner; `credentials-registry.ts` gains a provider that appends
the user-defined credential ids from `sources.json` to the built-in Unsplash
entry.

- The browser remains write-only: `GET` returns `set` and a four-character hint.
- The value is read only inside the host process when a fetch is built.
- Deleting a source offers to clear its credential. It never silently deletes a
  secret; an orphaned entry is visible and removable.
- Secrets never enter a theme, a sample, a log line or an error message.
- `basic` credentials are stored as `user:password` in the one value field.

### Fetching and validation

- `GET` only, matching §99. No methods, no request bodies.
- `http` and `https` only. Redirects: at most three, same scheme; an
  `https` → `http` downgrade is refused; credentials are dropped when the
  origin changes.
- A header or query value typed directly into a source is stored in
  `sources.json` in plain sight. The form says secrets belong in the credential
  store, and the `auth` block is the only path that reads one.
- Cloud metadata and link-local addresses are refused. Loopback and private-LAN
  addresses are allowed: a local-first product has legitimate local services,
  and the user typed the URL.
- Response must be JSON content with a bounded body; a non-2xx status is
  `error` with the status, not a value.
- TLS verification is never disabled.
- Reasons are redacted through `redactForBrowser` before they reach a display.
- One failing source never affects another source's sample or the hardware
  providers.

### Host settings surface

A Sources page on the host settings UI, loopback-only for every route like the
credentials routes:

- List sources with health, last success and field count.
- Add/edit: name, URL, query, headers, interval, timeout, auth, fields.
- A field row: id, label, JSON Pointer, type, family, unit, scale/offset.
- Test: performs one fetch with the real credential, shows status, elapsed time
  and the first few mapped values. A test never stores the fetched data.
- Delete: confirms, removes the source, and offers to clear its credential.
- The page shows the redacted last error, not a raw URL or stack.

The theme editor does not own source configuration. It links to the host page.
This keeps credentials on the loopback surface and keeps one owner for the
source store.

### Editor discovery

Custom descriptors flow through `/api/sensors`, so the text-run and chart
pickers list them beside built-ins. A theme saved with a custom key keeps the
key when the source is deleted; it renders a gap with a reason rather than
losing the binding or showing zero.

## Settings and persistence

- `display.json` gains `units`; normalization refuses unknown values. Existing
  files without it keep today's behaviour.
- `sources.json` is new, atomically written, validated on read. An invalid
  entry is skipped with a health reason and shown in the Sources page; it never
  fails the host or blanks the other sources.
- Weather location is stored in `weather.json`
  (`{ provider, label, latitude, longitude, useWindowsLocation, pollIntervalMs }`),
  atomically written and validated (`provider` is one of the three known
  backends, latitude −90..90, longitude −180..180, non-empty label, interval
  60000–86400000).
- Each custom source carries its own `intervalMs` (default 60000, minimum
  10000); there is no host-wide override for an individual source.
- Media artwork and game box art are caches, not settings: content-hashed files
  under the host cache directory with bounded eviction. They are derived data
  and never enter a theme.
- No new persisted runtime state: samples, history, artwork bytes, FPS windows
  and helper output are all transient.

## Protocol and theme impact

- The sample wire shape does not change. New values use the existing numeric,
  text and boolean fields; image values are host-relative text.
- Descriptors are an HTTP response (`/api/sensors`), not a new stream. Adding
  fields to them is backward-compatible for the player; the editor must tolerate
  absent fields.
- `Provider.sample` gains an optional context argument. Internal contract only;
  no wire change.
- `Binding` gains optional `unit`/`autoScale`. The schema and validator change
  together; older themes omit them and behave as today. Both fields are
  optional, so `SUPPORTED_SCHEMA_VERSION` stays 2: a theme written before this
  opens unchanged, and the validator accepts the fields when present. An
  unsupported unit override is a plan-time issue, not a load failure.
- The image binding uses the existing `bindings` map keyed by Fabric object id.
  `SUPPORTED_SCHEMA_VERSION` stays 2; no persisted node shape is added. An image
  binding is validated at plan time, and a malformed/unsupported one is an
  issue, not a load failure.
- `sample.context` language grouping changes the registry's group key, not the
  payload.
- No new npm runtime dependency is required for this spec. The weather
  backends and SMTC are external/platform services accessed by the host; the
  media helper uses Windows PowerShell. PresentMon is a vendored MIT binary for
  the frame adapter. Licences are verified and recorded before anything ships.

## Editor and player surfaces

- **Editor pickers:** text runs and charts use host descriptors with a static
  fallback. Custom/dynamic keys appear in their family group with their label.
- **Image inspector:** a sensor picker for image-capable keys, plus the existing
  authored asset. The fallback is visible in the preview.
- **Unit controls:** the host settings page owns unit preferences. The editor
  does not offer a second place to set them; a binding's `unit` override is an
  authoring choice shown in the inspector.
- **Player:** hydrates text, charts and images from one sample source; applies
  the display unit preferences once at presentation; requests only the keys the
  theme binds.
- **Host settings:** Sources page, weather location and polling-rate controls,
  unit preferences, and provider health. Credentials remain write-only and
  loopback-only.

## Phases

Each phase is independently usable and independently verifiable.

1. **Vocabulary, units, discovery, image binding foundation.**
   Open family set, descriptors, dynamic-key helpers, unit conversion and
   auto-scale, `/api/sensors` consumption by the editor, image hydration from a
   binding, binding `unit`/`autoScale` validation. No new provider yet; test the
   path with a fake image sample and existing temperature/clock/rate readings.
2. **Hardware coverage.**
   LHM mapping for per-core, fans, role temperatures, voltages, drives, PSU,
   battery; `systeminformation` fill for Wi-Fi, uptime, processes, OS, audio,
   battery state. Fixtures from real captures; aggregate keys unchanged.
3. **Weather.**
   Location settings and Windows fallback, Open-Meteo provider, localization
   table, icon set and route, stale/cache behaviour, attribution.
4. **Media.**
   SMTC PowerShell helper, session/track polling, artwork cache and route,
   `media.*` descriptors, browser probe, player image hydration against real
   artwork.
5. **Custom sources.**
   `sources.json`, provider, credential integration, validation/security,
   Sources page, editor discovery of custom descriptors.
6. **Frame and game presence.**
   RTSS adapter, PresentMon adapter, rolling 1% low, foreground-process helper,
   Steam library matching, local box-art route, Steam store lookup with its
   tiered matcher and cache, unavailability reasons.

Weather before custom sources is deliberate: it exercises a built-in HTTP
provider and the image path before the generic, user-configured source makes the
same mistakes available to arbitrary URLs.

## Verification

### Unit tests

- Unit conversion: every supported unit pair, auto-scale thresholds, precision
  after conversion, unsupported override produces an issue and no crash.
- Canonical values unchanged for existing keys (regression against the current
  sample magnitudes).
- Dynamic-key identity: stable slugs, collision suffixes, 64-character cap.
- Descriptor union: built-in + provider + custom; duplicate keys resolve by
  provider precedence, never by last write.
- Image binding: host-relative URL accepted, absolute/external refused, missing
  sample falls back to the authored asset, unavailable clears stale art.
- Custom sources: schema validation, pointer resolution, type mismatch, scale/
  offset, redaction, redirect/auth-drop rules, size/concurrency limits.
- Weather: each backend's condition-code mapping to the canonical set,
  localization fallback, stale-after-threshold, missing/rejected key, no
  fabricated zero.
- Media: JSON-line parser, session selection, artwork hash identity.
- Frame: CSV parser, RTSS struct parser, 1% low window, insufficient-window
  unavailability.
- Steam library: VDF/manifest parsing and path matching.
- Steam store: name normalisation and matcher tiers, a candidate with an edition
  suffix, `Doom` refusing `Doom Eternal`, two equal candidates refusing, request
  carries only the local name, no request on a cache hit, "no match" cached,
  429/offline degradation, cover bytes cached by appid.
- Polling: weather interval validation and demand-driven suspension; custom
  source intervals; no remote fetch while unbound.

### Browser tests

- A rendered text binding shows a converted unit (GHz, MB/s, °F) after a
  preference change; the sample value itself is unchanged.
- An image object bound to a fake media/weather sample renders the host image and
  falls back correctly when the sample becomes unavailable.
- The editor picker lists a custom descriptor from a test provider and labels it.
- A custom source pointed at a local fixture server produces a bound value
  end-to-end; a failing source shows a redacted reason and no value.
- No absolute URL in a sample ever reaches an `<img>`.
- A provider failure leaves other providers' readings on screen.
- A game fixture server answers the store endpoints and the player paints the
  matched name and cover; the display requests no third-party URL; with the
  fixture stopped and the cache cleared the authored image returns with a reason.

### Manual probes, reported unverified until run

- **Run:** a real browser (Chrome) playing YouTube in SMTC with title, artist,
  playback status, timeline and a PNG thumbnail; artwork bytes read through the
  reflected `DataReader`. **Still unrun:** a non-publishing player staying
  absent, and a second concurrent session's precedence.
- Windows Geolocator permission prompt and denial behaviour from the host.
- Real fan/temperature labels from this motherboard and this GPU.
- Open-Meteo live response shape and the icon mapping.
- WeatherAPI and OpenWeatherMap live responses, only when the user supplies a
  key; the key is never recorded in the evidence.
- RTSS shared-memory read and PresentMon console stream on this PC, including
  the privilege failure path.
- Steam library-cache box-art path on this install.
- A live Steam store lookup for a game named only by its executable, and the
  portrait cover asset for an app that is not installed.

### Regression proof

Every new regression test is shown red with the fix disabled before it is
trusted. A provider that has only been tested against a hand-written fixture is
reported as fixture-tested, not hardware-tested.

## Acceptance

This spec is implemented when:

1. The built-in catalogue contains the families and keys listed above, and
   `/api/sensors` returns them from the providers that can answer.
2. The editor can bind text, chart and image surfaces to built-in, dynamic and
   custom keys; a disconnected editor still lists the built-ins.
3. Unit preferences visibly change clock, data, rate, wind and pressure
   **text** formatting without changing sample values or authored thresholds.
   Charts stay canonical in this phase, because their authored ranges and
   thresholds are written against sampled magnitudes.
4. A machine with LHM reports its fans, role temperatures, battery, drives and
   per-interface network readings separately; a machine without them reports
   unavailable, never zero.
5. Weather shows current conditions with a location from manual settings or the
   Windows fallback, an icon, and honest stale/unavailable reasons; each of the
   three backends is selectable, and a BYOK backend with no key says which
   credential is missing.
6. Now Playing shows title/artist/album/artwork from SMTC, including a real
   browser session, and returns unavailable when no session exists.
7. FPS/frametime and game presence work through at least one adapter on a real
   machine, with the other adapter’s failure path reported; a game named only
   by its executable gains the store's name and cover, and every cover reaches
   the display from the host, never from a third-party URL.
8. A user can add a credentialed HTTP JSON source in the host UI, see its
   descriptors in the editor, and bind its fields; deleting it leaves honest
   gaps.
9. Weather and custom-source polling intervals are editable, validated, and
   suspended while unbound.
10. Every acceptance item records what was observed, on which machine/provider,
    in the commit that lands it.

## Risks and unverified behaviour

- **Browser Media Session → SMTC** is verified on this PC: Chrome playing
  YouTube produced title, artist, playback status, timeline and a PNG thumbnail.
  Other players or browsers may not publish a session; absence is reported, not
  guessed. The artwork byte path is a WinRT reflection workaround, so it needs
  its own regression test and an artwork-unavailable fallback.
- **Windows Geolocator** from a Node-spawned PowerShell may prompt or refuse
  depending on Windows privacy settings and process identity. Manual location is
  the guaranteed path.
- **RTSS and PresentMon** are unverified on this box. RTSS requires RTSS running;
  PresentMon requires a trace privilege the user may not have. Both adapters can
  be unavailable on a given machine, which is a supported outcome.
- **LHM sensor names** vary by board and driver. The mapping is only as good as
  the captures behind it; a missing name is not guessed.
- **Steam library-cache box art** path and file naming are not verified. If it
  differs, the store cover fallback still answers when the game is found.
- **The Steam store lookup is a network request on by default.** What is sent is
  the local game name and nothing else, and the answer is cached, but Valve sees
  a machine asking about a title it is running. The endpoints are keyless and
  undocumented as a contract: a change or a rate limit degrades to the local
  behaviour with a reason. This trade was ruled by the user, not inferred.
- **Presence still treats every foreground window as a running game** (vg-714),
  so while that row is open the lookup can be asked about a browser or a file
  manager. Each distinct name costs one request, remembered on disk, so a
  restart does not ask again; the map and its timestamps are the inventory this
  paragraph discloses. Lookups run only while a `game.*` key is demanded.
- **Weather icon licence** must be verified before the set is bundled. An
  unverified set is not shipped.
- **Open-Meteo terms** (free tier, attribution, non-commercial) must be checked
  at implementation time; a commercial build needs its own arrangement.
- **WeatherAPI and OpenWeatherMap** response shapes, condition-code mappings and
  free-tier limits are unverified without user keys. Their verify actions spend
  a real request and must say so. A missing or rejected key stays explicit; it
  never silently falls back to Open-Meteo.

## Out of scope

- The widget runtime, sandbox, manifest, streams, music transport commands and
  editor widget styling — future work, not part of this spec.
- A tray application UI.
- Custom non-HTTP sources, arbitrary host code and user plugins.
- Store backends other than Steam (GOG, Epic, IGDB) and SteamDB; Steam is the
  only remote source in this phase, and its images are cached host-side rather
  than linked.
- Weather forecasts beyond today's high/low and sun times.
- Per-fan friendly-name renaming.
- Chart axis, gauge-range and chart-label unit conversion; charts keep canonical
  magnitudes so authored thresholds stay valid.
- Writing a hardware collector or replacing LHM/`systeminformation`.

## Future widget compatibility

Widgets are not built now. The contracts here are chosen so a widget platform
can be added without reshaping sensors or sources:

1. Descriptors, including `valueKind`, `unitKind` and `mediaKind`.
2. Samples, including host-relative image URLs and honest statuses.
3. Custom source fields, which widgets could declare as templates and bind.
4. Image hydration, which lets a widget wrapper or an inner image show artwork
   and icons.

A future widget runtime would add sandboxing and streams around these
contracts. It would not get a second sensor vocabulary, a second source store or
direct network access: its declared sensors are the same semantic keys, and its
declared sources are the same host-owned custom sources.
