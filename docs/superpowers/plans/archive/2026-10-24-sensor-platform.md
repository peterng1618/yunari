# Sensor platform implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen Yunari's sensor product to full hardware coverage, consumer units, weather, Now Playing, FPS, game presence with store metadata, configurable polling, and user-defined HTTP sources — without changing canonical sample values or the v2 theme schema.

**Architecture:** The existing owner layers stay: `renderer-core` owns the vocabulary, descriptors, unit conversion and plan formatting; `packages/host/src/providers/` owns acquisition and the provider registry; `packages/host/src/settings/` owns consumer settings; the player hydrates text, charts and images from one sample source. New providers are adapters beneath the existing `SensorProvider` contract; helper processes are host children supervised by one policy.

**Tech Stack:** TypeScript, Node 22.12+, Vitest, Playwright, Fabric 7.4.0, Windows PowerShell 5.1 bridges, Open-Meteo / WeatherAPI / OpenWeatherMap.

**Spec:** [`docs/superpowers/specs/2026-10-24-sensor-platform-design.md`](../specs/2026-10-24-sensor-platform-design.md) — executor reads it alongside this plan.

## Global Constraints

- Canonical sample values do not change: clock `MHz`; rate `Mb/s`; capacity `GB` where 1 GB = 2^30 bytes; temperature `°C`; fan `RPM`, control `%`; power `W`; voltage `V`; current `A`; time `s`; wind `km/h`; pressure `hPa`; precipitation `mm`.
- Conversion happens once, at presentation, after the binding's `scale`/`offset`. Providers never convert for a display preference.
- `SUPPORTED_SCHEMA_VERSION` stays `2`. `Binding.unit` and `Binding.autoScale` are optional; older themes open unchanged.
- No new npm runtime dependency. PresentMon is a vendored MIT binary; PowerShell 5.1 ships with Windows; no .NET SDK is added.
- Image sample values are host-relative only: the string starts with `/`, has no scheme and no `//` authority. Anything else is refused and the authored asset remains.
- Weather polling: `pollIntervalMs` default `600000`, permitted `60000`–`86400000`, out-of-range refused, not clamped. Custom sources: `intervalMs` default `60000`, minimum `10000`. Media polls at `1000` ms while demanded and is not user-tunable. No remote provider is polled while none of its keys is demanded.
- Custom-source limits, enforced rather than clamped: 32 sources, 64 fields per source, 1 MiB response body, 4 concurrent in-flight fetches overall, 1 per source, redirects at most 3 and same scheme, GET only.
- Credentials stay host-side and write-only from the browser. A secret never enters a theme, sample, log line, display URL or error message. Reasons pass through `redactForBrowser`.
- A provider with no value returns no entry or a non-`ok` entry with a redacted reason; never zero.
- `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on. Refuse invalid numeric input rather than coercing it.
- Stage explicit paths; Conventional Commit titles. `npm run status:check` from `src/web/` after each `STATUS.md` edit.

## Review Focus

1. **A binding whose key no provider answers** (source deleted, provider absent, typo): the theme still loads, the run renders `—` with its reason, and no zero appears.
2. **A sample carrying an absolute URL** (`https://…`, `//host/…`, `data:`): the image never loads it, the authored asset stays, and the refusal is reported once.
3. **Two displays on one host with different unit preferences or theme languages:** the same sample value produces different text; neither display mutates the sample.
4. **A missing or rejected BYOK weather key:** the provider names the missing credential and never falls back to Open-Meteo or shows a fabricated reading.
5. **A helper that is missing or wedged** (PowerShell absent, SMTC broken, RTSS not running, PresentMon denied): that provider reports `unavailable` with a redacted reason, its timers stop, and every other provider keeps rendering.
6. **A store that is slow, down or rate-limited:** the local name still shows, a cached cover still renders, the reason is reported, and no poll retries in a loop.
7. **A game whose name matches several store entries, or a sequel** (`Doom` vs `Doom Eternal`): it stays unnamed rather than borrowing another game's name and cover.

---

## Phase 1 — Vocabulary, units, discovery, image binding

Each task is independently shippable; no new provider is added.

### Task 1.1: Open family set, descriptors, dynamic keys

**Files:**
- Modify: `packages/renderer-core/src/data/semantic-keys.ts`
- Modify: `packages/renderer-core/src/index.ts`
- Test: `packages/renderer-core/src/data/semantic-keys.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type SemanticFamily = string;
  export const BUILT_IN_FAMILIES: readonly string[];
  export type UnitKind = "percent" | "temperature" | "clock" | "data" | "dataRate"
    | "power" | "voltage" | "current" | "rotation" | "duration" | "speed"
    | "pressure" | "count" | "text" | "boolean";
  export type ValueKind = "number" | "text" | "boolean";
  export function semanticId(name: string): string;
  export function describeDynamicKey(key: string): SemanticKeyDescriptor | undefined;
  export function groupDescriptorsByFamily(
    descriptors: readonly SemanticKeyDescriptor[],
  ): ReadonlyMap<string, readonly SemanticKeyDescriptor[]>;
  ```
  `SemanticKeyDescriptor` gains `unitKind?`, `displayUnits?`, `valueKind?`, `mediaKind?: "image"`. `family` becomes `string`. `semanticId` replaces `diskDeviceId`; update every caller.

- [ ] **Step 1: Write the failing tests**
  - `describeSemanticKey("cpu.temp.package")` returns family `cpu`, unit `°C`, `unitKind: "temperature"`, `converts: "temperature"`.
  - `describeDynamicKey("cpu.core.3.temp")` returns key unchanged, family `cpu`, label containing `3`, unit `°C`.
  - `describeDynamicKey("custom.my-source.cpu_load")` returns family `custom`, `valueKind: "number"`.
  - `describeDynamicKey("weather.icon")?.mediaKind === "image"`; `describeDynamicKey("media.title")?.valueKind === "text"`.
  - `semanticId("Fan #3 / Pump")` equals `fan-3-pump`; two calls give the same result; input longer than 64 characters is truncated to 64.
  - `groupDescriptorsByFamily` keeps descriptor order and accepts an unknown family.
  - The existing 31 keys keep their current `unit`, `converts` and `instant` values.
- [ ] **Step 2: Run the tests and confirm they fail**

  Run: `npx vitest run packages/renderer-core/src/data/semantic-keys.test.ts`
  Expected: FAIL on the missing descriptor fields and functions.

- [ ] **Step 3: Implement the vocabulary**
  Add every static key from the spec's Model table, in family order after `date`. Set `unitKind` on every numeric key. Add `displayUnits` only where the spec names more than one unit. Add one dynamic-shape table covering: per-core cpu, cooling fans/pumps, motherboard fans/voltages, GPU fans, per-device disk, per-interface network, PSU voltage, and `custom.<source>.<field>`. Dynamic ids are slugged with `semanticId`; per-core numbers are 1-based. Re-export the new names from `index.ts`.
- [ ] **Step 4: Run the tests and the package typecheck**

  Run: `npx vitest run packages/renderer-core/src/data/semantic-keys.test.ts`
  Run: `npm run typecheck -w @yunari/renderer-core`
  Expected: PASS and exit 0.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/renderer-core/src/data/semantic-keys.ts packages/renderer-core/src/data/semantic-keys.test.ts packages/renderer-core/src/index.ts
  git commit -m "feat(renderer-core): open the sensor vocabulary and add dynamic keys"
  ```

### Task 1.2: Unit conversion and auto-scale

**Files:**
- Modify: `packages/renderer-core/src/scene/measurement.ts`
- Modify: `packages/renderer-core/src/scene/plan.ts`
- Test: `packages/renderer-core/src/scene/measurement.test.ts`
- Test: `packages/renderer-core/src/scene/plan.test.ts`

**Interfaces:**
- Consumes: `SemanticKeyDescriptor.unitKind`, `displayUnits` from Task 1.1.
- Produces:
  ```ts
  export interface UnitPreferences {
    readonly measurement?: MeasurementSystem;
    readonly clock?: "mhz" | "ghz" | "auto";
    readonly data?: "binary" | "decimal";
    readonly dataScale?: "auto" | "mb" | "gb" | "tb";
    readonly rate?: "bits" | "bytes";
    readonly rateScale?: "auto" | "k" | "m" | "g";
    readonly windSpeed?: "kmh" | "mph" | "ms";
    readonly pressure?: "hpa" | "inhg";
  }
  export const DEFAULT_UNIT_PREFERENCES: Required<UnitPreferences>;
  export function normalizeUnitPreferences(input: unknown): UnitPreferences;
  export function convertForDisplay(
    semanticKey: string,
    value: number,
    unit: string | undefined,
    preferences: UnitPreferences,
    overrides?: { readonly unit?: string; readonly autoScale?: boolean },
  ): ConvertedValue & { readonly unsupportedUnit?: true };
  ```
  `ConvertedValue` unchanged. An override the key cannot display returns the measured value and `unsupportedUnit: true`.

- [ ] **Step 1: Write the failing conversion tests**
  - `3800 MHz` with `clock: "ghz"` → `{ value: 3.8, unit: "GHz" }`; with `clock: "mhz"` unchanged.
  - `clock: "auto"`: `800` stays `MHz`; `3800` → `GHz`; `12000` → `GHz` with the value unchanged and two decimals available to the formatter.
  - `ram.used` `16` GB with `data: "decimal"` → `17.18` GB (16 × 2^30 / 10^9), not a relabelled binary number.
  - `dataScale: "mb"` shows MB and multiplies by 1024; `"tb"` divides.
  - `network.download` `500` Mb/s with `rate: "bytes"` → `62.5` `MB/s`; `rateScale: "auto"` gives `kB/s` below 1 MB/s and `GB/s` above 1000.
  - `cpu.temp` `100` °C with `measurement: "imperial"` → `212 °F`.
  - `pressure: "inhg"` converts `1013.25 hPa` → `29.92 inHg`; `windSpeed: "mph"` converts `100 km/h` → `62.14 mph`.
  - An override `{ unit: "GHz" }` on `cpu.load` returns `unsupportedUnit: true` and the measured value.
  - Existing temperature conversion and metric passthrough still pass unchanged.
- [ ] **Step 2: Run the tests and confirm they fail**

  Run: `npx vitest run packages/renderer-core/src/scene/measurement.test.ts`
  Expected: FAIL on the new signature.

- [ ] **Step 3: Implement conversion, then update `plan.ts`**
  Keep `measurement` as the temperature owner. Apply conversion after `scale`/`offset`; precision runs after conversion. `formatValueSegment` takes `units: UnitPreferences` through the plan context and reports `unsupportedUnit` as a `PlanIssue` whose detail names the key. Do not change `applyTransform` or chart thresholds.
- [ ] **Step 4: Run the tests**

  Run: `npx vitest run packages/renderer-core/src/scene/measurement.test.ts packages/renderer-core/src/scene/plan.test.ts`
  Expected: PASS, including the existing cases.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/renderer-core/src/scene/measurement.ts packages/renderer-core/src/scene/plan.ts packages/renderer-core/src/scene/measurement.test.ts packages/renderer-core/src/scene/plan.test.ts
  git commit -m "feat(renderer-core): convert and auto-scale display units"
  ```

