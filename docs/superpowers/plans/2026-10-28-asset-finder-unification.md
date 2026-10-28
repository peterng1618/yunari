# Asset Finder Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every asset-finder tab one frame, one card, one selection model, one loading vocabulary and one paging behaviour, and let every tab browse on open.

**Architecture:** `AssetFinder` keeps the state (per-tab query, accumulated pages, selection, action lifecycle) and renders one `FinderFrame`; tab differences are filters, a card preview, an optional detail column and an action list. `Fonts` and `Wallpaper Engine` stop owning their own search bars, grids, fetch loops and card actions and become thin panes under the same frame. A pure `tab-data` module owns append/page arithmetic, and `FinderGrid` owns roving focus and the append sentinel.

**Tech Stack:** React 19, Base UI 1.9 (Dialog, Tabs, ToggleGroup), Tailwind with the shell's CSS tokens, TypeScript strict, Vitest + Playwright, the host's existing `ASSET_SOURCES` registry.

**Spec:** `docs/superpowers/specs/2026-10-28-asset-finder-unification-design.md`

## Global Constraints

- No new dependency; no package-manifest change; `THIRD-PARTY-NOTICES.md` untouched.
- `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` stay on; invalid numeric input is refused, never coerced.
- Files: 500 lines is a signal, 800 is a stop for normal source; split before crossing.
- One owner per concept: finder presentation lives under `asset-finder/`; `components/ui/` is imported, never edited.
- Copy lives in `uiCopy.assets`; no string literals in components. English only, one sentence per state.
- Every interactive element has rest, hover, focus, selected/disabled, busy and outcome states. No `rounded-full` pill buttons in the finder, no `<select>`, no new button or skeleton shape.
- The finder window is centred in the viewport; only its content region scrolls.
- Infinite scroll is the default paging mechanism. Any explicit paging control lives in the footer status slot with the same shape.
- Browser tests preview built bundles: run `npm run build -w @yunari/editor` before Playwright after a source change.
- Phase boundaries run `npm run gate` and must exit 0. A red gate is reported with its exit code, never summarised as green.
- Commits are Conventional Commit titles; stage explicit paths; never `git add -A`.
- Screenshot capture needs `YUNARI_CAPTURE=1` and `--workers=1`, and only registered actions.

## Review Focus

These are the behaviours the spec implies but no happy path exercises. Each has a test in the task that owns the code.

1. **A keyed source fails while another answers** — the grid keeps the survivor's rows, the footer names the failure, and the Connections button appears. Task 2.3.
2. **The same result arrives on two pages** — append dedupes by `<source>:<id>` rather than drawing it twice. Task 2.1.
3. **A source cannot browse an empty term** (`[]` with no failure) — the grid shows the empty state without reading as a failed search. Task 3.2.
4. **Rapid typing or tab switching while answers are in flight** — a late answer for an abandoned question never lands, and never lands in another tab. Task 2.3.
5. **A short viewport (phone)** — the window degrades to full-viewport and the footer's actions stay reachable. Task 1.1.

---

## Phase 1 — The frame

### Task 1.1: Centre the window and show the selected tab

**Files:**
- Modify: `src/web/packages/editor/src/editor-shell/editor-shell.css` (the `.editor-shell-dialog--finder` block)
- Modify: `src/web/packages/editor/src/asset-finder/modal.tsx`
- Test: `src/web/tests/e2e/asset-finder.spec.ts`

**Interfaces:**
- Consumes: Base UI `Tabs.Tab` emits `data-active` (verified in `@base-ui/react/tabs/tab/TabsTabDataAttributes`).
- Produces: the finder window's geometry every later task relies on; no TypeScript surface.

- [ ] **Step 1: Replace the chrome-visibility browser test with a centring and selected-tab test**

Delete `test("the finder leaves the header, the rail and the status bar in view")`. Add:

```ts
test("the finder is centred and the chosen tab is drawn as chosen", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  await stubAssets(page, {
    sources: [lucide],
    answer: () => ({ pages: [answered("lucide", [result("lucide:house")])] }),
  });
  const dialog = await openFinder(page);
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error("no viewport.");
  const box = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(2);
  expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThanOrEqual(2);
  expect(box.width).toBeCloseTo(Math.min(1180, viewport.width - 48), 0);
  expect(box.height).toBeCloseTo(Math.min(800, viewport.height - 48), 0);

  const chosen = page.locator('[data-yunari-asset-tab="icon"]');
  const other = page.locator('[data-yunari-asset-tab="colour"]');
  const chosenPaint = await chosen.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      underline: style.borderBottomColor,
      text: style.color,
    };
  });
  const otherPaint = await other.evaluate((element) =>
    getComputedStyle(element).backgroundColor,
  );
  expect(chosenPaint.background).not.toBe(otherPaint);
  expect(chosenPaint.underline).not.toBe("rgba(0, 0, 0, 0)");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run build -w @yunari/editor && npx playwright test tests/e2e/asset-finder.spec.ts -g "centred" --project=desktop-chromium --workers=1`
Expected: FAIL on the centring comparisons and on the tab background/underline.

- [ ] **Step 3: Rewrite the finder window rule**

In `editor-shell.css`, replace the `top/right/bottom/left` anchoring with:

```css
.editor-shell-dialog--finder {
  top: 50%;
  left: 50%;
  right: auto;
  bottom: auto;
  width: min(1180px, calc(100vw - 2 * var(--space-24)));
  height: min(800px, calc(100vh - 2 * var(--space-24)));
  max-width: none;
  max-height: none;
  transform: translate(-50%, -50%);
  padding: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
@media (max-width: 720px) {
  .editor-shell-dialog--finder {
    width: 100vw;
    height: 100vh;
    border-radius: 0;
  }
}
```

Keep the close-button rule that follows it.

- [ ] **Step 4: Fix the tab's selected styling**

In `modal.tsx`, change the `Tabs.Tab` class from
`data-[selected]:bg-[var(--panel-2)] data-[selected]:text-text` to:

```
border-b-2 border-transparent px-[var(--space-12)] py-[var(--space-8)] text-sm text-muted
hover:text-text data-[active]:border-accent data-[active]:bg-[var(--panel-2)]
data-[active]:text-text
```

- [ ] **Step 5: Rebuild and rerun the test**

Run: `npm run build -w @yunari/editor && npx playwright test tests/e2e/asset-finder.spec.ts -g "centred" --project=desktop-chromium --workers=1`
Expected: PASS.

- [ ] **Step 6: Prove the short viewport degrades to the full window**

Add a test that runs on the phone project:

```ts
test("a phone viewport gives the finder the whole window", async ({ page }, testInfo) => {
  test.skip(isDesktopSurface(testInfo), "the phone project owns this reading");
  await stubAssets(page, { sources: [lucide], answer: () => ({ pages: [answered("lucide", [result("lucide:house")])] }) });
  const dialog = await openFinder(page);
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  if (box === null || viewport === null) throw new Error("no box.");
  expect(box.width).toBe(viewport.width);
  expect(box.height).toBe(viewport.height);
  await expect(page.locator("[data-yunari-asset-actions]")).toBeVisible();
});
```

Run: `npx playwright test tests/e2e/asset-finder.spec.ts -g "phone viewport" --project=phone-chromium --workers=1`
Expected: FAIL before the media query, PASS after. If the phone project cannot open the editor at all, delete this test and record why in the commit — do not weaken the desktop centring test.

- [ ] **Step 7: Commit**

```bash
git add src/web/packages/editor/src/editor-shell/editor-shell.css \
  src/web/packages/editor/src/asset-finder/modal.tsx \
  src/web/tests/e2e/asset-finder.spec.ts
git commit -m "fix(asset-finder): centre the window and show the selected tab"
```

---

### Task 1.2: One card with per-kind previews

**Files:**
- Create: `src/web/packages/editor/src/asset-finder/finder-card.tsx`
- Create: `src/web/packages/editor/src/asset-finder/finder-card.dom.test.tsx`
- Delete: `src/web/packages/editor/src/asset-finder/row.tsx`
- Modify: `src/web/packages/editor/src/asset-finder/modal.tsx`

**Interfaces:**
- Produces:
  ```ts
  export interface FinderCardModel {
    readonly id: string;
    readonly name: string;
    readonly meta: string;
    readonly licence: string | undefined;
    readonly sourceId: string;
    readonly sourceLabel: string;
    readonly preview: React.ReactNode;
    readonly previewable: boolean;
  }
  export function cardModelOf(result: AssetResult, sourceLabel: string): FinderCardModel;
  export function FinderCard(props: {
    readonly model: FinderCardModel;
    readonly selected: boolean;
    readonly busy: boolean;
    readonly failed: boolean;
    readonly done: boolean;
    readonly tabStop: boolean;
    readonly focus: (node: HTMLButtonElement | null) => void;
    readonly onSelect: () => void;
    readonly onPreview?: () => void;
    readonly onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  }): React.JSX.Element;
  ```
- `cardModelOf` sets `previewable: result.kind === "image"` and builds `preview` from `result.preset`, `result.kind` and `result.font`. Font previews use `faceStyle`, `leadCutOf`, `useSpecimens` and `ROLES` from `font-preview-panel.tsx`.

