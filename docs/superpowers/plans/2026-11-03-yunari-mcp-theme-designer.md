# Yunari MCP theme designer — implementation plan

> **For agentic workers:** Implement task by task in order unless a task says it
> is independent. The user approved the design and is asleep; do not wait for
> review between tasks. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a stdio MCP server and a portable skill that let an agent design,
preview, save and assign Yunari themes, backed by one shared authoring kit.

**Architecture:** Move the editor's pure theme builders into a new Node-safe
`@yunari/theme-kit`, add `@yunari/mcp` as a loopback HTTP client and stdio MCP
server, extend the panel family/manager with a preview capture, and install the
skill under `~/.agents/skills/` with the Vercel `skills` CLI and the server
with `add-mcp`.

**Tech Stack:** TypeScript 7, Node ≥22, `@modelcontextprotocol/server` v2,
zod 4, Vite SSR builds, Vitest, existing host routes and panel CDP rasterizer.

**Spec:** `docs/superpowers/specs/2026-11-03-yunari-mcp-theme-designer-design.md`
**Decision:** `docs/decisions/0090-mcp-theme-authoring.md`

## Global Constraints

- No second theme store, scene model, renderer, asset store or HTTP listener.
- `renderer-core` stays Fabric/DOM-free. `scene-fabric` remains the only shared
  layer that constructs Fabric objects; theme-kit builds JSON only.
- The player and editor bundles keep their existing boundaries and size.
- No fabricated telemetry: bindings use `SEMANTIC_KEYS`; missing values stay
  missing.
- Existing themes are never overwritten without `confirmExisting`.
- No delete-theme tool.
- Run commands from `src/web/`. `npm run gate` must exit 0 without the network.
- Keep new files under 800 lines.
- Add every new runtime dependency to `THIRD-PARTY-NOTICES.md` in the same
  change.
- The skill installs to `~/.agents/skills/yunari-theme-designer/`; do not add a
  second copy under `~/.claude/skills/`.

## Review Focus

1. A moved builder produces byte-identical starter/card output; editor tests
   and the starter round-trip still pass.
2. A draft never writes to the host until `save_theme`; an opened theme without
   `confirmExisting` is refused by the server, not only by the skill.
3. A browser preview returns the player URL and a viewport that preserves the
   artboard aspect; a panel preview returns a PNG at the panel's exact
   geometry.
4. The installer writes only `mcpServers.yunari` and the skill directory;
   uninstall removes exactly those.
5. A host that is absent, a sensor that was not measured, an over-sized asset
   and an invalid document each produce a named refusal.

---

### Task 1: Create `@yunari/theme-kit` and move the pure builders

**Files:**
- Create: `src/web/packages/theme-kit/package.json`
- Create: `src/web/packages/theme-kit/tsconfig.json`
- Create: `src/web/packages/theme-kit/src/index.ts`
- Move: `editor/src/new-fabric-theme-objects.ts` → `theme-kit/src/objects.ts`
- Move: `editor/src/new-fabric-theme-globals.ts` → `theme-kit/src/globals.ts`
- Move: `editor/src/new-fabric-theme-icons.ts` → `theme-kit/src/icons.ts`
- Move: `editor/src/new-fabric-theme-cards.ts` → `theme-kit/src/cards.ts`
- Move: `editor/src/card-token-mapping.ts` → `theme-kit/src/card-token-mapping.ts`
- Move: `editor/src/card-library.ts` → `theme-kit/src/card-library.ts`
- Move: `editor/src/artboard-presets.ts` → `theme-kit/src/artboard.ts`
- Create: `theme-kit/src/starter.ts` (from `new-fabric-theme.ts`, backdrop
  becomes an option)
- Create: `theme-kit/src/palette-role.ts` (`paletteTokenRole` + constants from
  `new-object-defaults.ts`)