### Task 1.3: Host unit preferences, binding overrides, player wiring

**Files:**
- Modify: `packages/host/src/settings/display.ts`
- Modify: `packages/host/src/settings/display.test.ts`
- Modify: `packages/renderer-core/src/theme/document.ts`
- Modify: `packages/renderer-core/src/theme/envelope-keys.ts`
- Modify: `packages/renderer-core/src/theme/fabric-envelope-validate.ts`
- Modify: `schema/theme-document.schema.json`
- Modify: `packages/player/src/theme-loader.ts`
- Modify: `packages/player/src/main.ts`
- Modify: `packages/editor/src/host-settings-mode/region.tsx` (unit rows)
- Test: `packages/player/src/theme-loader.test.ts`
- Test: `packages/player/src/main.dom.test.ts`
- Test: `packages/editor/src/host-settings-mode/region.dom.test.tsx`

**Interfaces:**
- Consumes: `UnitPreferences`, `normalizeUnitPreferences` from Task 1.2.
- Produces: `DisplaySettings.units?: UnitPreferences`; `Binding.unit?: string`; `Binding.autoScale?: boolean`; `loadDisplayPreferences(fetcher): Promise<UnitPreferences>`.

- [ ] **Step 1: Write the failing tests**
  - `normalizeDisplaySettings({ units: { clock: "ghz", data: "decimal" } })` keeps both; `{ units: { clock: "thz" } }` throws naming `clock`.
  - A stored file without `units` reads as `{}` and the player uses `DEFAULT_UNIT_PREFERENCES`.
  - The envelope validator accepts a binding with `unit: "GHz"` and `autoScale: true`, and rejects `autoScale: "yes"` and an unknown binding key.
  - `schema/theme-document.schema.json` accepts both fields (the disagreement test stays green).
  - Player: a theme bound to `cpu.clock` with host preference `ghz` renders `3.8 GHz`; the sample value stays `3800`.
  - The settings page renders one row per unit preference and writes only the changed field; an unknown value shows the store's refusal.
- [ ] **Step 2: Run the tests and confirm they fail**

  Run: `npx vitest run packages/host/src/settings/display.test.ts packages/player/src/theme-loader.test.ts`
  Expected: FAIL on unknown `units`.

- [ ] **Step 3: Implement the settings and binding fields**
  Add `units` to `DisplaySettings`, normalized through `normalizeUnitPreferences` and refused value-by-value. Add the two optional `Binding` fields to the type, the known-key table, the validator and the published schema together (decision 0023: the validator and `schema/` change in the same commit). `loadDisplayPreferences` returns the full preferences, defaulting on any failure. Pass them through `refreshBoundText` and `buildChartPlan` as `units`. Add the unit rows to the existing host settings region; it writes through `PUT /api/display`, which already owns the store.
- [ ] **Step 4: Run the tests**

  Run: `npx vitest run packages/host/src/settings/display.test.ts packages/player/src/theme-loader.test.ts packages/player/src/main.dom.test.ts packages/renderer-core/src/theme/fabric-envelope-schema-sync.test.ts packages/editor/src/host-settings-mode/region.dom.test.tsx`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/host/src/settings/display.ts packages/host/src/settings/display.test.ts packages/renderer-core/src/theme/document.ts packages/renderer-core/src/theme/envelope-keys.ts packages/renderer-core/src/theme/fabric-envelope-validate.ts schema/theme-document.schema.json packages/player/src/theme-loader.ts packages/player/src/main.ts packages/editor/src/host-settings-mode/region.tsx packages/player/src/theme-loader.test.ts packages/player/src/main.dom.test.ts packages/editor/src/host-settings-mode/region.dom.test.tsx
  git commit -m "feat(settings): store unit preferences and binding overrides"
  ```

### Task 1.4: Descriptor wire and editor catalogue

**Files:**
- Modify: `packages/host/src/providers/provider.ts`
- Modify: `packages/host/src/providers/registry.ts`
- Modify: `packages/host/src/providers/clock.ts`, `library.ts`, `lhm.ts` (descriptor fields)
- Create: `packages/editor/src/sensor-catalogue.ts`
- Modify: `packages/editor/src/chart-manager/panel.ts`
- Modify: `packages/editor/src/chart-manager/chart-fields.tsx`
- Modify: `packages/editor/src/selection-inspector/runs.tsx`
- Test: `packages/host/src/providers/registry.test.ts`
- Test: `packages/editor/src/sensor-catalogue.test.ts`
- Test: `packages/editor/src/chart-manager/panel.dom.test.ts`
- Test: `packages/editor/src/selection-inspector/runs.dom.test.ts`

**Interfaces:**
- Consumes: Task 1.1 descriptors.
- Produces:
  ```ts
  // host/src/providers/provider.ts
  export interface SensorDescriptor {
    readonly sensorId: string;
    readonly semanticKey: string;
    readonly label: string;
    readonly unit?: string;
    readonly tier: SensorTier;
    readonly family?: string;
    readonly unitKind?: UnitKind;
    readonly displayUnits?: readonly string[];
    readonly valueKind?: ValueKind;
    readonly mediaKind?: "image";
  }
  // editor/src/sensor-catalogue.ts
  export interface SensorCatalogue {
    descriptors(): readonly SemanticKeyDescriptor[];
    refresh(): Promise<void>;
  }
  export function createSensorCatalogue(fetcher?: typeof fetch): SensorCatalogue;
  ```
- A disconnected editor or a failed `/api/sensors` keeps `SEMANTIC_KEYS`.

- [ ] **Step 1: Write the failing tests**
  - `/api/sensors` mapping keeps `family`, `unitKind`, `valueKind` and `mediaKind` from a provider descriptor.
  - `createSensorCatalogue` with a fetcher returning one custom descriptor replaces the built-ins with built-ins + that key; with a rejecting fetcher it returns `SEMANTIC_KEYS` and does not throw.
  - The chart picker lists a custom descriptor's key and label; a saved binding whose key is absent from the catalogue still appears in its options.
  - The text-run picker groups built-ins by family and lists a custom descriptor under its family.
- [ ] **Step 2: Run the tests and confirm they fail**

  Run: `npx vitest run packages/editor/src/sensor-catalogue.test.ts packages/host/src/providers/registry.test.ts`
  Expected: FAIL on the missing module.

- [ ] **Step 3: Implement the wire and the catalogue**
  Extend `SensorDescriptor`; populate `family`/`valueKind`/`unitKind` in each shipped provider from `describeSemanticKey`. The registry only forwards fields. Build the editor catalogue as a module-level `createSensorCatalogue()` used by `editor-session`; pass `catalogue.descriptors()` into `chart-manager/panel.ts` and `selection-inspector/runs.tsx` instead of importing `SEMANTIC_KEYS` inside them (keep `SEMANTIC_KEYS` as the default argument so existing tests still construct these units).
- [ ] **Step 4: Run the tests**

  Run: `npx vitest run packages/editor/src/sensor-catalogue.test.ts packages/host/src/providers/registry.test.ts packages/editor/src/chart-manager/panel.dom.test.ts packages/editor/src/selection-inspector/runs.dom.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/host/src/providers/provider.ts packages/host/src/providers/registry.ts packages/host/src/providers/clock.ts packages/host/src/providers/library.ts packages/host/src/providers/lhm.ts packages/editor/src/sensor-catalogue.ts packages/editor/src/chart-manager/panel.ts packages/editor/src/chart-manager/chart-fields.tsx packages/editor/src/selection-inspector/runs.tsx packages/host/src/providers/registry.test.ts packages/editor/src/sensor-catalogue.test.ts packages/editor/src/chart-manager/panel.dom.test.ts packages/editor/src/selection-inspector/runs.dom.test.ts
  git commit -m "feat(editor): list provider descriptors beside built-in sensors"
  ```

### Task 1.5: Image binding foundation

**Files:**
- Create: `packages/scene-fabric/src/bound-image.ts`
- Modify: `packages/scene-fabric/src/index.ts`
- Modify: `packages/player/src/main.ts`
- Modify: `packages/editor/src/selection-inspector/per-kind-column.ts`
- Create: `tests/e2e/image-binding.spec.ts`
- Test: `packages/scene-fabric/src/bound-image.test.ts`
- Test: `packages/player/src/main.dom.test.ts`
- Test: `packages/editor/src/selection-inspector/column.dom.test.tsx`

**Interfaces:**
- Consumes: `Binding[]` map keyed by object id; Task 1.1 `mediaKind`.
- Produces:
  ```ts
  // scene-fabric/src/bound-image.ts
  export interface ImageBindingHooks {
    readonly resolve: (hostRelativeUrl: string) => string | undefined;
    readonly onRefused?: (nodeId: string, reason: string) => void;
    readonly onLoadError?: (nodeId: string) => void;
  }
  export function refreshBoundImages(
    objects: readonly FabricObject[],
    bindings: Readonly<Record<string, readonly Binding[]>>,
    source: Pick<SampleSource, "latest">,
    hooks: ImageBindingHooks,
  ): void;
  export function isHostRelativeImageUrl(value: string): boolean;
  ```

- [ ] **Step 1: Write the failing tests**
  - `isHostRelativeImageUrl("/api/media/artwork/a.png")` true; `"https://x/a.png"`, `"//x/a.png"`, `"data:image/png;base64,AA"`, `"a.png"` false.
  - A bound `FabricImage` whose sample is `ok` with a host-relative `textValue` receives the resolved URL and the authored asset is not used.
  - A sample with an absolute URL leaves the authored `src` in place and calls `onRefused` once.
  - A sample that becomes `unavailable` restores the authored `src`; the previous artwork does not remain.
  - A missing sample leaves the authored asset.
  - An image with no image-capable binding is untouched.
- [ ] **Step 2: Run the tests and confirm they fail**

  Run: `npx vitest run packages/scene-fabric/src/bound-image.test.ts`
  Expected: FAIL, module not found.

- [ ] **Step 3: Implement hydration and the inspector field**
  Store the authored `src` on first visit (Fabric's `getSrc()`); apply only when `sample.status === "ok"` and the value passes `isHostRelativeImageUrl`; resolve through the session token. Call it from the player's `refresh` beside `hydrateCharts`. Add one sensor field to the image column: options are catalogue descriptors with `mediaKind === "image"`, value is the object's first binding key; choosing writes `[{ id: "image", semanticKey }]`, clearing removes the binding. Do not change the persisted node shape or `SUPPORTED_SCHEMA_VERSION`.
- [ ] **Step 4: Write and run the browser proof**
  A fixture theme binds an image to a fake image-capable key. Assert the host image renders; then the fake source emits an absolute URL and assert the `img` element's `src` is still the authored asset and never contains the absolute URL.

  Run: `npx playwright test tests/e2e/image-binding.spec.ts`
  Expected: PASS.

- [ ] **Step 5: Run the unit tests**

  Run: `npx vitest run packages/scene-fabric/src/bound-image.test.ts packages/player/src/main.dom.test.ts packages/editor/src/selection-inspector/column.dom.test.tsx`
  Expected: PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/scene-fabric/src/bound-image.ts packages/scene-fabric/src/index.ts packages/player/src/main.ts packages/editor/src/selection-inspector/per-kind-column.ts tests/e2e/image-binding.spec.ts packages/scene-fabric/src/bound-image.test.ts packages/player/src/main.dom.test.ts packages/editor/src/selection-inspector/column.dom.test.tsx
  git commit -m "feat(player): hydrate images from image sensors"
  ```

