# Colour Picker and Gradient Editor Rebuild — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two one-off paint controls with one culori-backed colour picker (2-D area, hue, alpha, exact value, editor-local presets, eyedropper) and a gradient editor whose track is both preview and manipulator, with one settled-commit history entry per gesture.

**Architecture:** Colour maths moves down into `@yunari/renderer-core` as one wrapper over culori. The editor keeps a pure channel model, an editor-local preset library, a live/settled state hook, and two React surfaces built from the existing §5 control set and Base UI wrappers. Palette edits become undoable by extending `EditorHistory` entries to carry globals.

**Tech Stack:** TypeScript, React 19, Base UI (`@base-ui/react/popover`, `/radio-group`, `/context-menu`), Tailwind + tokens, culori 4.0.2, Vitest/jsdom, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-12-colour-and-gradient-rebuild-design.md`

**Phase 0 (owner ruling, 2026-10-23):** Tasks 1 and 3 land on `main` **before** the rest of the plan, as their own branch cut from `main`, so the asset finder's palettes-and-gradients spec can read the committed preset-library location and data shape. They are the contract that spec depends on; everything from Task 2 onward builds on them. If Task 1 and Task 3 need a mid-course split of their own, that split is a new plan, not a second active one.

## Global Constraints

- Run every command from `src/web/` unless the step says otherwise.
- **One new runtime dependency: `culori@4.0.2`** (MIT, zero dependencies), plus its MIT types package `@types/culori@4.0.1` as a devDependency — culori 4 ships no declarations of its own. No shadcn CLI installs, no ReUI source copied, no second colour library.
- The stored and displayed colour is **8-digit sRGB hex** (`#rrggbb` when opaque, `#rrggbbaa` otherwise). `parseColor`/`formatColor` in `renderer-core/src/color.ts` are the authority — `CSS.supports` is not.
- **One trigger per colour**: the pane row's well opens the picker; the only exact-value field lives in the popover.
- The `DESIGN.md` §5 vocabulary is closed. This work adds exactly two members — the 2-D colour area and the gradient track.
- **Presets are editor-local data** under `yunari.editor.presets`: seeded once with 12 colours and the 15 cssgradient.io/swatches gradients, extended by the asset finder’s palettes-and-gradients surface (a separate spec, not built here), and deletable by right-click or Delete. They are not theme data and are not in document undo.
- **Gradient midpoints are not built** (owner ruling, 2026-10-23).
- Tests must not contain hex colour literals: the token gate derives the `.dom.test.tsx` half of its gated set, and a test is subject to the same literal rule. Use `rgb()`, `hsl()` or named colours in tests.
- **Seed data is written as `rgb()` strings, never hex.** `preset-library/defaults.ts` is editor source inside the token gate's reach; the store normalises it to hex when it reads. Do not add a token-gate exclusion for it.
- `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on. Refuse invalid numbers, never coerce to zero.
- 500 lines is a review signal; 800 is a stop. No new file may exceed 800 lines.
- **Before Task 1, make this plan the active plan.** `STATUS.md` currently says no plan is in flight; write the plan under “Active work”, keep the other incomplete plans queued, and keep the file to the bullet limits `status:check` enforces.
- Before each task commit, replace `STATUS.md`'s “Last completed change” with 1–5 one-line bullets for that commit and run `npm run status:check`. Never append older bullets.
- Stage explicit paths only. Never `git add -A` or `git commit -a`.
- Conventional Commit titles; end every commit message with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Playwright previews built bundles. Rebuild the editor after source changes; never run the same Playwright project from two worktrees at once.

## Review Focus

These are the input classes most likely to bite a person, beyond what each task's own tests state. Each is pinned by a test in the task named.

1. **A stored colour written in `rgb()`, `hsl()` or a name** opens in the picker, and committing rewrites only its own token to hex — it does not silently normalise the rest of the palette, and the field shows the stored value's hex. (Task 4, Task 6)
2. **A drag that ends outside the popup or window** produces exactly one settled commit (or none on Escape), never one per pointer sample. (Task 5, Task 10)
3. **A keyboard-only author** reaches the area, hue, alpha, the preset rows, the stop marks, add, remove and the number wells; Delete removes a focused preset; Escape returns focus to the trigger. (Task 5, Task 8)
4. **Duplicates and degenerate gradients** — two stops at one offset render as two distinct marks; zero and one stop produce valid CSS rather than `linear-gradient(…, )`. (Task 2, Task 8)
5. **Undo after a live drag** restores the palette to the value before the gesture in one step, not N steps and not zero. (Task 7, Task 10)

---

## Phase 1 — Foundations

### Task 1: One colour owner on culori

**Files:**
- Modify: `src/web/packages/renderer-core/package.json`
- Create: `src/web/packages/renderer-core/src/color.ts`
- Create: `src/web/packages/renderer-core/src/color.test.ts`
- Modify: `src/web/packages/renderer-core/src/charts/fill.ts`
- Modify: `src/web/packages/renderer-core/src/charts/fill.test.ts`
- Modify: `src/web/packages/renderer-core/src/theme/facet-record.ts`
- Modify: `src/web/packages/renderer-core/src/index.ts`
- Modify: `docs/architecture/ownership.md`
- Modify: `THIRD-PARTY-NOTICES.md`
- Modify: `docs/engineering/dependencies.md`
- Create: `docs/decisions/0098-colour-maths-is-culori.md`

**Interfaces:**
- Produces:
  ```ts
  export interface Rgba { readonly r: number; readonly g: number; readonly b: number; readonly a: number } // r/g/b 0–255, a 0–1
  export interface Hsva { readonly h: number; readonly s: number; readonly v: number; readonly a: number } // h 0–360, s/v/a 0–1
  export function parseColor(input: string): Rgba | undefined
  export function toHsv(rgba: Rgba): Hsva
  export function fromHsv(hsva: Hsva): Rgba
  export function formatColor(rgba: Rgba): string
  ```

- [ ] **Step 1: Add the dependency**

Run: `npm install culori@4.0.2 -w @yunari/renderer-core` then `npm install -D @types/culori@4.0.1 -w @yunari/renderer-core`
Expected: `package.json` gains `"culori": "4.0.2"` in `dependencies` and `"@types/culori": "4.0.1"` in `devDependencies`; `package-lock.json` changes; do not edit the lock by hand.

- [ ] **Step 2: Write the failing test**

`src/web/packages/renderer-core/src/color.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatColor, fromHsv, parseColor, toHsv } from "./color.js";

