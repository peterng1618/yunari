# Background Media Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switching the shown background asset preserves each asset's own pan, zoom, flips, bounds, composition and fallback frame across switches and across reopen.

**Architecture:** One editor switch seam, `EditorDocument.setBackgroundAsset`, owns capture and restore against an in-memory per-asset map. The map is written beside `theme.json` as `background-media.json` inside the theme store's existing staging folder at save time, read on open, and never enters the envelope or the exported package.

**Tech Stack:** TypeScript, Vitest, Fabric envelope in `@yunari/renderer-core`, host theme store in `@yunari/host`.

**Spec:** `docs/superpowers/specs/2026-11-05-background-media-memory-design.md`

## Global Constraints

- Run every command from `src/web/`.
- Node `>=22`; CI pins 24.
- No new runtime dependency, so `THIRD-PARTY-NOTICES.md` does not change.
- The persisted envelope and schema `2.0.0` do not change. No migration, no compatibility fold.
- A missing, corrupt or oversized sidecar reads as empty working data; it never fails the theme open.
- `renderer-core` stays Fabric- and DOM-free. The memory module lives in the editor package.
- Tests run offline. The final gate is `npm run gate` and must exit 0.
- Comments state current invariants, never ticket history.

## Review Focus

- A hand-edited sidecar with wrong types or out-of-range numbers must read as empty for that asset, never as broken geometry. Tested in Task 1 and Task 4.
- An unseen asset must start at `bounds: "theme"` rather than inheriting the previous asset's box. Tested in Task 2.
- Advanced → Simple → (switch away and back) → Advanced must return the composition. Tested in Task 2.
- A save from a client with no memory (MCP, install) must preserve the stored sidecar; an editor save after pruning must drop only pruned ids. Tested in Task 4.
- A save that fails after staging must leave the previous folder and sidecar intact. Tested in Task 4.

---

### Task 1: Per-asset memory module

**Files:**
- Create: `src/web/packages/editor/src/background-media-memory.ts`
- Test: `src/web/packages/editor/src/background-media-memory.test.ts`

**Interfaces:**
- Consumes: `BackgroundMedia`, `BackgroundMediaComposition`, `BackgroundMediaBounds`, `BackgroundMode`, `BACKGROUND_ANCHORS`, `BACKGROUND_MEDIA_BOUNDS`, `MIN_BACKGROUND_OFFSET`, `MAX_BACKGROUND_OFFSET`, `MIN_BACKGROUND_SCALE`, `MAX_BACKGROUND_SCALE`, `MIN_BACKGROUND_EXTENT`, `MAX_BACKGROUND_EXTENT`, `MIN_BACKGROUND_FADE`, `MAX_BACKGROUND_FADE`, `AssetKind` from `@yunari/renderer-core`.
- Produces:
  - `interface BackgroundMediaMemoryEntry { bounds: BackgroundMediaBounds; offsetX?: number; offsetY?: number; scale?: number; flipX?: boolean; flipY?: boolean; composition?: BackgroundMediaComposition; fallbackFrame?: number }`
  - `type BackgroundMediaMemory = Readonly<Record<string, BackgroundMediaMemoryEntry>>`
  - `const BACKGROUND_MEDIA_MEMORY_VERSION = 1`
  - `const MAX_BACKGROUND_MEDIA_BYTES = 256 * 1024`
  - `readBackgroundMediaMemory(value: unknown): BackgroundMediaMemory`
  - `encodeBackgroundMedia(memory: BackgroundMediaMemory): { version: 1; media: BackgroundMediaMemory }`
  - `rememberBackgroundMedia(memory: BackgroundMediaMemory, media: BackgroundMedia | undefined, mode: BackgroundMode): BackgroundMediaMemory`
  - `restoreBackgroundMedia(entry: BackgroundMediaMemoryEntry | undefined, assetId: string, kind: AssetKind, mode: BackgroundMode): BackgroundMedia`
  - `filterBackgroundMedia(memory: BackgroundMediaMemory, keep: ReadonlySet<string>): BackgroundMediaMemory`

- [ ] **Step 1: Write the failing tests**