---

## Phase 2 — Hardware coverage

Fixtures come from real LHM captures in `packages/host/src/providers/__fixtures__/`; a sensor name absent from every fixture is not mapped. Aggregate keys keep their current values.

### Task 2.1: CPU and GPU detail

**Files:**
- Modify: `packages/host/src/providers/lhm-mapping.ts`
- Modify: `packages/host/src/providers/lhm.ts`
- Modify: `packages/host/src/providers/lhm-mapping.test.ts` (create if absent)
- Test: `packages/host/src/providers/lhm.test.ts`

**Interfaces:**
- Consumes: Task 1.1 dynamic key helpers.
- Produces: keys `cpu.core.<n>.load/temp/clock`, `cpu.temp.package`, `cpu.temp.core.max`, `cpu.temp.core.avg`, `cpu.voltage`, `gpu.temp.core`, `gpu.temp.hotspot`, `gpu.voltage`, `gpu.clock.memory`, `vram.temp`, `gpu.fan.<n>`.

- [ ] **Step 1: Add fixture cases and failing tests**
  - A capture with `Core #1..#N` produces one key per core, 1-based, each mapped by sensor type.
  - `CPU Package`, `Core Max`, `Core Average` produce the three package keys; `cpu.temp` still equals the package figure.
  - GPU `Hot Spot` and `Memory Junction` produce `gpu.temp.hotspot` and `vram.temp`; `gpu.temp` still equals the core temperature.
  - Two GPU fans produce `gpu.fan.1` and `gpu.fan.2`; `gpu.fan` still names the first/hottest.
  - `gpu.clock.memory` comes from the clock sensor named Memory; `cpu.voltage`/`gpu.voltage` from Voltage.
  - Removing a sensor from the fixture removes its key; no key is invented.
- [ ] **Step 2: Run the tests and confirm they fail**

  Run: `npx vitest run packages/host/src/providers/lhm.test.ts`
  Expected: FAIL on missing keys.

- [ ] **Step 3: Implement the mappings**
  Extend the bindings table with explicit names plus sensor type and hardware group. Use `semanticId` for qualifiers. Keep the existing aggregate bindings first so precedence does not change.
- [ ] **Step 4: Run the tests**

  Run: `npx vitest run packages/host/src/providers/lhm.test.ts packages/host/src/providers/lhm-real.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/host/src/providers/lhm-mapping.ts packages/host/src/providers/lhm.ts packages/host/src/providers/lhm.test.ts packages/host/src/providers/lhm-mapping.test.ts
  git commit -m "feat(host): map per-core and GPU role readings"
  ```

### Task 2.2: Motherboard, cooling, PSU and battery

**Files:**
- Modify: `packages/host/src/providers/lhm-mapping.ts`
- Modify: `packages/host/src/providers/lhm.ts`
- Test: `packages/host/src/providers/lhm.test.ts`

**Interfaces:**
- Consumes: Task 1.1 keys.
- Produces: `motherboard.temp/fan.<id>.rpm/.percent/voltage.<id>`, `chipset.temp`, `vrm.temp`, `cooling.temp`, `cooling.fan.<id>.rpm/.percent`, `cooling.pump.<id>.rpm`, `psu.power/temp/fan/voltage.<id>`, `battery.level/voltage/rate/timeRemaining/ac`.

- [ ] **Step 1: Write the failing fixture tests**
  - `SuperIO`/`Motherboard` `Fan` sensors each get their own key; the sensor's own label is the descriptor label, not a friendly rename.
  - `Control` sensors produce `.percent`; a fan with no control produces no percent key.
  - Named Chipset/VRM temperatures map; an unnamed motherboard temperature maps to `motherboard.temp`.
  - `Cooler` temperature maps to `cooling.temp`; a pump-named fan maps to `cooling.pump.<id>.rpm`.
  - `Psu` Power/Temperature/Fan/Voltage map; voltages get per-sensor ids.
  - `Battery` Level/Voltage/Power/TimeSpan map; `battery.charging` is derived only from a reported state.
- [ ] **Step 2: Run the tests and confirm they fail**

  Run: `npx vitest run packages/host/src/providers/lhm.test.ts`
  Expected: FAIL on missing keys.

- [ ] **Step 3: Implement the mappings**
  Add hardware-group patterns and bindings; reuse `semanticId`. Do not collapse fans into one maximum for the new keys.
- [ ] **Step 4: Run the tests**

  Run: `npx vitest run packages/host/src/providers/lhm.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/host/src/providers/lhm-mapping.ts packages/host/src/providers/lhm.ts packages/host/src/providers/lhm.test.ts
  git commit -m "feat(host): map motherboard, cooler, PSU and battery sensors"
  ```

### Task 2.3: Per-drive and per-interface readings

**Files:**
- Modify: `packages/host/src/providers/lhm-mapping.ts`
- Modify: `packages/host/src/providers/lhm-tree.ts` (only if the node identity is not exposed)
- Modify: `packages/renderer-core/src/data/semantic-keys.ts` (disk dynamic quantities)
- Test: `packages/host/src/providers/lhm.test.ts`
- Test: `packages/renderer-core/src/data/semantic-keys.test.ts`

**Interfaces:**
- Consumes: existing `diskDeviceId` callers renamed to `semanticId`.
- Produces: `disk.<id>.free/temp/health/read/write/activity`, `network.<id>.download/upload`.

- [ ] **Step 1: Write the failing tests**
  - Two storage devices produce two distinct id sets; the same model twice gets a numeric suffix.
  - `disk.<id>.health` reads LHM `Level`; `read`/`write` read Throughput; `activity` reads Load.
  - `disk.<id>.free` is derived as total minus used only when both are reported.
  - Two NICs produce two `network.<id>.*` pairs; the aggregate `network.download/upload` keeps its current value.
  - `describeDynamicKey("disk.nvme0.free")` returns `GB` and the correct label.
- [ ] **Step 2: Run the tests and confirm they fail**

  Run: `npx vitest run packages/host/src/providers/lhm.test.ts packages/renderer-core/src/data/semantic-keys.test.ts`
  Expected: FAIL on missing keys.

- [ ] **Step 3: Implement the mappings**
  Extend the disk pattern quantities and the LHM bindings. Device id is the provider's stable hardware identity, never array position.
- [ ] **Step 4: Run the tests**

  Run: `npx vitest run packages/host/src/providers/lhm.test.ts packages/renderer-core/src/data/semantic-keys.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/host/src/providers/lhm-mapping.ts packages/host/src/providers/lhm-tree.ts packages/host/src/providers/lhm.test.ts packages/renderer-core/src/data/semantic-keys.ts packages/renderer-core/src/data/semantic-keys.test.ts
  git commit -m "feat(host): map per-drive and per-interface readings"
  ```

### Task 2.4: systeminformation fill

**Files:**
- Modify: `packages/host/src/providers/library.ts`
- Modify: `packages/host/src/providers/library-devices.ts`
- Test: `packages/host/src/providers/library.test.ts` (create if absent)
- Test: `packages/host/src/providers/library-devices.test.ts`

**Interfaces:**
- Consumes: Task 1.1 keys.
- Produces: `wifi.ssid`, `wifi.signal`, `wifi.linkSpeed`, `system.uptime`, `system.processes`, `system.hostname`, `system.os`, `system.osBuild`, `battery.state`, `battery.charging`, `battery.timeRemaining`, `battery.ac`, `battery.health`, `battery.level`, `battery.voltage`. `audio.volume`/`audio.muted` moved to Task 4.2: `si.audio()` lists devices and has no mixer reading, so they need Windows CoreAudio beside the SMTC helper.

- [ ] **Step 1: Write the failing tests**
  - Wi-Fi keys are omitted when the adapter reports none; no zero SSID.
  - `system.uptime` and `battery.timeRemaining` are seconds; `system.processes` is an integer.
  - `audio.muted` is boolean; `audio.volume` is `%`.
  - Battery values come only from a reported battery; a desktop reports no battery keys.
  - Existing library keys keep their values.
- [ ] **Step 2: Run the tests and confirm they fail**

  Run: `npx vitest run packages/host/src/providers/library-devices.test.ts`
  Expected: FAIL on missing keys.

- [ ] **Step 3: Implement the library mappings**
  Add the calls to `systeminformation` in the existing provider; map only reported values. LHM stays first by provider order.
- [ ] **Step 4: Run the tests**

  Run: `npx vitest run packages/host/src/providers/library-devices.test.ts packages/host/src/providers/library.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/host/src/providers/library.ts packages/host/src/providers/library-devices.ts packages/host/src/providers/library-devices.test.ts packages/host/src/providers/library.test.ts
  git commit -m "feat(host): fill Wi-Fi, system, audio and battery from systeminformation"
  ```

---

## Phase 3 — Weather

Weather runs before custom sources so the HTTP failure, cache and image paths are exercised under a built-in provider first.

### Task 3.1: Weather settings and manual place