- [ ] **Step 1: Write the failing DOM tests**

`finder-card.dom.test.tsx`:

```tsx
it("draws a palette as vertical flex bars in catalogue order", () => {
  const model = cardModelOf(paletteResult, "ColorSwoop");
  render(<FinderCard model={model} selected={false} busy={false} failed={false} done={false}
    tabStop onSelect={() => {}} onKeyDown={() => {}} focus={() => {}} />);
  const bars = document.querySelectorAll("[data-yunari-swatch]");
  expect(bars).toHaveLength(4);
  expect([...bars].map((bar) => (bar as HTMLElement).style.background))
    .toEqual(["rgb(17, 34, 51)", "rgb(68, 85, 102)", "rgb(119, 136, 153)", "rgb(170, 187, 204)"]);
  expect(bars[0]?.parentElement?.className).toContain("flex");
});

it("crops an image and marks the card selected", () => {
  const model = cardModelOf(imageResult, "Unsplash");
  render(<FinderCard model={model} selected busy={false} failed={false} done={false}
    tabStop onSelect={() => {}} onPreview={() => {}} onKeyDown={() => {}} focus={() => {}} />);
  const image = document.querySelector("img");
  expect(image?.className).toContain("object-cover");
  expect(image?.getAttribute("loading")).toBe("lazy");
  expect(document.querySelector('[data-yunari-asset-card-check]')).not.toBeNull();
  expect(document.querySelector("[data-yunari-asset-card]")?.getAttribute("aria-selected")).toBe("true");
});

it("shows busy and failed marks without stealing the press", () => {
  const model = cardModelOf(iconResult, "Lucide");
  render(<FinderCard model={model} selected={false} busy failed={false} done={false}
    tabStop onSelect={() => {}} onKeyDown={() => {}} focus={() => {}} />);
  expect(document.querySelector('[data-yunari-asset-card-busy]')).not.toBeNull();
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run packages/editor/src/asset-finder/finder-card.dom.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `finder-card.tsx`**

Card anatomy: `<button type="button" role="option" aria-selected={selected} tabIndex={tabStop ? 0 : -1} data-yunari-asset-card={model.id} className="group flex min-w-0 flex-col gap-[var(--space-4)] rounded-[var(--radius-md)] border bg-[var(--panel-2)] p-[var(--space-8)] text-left hover:border-muted ...">`.

- Preview well: `aspect-[4/3] w-full overflow-hidden rounded-[var(--radius-sm)] bg-[var(--bg)]`.
- Palette preview: `<span className="flex h-full w-full">` with `preset.colours.slice(0, 6)` as `<span className="min-w-0 flex-1" style={{background: colour}} data-yunari-swatch />`.
- Gradient preview: full-bleed `cssArtboardPaint`.
- Image: `<img className="h-full w-full object-cover" loading="lazy" decoding="async" alt="" />`.
- Icon: the existing 48×48 mask (`h-14 w-14 bg-current text-text`).
- Font: a component using `useSpecimens` with the trio's ordered cuts (20/15/12px) or the family's lead cut at 16px.
- Selected: accent border + `ring-1 ring-accent` + accent tint + `<span data-yunari-asset-card-check>` holding `CHECK_GLYPH` at 12px in the preview's top-right corner.
- Busy: preview gets `opacity-50` and a `LoaderCircle` spinner (`animate-spin`) centred; `data-yunari-asset-card-busy`.
- Failed: `TriangleAlert` in `--hot` in the preview's top-left; `data-yunari-asset-card-failed`.
- Done: a 12px `CHECK_GLYPH` in `--accent` beside the name; `data-yunari-asset-card-done`.
- Double-click: `onDoubleClick={() => { if (model.previewable) props.onPreview?.(); }}`.
- Title row: name + `SourceMark`; meta row: `model.meta` and `model.licence` in `--text-xs text-faint`.

- [ ] **Step 4: Wire the card into the existing grid**

In `modal.tsx`, replace `AssetRow` with `FinderCard`:
```tsx
<FinderCard
  model={cardModelOf(result, sourceLabel)}
  selected={...}
  busy={false}
  failed={false}
  tabStop
  focus={() => {}}
  onSelect={() => setSelected({ page, result })}
  onPreview={result.kind === "image" ? () => setPreview(...) : undefined}
  onKeyDown={() => {}}
/>
```
The preview state and modal land in Task 4.2; for now `onPreview` may be omitted and the `FinderCard` still compiles.

- [ ] **Step 5: Delete `row.tsx` and run the tests**

```bash
git rm src/web/packages/editor/src/asset-finder/row.tsx
npx vitest run packages/editor/src/asset-finder/finder-card.dom.test.tsx packages/editor/src/asset-finder/modal.dom.test.tsx
```
Expected: the card tests PASS; any modal test that reads `data-yunari-asset-row` is updated to `data-yunari-asset-card` in this step.

Also add to the DOM suite:

```tsx
it("does not open a preview for a kind with no picture to enlarge", () => {
  const onPreview = vi.fn();
  render(<FinderCard model={cardModelOf(iconResult, "Lucide")} selected={false}
    busy={false} failed={false} done={false} tabStop onSelect={() => {}} onPreview={onPreview}
    onKeyDown={() => {}} focus={() => {}} />);
  fireEvent.doubleClick(document.querySelector("[data-yunari-asset-card]")!);
  expect(onPreview).not.toHaveBeenCalled();
});
```

- [ ] **Step 6: Prove the hover and selection paints in a browser**

Add:

```ts
test("a card raises its edge on hover and the chosen card is accented", async ({ page }, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  await stubAssets(page, { sources: [lucide], answer: () => ({ pages: [answered("lucide", [result("lucide:house")])] }) });
  await openFinder(page);
  const card = page.locator('[data-yunari-asset-card="lucide:house"]');
  const resting = await card.evaluate((node) => getComputedStyle(node).borderColor);
  await card.hover();
  await expect.poll(() => card.evaluate((node) => getComputedStyle(node).borderColor)).not.toBe(resting);
  await card.click();
  expect(await card.getAttribute("aria-selected")).toBe("true");
  expect(await card.evaluate((node) => getComputedStyle(node).borderColor)).not.toBe(resting);
});
```

Run: `npm run build -w @yunari/editor && npx playwright test tests/e2e/asset-finder.spec.ts -g "raises its edge" --project=desktop-chromium --workers=1`

- [ ] **Step 7: Commit**

```bash
git add src/web/packages/editor/src/asset-finder/finder-card.tsx \
  src/web/packages/editor/src/asset-finder/finder-card.dom.test.tsx \
  src/web/packages/editor/src/asset-finder/modal.tsx \
  src/web/packages/editor/src/asset-finder/modal.dom.test.tsx
git commit -m "feat(asset-finder): draw every tab's result as one card"
```

---

### Task 1.3: One skeleton and one state vocabulary

**Files:**
- Modify: `src/web/packages/editor/src/asset-finder/skeleton.tsx`
- Create: `src/web/packages/editor/src/asset-finder/finder-state.tsx`
- Modify: `src/web/packages/editor/src/asset-finder/fonts-body.tsx`
- Modify: `src/web/packages/editor/src/asset-finder/wallpaper-engine-body.tsx`
- Test: `src/web/packages/editor/src/asset-finder/skeleton.dom.test.tsx`
- Create: `src/web/packages/editor/src/asset-finder/finder-state.dom.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export function SkeletonCard(): React.JSX.Element;
  export function FinderSkeleton({ count }: { readonly count?: number }): React.JSX.Element;
  export function FinderState(props: {
    readonly message: string;
    readonly action?: { readonly label: string; readonly onClick: () => void };
  }): React.JSX.Element;
  ```
- `TextSkeleton` and `CardGridSkeleton` are deleted; every caller uses `FinderSkeleton`.

- [ ] **Step 1: Rewrite the skeleton test**

Assert: `FinderSkeleton` renders `count` cards, each with a 4:3 preview block and two line bars; the region has `aria-busy="true"` and exactly one `sr-only` `Loading assets…`; shapes carry `aria-hidden` and the region contains no focusable element.

```tsx
it("draws card-shaped placeholders and says it is loading once", () => {
  render(<FinderSkeleton count={4} />);
  expect(document.querySelectorAll("[data-yunari-skeleton-card]")).toHaveLength(4);
  expect(document.querySelectorAll("[data-yunari-skeleton-line]")).toHaveLength(8);
  expect(document.querySelector("[data-yunari-skeleton-grid]")?.getAttribute("aria-busy")).toBe("true");
  expect(screen.getAllByText(uiCopy.assets.skeletonLoading)).toHaveLength(1);
  expect(document.querySelector("[data-yunari-skeleton-grid]")?.querySelector("button, a, input")).toBeNull();
});
```

- [ ] **Step 2: Run and watch it fail** — `npx vitest run packages/editor/src/asset-finder/skeleton.dom.test.tsx`

- [ ] **Step 3: Implement the skeleton and state component**

`SkeletonCard` is the card frame with a `aspect-[4/3] animate-pulse` preview and two `h-3 animate-pulse` bars. `FinderSkeleton` renders the grid (`repeat(auto-fill, minmax(168px, 1fr))`, gap 12) plus the one `sr-only` sentence. `FinderState` renders a centred column: the message (`text-sm text-muted`) and, when given, an underlined action button (`data-yunari-asset-state-action`). Both respect `motion-reduce:animate-none`.

- [ ] **Step 4: Replace both old skeletons at their call sites**

`modal.tsx`, `fonts-body.tsx` and `wallpaper-engine-body.tsx` use `FinderSkeleton` (12 on first load, 4 appended). Delete `TextSkeleton` and `CardGridSkeleton`. Their empty/failure paragraphs remain until Tasks 2.3/3.3/4.1.

- [ ] **Step 5: Test the state component**

```tsx
it("renders a sentence and its action", () => {
  const onClick = vi.fn();
  render(<FinderState message="No results." action={{ label: "Clear search", onClick }} />);
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(onClick).toHaveBeenCalledOnce();
});
```

- [ ] **Step 6: Run the focused suites and commit**

Run: `npx vitest run packages/editor/src/asset-finder/skeleton.dom.test.tsx packages/editor/src/asset-finder/finder-state.dom.test.tsx packages/editor/src/asset-finder/modal.dom.test.tsx`

```bash
git add src/web/packages/editor/src/asset-finder/skeleton.tsx \
  src/web/packages/editor/src/asset-finder/skeleton.dom.test.tsx \
  src/web/packages/editor/src/asset-finder/finder-state.tsx \
  src/web/packages/editor/src/asset-finder/finder-state.dom.test.tsx \
  src/web/packages/editor/src/asset-finder/modal.tsx \
  src/web/packages/editor/src/asset-finder/fonts-body.tsx \
  src/web/packages/editor/src/asset-finder/wallpaper-engine-body.tsx