```ts
// background-media-memory.test.ts
describe("readBackgroundMediaMemory", () => {
  it("reads an absent sidecar as empty", () => {
    expect(readBackgroundMediaMemory(undefined)).toEqual({});
  });
  it("drops the file when the version or media member is wrong", () => {
    expect(readBackgroundMediaMemory({ version: 2, media: {} })).toEqual({});
    expect(readBackgroundMediaMemory({ version: 1, media: [] })).toEqual({});
  });
  it("drops one entry whose field is outside the schema bounds", () => {
    expect(
      readBackgroundMediaMemory({
        version: 1,
        media: {
          bad: { bounds: "theme", offsetX: 9 },
          good: { bounds: "display", scale: 2 },
        },
      }),
    ).toEqual({ good: { bounds: "display", scale: 2 } });
  });
});

describe("rememberBackgroundMedia", () => {
  it("captures every field except the asset id", () => {
    const media: BackgroundMedia = {
      assetId: "a",
      bounds: "display",
      offsetX: 0.25,
      scale: 2,
      flipX: true,
      fallbackFrame: 42,
      composition: { anchor: "left", extent: 0.4 },
    };
    expect(rememberBackgroundMedia({}, media, "advanced")).toEqual({
      a: {
        bounds: "display",
        offsetX: 0.25,
        scale: 2,
        flipX: true,
        fallbackFrame: 42,
        composition: { anchor: "left", extent: 0.4 },
      },
    });
  });
  it("keeps the hidden composition while simple", () => {
    const memory = { a: { bounds: "theme", composition: { anchor: "left" } } };
    const next = rememberBackgroundMedia(
      memory,
      { assetId: "a", bounds: "theme", scale: 2 },
      "simple",
    );
    expect(next.a).toEqual({
      bounds: "theme",
      scale: 2,
      composition: { anchor: "left" },
    });
  });
});
```

Also assert: restore omits composition in `simple`, restores it in `advanced`, restores `fallbackFrame` only for `kind === "video"`, an unseen asset becomes `{ assetId, bounds: "theme" }`, `filterBackgroundMedia` drops keys outside `keep`, and `encodeBackgroundMedia({})` is `{ version: 1, media: {} }`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/editor/src/background-media-memory.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

`readBackgroundMediaMemory` accepts only `{ version: 1, media: object }`; each entry needs a valid `bounds` (`BACKGROUND_MEDIA_BOUNDS`), every other present field must validate against its exported bound or list, and an invalid entry is dropped whole. Optional fields are omitted, never stored `undefined`, for `exactOptionalPropertyTypes`.

`rememberBackgroundMedia` spreads `media` without `assetId`; in `simple` it re-attaches the previous entry's `composition` instead of the current absence. In `advanced` the current presence or absence wins, so clearing the composition sticks.

`restoreBackgroundMedia` returns `{ ...entry, assetId }` with `bounds` defaulting to `"theme"`, adds `composition` only in `advanced`, and adds `fallbackFrame` only for a video.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/editor/src/background-media-memory.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/editor/src/background-media-memory.ts src/web/packages/editor/src/background-media-memory.test.ts
git commit -m "feat(editor): add per-asset background media memory"
```

---

### Task 2: Document owns capture, restore, mode and prune

**Files:**
- Modify: `src/web/packages/editor/src/editor-document.ts`
- Test: `src/web/packages/editor/src/editor-document.test.ts`

**Interfaces:**
- Consumes: everything Task 1 produces.
- Produces:
  - `EditorDocumentSource.backgroundMedia?: BackgroundMediaMemory`
  - `EditorDocument.setBackgroundAsset(assetId: string | undefined): void`
  - `EditorDocument.setBackgroundMode(mode: BackgroundMode): void`
  - `EditorDocument.#outputCopy()` return gains `readonly backgroundMedia: BackgroundMediaMemory`

- [ ] **Step 1: Write the failing tests**

Add to `editor-document.test.ts`, extending its `documentWith` helper with a `backgroundMedia` option and an `assets` fixture that declares two image ids and one video id:

```ts
it("restores each asset's own geometry after a round trip", () => {
  document.setBackgroundAsset("a");
  document.setBackground({
    ...document.envelope.background,
    media: { assetId: "a", bounds: "display", offsetX: 0.2, scale: 3 },
  });
  document.setBackgroundAsset("b");
  expect(document.envelope.background?.media).toEqual({
    assetId: "b",
    bounds: "theme",
  });
  document.setBackgroundAsset("a");
  expect(document.envelope.background?.media).toEqual({
    assetId: "a",
    bounds: "display",
    offsetX: 0.2,
    scale: 3,
  });
});

it("keeps a composition while simple and restores it in advanced", () => {
  document.setBackgroundMode("advanced");
  document.setBackgroundAsset("a");
  document.setBackground({
    ...document.envelope.background,
    mode: "advanced",
    media: { assetId: "a", bounds: "theme", composition: { anchor: "left" } },
  });
  document.setBackgroundMode("simple");
  document.setBackgroundAsset("b");
  document.setBackgroundAsset("a");
  expect(document.envelope.background?.media?.composition).toBeUndefined();
  document.setBackgroundMode("advanced");
  expect(document.envelope.background?.media?.composition).toEqual({
    anchor: "left",
  });
});

it("restores a fallback frame only for a video", () => {
  document.setBackgroundAsset("video");
  document.setBackground({
    ...document.envelope.background,
    media: { assetId: "video", bounds: "theme", fallbackFrame: 42 },
  });
  document.setBackgroundAsset("a");
  document.setBackgroundAsset("video");
  expect(document.envelope.background?.media?.fallbackFrame).toBe(42);
  document.setBackgroundAsset("a");
  expect(document.envelope.background?.media?.fallbackFrame).toBeUndefined();
});
```

Also test: construction captures the opened document's current media and ignores an undeclared stale entry; `setBackgroundAsset("missing")` writes nothing; `setBackground(undefined)` captures before removing; `pruneAssets(["a"])` forgets `a`'s entry (switch to `b` and back is impossible once undeclared, so assert via the save output in Task 5).

Add to the existing package-export test: the exported `theme.json` and manifest contain no `backgroundMedia` member, because the package is built from the envelope and declared bytes only.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/editor/src/editor-document.test.ts`
Expected: FAIL — `setBackgroundAsset` is not a function.

- [ ] **Step 3: Implement on `EditorDocument`**

Add `#backgroundMedia: BackgroundMediaMemory`, initialized in the constructor after `#assets`:

```ts
this.#backgroundMedia = filterBackgroundMedia(
  rememberBackgroundMedia(
    source.backgroundMedia ?? {},
    this.#envelope.background?.media,
    modeOf(this.#envelope.background),
  ),
  new Set(this.#assets.declarations.map((asset) => asset.id)),
);
```

`setBackground` captures before writing:

```ts
this.#backgroundMedia = rememberBackgroundMedia(
  this.#backgroundMedia,
  this.#envelope.background?.media,
  modeOf(this.#envelope.background),
);
```

`setBackgroundAsset(assetId)`:
- `undefined`: remove `media` from the background through `setBackground`, which captures it.
- unknown id: return without writing.
- otherwise `this.setBackground({ ...background, media: restoreBackgroundMedia(this.#backgroundMedia[assetId], assetId, declared.kind, mode) })`.

`setBackgroundMode(mode)` mirrors the removed field cases: simple strips `mode` and `media.composition`; advanced writes `mode: "advanced"` and re-attaches the remembered composition when the entry has one. It writes only through `setBackground`.

`pruneAssets` reassigns `#backgroundMedia` through `filterBackgroundMedia` over the remaining declarations.

`#outputCopy` computes `declared` first, then returns `backgroundMedia: filterBackgroundMedia(this.#backgroundMedia, new Set(declared.map((asset) => asset.id)))`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/editor/src/editor-document.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/editor/src/editor-document.ts src/web/packages/editor/src/editor-document.test.ts
git commit -m "feat(editor): switch background assets through one document seam"
```

---

### Task 3: Every surface uses the switch seam

**Files:**
- Modify: `src/web/packages/editor/src/editor-session.ts:518-528,344`
- Modify: `src/web/packages/editor/src/editor-session-video.ts:171-178`
- Modify: `src/web/packages/editor/src/editor-session-actions.ts:228-235`
- Modify: `src/web/packages/editor/src/selection-inspector/background-column.ts:377-423`
- Modify: `src/web/packages/editor/src/selection-inspector/background-edits.ts`
- Modify: `src/web/packages/editor/src/selection-inspector/options.ts`
- Test: `src/web/packages/editor/src/selection-inspector/background-column.test.ts`
- Test: `src/web/packages/editor/src/selection-inspector/index.dom.test.ts`
- Test: `src/web/packages/editor/src/editor-session.dom.test.ts`

**Interfaces:**
- Consumes: `EditorDocument.setBackgroundAsset`, `setBackgroundMode`.
- Produces: `SelectionInspectorOptions.onBackgroundAssetSelect?: (assetId: string | undefined) => void` and `onBackgroundModeChange?: (mode: BackgroundMode) => void`.

- [ ] **Step 1: Write the failing tests**

In `background-column.test.ts`, delete the `background.media` and `background.mode` cases and their assertions; add an assertion that `writeBackgroundField` answers `undefined` for both ids (the document owns them now).

In `index.dom.test.ts`, extend the `backgroundSelected()` helper with both new ports:

```ts
it("routes the media field to the one switch seam", () => {
  const { funnel, onBackgroundAssetSelect, onBackgroundChange } = /* fixture */;
  expect(funnel.commit(funnel.beginDescribe(), "background.media", "b")).toBe("ok");
  expect(onBackgroundAssetSelect).toHaveBeenCalledWith("b");
  expect(onBackgroundChange).not.toHaveBeenCalled();
  expect(funnel.commit(funnel.revision, "background.media", "")).toBe("ok");
  expect(onBackgroundAssetSelect).toHaveBeenLastCalledWith(undefined);
});

