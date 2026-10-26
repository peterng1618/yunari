# Wallpaper Engine import rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the UI-driving export, turn a scene into a local project with one action, and import `.mpkg`/video files through a stepwise modal, on a card grid with visible loading and action states.

**Architecture:** The host owns bytes and filesystem work: package extraction, video normalization, Steam author lookup. The editor owns the document: the import modal, asset declarations, credits, the finder card grid and its status line. No process drives Wallpaper Engine.

**Tech Stack:** TypeScript, Node `http`/`child_process` (existing ffmpeg normalizer), React 19 + Base UI + Tailwind, Vitest + Playwright.

**Spec:** `docs/superpowers/specs/2026-10-26-wallpaper-engine-import-rework-design.md`

## Global Constraints

- No new runtime dependency.
- No UI automation, no engine launch, no export-folder watcher, no Save-dialog interaction.
- The editor never parses a package; the host never imports a theme asset.
- Tests never start Wallpaper Engine.
- Source uploads cap at **512 MiB**; the normalized output cap stays **96 MB**.
- A fresh unpack prefixes the project title with exactly `"[yunari] "` and never double-prefixes.
- Card actions are lucide icon buttons with accessible labels and hover/focus tooltips; no text buttons in the card grid.
- Every route that spawns a process or writes a directory keeps loopback + same-origin checks.
- One status line (`role="status"`) at the bottom of the finder modal carries the latest outcome.
- Run commands from `src/web`.
- Before each task's commit, replace `STATUS.md`'s "Last completed change" with a 1–5 bullet summary of that commit and run `npm run status:check`.

## Review Focus

1. A picked source larger than 96 MB but under 512 MiB imports successfully when its normalized output fits — the ceiling is on output, not source.
2. A package without `wallpaper.mp4` keeps the modal open with a sentence and declares no asset.
3. A reused local project keeps the author's edited title; only a fresh unpack gets the `[yunari] ` prefix, once.
4. An offline/failing Steam lookup never blocks an import; the credit still lands with `author.steamId`.
5. A slow video/convert action shows a running glyph and tooltip, then success; the author is never left waiting blind.

---

### Task 1: Decision note, remove the automation, unpack without launching

**Files:**
- Create: `docs/decisions/0124-the-engine-is-converted-to-not-driven.md`
- Delete: `src/web/packages/host/src/wallpaper-engine/export-mobile.ts`, `export-mobile.test.ts`, `export-mobile.live.test.ts`
- Modify: `src/web/packages/host/src/wallpaper-engine/source.ts`
- Modify: `src/web/packages/host/src/wallpaper-engine/unpack.ts`
- Modify: `src/web/packages/host/src/wallpaper-engine/unpack.test.ts`
- Modify: `src/web/packages/host/src/wallpaper-engine/source.test.ts`
- Modify: `src/web/packages/host/src/server.ts`
- Modify: `src/web/packages/host/src/server.test.ts`

**Interfaces:**
- Produces: `ProjectResult = { ok: true; name: string; reused: boolean } | { ok: false; reason: "no-install" | "unreadable" | "refused" }`.
- Produces: `WallpaperEngineSource` keeps `listing`, `bytesOf`, `project`; drops `mobileExport`, `exportsSince`, `exportBytes`.
- Produces: `unpack.ts` exports only `unpackScene` and the result types; `launchEditor`, `startDetached`, `ExportFile` are gone.

- [ ] **Step 1: Write the decision note**
  Use `docs/decisions/README.md`'s template. `Paths:` names `src/web/packages/host/src/server.ts` and `src/web/packages/editor/src/editor-session.ts`. Record the seven rungs by pointing at decision 0118's measured findings — no export CLI, CEF debugging refused, no ecosystem tool exports headlessly, the native Save dialog unreachable from the host's child process — then the new ruling: the host converts and the author exports; the engine is never driven.