git commit -m "feat(asset-finder): use one card skeleton and state body"
```

---

### Task 1.4: The frame, its controls, and the Connections button

**Files:**
- Create: `src/web/packages/editor/src/asset-finder/finder-frame.tsx`
- Create: `src/web/packages/editor/src/asset-finder/finder-controls.tsx`
- Create: `src/web/packages/editor/src/asset-finder/finder-frame.dom.test.tsx`
- Modify: `src/web/packages/editor/src/asset-finder/modal.tsx`
- Modify: `src/web/packages/editor/src/ui-copy.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface FinderAction {
    readonly id: string;
    readonly label: string;
    readonly busyLabel: string;
    readonly tone: "plain" | "accent";
    readonly disabled: boolean;
    readonly run: () => Promise<ActionOutcome> | ActionOutcome;
  }
  export function FinderSearch(props: {
    readonly value: string;
    readonly placeholder: string;
    readonly onChange: (value: string) => void;
  }): React.JSX.Element;
  export function FinderSegmented<T extends string>(props: {
    readonly label: string;
    readonly value: T;
    readonly options: readonly { readonly id: T; readonly label: string }[];
    readonly onChange: (id: T) => void;
  }): React.JSX.Element;
  export function FinderChip(props: {
    readonly label: string;
    readonly pressed: boolean;
    readonly failed: boolean;
    readonly disabled: boolean;
    readonly onToggle: () => void;
  }): React.JSX.Element;
  export function FinderActionButton(props: {
    readonly action: FinderAction;
    readonly busy: boolean;
    readonly onRun: () => void;
  }): React.JSX.Element;
  export function ConnectionsButton(props: {
    readonly needs: boolean;
    readonly onOpen: () => void;
  }): React.JSX.Element | null;
  export function FinderFrame(props: {
    readonly label: string;
    readonly closeLabel: string;
    readonly tabs: readonly { readonly id: ListingCategory; readonly label: string }[];
    readonly active: ListingCategory;
    readonly onTabChange: (id: ListingCategory) => void;
    readonly query: string;
    readonly searchPlaceholder: string;
    readonly onQueryChange: (value: string) => void;
    readonly filters?: React.ReactNode;
    readonly sources?: React.ReactNode;
    readonly tools?: React.ReactNode;
    readonly status: React.ReactNode;
    readonly actions: React.ReactNode;
    readonly detail?: React.ReactNode;
    readonly children: React.ReactNode;
  }): React.JSX.Element;
  ```
- `FinderFrame` owns `Dialog`, the tab rail, the toolbar row, the content region, the optional detail column and the footer. The close × is a fixed right slot in the rail.

- [ ] **Step 1: Write the frame tests**

```tsx
it("draws the four regions in order and keeps one status line", () => {
  render(<FinderFrame label="Assets" closeLabel="Close" tabs={[{ id: "icon", label: "Icons" }]}
    active="icon" onTabChange={() => {}} query="" searchPlaceholder="Search icons…"
    onQueryChange={() => {}} status="3 results" actions={<button>Place</button>}>
    <div data-testid="content" />
  </FinderFrame>);
  const frame = document.querySelector("[data-yunari-asset-frame]");
  expect(frame?.querySelector("[data-yunari-asset-tab]")).not.toBeNull();
  expect(frame?.querySelector("[data-yunari-asset-search]")).not.toBeNull();
  expect(frame?.querySelector("[data-testid=content]")).not.toBeNull();
  expect(frame?.querySelector("[data-yunari-asset-status]")?.textContent).toBe("3 results");
  expect(frame?.querySelector("[data-yunari-asset-actions]")?.textContent).toContain("Place");
});

it("shows Connections only when a keyed source is in trouble", () => {
  render(<FinderFrame ... tools={<ConnectionsButton needs={false} onOpen={() => {}} />} />);
  expect(screen.queryByRole("button", { name: "Connections" })).toBeNull();
  render(<FinderFrame ... tools={<ConnectionsButton needs onOpen={() => {}} />} />);
  expect(screen.getByRole("button", { name: "Connections" })).not.toBeNull();
});
```

The exported `ConnectionsButton({ needs, onOpen })` uses `ControlIconButton` with `CONNECTIONS_GLYPH` and a reserved 28px wrapper.

- [ ] **Step 2: Run and watch it fail** — `npx vitest run packages/editor/src/asset-finder/finder-frame.dom.test.tsx`

- [ ] **Step 3: Implement `finder-frame.tsx` and `finder-controls.tsx`**

- Frame classes: `flex min-h-0 flex-1 flex-col`; rail 48px with `border-b`; toolbar 48px with `px-4 gap-3` and `border-b`; content `min-h-0 flex-1 overflow-hidden` holding a flex row (grid scroller + detail); footer `min-h-[52px] border-t px-4 py-3 flex items-center gap-3`.
- The status line is `<p role="status" data-yunari-asset-status data-tone={...}>`; `data-tone` is `ok`, `failed` or absent (neutral). A failure takes `text-[var(--hot)]`.
- `FinderSearch`: `type="search"`, `w-[min(360px,100%)] min-w-[220px]`, `h-7 rounded-md border border-edge bg-[var(--bg)] px-2.5 text-sm`, `data-yunari-asset-search`.
- `FinderSegmented`: Base UI `ToggleGroup` with `value={[value]}`, `className="flex h-7 items-center gap-1 rounded-md border border-edge bg-panel-2 p-1"`; each `Toggle` is `rounded-sm px-2 text-xs data-[pressed]:bg-[var(--stage)] data-[pressed]:text-text text-muted hover:text-text`; `aria-label={label}` on the group.
- `FinderChip`: `aria-pressed`, `className="inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs"`; pressed → `border-accent text-accent`, unpressed → `border-edge text-muted hover:border-muted hover:text-text`, failed → a `—`? Use a 3px `--hot` dot `<span data-yunari-asset-chip-failed className="size-[3px] rounded-full bg-[var(--hot)]" />`.
- `FinderActionButton`: `ActionBox` when the action has an icon? Use `ACTION_BUTTON` (from `components/ui/dialog.tsx`) with `variant` by tone; busy renders `LoaderCircle` (12px, `animate-spin`) + `busyLabel`, both buttons disabled, and the busy button carries `data-yunari-asset-action-busy`.
- Copy additions in `uiCopy.assets`: `search: { font: "Search fonts…", icon: "Search icons…", image: "Search photos…", video: "Search videos…", colour: "Search colours…", local: "Search this PC…" }`, `searching: (n) => …`, `endOfResults: "End of results"`, `retry: "Retry"`, `preview: "Preview"`, `connections: "Connections"`, and the busy labels.

- [ ] **Step 4: Move the generic grid tabs into the frame**

In `modal.tsx`, replace the hand-built header/footer JSX with `FinderFrame`. The active tab's filters/sources/tools/status/actions are computed by the shell.

Build the tab list from the fixed order, never from `ASSET_SOURCES`:

```ts
const ORDER: readonly ListingCategory[] = ["font", "icon", "image", "video", "colour", "local"];
const categories = ORDER.filter((category) => present(category, sources, panes));
```

A category is present when a listed source names it or the editor supplies its pane (`font`, `local`). A category with no source and no pane (today: `video`) draws no tab. Any future category not in `ORDER` appends alphabetically.

A tab's sources are filtered by category **and** body: `body === (category === "font" ? "font-picker" : "grid")`; the local pane owns its listing instead. Keep the existing search/skeleton/rows behaviour; Task 2.3 replaces the data path.

- [ ] **Step 5: Run the focused suites**

Run: `npx vitest run packages/editor/src/asset-finder/finder-frame.dom.test.tsx packages/editor/src/asset-finder/modal.dom.test.tsx`

- [ ] **Step 6: Phase gate**

Run: `npm run gate > /tmp/gate-phase-1.log 2>&1; echo $?`
Expected: `0`.

- [ ] **Step 7: Commit**

```bash
git add src/web/packages/editor/src/asset-finder/finder-frame.tsx \
  src/web/packages/editor/src/asset-finder/finder-controls.tsx \
  src/web/packages/editor/src/asset-finder/finder-frame.dom.test.tsx \
  src/web/packages/editor/src/asset-finder/modal.tsx \
  src/web/packages/editor/src/asset-finder/modal.dom.test.tsx \
  src/web/packages/editor/src/ui-copy.ts