it("routes the mode field to the document's mode seam", () => {
  expect(funnel.commit(funnel.beginDescribe(), "background.mode", "advanced")).toBe("ok");
  expect(onBackgroundModeChange).toHaveBeenCalledWith("advanced");
});
```

In `editor-session.dom.test.ts`, add one test per surface, seeding two declared assets and geometry on `a`:

- Assets pane `onBackground`: switch to `b`, then back to `a`; assert `session.envelope.background?.media` is `a`'s geometry.
- Video import: import a video, assert its media is `{ assetId, bounds: "theme" }` even when the previous asset had `bounds: "display"` and `scale`.
- Finder auto-background: same assertion.
- Inspector `background.media`: committing the field returns `a`'s geometry, not the previous asset's carried fields.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/editor/src/editor-session.dom.test.ts packages/editor/src/selection-inspector`
Expected: FAIL — the new ports are ignored and geometry resets to the previous behaviour.

- [ ] **Step 3: Implement the four callers and the funnel**

Replace each whole-background write with the seam, keeping the surrounding refresh/announce calls exactly as they are:

```ts
// editor-session.ts — Assets pane
onBackground: (asset) => {
  this.#document.setBackgroundAsset(asset.id);
  this.#document.refreshBackgroundMedia();
},

// editor-session-video.ts
host.document.setBackgroundAsset(reference.id);

// editor-session-actions.ts
document.setBackgroundAsset(assetId);
```

In `background-edits.ts`, before the `writeBackgroundField` call:

```ts
if (fieldId === "background.media") {
  if (typeof value !== "string") return "invalid";
  const select = options.onBackgroundAssetSelect;
  if (select === undefined) return "invalid";
  select(value === "" ? undefined : value);
  funnel.revision += 1;
  return "ok";
}
if (fieldId === "background.mode") {
  const mode = BACKGROUND_MODES.find((candidate) => candidate === value);
  const change = options.onBackgroundModeChange;
  if (mode === undefined || change === undefined) return "invalid";
  change(mode);
  funnel.revision += 1;
  return "ok";
}
```

Delete the `background.media` and `background.mode` cases from `writeBackgroundField`. Wire `onBackgroundAssetSelect: (assetId) => this.#document.setBackgroundAsset(assetId)` and `onBackgroundModeChange: (mode) => this.#document.setBackgroundMode(mode)` beside the existing `onBackgroundChange` in `editor-session.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/editor/src/editor-session.dom.test.ts packages/editor/src/selection-inspector`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/editor/src/editor-session.ts src/web/packages/editor/src/editor-session-video.ts src/web/packages/editor/src/editor-session-actions.ts src/web/packages/editor/src/selection-inspector
git commit -m "refactor(editor): route every background asset switch through one seam"
```

---

### Task 4: Host stores the sidecar in the theme folder

**Files:**
- Modify: `src/web/packages/host/src/themes/store.ts`
- Modify: `src/web/packages/host/src/themes/wire.ts`
- Test: `src/web/packages/host/src/themes/store.test.ts`
- Test: `src/web/packages/host/src/server.test.ts`

**Interfaces:**
- Produces:
  - `ThemeContent.backgroundMedia?: unknown`
  - `ThemeStoreRecord.backgroundMedia?: unknown`
  - `const BACKGROUND_MEDIA_FILE = "background-media.json"`
  - `const MAX_BACKGROUND_MEDIA_BYTES = 256 * 1024` (exported from `store.ts`)
  - `readStoredBackgroundMedia(folder: string): Promise<unknown | undefined>`

- [ ] **Step 1: Write the failing tests**

In `store.test.ts`:

```ts
const media = { version: 1, media: { a: { bounds: "display", scale: 2 } } };

