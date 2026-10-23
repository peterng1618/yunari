# Wallpaper Engine as a background source — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Let a Yunari author pick a theme they already own in Wallpaper Engine as a background: a still scene exports as a PNG, an animated scene as an MP4, image and video items import directly, and every scene is unpacked and opened in Wallpaper Engine's own editor for them.

**Architecture:** The host reads the Steam library and the `.pkg` container, classifies a scene, unpacks it, and launches the editor — every filesystem decision stays there (spec R7). The editor only renders a list and a guidance sheet. Nothing is re-rendered by Yunari, and nothing in Wallpaper Engine is driven (R1).

**Tech Stack:** TypeScript, Node 22.12+, React 19, Vitest, Playwright, Biome. **No new dependency** — the container reader and the VDF read are tens of lines against a format decoded in the spec.

**Spec:** `docs/superpowers/specs/2026-10-21-wallpaper-engine-import-design.md`. Read §1.2, §4, §4.1, §5.2, §6, §8, §8.1 and §11 with this plan; the measurements in §16 are the fixtures' source of truth.

**Decision:** `docs/decisions/0097-the-wallpaper-engine-library-is-read-by-the-host.md`, landed in Task 1 before the first write to `host/src/server.ts` (a watchlisted path).

**Status:** **Complete, 2026-10-23.** Tasks 1–9 landed on `peterng1618/Wallpaper-Engine-as-background-media`; the whole-branch review and its fix pass closed clean. Archived.

## Global Constraints