- Create: `theme-kit/src/document.ts`, `assets.ts`, `authoring.ts`
- Modify: `src/web/package.json` workspaces, `editor/package.json`,
  `editor/tsconfig.json`, `editor/vite.config.ts`, `vitest.config.ts` if needed
- Modify every editor import of the moved modules (mechanical; `rg` first)
- Move/adapt tests: `new-fabric-theme.test.ts`, `new-fabric-theme-icons.test.ts`,
  `card-library.test.ts`, `card-token-mapping.test.ts`,
  `artboard-presets.test.ts` into `theme-kit/src/`

**Interfaces produced by `index.ts`:**

```ts
export type ObjectJson = Readonly<Record<string, unknown>>;
export interface Run { kind: "literal" | "value"; bindingId?: string; text?: string;
  token: StarterPaletteId; size: number; precision?: number;
  unitDisplay?: "none" | "short" | "long"; }
export type CardDiagram = "time" | "cpu" | "gpu" | "ram" | "vram" |
  "trends" | "storage" | "network";
export interface CardUnit { id: string; label: string; diagram: CardDiagram;
  build: () => ObjectJson; }
export const CARD_LIBRARY: readonly CardUnit[];
export function instantiateCard(options: InstantiateCardOptions): CardCopy;
export function createStarterTheme(options?: { backdrop?: AssetReference }): FabricThemeEnvelope;
export function createBlankTheme(input: { artboard: Artboard; name?: string;
  author?: string; themeLanguage?: string }): FabricThemeEnvelope;
export const ARTBOARD_RATIOS; ARTBOARD_RESOLUTIONS; ARTBOARD_ORIENTATIONS;
export function artboardSize(ratio, resolution, orientation): { width; height };
export function artboardPresetFor(size): ArtboardPresetChoice | undefined;
export function listSceneObjects(envelope): readonly SceneObjectInfo[];
export function addSceneObject(envelope, object, bindings?): { envelope; ids };
export function updateSceneObject(envelope, id, patch): FabricThemeEnvelope;
export function removeSceneObject(envelope, id): FabricThemeEnvelope;
export function setBindings(envelope, id, bindings): FabricThemeEnvelope;
export function setPalette(envelope, palette): FabricThemeEnvelope;
export function setTypeTokens(envelope, tokens): FabricThemeEnvelope;
export function setArtboard(envelope, artboard): FabricThemeEnvelope;
export function setBackground(envelope, background | undefined): FabricThemeEnvelope;
export function declareAsset(input): { reference: AssetReference; bytes: Uint8Array;
  credit: ThemeCreditsEntry };
export function addAsset(envelope, reference, bytes): FabricThemeEnvelope;
export function removeAsset(envelope, assetId): FabricThemeEnvelope;
export function addTextObject(input): { object: ObjectJson; bindings?: Binding[] };
export function addShapeObject(input): ObjectJson;
export function addImageObject(input): ObjectJson;
export function addIconObject(input): ObjectJson;
export function addChartObject(input): { object: ObjectJson; bindings: Binding[] };
```

- [ ] Create the package manifest: private, `type: module`, `main`/`types`
  `./src/index.ts`, dependencies `@yunari/renderer-core`, `@yunari/scene-fabric`,
  devDependency `@types/node`. No build script; source is consumed by Vite.
- [ ] Move the pure modules with `git mv` and rewrite relative imports.
- [ ] Split `new-fabric-theme.ts`: theme-kit `starter.ts` takes
  `backdrop?: AssetReference`; editor keeps a thin `new-fabric-theme.ts` that
  imports the starter backdrop `.jpg?url` and calls the kit. Do not keep a
  second copy of the composition.
- [ ] Move only `instantiateCard`, `CARD_LIBRARY`, token mapping and the pure
  card helpers. Keep `insertCard` and canvas/history work in editor
  `card-library.ts`, importing from the kit.
- [ ] Move `paletteTokenRole` + `CARD_SURFACE_TOKENS`/`SURFACE_TOKENS` to
  `palette-role.ts`; editor `new-object-defaults.ts` imports them.