it("round-trips background media through save and read", async () => {
  await store.write("id", { ...content, backgroundMedia: media });
  expect((await store.read("id"))?.backgroundMedia).toEqual(media);
});

it("reads a corrupt or oversized background media file as absent", async () => {
  await store.write("id", content);
  await fs.writeFile(join(library, "id", BACKGROUND_MEDIA_FILE), "{not json");
  expect((await store.read("id"))?.backgroundMedia).toBeUndefined();
  await fs.writeFile(
    join(library, "id", BACKGROUND_MEDIA_FILE),
    JSON.stringify({ version: 1, media: { a: { bounds: "x".repeat(MAX_BACKGROUND_MEDIA_BYTES) } } }),
  );
  expect((await store.read("id"))?.backgroundMedia).toBeUndefined();
});

it("a save with no working data keeps the stored sidecar", async () => {
  await store.write("id", { ...content, backgroundMedia: media });
  await store.write("id", { ...content, envelope: renamed });
  expect((await store.read("id"))?.backgroundMedia).toEqual(media);
});

it("an empty map clears the stored sidecar entries", async () => {
  await store.write("id", { ...content, backgroundMedia: media });
  await store.write("id", {
    ...content,
    backgroundMedia: { version: 1, media: {} },
  });
  expect((await store.read("id"))?.backgroundMedia).toEqual({
    version: 1,
    media: {},
  });
});
```

In `server.test.ts`, assert the whole-theme `GET` carries `backgroundMedia` and a `PUT` round-trips it. Also assert a `PUT` whose `backgroundMedia` is not an object is refused with 400.

Add two lifecycle tests: deleting the theme moves the folder and the sidecar with it, and a save whose folder swap fails leaves the previously stored sidecar readable — reuse the store's existing failing-rename fixture and assert `read` still answers the old map.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/host/src/themes/store.test.ts packages/host/src/server.test.ts`
Expected: FAIL — `backgroundMedia` is not a member and the file is never written.

- [ ] **Step 3: Implement read and write**

`store.ts`:
- Add `backgroundMedia?: unknown` to `ThemeContent` and `ThemeStoreRecord` with a comment that it is bounded, opaque working data.
- `readStoredBackgroundMedia(folder)` reads `BACKGROUND_MEDIA_FILE` through `readContainedFile` with `MAX_BACKGROUND_MEDIA_BYTES`, parses JSON, and answers `undefined` for missing, unreadable, oversized, non-JSON or non-object content.
- In `read`, after credits: `const backgroundMedia = await readStoredBackgroundMedia(path.join(directory, id));` and spread it into the record only when defined.
- In `write`, after the credits member: write `JSON.stringify(content.backgroundMedia)` when defined; otherwise copy `target/background-media.json` into staging when it exists, exactly like the thumbnail copy. The staging folder stays whole and is swapped by the existing renames.

`wire.ts`:
- `encodeThemeContent` includes `backgroundMedia` when defined.
- `decodeThemeSave` reads it, requires a non-array object, and refuses one whose JSON exceeds `MAX_BACKGROUND_MEDIA_BYTES` with `"A theme's background media is not a sidecar member."`. Pass it through as opaque `content.backgroundMedia`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/host/src/themes/store.test.ts packages/host/src/server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/host/src/themes/store.ts src/web/packages/host/src/themes/wire.ts src/web/packages/host/src/themes/store.test.ts src/web/packages/host/src/server.test.ts
git commit -m "feat(host): store background media beside the theme document"
```

---

### Task 5: Editor library carries the map open and closed

**Files:**
- Modify: `src/web/packages/editor/src/theme-library-client.ts`
- Modify: `src/web/packages/editor/src/theme-library-manager/index.ts`
- Modify: `src/web/packages/editor/src/editor-session-options.ts`
- Modify: `src/web/packages/editor/src/editor-document.ts` (`EditorDocumentSource.onOpenTheme`)
- Modify: `src/web/packages/editor/src/editor-main.ts`
- Test: `src/web/packages/editor/src/theme-library-client.test.ts`
- Test: `src/web/packages/editor/src/theme-library-manager/index.test.ts`
- Test: `src/web/packages/editor/src/editor-session.dom.test.ts`

**Interfaces:**
- Consumes: `BackgroundMediaMemory`, `readBackgroundMediaMemory`, `encodeBackgroundMedia`, and `#outputCopy`'s `backgroundMedia`.
- Produces:
  - `ThemeLibraryContent.backgroundMedia?: BackgroundMediaMemory`
  - `ThemeLibraryManagerOptions.onOpenTheme` fifth parameter `backgroundMedia?: BackgroundMediaMemory`
  - `EditorSessionOptions.backgroundMedia?: BackgroundMediaMemory`
  - `EditorDocumentSource.backgroundMedia?: BackgroundMediaMemory`