git commit -m "feat(asset-finder): give every tab one frame and control set"
```

---

## Phase 2 — Grid behaviour

### Task 2.1: Pure page accumulation

**Files:**
- Create: `src/web/packages/editor/src/asset-finder/tab-data.ts`
- Create: `src/web/packages/editor/src/asset-finder/tab-data.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface FinderRow { readonly page: AssetPage; readonly result: AssetResult }
  export interface TabData {
    readonly query: string;
    readonly rows: readonly FinderRow[];
    readonly asked: ReadonlyMap<string, number>;
    readonly totals: ReadonlyMap<string, number>;
    readonly failures: ReadonlyMap<string, AssetPage>;
  }
  export const EMPTY_TAB: TabData;
  export function resetForQuestion(query: string): TabData;
  export function nextPages(data: TabData, enabled: readonly string[]): Record<string, number>;
  export function retryPages(data: TabData, enabled: readonly string[]): Record<string, number>;
  export function hasMore(data: TabData, enabled: readonly string[]): boolean;
  export function appendAnswer(data: TabData, pages: readonly AssetPage[], asked: Readonly<Record<string, number>>): TabData;
  export function rowsOf(data: TabData, enabled: readonly string[]): readonly FinderRow[];
  ```
- `nextPages` returns `{ [id]: 1 }` for every enabled source when `asked` is empty; afterwards only `asked + 1` for sources whose `totals` is defined and greater than `asked`, and never for a failed source. `retryPages` returns `asked + 1` for failed sources.

- [ ] **Step 1: Write the failing unit tests**

```ts
it("asks page one of every enabled source, then only those with more", () => {
  expect(nextPages(EMPTY_TAB, ["a", "b"])).toEqual({ a: 1, b: 1 });
  const page1 = {
    source: "a", results: [result("a:1")], totalPages: 2, failure: undefined,
  };
  const page1b = {
    source: "b", results: [result("b:1")], totalPages: undefined, failure: undefined,
  };
  const after = appendAnswer(EMPTY_TAB, [page1, page1b], { a: 1, b: 1 });
  expect(nextPages(after, ["a", "b"])).toEqual({ a: 2 });
  expect(hasMore(after, ["a", "b"])).toBe(true);
});

it("appends without reordering and never draws an id twice", () => {
  const first = appendAnswer(EMPTY_TAB, [
    { source: "a", results: [result("a:1")], totalPages: 2, failure: undefined },
    { source: "b", results: [result("b:1")], totalPages: 2, failure: undefined },
  ], { a: 1, b: 1 });
  const second = appendAnswer(first, [
    { source: "a", results: [result("a:1"), result("a:2")], totalPages: 2, failure: undefined },
    { source: "b", results: [result("b:2")], totalPages: 2, failure: undefined },
  ], { a: 2, b: 2 });
  expect(rowsOf(second, ["a", "b"]).map((row) => row.result.id))
    .toEqual(["a:1", "b:1", "a:2", "b:2"]);
});

it("keeps rows when a page fails and retries only the failed source", () => {
  const first = appendAnswer(EMPTY_TAB, [
    { source: "a", results: [result("a:1")], totalPages: 2, failure: undefined },
  ], { a: 1 });
  const failed = appendAnswer(first, [
    { source: "a", results: [], totalPages: undefined, failure: { reason: "failed", message: "down" } },
  ], { a: 2 });
  expect(rowsOf(failed, ["a"]).map((row) => row.result.id)).toEqual(["a:1"]);
  expect(nextPages(failed, ["a"])).toEqual({});
  expect(retryPages(failed, ["a"])).toEqual({ a: 2 });
  expect(failed.failures.get("a")?.failure?.message).toBe("down");
});
```

- [ ] **Step 2: Run and watch it fail** — `npx vitest run packages/editor/src/asset-finder/tab-data.test.ts`

- [ ] **Step 3: Implement `tab-data.ts`**

Use `interleave` for page rows, a `Set` of `${page.source}:${result.id}` for dedupe, fresh `Map`s for immutability. A failed page leaves `asked`, `totals` and `rows` untouched. A successful page sets `asked[source] = asked[source]`, deletes the failure and sets/deletes the total.

- [ ] **Step 4: Run the test to verify it passes** — same command; expected PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/editor/src/asset-finder/tab-data.ts \
  src/web/packages/editor/src/asset-finder/tab-data.test.ts
git commit -m "feat(asset-finder): own page accumulation in one pure module"
```

---

### Task 2.2: One grid with roving focus and an append sentinel

**Files:**
- Create: `src/web/packages/editor/src/asset-finder/finder-grid.tsx`
- Create: `src/web/packages/editor/src/asset-finder/finder-grid.dom.test.tsx`
- Modify: `src/web/packages/editor/src/asset-finder/modal.tsx`
- Delete (after Task 3.3 migrates fonts): `src/web/packages/editor/src/asset-finder/font-grid.tsx`

**Interfaces:**
- Produces:
  ```ts
  export function moveInGrid(
    key: string, at: number, columns: number, length: number,
  ): number;
  export function FinderGrid(props: {
    readonly label: string;
    readonly cards: readonly FinderCardModel[];
    readonly selectedId: string | undefined;
    readonly busyId?: string;
    readonly failedId?: string;
    readonly doneId?: string;
    readonly onSelect: (card: FinderCardModel) => void;
    readonly onPreview: (card: FinderCardModel) => void;
    readonly onApply: (card: FinderCardModel) => void;
    readonly onNeedMore: () => void;
    readonly canLoadMore: boolean;
    readonly appending: boolean;
  }): React.JSX.Element;
  ```
- Consumes: `FinderCard`, `SkeletonCard`, `moveInGrid`.

- [ ] **Step 1: Write the failing tests**

Unit (pure): `moveInGrid("ArrowRight", 1, 4, 10) === 2`, `ArrowDown` → `+4`, `Home` → 0, `End` → 9, clamps at both ends, unknown key returns `at`.

DOM:
```tsx
it("renders one listbox, one tab stop, and appended skeleton cards", () => {
  render(<FinderGrid ... cards={cards} selectedId={undefined} canLoadMore appending={false} />);
  expect(document.querySelector("[role=listbox]")).not.toBeNull();
  expect(document.querySelectorAll("[data-yunari-asset-card][tabindex='0']")).toHaveLength(1);
  rerender(<FinderGrid ... appending />);
  expect(document.querySelectorAll("[data-yunari-skeleton-card]")).toHaveLength(4);
});

it("asks for more when the sentinel intersects", () => {
  const onNeedMore = vi.fn();
  // Stub IntersectionObserver so its callback runs on observe.
  ...
  expect(onNeedMore).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run and watch it fail** — `npx vitest run packages/editor/src/asset-finder/finder-grid.dom.test.tsx`

- [ ] **Step 3: Implement `finder-grid.tsx`**

- Scroller: `role="listbox"`, `aria-label`, `overflow-y-auto`, `data-yunari-finder-grid`.
- Inner grid: `grid gap-[var(--space-12)] grid-cols-[repeat(auto-fill,minmax(168px,1fr))] content-start`.
- Column count: `ResizeObserver` on the grid reading `getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length`, defaulting to 1 when the browser reports `none` or an empty string.
- Roving focus: one `tabIndex=0`; `onKeyDown` calls `moveInGrid`, `preventDefault`, sets `focusAt`, and focuses the target after render via a ref; `reveal` uses `element.scrollIntoView({ block: "nearest" })`.
- Enter → `onApply(card)`; double-click → `onPreview(card)` when `card.previewable`.
- Sentinel: a `div` after the cards; effect with `root: scroller`, `rootMargin: "400px"`, `threshold: 0`; only when `canLoadMore`; calls `onNeedMore`.
- Appending: renders `<SkeletonCard />` × 4 inside the grid.

- [ ] **Step 4: Move the generic grid tabs onto it**

In `modal.tsx`, replace the hand-rolled grid with `FinderGrid`; wire `onNeedMore` to a no-op for now (Task 2.3 provides it).

- [ ] **Step 5: Run the focused suites** — `npx vitest run packages/editor/src/asset-finder/finder-grid.dom.test.tsx packages/editor/src/asset-finder/modal.dom.test.tsx`

- [ ] **Step 6: Commit**

```bash
git add src/web/packages/editor/src/asset-finder/finder-grid.tsx \
  src/web/packages/editor/src/asset-finder/finder-grid.dom.test.tsx \
  src/web/packages/editor/src/asset-finder/modal.tsx \
  src/web/packages/editor/src/asset-finder/modal.dom.test.tsx