- [ ] **Step 2: Write the failing host tests**
  In `unpack.test.ts`, add: a fresh unpack writes `project.json` with `title: "[yunari] Cache Scene"`; a second unpack of the same item (`reused: true`) leaves a hand-edited title unchanged. In `source.test.ts`, assert `project("101")` answers `{ ok: true, name: "101", reused: false }` with no `launched` key and the injected `launch` is never called. In `server.test.ts`, replace the three removed-route cases with 404 expectations for `POST …/mobile-export`, `GET …/exports`, `GET …/export`.

- [ ] **Step 3: Run the tests to verify they fail**
  Run: `npx vitest run packages/host/src/wallpaper-engine/unpack.test.ts packages/host/src/wallpaper-engine/source.test.ts packages/host/src/server.test.ts`
  Expected: FAIL on the prefix, `launched`, and the three routes.

- [ ] **Step 4: Implement the removal and the prefix**
  - Delete the three `export-mobile` files.
  - `unpack.ts`: add `const TITLE_PREFIX = "[yunari] "`; in `writeProject`, when the descriptor's `title` is a non-empty string not already starting with the prefix, write `{ ...descriptor, title: title.startsWith(TITLE_PREFIX) ? title : TITLE_PREFIX + title, file: "scene.json" }`. Delete `launchEditor`, `startDetached`, `ExportFile`, and `ProjectResult.launched`.
  - `source.ts`: delete the export imports, `MobileExportOutcome`, `HARVEST_MS`, `HARVEST_POLL_MS`, `harvest`, `savedPackageSince`, `exporting`, `mobileExport`, `exportsSince`, `exportBytes`, `formatOf`, `regularFileStats`, `exportDirectories`, and the `documentsDirectory` option. `project` returns `{ ...unpacked }`.
  - `server.ts`: delete the three route blocks and their imports.
  - Update the duplicated test fixtures in `source.test.ts`/`server.test.ts`.

- [ ] **Step 5: Run the tests to verify they pass**
  Run: `npx vitest run packages/host/src/wallpaper-engine/unpack.test.ts packages/host/src/wallpaper-engine/source.test.ts packages/host/src/server.test.ts`
  Expected: PASS.

- [ ] **Step 6: Update STATUS and commit**
  Run: `npm run status:check`. Commit the decision, source, tests, and `STATUS.md` with `refactor(wallpaper-engine): stop driving the engine and unpack without launching`.

---

### Task 2: Host routes for `.mpkg`, video normalization, and author lookup

**Files:**
- Modify: `src/web/packages/host/src/wallpaper-engine/pkg.ts`
- Modify: `src/web/packages/host/src/wallpaper-engine/pkg.test.ts`
- Create: `src/web/packages/host/src/wallpaper-engine/author.ts`
- Create: `src/web/packages/host/src/wallpaper-engine/author.test.ts`
- Modify: `src/web/packages/host/src/wallpaper-engine/source.ts`
- Modify: `src/web/packages/host/src/wallpaper-engine/source.test.ts`
- Modify: `src/web/packages/host/src/server.ts`
- Modify: `src/web/packages/host/src/server.test.ts`

**Interfaces:**
- Produces: `mobilePackage(bytes: Uint8Array): { video: Uint8Array; title?: string; workshopId?: string } | undefined` in `pkg.ts`.
- Produces: `fetchAuthorName(steamId: string, deps?: { fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<string | undefined>` in `author.ts`.
- Produces: `WallpaperEngineSource.authorName(steamId: string): Promise<string | undefined>`; caches per id for the process.
- Produces: `MAX_VIDEO_SOURCE_BYTES = 512 * 1024 * 1024` exported from `server.ts`.
- Produces: `POST /api/wallpaper-engine/mpkg` answering `{ ok: true; videoBase64: string; reencoded: boolean; title?: string; workshopId?: string }` or `{ ok: false; message: string }`.
- Produces: `GET /api/wallpaper-engine/author/:steamId` answering `{ name?: string }`.
- Changes: `POST /api/themes/normalize-video` takes a raw binary body instead of `{ bytesBase64 }`; its JSON answer is unchanged.