- [ ] Replace the icon module's `lucide-react/dist/esm/icons/*` imports with a
  local data module carrying the same seven `__iconData` arrays (Lucide ISC;
  keep the existing notice). This keeps React out of the Node MCP process.
- [ ] Implement `document.ts`: scene `{version, objects}` append/update/remove,
  unique ids via `createWidgetIdAllocator`, binding merge/removal, palette,
  type tokens, artboard, background. Mutations clone the envelope; no function
  mutates its input.
- [ ] Implement `assets.ts`: derive a stable id, `assets/<slug>-<sha8>.<ext>`
  path, `sha256` via `node:crypto` (use `globalThis.crypto.subtle` when
  available so the editor shares it), kind from extension, caps from the store
  constants, and a `ThemeCreditsEntry` shaped like the finder's `creditOf`.
  Refuse absolute paths, `..`, unknown extensions and bytes over `MAX_ASSET_BYTES`.
- [ ] Implement `authoring.ts` by composing the moved `objects.ts` primitives:
  text boxes, rect/ellipse/path shapes, image objects with
  `yunariAsset: { assetId, kind }`, icons as filled paths, and line/bar/gauge
  charts with their binding returned separately.
- [ ] Update editor imports; no re-export shims for moved modules. Delete the
  old files after every import moves.
- [ ] Add `@yunari/theme-kit` to the editor dependency list and Vite alias.
- [ ] Run `npx vitest run packages/theme-kit packages/editor/src/new-fabric-theme.test.ts
  packages/editor/src/card-library.test.ts packages/editor/src/artboard-presets.test.ts
  packages/editor/src/editor-document.test.ts`; expect PASS.
- [ ] Run `npm run typecheck`; expect PASS.
- [ ] Commit.

---

### Task 2: Host panel geometry and preview capture (independent of Task 1)

**Files:**
- Modify: `src/web/packages/host/src/panels/panel-device.ts`
- Modify: `src/web/packages/host/src/panels/turzx-panel.ts`
- Modify: `src/web/packages/host/src/panels/tur-usb-panel.ts`
- Modify: `src/web/packages/host/src/panels/kraken-z3-panel.ts`
- Modify: `src/web/packages/host/src/panels/panel-manager.ts`
- Modify: `src/web/packages/host/src/server/themes-routes.ts`
- Test: `panel-manager.test.ts`, `panel-families.test.ts`,
  `server.test.ts` (preview route cases)

**Interfaces:**

```ts
export interface PanelFamily {
  readonly geometry: { readonly width: number; readonly height: number };
  /* existing fields */
}
export interface PanelManager {
  capturePreview(displayId: string, themeId: string, clip: boolean): Promise<Uint8Array>;
  /* existing methods */
}
```

- [ ] Add `geometry` to `PanelFamily` and to every row in the three drivers
  (800×480, 464/480×1920, 320×320). A row's geometry is a constant, not a
  device open.
- [ ] Add `geometry` to the panel branch of `ActiveDisplay` in
  `themes-routes.ts`; nothing else in that response changes.
- [ ] Extend `PanelManager`'s `pageFor` port to accept an optional theme id:
  `pageFor(displayId, clip, themeId?)`. Main appends `&theme=<id>` when set.
- [ ] Implement `capturePreview`: resolve the record, require `kind: "panel"`,
  read the family geometry, build `pageFor(displayId, clip, themeId)`, create a
  rasterizer on the shared browser with `stillFormat: "png"`, capture once,
  close the target. Reuse the manager's browser lifecycle and serialisation.
- [ ] Add `GET /api/themes/:id/panel-preview?display=<id>[&clip=1]` to
  `createThemeRoutes`. Loopback only; validate the theme id; 404 an unknown
  theme/display; 409 when the display is not a panel; 503 when no manager is
  configured; return `image/png`, `no-store`, `nosniff`.