describe("parseColor", () => {
  it("parses the forms the field accepts", () => {
    expect(parseColor("#f00")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor("rgb(16 32 48)")).toEqual({ r: 16, g: 32, b: 48, a: 1 });
    expect(parseColor("hsl(0 100% 50%)")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor("red")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("refuses what is not a colour", () => {
    expect(parseColor("nope")).toBeUndefined();
    expect(parseColor("#12345")).toBeUndefined();
    expect(parseColor("")).toBeUndefined();
  });
});

describe("formatColor", () => {
  it("keeps alpha only when the value is translucent", () => {
    expect(formatColor(parseColor("#102030ff")!)).toBe("#102030");
    expect(formatColor(parseColor("#081523d9")!)).toBe("#081523d9");
  });

  it("round-trips a translucent value", () => {
    const rgba = parseColor("#081523d9")!;
    expect(rgba.a).toBeCloseTo(217 / 255, 5);
    expect(formatColor(rgba)).toBe("#081523d9");
  });
});

describe("hsv", () => {
  it("converts pure colours in both directions", () => {
    const red = toHsv({ r: 255, g: 0, b: 0, a: 1 });
    expect(red.h).toBeCloseTo(0, 5);
    expect(red.s).toBeCloseTo(1, 5);
    expect(red.v).toBeCloseTo(1, 5);
    expect(formatColor(fromHsv({ h: 120, s: 1, v: 1, a: 1 }))).toBe("#00ff00");
  });

  it("treats a grey as zero saturation and a finite hue", () => {
    const grey = toHsv({ r: 128, g: 128, b: 128, a: 1 });
    expect(grey.s).toBeCloseTo(0, 5);
    expect(Number.isFinite(grey.h)).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run packages/renderer-core/src/color.test.ts`
Expected: FAIL — cannot resolve `./color.js`.

- [ ] **Step 4: Implement `src/web/packages/renderer-core/src/color.ts`**

Register only the modes the field accepts:

```ts
import { converter, formatHex, formatHex8, modeHsl, modeHsv, modeRgb, parse, useMode } from "culori/fn";
useMode(modeRgb);
useMode(modeHsl);
useMode(modeHsv);
```

`parseColor` calls `parse(input)` and returns `undefined` when it returns nothing; convert through `converter("rgb")`; normalise missing `alpha` to 1. `toHsv`/`fromHsv` go through `converter("hsv")` and convert the 0–255 channels; **culori returns `h: NaN` for a grey, so normalise a non-finite hue to 0**. `formatColor` builds a culori rgb object with `r/255` and uses `formatHex8` when `a < 1`, otherwise `formatHex`. Round channels to 3 decimals before returning so float noise does not leak into equality tests.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run packages/renderer-core/src/color.test.ts`
Expected: PASS.

- [ ] **Step 6: Retire the second parser**

**First write to `charts/fill.ts` is gated**: land `docs/decisions/0098-colour-maths-is-culori.md` (Step 8's rungs) claiming `src/web/packages/renderer-core/src/charts/fill.ts` before this step's first edit, or the reuse hook refuses it.

- In `charts/fill.ts`: delete `export function parseHex`, import `parseColor` from `../color.js`, and make `mixHex` use `parseColor(...)` fields.
- In `theme/facet-record.ts`: replace `import { parseHex } from "../charts/fill.js"` with `import { parseColor } from "../color.js"`; `lightnessOf` becomes `const rgba = parseColor(color); if (rgba === undefined) return undefined;` and uses `rgba.r/g/b`.
- In `charts/fill.test.ts`: delete the `parseHex` describe block; add a case proving a named colour now resolves through the shared parser (`mixHex("red", "blue", 0)` is `"#ff0000"`, not the nearer-endpoint fallback `"red"`).
- In `src/index.ts`: export the four functions and two interfaces from `./color.js`.

- [ ] **Step 7: Run the renderer-core suite**

Run: `npx vitest run packages/renderer-core/src`
Expected: PASS. Then run `npm run typecheck -w @yunari/renderer-core`.
Expected: exit 0.

- [ ] **Step 8: Record ownership and provenance**

- `docs/architecture/ownership.md`: move the “Shared colour parsing” row from the Editor table to “Shared/domain”, naming `renderer-core/src/color.ts`, “hex, rgb(), hsl() and named colours → RGBA, RGBA↔HSVA, hex formatting, and the refusal that returns `undefined`”.
- `THIRD-PARTY-NOTICES.md`: add a Runtime/editor row `culori 4.0.2 | MIT | colour parsing and conversion (no dependencies of its own)`, and name `@types/culori 4.0.1` (MIT) in the build/test paragraph.
- `docs/engineering/dependencies.md`: add the matching Declared dependencies row for `culori`, and a devDependency row for `@types/culori`.
- Create `docs/decisions/0098-colour-maths-is-culori.md` from the directory's template (written before Step 6's first write). Rungs: (1) editor's `colour-maths.ts` plus a second tuple parser in `charts/fill.ts`; (2) no installed colour package; (3) `EyeDropper` only, no colour parsing; (4) searched npm metadata for culori, colorjs.io, chroma-js, color-convert, tinycolor2 — record the table and the dead ends; (5) culori wins on licence, zero deps, ESM tree-shaking and Node safety; (6) probe: the tests above; (7) decision. Claim `src/web/packages/renderer-core/src/charts/fill.ts`; the next watchlisted path (`editor/src/components/ui/colour-picker.tsx`) is claimed by a later task's note only if that gate refuses.

- [ ] **Step 9: Update status and commit**

Run: `npm run status:check` (after editing `STATUS.md` per the Global Constraints).

```bash
git add src/web/packages/renderer-core/package.json src/web/package-lock.json \
  src/web/packages/renderer-core/src/color.ts src/web/packages/renderer-core/src/color.test.ts \
  src/web/packages/renderer-core/src/charts/fill.ts src/web/packages/renderer-core/src/charts/fill.test.ts \
  src/web/packages/renderer-core/src/theme/facet-record.ts src/web/packages/renderer-core/src/index.ts \
  docs/architecture/ownership.md THIRD-PARTY-NOTICES.md docs/engineering/dependencies.md \
  docs/decisions/0098-colour-maths-is-culori.md STATUS.md
git commit -m "feat(renderer): one colour parser on culori

Retires the second parser in charts/fill.ts and records the dependency.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 2: Channel model and the one gradient formula

**Files:**
- Create: `src/web/packages/editor/src/components/ui/colour-picker-model.ts`
- Create: `src/web/packages/editor/src/components/ui/colour-picker-model.test.ts`
- Create: `src/web/packages/editor/src/components/ui/gradient-css.ts`
- Create: `src/web/packages/editor/src/components/ui/gradient-css.test.ts`
- Modify: `src/web/packages/editor/src/panes/tokens/paint-list.tsx`

**Interfaces:**
- Consumes: `Hsva` from `@yunari/renderer-core`.
- Produces:
  ```ts
  export type ColourChannel = "saturation" | "value" | "hue" | "alpha";
  export const CHANNEL_RANGES: Readonly<Record<ColourChannel, { readonly min: number; readonly max: number; readonly step: number }>>;
  export function channelValue(channel: ColourChannel, hsva: Hsva): number;
  export function withChannel(hsva: Hsva, channel: ColourChannel, value: number): Hsva;
  export function channelRatio(channel: ColourChannel, hsva: Hsva): number;
  export function withChannelRatio(hsva: Hsva, channel: ColourChannel, ratio: number): Hsva;
  export function steppedValue(value: number, min: number, max: number, step: number, key: string, shifted: boolean): number | undefined;
  export function areaPoint(hsva: Hsva): { readonly x: number; readonly y: number }; // percent, 0–100
  export function areaFromPoint(xRatio: number, yRatio: number): { readonly s: number; readonly v: number };
  export function areaValueText(hsva: Hsva, hex: string): string;
  export function gradientCss(stops: readonly { readonly offset: number; readonly color: string }[], angle: number): string;
  ```

- [ ] **Step 1: Write the failing tests**

`colour-picker-model.test.ts`:
- `channelValue("hue", {h:180,s:0.5,v:0.5,a:1})` is `180`; saturation/value/alpha are percentages.
- `withChannel` changes only the named channel.
- `steppedValue(10, 0, 100, 1, "ArrowRight", false)` is `11`; Shift+PageUp steps 10; `Home` is `0`; `End` is `100`; `"a"` is `undefined`; a step past the bound clamps.
- `areaPoint({h:0,s:1,v:1,a:1})` is `{x: 100, y: 0}`; `areaFromPoint(0.5, 0.25)` is `{s: 0.5, v: 0.75}`.
- `areaValueText` contains “Saturation”, “brightness” and the supplied hex.

`gradient-css.test.ts`:
- angle 90 maps to `0deg`; stops are sorted; offsets rounded.
- zero stops → `"transparent"`; one stop → that colour.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/editor/src/components/ui/colour-picker-model.test.ts packages/editor/src/components/ui/gradient-css.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

- `colour-picker-model.ts`: hue `0–360`, saturation/value/alpha `0–100`, step `1`. `areaFromPoint` maps x→s and **inverts y** (top is `v = 1`). `steppedValue` returns `undefined` unless the key is Arrow/Horizontal/Vertical/Page/Home/End.
- `gradient-css.ts`: `"transparent"` for no stops, the colour for one, otherwise `linear-gradient(${90 - angle}deg, ${sorted.map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(", ")})`.

- [ ] **Step 4: Delete the duplicate formula in `paint-list.tsx`**

Replace the body of `paintCss` with `gradientCss(value.stops, value.angle)` and delete its local sort/map.

- [ ] **Step 5: Run**

Run: `npx vitest run packages/editor/src/components/ui/colour-picker-model.test.ts packages/editor/src/components/ui/gradient-css.test.ts packages/editor/src/panes/tokens/paint-list.dom.test.tsx`
Expected: PASS.

- [ ] **Step 6: Update status and commit**

```bash
git add src/web/packages/editor/src/components/ui/colour-picker-model.ts \
  src/web/packages/editor/src/components/ui/colour-picker-model.test.ts \
  src/web/packages/editor/src/components/ui/gradient-css.ts \
  src/web/packages/editor/src/components/ui/gradient-css.test.ts \
  src/web/packages/editor/src/panes/tokens/paint-list.tsx STATUS.md
git commit -m "feat(editor): a channel model and one gradient formula

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 3: The editor-local preset library

**Files:**
- Create: `src/web/packages/editor/src/preset-library/index.ts`
- Create: `src/web/packages/editor/src/preset-library/defaults.ts`
- Create: `src/web/packages/editor/src/preset-library/use-preset-library.ts`
- Create: `src/web/packages/editor/src/preset-library/index.test.ts`
- Modify: `docs/architecture/ownership.md` (a Preset library row under Editor: `preset-library/` owns the editor-local colour and gradient preset lists, their storage key and their add/delete API — the asset finder calls into it and never writes the key itself)

**Interfaces:**
- Consumes: `parseColor`, `formatColor` from `@yunari/renderer-core`.
- Produces:
  ```ts
  export interface ColourPreset { readonly id: string; readonly name: string; readonly value: string }
  export interface GradientPreset {
    readonly id: string;
    readonly name: string;
    readonly angle: number;
    readonly stops: readonly { readonly offset: number; readonly color: string }[];
  }
  export interface PresetLibrary { readonly colours: readonly ColourPreset[]; readonly gradients: readonly GradientPreset[] }
  export interface PresetLibraryStore {
    getSnapshot(): PresetLibrary;
    subscribe(listener: () => void): () => void;
    addColours(entries: readonly { readonly name: string; readonly value: string }[]): { readonly added: number; readonly library: PresetLibrary };
    addGradient(entry: { readonly name: string; readonly angle: number; readonly stops: readonly { readonly offset: number; readonly color: string }[] }): { readonly added: boolean; readonly library: PresetLibrary };
    deletePreset(kind: "colour" | "gradient", id: string): void;
    reload(): void;
  }
  export function createPresetLibrary(storage: Storage | undefined): PresetLibraryStore;
  export const presetLibrary: PresetLibraryStore;
  export const DEFAULT_COLOUR_PRESETS: readonly ColourPreset[];
  export const DEFAULT_GRADIENT_PRESETS: readonly GradientPreset[];
  export function usePresetLibrary(): PresetLibrary;
  ```

- [ ] **Step 1: Write the failing test**

`preset-library/index.test.ts` uses an in-memory `Storage` stub and asserts:
- first read (no key) returns 12 colour seeds and 15 gradient seeds; every gradient has two stops at `0` and `1`;
- the seed names are the cssgradient.io names — at least `Vital Ocean` is `angle: 0` with `#1cb5e0` and `#000851`;
- nothing is written until the first mutation;
- `addColours` normalises `rgb(16 32 48)` to `#102030`, skips an invalid value and an exact duplicate, and reports the count;
- `addGradient` accepts a valid two-stop gradient, refuses fewer than two stops, a non-finite angle, an offset outside `0–1` and an unparseable colour, and skips an exact duplicate;
- `deletePreset` removes by id and persists;
- deleting every preset writes empty arrays, and `reload()` does not resurrect the seeds;
- corrupt JSON and malformed entries fall back to the seeds without inventing entries;
- a `setItem` that throws keeps the in-memory change and leaves `getSnapshot` stable for that revision;
- `subscribe` fires on add/delete, and `getSnapshot` is referentially stable between changes.

Tests may use hex literals (this is a `.test.ts`, outside the derived DOM-test half).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/editor/src/preset-library/index.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

- `defaults.ts`: 12 colour seeds (four neutrals + eight hues) and the 15 named gradient seeds transcribed from <https://cssgradient.io/swatches/> on 2026-10-23. **Every colour value is authored as an `rgb(r g b)` string**, because this file is editor source inside the token gate's reach; a CSS `90deg` gradient persists as `angle: 0`. Ids are deterministic: `default-colour-<slug>` / `default-gradient-<slug>`.
  The fifteen gradients, in page order:
  `Vital Ocean` `#1CB5E0→#000851`, `Kale Salad` `#00C9FF→#92FE9D`, `Disco Club` `#FC466B→#3F5EFB`, `Shady Lane` `#3F2B96→#A8C0FF`, `Retro Wagon` `#FDBB2D→#22C1C3`, `Fresco Crush` `#FDBB2D→#3A1C71`, `Cucumber Water` `#e3ffe7→#d9e7ff`, `Sea Salt` `#4b6cb7→#182848`, `Par Four` `#9ebd13→#008552`, `Ooey Gooey` `#0700b8→#00ff88`, `Bloody Mimosa` `#d53369→#daae51`, `Lovely Lilly` `#efd5ff→#515ada`, `Aqua Spray` `#00d2ff→#3a47d5`, `Mello Yellow` `#f8ff00→#3ad59f`, `Dusty Cactus` `#fcff9e→#c67700`.
- `index.ts`: key `yunari.editor.presets`, payload `{ version: 1, colours, gradients }`. Read: absent key → seeds (normalised to hex); valid payload → validated entries, dropping malformed ones; unreadable or corrupt → seeds. Write failures keep the in-memory change. `reload()` re-reads and notifies; attach a `storage` listener when `window` exists.
- `addColours` normalises through `parseColor`/`formatColor`, skips unparseable values and values already present, and appends with `crypto.randomUUID()` ids.
- `addGradient` validates and normalises as the test states; duplicate key is `JSON.stringify({ angle, stops })`.
- `use-preset-library.ts`: `useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/editor/src/preset-library/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Update status and commit**

```bash
git add src/web/packages/editor/src/preset-library docs/architecture/ownership.md STATUS.md
git commit -m "feat(editor): an editor-local library for colour and gradient presets

Seeds 12 colours and the 15 cssgradient.io swatches; adds validation,
de-duplication and deletion for the asset finder to feed.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Phase 2 — The picker

### Task 4: The live/settled picker state

**Files:**
- Create: `src/web/packages/editor/src/components/ui/use-colour-picker.ts`
- Create: `src/web/packages/editor/src/components/ui/use-colour-picker.dom.test.tsx`

**Interfaces:**
- Consumes: Task 1's `parseColor`, `formatColor`, `fromHsv`, `toHsv`; Task 2's `ColourChannel`, `withChannel`.
- Produces:
  ```ts
  export interface ColourPickerApi {
    readonly hsva: Hsva;
    readonly text: string;
    readonly invalid: boolean;
    readonly eyedropper: boolean;
    setChannel(channel: ColourChannel, value: number): void; // live only
    commit(): void; // settled, latest emitted value
    commitText(input: string): void; // parse + emit live and settled, or keep the rejected text
    choosePreset(hex: string): void; // live and settled
    pickFromScreen(): Promise<void>;
    reset(): void; // Escape/close: drop the refusal and re-derive from the authored value
  }
  export function useColourPicker(options: {
    readonly value: string;
    readonly onValueChange: (next: string) => void;
    readonly onValueCommit: (next: string) => void;
  }): ColourPickerApi;
  ```

- [ ] **Step 1: Write the failing test**

`use-colour-picker.dom.test.tsx` mounts a probe that exposes the API through buttons, then asserts:
- three `setChannel` calls followed by `commit()` give `onValueChange` 3 calls and `onValueCommit` 1 call with the **last** emitted hex;
- `commitText("nope")` calls neither callback and leaves `invalid === true` with `text === "nope"` — the rejected text survives, because it is the field's `value`;
- `commitText("rgb(16 32 48)")` calls both with `"#102030"` and clears `invalid`;
- `choosePreset("rgb(0 255 0)")` calls both once with `"#00ff00"`;
- rerendering with `value="rgb(16 32 48)"` shows `text === "#102030"`;
- `reset()` after a refusal restores the authored value's text and clears `invalid`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/editor/src/components/ui/use-colour-picker.dom.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Keep a `latest` ref holding the last emitted hex so `commit()` cannot read a stale state closure. `text` is hook state and is what the field renders; `commitText` writes the rejected input back to `text` and sets `invalid`, which is how the refused draft survives `ControlText` clearing its own internal draft. When `value` changes from outside, re-derive `text` and `hsva` unless `invalid` is set (a refusal stays until corrected or `reset()`). `eyedropper` is `typeof window !== "undefined" && "EyeDropper" in window`; declare the API shape locally rather than relying on the DOM lib. `pickFromScreen` opens it and treats a rejection as a cancel.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/editor/src/components/ui/use-colour-picker.dom.test.tsx`
Expected: PASS.

- [ ] **Step 5: Update status and commit**

```bash
git add src/web/packages/editor/src/components/ui/use-colour-picker.ts \
  src/web/packages/editor/src/components/ui/use-colour-picker.dom.test.tsx STATUS.md
git commit -m "feat(editor): one live/settled state owner for the colour picker

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 5: The picker surface and its preset row

**Files:**
- Rewrite: `src/web/packages/editor/src/components/ui/colour-picker.tsx`
- Rewrite: `src/web/packages/editor/src/components/ui/colour-picker.dom.test.tsx`
- Create: `src/web/packages/editor/src/components/ui/preset-context-menu.tsx`
- Create: `src/web/packages/editor/src/components/ui/preset-context-menu.dom.test.tsx`
- Modify: `src/web/packages/editor/src/ui-copy.ts`
- Modify: `src/web/packages/editor/src/editor-shell/icons.ts`
- Modify: `src/web/packages/editor/src/components/ui/gradient-editor.tsx` (only its `parseColour` import, so the tree builds until Task 8)
- Modify: `src/web/packages/editor/src/ui-copy-surfaces.test.ts` (the `ColourPicker` mount's props)
- Delete: `src/web/packages/editor/src/components/ui/colour-maths.ts`
- Delete: `src/web/packages/editor/src/components/ui/colour-picker.test.ts`
- Modify: any other test importing `colour-maths` (`rg -l "colour-maths" src/web`)

**Interfaces:**
- Consumes: Task 3's `usePresetLibrary`, `presetLibrary.deletePreset`; Task 4's `useColourPicker`; `ControlText`, `ControlChoiceRow`, `ControlIconButton`, `ControlRow`, `ControlWell`, `useControlIds`.
- Produces:
  ```ts
  export function ColourPicker(props: {
    readonly value: string;
    readonly label: string;
    readonly onValueChange: (next: string) => void;
    readonly onValueCommit: (next: string) => void;
  }): React.JSX.Element;

  export type PresetMenuTarget = {
    readonly kind: "colour" | "gradient";
    readonly id: string;
    readonly name: string;
    readonly x: number;
    readonly y: number;
  };
  export function PresetContextMenu(props: {
    readonly target: PresetMenuTarget | undefined;
    readonly onClose: () => void;
    readonly onDelete: (target: PresetMenuTarget) => void;
  }): React.JSX.Element;
  ```
  Test ids: `picker-trigger`, `colour-picker`, `picker-area`, `picker-hue`, `picker-alpha`, `picker-hex`, `picker-preset-<id>`, `picker-eyedropper`, `preset-menu-delete`.

- [ ] **Step 1: Write the failing tests**

In `colour-picker.dom.test.tsx` (jsdom; keep the existing `:modal`/`:popover-open` shim). jsdom has no `PointerEvent` and no `setPointerCapture`, and `getBoundingClientRect` returns zeros: stub `Element.prototype.setPointerCapture`/`releasePointerCapture`, stub the area's `getBoundingClientRect`, and dispatch `MouseEvent` with `type: "pointerdown" | "pointermove" | "pointerup"` and `clientX`/`clientY`.
- the trigger is a button inside §5's well, carries the `label`, and opens the popup;
- the area is `role="slider"` with `aria-valuemin="0"`, `aria-valuemax="100"`, and an `aria-valuetext` containing “Saturation”, “brightness” and the hex;
- `pointerdown` + three `pointermove` + `pointerup` on the area calls `onValueChange` more than once and `onValueCommit` exactly once (Review Focus 2);
- `ArrowRight` on the area changes the value and commits once; `Home`/`End` reach the ends;
- hue and alpha are sliders with the same keyboard model;
- typing `rgb(16 32 48)` into `picker-hex` and pressing Enter emits `#102030` once live and once settled;
- typing `nope` keeps the text, sets `aria-invalid="true"`, and emits nothing;
- the preset group is a labelled `radiogroup` over the library's colours; choosing a preset emits one settled value;
- a colour added with `presetLibrary.addColours([...])` appears in the open row; a right-click on a preset row opens the menu and its one row removes it; `Shift+F10` opens the same menu; Delete on a focused preset removes it (Review Focus 3);
- with no `EyeDropper` in jsdom, `picker-eyedropper` is absent;
- Escape closes the popup and returns focus to the trigger.

`preset-context-menu.dom.test.tsx`: the menu renders one destructive “Delete preset” row when given a target, calls `onDelete` with the target, and renders nothing without a target.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/editor/src/components/ui/colour-picker.dom.test.tsx packages/editor/src/components/ui/preset-context-menu.dom.test.tsx`
Expected: FAIL against the old four-track surface.

- [ ] **Step 3: Implement the surface**

- The trigger renders `ControlRow` + `ControlWell` with a full-size transparent button (the well is the focus treatment). Inside: a swatch span and the authored value in mono.
- Popup: a 2-D area, hue and alpha `ChannelTrack`s over a token checkerboard, a `ControlText` named “Value” carrying `data-yunari-palette-color`, a labelled `RadioGroup` of `ControlChoiceRow`s over `usePresetLibrary().colours`, and an eyedropper `ControlIconButton` when supported.
- Pointer handlers call `setChannel` on move and `commit()` on pointer-up or pointer-cancel. Keyboard handlers call `setChannel` then `commit()` per press.
- Paint the focus boundary with `outline outline-2 outline-accent`; no raw hex, no Tailwind neutral palette. The hue strip uses `hsl()` stops; the checkerboard uses theme tokens.
- Preset rows are wrapped in a `<span onContextMenu onKeyDown>`: right-click opens `PresetContextMenu` at the pointer; `Shift+F10`/ContextMenu opens it at the row's rect; Delete removes immediately. An empty library renders no row.
- `preset-context-menu.tsx` follows `editor-shell/canvas-context-menu.tsx`'s controlled pattern (no `ContextMenu.Trigger`): a zero-sized anchor at `x`/`y`, one `ContextMenu.Item` in `--hot` reading `uiCopy.panels.presetDelete`.
- Add `PIPETTE_GLYPH` (`Pipette` from `lucide-react`) to `icons.ts`, exported beside the other glyphs.
- Add copy keys to `uiCopy.panels`: `pickerArea`, `pickerPresets`, `pickerEyedropper`, `pickerValueField`, `presetDelete`. Reuse `colourUnpaintable(value)` for the refusal.
- In `gradient-editor.tsx`, swap `import { parseColour } from "./colour-maths.js"` and its use for `parseColor` from `@yunari/renderer-core`.
- Delete `colour-maths.ts` and `colour-picker.test.ts`; their cases now live in Task 1's `color.test.ts`.
- Update `ui-copy-surfaces.test.ts`'s `createElement(ColourPicker, …)` to the new `onValueChange`/`onValueCommit` props.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run packages/editor/src/components/ui/colour-picker.dom.test.tsx packages/editor/src/components/ui/preset-context-menu.dom.test.tsx packages/editor/src/ui-copy-surfaces.test.ts packages/editor/src/ui-copy-panels.test.ts packages/editor/src/accessible-names.dom.test.ts`
Expected: PASS. Then `npm run typecheck -w @yunari/editor`.
Expected: exit 0.

- [ ] **Step 5: Update status and commit**

```bash
git add src/web/packages/editor/src/components/ui/colour-picker.tsx \
  src/web/packages/editor/src/components/ui/colour-picker.dom.test.tsx \
  src/web/packages/editor/src/components/ui/preset-context-menu.tsx \
  src/web/packages/editor/src/components/ui/preset-context-menu.dom.test.tsx \
  src/web/packages/editor/src/components/ui/colour-maths.ts \
  src/web/packages/editor/src/components/ui/colour-picker.test.ts \
  src/web/packages/editor/src/components/ui/gradient-editor.tsx \
  src/web/packages/editor/src/ui-copy.ts src/web/packages/editor/src/editor-shell/icons.ts \
  src/web/packages/editor/src/ui-copy-surfaces.test.ts STATUS.md
git commit -m "feat(editor): a popover picker with an area, channels, presets and eyedropper

Presets come from the editor-local library and delete by right-click or
Delete.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 6: One trigger per colour in the Tokens pane

**Files:**
- Modify: `src/web/packages/editor/src/panes/tokens/paint-list.tsx`
- Modify: `src/web/packages/editor/src/panes/tokens/paint-list.dom.test.tsx`
- Modify: `src/web/packages/editor/src/palette-manager/panel.ts`
- Modify: `src/web/packages/editor/src/palette-manager/panel.dom.test.ts` (it types into the pane field)
- Modify: `src/web/packages/editor/src/react-root-disposal.dom.test.ts` if its trigger assertions move
- Modify: `src/web/packages/editor/src/editor-session.ts`

**Interfaces:**
- Consumes: Task 5's `ColourPicker`.
- Produces:
  - `PaintListProps` gains `readonly onSettled?: (() => void) | undefined;` (the `| undefined` is required by `exactOptionalPropertyTypes` when the pane forwards its own optional prop)
  - `PalettePanelOptions` gains `readonly onSettled?: (() => void) | undefined;`
  - `EditorSession` passes `onSettled: () => options.shell.editor.historyManager.saveState()`.

- [ ] **Step 1: Write the failing tests**

In `paint-list.dom.test.tsx`:
- `SolidFields` renders one trigger (`[data-yunari-palette-picker] button`) and **no** pane-level `[data-yunari-palette-color]` input;
- opening the trigger shows the popup field named by `data-yunari-palette-color`;
- committing `rgb(16 32 48)` calls `onChange` with `color: "#102030"` and calls `onSettled` once;
- a live change (three area moves without pointer-up) calls `onChange` repeatedly but `onSettled` zero times;
- `not-a-colour` leaves the popup field editable with `aria-invalid="true"` and calls neither;
- switching tokens rebuilds the trigger (the existing key rule);
- the authored `rgb(...)` token is shown as `#102030` in the trigger and the field (Review Focus 1).

Add a local `commitColour(host, value)` helper: click the trigger, fill `[data-yunari-palette-color]`, press Enter.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/editor/src/panes/tokens/paint-list.dom.test.tsx`
Expected: FAIL — the old field and swatch are still rendered.

- [ ] **Step 3: Implement**

- Delete `SolidFields`'s `error` state, `CSS.supports` gate and the separate `[data-yunari-palette-picker]` wrapper.
- Render exactly:
  ```tsx
  <ColourPicker
    label={uiCopy.panels.colour}
    value={value.color}
    onValueChange={put}
    onValueCommit={(color) => { put(color); onSettled?.(); }}
  />
  ```
- Thread `onSettled` through `TokensPane` → `PaintList` → `TokenFields` → `SolidFields` only. Gradient editing gains its settled boundary in Task 8, when the editor reports one; wiring it now would save once per drag sample.
- `createPalettePanel` forwards `options.onSettled` into `TokensPane`; `EditorSession` supplies `saveState`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run packages/editor/src/panes/tokens/paint-list.dom.test.tsx packages/editor/src/palette-manager`
Expected: PASS.

- [ ] **Step 5: Update status and commit**

```bash
git add src/web/packages/editor/src/panes/tokens/paint-list.tsx \
  src/web/packages/editor/src/panes/tokens/paint-list.dom.test.tsx \
  src/web/packages/editor/src/palette-manager/panel.ts \
  src/web/packages/editor/src/palette-manager/panel.dom.test.ts \
  src/web/packages/editor/src/editor-session.ts STATUS.md
git commit -m "feat(editor): one trigger and one field for a palette colour

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Phase 3 — Gradients, undo, docs and proof

### Task 7: Palette edits enter undo once per settled change

**Files:**
- Modify: `src/web/packages/editor/src/history-manager/index.ts`
- Modify: `src/web/packages/editor/src/history-manager/index.test.ts`
- Modify: `src/web/packages/editor/src/history-manager/index.dom.test.ts`
- Modify: `src/web/packages/editor/src/editor-interaction.ts`
- Modify: `src/web/packages/editor/src/editor-document.ts`
- Modify: tests that stub `historyManager` (run `rg -n "historyManager: \\{ saveState" src/web` and add the new member)

**Interfaces:**
- Consumes: `FabricGlobals` from `@yunari/renderer-core`.
- Produces:
  ```ts
  export interface HistoryGlobalsPort {
    readonly read: () => FabricGlobals | undefined;
    readonly write: (globals: FabricGlobals | undefined) => void;
  }
  // EditorHistory gains:
  attachGlobals(port: HistoryGlobalsPort): void;
  // EditorInteraction["historyManager"] gains the same member.
  ```
  An entry is `{ scene: SerialisedScene; globals: FabricGlobals | undefined }`.

- [ ] **Step 1: Write the failing tests**

In `history-manager/index.test.ts`:
- a save that changes only globals records an entry;
- `undo()` writes the previous globals through the port after reviving the scene;
- `attachGlobals` after `reset()` patches the current entry, so an undo to index 0 restores the palette present at attach rather than deleting it;
- two saves with identical scene and globals record one entry.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/editor/src/history-manager`
Expected: FAIL — `attachGlobals` is not a function.

- [ ] **Step 3: Implement**

- Entries become `{ scene, globals }`; compare both with `JSON.stringify`.
- `reset()` and `save()` read globals through the port when attached.
- `#restore` revives the scene, then calls `port.write(entry.globals)`.
- `attachGlobals(port)` stores the port and rewrites `#entries[#index] = { ...entry, globals: port.read() }` without firing a commit event.
- `EditorDocument`'s constructor calls:
  ```ts
  this.#shell.editor.historyManager.attachGlobals({
    read: () => this.#envelope.globals,
    write: (globals) => this.#restoreGlobals(globals),
  });
  ```
  `#restoreGlobals` writes the envelope, calls `#globalsChanged()`, and re-renders the palette consumer; it must not call `historyManager.saveState()`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run packages/editor/src/history-manager packages/editor/src/editor-document.dom.test.ts`
Expected: PASS. Then `npm run typecheck -w @yunari/editor`.
Expected: exit 0 — update every `historyManager` stub the typecheck names.

- [ ] **Step 5: Update status and commit**

```bash
git add src/web/packages/editor/src/history-manager/index.ts \
  src/web/packages/editor/src/history-manager/index.test.ts \
  src/web/packages/editor/src/history-manager/index.dom.test.ts \
  src/web/packages/editor/src/editor-interaction.ts \
  src/web/packages/editor/src/editor-document.ts STATUS.md
git commit -m "feat(editor): undo carries the palette with the scene

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 8: The gradient track and its preset row

**Files:**
- Rewrite: `src/web/packages/editor/src/components/ui/gradient-editor.tsx`
- Rewrite: `src/web/packages/editor/src/components/ui/gradient-editor.dom.test.tsx`
- Modify: `src/web/packages/editor/src/panes/tokens/paint-list.tsx`
- Modify: `src/web/packages/editor/src/panes/tokens/paint-list.dom.test.tsx`

**Interfaces:**
- Consumes: `gradientCss` (Task 2), `ColourPicker` (Task 5), `usePresetLibrary` (Task 3), `ControlNumber`, `ControlIconButton`, `colorAt` from `@yunari/renderer-core`.
- Produces:
  ```ts
  export function GradientEditor(props: {
    readonly stops: readonly { readonly offset: number; readonly color: string }[];
    readonly angle: number;
    readonly label: string;
    readonly onChange: (next: { stops: { offset: number; color: string }[]; angle: number }) => void;
    readonly onCommit?: (() => void) | undefined; // optional so the pane can pass its own optional `onSettled`
  }): React.JSX.Element;
  ```
  Test ids: `gradient-track`, `gradient-stop-<index>`, `gradient-add`, `gradient-remove`, `gradient-offset`, `gradient-angle`, `gradient-preset-<id>`.

- [ ] **Step 1: Write the failing tests**

In `gradient-editor.dom.test.tsx` (apply the same jsdom pointer/capture/rect stubs as Task 5):
- the track paints `gradientCss(stops, angle)`;
- each stop is a `role="slider"` with `aria-valuemin="0"`, `aria-valuemax="100"`, `aria-valuenow` and `aria-valuetext` naming the colour;
- clicking a stop selects it; the selected stop is the one the offset well edits;
- `ArrowRight` moves 1%, `Shift+ArrowRight` 10%, `Home`/`End` reach 0/100, and each press calls `onChange` then `onCommit` once;
- dragging a stop emits several `onChange` calls and exactly one `onCommit` at pointer-up;
- a click on empty track adds a stop at that offset with `colorAt`'s colour, selects it, and commits;
- the add and remove icon buttons follow the same rules; remove refuses below two stops;
- two stops at `0.5` render two marks with distinct testids and the same `aria-valuenow` (Review Focus 4);
- the offset well and the angle well commit once each;
- the stop keeps §4's `--edge` ring (the existing case stays green);
- Delete removes the selected stop, never leaving fewer than two;
- the gradient preset row draws the library's gradients; choosing one applies its angle and stops with one `onChange` and one `onCommit`;
- a gradient added with `presetLibrary.addGradient(...)` appears in the row; right-click/`Shift+F10` opens the menu and Delete removes it (Review Focus 3);
- an empty gradient library draws no row.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/editor/src/components/ui/gradient-editor.dom.test.tsx`
Expected: FAIL against the old preview + per-stop list.

- [ ] **Step 3: Implement**

- One component-local `selected` index, clamped when `stops` changes.
- One track element owns the pointer geometry; stop marks are absolutely positioned `role="slider"` divs with pointer capture. `pointerup`/`pointercancel` calls `onCommit`.
- Clicking the track outside a mark inserts a stop using `colorAt(stops, offset)`; the add button does the same at the midpoint between the selected stop and the next.
- One `ColourPicker` edits the selected stop's colour (`label` names the stop); its `onValueCommit` forwards to `onCommit`.
- One `ControlNumber` (`unit="%"`, `min={0}`, `max={100}`) edits the selected offset; one `ControlNumber` (`unit="deg"`) edits the angle.
- A labelled `RadioGroup` of `ControlChoiceRow`s reads `usePresetLibrary().gradients`; each swatch is `gradientCss(preset.stops, preset.angle)`; choosing applies `{ stops: [...], angle }` then `onCommit()`. Rows use the same context-menu/Delete wrapper as the colour presets.
- Delete the old preview div and the per-stop picker row. Remove `data-testid="gradient-preview"` if nothing reads it (`rg "gradient-preview" src/web`).
- In `paint-list.tsx`, delete the standalone angle row and the per-stop `ControlSlider` rows; pass `angle` and `onCommit={onSettled}` to `GradientEditor`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run packages/editor/src/components/ui/gradient-editor.dom.test.tsx packages/editor/src/panes/tokens/paint-list.dom.test.tsx`
Expected: PASS.

- [ ] **Step 5: Update status and commit**

```bash
git add src/web/packages/editor/src/components/ui/gradient-editor.tsx \
  src/web/packages/editor/src/components/ui/gradient-editor.dom.test.tsx \
  src/web/packages/editor/src/panes/tokens/paint-list.tsx \
  src/web/packages/editor/src/panes/tokens/paint-list.dom.test.tsx STATUS.md
git commit -m "feat(editor): the gradient track is the preview, the manipulator and a preset row

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 9: DESIGN.md §5 and the token gate

**Files:**
- Modify: `DESIGN.md` (§5 table + notes)
- Modify: `scripts/design-tokens.gated.json`
- Verify: `src/web/packages/editor/src/components/ui/colour-picker.tsx`,
  `src/web/packages/editor/src/components/ui/gradient-editor.tsx`

- [ ] **Step 1: Add the two §5 members**

In the §5 control table, add exactly two rows:
- **2-D colour area** — a `--panel-2` well at `--radius-md` carrying a saturation × brightness plane; a pointer picks both channels, the keyboard moves one at a time, and focus paints §4's boundary role.
- **Gradient track** — the value's own gradient painted across a `--panel-2` well at `--radius-md`, with stop marks at `--stage` ringed by `--edge`; it is both the preview and the manipulator.

Add a short paragraph under the table: sizes follow §3's panel rhythm; both channels are `role="slider"`; the keyboard is arrows 1, Shift/Page 10, Home/End, Escape closes and returns focus; the focus boundary must measure ≥3:1 in all six palettes.

- [ ] **Step 2: Join the gate**

Add to `design-tokens.gated.json`'s `gated` array:
`src/web/packages/editor/src/components/ui/colour-picker.tsx`,
`src/web/packages/editor/src/components/ui/gradient-editor.tsx`.
The `.dom.test.tsx` halves are derived; do not list them.

- [ ] **Step 3: Run the gate**

Run: `npm run design:check` from `src/web/`
Expected: exit 0. If a hex or off-scale px fires, replace the literal with a token or an `hsl()` content colour — never widen the allowlist or add a path exclusion.

Run: `npm run gates:self-test`
Expected: exit 0.

- [ ] **Step 4: Update status and commit**

```bash
git add DESIGN.md scripts/design-tokens.gated.json STATUS.md
git commit -m "docs(design): name the colour area and the gradient track in section 5

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 10: Browser proof and visual evidence

**Files:**
- Modify: `src/web/tests/e2e/editor.spec.ts`
- Modify: `src/web/tests/e2e/keyboard.spec.ts`
- Modify: `src/web/tests/e2e/rebuild-driver.ts`
- Modify: `src/web/tests/e2e/author-journey-rebuild.spec.ts`,
  `src/web/tests/e2e/rebuild-composition.ts` if they type into the old field
- Create: `src/web/tests/e2e/colour-picker.spec.ts`
- Modify: `docs/evidence/screenshots/README.md`

- [ ] **Step 1: Teach the drivers the new field**

- `rebuild-driver.ts`: `addColour` opens the trigger (`[data-yunari-palette-picker] button`), fills `[data-yunari-palette-color]`, presses Enter.
- `editor.spec.ts`: the “refuses a palette colour” and “edits an artboard palette token” cases open the picker first; the stored value expectation is now the hex form (`rgb(16 32 48)` → `#102030`).
- `keyboard.spec.ts`: the trigger is still `picker-trigger`; its anchor assertion now measures the pane well rather than a 28px swatch. Keep the alpha-selector assertions.

- [ ] **Step 2: Write the failing browser spec**

`colour-picker.spec.ts` (desktop-chromium; skip on phone with `isDesktopSurface`):
1. **One undo entry per drag** (Review Focus 5): open Tokens, choose `background`, open the picker, drag across the area, save the envelope, press Ctrl+Z, save again — the palette value is the pre-drag value, and a second Ctrl+Z does not rewind one pre-drag step per pointer sample.
2. **Gradient drag and number agree** (Review Focus 4): switch to gradient, drag the first stop, read `gradient-offset`, type a different percentage, and assert the saved stops match the number; add a stop by clicking the track and assert the envelope gains exactly one.
3. **Gradient presets apply**: the row shows the 15 seeded gradients; choosing `Vital Ocean` saves `{ angle: 0, stops: [#1cb5e0 at 0, #000851 at 1] }`.
4. **Preset deletion persists**: right-click a colour preset, choose Delete preset, reload the page, and assert it is still gone while the other seeds remain.
5. **Focus boundary in six palettes**: loop `shellPalettes`, set the palette, focus `picker-area`, and assert the computed focus outline colour against the track's adjacent colour is ≥3:1. Use a local contrast helper written from the WCAG formula.
6. **`picks a palette colour`**: open Tokens, open the picker on `background`, commit a picked colour, and capture `editor-colour-picker` with the popover open.
7. **`builds a gradient`**: switch the token to a gradient, apply a preset, then capture `editor-gradient-editor` with the track and its preset row visible.
Both call `captureVisualReview(page, testInfo, name)` (Review Focus: evidence is a real render, not an object count).

- [ ] **Step 3: Run the browser spec**

Run: `npm run build` then
`npx playwright test --project=desktop-chromium --grep "colour picker|gradient track|focus boundary|preset" --workers=1`
Expected: PASS. If a port is held, another run owns it — stop and wait rather than changing the port.

- [ ] **Step 4: Capture and register the evidence**

Run (after the build):
`YUNARI_CAPTURE=1 npx playwright test --project=desktop-chromium --grep "picks a palette colour|builds a gradient" --workers=1`
Expected: two PNGs in `docs/evidence/screenshots/`; inspect both images before staging.

Add two rows to the Editor visual-action checklist:
`| Palette | Open the colour picker and commit a picked colour | editor-colour-picker / picks a palette colour in the picker |`
`| Palette | Edit a gradient stop by drag and by number | editor-gradient-editor / builds a gradient with a drag and a number |`
No “beside a drawing” copy is added — no drawing covers these surfaces.

- [ ] **Step 5: Run the full gate**

Run: `npm run gate`
Expected: exit 0. Read the exit code from the process, not from a piped tail.

- [ ] **Step 6: Update status and commit**

```bash
git add src/web/tests/e2e/editor.spec.ts src/web/tests/e2e/keyboard.spec.ts \
  src/web/tests/e2e/rebuild-driver.ts src/web/tests/e2e/author-journey-rebuild.spec.ts \
  src/web/tests/e2e/rebuild-composition.ts src/web/tests/e2e/colour-picker.spec.ts \
  docs/evidence/screenshots/README.md docs/evidence/screenshots/editor-colour-picker-desktop-chromium.png \
  docs/evidence/screenshots/editor-gradient-editor-desktop-chromium.png STATUS.md
git commit -m "test(editor): prove the picker's commit boundary, presets and the gradient track

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Close the register rows**

The work commit's sha is now known. Edit `docs/product/backlog.jsonl` **by line** — never round-trip the file through a JSON parser, because a row holding a `§` escape would be rewritten. Set:
- `vg-405` → `state:"verified"`, `check` naming “picker” and the Playwright case that proves it, `artefacts` the Step 6 sha.
- `vg-439` → `state:"verified"`, `check` naming “parser” and the `color.test.ts` case that proves one parser, `artefacts` the Task 1 sha.

Move both rows to `docs/product/backlog-archive.jsonl` per the two-file rule, then commit:
```bash
git add docs/product/backlog.jsonl docs/product/backlog-archive.jsonl STATUS.md
git commit -m "docs(backlog): close the colour rebuild's verdict and the second parser

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
Then archive this plan to `docs/superpowers/plans/archive/` and update `STATUS.md` to name the next plan or no plan.

---

## Self-review notes (2026-10-23)

- **Spec coverage:** parser owner (T1), channel model and one gradient formula (T2), editor-local preset library with seeds/add/delete (T3), live/settled state (T4), picker surface and colour preset row (T5), one trigger + one field (T6), undo (T7), gradient track + gradient preset row (T8), §5 amendment and gate (T9), evidence (T10). Midpoints are not a task because the owner dropped them; the asset finder surface is not a task because the owner owns it in a separate spec.
- **Type consistency:** `Rgba`/`Hsva`/`parseColor`/`formatColor` are defined once in T1 and consumed by name thereafter; `ColourChannel` is T2's and used unchanged in T4/T5; `ColourPreset`/`GradientPreset`/`PresetLibraryStore` are T3's and used unchanged in T5/T8; the picker's pair is `onValueChange`/`onValueCommit`, the gradient editor's is `onChange`/`onCommit`, and `PaintList` keeps `onChange`/`onSettled`.
- **Review Focus:** every line names the task holding its test — 2 (T5, T10), 1 (T4, T6), 3 (T5, T8), 4 (T2, T8, T10), 5 (T7, T10).
- **Proportion:** signatures and assertions only; implementations are named, not transcribed.