- [ ] **Step 1: Write the failing tests**
  - `pkg.test.ts`: a synthesized `PKGM0014` table holding a `project.json` (`title`, `package.workshopId`) and a `wallpaper.mp4` returns both; a table without the video returns `undefined`; malformed JSON in `project.json` still returns the video with no metadata.
  - `author.test.ts`: a fake `fetch` answering `<steamID>Ada</steamID>` returns `"Ada"`; `&amp;` is decoded; a non-OK response, a timeout (`AbortError`), and a body without `<steamID>` return `undefined`; a non-17-digit id performs no fetch.
  - `source.test.ts`: `authorName("76561198000000001")` calls the injected fetch once and answers from cache on the second call.
  - `server.test.ts`: mpkg route — 405 for GET, 403 for a non-loopback address, 403 for a foreign origin, 413 above `MAX_VIDEO_SOURCE_BYTES`, 429 while the large-body slot is busy, 200 with `videoBase64` for a valid package, 200 `{ ok: false }` for a package without the video. A conforming MP4 fixture inside the package keeps `reencoded: false`. A package over 96 MiB whose video normalizes under 96 MiB succeeds; a normalized output over `MAX_THEME_UPLOAD_BYTES` answers `{ ok: false }`. Author route: 405 for POST, 403 non-loopback, a cached name, and an absent name. Normalize route: a raw binary body of a conforming fixture answers `bytesBase64` unchanged; a body over `MAX_VIDEO_SOURCE_BYTES` answers 413.

- [ ] **Step 2: Run the tests to verify they fail**
  Run: `npx vitest run packages/host/src/wallpaper-engine/pkg.test.ts packages/host/src/wallpaper-engine/author.test.ts packages/host/src/wallpaper-engine/source.test.ts packages/host/src/server.test.ts`
  Expected: FAIL on the missing functions and routes.

- [ ] **Step 3: Implement `mobilePackage`**
  Reuse `readPackage`/`memberBytes`/`mobileVideo`. Read `project.json` when present; `title` from a string `title`; `workshopId` from `package.workshopId` coerced to a string when it is a string or safe integer. A missing or unreadable member is `undefined`.

- [ ] **Step 4: Implement `fetchAuthorName` and the source cache**
  Validate `/^\d{17}$/` before fetching. `fetch("https://steamcommunity.com/profiles/<id>/?xml=1", { signal: AbortSignal.timeout(timeoutMs ?? 5000) })`; parse `/<steamID>([^<]*)<\/steamID>/`; decode `&amp; &lt; &gt; &quot; &apos;`; trim; empty is `undefined`. Cache the answer (including `undefined`) in a `Map<string, string | undefined>` and expose it as `authorName`.

- [ ] **Step 5: Implement the routes**
  Add the two WE routes with the existing loopback/origin helpers. The mpkg route uses `largeBody.run(() => readBytes(request, MAX_VIDEO_SOURCE_BYTES))`, maps `LargeBodyBusyError` to 429 and an oversized body to 413, then `mobilePackage` → `normalizeVideo` → the 96 MB output check → JSON. Change the normalize route's body read to raw bytes with `MAX_VIDEO_SOURCE_BYTES`; keep its `{ ok, bytesBase64, reencoded }` / `{ ok: false, message }` answers. Add the author route as loopback-only GET.

- [ ] **Step 6: Run the tests to verify they pass**
  Run the command from Step 2.
  Expected: PASS.

- [ ] **Step 7: Update STATUS and commit**
  Run: `npm run status:check`. Commit with `feat(wallpaper-engine): import packages and resolve authors on the host`.

---

### Task 3: Editor client contract

**Files:**
- Modify: `src/web/packages/editor/src/wallpaper-engine/client.ts`
- Modify: `src/web/packages/editor/src/wallpaper-engine/client.test.ts`
- Modify: `src/web/packages/editor/src/video-normalizer.ts`
- Modify: `src/web/packages/editor/src/video-normalizer.dom.test.ts` (create if absent)