- [ ] Tests: family geometry values; capture with the injected fake raster
  browser asserts the page URL carries the theme; route refusals and a PNG
  success.
- [ ] Run `npx vitest run packages/host/src/panels packages/host/src/server.test.ts`;
  expect PASS.
- [ ] Commit.

---

### Task 3: Create `@yunari/mcp` server, host client and drafts

**Files:**
- Create: `src/web/packages/mcp/package.json`, `tsconfig.json`,
  `vite.config.ts`, `bin/yunari-mcp.js`
- Create: `src/web/packages/mcp/src/main.ts`, `server.ts`, `host-client.ts`,
  `drafts.ts`, `types.ts`
- Create: `src/web/packages/mcp/src/tools/discovery.ts`, `assets.ts`,
  `draft.ts`, `compose.ts`, `verify.ts`
- Test: `src/web/packages/mcp/src/*.test.ts`

**Interfaces:**

```ts
export interface HostClient {
  url: string;
  status(): Promise<HostStatus>;
  listThemes(): Promise<ThemeSummary[]>;
  getTheme(id): Promise<{ envelope; assets: Record<string, Uint8Array>; base?: string }>;
  saveTheme(id, input): Promise<SaveResult>;
  sensors(measured: boolean): Promise<SensorListing>;
  activeThemes(): Promise<ActiveThemeMap>;
  assignTheme(display, id): Promise<void>;
  listAssetSources(): Promise<AssetSourceListing[]>;
  searchAssets(request): Promise<AssetSearchAnswer>;
  assetBytes(source, id): Promise<{ bytes; filename }>;
  normalizeVideo(bytes, trim?): Promise<Uint8Array>;
  panelPreview(id, display, clip): Promise<Uint8Array>;
}
export interface Draft { id; envelope; assets; credits; base?; origin: "new" | "opened"; }
```

- [ ] Package: private, `bin` `yunari-mcp`, dependencies
  `@modelcontextprotocol/server`, `zod`, `add-mcp`, `skills`,
  `@yunari/theme-kit`, `@yunari/renderer-core`, `@yunari/theme-package`;
  devDependency `@types/node`. Vite SSR build like the host, `target: node22`,
  output `dist/main.js`; bin shim errors with the build command when missing.
- [ ] Implement `main.ts`: `serve` starts stdio; `install`, `uninstall`,
  `status` delegate to `install.ts`; `--url`/`YUNARI_URL`; probe ports 5227–5236
  when none is given.
- [ ] Implement `host-client.ts` with `fetch`; every non-OK answer becomes an
  error naming status and the host's text; base64 encode/decode themes.
- [ ] Implement `drafts.ts`: create/clone/read/discard, asset map, credits,
  origin, base. A mutation never reaches the host.
- [ ] Implement the discovery tools: `yunari_status`, `list_displays`,
  `list_sensors`, `list_themes`, `get_theme`, `list_asset_sources`.
- [ ] Implement the asset tools: `search_assets` returns an opaque `assetRef`
  (`base64` of source/id/metadata), `preview_asset` returns MCP image content,
  `import_asset` fetches bytes and declares them through theme-kit, with local
  path support and video normalization.
- [ ] Implement draft/token tools: `create_theme`, `open_theme`,
  `set_theme_metadata`, `set_artboard`, `set_palette`, `set_type_tokens`,
  `set_background`, `discard_draft`.
- [ ] Implement compose tools: `add_card`, `add_text`, `add_shape`, `add_image`,
  `add_icon`, `add_chart`, `add_binding`, `list_objects`, `update_object`,
  `remove_object`, `group_objects`, `ungroup_objects`.
- [ ] Implement verify/deploy: `validate_theme`, `preview_theme` (browser URL +
  viewport; panel PNG), `save_theme`, `assign_theme`.
- [ ] Overwrite rule: `open_theme` refuses unless `confirmExisting: true`;
  `save_theme` of an opened draft is allowed after that. A new draft is free.