git commit -m "feat(asset-finder): one grid with roving focus and append-on-scroll"
```

---

### Task 2.3: Browse on open, append, and delete the pager

**Files:**
- Modify: `src/web/packages/editor/src/asset-finder/modal.tsx`
- Modify: `src/web/packages/editor/src/asset-finder/modal.dom.test.tsx`
- Modify: `src/web/tests/e2e/asset-finder.spec.ts`
- Modify: `src/web/packages/editor/src/ui-copy.ts`

**Interfaces:**
- Consumes: `TabData`, `nextPages`, `retryPages`, `appendAnswer`, `rowsOf`, `FinderGrid`, `FinderState`.
- Produces: the per-tab state shape every later pane uses:
  ```ts
  interface TabView {
    readonly data: TabData;
    readonly browsed: boolean;
    readonly loading: "first" | "more" | undefined;
    readonly selection: FinderRow | undefined;
    readonly message: { readonly text: string; readonly tone: "ok" | "failed" } | undefined;
  }
  ```
  State lives as `Readonly<Record<ListingCategory, TabView>>`; a ticket per category is a `useRef<Map<ListingCategory, number>>`.

- [ ] **Step 1: Replace the pager browser test with an append test**

```ts
test("scrolling to the end appends the next page and no pager exists", async ({ page }, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  const { searches } = await stubAssets(page, {
    sources: [lucide],
    answer: (request) => {
      const pageNo = request.pages["lucide"] ?? 1;
      return { pages: [answered("lucide",
        Array.from({ length: 20 }, (_, at) => result(`lucide:${pageNo}-${at}`)), 3)] };
    },
  });
  const dialog = await openFinder(page);
  await expect.poll(() => rowIds(page)).toHaveLength(20);
  await expect(dialog.locator("[data-yunari-asset-pager]")).toHaveCount(0);
  await dialog.locator("[data-yunari-finder-grid]").evaluate((node) => { node.scrollTop = node.scrollHeight; });
  await expect.poll(() => rowIds(page)).toHaveLength(40);
  expect(searches.at(-1)?.pages).toEqual({ lucide: 2 });
});
```

Also add:
```ts
test("a keyed source's failure names itself and offers Connections while the other source answers", ...)
```
— one icon source fails `needs-credential`, one answers; assert the survivor's row, the footer sentence, the failing source's chip carrying `[data-yunari-asset-chip-failed]`, and the toolbar Connections button; then assert switching to a tab with no keyed source hides the button.

- [ ] **Step 2: Run and watch them fail**

Run: `npm run build -w @yunari/editor && npx playwright test tests/e2e/asset-finder.spec.ts -g "appends|keyed source" --project=desktop-chromium --workers=1`
Expected: FAIL — the pager still exists; no append.

- [ ] **Step 3: Rewrite the shell's data path**

In `modal.tsx`:

- Replace `answer`, `page`, `total`, `failures`, `searching`, `selected` with the per-tab `TabView` record.
- On open and on first activation of a tab where `browsed` is false: call `ask(category, query)` with `pages` = `nextPages(EMPTY_TAB, enabled)`.
- On query change (debounced 200ms per tab) or filter/source toggle: `resetForQuestion(query)`, selection undefined, ticket bump, `ask(page 1)`.
- `ask`: sets `loading: "first"`, POSTs `searchAssets({ query, enabled, pages, body: category === "font" ? "font-picker" : "grid" })`; on resolve, if the ticket still matches, `appendAnswer`, `loading: undefined`, `browsed: true`.
- `loadMore`: if `loading === undefined` and `hasMore`, sets `loading: "more"`, asks `nextPages(data, enabled)`, appends.
- `retry`: asks `retryPages`, clearing the relevant failure on success.
- Rows = `rowsOf(data, enabled)` → `cardModelOf`.
- Status priority exactly: action message → `searching(n)` while loading → failure/credential sentence (with Retry or Open Connections) → `results(count, sources)` → `endOfResults` when `!hasMore`.
- Empty/error states use `FinderState`: no rows for a non-empty query → no-results + Clear search (`data-yunari-asset-empty`); no rows for an empty query → nothing-to-browse (`data-yunari-asset-nothing`); every source off → sources-off (`data-yunari-asset-kind-off`); every source failed → all-failed + Retry (`data-yunari-asset-failed`); host unavailable → its own sentence (`data-yunari-asset-host-failure`).
- Delete `FinderPager`, `pageNumbers`, `totalPagesOf` and the finder's `revalidate`. `store-mode/pager.ts` stays for the store.

- [ ] **Step 4: Add the late-answer, action-state and status-priority tests**

Browser:

```ts
test("a late answer never lands in the tab that was left", async ({ page }) => {
  // Source answers "a" after 900ms; switch to another tab and back to "a" with "ab".
  // Assert the grid shows `lucide:newer` and never `lucide:older`.
});
```
Assert after 1200ms that `rowIds` contains only the newer id.

```ts
test("an action reaches busy and then its outcome", async ({ page }) => {
  // one icon row; route **/api/assets/bytes to delay 500ms then return a 1×1 SVG
  // click the card, then the footer primary
  const primary = page.locator("[data-yunari-asset-action]");
  await primary.click();
  await expect(primary).toHaveAttribute("data-yunari-asset-action-busy", "");
  await expect(primary).toContainText("Placing…");
  await expect(page.locator("[data-yunari-asset-status]")).toHaveAttribute("data-tone", "ok");
});
```

Add the failure arm: the same test routes `/api/assets/bytes` to a 500 and asserts the status line's `data-tone="failed"` and the source's message; the primary returns to enabled.

```ts
test("a pending search says it is searching before it counts results", async ({ page }) => {
  // route the answer behind a 400ms delay
  // assert [data-yunari-asset-status] contains "Searching" while in flight,
  // then becomes the result count
});
```

- [ ] **Step 5: Run the focused tests**

Run: `npm run build -w @yunari/editor && npx playwright test tests/e2e/asset-finder.spec.ts --project=desktop-chromium --workers=1`
Expected: PASS (captures may be skipped unless `YUNARI_CAPTURE=1`).

- [ ] **Step 6: Phase gate**

Run: `npm run gate > /tmp/gate-phase-2.log 2>&1; echo $?`
Expected: `0`.

- [ ] **Step 7: Commit**

```bash
git add src/web/packages/editor/src/asset-finder/modal.tsx \
  src/web/packages/editor/src/asset-finder/modal.dom.test.tsx \
  src/web/packages/editor/src/asset-finder/finder-grid.tsx \
  src/web/packages/editor/src/ui-copy.ts \
  src/web/tests/e2e/asset-finder.spec.ts
git commit -m "feat(asset-finder): browse on open and append as the author scrolls"
```

---

## Phase 3 — Sources and fonts

### Task 3.1: Unsplash's Editorial feed for an empty term

**Files:**
- Modify: `src/web/packages/host/src/assets/images/unsplash.ts`
- Modify: `src/web/packages/host/src/assets/images/unsplash.test.ts`

**Interfaces:**
- Produces: `unsplashSource.search("")` returns the Editorial feed's page with a `totalPages` read from the `Link` header. No signature change.

- [ ] **Step 1: Write the failing host tests**

```ts
it("browses the Editorial feed when the term is empty", async () => {
  const fetcher = vi.fn(async (url: string) => {
    expect(url).toContain("/photos?page=1&per_page=30");
    return new Response(JSON.stringify([photo]), {
      headers: {
        "content-type": "application/json",
        link: '<https://api.unsplash.com/photos?page=1>; rel="first", <https://api.unsplash.com/photos?page=5>; rel="last", <https://api.unsplash.com/photos?page=2>; rel="next"',
      },
    });
  });
  const page = await unsplashSource.search("", 1, ctx(fetcher, "key"));
  expect(page.results).toHaveLength(1);
  expect(page.totalPages).toBe(5);
});

it("stops when the feed has no next link", async () => {
  // rel="last" on page 3 while page=3
  expect(page.totalPages).toBe(3);
});