**Interfaces:**
- Keeps until Task 5: `WallpaperEngineItem["kind"]` still includes `"image" | "web"`, so the body, copy and their tests keep compiling; Task 5 narrows the union with the grid rewrite.
- Produces: `startProject(workshopId, options?) => Promise<{ ok: true; name: string; reused: boolean } | { ok: false; reason: string }>`.
- Produces: `prepareMobilePackage(file: File, options?) => Promise<{ ok: true; file: File; title?: string; workshopId?: string; reencoded: boolean } | { ok: false; message: string }>`.
- Produces: `fetchAuthorName(steamId: string, options?) => Promise<string | undefined>`.
- Changes: `requestNormalizedVideo(source: File | Uint8Array) => Promise<NormalizeOutcome>` posts the source as a raw body; the union keeps the Assets pane compiling until Task 4 removes its call.
- Keeps until Task 5: `StartMobileExportAnswer`, `ExportFile`, `EXPORT_POLL_MS`, `startMobileExport`, `findExports`, `fetchExport` — Task 3 must not break the export sheet before Task 5 deletes it.
- Keeps until Task 5: the `"image" | "web"` arms of `KINDS` and their copy branches.

- [ ] **Step 1: Write the failing client tests**
  - `itemOf` still parses `video`, `scene`, `image` and `web` rows; Task 5 narrows the union.
  - `startProject` parses `{ ok: true, name, reused }` and ignores an unexpected `launched`.
  - `prepareMobilePackage` POSTs the file bytes to `/api/wallpaper-engine/mpkg`, names the returned File `<title or stem>.mp4` with `type: "video/mp4"`, and maps `{ ok: false, message }`.
  - `fetchAuthorName` answers the name, and `undefined` for a non-OK response or malformed body.
  - `requestNormalizedVideo` accepts a `File` and a `Uint8Array`, sends `content-type: application/octet-stream` and the bytes, and still parses `{ ok, bytesBase64, reencoded }`.