**Files:**
- Create: `packages/host/src/settings/weather.ts`
- Create: `packages/host/src/settings/weather.test.ts`
- Modify: `packages/host/src/server.ts` (`/api/weather/settings`)
- Modify: `packages/host/src/main.ts` (construct the store)
- Modify: `packages/editor/src/host-settings-mode/region.tsx` (weather section)
- Test: `packages/host/src/server.test.ts` (weather settings routes)
- Test: `packages/editor/src/host-settings-mode/region.dom.test.tsx`

**Interfaces:**
- Consumes: atomic write pattern from `settings/displays.ts`.
- Produces:
  ```ts
  export type WeatherProviderId = "open-meteo" | "weatherapi" | "openweathermap";
  export interface WeatherSettings {
    readonly provider: WeatherProviderId;
    readonly label: string;
    readonly latitude: number;
    readonly longitude: number;
    readonly useWindowsLocation: boolean;
    readonly pollIntervalMs: number;
  }
  export const DEFAULT_WEATHER_SETTINGS: WeatherSettings;
  export function normalizeWeatherSettings(input: unknown): WeatherSettings;
  export interface WeatherSettingsStore { read(): Promise<WeatherSettings>; write(input: unknown): Promise<WeatherSettings>; }
  ```
  `weather.json`; `provider` defaults to `open-meteo`; label non-empty; lat −90..90; lon −180..180; interval 60000–86400000.

- [ ] **Step 1: Write the failing tests**
  - Defaults when the file is absent.
  - A latitude of `91`, an empty label, an unknown provider and an interval of `59999` each throw a message naming the field.
  - `GET /api/weather/settings` is loopback-only; `PUT` stores and returns the normalized settings.
  - A geocoding search (`GET /api/weather/places?q=…`) returns `{ label, latitude, longitude }[]` from an injected fetcher.
- [ ] **Step 2: Run the tests and confirm they fail**

  Run: `npx vitest run packages/host/src/settings/weather.test.ts`
  Expected: FAIL, module not found.

- [ ] **Step 3: Implement the store and routes**
  Atomic temp-file + rename, validated on read and write, invalid entry becomes defaults with a reason in `/api/health` rather than a crash. Geocoding uses Open-Meteo's endpoint with a bounded body and the same redaction. Add the weather form to the existing host settings region.
- [ ] **Step 4: Run the tests**

  Run: `npx vitest run packages/host/src/settings/weather.test.ts packages/host/src/server.test.ts packages/editor/src/host-settings-mode/region.dom.test.tsx`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/host/src/settings/weather.ts packages/host/src/settings/weather.test.ts packages/host/src/server.ts packages/host/src/main.ts packages/editor/src/host-settings-mode/region.tsx packages/host/src/server.test.ts packages/editor/src/host-settings-mode/region.dom.test.tsx
  git commit -m "feat(host): store weather place, backend and polling interval"
  ```

### Task 3.2: Open-Meteo provider, WMO table, icons

**Files:**
- Create: `packages/host/src/providers/weather/provider.ts`
- Create: `packages/host/src/providers/weather/open-meteo.ts`
- Create: `packages/host/src/providers/weather/conditions.ts`
- Create: `packages/host/src/providers/weather/open-meteo.test.ts`
- Create: `packages/host/src/providers/weather/conditions.test.ts`
- Create: `packages/host/vendor/weather-icons/` (verified licence)
- Add: `packages/host/scripts/vendor-weather-icons.mjs`
- Modify: `packages/host/src/server.ts` (`/api/weather/icon/<slug>.svg`)
- Modify: `packages/host/src/main.ts` (register provider)
- Modify: `THIRD-PARTY-NOTICES.md`, `docs/engineering/dependencies.md`

**Interfaces:**
- Consumes: `WeatherSettingsStore` (Task 3.1), `SensorProvider`.
- Produces:
  ```ts
  export interface WeatherReading {
    readonly tempC: number; readonly feelsLikeC: number;
    readonly highC: number; readonly lowC: number;
    readonly humidity: number; readonly pressureHpa: number;
    readonly precipitationMm: number; readonly windKph: number;
    readonly windDeg: number; readonly code: number;
    readonly isDay: boolean; readonly sunriseIso: string; readonly sunsetIso: string;
  }
  export class WeatherProvider implements SensorProvider { readonly id = "weather"; }
  export const WMO_CONDITIONS: Readonly<Record<number, string>>;
  export function conditionText(code: number, language: string | undefined): string;
  export function windCompass(degrees: number): string;
  ```
  Keys: the eighteen `weather.*` keys in the spec.

- [ ] **Step 1: Verify the icon licence and record it before adding bytes**
  Record the source, licence and attribution in both notice files; the task stops if the licence is not open.
- [ ] **Step 2: Write the failing tests**
  - An Open-Meteo fixture produces every `weather.*` reading with `°C`, `%`, `hPa`, `mm`, `km/h` and ISO sun times.
  - `conditionText(0)` is `Clear sky` in English; an unknown language falls back to English, never the number.
  - `windCompass(0)` `N`, `windCompass(90)` `E`, `windCompass(348.75)` `N`.
  - `weather.icon` is `/api/weather/icon/<slug>.svg`, where the slug is the vendored file the WMO table selects for that code and day/night state; an unmapped code yields `unavailable`.
  - `weather.attribution` is the selected backend's required attribution text; `weather.location` is the stored place label.
  - A non-2xx response, a body over 1 MiB, and an invalid JSON body each produce `error` with a redacted reason.
  - The poller does not fetch while no `weather.*` key is demanded; after demand it fetches on the configured interval.
  - The last good reading becomes `stale` after three missed intervals or 30 minutes, whichever is longer.
- [ ] **Step 3: Run the tests and confirm they fail**

  Run: `npx vitest run packages/host/src/providers/weather`
  Expected: FAIL, module not found.

- [ ] **Step 4: Implement the provider and route**
  Cached acquisition: `sample()` returns the cache and marks demand; one timer per provider; stop after the grace period with no demand; back off on failure. The icon route reads only a filename from the vendored set and refuses anything else. It is reachable by a paired display through the same session token as theme asset bytes; a request without a valid display session is refused.
- [ ] **Step 5: Run the tests**

  Run: `npx vitest run packages/host/src/providers/weather`
  Expected: PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/host/src/providers/weather packages/host/src/server.ts packages/host/src/main.ts packages/host/scripts/vendor-weather-icons.mjs packages/host/vendor/weather-icons THIRD-PARTY-NOTICES.md docs/engineering/dependencies.md
  git commit -m "feat(host): add the Open-Meteo weather provider and icon route"
  ```

### Task 3.3: Sample language context and localized conditions

**Files:**
- Modify: `packages/host/src/providers/provider.ts`
- Modify: `packages/host/src/providers/registry.ts`
- Modify: `packages/host/src/server.ts` (tick)
- Modify: every `SensorProvider.sample` implementation (clock, library, lhm, weather)
- Modify: `packages/host/src/providers/weather/conditions.ts`
- Modify: `packages/player/src/main.ts`, `packages/player/src/session.ts` (the language the player sends)
- Test: `packages/host/src/providers/registry.test.ts`
- Test: `packages/host/src/providers/weather/conditions.test.ts`
- Test: `packages/host/src/server.test.ts`
- Test: `packages/player/src/session.test.ts`, `packages/player/src/main.dom.test.ts`

**Interfaces:**
- Consumes: `WeatherProvider`.
- Produces:
  ```ts
  export interface SampleContext {
    readonly assignment?: DeviceAssignment;
    readonly language?: string;
  }
  sample(semanticKeys: readonly string[], nowMs: number, context?: SampleContext): Promise<readonly SampleEntry[]>;
  // registry
  export interface DisplayAsk { display: string; semanticKeys: readonly string[]; assignment: DeviceAssignment; language?: string; }
  ```
  `groupByAssignment` becomes `groupByAsk` and keys on assignment JSON + language.

- [ ] **Step 1: Write the failing tests**
  - Two asks with the same assignment and different languages produce two groups and two `sample` calls.
  - Two asks with the same assignment and same language produce one group.
  - `weather.condition` for language `de` returns the German table entry; an unlisted language returns English.
  - Two displays, same assignment, languages `de` and `en`, receive different `weather.condition` text while `weather.temp` is the same number in both payloads — localization changes text only.
  - The player sends its loaded theme's `metadata.themeLanguage` on the sample stream URL; the host records it on that connection and passes it into the display's ask. A player that sends none, or an unusable value, produces an ask with no language.
- [ ] **Step 2: Run the tests and confirm they fail**

  Run: `npx vitest run packages/host/src/providers/registry.test.ts`
  Expected: FAIL on the old signature/grouping.

- [ ] **Step 3: Implement the context**
  Replace the third positional assignment with `SampleContext` in every provider and caller; keep assignment behaviour identical. Add `language` to `DisplayAsk` and the group key. The language arrives from the player, which has already loaded the theme it is showing: `startHostedTheme` sends `lang` beside `keys`, and the host stores it on the `SseConnection`. The host does not read the theme record per tick — that would be a disk read of up to 32 MiB per display per second, and no change notification exists to cache it against.
- [ ] **Step 4: Run the tests**

  Run: `npx vitest run packages/host/src/providers/registry.test.ts packages/host/src/providers/weather/conditions.test.ts packages/host/src/server.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/host/src/providers packages/host/src/server.ts
  git commit -m "feat(host): sample per display language for localized weather"
  ```

### Task 3.4: WeatherAPI and OpenWeatherMap BYOK backends