it("falls back to the page length when the header is absent", async () => {
  // 30 results -> page + 1; 29 results -> page
});
```

Keep the existing search tests; add that a non-empty term still hits `search/photos`.

- [ ] **Step 2: Run and watch them fail** — `npx vitest run packages/host/src/assets/images/unsplash.test.ts`

- [ ] **Step 3: Implement the branch**

In `search`, when `query.trim() === ""`:
- Build `new URL("photos", API)`, set `page` and `per_page=30`, fetch with the same auth header.
- Parse the `Link` header: find `rel="last"` and read its `page` query parameter; else if `rel="next"` exists return `page + 1`; else use the page length (30 → page+1, fewer → page).
- Map the array through `isFree` and `resultOf` exactly as search does.
- A non-empty term keeps the current `search/photos` path.

- [ ] **Step 4: Run the test to verify it passes** — same command.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/host/src/assets/images/unsplash.ts \
  src/web/packages/host/src/assets/images/unsplash.test.ts
git commit -m "feat(host): browse Unsplash's Editorial feed on an empty term"
```

---

### Task 3.2: Prove the Images tab browses on open

**Files:**
- Modify: `src/web/tests/e2e/asset-finder.spec.ts`

**Interfaces:**
- Consumes: the shell's browse-on-open and the host's featured branch.
- Produces: no code; this task proves the behaviour end to end and is a review gate for Task 2.3.

- [ ] **Step 1: Add the browser test**

```ts
test("the Images tab draws photos on open and the credential state without a key", async ({ page }, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  await stubAssets(page, {
    sources: [unsplash],
    answer: (request) => ({
      pages: [answered("unsplash", [
        { ...result("unsplash:photo-1"), kind: "image", name: "A photo",
          preview: "https://images.example/1.jpg", subtitle: "A Photographer",
          licence: "Unsplash License", sourceUrl: "https://unsplash.com/p/1" },
      ], 4)],
    }),
  });
  const dialog = await openFinder(page);
  await dialog.locator('[data-yunari-asset-tab="image"]').click();
  await expect.poll(() => rowIds(page)).toEqual(["unsplash:photo-1"]);
  expect(await page.locator("[data-yunari-asset-search]").inputValue()).toBe("");
});
```

Add a second test where the empty-term answer is `{ reason: "needs-credential" }`: assert the footer sentence and that the toolbar Connections button is present.

Add a third test for a source that cannot browse: the empty-term answer is `[]` with `failure: undefined`. Assert the content region shows the **nothing to browse** sentence (`data-yunari-asset-nothing`) and does **not** show the no-results sentence (`data-yunari-asset-empty`).

- [ ] **Step 2: Run it**

Run: `npm run build -w @yunari/editor && npx playwright test tests/e2e/asset-finder.spec.ts -g "Images tab" --project=desktop-chromium --workers=1`
Expected: PASS if Task 2.3 is correct; a failure here is a Task 2.3 defect, not a test defect.

- [ ] **Step 3: Prove the test can fail**

Temporarily disable the browse-on-open call (guard it with `false`) and rerun; expect the first assertion to fail. Restore and rerun; expect PASS.

- [ ] **Step 4: Commit**

```bash
git add src/web/tests/e2e/asset-finder.spec.ts
git commit -m "test(asset-finder): prove the Images tab browses on open"
```

---

### Task 3.3: Fonts as a pane of the shared frame

**Files:**
- Create: `src/web/packages/editor/src/asset-finder/fonts.tsx`
- Delete: `src/web/packages/editor/src/asset-finder/fonts-body.tsx`
- Modify: `src/web/packages/editor/src/asset-finder/font-preview-panel.tsx`
- Modify: `src/web/packages/editor/src/asset-finder/font-preview-panel.dom.test.tsx`
- Modify: `src/web/packages/editor/src/editor-shell/session-facade.ts`
- Modify: `src/web/packages/editor/src/editor-session.ts`
- Modify: `src/web/packages/editor/src/editor-shell/shell-layout.tsx`
- Modify: `src/web/packages/editor/src/asset-finder/modal.tsx`
- Test: `src/web/packages/editor/src/asset-finder/fonts.dom.test.tsx`
- Modify: `src/web/tests/e2e/asset-finder.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface FontActions {
    readonly presets?: TypeTokens;
    readonly onApplyTrio: (trio: FontTrioInfo) => void;
    readonly onAddTrioPresets: (trio: FontTrioInfo) => void;
    readonly onAddPreset: (cut: FontCut, role: FontRole, family: readonly FontCut[]) => void;
    readonly onApplyToSelected?: (cut: FontCut, family: readonly FontCut[]) => void;
  }
  export interface FontFilterState {
    readonly kind: "all" | "trio" | "family";
    readonly sort: "name" | "provider";
  }
  export interface FontPreviewState {
    readonly sample: string;
    readonly cutId: string | undefined;
    readonly role: FontRole;
  }
  export function fontRows(rows: readonly FinderRow[], filter: FontFilterState): readonly FinderRow[];
  export function fontActionsOf(
    selection: FinderRow,
    filter: FontFilterState,
    preview: FontPreviewState,
    actions: FontActions | undefined,
  ): readonly FinderAction[];
  ```
- Controlled panel:
  ```ts
  export function FontPreviewPanel(props: {
    readonly selected: FontResult;
    readonly presets: TypeTokens;
    readonly state: FontPreviewState;
    readonly onChange: (next: FontPreviewState) => void;
  }): React.JSX.Element;
  ```
- Facade change:
  ```ts
  fontActions?(): FontActions;      // was fontPickerBody(): ReactNode
  wallpaperActions?(): WallpaperActions; // Task 4.1
  ```
  `AssetFinder` receives `font?: FontActions` instead of `bodies`.

- [ ] **Step 1: Write the failing filter/action unit tests**

`fonts.dom.test.tsx` can host pure tests too (`.dom` for the panel). Add:
```ts
it("keeps only trios, then sorts by name when asked", () => {
  const rows = [trioRow("Zeta"), familyRow("Alpha")];
  expect(fontRows(rows, { kind: "trio", sort: "name" }).map((row) => row.result.name))
    .toEqual(["Zeta"]);
  expect(fontRows(rows, { kind: "all", sort: "name" }).map((row) => row.result.name))
    .toEqual(["Alpha", "Zeta"]);
});

it("declares the trio's two outcomes and a family's two", () => {
  const trio = fontActionsOf(trioRow, { kind: "all", sort: "name" },
    { sample: "", cutId: undefined, role: "body" }, actions);
  expect(trio.map((action) => action.label)).toEqual(["Apply trio", "Add to presets"]);
  const family = fontActionsOf(familyRow, ...);
  expect(family.map((action) => action.label)).toEqual(["Apply to token", "Add to presets"]);
});
```

- [ ] **Step 2: Run and watch it fail** — `npx vitest run packages/editor/src/asset-finder/fonts.dom.test.tsx`

- [ ] **Step 3: Make the panel controlled**

Remove the internal `sample`/`cutId`/`role` state and the four action callbacks; read from `state` and report `onChange`. Keep the specimen, the cut list, the role segmented and the sample field. Update its tests to pass `state`/`onChange`.

- [ ] **Step 4: Implement `fonts.tsx`**

- `fontRows`: filter by trio/family, then sort by name (`localeCompare`) or leave provider order.
- `fontActionsOf`: build `FinderAction`s.
  - Trio: `apply-trio` (label "Apply trio", busy "Applying…", tone accent, run `onApplyTrio(trio)`), `add-trio` (label "Add to presets", busy "Adding…", run `onAddTrioPresets(trio)`).
  - Family: `apply-cut` (label "Apply to token", busy "Applying…", tone accent, run `onApplyToSelected?.(cut, cuts)` or `onAddPreset(cut, role, cuts)` when the former is absent), `add-cut` (label "Add to presets", busy "Adding…", run `onAddPreset`).
  - A missing callback drops that action. Actions are disabled when there is no selection.
- `FontsFilter` renders the kind and sort `FinderSegmented` controls for the toolbar.

- [ ] **Step 5: Replace the body with the pane**

- Delete `fonts-body.tsx`.
- In `modal.tsx`, the font tab uses the generic `TabData` search with `body: "font-picker"`; filters (`FontFilterState`), selection and `FontPreviewState` live in the shell's font tab state.
- Toolbar filters: `<FontsFilter filter={fontFilter} onChange={...} />`.
- Content: `FinderGrid` over `fontRows(rowsOf(data, enabled), fontFilter)`.
- Detail column: `<FontPreviewPanel selected={...} presets={fontActions?.presets ?? {}} state={fontPreview} onChange={...} />` when a font result is selected.
- Footer actions: `fontActionsOf(selection, filter, preview, fontActions)`.
- Delete `font-grid.tsx` and its test; the shared grid replaces it.

- [ ] **Step 6: Change the facade and the session**

- `session-facade.ts`: replace `fontPickerBody?(): React.ReactNode` with `fontActions?(): FontActions`.
- `editor-session.ts`: rename `#fontPickerBody` to `#fontActions`; return `{ presets, onApplyTrio, onAddTrioPresets, onAddPreset, ...(selected && { onApplyToSelected }) }`. Keep the `run` wrapper and `#declarationsChanged`.
- `shell-layout.tsx`: replace `bodies={{...}}` with `font={store.bridge?.session.fontActions?.()}`; keep `onAction` and `onOpenConnections`.

- [ ] **Step 7: Update the browser test**