- [ ] **Step 2: Run the tests to verify they fail**
  Run: `npx vitest run packages/editor/src/wallpaper-engine/client.test.ts packages/editor/src/video-normalizer.dom.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement the client changes**
  Keep the existing `request()` helper and defensive parsing. For raw uploads use `body: file` with `content-type: application/octet-stream`. `prepareMobilePackage` decodes `videoBase64` into a `File` named from `title` when present, else the source name's stem. Leave the export-sheet functions in place; Task 5 removes them with their last caller.

- [ ] **Step 4: Run the tests to verify they pass**
  Run the command from Step 2.
  Expected: PASS.

- [ ] **Step 5: Update STATUS and commit**
  Run: `npm run status:check`. Commit with `refactor(editor): reshape the Wallpaper Engine client for file imports`.

---

### Task 4: Import modal, Assets-pane routing, package import

**Files:**
- Create: `src/web/packages/editor/src/panes/assets/import-video-modal.tsx`
- Create: `src/web/packages/editor/src/panes/assets/import-video-modal.dom.test.tsx`
- Modify: `src/web/packages/editor/src/panes/assets/assets-pane.tsx`
- Modify: `src/web/packages/editor/src/panes/assets/assets-pane.dom.test.tsx`
- Modify: `src/web/packages/editor/src/editor-session.ts`
- Modify: `src/web/packages/editor/src/editor-session.dom.test.ts`
- Modify: `src/web/packages/editor/src/ui-copy.ts`
- Modify: `src/web/tests/e2e/assets-preview.spec.ts`

**Interfaces:**
- Produces: `type VideoImportStep = "preparing" | "importing"`.
- Produces: `ImportVideoModal` props `{ file: File; package: boolean; onRun: (onStep: (step: VideoImportStep) => void) => Promise<ImportOutcome>; onClose: () => void }`.
- Produces: `EditorSession.importPickedVideo(file: File, options: { package: boolean; onStep?: (step: VideoImportStep) => void }): Promise<ImportOutcome>`.
- Produces: `AssetsPane` prop `onImportVideo?: (file: File, package: boolean, onStep: (step: VideoImportStep) => void) => Promise<ImportOutcome>`.
- Produces: `.mpkg` is accepted by both import inputs but is not added to `ASSET_FILE_EXTENSIONS`.

- [ ] **Step 1: Write the failing modal tests**
  Render the modal with a fake `onRun`: it calls `onStep("preparing")`, then `"importing"`, shows a skeleton/progress block while running, closes on success, and stays open with the returned message on failure. Assert the package sentence differs from the video sentence.

- [ ] **Step 2: Write the failing pane and session tests**
  - Picking an `.mpkg` calls `onImportVideo(file, true, …)` and never `manager.import`.
  - Picking a video calls `onImportVideo(file, false, …)`; picking a PNG still declares it directly.
  - The manual `Normalize video` button and `data-yunari-asset-normalize` selector are gone.
  - `importPickedVideo(file, { package: true })` calls `/api/wallpaper-engine/mpkg` then the normalized-video route, declares one video asset, sets background media, and writes a credit `{ kind: "wallpaper", title, license: "unknown", changes }` with no source.
  - `importPickedVideo(file, { package: false })` writes no credit.

- [ ] **Step 3: Run the tests to verify they fail**
  Run: `npx vitest run packages/editor/src/panes/assets/import-video-modal.dom.test.tsx packages/editor/src/panes/assets/assets-pane.dom.test.tsx packages/editor/src/editor-session.dom.test.ts`
  Expected: FAIL.

- [ ] **Step 4: Implement the modal**
  Use the existing `Dialog` component. States `idle → running → done | failed`; `preparing` copy is "Extracting and preparing the video…" for a package and "Preparing the video…" for a video. Success closes; failure sets the message and stays. A dismiss press calls `onClose` and runs nothing.

- [ ] **Step 5: Implement pane routing and session import**
  - `ASSET_FILE_ACCEPT` appends `.mpkg`; both inputs use it.
  - In `importFile`, `.mpkg` and video extensions set the modal state instead of importing; images/fonts keep today's path. Remove the normalize button, its state, preview, confirmation and their tests; delete the now-unused imports.
  - `importPickedVideo`: package → `prepareMobilePackage` (already normalized on the host) → declare/set background/credit; video → `requestNormalizedVideo` → declare/set background, no credit. Extract a private `declareVideo(file, options: { credit?: ThemeCreditsEntry }): Promise<ImportOutcome>` from `importWallpaperFile` so all three paths share the cap check, declaration, credit and background consequence. Declaration metadata (`license`, `sourceUrl`) is Task 6's; this task writes only the credit.
  - Wire `onImportVideo` from `editor-session.ts:544`'s pane props.

- [ ] **Step 6: Run the tests to verify they pass**
  Run the command from Step 3.
  Expected: PASS.

- [ ] **Step 7: Add browser proof for the picker path**
  In `src/web/tests/e2e/assets-preview.spec.ts`, route `/api/wallpaper-engine/mpkg` to a package whose `project.json` carries a title and whose `wallpaper.mp4` is a conforming fixture; use `setInputFiles` on `[data-yunari-asset-import-input]` with a synthesized `PKGM` buffer. Assert the modal shows "Extracting and preparing the video…", then closes, and the video card appears in the Assets pane. A second case routes `{ ok: false, message: "No video in this package." }` and asserts the modal stays open with that sentence and no card is added.

- [ ] **Step 8: Run the browser proof**
  Run: `npx playwright test tests/e2e/assets-preview.spec.ts`
  Expected: PASS.

- [ ] **Step 9: Update STATUS and commit**
  Run: `npm run status:check`. Commit with `feat(assets): import .mpkg and video files through one modal`.

---

### Task 5: Wallpaper Engine card grid, actions, guide, status line

**Files:**
- Create: `src/web/packages/editor/src/asset-finder/wallpaper-engine-card.tsx`
- Create: `src/web/packages/editor/src/asset-finder/wallpaper-engine-guide.tsx`
- Rewrite: `src/web/packages/editor/src/asset-finder/wallpaper-engine-body.tsx`
- Modify: `src/web/packages/editor/src/asset-finder/wallpaper-engine-body.dom.test.tsx`
- Modify: `src/web/packages/editor/src/editor-session.ts`
- Modify: `src/web/packages/editor/src/editor-shell/session-facade.ts`
- Modify: `src/web/packages/editor/src/editor-shell/icons.ts`
- Modify: `src/web/packages/editor/src/ui-copy.ts`
- Modify: `src/web/tests/e2e/wallpaper-engine.spec.ts`

**Interfaces:**
- Produces: `WallpaperEngineCard` props `{ item; state: "idle" | "running" | "done" | "failed"; message?: string; onAction: () => void }`.
- Produces: body props `{ onSetBackground(item): Promise<ImportOutcome>; onConvert(item): Promise<StartProjectAnswer>; onImportPackage(file, onStep): Promise<ImportOutcome> }`.
- Produces: `CONVERT_SCENE_GLYPH = FolderInput`, `SET_BACKGROUND_GLYPH = Wallpaper`, `CONVERTED_GLYPH = Check`, `SETTING_GLYPH = LoaderCircle`, `ACTION_FAILED_GLYPH = TriangleAlert` in `icons.ts`.
- Removes: `onImportExport` from session facade, shell body wiring and body props.

- [ ] **Step 1: Write the failing DOM tests**
  - The body draws `[data-yunari-wallpaper-engine-card]` per item inside `[data-yunari-asset-grid]`; the kind filters are exactly all/video/scene.
  - A video card's icon button has `aria-label="Set as background"`; pressing it shows `aria-label="Setting…"` while pending, then `aria-label="Background set"`, and the status line carries the success sentence.
  - A scene card's button goes "Convert to local project" → "Converting…" → "Converted"; a failure returns to the idle label and puts the failure sentence on the status line.
  - The Guide button opens a dialog containing the convert use case and the `.mpkg` export steps.
  - The "Import a .mpkg video" button opens a file input accepting `.mpkg` and, on pick, renders the import modal.
  - The body exposes one `role="status"` at its bottom.

- [ ] **Step 2: Run the tests to verify they fail**
  Run: `npx vitest run packages/editor/src/asset-finder/wallpaper-engine-body.dom.test.tsx`
  Expected: FAIL.

- [ ] **Step 3: Implement the cards and body**
  Reuse the font tile's geometry classes. Each card: preview `<img>` in a `h-24` box, title, `kind · size`, and one `ControlIconButton` with `data-yunari-wallpaper-engine-action`. Per-item action state lives in the body (`Map<workshopId, { state, message }>`); a single `status` string renders at the bottom in `role="status"`. The body keeps its listing fetch, search, and all/video/scene filters.

- [ ] **Step 4: Implement the guide**
  A `Dialog` opened by `data-yunari-wallpaper-engine-guide`; two sections with the spec's copy: why convert and where to remove/disable dynamic text; the manual export sequence ending at "Import a .mpkg video".

- [ ] **Step 5: Wire actions and remove the sheet**
  `editor-session.ts`: `onSetBackground` → `importWallpaperItem`; `onConvert` → `startProject`; `onImportPackage` → `importPickedVideo(file, { package: true, onStep })`. Delete `importWallpaperExport`, the `onImportExport` plumbing, `wallpaper-engine/export-sheet.tsx` and `export-sheet.dom.test.tsx`, the now-unused client export functions/types (`startMobileExport`, `findExports`, `fetchExport`, `StartMobileExportAnswer`, `ExportFile`, `EXPORT_POLL_MS`) and their client tests.

- [ ] **Step 6: Rewrite the browser spec**
  Update `src/web/tests/e2e/wallpaper-engine.spec.ts`: the fixture drops image/web rows; asserts four scene/video cards, the two filters, icon-button labels, the guide dialog, the status line after a routed successful convert, and captures `editor-finder-wallpaper-engine` from the grid. Remove the two export-sheet tests. Route `/api/wallpaper-engine/item/201/project` to `{ ok: true, name: "201", reused: false }`.

- [ ] **Step 7: Run the tests to verify they pass**
  Run: `npx vitest run packages/editor/src/asset-finder/wallpaper-engine-body.dom.test.tsx`
  Then: `npx playwright test tests/e2e/wallpaper-engine.spec.ts`
  Expected: PASS.

- [ ] **Step 8: Update STATUS and commit**
  Run: `npm run status:check`. Commit with `feat(finder): draw Wallpaper Engine results as actionable cards`.

---

### Task 6: Credits and attribution

**Files:**
- Modify: `src/web/packages/editor/src/asset-manager/index.ts`
- Modify: `src/web/packages/editor/src/asset-manager/index.dom.test.ts`
- Modify: `src/web/packages/editor/src/editor-session.ts`
- Modify: `src/web/packages/editor/src/editor-session.dom.test.ts`
- Modify: `src/web/packages/editor/src/panes/assets/preview-modal.dom.test.tsx`
- Modify: `src/web/packages/editor/src/wallpaper-engine/client.ts`

**Interfaces:**
- Changes: `AssetManager.import(file: File, metadata?: { sourceUrl?: string; license?: AssetLicense }) => Promise<LocalAssetReference>`; metadata is written on the declaration.
- Produces: grid video import's declaration carries `license: { name: "unknown" }` and `sourceUrl = attribution.workshopUrl ?? https://steamcommunity.com/profiles/<steamId>`.
- Produces: the grid video credit carries `author: { steamId, name? }` when the lookup answers.