**Files:**
- Create: `packages/host/src/providers/weather/weatherapi.ts`
- Create: `packages/host/src/providers/weather/openweathermap.ts`
- Create: `packages/host/src/providers/weather/backends.test.ts`
- Modify: `packages/host/src/settings/credentials-registry.ts`
- Modify: `packages/host/src/settings/credentials-registry.test.ts`
- Modify: `packages/host/src/providers/weather/provider.ts`
- Modify: `packages/host/src/main.ts` (credential entries)
- Modify: `packages/host/src/server.ts` (weather settings GET carries the backend's attribution text and terms URL)
- Modify: `packages/editor/src/host-settings-mode/client.ts`, `weather-section.tsx`, `ui-copy.ts` (show the credit the terms require)
- Test: `packages/editor/src/host-settings-mode/region.dom.test.tsx`
- No editor change for credentials: `CredentialRow` carries no `kind`, and the settings list renders whatever `KNOWN_CREDENTIALS` answers, so both rows appear without an editor edit.

**Interfaces:**
- Consumes: `CredentialStore`, `WeatherProvider`.
- Produces:
  ```ts
  export type CredentialKind = "bearer" | "cookie" | "query";
  export interface WeatherBackend {
    readonly id: WeatherProviderId;
    readonly attribution: string;
    fetch(location: { latitude: number; longitude: number }, fetchImpl: typeof fetch, key: string | undefined): Promise<WeatherReading>;
  }
  export const WEATHER_BACKENDS: Readonly<Record<WeatherProviderId, WeatherBackend>>;
  ```
  Credential ids `weatherapi` and `openweathermap`, both `kind: "query"`, each with help text/URL and a verify that spends one request.

- [ ] **Step 1: Write the failing tests**
  - Each backend fixture maps its own condition codes onto the canonical WMO set: at least clear, cloudy, rain, thunderstorm, snow, fog.
  - A missing key returns `error` whose reason names `weatherapi`/`openweathermap`; no request is made and no Open-Meteo fallback occurs.
  - A rejected key (401) returns `error` naming the credential, with no key in the message.
  - The request is metric; pressure, wind and precipitation are normalized to canonical units.
  - `GET /api/credentials` lists both rows with `set`, hint and help; `PUT` accepts them.
- [ ] **Step 2: Run the tests and confirm they fail**

  Run: `npx vitest run packages/host/src/providers/weather/backends.test.ts`
  Expected: FAIL, module not found.

- [ ] **Step 3: Implement the backends**
  Each builds its URL with the key in the query string, requests metric, maps codes and reads the key only inside the host. The provider selects `WEATHER_BACKENDS[settings.provider]` explicitly; there is no fallback branch.
- [ ] **Step 4: Run the tests**

  Run: `npx vitest run packages/host/src/providers/weather/backends.test.ts packages/host/src/settings/credentials-registry.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/host/src/providers/weather packages/host/src/settings/credentials-registry.ts packages/host/src/settings/credentials-registry.test.ts packages/host/src/main.ts
  git commit -m "feat(host): add WeatherAPI and OpenWeatherMap BYOK backends"
  ```

### Task 3.5: Helper supervision and Windows location fallback

**Files:**
- Create: `packages/host/src/providers/helpers/supervisor.ts`
- Create: `packages/host/src/providers/helpers/supervisor.test.ts`
- Create: `packages/host/src/providers/helpers/location.ts`
- Create: `packages/host/src/providers/helpers/location.test.ts`
- Modify: `packages/host/src/providers/weather/provider.ts`
- Test: `packages/host/src/providers/weather/provider.test.ts`

**Interfaces:**
- Consumes: weather settings (`useWindowsLocation`).
- Produces:
  ```ts
  export interface HelperHandle { readonly pid: number | undefined; stop(): void; }
  export interface HelperOptions {
    readonly id: string;
    readonly script: string;           // embedded PowerShell source
    readonly onLine: (line: string) => void;
    readonly onExit: (reason: string) => void;
    readonly nowMs: () => number;
  }
  export function startJsonLineHelper(options: HelperOptions): HelperHandle;
  export function powershellPath(): string | undefined;
  export function readLocation(helper: HelperHandle): void; // emits one line
  ```
  Explicit path `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`; UTF-16LE base64 `-EncodedCommand`; 1 MiB line cap; capped exponential backoff; process-tree kill on stop and timeout.

- [ ] **Step 1: Write the failing tests**
  - A missing PowerShell path reports `unavailable` with a redacted reason and spawns nothing.
  - A helper that exits non-zero is restarted with a longer delay each time, then reported `unavailable` after the cap.
  - A line over 1 MiB is dropped and reported, not buffered.
  - `stop()` kills the tree and clears timers; a stopped helper never restarts.
  - The location script's denial line becomes `error` with "Windows location was denied"; a timeout becomes `error` with a timeout reason; neither is silent.
  - With manual place set, the helper is never spawned.
- [ ] **Step 2: Run the tests and confirm they fail**

  Run: `npx vitest run packages/host/src/providers/helpers`
  Expected: FAIL, module not found.

- [ ] **Step 3: Implement the supervisor and location helper**
  One supervisor for media, location and frame. Embed the PowerShell script as a string; do not ship a loose `.ps1`. Demand-driven start/stop. Manual place wins; the fallback runs only when `useWindowsLocation` is on and no manual place exists.
- [ ] **Step 4: Run the tests**

  Run: `npx vitest run packages/host/src/providers/helpers packages/host/src/providers/weather`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/host/src/providers/helpers packages/host/src/providers/weather
  git commit -m "feat(host): supervise PowerShell helpers and add Windows location"
  ```

---

## Phase 4 — Media

### Task 4.1: SMTC helper

**Files:**
- Create: `packages/host/src/providers/media/smtc-helper.ts` (script string + parser)
- Create: `packages/host/src/providers/media/smtc-helper.test.ts`
- Test: `packages/host/src/providers/media/smtc-helper.windows.test.ts` (gated on Windows + PowerShell)

**Interfaces:**
- Consumes: Task 3.5 `startJsonLineHelper`.
- Produces:
  ```ts
  export interface SmtcSession {
    readonly title: string; readonly artist: string; readonly album: string;
    readonly state: "playing" | "paused" | "stopped";
    readonly positionS: number; readonly durationS: number;
    readonly app: string; readonly sessionId: string;
  }
  export const SMTC_SCRIPT: string;
  export function parseSmtcLine(line: string): SmtcSession | undefined;
  export function smtcArtworkLine(line: string): { sha256: string; bytes: Uint8Array; ext: string } | undefined;
  ```
  The script uses the reflected `DataReader(IInputStream)` constructor; the workaround is named in a comment and covered by the Windows test.

- [ ] **Step 1: Write the failing parser tests**
  - A metadata line with all fields parses; a `null` album becomes `""`.
  - A malformed line returns `undefined`, never throws.
  - State strings map to the three enum values; an unknown state is `stopped`.
  - An artwork line carries the SHA-256, extension and bytes.
- [ ] **Step 2: Write the Windows test that proves the real path**
  A test skipped unless `process.platform === "win32"` and PowerShell exists: start the helper, assert one JSON line is parseable, and if a session exists assert it has a title. Report as platform-tested, not fixture-tested.
- [ ] **Step 3: Run the tests and confirm they fail**

  Run: `npx vitest run packages/host/src/providers/media/smtc-helper.test.ts`
  Expected: FAIL, module not found.

- [ ] **Step 4: Implement the helper**
  Script emits one JSON line per second and artwork bytes only when asked. Parse defensively; stderr stays diagnostic and is redacted before it leaves the host.
- [ ] **Step 5: Run the tests**

  Run: `npx vitest run packages/host/src/providers/media`
  Expected: PASS (Windows test may report no active session).

- [ ] **Step 6: Commit**

  ```bash
  git add packages/host/src/providers/media
  git commit -m "feat(host): read Windows media sessions through a PowerShell helper"
  ```

### Task 4.2: Media provider and artwork cache

**Files:**
- Create: `packages/host/src/providers/media/provider.ts`
- Create: `packages/host/src/providers/media/artwork.ts`
- Create: `packages/host/src/providers/media/provider.test.ts`
- Modify: `packages/host/src/server.ts` (`/api/media/artwork/<sha>.<ext>`)
- Modify: `packages/host/src/main.ts` (register provider)
- Test: `packages/host/src/server.test.ts` (artwork route)

**Interfaces:**
- Consumes: `SmtcSession`, supervisor.
- Produces:
  ```ts
  export class MediaProvider implements SensorProvider { readonly id = "media"; }
  export interface ArtworkCache {
    put(bytes: Uint8Array, ext: string): Promise<string>; // "/api/media/artwork/<sha>.<ext>"
    read(name: string): Promise<{ bytes: Uint8Array; ext: string } | undefined>;
  }
  export function createArtworkCache(directory: string, cap = 64): ArtworkCache;
  ```
  Session choice: first playing, else current, else `unavailable`.
  Also produces `audio.volume` (`%`) and `audio.muted` (boolean) from the default endpoint's CoreAudio volume, read in the same PowerShell helper run as the SMTC poll; absent endpoint, absent keys.

- [ ] **Step 1: Write the failing tests**
  - Two sessions, one playing, selects the playing one.
  - No sessions returns `unavailable` with a reason; it never reports zero position.
  - Position and duration are seconds; state is one of the three strings.
  - Artwork is requested only when `media.artwork` is demanded and the track changed.
  - `media.artwork` is described with `mediaKind: "image"` and no unit; `media.title` with `valueKind: "text"`.
  - The same bytes put twice produce one file and the same URL; eviction removes the oldest beyond the cap.
  - The artwork route refuses a name that is not `<64 hex>.<png|jpg|jpeg|webp>` and serves an immutable cache header.
  - The helper stops after the demand grace period and restarts on the next demand.
- [ ] **Step 2: Run the tests and confirm they fail**

  Run: `npx vitest run packages/host/src/providers/media/provider.test.ts`
  Expected: FAIL, module not found.

- [ ] **Step 3: Implement the provider and cache**
  Cache under the host cache directory, content-hashed, never in a theme or settings file. Metadata is re-read only when session/track identity changes; artwork only on a track change while demanded. The artwork route is reachable by a paired display through the same session token as theme asset bytes; a request without a valid display session is refused.
- [ ] **Step 4: Run the tests**

  Run: `npx vitest run packages/host/src/providers/media packages/host/src/server.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/host/src/providers/media packages/host/src/server.ts packages/host/src/main.ts packages/host/src/server.test.ts
  git commit -m "feat(host): add the media provider and artwork cache"
  ```

### Task 4.3: Media keys end-to-end in a display

**Files:**
- Modify: `packages/player/src/main.ts` (image hydration already wired in Task 1.5; add media keys to the demand set)
- Create: `tests/e2e/media-artwork.spec.ts`
- Modify: `docs/evidence/screenshots/README.md` only if a capture is registered

**Interfaces:**
- Consumes: Tasks 1.5, 4.2.
- Produces: no new symbols; visible behaviour.

- [ ] **Step 1: Write the failing browser test**
  A fixture theme with text bindings `media.title/artist/album/state` and an image binding `media.artwork` is served with a fixture provider emitting a host-relative artwork URL. Assert: the text renders each value; the image's `src` is the resolved host URL; when the provider emits `unavailable`, the authored asset's `src` returns.
- [ ] **Step 2: Run it and confirm it fails**

  Run: `npx playwright test tests/e2e/media-artwork.spec.ts`
  Expected: FAIL before the wiring.

- [ ] **Step 3: Wire the demand and run against a real session**
  Confirm `boundSemanticKeys` includes image bindings (it already reads every binding). Manually start Chrome/YouTube and run the player with a media theme; record the observed values and the artwork URL in the commit body.
- [ ] **Step 4: Run the browser test**

  Run: `npx playwright test tests/e2e/media-artwork.spec.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/player/src/main.ts tests/e2e/media-artwork.spec.ts
  git commit -m "test(player): prove media text and artwork render end to end"
  ```

---

## Phase 5 — Custom sources

### Task 5.1: `sources.json` store and validation

**Files:**
- Create: `packages/host/src/settings/sources.ts`
- Create: `packages/host/src/settings/sources.test.ts`
- Modify: `packages/host/src/main.ts` (construct the store)

**Interfaces:**
- Consumes: atomic write pattern.
- Produces:
  ```ts
  export interface CustomField {
    readonly id: string; readonly label: string; readonly pointer: string;
    readonly type: "number" | "text" | "boolean";
    readonly family?: string; readonly unit?: string; readonly unitKind?: UnitKind;
    readonly scale?: number; readonly offset?: number; readonly expectedTier?: SensorTier;
  }
  export interface CustomSource {
    readonly id: string; readonly name: string; readonly url: string;
    readonly query?: Readonly<Record<string, string>>;
    readonly headers?: Readonly<Record<string, string>>;
    readonly intervalMs: number; readonly timeoutMs: number;
    readonly auth?: { readonly kind: "none" | "bearer" | "basic" | "header" | "query";
      readonly credentialId?: string; readonly headerName?: string; readonly queryName?: string };
    readonly fields: readonly CustomField[];
  }
  export interface SourceIssue { readonly sourceId: string; readonly reason: string; }
  export function normalizeSources(input: unknown): { sources: readonly CustomSource[]; issues: readonly SourceIssue[] };
  export interface SourceStore { read(): Promise<{ sources: readonly CustomSource[]; issues: readonly SourceIssue[] }>; write(input: unknown): Promise<...>; }
  ```

- [ ] **Step 1: Write the failing tests**
  - Ids `[a-z0-9_-]{1,32}`, field ids unique within a source, `custom.<source>.<field>` is a legal key.
  - URL must be `http`/`https` with no credentials in it.
  - 33 sources, 65 fields, interval `9999`, timeout `999` and `10001` are each refused with a message naming the limit.
  - A bad entry is skipped with a `SourceIssue`; the other sources survive and the file still reads.
  - Write is atomic: a failing rename leaves the previous file intact.
- [ ] **Step 2: Run the tests and confirm they fail**

  Run: `npx vitest run packages/host/src/settings/sources.test.ts`
  Expected: FAIL, module not found.

- [ ] **Step 3: Implement the store**
  Same temp-file + rename and queueing as `credentials.ts`. Validation is a pure `normalizeSources` so the page and the store share one rule.
- [ ] **Step 4: Run the tests**

  Run: `npx vitest run packages/host/src/settings/sources.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/host/src/settings/sources.ts packages/host/src/settings/sources.test.ts packages/host/src/main.ts
  git commit -m "feat(host): add the validated custom source store"
  ```

### Task 5.2: Fetch client, SSRF rules, JSON Pointer

**Files:**
- Create: `packages/host/src/providers/custom/fetch-source.ts`
- Create: `packages/host/src/providers/custom/pointer.ts`
- Create: `packages/host/src/providers/custom/fetch-source.test.ts`
- Create: `packages/host/src/providers/custom/pointer.test.ts`

**Interfaces:**
- Consumes: `CustomSource`.
- Produces:
  ```ts
  export interface FetchOutcome { readonly ok: true; readonly body: unknown; readonly elapsedMs: number; }
    | { readonly ok: false; readonly status?: number; readonly reason: string };
  export function fetchSource(source: CustomSource, credential: string | undefined, fetchImpl: typeof fetch, nowMs: () => number): Promise<FetchOutcome>;
  export function resolvePointer(body: unknown, pointer: string): { found: boolean; value?: unknown };
  ```

- [ ] **Step 1: Write the failing tests**
  - `resolvePointer` handles `""`, `/a/0/b`, `~1` → `/`, `~0` → `~`, and reports a missing path as not found.
  - A `GET` is used; a source declaring another method is impossible by shape.
  - Redirect chain of 3 same-scheme hops is followed; the 4th is refused; `https → http` is refused.
  - Credentials are dropped when the redirect origin changes.
  - Cloud metadata (`169.254.169.254`) and link-local addresses are refused; `127.0.0.1` and `192.168.x.x` are allowed.
  - A 2 MiB body is refused; a non-JSON content type is refused; a non-2xx reports its status.
  - Five concurrent calls run at most four; a second call for the same source waits.
  - TLS verification is never disabled (no `rejectUnauthorized: false`).
- [ ] **Step 2: Run the tests and confirm they fail**

  Run: `npx vitest run packages/host/src/providers/custom`
  Expected: FAIL, module not found.

- [ ] **Step 3: Implement the client**
  One semaphore per host process (4) and one lock per source. Manual redirect handling with the stated rules; `AbortSignal.timeout(source.timeoutMs)`; size counted as bytes arrive. Reasons are redacted at the callback boundary.
- [ ] **Step 4: Run the tests**

  Run: `npx vitest run packages/host/src/providers/custom`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/host/src/providers/custom
  git commit -m "feat(host): fetch custom sources with bounded, SSRF-safe requests"
  ```

### Task 5.3: Custom source provider

**Files:**
- Create: `packages/host/src/providers/custom/provider.ts`
- Create: `packages/host/src/providers/custom/provider.test.ts`
- Modify: `packages/host/src/main.ts` (register provider after built-ins)

**Interfaces:**
- Consumes: Tasks 5.1, 5.2, `CredentialStore`, `UnitKind`.
- Produces:
  ```ts
  export class CustomSourceProvider implements SensorProvider { readonly id = "custom"; }
  export function customFieldKey(sourceId: string, fieldId: string): string; // `custom.<source>.<field>`
  ```
  Descriptor per field: key, family (`field.family ?? "custom"`), label, unit, `unitKind`, `valueKind` from `type`, expected tier. `sample()` returns cached values scaled/offset once at acquisition.

- [ ] **Step 1: Write the failing tests**
  - Descriptors exist for every field of every valid source.
  - A number/text/boolean field each return the matching `Sample` field.
  - A missing pointer is `missing` with the pointer in the redacted reason; a type mismatch is `error`, never coerced.
  - After three missed intervals the last good value is `stale`; a later success returns `ok`.
  - Two sources with one failing do not affect the other's sample.
  - No fetch happens while none of a source's keys is demanded; the first demand starts its timer.
  - Changing `sources.json` and calling `reload()` replaces descriptors without doubling timers.
- [ ] **Step 2: Run the tests and confirm they fail**

  Run: `npx vitest run packages/host/src/providers/custom/provider.test.ts`
  Expected: FAIL, module not found.

- [ ] **Step 3: Implement the provider**
  Per-source cached reading, timer at `intervalMs`, demand accounting across all its keys, credential resolution through `CredentialStore.valueOf`, and redaction before any message leaves the host.
- [ ] **Step 4: Run the tests**

  Run: `npx vitest run packages/host/src/providers/custom`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/host/src/providers/custom packages/host/src/main.ts
  git commit -m "feat(host): expose custom source fields as semantic sensors"
  ```

### Task 5.4: Source routes and credential integration

**Files:**
- Modify: `packages/host/src/server.ts` (`/api/sources`, `/api/sources/:id`, `/api/sources/:id/test`)
- Modify: `packages/host/src/settings/credentials-registry.ts` (dynamic ids)
- Modify: `packages/host/src/main.ts` (merged credential table; reload provider after writes)
- Test: `packages/host/src/server.test.ts`
- Test: `packages/host/src/settings/credentials-registry.test.ts`

**Interfaces:**
- Consumes: Tasks 5.1–5.3.
- Produces: `sourcesInUse(sourceIssues, sources): readonly KnownCredential[]` — built-ins plus one entry per credential id referenced by a source; `GET /api/sources` returns sources with last error and field count; `POST /api/sources/:id/test` returns one fetch's status, elapsed and first few mapped values.

- [ ] **Step 1: Write the failing tests**
  - Every source route is loopback-only and refuses a foreign origin, like the credential routes.
  - `GET` returns sources with health and never a credential value.
  - `PUT` validates through `normalizeSources` and returns the refused field on failure.
  - `POST .../test` uses the real credential, returns `{ ok, status, elapsedMs, values }`, and writes nothing.
  - A credential id referenced by a source is accepted by `PUT /api/credentials/:id`; an unreferenced arbitrary id is still refused.
  - Deleting a source does not delete its credential.
- [ ] **Step 2: Run the tests and confirm they fail**

  Run: `npx vitest run packages/host/src/server.test.ts`
  Expected: FAIL on the missing routes.

- [ ] **Step 3: Implement the routes and registry merge**
  Follow the existing credential route's guard order. After a successful write, reload the provider and the credential table so no restart is needed.
- [ ] **Step 4: Run the tests**

  Run: `npx vitest run packages/host/src/server.test.ts packages/host/src/settings/credentials-registry.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/host/src/server.ts packages/host/src/settings/credentials-registry.ts packages/host/src/main.ts packages/host/src/server.test.ts packages/host/src/settings/credentials-registry.test.ts
  git commit -m "feat(host): add loopback source routes and source credentials"
  ```

### Task 5.5: Sources page and editor discovery

**Files:**
- Modify: `packages/editor/src/host-settings-mode/region.tsx` (Sources section)
- Create: `packages/editor/src/host-settings-mode/sources-client.ts`
- Create: `tests/e2e/custom-source.spec.ts`
- Test: `packages/editor/src/host-settings-mode/region.dom.test.tsx`
- Test: `packages/editor/src/host-settings-mode/sources-client.test.ts`

**Interfaces:**
- Consumes: Task 5.4 routes, Task 1.4 catalogue, Task 1.5 image binding.
- Produces:
  ```ts
  export interface SourcesClient {
    list(): Promise<readonly SourceRow[]>;
    save(source: unknown): Promise<void>;
    remove(id: string): Promise<void>;
    test(id: string): Promise<TestResult>;
  }
  export function createSourcesClient(fetcher?: typeof fetch): SourcesClient;
  ```

- [ ] **Step 1: Write the failing tests**
  - The page lists each source with health, last success, field count and the redacted last error.
  - Add/edit validates client-side against the same limits; a refused save shows the field's reason.
  - Test shows status, elapsed time and mapped values; it stores nothing.
  - Delete confirms and offers credential removal; declining leaves the credential.
  - The page never renders a URL containing a key.
- [ ] **Step 2: Run the tests and confirm they fail**

  Run: `npx vitest run packages/editor/src/host-settings-mode`
  Expected: FAIL on the missing client/section.

- [ ] **Step 3: Implement the page**
  Follow the existing host-settings region idiom; no second credentials UI. The editor links here rather than editing sources.
- [ ] **Step 4: Write and run the browser proof**
  A local fixture server serves `{ "cpu": { "load": 42.5 } }`; add it through the page, bind `custom.fixture.cpu-load`, render it, then delete the source and assert the run shows `—` with a reason and the theme still loads.

  Run: `npx playwright test tests/e2e/custom-source.spec.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/editor/src/host-settings-mode tests/e2e/custom-source.spec.ts
  git commit -m "feat(editor): add the custom sources page and prove a bound field"
  ```

---

## Phase 6 — Frame and game presence

### Task 6.1: Frame statistics core and RTSS adapter

**Files:**
- Create: `packages/host/src/providers/frame/rolling.ts`
- Create: `packages/host/src/providers/frame/rolling.test.ts`
- Create: `packages/host/src/providers/frame/rtss.ts`
- Create: `packages/host/src/providers/frame/provider.ts`
- Create: `packages/host/src/providers/frame/provider.test.ts`
- Modify: `packages/host/src/main.ts` (register provider)

**Interfaces:**
- Consumes: supervisor, `SemanticProvider`.
- Produces:
  ```ts
  export interface FrameReading { readonly fps: number; readonly frametimeMs: number; readonly app: string; }
  export interface FrameAdapter { readonly id: "rtss" | "presentmon"; start(onReading: (reading: FrameReading) => void, onUnavailable: (reason: string) => void): () => void; }
  export class FrameWindow {
    add(frametimeMs: number, atMs: number): void;
    fps(nowMs: number): number | undefined;
    low1(nowMs: number): number | undefined; // undefined below 1000 frames in 60 s
  }
  export class FrameProvider implements SensorProvider { readonly id = "frame"; }
  ```

- [ ] **Step 1: Write the failing tests**
  - `fps` is the reciprocal of the mean frametime over the last second; no reading returns `undefined`.
  - `low1` is undefined until 1000 frames fall inside the rolling 60-second window; then it is the mean of the slowest 1% of frametimes converted to FPS.
  - Frames older than 60 seconds leave the window.
  - RTSS absent reports `unavailable` naming RTSS and does not spawn PresentMon yet.
  - A `FrameReading` maps to `fps.current`, `frametime.current`, `frame.app`; `fps.low1` is absent until the window is sufficient.
- [ ] **Step 2: Run the tests and confirm they fail**

  Run: `npx vitest run packages/host/src/providers/frame`
  Expected: FAIL, module not found.

- [ ] **Step 3: Probe RTSS on this PC before writing the struct reader**
  Record whether RTSS is running and the shared-memory version. Only then implement the `Add-Type` reader; if the probe cannot establish the layout, leave the adapter `unavailable` with that reason and finish the PresentMon adapter in Task 6.2. Do not guess a struct layout.
- [ ] **Step 4: Implement the window, provider and adapter**
  Provider caches the latest reading, polls only while `frame.*` is demanded, and reports the adapter's reason once.
- [ ] **Step 5: Run the tests**

  Run: `npx vitest run packages/host/src/providers/frame`
  Expected: PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/host/src/providers/frame packages/host/src/main.ts
  git commit -m "feat(host): add frame statistics and the RTSS adapter"
  ```

### Task 6.2: PresentMon adapter

**Files:**
- Create: `packages/host/src/providers/frame/presentmon.ts`
- Create: `packages/host/src/providers/frame/presentmon.test.ts`
- Create: `packages/host/scripts/vendor-presentmon.mjs`
- Modify: `packages/host/package.json` (`vendor:presentmon`)
- Modify: `THIRD-PARTY-NOTICES.md`, `docs/engineering/dependencies.md`
- Modify: `packages/host/src/providers/frame/provider.ts` (adapter order)

**Interfaces:**
- Consumes: `FrameAdapter`, supervisor.
- Produces:
  ```ts
  export function parsePresentMonCsv(line: string): { frametimeMs: number; app: string } | undefined;
  export function presentMonAdapter(options: { executable: string; nowMs: () => number }): FrameAdapter;
  ```

- [ ] **Step 1: Verify and vendor PresentMon**
  Verify the MIT licence from the release metadata, add it to `THIRD-PARTY-NOTICES.md` and `docs/engineering/dependencies.md`, and add `vendor:presentmon` beside `vendor:lhm`. Do not commit the binary if the repository's vendor policy excludes binaries; follow `vendor-lhm.mjs`'s existing shape.
- [ ] **Step 2: Write the failing tests**
  - A CSV line with `msBetweenPresents` and an application column parses; a header line and a malformed line return `undefined`.
  - The adapter passes CSV-on-stdout flags and no file output.
  - A denied trace session reports `unavailable` naming the `Performance Log Users` requirement and stops retrying until the next demand window.
  - RTSS succeeds → PresentMon is not started; RTSS unavailable → PresentMon starts.
- [ ] **Step 3: Run the tests and confirm they fail**

  Run: `npx vitest run packages/host/src/providers/frame/presentmon.test.ts`
  Expected: FAIL, module not found.

- [ ] **Step 4: Implement the adapter**
  Parse line-delimited CSV, feed `FrameWindow`, kill the process tree on stop. Never prompt for UAC.
- [ ] **Step 5: Run the tests**

  Run: `npx vitest run packages/host/src/providers/frame`
  Expected: PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/host/src/providers/frame packages/host/scripts/vendor-presentmon.mjs packages/host/package.json THIRD-PARTY-NOTICES.md docs/engineering/dependencies.md
  git commit -m "feat(host): add the PresentMon frame adapter"
  ```

### Task 6.3: Game presence and Steam library

**Files:**
- Create: `packages/host/src/providers/game/steam-library.ts`
- Create: `packages/host/src/providers/game/steam-library.test.ts`
- Create: `packages/host/src/providers/game/provider.ts`
- Create: `packages/host/src/providers/game/provider.test.ts`
- Create: `packages/host/src/providers/helpers/foreground.ts`
- Modify: `packages/host/src/main.ts` (register provider)

**Interfaces:**
- Consumes: supervisor, `CredentialStore`-independent local files.
- Produces:
  ```ts
  export interface SteamApp { readonly appId: string; readonly name: string; readonly installDir: string; }
  export function parseLibraryFolders(vdf: string, steamRoot: string): readonly string[];
  export function parseAppManifest(acf: string): { appId: string; name: string; installDir: string } | undefined;
  export function matchProcess(executablePath: string, apps: readonly SteamApp[]): SteamApp | undefined;
  export class GameProvider implements SensorProvider { readonly id = "game"; }
  ```
  Keys: `game.name`, `game.app`, `game.running`, `game.artwork`.

- [ ] **Step 1: Write the failing tests**
  - `libraryfolders.vdf` with two library paths parses both; a quoted path with spaces survives.
  - `appmanifest_*.acf` yields app id, name and install dir; a malformed manifest yields `undefined`.
  - Path matching is case-insensitive on Windows and requires the executable to sit inside the app's `installDir`.
  - A matched Steam game reports name/app/running; a non-Steam foreground process reports its executable name and `game.running` true with no `game.name`; no foreground game reports `running` false and no name.
  - `game.artwork` is described with `mediaKind: "image"`; `game.running` is boolean.
  - Steam absent produces no game keys and no crash.
- [ ] **Step 2: Run the tests and confirm they fail**

  Run: `npx vitest run packages/host/src/providers/game`
  Expected: FAIL, module not found.

- [ ] **Step 3: Implement the parsers and provider**
  Minimal VDF/ACF parsing for the fields used; no npm dependency. Foreground helper reads process id and executable path once a second via PowerShell.
- [ ] **Step 4: Run the tests**

  Run: `npx vitest run packages/host/src/providers/game`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/host/src/providers/game packages/host/src/providers/helpers/foreground.ts packages/host/src/main.ts
  git commit -m "feat(host): detect the running Steam game locally"
  ```

### Task 6.4: Local box art route and game image proof

**Files:**
- Create: `packages/host/src/providers/game/box-art.ts`
- Create: `packages/host/src/providers/game/box-art.test.ts`
- Modify: `packages/host/src/providers/game/provider.ts` (`game.artwork`)
- Modify: `packages/host/src/server.ts` (`/api/game/artwork/<appId>.<ext>`)
- Create: `tests/e2e/game-artwork.spec.ts`

**Interfaces:**
- Consumes: `SteamApp`, Task 1.5 image binding.
- Produces:
  ```ts
  export function findBoxArt(app: SteamApp, steamRoots: readonly string[]): Promise<string | undefined>;
  // → host-relative "/api/game/artwork/<appId>.<ext>"
  ```
  Local library cache only; no Steam CDN request.

- [ ] **Step 1: Write the failing tests**
  - A cached `librarycache/<appId>_library_600x900.jpg` is found and served at a host-relative URL.
  - No local image leaves `game.artwork` unavailable; no CDN URL is ever produced.
  - The route refuses an app id that is not a known installed app.
- [ ] **Step 2: Run the tests and confirm they fail**

  Run: `npx vitest run packages/host/src/providers/game/box-art.test.ts`
  Expected: FAIL, module not found.

- [ ] **Step 3: Implement the route and image key**
  Serve bytes from disk with an image content type and bounded caching; a missing file is a 404, which the image binding treats as a load error and leaves the authored asset. The route is reachable by a paired display through the same session token as theme asset bytes; a request without a valid display session is refused.
- [ ] **Step 4: Write and run the browser proof**
  Fixture provider emits `game.name` and `game.artwork`; assert the image renders, then emits `unavailable` and assert the authored asset returns.

  Run: `npx playwright test tests/e2e/game-artwork.spec.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/host/src/providers/game packages/host/src/server.ts tests/e2e/game-artwork.spec.ts
  git commit -m "feat(host): serve local Steam box art for the running game"
  ```

---

## Phase 7 — Steam store metadata

Ruled by the user on 2026-10-24: a Steam store lookup is on by default because
building an adapter per store does not cover most stores, and network access is
accepted. This supersedes the spec's earlier "no CDN fallback" and exact-name
wording; the spec has been amended to say the same thing.

### Task 7.1: Steam store client and tiered matcher

**Files:**
- Create: `packages/host/src/providers/game/store-metadata.ts`
- Create: `packages/host/src/providers/game/store-metadata.test.ts`
- Create: `packages/host/src/providers/game/name-match.ts`
- Create: `packages/host/src/providers/game/name-match.test.ts`

**Interfaces:**
- Consumes: an injected `fetchImpl`; no test performs a real request.
- Produces:
  ```ts
  export function normalizeGameName(name: string): string;
  export function matchStoreGame(localName: string, candidates: readonly { id: number; name: string }[]): { id: number; name: string } | undefined;
  export function createSteamStore(options: {
    fetchImpl: typeof fetch; cacheDir: string; nowMs?: () => number;
  }): {
    lookup(name: string, signal?: AbortSignal): Promise<{ id: number; name: string } | undefined>;
    cover(appId: number, signal?: AbortSignal): Promise<string | undefined>; // host-relative URL
  };
  ```
  Requests: `https://store.steampowered.com/api/storesearch/?term=<name>&cc=us&l=en`
  then `/api/appdetails?appids=<id>&filters=basic`. `cc=us&l=en` are fixed
  constants (the endpoint answers `total: 0` without `cc`). Cover: try
  `https://cdn.akamai.steamstatic.com/steam/apps/<id>/library_600x900.jpg`,
  fall back to `data.header_image` when that answers non-200. Sniff the bytes'
  magic number for the type; the URL extension is not trusted.

- [ ] **Step 1: Write the failing matcher tests**
  `™`/`®`/`©`, case and punctuation, a leading article, `- Deluxe Edition`,
  `GOTY`, `Definitive Edition`; `Doom` refuses `Doom Eternal` (the extra word is
  not a qualifier), two candidates that both survive normalisation refuse, and
  one surviving candidate is accepted. No prefix or substring rule: a local
  `Half-Life` must not match `Half-Life 2`.
- [ ] **Step 2: Run them and confirm they fail**

  Run: `npx vitest run packages/host/src/providers/game/name-match.test.ts`
  Expected: FAIL, module not found.

- [ ] **Step 3: Implement the normaliser and tiers**
  Strip `™`/`®`/`©` before `normalize("NFKD")` (NFKD turns `™` into `TM`), fold
  case, and strip combining marks only when the base character is Latin — kana
  voicing and Cyrillic phonemic marks are meaningful, so `が` must not become
  `か`. Then strip punctuation and articles, drop the trailing qualifier words,
  collapse whitespace. Bare-safe words: `definitive`, `deluxe`, `ultimate`,
  `complete`, `enhanced`, `remastered`, `collector's`, `director's cut`, `goty`,
  `game of the year`; `gold`, `special`, `legendary`, `anniversary` only inside
  an `edition` phrase, because `Pokémon Gold` is not `Pokémon`. Two results with one appid
  are one candidate. Accept a candidate only when the normalised base titles are equal
  or their token sets are equal; return a winner only when exactly one candidate
  survives. No prefix, substring or edit-distance rule — it is the rule that
  turns a sequel into the wrong cover.
- [ ] **Step 4: Write and run the client tests**
  Fixture JSON for a storesearch hit, a miss, a 429, and a rejected fetch;
  appdetails success; a portrait 404 falling back to `header_image`; assert the
  request URL carries the local name and no other parameter beyond `cc`/`l`, and
  that a second lookup for the same normalised name makes zero requests, a
  "no match" is cached, and a failed request keeps an existing cache entry.

  Run: `npx vitest run packages/host/src/providers/game/store-metadata.test.ts`
  Expected: PASS.
- [ ] **Step 5: Implement the client and disk cache**
  Cache file `game-metadata.json` under the injected `cacheDir`, written
  temp-then-rename. Entries: `{ [normalisedName]: { term, id, name, at } | { term, none: true, at } }`
  — `term` is the searched spelling, so a cached "no match" for one spelling does
  not suppress another spelling that normalises the same but searches differently.
  plus cover files by appid. A 429 or a rejected fetch marks the name
  unavailable for 10 minutes rather than retrying every poll. Cover bytes are
  written only after the response passes the type sniff.
- [ ] **Step 6: Commit**

### Task 7.2: Provider answers a store name and cover

**Files:**
- Modify: `packages/host/src/providers/game/provider.ts`
- Modify: `packages/host/src/providers/helpers/foreground.ts`
- Test: `packages/host/src/providers/game/provider.test.ts`

**Interfaces:**
- Consumes: Task 7.1's `createSteamStore`; the foreground helper's executable
  path.
- Produces: `game.name` and `game.app` for a non-Steam foreground app; the
  priority is Steam app name, then store match, then the executable's version-info
  `ProductName`, then its file name without extension.

- [ ] **Step 1: Write the failing provider tests**
  Fixture store returns `{ id: 1201270, name: "Example Game" }` for a
  non-Steam executable; the sample carries `game.name: "Example Game"`,
  `game.app` as the local name, `game.running: true`, and `game.artwork` only
  once demanded. A Steam install uses its appid without a name search (assert
  zero storesearch calls). An unmatched app keeps `game.app` and has no
  `game.name`. Offline with a cached match still answers; offline with no cache
  is `unavailable` with a reason. Red-proof: disable the matcher and observe the
  unnamed case fail.
- [ ] **Step 2: Run, confirm FAIL; implement the resolution order; run to PASS.**

  Run: `npx vitest run packages/host/src/providers/game`
- [ ] **Step 3: Read the executable's product name once per path**
  In `helpers/foreground.ts`, read `(Get-Item '<exe>').VersionInfo.ProductName`
  through the existing PowerShell path, cache by executable path for the process
  life, and treat an empty or missing value as absent. Do not spawn per poll.
- [ ] **Step 4: Demand-driven cover fetch**
  Fetch cover bytes only when `game.artwork` is in the demanded key set; the
  route never starts a download, and a presence-only poll never downloads.
  Cache-miss is `unavailable`; a cached cover answers with no request. A name
  lookup itself runs only while a `game.*` key is demanded, and its result —
  match or "no match" — is cached on disk for the spelling searched, so an
  unfixed vg-723 costs one request per distinct spelling, survives a restart,
  and costs one more only when the same normalised key is searched with a
  different spelling.
- [ ] **Step 5: Commit**

### Task 7.3: Cached remote covers through the gated route

**Files:**
- Modify: `packages/host/src/server.ts` (`/api/game/artwork/<appId>.jpg`, `ServerOptions`)
- Modify: `packages/host/src/main.ts` (pass the game-metadata cache directory)
- Modify: `packages/host/src/providers/game/box-art.ts`
- Test: `packages/host/src/server.test.ts`, `packages/host/src/providers/game/box-art.test.ts`

- [ ] **Step 1: Write the failing route tests**
  A route request for an appid that is not installed but whose cover the host
  cached in its own directory returns the bytes; an id with no cached file is a
  404, not a proxy pass-through; a path outside the cache dir is refused
  (`realpath` containment); authorisation, `image/jpeg`, `nosniff` and
  `private, max-age=3600` match the local route. No network in any test.
- [ ] **Step 2: Run, confirm FAIL; extend the lookup; run to PASS.**

  Run: `npx vitest run packages/host/src/server.test.ts packages/host/src/providers/game/box-art.test.ts`
- [ ] **Step 3: Decide the local-vs-remote order in `box-art.ts`**
  Local library cache first (no network); otherwise the cached cover file in the
  game-metadata cache directory. The route serves bytes only: the provider owns
  every download, so a route request never starts a fetch and two owners cannot
  race for the same file. The provider publishes the route URL only after the
  bytes are cached.
- [ ] **Step 4: Commit**

### Task 7.4: Browser proof and honest fallback

**Files:**
- Create: `tests/e2e/game-metadata.spec.ts`
- Modify: `playwright.config.ts` (own-host port 4245; 4241/4243 are the
  `host-player` themed hosts)
- Modify: `packages/host/src/providers/game/store-metadata.ts` (a `baseUrl`
  option, default the real Steam store)
- Modify: `packages/host/src/main.ts` (two env seams: `YUNARI_STEAM_STORE` for
  the store base URL and `YUNARI_FOREGROUND_EXE` for a fixed foreground
  executable), plus `docs/engineering/gotchas.md`

- [ ] **Step 1: Write the failing spec**
  A fixture server plays storesearch, appdetails and the cover image, selected
  through `YUNARI_STEAM_STORE`; `YUNARI_FOREGROUND_EXE` points at a fixture
  executable with no Steam manifest, and the cache directory starts empty. Run
  the real host and player (no stubbed stream): the player paints the store's
  name and cover. Assert every request the page makes is same-origin — none to
  `steampowered.com` or `steamstatic.com` — and that the host asked the fixture
  for the name exactly once.
- [ ] **Step 2: Run it and confirm it fails for the missing capability.**

  Run: `npx playwright test tests/e2e/game-metadata.spec.ts --workers=1`
- [ ] **Step 3: Add the offline arm**
  Stop the fixture server and clear the cache: an authored image returns and the
  run shows a reason. With the fixture still stopped but only the cover cache
  present, reload the display: the cover renders, and the fixture's recorded
  request count is unchanged once it can answer again.
- [ ] **Step 4: Rebuild the affected bundles, re-run to PASS, commit.**

### Task 7.5: Spec/plan/STATUS truth and the phase gate

- [ ] **Step 1: Update `STATUS.md`** (objective mentions seven phases; last
  completed change is the Phase 7 commit; next steps and blockers reflect what
  remains unverified). Run `npm run status:check` from `src/web/`.
- [ ] **Step 2: Record the matcher ruling in the ledger**, superseding the
  spec's earlier "exact match" and "no CDN" sentences, and note what is still
  unverified (live store lookup on hardware, rate-limit behaviour).
- [ ] **Step 3: Run the boundary gate**

  Run: `npm run gate > "$TEMP/gate-phase7.log" 2>&1; echo $?` from `src/web/`
  Expected: exit 0; record file/test counts from the log.
- [ ] **Step 4: Commit.**

---

## Final verification

- [ ] Run the full gate from `src/web/`: `npm run gate > /tmp/gate.log 2>&1; echo $?`; expect exit 0 and record the file/test counts from the log. Do not report green from a piped `tail`.
- [ ] Re-run each new browser spec individually with its own port window; two worktrees must not share a Playwright project.
- [ ] Red-proof each new regression test by disabling its fix, observing the failure, and restoring with `cmp` (a Windows text-mode write leaves CRLF; `git checkout` will not show it).
- [ ] Record acceptance evidence item by item (spec Acceptance 1–10) in the closing commit body: what was observed, on which machine/provider.
- [ ] Report anything not actually verified: Windows Geolocator permission behaviour, live WeatherAPI/OpenWeatherMap responses, real RTSS/PresentMon readings, real fan labels, Steam box-art naming, and a live Steam store lookup on hardware.