- **No new dependency.** No VDF parser, no `.pkg` library, no image or video library, no archive package.
- **The host owns every filesystem decision.** The browser addresses an item by `workshopId` and never by a path.
- **Yunari never drives Wallpaper Engine** (R1): it reads the library, creates one directory of its own, launches the editor, and sends nothing after the launch.
- **The one write is the unpack.** No `config.json` write, no edit inside the Steam library, no second directory.
- **A failure is never guessed away.** An unreadable `scene.pkg` stays unclassified and exports as video; it is never assumed still (`§11`).
- **Persist no Wallpaper Engine state.** `stillAtRest`, `hasText` and the export listing are derived on read; no cache file records them.
- **`renderer-core` stays Fabric-free and DOM-free**, and gains nothing here.
- **Size caps stay the asset manager's** (`host/src/themes/store.ts`: 32 MiB/asset, 128 assets, 128 MiB total). The importer neither raises nor duplicates them.
- **Windows only.** On any other platform the source reports `unsupported-platform` and the editor draws nothing.
- **500 lines is a signal, 800 is a stop** for a source file; `host/src/server.ts` is already 100 KB, so its additions are route blocks plus one import, and helper logic lives in `wallpaper-engine/`.
- **Copy lives in `ui-copy.ts`.** Every user-visible sentence this plan adds goes there.
- **Scratch directories come from `os.tmpdir()`**, never a literal `/tmp` (this box maps Node's temp to `C:\tmp`).
- Commit explicit paths only; never `git add -A` or `git commit -a`.

## Review Focus

The failure modes the spec implies but no happy path exercises, most likely to bite a person first. Each gets its test in the task that owns the code.

1. **A library with an unreadable `project.json`, an unreadable `scene.pkg`, or a preset row.** The first two are skipped or listed-unclassified and counted; a preset is never listed, and an unclassified scene never becomes a PNG. → Tasks 3 and 4.
2. **A still scene whose clock the author deleted, and one whose clock they did not.** The flow must not claim the clock is gone, and must not block the import on it either. → Task 7.
3. **An unpack whose target directory already exists, or a write that fails part-way.** Nothing is overwritten and no half-written project is left behind for the editor to open. → Task 5.
4. **A path that escapes the export scope** — `..`, a separator, an encoded `%2e%2e`, or a non-`.png`/`.mp4` extension. → Task 5.
5. **Wallpaper Engine absent, or a non-Windows host.** The Add pane is byte-identical to today's, proven by the existing DOM test passing unchanged. → Task 6.

---

## Task 1: The decision note

**Controller task, not delegated.** The gate refuses the first write to a watchlisted path — this plan adds routes to `host/src/server.ts` — until a note claims it.

**Files:**
- Create: `docs/decisions/0089-the-wallpaper-engine-library-is-read-by-the-host.md`

- [x] **Step 1: Write the note** in `docs/decisions/README.md`'s template: the problem (a downloaded scene cannot be opened, and Yunari will not re-render one), and all seven rungs with **the searches that were run**, copying §10 of the spec and citing the evidence each rung stood on: the CLI flag enumeration, the CEF binding table, `ui_en-us.json`'s two keys, the container layout, `ispreset`, and the censuses in §16.
- [x] **Step 2: Rung 4 must name the queries**, not just the libraries: "automate Wallpaper Engine export", "wallpaper engine scene renderer linux", "rePKG scene.json", "Wallpaper Engine mobile video export". Record that no project renders a WE scene headlessly, and that the only offerings are UI automation, which the vendor blocks.
- [x] **Step 3: Status `accepted`, Date `2026-10-21`**, and a `Paths:` line naming `src/web/packages/host/src/server.ts` and `src/web/packages/host/src/wallpaper-engine/`.
- [x] **Step 4: Commit** `docs(decisions): the Wallpaper Engine library is read by the host`.

## Task 2: The container reader and the still test

The two parsers, pure and testable without a Wallpaper Engine install. They are the whole of spec §3 and §4.1's claims.

**Files:**
- Create: `src/web/packages/host/src/wallpaper-engine/pkg.ts`
- Create: `src/web/packages/host/src/wallpaper-engine/pkg.test.ts`
- Create: `src/web/packages/host/src/wallpaper-engine/classify.ts`
- Create: `src/web/packages/host/src/wallpaper-engine/classify.test.ts`

**Interfaces:**

```ts
// pkg.ts
export interface PackageMember { readonly name: string; readonly offset: number; readonly length: number }
export interface ScenePackage {
  /** Member offsets are relative to `dataStart`, as the format stores them. */
  readonly bytes: Uint8Array;
  readonly dataStart: number;
  readonly members: ReadonlyMap<string, PackageMember>;
}
export function readScenePackage(bytes: Uint8Array): ScenePackage | undefined;
export function memberBytes(pkg: ScenePackage, name: string): Uint8Array | undefined;

// classify.ts
export interface SceneFacts { readonly atRest: boolean; readonly hasText: boolean }
export function readSceneFacts(bytes: Uint8Array): SceneFacts | undefined;
```

- [x] **Step 1: Write the failing `pkg.test.ts`.** A hand-built buffer (`magicLen` 8, `"PKGV0001"`, entry count, one entry with a name and offset/length, member bytes) asserts the member name, its bytes, and `dataStart`. Then the refusals: a truncated header, a table whose last member runs past the file's end, a zero-length name, and a name repeating an earlier one — each `undefined`, never a partial table.
- [x] **Step 2: Run it and watch it fail** — `npx vitest run packages/host/src/wallpaper-engine/pkg.test.ts` from `src/web/`.
- [x] **Step 3: Implement `readScenePackage`** — `readUInt32LE` for `magicLen`, the magic matched against `/^PKGV\d{4}$/` (versions `0001`, `0020`, `0024` and `0025` occur), the entry count, then `nameLen / name / offset / length` per entry. Refuse when `start + offset + length` exceeds the buffer. **Read bounds before every field**; a malformed package is a normal input here, not an exceptional one.
- [x] **Step 4: Write the failing `classify.test.ts`** — five `scene.json` payloads wrapped by the same hand-built package: (a) image + text + sound + parallax + `ledsource`, `atRest: true, hasText: true`; (b) one object with `particle`, `atRest: false`; (c) one object with `animationlayers`, `atRest: false`; (d) an object whose `origin` carries `"animation": { "c0": [ { "frame": 0, "value": 0 } ] }`, `atRest: false`; (e) a package with no `scene.json` member, `undefined`.
- [x] **Step 5: Implement `readSceneFacts`** — parse `scene.json` through `pkg.ts`, require an `objects` array, then: `atRest` is false when any object has `particle` or `animationlayers`, or when the parsed tree contains an `animation` key **anywhere** (a recursive walk, since keyframes sit under `origin`, `alpha` and shader constants — 19 scenes in the local library carry one). `hasText` is true when any object has `text`. A keyframed `animation` inside a `sound` object still counts: the rule is "does anything move".
- [x] **Step 6: Add the model case the spec defers** — an object with `"model": "models/x.json"` whose member carries a `"animation"` key must return `atRest: false`; the same model without it, `true`. If no such reference exists in the shipped format, the test documents the shape the parser accepts and the field stays for the day it appears.
- [x] **Step 7: Green, `npx tsc --noEmit`, commit** `feat(wallpaper-engine): read the scene container and classify a still theme`.

## Task 3: Locate the install, scan the library, resolve an item

**Files:**
- Create: `src/web/packages/host/src/wallpaper-engine/locate.ts`
- Create: `src/web/packages/host/src/wallpaper-engine/locate.test.ts`
- Create: `src/web/packages/host/src/wallpaper-engine/library.ts`
- Create: `src/web/packages/host/src/wallpaper-engine/library.test.ts`
- Create: `src/web/packages/host/src/wallpaper-engine/resolve.ts`
- Create: `src/web/packages/host/src/wallpaper-engine/resolve.test.ts`
- Create: `src/web/packages/host/src/wallpaper-engine/wire.ts`

**Interfaces:**

```ts
// locate.ts
export interface WallpaperEngineInstall {
  readonly root: string;                 // <steam>/steamapps/common/wallpaper_engine
  readonly libraries: readonly string[]; // <library>/steamapps/workshop/content/431960
  readonly myProjects: string;           // <root>/projects/myprojects
  readonly editor: string;               // <root>/bin/wallpaperui.exe
}
export async function locateInstall(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<WallpaperEngineInstall | undefined>;

// library.ts
export interface LibraryItem {
  readonly workshopId: string;
  readonly directory: string;
  readonly title: string;
  readonly payload: string;              // absolute path of `project.file`
  readonly type: "scene" | "video" | "web";
  readonly preview: string | undefined;
  readonly filesize: number;
  readonly tags: readonly string[];
  readonly authorSteamId: string | undefined;
  readonly workshopUrl: string | undefined;
  /** The descriptor's own `properties` schema, passed through unread. The user's
   *  chosen values live in Wallpaper Engine's root `config.json` (§1.3) and are
   *  never written by anything here (R1). */
  readonly properties: unknown;
}
export interface LibraryScan { readonly items: readonly LibraryItem[]; readonly skipped: number }
export async function scanLibrary(install: WallpaperEngineInstall): Promise<LibraryScan>;

// resolve.ts
export const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"] as const;
export type ItemPayload =
  | { readonly kind: "image"; readonly path: string; readonly contentType: string }
  | { readonly kind: "video"; readonly path: string; readonly contentType: string }
  | { readonly kind: "web" }
  | { readonly kind: "scene"; readonly path: string };
export function resolvePayload(item: LibraryItem): ItemPayload | undefined;
```

- [x] **Step 1: Write the failing `locate.test.ts`** against a temp tree built with `os.tmpdir()`: a fake Steam root with `steamapps/libraryfolders.vdf` naming two libraries, one holding `workshop/content/431960`, and a fake install with `bin/wallpaperui.exe` and `projects/myprojects/`. Assert the returned `libraries` has the one real content directory, and that a tree with no install returns `undefined`. A second case: `platform: "linux"` returns `undefined` without touching `reg`.
- [x] **Step 2: Implement `locateInstall`** — candidates in order: `env.YUNARI_WALLPAPER_ENGINE` (a path to the install root, the test hook), `reg query HKCU\Software\Valve\Steam /v SteamPath` through `execFile` (the pattern `themes/trash.ts` already uses), `C:\Program Files (x86)\Steam`, `C:\Program Files\Steam`. Read `steamapps/libraryfolders.vdf` with a line reader for `"path"` values — no dependency, no full VDF grammar. A library counts when `steamapps/workshop/content/431960` exists; the install counts when `bin/wallpaperui.exe` does.
- [x] **Step 3: Write the failing `library.test.ts`** against a fixture library of four directories plus a `workshopcache.json`: a scene (untyped cache row), a video typed `Video`, a web typed `web`, a preset whose `project.json` has a `preset` object and no `type`, and one directory with a malformed `project.json`. Assert three items, `skipped === 2` (the preset and the malformed), the video's `type === "video"` despite the cache's capital V, and the scene's attribution fields filled from the cache row.
- [x] **Step 4: Implement `scanLibrary`** — read directories, `JSON.parse` each `project.json`, lowercase `type`, drop an entry with a `preset` object and no `type`, drop `package.workshopId`-less directories with no cache row **only when the directory name is not numeric**. Join `workshopcache.json` by `workshopid` for `title`, `filesize`, `tags`, `authorsteamid` and `workshopurl`; a missing row leaves those absent, never invented. Skip and count every refusal.
- [x] **Step 5: Write the failing `resolve.test.ts`** — each outcome in spec §4's order, including a `scene` item whose payload is missing (returns `undefined`, which the caller drops) and a video typed `video` whose payload is `.wmv`.
- [x] **Step 6: Implement `resolvePayload`** — first match wins: an image extension on `project.file` is `image` **before** any `type` check; `type: video` is `video`; `type: web` is `web`; `type: scene` is `scene`. The payload must exist (`fs.stat`) or the answer is `undefined`.
- [x] **Step 7: Write `wire.ts`** with `StoredItem` exactly as spec §5.2 lists it and `toStoredItem(item, payload, facts?)`: `kind` from the payload, `filesize` from the cache row or the payload's own size, `attribution` absent when both fields are, `stillAtRest`/`hasText` present only when `facts` is.
- [x] **Step 8: Green, `npx tsc --noEmit`, commit** `feat(wallpaper-engine): find the install, scan the library, resolve an item`.

## Task 4: The read routes

**Files:**
- Create: `src/web/packages/host/src/wallpaper-engine/source.ts`
- Create: `src/web/packages/host/src/wallpaper-engine/source.test.ts`
- Modify: `src/web/packages/host/src/server.ts` (one option, three route blocks)
- Modify: `src/web/packages/host/src/main.ts` (construct the source and pass it)

**Interfaces:**

```ts
// source.ts — the whole host surface behind one object the server takes as an option
export type UnavailableReason = "not-installed" | "unsupported-platform" | "no-library";
export interface WallpaperEngineListing {
  readonly available: true;
  readonly install: string;
  readonly items: readonly StoredItem[];
  readonly skipped: number;
}
export type WallpaperEngineAnswer =
  | WallpaperEngineListing
  | { readonly available: false; readonly reason: UnavailableReason };
export interface WallpaperEngineSource {
  readonly listing: () => Promise<WallpaperEngineAnswer>;
  readonly bytesOf: (workshopId: string, part: "preview" | "asset") => Promise<{ readonly bytes: Uint8Array; readonly contentType: string } | undefined>;
}
export function createWallpaperEngineSource(options?: {
  readonly locate?: typeof locateInstall;
  readonly classify?: typeof readSceneFacts;
}): WallpaperEngineSource;
// HostServerOptions gains: readonly wallpaperEngine?: WallpaperEngineSource;
```

**Routes** (added beside `/api/themes`):

```
GET /api/wallpaper-engine              → WallpaperEngineAnswer
GET /api/wallpaper-engine/item/<id>/preview → image bytes | 404
GET /api/wallpaper-engine/item/<id>/asset   → payload bytes | 404
```

- [x] **Step 1: Write the failing `source.test.ts`** against a fixture install, injecting `locate` so no real install is read. Assert: a listing with three items where the scene has `stillAtRest` and `hasText`; a scene whose `scene.pkg` is truncated has **no** `stillAtRest` and is still listed; `skipped` counts the malformed directory; an absent install answers `{ available: false, reason: "not-installed" }`.
- [x] **Step 2: Implement `createWallpaperEngineSource`** — locate once per `listing()` call (a Steam library can appear while the editor is open), scan, resolve, classify only `image`/`video`/`scene` payloads as needed, `scene.pkg` read once per item and its facts reused for `bytesOf`. `bytesOf("asset")` reads the payload through `resolvePayload`; `bytesOf("preview")` reads the project's `preview` path. Both return `undefined` rather than throwing.
- [x] **Step 3: Write the failing server test** in `server.test.ts` (the file already has a fixture harness) — `GET /api/wallpaper-engine` answers the injected source's listing verbatim; the two byte routes answer 200 with the right `content-type` and 404 for an unknown id; `GET` on a POST-only path answers 405 once Task 5 adds it.
- [x] **Step 4: Add the option and the three route blocks** in `server.ts`, matching the surrounding `if (url.pathname === …)` style: `sendJson` for the listing, `writeHead(200, { "content-type": contentType, "cache-control": "no-store" })` for bytes, `sendText(response, 404, …)` otherwise. When the option is absent the route answers `{ available: false, reason: "not-installed" }` — tests and non-Windows hosts keep working unchanged.
- [x] **Step 5: Construct and pass it from `main.ts`**, beside the other stores.
- [x] **Step 6: Green, `npx tsc --noEmit`, `npx biome check ..`, commit** `feat(host): serve the Wallpaper Engine library`.

## Task 5: Unpack, launch, and the export routes

**Files:**
- Create: `src/web/packages/host/src/wallpaper-engine/unpack.ts`
- Create: `src/web/packages/host/src/wallpaper-engine/unpack.test.ts`
- Modify: `src/web/packages/host/src/wallpaper-engine/source.ts`
- Modify: `src/web/packages/host/src/server.ts`

**Interfaces:**

```ts
// unpack.ts
export type UnpackResult =
  | { readonly ok: true; readonly name: string; readonly reused: boolean }
  | { readonly ok: false; readonly reason: "no-install" | "unreadable" | "refused" };
export async function unpackScene(install: WallpaperEngineInstall, item: LibraryItem): Promise<UnpackResult>;
/** Detached: resolves once spawned, never waits for the editor, never writes. */
export function launchEditor(install: WallpaperEngineInstall, projectDirectory: string): void;

export interface ExportFile { readonly name: string; readonly format: "png" | "mp4"; readonly modified: number; readonly size: number }
```

`WallpaperEngineSource` gains `project(workshopId)`, `exportsSince(since)`, `exportBytes(name)`.

**Routes:**

```
POST /api/wallpaper-engine/item/<id>/project → UnpackResult
GET  /api/wallpaper-engine/exports?since=<epochMs> → { files: ExportFile[] }
GET  /api/wallpaper-engine/export?name=<name>     → bytes | 404
```

- [x] **Step 1: Write the failing `unpack.test.ts`** against a hand-built package and a temp install. Assert: every member lands under `projects/myprojects/<workshopId>/` with bytes identical to `memberBytes` (compare with `Buffer.compare`, not length); a `project.json` is written whose `file === "scene.json"` while its `title` survives; a second call answers `reused: true` and rewrites nothing (assert an `fs.stat` mtime and a byte compare); a truncated package answers `unreadable` **and the directory does not exist afterwards**; an existing directory is never written into — put a sentinel file in it first and compare before and after.
- [x] **Step 2: Implement `unpackScene`** — `fs.mkdir(directory)` **without `recursive`**: `EEXIST` is the reuse branch (`reused: true`, launch, return). Otherwise write every member from the table (no decompression), then the descriptor: the item's `project.json` parsed, `file` set to `"scene.json"`, written with two-space indent. On any error after the `mkdir`, `fs.rm(directory, { recursive: true, force: true })` — the directory this run created — and answer `unreadable`; a failure to create answers `refused`. **Never** remove a directory whose creation this run did not observe.
- [x] **Step 3: Implement `launchEditor`** — `spawn(install.editor, ["-project", projectDirectory], { detached: true, stdio: "ignore" }).unref()`, wrapped so a non-existent binary is caught and reported, not thrown into the request. **No stdin, no arguments after the launch, no polling of the process** (R1).
- [x] **Step 4: Write the failing export-route tests.** `exportsSince` returns only `.png` / `.mp4` files newer than `since`, newest first, from the three scoped directories; `exportBytes` answers `undefined` for `"../project.json"`, `"a/b.png"`, `"x%2e%2e/y.png"`, `"x.png.exe"` and `"x.jpg"`, and bytes for a real file in scope. Assert the traversal cases specifically: decode the query with `URLSearchParams`, then refuse any name that `path.basename(name) !== name` or whose extension is not `.png`/`.mp4`.
- [x] **Step 5: Implement the three routes.** `POST /project` parses no body; the item id is the whole request, which is what makes the silent unpack possible (R8). `exports` takes `since` as a required integer and refuses anything else with 400 rather than defaulting to the epoch — a missing `since` would offer every old file on the machine.
- [x] **Step 6: Green, `npx tsc --noEmit`, commit** `feat(host): unpack a scene theme and read the export`.

## Task 6: The editor's source, for image, video and web

> **Amended 2026-10-21, before dispatch.** The editor surface is the **asset finder's
> modal** (`docs/superpowers/specs/2026-10-21-asset-finder-design.md`), not a
> section of the Add pane. If that spec has landed, this task becomes "register
> `wallpaper-engine` as a local source in `host/src/assets/sources.ts` and give it
> the per-kind actions of Task 7" — no new surface. If it has not landed, do not
> build a second one: run Tasks 1–5, then wait. The host half is unaffected.

**Files:**
- Create: `src/web/packages/editor/src/wallpaper-engine/client.ts`
- Create: `src/web/packages/editor/src/wallpaper-engine/client.test.ts`
- Create: `src/web/packages/editor/src/panes/add/wallpaper-engine-section.tsx`
- Create: `src/web/packages/editor/src/panes/add/wallpaper-engine-section.dom.test.tsx`
- Modify: `src/web/packages/editor/src/panes/add/file-section.tsx` (mount the section)
- Modify: `src/web/packages/editor/src/ui-copy.ts`

**Interfaces:**

```ts
// client.ts
export type WallpaperEngineAnswer =
  | { readonly available: false; readonly reason: "not-installed" | "unsupported-platform" | "no-library" }
  | { readonly available: true; readonly items: readonly WallpaperEngineItem[] };
export interface WallpaperEngineItem {
  readonly workshopId: string; readonly title: string;
  readonly kind: "image" | "video" | "web" | "scene";
  readonly previewUrl: string | undefined; readonly filesize: number;
  readonly tags: readonly string[];
  readonly stillAtRest: boolean | undefined;
  readonly hasText: boolean | undefined;
}
export async function fetchWallpaperEngine(fetchImpl?: typeof fetch): Promise<WallpaperEngineAnswer>;
export async function fetchItemAsset(workshopId: string): Promise<File>;
export async function fetchItemPreview(workshopId: string): Promise<Blob | undefined>;
```

- [x] **Step 1: Write the failing `client.test.ts`** with an injected `fetch`: a 200 listing parses; a 200 whose body is not the shape answers `available: false` rather than throwing; a rejected fetch answers `available: false`; `fetchItemAsset` names the file by the item's `title` plus the payload extension so the asset manager sees a real filename.
- [x] **Step 2: Implement `client.ts`** — read through `Object.hasOwn`, no `any`, and never fabricate an item from a malformed row (skip it).
- [x] **Step 3: Write the failing DOM test** for the section: with no listing it renders nothing (`container.innerHTML === ""`); with four items it renders four rows with a kind label and a size; clicking an image row calls the injected `importAsset` with the fetched `File`; a `web` row renders its refusal and has no import button. **A `scene` row renders the "Open in Wallpaper Engine" action** and no import button — Task 7 wires what that action does.
- [x] **Step 4: Implement the section** — `ControlSelect`-free; a plain list with `data-yunari-wallpaper-engine-item`, `-import`, `-open` attributes, and every string from `uiCopy.panels`. Reuse `manager.import(file)` through the prop the Add pane already passes down, so the caps and reference model are the asset manager's, not a second copy.
- [x] **Step 5: Mount it in `file-section.tsx`**, above the declared-asset list, fetching once on mount and staying silent when unavailable. The existing DOM test must pass unchanged — that is Review Focus 5's proof.
- [x] **Step 6: Green, `npx tsc --noEmit`, commit** `feat(editor): list the Wallpaper Engine library in the Add pane`.

## Task 7: The scene flow — unpack, launch, guide, import

> **Amended 2026-10-21:** the sheet is opened from the asset finder's modal and
> its `Open in Wallpaper Engine` action; the guidance and import steps below are
> unchanged, but the surface they render in is the finder's.

**Files:**
- Create: `src/web/packages/editor/src/wallpaper-engine/export-sheet.tsx`
- Create: `src/web/packages/editor/src/wallpaper-engine/export-sheet.dom.test.tsx`
- Modify: `src/web/packages/editor/src/wallpaper-engine/client.ts` (`startProject`, `findExports`, `fetchExport`)
- Modify: `src/web/packages/editor/src/panes/add/wallpaper-engine-section.tsx`
- Modify: `src/web/packages/editor/src/ui-copy.ts`

**Interfaces:**

```ts
export async function startProject(workshopId: string): Promise<{ ok: true; name: string; reused: boolean } | { ok: false; reason: string }>;
export interface ExportFile { readonly name: string; readonly format: "png" | "mp4"; readonly modified: number; readonly size: number }
export async function findExports(since: number): Promise<readonly ExportFile[]>;
export async function fetchExport(name: string): Promise<File>;
export function ExportSheet(props: {
  readonly item: WallpaperEngineItem;
  readonly onImported: (assetId: string) => void;
  readonly onDone: () => void;
}): React.JSX.Element;
```

- [x] **Step 1: Write the failing DOM test.** For a still item with `hasText: true`: the sheet shows the delete-the-text step, `PNG`, `1920 × 1080`, no duration row. For an animated item: `MP4`, `30 fps`, `5 s`, `1 s` blend, and the text step **only when `hasText`**. For a still item with `hasText` absent or false: no text step. Clicking "Open" calls `startProject` once; a refusal renders `reason` and does not retry. A poll that returns a file renders the import action; importing calls `onImported` with the asset id.
- [x] **Step 2: Implement the sheet** — the format table is a pure function `exportSettingsOf(item)` returning `{ format: "png", width: 1920, height: 1080 } | { format: "mp4", width: 1920, height: 1080, fps: 30, durationSeconds: 5, blendSeconds: 1 }`, unit-tested directly. The text step is `item.hasText === true`, never `!== false`.
- [x] **Step 3: Wire the watcher** — on open record `Date.now()`, then poll `findExports(since)` every 2 s while mounted, stopping on unmount and after the first import. The poll's `since` is the sheet's open time, not `Date.now()` per tick, or a file written before the sheet opened could be offered. The newest match is offered; nothing is auto-imported.
- [x] **Step 4: Import through the ordinary path** — `manager.import(file)` in the asset manager, then set `backgroundMedia` on the artboard through the same commit the background-media field uses, then `onImported(asset.id)`.
- [x] **Step 5: Check the copy against the ruling** — the step reads as a required instruction ("Delete the clock and any other dynamic text before exporting"), not a tip, and the sheet says once that the unpack leaves a project in Wallpaper Engine's own list. Both strings live in `ui-copy.ts`. The sheet also prints the project directory name the host returned, because `-project`'s selection is unverified (§12, open question 1): if the editor opens without it, the name is what the author picks from the list.
- [x] **Step 6: Green, `npx tsc --noEmit`, commit** `feat(editor): guide a scene theme's export`.

## Task 8: `credits.json`, the package's attribution member

**Files:**
- Modify: `src/web/packages/theme-package/src/index.ts` (the constant, the manifest check, the entry allowance, the export)
- Modify: `src/web/packages/theme-package/src/index.test.ts`
- Modify: `src/web/packages/host/src/wallpaper-engine/wire.ts` (build an entry per imported item)
- Modify: `src/web/packages/editor/src/ui-copy.ts` and the theme details surface that lists credits

**Interfaces:**

```ts
// theme-package
export const CREDITS = "credits.json";
export interface ThemeCreditsEntry {
  readonly kind: string; readonly title: string;
  readonly author?: { readonly steamId: string };
  readonly source?: { readonly workshopId: string; readonly url: string };
  readonly license: string; readonly changes: string;
}
export interface ThemeCredits { readonly format: "yunari-theme-credits"; readonly version: 1; readonly entries: readonly ThemeCreditsEntry[] }
export function readThemeCredits(bytes: Uint8Array): ThemeCredits | undefined;
```

- [x] **Step 1: Write the failing theme-package tests.** A package carrying `credits.json` and naming it in the manifest round-trips through `createThemePackage` → `readThemePackage`; a package carrying the file **without** naming it is refused; a manifest naming it **without** the file is refused; a credits file over the entry cap is refused. The existing "assets must exactly match" message must not be the one that fires for a named credits file — assert the specific message.
- [x] **Step 2: Implement it** — `CREDITS` joins `MANIFEST`, `THEME` and `THUMBNAIL` in the filter's allow-list, in the manifest's `credits` check beside `thumbnail`, and in the exactly-matching rule's exception. `readThemeCredits` is total: a non-object, a wrong `format`, or a `version` other than 1 answers `undefined`.
- [x] **Step 3: Write the failing host test** — an imported item produces one entry with `kind: "wallpaper"`, the title, `author.steamId` from the cache row, `source.workshopId`/`url`, `license: "unknown"`, and `changes` naming the normalizer's profile or `"Copied unchanged"`.
- [x] **Step 4: Implement the entry builder** in `wire.ts` as `creditsEntryOf(item, change)`.
- [x] **Step 5: Render the credits** where the theme's details already render its other facts: one line per entry, the workshop URL as a link, `license` shown even when it is `unknown`.
- [x] **Step 6: Green, `npx tsc --noEmit`, `npx biome check ..`, commit** `feat(theme-package): carry a credits member`.

## Task 9: The boundary — what a person actually sees

**Controller-reviewed boundary task.** No product source changes in this task; a claim that fails is a finding to report.

**Files:**
- Modify: `docs/evidence/screenshots/README.md` (register each capture before taking it)
- Create: `tests/e2e/wallpaper-engine.spec.ts`

- [x] **Step 1: Register three captures** in the registry's table: the Add pane's Wallpaper Engine list, the still sheet with the text step, and the animated sheet. A capture that is not registered may not be taken.
- [x] **Step 2: Write the e2e spec** with `page.route("**/api/wallpaper-engine", …)` and the item routes, over a fixture listing of image, video, web, still-scene-with-text, animated-scene and scene-without-text. Assert a rendered claim per kind, including that a still item's sheet prints `PNG` and no duration, and the animated one prints `5 s`.
- [x] **Step 3: Red-proof three things** — break the text step's condition to `!== false` and watch the no-text case fail; break `readSceneFacts` to ignore keyframes and watch the keyframe fixture class itself as still; break `unpackScene`'s `file` rewrite and watch the descriptor assertion fail. Restore each from a copy kept **outside** the repo and verify with **`cmp`**, never `git checkout`.
- [x] **Step 4: Run the host integration path once against a real install** with `YUNARI_WALLPAPER_ENGINE` pointing at this machine's Wallpaper Engine, asserting the listing's count and that a scene's unpack writes `file: "scene.json"`. Do **not** launch the editor in the test; assert the launch by spying on `spawn`.
- [x] **Step 5: Run the gates** from `src/web/`: `npm run build`, `npx playwright test tests/e2e/wallpaper-engine.spec.ts --workers=1`, `npm run typecheck`, `./node_modules/.bin/biome check ..` — each to a file, each exit code read directly, never through a pipe.
- [x] **Step 6: Report** what was seen in each capture, the red proofs with their failure text and `cmp` results, and what a routed fixture cannot prove (the real export dialog, the real launch without a device attached).

---

## Self-review notes

- Spec §12's open questions are not silently answered: `-project`'s semantics stay a Phase-6 convenience (Task 5 launches with the flag and Task 9 asserts only that the process is spawned), and the export dialog's default location is why Task 5's watcher scope is fixed.
- The video normalizer (§6) is not built here: Task 6 imports a video item through `manager.import` and Task 7 through the same path; when the store's normalizer lands, both call it. Until then a video over the cap is refused by the asset manager and the refusal is shown.
- `credits.json` is Task 8 rather than interleaved because no earlier task writes a package.

## Outcome (2026-10-23)

Landed through 14 task commits plus two review-fix commits. The whole-branch
review returned no Critical issue; its three Important findings (kind filter and
title search, the baked-in-clock sentence, video through the normalizer) and
four minors were fixed in `b30c9d53` and `3396b225`. Final gate: 341 test files
and 4,728 tests, plus the worker's 12 files and 72 tests, exit 0.

Decisions taken during execution that this plan did not spell out:

- **A subscribed scene's payload is `<dir>/scene.pkg`** when it exists, not the
  `scene.json` its descriptor names; the disk is the truth, and §1.2/§8.1 were
  corrected to say so.
- **A `.pkg` member is untrusted third-party input.** A name that is absolute,
  carries a drive letter or backslash, or holds an empty, `.` or `..` segment
  refuses the unpack; safe nested paths are written with their parents. A real
  package has 17 of 18 members under `particles/`, `materials/` and `models/`.
- **The unpack requires a `scene.json` member**, and the target directory name
  is always resolved from the scan, never from the request.
- **`launchEditor` reports a real spawn**, not an accepted call, and never waits
  for or drives the editor.
- **Both video entries cross the shared normalizer** — a video item and a
  scene's exported MP4; a PNG is imported as served. The credit's `changes`
  follows the normalizer's `reencoded` answer.
- **The theme-package credits half was already landed** and was verified, not
  rebuilt. No theme-details surface exists to draw an entry, so the drawing was
  filed as `vg-708` rather than invented here.
- **No scene-facts cache.** A listing re-reads and reclassifies each package on
  each mount; bytes are never retained. Add a `path + mtime` facts cache if
  listing latency ever matters.