- [ ] **Step 1: Write the failing tests**
  - `AssetManager.import(file, { sourceUrl, license })` writes both fields on the declaration and they survive a package round-trip.
  - A grid video import with a routed `{ name: "Ada" }` author answer writes a credit with `author: { steamId, name: "Ada" }` and a declaration the preview modal shows as `unknown` plus the workshop/profile URL, never `None recorded`.
  - With the author route failing, the same import still writes the credit with `steamId` only.

- [ ] **Step 2: Run the tests to verify they fail**
  Run: `npx vitest run packages/editor/src/asset-manager/index.dom.test.ts packages/editor/src/editor-session.dom.test.ts packages/editor/src/panes/assets/preview-modal.dom.test.tsx`
  Expected: FAIL.

- [ ] **Step 3: Implement**
  Thread the optional metadata through `import` into the `reference` literal. In `importWallpaperItem`/`importWallpaperFile`, fetch the author name only when `attribution.steamId` exists; pass metadata and the credit descriptor through. Update `creditsEntryOf` to accept `authorName?: string` and include `name` only when present. Package imports keep their title-only credit from Task 4, and this task adds their declaration metadata: `declareVideo` passes `license: { name: "unknown" }` with no source.

- [ ] **Step 4: Run the tests to verify they pass**
  Run the command from Step 2.
  Expected: PASS.

