# The asset finder — Implementation Plan

> **Landed 2026-10-23** (Tasks 1–15, 17–19; Task 16 moved to
> [`2026-10-21-wallpaper-engine-import.md`](2026-10-21-wallpaper-engine-import.md),
> whose amended Tasks 4, 6 and 7 build the Wallpaper Engine host module and the
> finder's local tab). The rulings live in `.superpowers/sdd/2026-10-21-asset-finder/progress.md`.
> Unchecked steps below are not a status: many were ticked in the work, not in the list.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One modal where an author finds and imports outside material — fonts, icons, and a Wallpaper Engine theme already on disk — over an expandable source registry and a host-side credential store the host's future data providers share.

**Architecture:** Every provider call is the host's (`host/src/assets/`): one `AssetSource` port, one registry array, one search route that merges each enabled source's page. The editor holds a thin fetch client and the modal; the asset manager stays the only owner of imported bytes, and the font picker moves into the modal rather than being rebuilt.

**Tech Stack:** TypeScript, Node 22.12+, React 19, Base UI `Dialog`, Vitest, Playwright, Biome. **No new dependency** — `lucide-react` is already installed, Font Awesome is one HTTP GET, and the credential file is `node:fs`.

**Spec:** `docs/superpowers/specs/2026-10-21-asset-finder-design.md`. Read §1, §2, §3, §4, §5, §8 and §11 with this plan. Drawings: `docs/design/mockups/current/asset-finder-*.html` and `settings-connections.html`.

**Decision:** a note under `docs/decisions/`, landed in Task 1 before the first write to `host/src/server.ts` (a watchlisted path). **Take the next free number at landing** — `0089` is already the install plan's, and the queued Wallpaper Engine plan also claims `0089`, so do not pin a number here.

**Status:** **Active** (2026-10-23, inline execution in `asset-finder-hub`). The Wallpaper Engine plan (`2026-10-21-wallpaper-engine-import.md`) has since landed and is archived beside this one: Task 15 absorbs its `credits.json` member, and Task 16 stays blocked until that plan's host module exists.

**Scope change 2026-10-23 (user).** The provider list is Icons: **Lucide, Font Awesome Free, Lineicons**; Images: **Unsplash**. Free results only. **Flaticon is not built**: its official v3 API documents no premium/free flag (the Icon schema has no such field), so a free-only promise cannot be enforced; the user's decision is to leave it out. Lineicons ships as a free MIT npm package with no search API, so its manifest is generated from a **dev-only** dependency. Execution order for the remaining tasks is **5–8, 18 (Lineicons), 13 (Font Awesome), 19 (Unsplash), then 9–12, 14, 15, 17**; 16 waits on the Wallpaper Engine plan.

## Rulings the spec leaves open

These are decisions the spec does not make; each is settled here so a task does not have to guess.

1. **The Fonts tab is the existing `FontPicker`, not a generic grid.** Spec §6 forbids rebuilding the catalogue browser, and §3's `curated-fonts` host source would be a second search over data already in the editor bundle. So the registry distinguishes a category that is **searched** (a grid) from one that has a **body** the editor already owns (`font-picker`) or another plan owns (`wallpaper-engine`). Consequence: there is no `@yunari/font-catalog` package move and no host-side curated adapter; the generated table stays where it is.
2. **Wire types live in `renderer-core`**, beside the catalogue index's, because host and editor both speak them and the repo has already refused a duplicated wire type (`vg-689`).
3. **Lucide's icon data is generated into the host at build time** (`scripts/generate-lucide-icons.mjs`). The host must not import `lucide-react`: every icon module reaches `createLucideIcon`, which imports React, and React is not the host's dependency.
4. **Font Awesome is pinned to one jsDelivr version**, and its preview is the CDN's own SVG URL. This is the store's existing treatment for thumbnails, and it is why the search answer carries a `preview` URL rather than only an id.
5. **Credits are document-scoped and written at publish.** `EditorDocument` collects entries; `writeThemePackage` writes `credits.json`. Reopening a package seeds the collection from its member. This is the half the Wallpaper Engine plan's Task 8 does not build.
6. **v1 ships an empty credential registry.** No source needs a key, so Connections renders its honest empty sentence; the store and its routes exist because the next keyed source (a stock image or video provider) and the host's data providers both need them (spec §3).

## Global Constraints

- **One dev-only dependency, nothing shipped.** `lineicons@1.3.2` (MIT, 600 free SVGs) is a `devDependency` read only by `scripts/generate-lineicons.mjs`; the host loads generated data, never the package. No keychain module, no HTTP client, no shipped icon package, no font package.
- **The browser never calls a provider and never holds a key** (R3). Search, bytes and preview URLs are the host's answers.
- **A key is never returned, logged or echoed.** `GET /api/credentials` answers `set` and a four-character `hint`; an error names the credential, never its value (R6).
- **Only `bearer` is implemented** (R10). A `cookie` entry is refused at write time with a message naming the ruling.
- **Attribution is not optional** (R7): an import with no credits entry is not an import.
- **The registry is data.** Adding a source is one entry in `host/src/assets/sources.ts` plus its adapter; adding one must not touch a file under `editor/src/asset-finder/` except a category body it declares.
- **The asset manager stays the only owner of bytes**, caps included. The finder adds no downloader and no second asset model.
- **`renderer-core` stays Fabric-free and DOM-free**, and gains only the wire module.
- **500 lines is a signal, 800 is a stop** for a source file. `host/src/server.ts` is already 103 KB: its additions are one import, one `HostServerOptions` field and one route block, and everything else lives in `host/src/assets/`.
- **Copy lives in `ui-copy.ts`.** Every user-visible sentence this plan adds goes there.
- Never `git add -A` or `git commit -a`; commit explicit paths.

## Review Focus

The failure modes the spec implies but no happy path exercises, most likely to bite a person first. Each gets its test in the task that owns the code.

1. **Two searches race, and the older answer arrives last.** The grid must render the newer query, never the stale page. → Tasks 10 and 14.
2. **A source the author disabled is still called**, spending the request the chip was meant to save, or its rows linger in the grid. → Tasks 7 and 10.
3. **Every source fails.** The grid must say each source's own failure, and must not read as "no results". → Tasks 7 and 10.
4. **A credential value reaches the browser** through a response body, an error message or a log line. → Tasks 3 and 4.
5. **An icon imports with no licence or attribution**, and publishes without a credits entry. → Task 15.

---

## Task 1: The decision note

**Controller task, not delegated.** The gate refuses the first write to a watchlisted path — this plan adds routes to `host/src/server.ts` — until a note claims it.

**Files:**
- Create: `docs/decisions/<next free number>-the-asset-finder-is-host-searched.md`

- [ ] **Step 1: Write the note** in `docs/decisions/README.md`'s template: the problem (an author has no one place to find outside material, and a key has no owner), and all seven rungs with **the searches that were run**, copying spec §10 and citing the evidence each rung stood on: the eight host settings stores, `lucide-react`'s presence at `docs/engineering/dependencies.md`, Base UI's `Dialog`, and the ecosystem comparison.
- [ ] **Step 2: Rung 4 names the queries**, not just the libraries: "editor asset search provider registry", "VS Code tree view data provider", "Figma plugin asset panel", "Penpot asset library". Record that no editor solves attribution for a published artifact, which is why `credits.json` is Yunari's own.
- [ ] **Step 3: Record the departure in the note** — spec §3's `curated-fonts` host source is not built, because the Fonts tab reuses `FontPicker` (spec §6). One paragraph, naming both sections.
- [ ] **Step 4: Status `accepted`, Date `2026-10-21`**, and a `Paths:` line naming `src/web/packages/host/src/server.ts`, `src/web/packages/host/src/assets/`, `src/web/packages/host/src/settings/credentials.ts`, `src/web/packages/renderer-core/src/assets/` and `src/web/packages/editor/src/asset-finder/`.
- [ ] **Step 5: Commit** `docs(decisions): the asset finder is searched by the host`.

## Phase 1 — Credentials

### Task 2: The credential store

The file, its tolerant read and its hint. No route yet.

**Files:**
- Create: `src/web/packages/host/src/settings/credentials.ts`
- Create: `src/web/packages/host/src/settings/credentials.test.ts`

**Interfaces:**

```ts
export interface StoredCredential { readonly value: string; readonly savedAt: string }
export interface CredentialStore {
  /** Every entry, keyed by credential id. A bad entry is dropped, not fatal. */
  read(): Promise<Readonly<Record<string, StoredCredential>>>;
  valueOf(id: string): Promise<string | undefined>;
  write(id: string, value: string, savedAt: Date): Promise<void>;
  clear(id: string): Promise<void>;
}
/** The last four characters, and never more: the only part a browser sees. */
export function hintOf(value: string): string;
export function createCredentialStore(directory: string): CredentialStore;
```

- [ ] **Step 1: Write the failing `credentials.test.ts`** in a `mkdtempSync()` directory: `write` then `read` holds one entry with its ISO `savedAt`; `clear` removes it and leaves the others; a hand-edited file holding `{ "k": { "value": 7 } }`, a non-object, and an `__proto__` key reads as the surviving entries rather than throwing; `hintOf("sk-live-9f2c")` is `"9f2c"` and `hintOf("ab")` is `"ab"`; a value shorter than four characters yields its own length, never padded.
- [ ] **Step 2: Run it and watch it fail** — `npx vitest run packages/host/src/settings/credentials.test.ts` from `src/web/`.
- [ ] **Step 3: Implement it** with `theme-origins.ts`'s shape: `FILE = "credentials.json"`, a `normalize()` that keeps only entries whose `value` is a non-empty string and whose `savedAt` parses as a date, and a serialized read-modify-write queue so two writers cannot interleave. The id pattern is `/^[A-Za-z0-9_-]{1,64}$/`.
- [ ] **Step 4: Green, `npx tsc --noEmit`, commit** `feat(host): store credentials beside the other settings`.

### Task 3: The known credentials and the four routes

**Files:**
- Create: `src/web/packages/host/src/settings/credentials-registry.ts`
- Create: `src/web/packages/host/src/settings/credentials-registry.test.ts`
- Modify: `src/web/packages/host/src/server.ts` (one import, one option field, one route block)
- Modify: `src/web/packages/host/src/server.test.ts`
- Modify: `src/web/packages/host/src/main.ts` (`createCredentialStore(settingsDir)` beside `createFontFavoritesStore`)

**Interfaces:**

```ts
export type CredentialKind = "bearer" | "cookie";
export interface KnownCredential {
  readonly id: string;
  readonly label: string;
  readonly kind: CredentialKind;
  /** Absent when nothing can be checked without spending a real request. */
  readonly verify?: (value: string, fetchImpl: typeof fetch) => Promise<
    { readonly ok: true } | { readonly ok: false; readonly message: string }
  >;
}
/** Empty in v1 (spec §3): the first keyed source adds its entry here. */
export const KNOWN_CREDENTIALS: readonly KnownCredential[];
```

Wire shapes. The row is declared **here**, in `credentials-registry.ts`, and switches to the shared type in Task 5 — Task 5 lands after this one, so this task cannot import it yet.

```text
GET    /api/credentials              → [{ id, label, set, hint }]   (hint "" when unset)
PUT    /api/credentials/<id>         body { value } → { ok: true }
DELETE /api/credentials/<id>         → { ok: true }
POST   /api/credentials/<id>/verify  → { ok: true } | { ok: false, message }
```

- [ ] **Step 1: Write the failing `server.test.ts` cases.** GET answers every known credential with `set`/`hint` and **no `value`** anywhere in the body; PUT then GET reads `set: true, hint: "9f2c"`; DELETE returns it to `set: false, hint: ""`; PUT for an id the table does not know is 400; PUT for a `cookie` entry is 400 with a message naming R10; PUT with an empty value is 400; verify for an entry without `verify` is 400 rather than a silent success; a non-loopback request is 403. Inject `fetch` so a verifier is tested without a network.
- [ ] **Step 2: Implement the registry** with one `cookie` fixture entry **in the test file only** — `KNOWN_CREDENTIALS` stays empty, and the refusal is proven against the fixture, not against shipped data.
- [ ] **Step 3: Implement the route block** in `server.ts` after the `/api/font-favorites` block, with `isLoopbackRemote` and `readBody` as the install route uses them, and 503 when `credentials` is undefined — the same honest absence `/api/font-favorites` states.
- [ ] **Step 4: Wire `main.ts`**, then green, typecheck, commit `feat(host): answer for credentials without ever returning one`.

### Task 4: The Connections tab

**Files:**
- Create: `src/web/packages/editor/src/asset-finder/credentials-client.ts`
- Create: `src/web/packages/editor/src/asset-finder/credentials-client.test.ts`
- Modify: `src/web/packages/editor/src/editor-shell/settings.tsx` (`SettingsTab`, `SETTINGS_TABS`, `SETTINGS_TAB_GLYPHS`, the panel map)
- Modify: `src/web/packages/editor/src/editor-shell/settings.dom.test.tsx`
- Modify: `src/web/packages/editor/src/ui-copy.ts` (`settings.connections*`)

**Interfaces:**

```ts
export interface CredentialRow { readonly id: string; readonly label: string; readonly set: boolean; readonly hint: string }
export function listCredentials(options?: ClientOptions): Promise<readonly CredentialRow[]>;
export function saveCredential(id: string, value: string, options?: ClientOptions): Promise<Result>;
export function clearCredential(id: string, options?: ClientOptions): Promise<Result>;
export function verifyCredential(id: string, options?: ClientOptions): Promise<Result>;
// Result = { ok: true } | { ok: false; message: string }; ClientOptions = { baseUrl?, fetch? }
```

- [ ] **Step 1: Write the failing client test.** Each function names its route and method; a refusal carries the host's own sentence, not a status number alone; a network throw becomes `{ ok: false, message }`.
- [ ] **Step 2: Write the failing DOM test.** Settings has four tabs in order, Connections last; with no known credentials the panel renders the empty sentence (`uiCopy.settings.connectionsEmpty`); with one row it renders `Saved ····9f2c` for a set credential and `Not set` for an unset one; Verify is disabled when the row has no verifier; pressing Save calls `saveCredential` once and refreshes the row from the answer.
- [ ] **Step 3: Implement** the client as `theme-import.ts` is (fetch, text on refusal), the tab as a fourth entry in the two lists, and the panel with rows from the drawing (`docs/design/mockups/current/settings-connections.html`).
- [ ] **Step 4: Green, typecheck, biome, commit** `feat(editor): the Connections tab, and nothing in it shows a key`.

## Phase 2 — The registry and the first grid source

### Task 5: The wire contract in `renderer-core`

**Files:**
- Create: `src/web/packages/renderer-core/src/assets/wire.ts`
- Create: `src/web/packages/renderer-core/src/assets/wire.test.ts`
- Modify: `src/web/packages/renderer-core/src/index.ts` (the barrel export, beside `CatalogueIndex`)
- Modify: `src/web/packages/host/src/settings/credentials-registry.ts` and the Task 3 route block, to import `CredentialRow` from here

**Interfaces:**

```ts
export type SourceCategory = "font" | "icon" | "image" | "video";
export interface AssetResult {
  readonly id: string;                  // the source's own id; the host prefixes it
  readonly name: string;
  readonly preview: string;             // a URL the editor may render, or ""
  readonly subtitle: string | undefined;
  readonly licence: string;             // "unknown" rather than ""
  readonly sourceUrl: string;
}
/** `"local"` is a category no grid draws: it names a source that is a library
 *  on this PC rather than a provider, which is only Wallpaper Engine (R8). */
export type ListingCategory = SourceCategory | "local";
export interface AssetSourceListing {
  readonly id: string; readonly label: string;
  readonly category: ListingCategory;
  /** "grid" searches; "font-picker" and "wallpaper-engine" are editor bodies. */
  readonly body: "grid" | "font-picker" | "wallpaper-engine";
  readonly requires: string | undefined;
  readonly configurable: boolean;
}
export interface AssetSearchRequest {
  readonly query: string;
  readonly enabled: readonly string[];
  readonly cursors: Readonly<Record<string, string>>;
}
export interface AssetPage {
  readonly source: string;
  readonly results: readonly AssetResult[];   // ids already prefixed "<source>:<id>"
  readonly next: string | undefined;
  readonly failure:
    | { readonly reason: "failed"; readonly message: string }
    | { readonly reason: "needs-credential"; readonly credential: string }
    | undefined;
}
export interface AssetSearchAnswer { readonly pages: readonly AssetPage[] }
export function parseAssetSearchRequest(value: unknown, known: readonly string[]): AssetSearchRequest | undefined;
```

- [ ] **Step 1: Write the failing parser test.** A well-formed body parses; an unknown `enabled` id is dropped rather than refused (a stale browser preference must not fail the search); a body with no `query` or a non-array `enabled` is `undefined`; cursors that are not strings are dropped.
- [ ] **Step 2: Implement** the types and that one parser. No other runtime value: the rest are types.
- [ ] **Step 3: Green, typecheck, commit** `feat(renderer-core): the asset finder's wire contract`.

### Task 6: The Lucide manifest and its local source

**Files:**
- Create: `scripts/generate-lucide-icons.mjs`
- Create: `src/web/packages/host/src/assets/icons/lucide-icons.generated.ts` (generated, committed)
- Create: `src/web/packages/host/src/assets/icons/lucide.ts`
- Create: `src/web/packages/host/src/assets/icons/lucide.test.ts`
- Modify: `src/web/package.json` (an `icons:generate` script beside `fonts:generate`)

**Interfaces:**

```ts
// lucide.ts
export interface LucideIcon { readonly name: string; readonly svg: string }
export const LUCIDE_ICONS: readonly LucideIcon[];          // generated module
export function searchLucide(query: string, cursor: string | undefined): SearchPage;
export const lucideSource: AssetSource;                     // id "lucide", category "icon"
```

- [ ] **Step 1: Write the generator.** It walks `node_modules/lucide-react/dist/esm/icons/*.mjs`, dynamically imports each (dev-time only — the generated file is pure data, so the host never loads React), takes the module's `__iconData` export, and writes one entry per icon: `name` and an `svg` string built from `node` as `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">…</svg>`. Sorted by name, one entry per line, and a header naming `lucide-react` 1.48.0 and ISC as the source. Run it once with `npm run icons:generate`.
- [ ] **Step 2: Write the failing adapter test.** Every entry's `svg` starts with `<svg` and contains no `script`; `searchLucide("arrow down", undefined)` finds `arrow-down` (spaces and hyphens are one separator); an empty query answers the first 40 by name with a `next` cursor and the second page does not repeat the first; `bytesOf` answers `contentType: "image/svg+xml"` and a filename ending `.svg`; `creditsOf` answers `kind: "icon"`, `licence: "ISC"` and a `sourceUrl` naming lucide.dev.
- [ ] **Step 3: Implement** the search as a pure filter over the manifest plus an offset cursor (`"<offset>"`, refused when it is not a non-negative integer). The source declares `body: "grid"`, `requires: undefined`, `configurable: true`.
- [ ] **Step 4: Green, typecheck, commit** `feat(host): Lucide as a local icon source`.

### Task 7: The port, the registry, and the merged search

**Files:**
- Create: `src/web/packages/host/src/assets/source.ts`
- Create: `src/web/packages/host/src/assets/sources.ts`
- Create: `src/web/packages/host/src/assets/search.ts`
- Create: `src/web/packages/host/src/assets/search.test.ts`
- Create: `src/web/packages/theme-package/src/credits.ts` and a barrel export —
  the Wallpaper Engine plan's Task 8 is not landed, so the credits member this
  port consumes is defined here (`CREDITS`, `ThemeCreditsEntry`, `ThemeCredits`,
  `readThemeCredits`). Task 15 adds the writer; the WE plan drops its Task 8.

**Interfaces:**

```ts
// source.ts
export interface SourceContext {
  /** Never leaves the host. */
  readonly credential: (id: string) => string | undefined;
  readonly signal: AbortSignal;
  readonly fetch: typeof fetch;
}
export interface SourceBytes { readonly bytes: Uint8Array; readonly contentType: string; readonly filename: string }
export interface SearchPage { readonly results: readonly AssetResult[]; readonly next: string | undefined }
export interface AssetSource {
  readonly id: string; readonly label: string;
  readonly category: ListingCategory;
  readonly body: "grid" | "font-picker" | "wallpaper-engine";
  readonly requires: string | undefined;
  readonly configurable: boolean;
  search(query: string, cursor: string | undefined, ctx: SourceContext): Promise<SearchPage>;
  bytesOf(resultId: string, ctx: SourceContext): Promise<SourceBytes | undefined>;
  creditsOf(result: AssetResult): ThemeCreditsEntry;
}

// sources.ts
export const ASSET_SOURCES: readonly AssetSource[];   // [lucideSource] in this phase

// search.ts
export interface SearchOutcome { readonly pages: readonly AssetPage[] }
export async function searchSources(
  request: AssetSearchRequest,
  ctx: SourceContext,
  sources?: readonly AssetSource[],
): Promise<SearchOutcome>;
```

- [ ] **Step 1: Write the failing `search.test.ts`** against two fake grid sources and one picker-body source. Assertions: only `enabled` ids are called (a spy proves the disabled one made no call); a picker-body id in `enabled` is not called and answers no page; ids come back prefixed `fake-a:1`; the pages arrive in registry order regardless of which source resolved first; a source that throws answers `{ reason: "failed", message }` and the other's page still arrives; a source whose `requires` is unset, with no credential in context, answers `needs-credential` and its `search` is never called; an aborted signal answers `failed` with the abort's message rather than throwing.
- [ ] **Step 2: Implement `searchSources`** with `Promise.all` over the enabled grid sources and a per-source `try/catch`; merge by registry order, never by completion.
- [ ] **Step 3: Green, commit** `feat(host): one search over every enabled source`.

### Task 8: The three asset routes

**Files:**
- Create: `src/web/packages/host/src/assets/routes.ts`
- Create: `src/web/packages/host/src/assets/routes.test.ts`
- Modify: `src/web/packages/host/src/server.ts` (one import, `HostServerOptions.assets`, one mount)
- Modify: `src/web/packages/host/src/server.test.ts`

**Interfaces:**

```text
GET  /api/assets/sources                       → { sources: AssetSourceListing[] }
POST /api/assets/search   AssetSearchRequest   → AssetSearchAnswer
GET  /api/assets/bytes?source=<id>&id=<rid>    → bytes, Content-Type from the source,
                                                 X-Yunari-Filename: <filename>
```

- [ ] **Step 1: Write the failing route tests.** Sources lists Lucide with `body: "grid"` and `requires: null`; search with `enabled: ["lucide"]` answers one page whose ids are `lucide:`-prefixed; an unknown source id in `enabled` is ignored; a malformed body is 400; bytes answers the SVG and its filename header; an unknown source is 404 and an id the source does not know is 404; a non-GET method is 405; every route is loopback-only where it is not read-only — search and bytes also refuse non-loopback, because a search is an outbound request the paired display did not ask for.
- [ ] **Step 2: Implement `routes.ts`** as one function taking the host's `credentials` store and an injected `fetch`, mounted in `server.ts` beside the font-favorites block. No body is logged; a request with a credential header is not a shape this route accepts and is ignored.
- [ ] **Step 3: Green, typecheck, commit** `feat(host): serve sources, search and bytes for the finder`.

## Phase 3 — The surface, fonts only

### Task 9: The finder's client and a near-fullscreen dialog

**Files:**
- Modify: `src/web/packages/editor/src/components/ui/dialog.tsx` (an optional `className`)
- Modify: `src/web/packages/editor/src/editor-shell/editor-shell.css` (`.editor-shell-dialog--finder`)
- Create: `src/web/packages/editor/src/asset-finder/client.ts`
- Create: `src/web/packages/editor/src/asset-finder/client.test.ts`

**Interfaces:**

```ts
export interface ClientOptions { readonly baseUrl?: string; readonly fetch?: typeof fetch }
export function listSources(options?: ClientOptions): Promise<readonly AssetSourceListing[]>;
export function searchAssets(request: AssetSearchRequest, options?: ClientOptions): Promise<AssetSearchAnswer>;
export function assetBytes(source: string, id: string, options?: ClientOptions):
  Promise<{ bytes: Uint8Array; filename: string } | undefined>;
```

- [ ] **Step 1: Write the failing client test.** Each call names its route; `assetBytes` reads `X-Yunari-Filename` and answers `undefined` on 404; a network throw becomes an empty listing / a `failed` page rather than an exception the modal must catch.
- [ ] **Step 2: Write the failing dialog test.** A `className` reaches the popup; the stylesheet read from disk (the way `settings.dom.test.tsx` reads `editor-shell.css`) contains `.editor-shell-dialog--finder` with `width: min(1132px, calc(100vw - 48px))` and `height: min(852px, calc(100vh - 48px))`, and the popup scrolls inside its own body rather than the page.
- [ ] **Step 3: Implement** the three calls and the class. The client is fetch-only, as `theme-import.ts` is.
- [ ] **Step 4: Green, commit** `feat(editor): reach the finder's routes and give it a full window`.

### Task 10: The modal — tabs, chips, grid and states

**Files:**
- Create: `src/web/packages/editor/src/asset-finder/modal.tsx`
- Create: `src/web/packages/editor/src/asset-finder/row.tsx`
- Create: `src/web/packages/editor/src/asset-finder/modal.dom.test.tsx`
- Modify: `src/web/packages/editor/src/ui-copy.ts` (`assets.*`)

**Interfaces:**

```ts
export interface FinderProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The category whose body is a component, never a grid. */
  readonly bodies: Readonly<Record<"font-picker" | "wallpaper-engine", React.ReactNode>>;
  readonly onAction: (page: AssetPage, result: AssetResult) => Promise<Result>;
  readonly client?: ClientOptions;
}
export function AssetFinder(props: FinderProps): React.JSX.Element;
```

- [ ] **Step 1: Write the failing DOM test.** Tabs are the categories the listing contains, in registry order; a category with only a body renders that body and no chips; a grid category with one source renders no chip row; with two, chips appear and disabling one issues a search without its id; a debounced keystroke issues one search, and **two deferred answers resolved in reverse render the newer query**; a failed page draws its sentence above the grid and keeps the other page's rows; `needs-credential` draws a link to Connections and no rows; an empty answer draws `no-results` with Clear query; the footer's action label comes from the category (R5), never the word "Import".
- [ ] **Step 2: Implement the modal and row** against the drawing. Abandoned searches are discarded by a request counter compared on resolve, not by an abort alone (an abort does not stop a response already in flight).
- [ ] **Step 3: Green, biome, commit** `feat(editor): the asset finder's grid, chips and states`.

### Task 11: The entry points

**Files:**
- Modify: `src/web/packages/editor/src/panes/add/file-section.tsx`
- Modify: `src/web/packages/editor/src/editor-shell/shell-menu-bar.tsx`
- Modify: `src/web/packages/editor/src/editor-shell/shell-layout.tsx` (the finder's mount and the open state)
- Modify: `src/web/packages/editor/src/shortcut-manager/index.ts` and `bindings.ts` (`findAssets`, `Ctrl+Shift+A`)
- Modify: `src/web/packages/editor/src/ui-copy.ts` (`menus.file.findAssets`)
- Modify: the Add pane's and menu bar's DOM tests

**Interfaces:** the shell holds `const [finderOpen, setFinderOpen] = useState(false)` and renders one `<AssetFinder>`; the pane and the menu take `onFindAssets: () => void`.

- [ ] **Step 1: Write the failing tests.** The Add pane shows a Find assets control whose click calls the callback once; File menu has the row above Import package; the shortcut id is registered and does not fire while a text field has focus (`defersToTextEntry`).
- [ ] **Step 2: Implement** the button, the row, the binding and the mount. The finder's `onAction` is wired in the shell at Task 15; until then it reports `{ ok: false, message: uiCopy.assets.actionUnavailable }` so the surface is testable without inventing a second action path.
- [ ] **Step 3: Green, commit** `feat(editor): open the finder from the Add pane, the File menu and a shortcut`.

### Task 12: Fonts — the picker moves, the inspector points at it

**Files:**
- Create: `src/web/packages/editor/src/asset-finder/fonts-body.tsx`
- Modify: `src/web/packages/editor/src/selection-inspector/font-face-field.tsx`
- Modify: `src/web/packages/editor/src/selection-inspector/font-face-field.dom.test.tsx` (create if absent)
- Modify: `src/web/packages/editor/src/asset-finder/modal.tsx` (the `font-picker` body receives the picker)
- Modify: `src/web/packages/editor/src/ui-copy.ts` (`assets.openFontPicker`)

**Interfaces:**

```ts
export function FontsBody(props: {
  readonly trios: readonly FontTrio[];
  readonly faces: readonly CuratedFontFace[];
  readonly favorites: readonly string[];
  readonly cache: SpecimenCache;
  readonly onApplyFace: (face: CuratedFontFace) => void;
  readonly onApplyTrio: (trioId: string) => void;
  readonly onToggleFavorite: (trioId: string) => void;
}): React.JSX.Element;
```

- [ ] **Step 1: Write the failing DOM test.** The selection inspector's font field renders a button, **not** `<FontPicker>`; pressing it opens the finder on Fonts; the Fonts body renders the picker with the catalogue's own trios and faces; `font-picker.dom.test.tsx` passes unchanged (the component itself is untouched).
- [ ] **Step 2: Implement.** The cache still belongs to whoever renders the picker: the modal owns one for its lifetime and releases it on close, exactly as the field did.
- [ ] **Step 3: Green, commit** `feat(editor): the font picker lives in the finder`.

## Phase 4 — The remote source, the mixed grid, credits

### Task 13: Font Awesome Free

**Files:**
- Create: `src/web/packages/host/src/assets/icons/fontawesome.ts`
- Create: `src/web/packages/host/src/assets/icons/fontawesome.test.ts`
- Modify: `src/web/packages/host/src/assets/sources.ts` (one array entry)

**Interfaces:**

```ts
export const FONTAWESOME_VERSION = "6.7.2";
export const fontAwesomeSource: AssetSource;   // id "fontawesome-free", category "icon"
```

- [ ] **Step 1: Write the failing test** with a stubbed `ctx.fetch`. `metadata/icons.json` membership becomes results whose `name`, `subtitle` (the style) and `preview` are CDN URLs; the licence string comes from the **package metadata the adapter fetched** (`LICENSE: ` package.json's `license` field), not from a constant; a query matching nothing answers an empty page with no cursor; a 404 on metadata is a `failed` page carrying the status; `bytesOf` asks for `/svgs/solid/<name>.svg` and answers its bytes with `contentType: "image/svg+xml"`.
- [ ] **Step 2: Implement** against `https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@${FONTAWESOME_VERSION}/`, one metadata fetch cached in module state for the process, fetched through `ctx.fetch` so tests inject. Search matches `name` and `label`, case- and separator-insensitive. The adapter does nothing about rate limits in v1 (spec §9).
- [ ] **Step 3: Green, commit** `feat(host): Font Awesome Free as the first remote source`.

### Task 14: The mixed grid, Load more, and the host notice

**Files:**
- Create: `src/web/packages/editor/src/asset-finder/interleave.ts`
- Create: `src/web/packages/editor/src/asset-finder/interleave.test.ts`
- Modify: `src/web/packages/editor/src/asset-finder/modal.tsx`
- Modify: `src/web/packages/editor/src/asset-finder/modal.dom.test.tsx`
- Modify: `src/web/packages/editor/src/ui-copy.ts` (`assets.remoteHostNotice`)

**Interfaces:** `export function interleave(pages: readonly AssetPage[], previous: readonly AssetResult[]): readonly AssetResult[]` — round-robin over each page's rows, appended after `previous`. The modal keeps `cursors: Record<string, string>` and `rows`; a page's `next` updates only that source's cursor; the pager draws while any enabled page has one.

- [ ] **Step 1: Write the failing tests.** With two sources, the grid alternates their first pages row by row and each row shows its source; the same id from two sources never collides (ids are namespaced); Load more appends each page's new rows **after** the rows already shown and leaves their order unchanged; a source that answers no cursor stops contributing while the other's pager stays; the first search of a session renders the host notice once, and a second search does not; a source disabled mid-flight has its late page discarded.
- [ ] **Step 2: Implement** the interleave as the pure function in `interleave.ts`, unit-tested directly, and the notice as a value held in the modal's own state (`hasSearched`).
- [ ] **Step 3: Green, commit** `feat(editor): mix every enabled source in one grid`.

### Task 15: Credits at import

**Files:**
- Modify: `src/web/packages/theme-package/src/index.ts` (`writeThemePackage` gains `credits`)
- Modify: `src/web/packages/theme-package/src/index.test.ts`
- Modify: `src/web/packages/editor/src/persist.ts` (`serializeThemePackage` takes credits)
- Modify: `src/web/packages/editor/src/editor-document.ts` (`#credits`, `credits()`, `addCredit()`)
- Modify: `src/web/packages/editor/src/persistence-manager/index.ts` (pass the document's credits)
- Modify: `src/web/packages/editor/src/asset-finder/actions.ts` (create it: import + credit + per-kind action)
- Modify: `src/web/packages/editor/src/asset-finder/modal.dom.test.tsx`
- Modify: `src/web/packages/editor/src/editor-document.dom.test.ts`
- Modify: `src/web/packages/editor/src/editor-shell/shell-layout.tsx` (the real `onAction`)

**Consumes:** the Wallpaper Engine plan's Task 8 — `CREDITS`, `ThemeCreditsEntry`, `ThemeCredits`, `readThemeCredits`.

**Interfaces:**

```ts
// theme-package
writeThemePackage(input: { envelope; assets; thumbnail?; credits?: ThemeCredits }): ...
readThemePackage(...) → { ..., credits?: ThemeCredits }

// editor-document
credits(): readonly ThemeCreditsEntry[];
addCredit(entry: ThemeCreditsEntry): void;   // replaces an entry with the same sourceUrl+title

// asset-finder/actions.ts
export interface ImportedAsset { readonly reference: LocalAssetReference; readonly opened: boolean }
export async function importFinderResult(input: {
  page: AssetPage; result: AssetResult; bytes: Uint8Array; filename: string;
  manager: AssetManager; document: EditorDocument; place: (assetId: string) => void;
}): Promise<Result>;
```

- [ ] **Step 1: Write the failing theme-package tests.** A package written with credits reads them back through `readThemeCredits`; a package written without credits carries neither the member nor its manifest key; an over-cap credits list is refused by the writer with the reader's own cap message.
- [ ] **Step 2: Write the failing editor tests.** An imported Lucide icon reaches the document's credits with `kind: "icon"`, the item name, `license: "ISC"` and a non-empty `sourceUrl`; an import whose bytes are missing refuses and adds no entry; publishing (`serializeThemePackage`) writes `credits.json` and a manifest that names it; reopening a package seeds the collection from its member.
- [ ] **Step 3: Implement** the writer, the document methods, the persistence pass-through and the per-kind action. Import goes through `manager.import(new File([bytes], filename))` — the asset manager keeps its caps and its SVG sanitising, unchanged. The shell's `onAction` becomes `importFinderResult`; Task 11's `uiCopy.assets.actionUnavailable` placeholder and its copy key are removed in this commit.
- [ ] **Step 4: Green, typecheck, commit** `feat(editor): an imported asset carries its attribution`.

## Phase 5 — Wallpaper Engine

### Task 16: The local source and its tab

**Files:**
- Modify: `src/web/packages/host/src/assets/sources.ts` (one array entry over the Wallpaper Engine plan's host module)
- Create: `src/web/packages/host/src/assets/wallpaper-engine.ts`
- Create: `src/web/packages/host/src/assets/wallpaper-engine.test.ts`
- Modify: `src/web/packages/editor/src/asset-finder/modal.tsx` (passes the WE body)

**Consumes:** the Wallpaper Engine plan's `library.ts`, `wire.ts` and `routes.ts` (Tasks 3–5).

**Interfaces:** `wallpaperEngineSource: AssetSource` — `id: "wallpaper-engine"`, `category: "local"`, `body: "wallpaper-engine"`, `configurable: false`, and its `search` is never called (the tab is a body, and the search route skips every non-grid source). The editor's WE body is the list the Wallpaper Engine plan already builds, with its sheet as the action.

- [ ] **Step 1: Write the failing test.** The registry lists the WE source with `category: "local"` and `body: "wallpaper-engine"`, `requires: undefined` and `configurable: false`; the search route answers no page for it; with no install, the tab draws the module's absence reason rather than an error.
- [ ] **Step 2: Implement** the entry and pass the WE body into the modal from the shell.
- [ ] **Step 3: Green, commit** `feat(editor): Wallpaper Engine's tab in the finder`.

## Phase 6 — The boundary

### Task 17: The browser boundary

**Controller-reviewed; no product source changes.** A claim that fails is a finding to report.

**Files:**
- Create: `tests/e2e/asset-finder.spec.ts`
- Modify: `docs/evidence/screenshots/README.md` (register every capture before taking it)

- [ ] **Step 1: Register four captures** — the finder on Fonts, on Icons with two sources, the failure/empty state, and Connections. A capture that is not registered may not be taken.
- [ ] **Step 2: Assert the spec §12 claims** against routed fixtures: one search with both icon sources answers rows from both with no shared id; disabling a source removes its rows and issues no request for it; a failing source leaves the other's rows and names itself; Load more appends; the font picker no longer renders in the inspector and the field opens the modal on Fonts; Add → File's existing DOM test passes unchanged.
- [ ] **Step 3: Red-prove at least three** — the source badge, the disabled-source saving and the stale-response discard — each by breaking the code, watching its case fail, and restoring from a copy kept outside the repo, verified with `cmp`, never `git checkout`.
- [ ] **Step 4: Run the boundary** — `npm run build`, then `YUNARI_CAPTURE=1 npx playwright test tests/e2e/asset-finder.spec.ts --workers=1` to a file, read its exit code directly; then the same without capture; `npm run typecheck`; `npx biome check ..`.
- [ ] **Step 5: Report what the fixtures cannot prove** — no live Font Awesome request, no keyed source, and no Wallpaper Engine install in CI.

---

## Phase 7 — Lineicons

### Task 18: Lineicons, from a dev-only package

The free Lineicons set ships as an MIT npm package with no search API, so the
manifest is generated at build time and the host never imports the package.

**Files:**
- Modify: `src/web/package.json` (`lineicons@1.3.2` as a `devDependency`; the generator script)
- Create: `scripts/generate-lineicons.mjs`
- Create: `src/web/packages/host/src/assets/icons/lineicons.generated.ts` (generated, committed)
- Create: `src/web/packages/host/src/assets/icons/lineicons.ts`
- Create: `src/web/packages/host/src/assets/icons/lineicons.test.ts`
- Modify: `src/web/packages/host/src/assets/sources.ts` (one array entry)
- Modify: `THIRD-PARTY-NOTICES.md` and `docs/engineering/dependencies.md` (MIT, dev-only)

**Interfaces:**

```ts
export const LINEICONS_VERSION = "1.3.2";
export const LINEICONS_ICONS: readonly LucideIcon[];   // generated: name + svg
export function searchLineicons(query: string, cursor: string | undefined): SearchPage;
export const lineiconsSource: AssetSource;              // id "lineicons", category "icon"
```

**Constraints:**
- The package is dev-only: the generated module is pure data, and the host's
  dependency list does not change.
- `lineicons@1.3.2` is the free set (600 icons, MIT, no attribution required), so
  every entry is a free result; there is no premium flag to filter.
- Search matches the icon name only (the package carries no tags). Spaces and
  hyphens are one separator, as Lucide's search treats them.
- The cursor is the Lucide adapter's offset cursor; no second paging scheme.

- [ ] **Step 1: Add the devDependency and the generator.** Walk
  `node_modules/lineicons/assets/svgs/regular/*.svg`, read each file as text,
  and write `${name}\t${svg}` entries sorted by name with a header naming
  `lineicons` 1.3.2 and MIT. Register it beside `icons:generate` in
  `package.json`.
- [ ] **Step 2: Write the failing adapter test.** The manifest is non-empty and
  every `svg` starts with `<svg` and contains no `script`; `searchLineicons("arrow
  down", undefined)` finds `arrow-down`; an empty query answers the first 40 with
  a `next` cursor and page two does not repeat page one; `bytesOf` answers
  `image/svg+xml` and a `.svg` filename; `creditsOf` answers `kind: "icon"`,
  `licence: "MIT"` and a `sourceUrl` naming lineicons.com.
- [ ] **Step 3: Implement** the adapter as the Lucide one, and add
  `lineiconsSource` to `REGISTRY` after `lucideSource`.
- [ ] **Step 4: Green, `npx tsc --noEmit`, `npx biome check ..`, commit**
  `feat(host): Lineicons as a free local icon source`.

## Phase 8 — Unsplash

### Task 19: Unsplash, free photos only

**Files:**
- Create: `src/web/packages/host/src/assets/images/unsplash.ts`
- Create: `src/web/packages/host/src/assets/images/unsplash.test.ts`
- Modify: `src/web/packages/host/src/assets/sources.ts` (one array entry)
- Modify: `src/web/packages/host/src/settings/credentials-registry.ts` (one entry)
- Modify: `src/web/packages/host/src/settings/credentials-registry.test.ts` (create if absent)

**Interfaces:**

```ts
export const UNSPLASH_VERSION = "v1";
export const unsplashSource: AssetSource;   // id "unsplash", category "image",
                                             // requires "unsplash", body "grid"
```

`KNOWN_CREDENTIALS` gains `{ id: "unsplash", label: "Unsplash", kind: "bearer",
verify }`. The key is the app's access key; the source sends it as
`Authorization: Client-ID <key>`, never to the browser.

**Wire:** `GET https://api.unsplash.com/search/photos?query=<q>&page=<n>&per_page=30`
with the key header. `bytesOf` calls the photo's `links.download_location` first
(the API guideline's download trigger), then fetches `urls.full`.

**Free-only rule (spec §3's promise):** drop a photo when `premium === true` or
`plus === true`, and drop any photo whose `urls.small` or `urls.regular` host is
`plus.unsplash.com`. Those are the three signs of Unsplash+ content; a result
that passes all three is under the Unsplash License.

- [ ] **Step 1: Write the failing adapter test** with a stubbed `ctx.fetch`:
  the search request carries the `Client-ID` header and the query; a
  `premium: true` and a `plus: true` photo are absent; a photo whose URL host is
  `plus.unsplash.com` is absent; a free photo maps to `preview: urls.small`,
  `subtitle` naming the photographer and `licence: "Unsplash License"`; `next`
  is the next page while `page < total_pages` and `undefined` at the end;
  `bytesOf` fetches `download_location` before the image and answers its bytes
  and `image/jpeg`; `creditsOf` carries the photographer, licence and photo
  page; a 401 is a `failed` page naming the status, and its message never
  contains the key.
- [ ] **Step 2: Write the failing registry test.** The table lists `unsplash`
  with `kind: "bearer"` and a verifier; the verifier answers `ok` for a 200 and
  a message naming the status for a 401, using an injected fetch.
- [ ] **Step 3: Implement** the adapter, the registry entry and the verifier
  (`GET /search/photos?query=test&per_page=1` with the key), then register the
  source after the icon sources.
- [ ] **Step 4: Green, `npx tsc --noEmit`, `npx biome check ..`, commit**
  `feat(host): Unsplash as the first image source, free photos only`.
- [ ] **Step 5 (user request 2026-10-23): guide the key.** `KnownCredential`
  gains an optional `help: { readonly text: string; readonly url: string }`;
  the wire row carries `helpUrl` and the Connections row renders one sentence
  and a "Where to get a key" link beneath the field. Unsplash's entry names its
  developer apps page; a credential with no `help` renders nothing extra.

---

## Self-Review

- **Spec coverage:** §1→Tasks 10, 14; §2→Tasks 5–7; §3→Tasks 6, 12, 13, 16, 18, 19 (with Ruling 1's departure recorded in Task 1, and Flaticon's omission recorded in the scope note); §4→Tasks 2–4; §5→Tasks 13, 15, 19; §8→Tasks 7, 10, 14; §11's order→phases 1–6, with the 2026-10-23 provider reorder in the scope note; §12→Task 17 plus each task's own tests.
- **Type consistency:** `AssetResult`/`AssetPage`/`AssetSearchRequest` are defined once in `renderer-core` (Task 5) and named identically in Tasks 6–16; `CredentialRow` is defined in `ui-copy`'s task as a client type and in `renderer-core` for the route — Task 5 moves it, and Task 3 imports it there once Task 5 lands. **That direction is wrong for execution order** (Task 3 precedes Task 5): the route therefore declares the row shape locally in Task 3 and switches to the shared type in Task 5, which is a one-line import change permitted by the same task.
- **Review Focus** is covered as listed above.
- **Proportion:** 17 tasks over 6 phases; no task carries an implementation body the signature and test already determine.