The existing "font field opens the finder on Fonts" and "draws a font card's specimen rows" tests must pass with the shared card. Add:
```ts
test("the Fonts tab draws a trio grid on open", async ({ page }) => {
  // sources [curatedFonts], empty-term answer returns interTrio + fontResult
  // assert one `[data-yunari-asset-card]` per result with no typing
});
```

- [ ] **Step 8: Run the focused suites**

Run: `npm run build -w @yunari/editor && npx playwright test tests/e2e/asset-finder.spec.ts -g "Fonts|font" --project=desktop-chromium --workers=1`
Then: `npx vitest run packages/editor/src/asset-finder/fonts.dom.test.tsx packages/editor/src/asset-finder/font-preview-panel.dom.test.tsx packages/editor/src/asset-finder/modal.dom.test.tsx`

- [ ] **Step 9: Phase gate**

Run: `npm run gate > /tmp/gate-phase-3.log 2>&1; echo $?`
Expected: `0`.

- [ ] **Step 10: Commit**

```bash
git add src/web/packages/editor/src/asset-finder/fonts.tsx \
  src/web/packages/editor/src/asset-finder/fonts.dom.test.tsx \
  src/web/packages/editor/src/asset-finder/font-preview-panel.tsx \
  src/web/packages/editor/src/asset-finder/font-preview-panel.dom.test.tsx \
  src/web/packages/editor/src/asset-finder/modal.tsx \
  src/web/packages/editor/src/asset-finder/modal.dom.test.tsx \
  src/web/packages/editor/src/editor-shell/session-facade.ts \
  src/web/packages/editor/src/editor-session.ts \
  src/web/packages/editor/src/editor-shell/shell-layout.tsx \
  src/web/tests/e2e/asset-finder.spec.ts
git rm src/web/packages/editor/src/asset-finder/fonts-body.tsx \
  src/web/packages/editor/src/asset-finder/font-grid.tsx \
  src/web/packages/editor/src/asset-finder/font-grid.dom.test.tsx
git commit -m "feat(asset-finder): make Fonts a pane of the shared frame"
```

---

## Phase 4 — The rest and the rules

### Task 4.1: Wallpaper Engine as a pane of the shared frame

**Files:**
- Create: `src/web/packages/editor/src/asset-finder/wallpaper.tsx`
- Delete: `src/web/packages/editor/src/asset-finder/wallpaper-engine-body.tsx`
- Delete: `src/web/packages/editor/src/asset-finder/wallpaper-engine-body.dom.test.tsx`
- Modify: `src/web/packages/editor/src/asset-finder/wallpaper-engine-card.tsx` (or fold it into `wallpaper.tsx` and delete)
- Create: `src/web/packages/editor/src/asset-finder/wallpaper.dom.test.tsx`
- Modify: `src/web/packages/editor/src/editor-shell/session-facade.ts`
- Modify: `src/web/packages/editor/src/editor-session.ts`
- Modify: `src/web/packages/editor/src/editor-shell/shell-layout.tsx`
- Modify: `src/web/packages/editor/src/asset-finder/modal.tsx`
- Modify: `src/web/tests/e2e/asset-finder.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface WallpaperActions {
    readonly onSetBackground: (item: WallpaperEngineItem) => Promise<ImportOutcome>;
    readonly onConvert: (item: WallpaperEngineItem) => Promise<StartProjectAnswer>;
    readonly onImportPackage: (file: File, onStep: (step: VideoImportStep) => void) => Promise<ImportOutcome>;
  }
  export function wallpaperCards(items: readonly WallpaperEngineItem[]): readonly FinderCardModel[];
  export function wallpaperActionsOf(item: WallpaperEngineItem | undefined, actions: WallpaperActions): readonly FinderAction[];
  export function WallpaperTools(props: {
    readonly onImportPackage: WallpaperActions["onImportPackage"];
    readonly onStatus: (message: string) => void;
  }): React.JSX.Element;
  ```
- `wallpaperCards` sets `sourceId: "wallpaper-engine"`, `sourceLabel: "Steam"`, `meta` = kind · size, `previewable: true`, `preview` = `<img object-cover>`.
- `WallpaperTools` renders the Guide button and the `.mpkg` import as 28px icon buttons in the toolbar's tools slot and owns the two modals.

- [ ] **Step 1: Write the failing unit tests**

```ts
it("maps an item to a previewable card", () => {
  const [card] = wallpaperCards([item]);
  expect(card?.previewable).toBe(true);
  expect(card?.meta).toContain("1920×1080");
});
it("labels a video's action as the background and a scene's as the project", () => {
  expect(wallpaperActionsOf(videoItem, actions).map((action) => action.label))
    .toEqual(["Set as background"]);
  expect(wallpaperActionsOf(sceneItem, actions).map((action) => action.label))
    .toEqual(["Open in Wallpaper Engine"]);
});
```

- [ ] **Step 2: Run and watch them fail** — `npx vitest run packages/editor/src/asset-finder/wallpaper.dom.test.tsx`

- [ ] **Step 3: Implement `wallpaper.tsx`**

- Keep `fetchWallpaperEngine` and the item validation.
- `wallpaperCards` maps items through `FinderCardModel`.
- Actions run `onSetBackground` (video) or `onConvert` (scene); each reports through the shell's action lifecycle and marks the item done on success. The done state is per tab, keyed by `workshopId`.
- `WallpaperTools` keeps the existing guide modal and the file input; it calls `onStatus` with the package outcome.

- [ ] **Step 4: Change the facade and the session**

- `session-facade.ts`: replace `wallpaperEngineBody?(): React.ReactNode` with `wallpaperActions?(): WallpaperActions`.
- `editor-session.ts`: `#wallpaperActions()` returns the three callbacks (`importWallpaperItem`, `startProject`, `importPickedVideo`), as `#fontActions` does.
- `shell-layout.tsx`: pass `wallpaper={store.bridge?.session.wallpaperActions?.()}`.

- [ ] **Step 5: Wire the local tab in the shell**

- The local tab's state is a listing, not a search: `{ items, query, kind, selection, done: Set<string>, loading }`.
- Browse on first activation: `fetchWallpaperEngine(client)`; while absent, `<FinderSkeleton>`.
- Toolbar: search filters locally (same field), kind segmented (All/Videos/Scenes), tools = `<WallpaperTools ... />`.
- Content: `FinderGrid` with `wallpaperCards(shown)`; no append (all items are loaded at once).
- Footer actions: `wallpaperActionsOf(selection, wallpaper)`; status: the listing's reason (`not-installed`, `no-library`, `unsupported-platform`), the empty sentence, or the action outcome.
- Delete `wallpaper-engine-body.tsx` and its test; fold the card mapping into `wallpaper.tsx`, delete `wallpaper-engine-card.tsx` if unused.

- [ ] **Step 6: Update the browser test**

Add:
```ts
test("the Wallpaper Engine tab selects a card and runs its one action from the footer", async ({ page }) => {
  // route /api/wallpaper-engine (or the client route) to one video item
  // click the card, click the footer primary, assert the run reached the host route stub
});
```
Keep the existing guide/import coverage if it exists in the wallpaper spec; move its selectors to the new tools' data attributes (`data-yunari-wallpaper-engine-guide`, `-import-package`).

- [ ] **Step 7: Run the focused suites**

Run: `npx vitest run packages/editor/src/asset-finder/wallpaper.dom.test.tsx packages/editor/src/asset-finder/modal.dom.test.tsx`
Then: `npm run build -w @yunari/editor && npx playwright test tests/e2e/asset-finder.spec.ts -g "Wallpaper" --project=desktop-chromium --workers=1`

- [ ] **Step 8: Commit**

```bash
git add src/web/packages/editor/src/asset-finder/wallpaper.tsx \
  src/web/packages/editor/src/asset-finder/wallpaper.dom.test.tsx \
  src/web/packages/editor/src/asset-finder/modal.tsx \
  src/web/packages/editor/src/asset-finder/modal.dom.test.tsx \
  src/web/packages/editor/src/editor-shell/session-facade.ts \
  src/web/packages/editor/src/editor-session.ts \
  src/web/packages/editor/src/editor-shell/shell-layout.tsx \
  src/web/tests/e2e/asset-finder.spec.ts
git rm src/web/packages/editor/src/asset-finder/wallpaper-engine-body.tsx \
  src/web/packages/editor/src/asset-finder/wallpaper-engine-body.dom.test.tsx \
  src/web/packages/editor/src/asset-finder/wallpaper-engine-card.tsx
git commit -m "feat(asset-finder): make Wallpaper Engine a pane of the shared frame"
```

---

### Task 4.2: The media preview modal

**Files:**
- Create: `src/web/packages/editor/src/asset-finder/preview-modal.tsx`
- Create: `src/web/packages/editor/src/asset-finder/preview-modal.dom.test.tsx`
- Modify: `src/web/packages/editor/src/asset-finder/modal.tsx`
- Modify: `src/web/tests/e2e/asset-finder.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface FinderPreview {
    readonly id: string;
    readonly name: string;
    readonly meta: string;
    readonly licence: string;
    readonly sourceUrl: string;
    readonly imageUrl: string | undefined;
    readonly posterOnly: boolean;
  }
  export function FinderPreviewModal(props: {
    readonly preview: FinderPreview | undefined;
    readonly actions: readonly FinderAction[];
    readonly busyActionId: string | undefined;
    readonly message: { readonly text: string; readonly tone: "ok" | "failed" } | undefined;
    readonly onRun: (action: FinderAction) => void;
    readonly onClose: () => void;
  }): React.JSX.Element;
  ```