- [ ] **Step 5: Update STATUS and commit**
  Run: `npm run status:check`. Commit with `fix(wallpaper-engine): carry author, licence and source on imports`.

---

### Task 7: Finder loading skeletons

**Files:**
- Create: `src/web/packages/editor/src/asset-finder/skeleton.tsx`
- Create: `src/web/packages/editor/src/asset-finder/skeleton.dom.test.tsx`
- Modify: `src/web/packages/editor/src/asset-finder/modal.tsx`
- Modify: `src/web/packages/editor/src/asset-finder/modal.dom.test.tsx`
- Modify: `src/web/packages/editor/src/asset-finder/fonts-body.tsx`
- Modify: `src/web/packages/editor/src/asset-finder/fonts-body.dom.test.tsx`
- Modify: `src/web/packages/editor/src/asset-finder/wallpaper-engine-body.tsx`
- Modify: `src/web/packages/editor/src/asset-finder/wallpaper-engine-body.dom.test.tsx`

**Interfaces:**
- Produces: `CardGridSkeleton({ count?: number })` and `TextSkeleton({ lines?: number })`.
- Both render `aria-busy="true"`, one visually hidden loading sentence, placeholder blocks with `motion-reduce:animate-none`, and no focusable element.

- [ ] **Step 1: Write the failing tests**
  - The finder with a pending `/api/assets/sources` renders `[data-yunari-skeleton-grid]`, and no skeleton once sources answer.
  - A search with no prior answer renders the grid skeleton; pagination with prior results keeps them and sets `aria-busy` instead.
  - The WE body with no answer renders the grid skeleton, then cards.
  - The Fonts body with a pending first search renders the text skeleton, then results.