- [ ] **Step 1: Write the failing tests**

`theme-library-client.test.ts`:

```ts
it("reads the stored background media map", async () => {
  // host answers { envelope, assets, backgroundMedia: { version: 1, media: { a: { bounds: "theme" } } } }
  expect((await client.open("id")).backgroundMedia).toEqual({
    a: { bounds: "theme" },
  });
});

it("sends the map as the versioned sidecar member", async () => {
  await client.save("id", { envelope, assets, backgroundMedia: { a: { bounds: "display" } } });
  expect(sentBody.backgroundMedia).toEqual({
    version: 1,
    media: { a: { bounds: "display" } },
  });
});
```

`theme-library-manager/index.test.ts`: save includes the document's map; `saveAs` writes the same map under the new id; `openById` passes it to `onOpenTheme`; duplicate and remix pass the opened theme's map.

`editor-session.dom.test.ts`: a session mounted with `backgroundMedia` restores an asset's geometry on the first switch; `onOpenTheme` receives the fifth argument when the opened theme has one.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/editor/src/theme-library-client.test.ts packages/editor/src/theme-library-manager/index.test.ts`
Expected: FAIL — the map is dropped on both directions.

- [ ] **Step 3: Thread the map**

- `ThemeLibraryContent` gains `readonly backgroundMedia?: BackgroundMediaMemory`.
- `readContent` adds `backgroundMedia: readBackgroundMediaMemory(body?.backgroundMedia)`.
- `save` adds `...(content.backgroundMedia === undefined ? {} : { backgroundMedia: encodeBackgroundMedia(content.backgroundMedia) })`.
- `ThemeLibraryManagerOptions.output` return type gains `readonly backgroundMedia: BackgroundMediaMemory`; `#commit` adds `backgroundMedia: output.backgroundMedia` to the `client.save` content. Because `output` always answers a map, an editor save always sends one, empty included.
- `onOpenTheme` gains the fifth optional parameter in `ThemeLibraryManagerOptions`, `EditorDocumentSource`, and `EditorSessionOptions`; `#openStored`, `#openDuplicate`, `#openRemix` pass `opened.backgroundMedia`.
- `editor-main.ts` `mount` gains `readonly backgroundMedia?: BackgroundMediaMemory`, forwards it into the session options, and its `onOpenTheme` forwards the fifth parameter to `mount`.
- `EditorSession` passes `options.backgroundMedia` through `source` (it already passes the whole options object to `EditorDocument`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/editor/src/theme-library-client.test.ts packages/editor/src/theme-library-manager/index.test.ts packages/editor/src/editor-session.dom.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/editor/src/theme-library-client.ts src/web/packages/editor/src/theme-library-client.test.ts src/web/packages/editor/src/theme-library-manager src/web/packages/editor/src/editor-session-options.ts src/web/packages/editor/src/editor-document.ts src/web/packages/editor/src/editor-main.ts src/web/packages/editor/src/editor-session.dom.test.ts
git commit -m "feat(editor): carry background media memory through library open and save"
```

---

### Task 6: Docs and the gate

**Files:**
- Modify: `docs/superpowers/specs/2026-11-05-background-media-memory-design.md`
- Modify: `docs/product.md:65-68`

- [ ] **Step 1: Update the docs**

- Change the spec's status to `approved for planning (2026-11-05)`.
- In `docs/product.md`, extend the "theme is portable" bullet: the exported package still carries only the document, assets and credits; per-asset background geometry is non-portable working data kept in the library folder's `background-media.json` and dropped with the theme.

- [ ] **Step 2: Run the gate**

Run: `npm run gate`
Expected: exit 0, no network. Fix every failure before committing.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-11-05-background-media-memory-design.md docs/product.md
git commit -m "docs: describe background media working data"
```