- [ ] **Step 1: Write the failing DOM tests**

```tsx
it("shows the picture, the licence and the same actions", () => {
  render(<FinderPreviewModal preview={preview} actions={actions}
    busyActionId={undefined} message={undefined} onRun={() => {}} onClose={() => {}} />);
  const modal = document.querySelector("[data-yunari-asset-preview-modal]");
  expect(modal).not.toBeNull();
  expect(modal?.querySelector("img")?.getAttribute("src")).toBe("https://images.example/1.jpg");
  expect(modal?.textContent).toContain("Unsplash License");
  expect(screen.getByRole("button", { name: "Set as background" })).not.toBeNull();
});

it("closes on Escape before the finder", () => {
  const onClose = vi.fn();
  render(...);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run and watch it fail** — `npx vitest run packages/editor/src/asset-finder/preview-modal.dom.test.tsx`

- [ ] **Step 3: Implement the modal**

Use `Dialog` with `className="editor-shell-dialog--asset-preview"`, `label={preview.name}`, `closeLabel={uiCopy.assets.close}`, `closeIcon`. Stage: `img` `object-contain` on `--asset-preview-stage`, or a `<video controls muted loop>` when a playable URL exists (no source does yet; `posterOnly` draws the poster and the sentence). Panel: name, `meta`, licence, source URL, the actions rendered with `FinderActionButton`, and the message. No write on open.

- [ ] **Step 4: Wire the double-click and the footer Preview button**

- The shell keeps `preview: FinderPreview | undefined` per tab; a double-click on a previewable card sets it; `Escape`/close clears it.
- The footer's Preview icon button (`PREVIEW_GLYPH`, 28px, `data-yunari-asset-preview-open`) is drawn only for a previewable selection and sets the same state.
- The modal's `actions` are the tab's current actions; `onRun` goes through the same lifecycle as the footer.

- [ ] **Step 5: Add the browser test**

```ts
test("double-clicking a photo opens the preview and Escape returns to the grid", async ({ page }) => {
  // Images fixture with one photo; double-click the card; assert the modal and the image;
  // press Escape; assert the finder is still visible and the card has focus.
  // Then select the card again and press [data-yunari-asset-preview-open];
  // assert the same modal opens — the keyboard route to the double-click.
});
```

- [ ] **Step 6: Run the focused suites**

Run: `npx vitest run packages/editor/src/asset-finder/preview-modal.dom.test.tsx packages/editor/src/asset-finder/modal.dom.test.tsx`
Then: `npm run build -w @yunari/editor && npx playwright test tests/e2e/asset-finder.spec.ts -g "double-clicking" --project=desktop-chromium --workers=1`

- [ ] **Step 7: Commit**

```bash
git add src/web/packages/editor/src/asset-finder/preview-modal.tsx \
  src/web/packages/editor/src/asset-finder/preview-modal.dom.test.tsx \
  src/web/packages/editor/src/asset-finder/modal.tsx \
  src/web/packages/editor/src/asset-finder/modal.dom.test.tsx \
  src/web/packages/editor/src/editor-shell/icons.ts \
  src/web/tests/e2e/asset-finder.spec.ts
git commit -m "feat(asset-finder): preview a media result without leaving the finder"
```

---

### Task 4.3: Conformance rules, proof, and close-out

**Files:**
- Modify: `DESIGN.md` (new §5 subsection)
- Modify: `STATUS.md`
- Modify: `docs/superpowers/specs/2026-10-28-asset-finder-unification-design.md` (status line)
- Modify: `src/web/tests/e2e/asset-finder.spec.ts` (red proofs, final selectors)

**Interfaces:**
- Consumes: every earlier task.
- Produces: the durable rules and the completion record.

- [ ] **Step 1: Add the DESIGN.md rules**

Add a §5 subsection, **Asset finder tabs**, with these rules in the house's voice:

1. One frame: tab rail → toolbar → content → footer. A tab adds filters, a card preview, a detail column and actions; it never adds a region or moves the search field.
2. Search is always the toolbar's first control; the field's width is bounded (220–360px) and its placeholder names the tab.
3. Every tab browses on open. A source that cannot answer an empty term says why; a blank tab is a defect.
4. One card anatomy: 4:3 preview well, name + source mark, meta + licence. The preview renderer is the only permitted variation.
5. Every control defines rest, hover, focus, selected/disabled, busy and outcome. Hover raises `--edge` to `--muted`; nothing moves.
6. One animated card skeleton for every wait; appended pages add skeleton cards rather than replacing rows.
7. Infinite scroll is the default. If a source requires explicit paging, the control lives in the footer's status slot with the same shape.
8. Empty, error and credential states live in the content region; outcomes live in the footer's one `role="status"` line.
9. Selection is single; the card shows an accent border, a ring and a check; actions live in the footer; a new question clears the selection.
10. Tab order is fixed (Fonts, Icons, Images, Videos, Colours, Wallpaper Engine); a new category appends.
11. Double-click opens the preview for media; the footer's Preview button is the keyboard route.
12. Finder controls come from `finder-controls.tsx`; no new pill, button, chip, pager or skeleton styles.

Run `npm run design:md` and fix any citation/lint failure.

- [ ] **Step 2: Red-proof the four claims that could pass for the wrong reason**

For each, disable the fix, run its test, see it fail, restore:

1. `data-active` → change it back to `data-[selected]`; the selected-tab browser test must fail.
2. Browse-on-open → guard the first call with `false`; the Images/Fonts open tests must fail.
3. Append → make `onNeedMore` a no-op; the scroll test must fail.
4. Connections condition → render it unconditionally; the absent-when-healthy test must fail.

Record each command and its failing assertion in the commit body.

- [ ] **Step 3: Full browser proof**

Run: `npm run build -w @yunari/editor && npx playwright test tests/e2e/asset-finder.spec.ts --project=desktop-chromium --workers=1`
Expected: all non-skipped tests pass; report the count.

- [ ] **Step 4: Full gate**

Run: `npm run gate > /tmp/gate-final.log 2>&1; echo $?`
Expected: `0`. Report the exit code and the unit-suite totals from the log.

- [ ] **Step 5: Replace STATUS.md's objective and last-completed bullets**

- Current objective: the finder overhaul is complete; next is `vg-773`'s rest-of-app audit.
- Active work: name this plan as complete; none in flight.
- Last completed change: 1–5 bullets covering the frame, browse/append, the Editorial feed, the panes, the preview and the proof.
- Next: `vg-773`; then the queued colour picker rebuild and backlog drain.
- Keep the bullet caps (6/5/5/5) and one line per bullet; run `npm run status:check`.

- [ ] **Step 6: Mark the spec implemented**

Change its status line to `Status: implemented. Plan: [2026-10-28-asset-finder-unification.md](../plans/2026-10-28-asset-finder-unification.md).` Run `npm run docs:check`.

- [ ] **Step 7: Commit**

```bash
git add DESIGN.md STATUS.md \
  docs/superpowers/specs/2026-10-28-asset-finder-unification-design.md \
  src/web/tests/e2e/asset-finder.spec.ts
git commit -m "docs(asset-finder): state the tab rules and close the overhaul"
```

---

## Self-Review

- **Spec coverage:** window/tab (1.1), card (1.2), skeleton/state (1.3), frame/toolbar/footer/Connections/tab order (1.4), page arithmetic (2.1), grid/sentinel (2.2), browse/append/retry/status/actions (2.3), Unsplash feed (3.1), Images on open and cannot-browse (3.2), Fonts (3.3), Wallpaper Engine (4.1), preview modal and its keyboard route (4.2), DESIGN.md/STATUS/spec close (4.3).
- **Type consistency:** `FinderCardModel` (1.2), `FinderAction` and `ConnectionsButton` (1.4), `FinderRow`/`TabData` (2.1), `FinderPreview` (4.2), `FontActions` (3.3), `WallpaperActions` (4.1) are each defined once and referenced by later tasks. `ActionOutcome` stays in `actions.ts`. `done` is a card prop from 1.2 and a grid id from 2.2.
- **Review Focus:** failure-beside-survivor and Connections visibility (2.3), duplicate pages (2.1), cannot-browse empty term (3.2), late answers/cross-tab (2.3), short viewport (1.1). Beyond the five: hover/selected paint and non-previewable double-click (1.2), action busy/outcome and status priority (2.3), the Preview button as the keyboard route (4.2).
- **Tab absence:** 1.4's fixed order plus presence rule means `video` draws no tab today; 2.3's category list keeps that rule after the state rewrite.
- **Proportion:** the plan names interfaces, tests and exact values; it does not transcribe component bodies.