- [ ] **Step 2: Run the tests to verify they fail**
  Run: `npx vitest run packages/editor/src/asset-finder/skeleton.dom.test.tsx packages/editor/src/asset-finder/modal.dom.test.tsx packages/editor/src/asset-finder/fonts-body.dom.test.tsx packages/editor/src/asset-finder/wallpaper-engine-body.dom.test.tsx`
  Expected: FAIL.

- [ ] **Step 3: Implement**
  Add `skeleton.tsx`; use `animate-pulse motion-reduce:animate-none` blocks. In the finder render the grid skeleton while `listing === "loading"`, and while a search is in flight with `answer === undefined`; otherwise keep results and set `aria-busy`. Replace the fonts body's "Searching…" paragraph with `TextSkeleton` only when nothing is drawn yet. Replace the WE body's empty return with the grid skeleton.

- [ ] **Step 4: Run the tests to verify they pass**
  Run the command from Step 2.
  Expected: PASS.

- [ ] **Step 5: Update STATUS and commit**
  Run: `npm run status:check`. Commit with `feat(finder): show skeletons while a tab or search loads`.

---

### Task 8: Documentation, screenshots, and the full gate

**Files:**
- Modify: `docs/superpowers/specs/2026-10-21-wallpaper-engine-import-design.md` (§8 and any UIA claim)
- Modify: `docs/decisions/0118-a-scene-is-exported-by-driving-the-engine-ui.md` (status: superseded by 0124)
- Move: `docs/superpowers/plans/2026-10-26-wallpaper-engine-mobile-export.md` → `docs/superpowers/plans/archive/`
- Modify: `docs/evidence/screenshots/README.md`
- Modify: `STATUS.md`

- [ ] **Step 1: Rewrite spec §8**
  Describe the shipped route: convert to a local project (unpack only, `[yunari] ` title prefix), the author's manual `.mpkg` export, the import modal, the 512 MiB source / 96 MB output split, the author lookup, and the card grid. Delete claims that the host drives the engine.

- [ ] **Step 2: Close the old decision and archive the old plan**
  Set 0118's status to `superseded by 0124`. Move the mobile-export plan into `archive/`; check no active plan links to it.

- [ ] **Step 3: Update the capture registry**
  Replace the two export-sheet actions with the grid action. The action-name and test-title pair must match `wallpaper-engine.spec.ts` exactly; the gate reads them.

- [ ] **Step 4: Run the full gate and record the exit code**
  Run: `npm run gate`
  Expected: exit 0. If it fails, fix the reported file and re-run; do not report green without the exit code.

- [ ] **Step 5: Final STATUS and commit**
  Run: `npm run status:check`. Commit with `docs(wallpaper-engine): record the import rework and archive the export plan`.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-26-wallpaper-engine-import-rework.md`.