- [ ] Tests with a fake host server: save/open/confirm; preview URL viewport for
  16:9, 19.5:9, 4:3, 1:1 and circle; panel PNG; missing sensor report; asset
  refusal; invalid envelope relay; unreachable host.
- [ ] Run `npx vitest run packages/mcp`; expect PASS; `npm run typecheck`.
- [ ] Commit.

---

### Task 4: Installer, skill and docs (independent of Tasks 1–3 for authoring)

**Files:**
- Create: `src/web/packages/mcp/src/install.ts`
- Create: `skills/yunari-theme-designer/SKILL.md`
- Create: `skills/yunari-theme-designer/references/questionnaire.md`
- Create: `skills/yunari-theme-designer/references/design-rules.md`
- Create: `skills/yunari-theme-designer/references/tool-guide.md`
- Modify: `docs/architecture.md`, `docs/development.md`,
  `THIRD-PARTY-NOTICES.md`
- Test: `src/web/packages/mcp/src/install.test.ts`

- [ ] Implement `install.ts` with injected ports for `upsertServer`,
  `removeServer` and a `runSkills` function, so tests never touch the user's
  home. Production resolves `skills/bin/cli.mjs` from the installed package and
  runs `add <abs skill dir> -g --copy -y` with `DISABLE_TELEMETRY=1`; then
  verifies `~/.agents/skills/yunari-theme-designer/SKILL.md` exists.
- [ ] `add-mcp` entry: `{ command: process.execPath, args: [binPath, "serve"] }`.
  `autoApproveTools: []` so Claude Code gets the `mcp__yunari` rule.
- [ ] `uninstall`: `removeServer("claude-code", "yunari", { local: false })` and
  `skills remove -g -y yunari-theme-designer`; report partial failures.
- [ ] `status`: host reachability, config entry presence, skill path presence.
- [ ] Write the skill: required questionnaire (only ask gaps), the design rules
  below, the tool workflow, preview ratio instructions, asset/licence rules,
  telemetry honesty, overwrite/assign consent, and the reference-image rule.
- [ ] Design rules minimum: hierarchy/focal reading; target-display density;
  minimum type size by viewing distance; safe margins and one grid; palette
  count and contrast; consistent radius/stroke/spacing; media scrim/fallback;
  data-centric vs media-centric balance; max readings by display size;
  light/dark; no invented readings; no trademark copying from references.
- [ ] Document local run and install in `docs/development.md`; add packages and
  boundary to `docs/architecture.md`; add dependency notices.
- [ ] Tests: install writes only the expected server entry and skill path;
  uninstall removes only them; a failing skills CLI reports without claiming
  success.
- [ ] Run `npx vitest run packages/mcp/src/install.test.ts`; expect PASS.
- [ ] Commit.

---

### Task 5: Integration, gates and release notes

**Files:**
- Modify: `src/web/packages/mcp/package.json` build/typecheck scripts
- Modify: `src/web/package.json` workspaces
- Test: full suite

- [ ] Run `npm install` from `src/web/` to link the new workspaces.
- [ ] Run `npm run build`; expect PASS.
- [ ] Run `npx vite build packages/mcp`; expect `packages/mcp/dist/main.js`.
- [ ] Run `npm run typecheck`; expect PASS.
- [ ] Run `npm test`; expect PASS.
- [ ] Run `npm run gate`; write output to a file and check the exit code is 0.
- [ ] Run the executable installer probes from decision rung 6 against a
  temporary home; record the result in the decision note if it differs.
- [ ] Update `docs/decisions/0090-mcp-theme-authoring.md` with the probe result.
- [ ] Commit and push the branch.

## Verification

- `npm run gate` exit 0.
- `npx vite build packages/mcp` produces the server bundle.
- A fake-host MCP test proves one full flow: create → add text → validate →
  browser preview URL → save → assign.
- A panel test proves capture uses the panel's geometry and the theme override.
- `~/.agents/skills` is the only skill install target in the installer code and
  tests.
