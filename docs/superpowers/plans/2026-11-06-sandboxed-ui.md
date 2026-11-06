# Sandboxed UI and Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run plugin UI in an isolated frame, expose a gesture-gated postMessage API, render declarative and sandboxed settings pages, and let an unknown asset category show a custom body.

**Architecture:** The host serves plugin UI files under a restrictive CSP, and the editor embeds them in a `sandbox="allow-scripts"` iframe with no same-origin access. One nonce-protected postMessage protocol carries every request. Read methods need a valid session; write methods need a one-use gesture token the host mints only from a host control. Settings contributions are either a declarative field list rendered by the editor or a sandboxed page.

**Tech Stack:** TypeScript, React 19, `postMessage`, Node HTTP static serving, Vitest + jsdom. No new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-11-06-extension-platform-design.md`

**Prerequisite:** `2026-11-06-extension-core.md` and `2026-11-06-executable-extensions.md`.

## Global Constraints

- The frame is `<iframe sandbox="allow-scripts">`; it never receives `allow-same-origin`, `allow-top-navigation`, `allow-popups`, or `allow-forms`.
- The host sends the plugin only its own settings, never host credentials or another plugin's state.
- Every frame request is checked against the frame method table and the plugin consent. Write methods require a one-use gesture token.
- UI files are served only from the plugin's install directory, with path traversal and symlink escapes refused.
- Unknown asset category bodies require `sandboxed-ui`; a missing capability refuses the body rather than falling back to a grid.
- Declarative settings fields are a closed type set: `text`, `number`, `boolean`, `select`, `secret`.
- Run every npm command from `src/web/`. `npm run gate` must exit 0 without network access.

## Review Focus

- A frame that posts a message from another origin, reuses a gesture token, or calls a worker-only method: ignored or denied, and the frame stays mounted only if the session nonce still matches.
- A plugin UI path with `..`, an encoded separator, or a symlink pointing outside the install tree: refused before bytes are read.
- A settings field with a value outside its declared bounds or a select option not in its list: refused, and the stored settings unchanged.
- A category body the editor does not know but the plugin did not declare `ui:frame`: refused with a stated reason, not rendered as a blank grid.
- A frame that throws during load: the host surface shows the plugin name and a retry, and the rest of Settings remains usable.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/web/packages/extension-api/src/frame.ts` | Frame message shapes, method table, gesture-token rules. |
| `src/web/packages/extension-api/src/manifest.ts` | `settingsPages` field types and `ui` validation. |
| `src/web/packages/host/src/server/extension-ui-routes.ts` | Plugin UI file serving, CSP, MIME, path safety. |
| `src/web/packages/host/src/extensions/settings.ts` | Declarative and sandboxed settings read/write. |
| `src/web/packages/editor/src/plugin-manager/plugin-manager.tsx` | Install, consent, removal, and provider ordering. |
| `src/web/packages/editor/src/plugin-manager/use-extensions.ts` | `/api/extensions` client and refresh. |
| `src/web/packages/editor/src/plugin-frame/plugin-frame.tsx` | The iframe host and postMessage client. |
| `src/web/packages/editor/src/plugin-frame/use-plugin-frame.ts` | Session nonce, request dispatch, gesture token. |
| `src/web/packages/editor/src/settings-mode/plugin-pages.tsx` | Dynamic Settings rows and generic declarative form. |
| `src/web/packages/editor/src/settings-mode/region.tsx` | Appends plugin pages to built-in Settings. |
| `src/web/packages/editor/src/asset-finder/plugin-body.tsx` | Custom asset body frame. |
| `src/web/packages/editor/src/asset-finder/finder-body.tsx` | Chooses grid, font picker, wallpaper, or plugin body. |

---

### Task 1: Record the sandboxed-UI reuse decision

**Files:**
- Create: `docs/decisions/0115-sandboxed-ui.md`

**Interfaces:**
- Consumes: the spec's `Execution profiles`, `Contribution points`, and `Security invariants` sections.
- Produces: exact `Paths:` claims for the frame and settings files.

- [ ] **Step 1: Write the decision note**

Header:

```markdown
# 0115 — sandboxed UI

- **Date:** 2026-11-06
- **Status:** accepted
- **Paths:** `src/web/packages/extension-api/src/frame.ts`
  `src/web/packages/extension-api/src/manifest.ts`
  `src/web/packages/host/src/server/extension-ui-routes.ts`
  `src/web/packages/host/src/extensions/settings.ts`
  `src/web/packages/editor/src/plugin-frame/plugin-frame.tsx`
  `src/web/packages/editor/src/plugin-frame/use-plugin-frame.ts`
  `src/web/packages/editor/src/settings-mode/plugin-pages.tsx`
  `src/web/packages/editor/src/settings-mode/region.tsx`
  `src/web/packages/editor/src/asset-finder/plugin-body.tsx`
  `src/web/packages/editor/src/asset-finder/finder-body.tsx`
```

Rungs: the browser's `iframe sandbox` and `postMessage` are the native mechanism; Orca's isolated panel frame is the public prior art; the editor already has Dialog and Settings extension seams; the probe is a frame with no `allow-same-origin` reading `window.localStorage` and throwing. Decision: use the native sandbox, one nonce-protected protocol, and host-served static files.

- [ ] **Step 2: Verify the hook accepts the claims**

```bash
echo '{"tool_input":{"file_path":"src/web/packages/extension-api/src/frame.ts"}}' | node scripts/reuse-gate.mjs
echo "exit=$?"
```

Expected: `exit=0`.

- [ ] **Step 3: Commit**

```bash
git add docs/decisions/0115-sandboxed-ui.md
git commit -m "docs(decisions): authorise sandboxed UI

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Define the frame protocol and settings contribution schema

**Files:**
- Create: `src/web/packages/extension-api/src/frame.ts`
- Modify: `src/web/packages/extension-api/src/manifest.ts`
- Modify: `src/web/packages/extension-api/src/index.ts`
- Test: `src/web/packages/extension-api/src/frame.test.ts`
- Test: `src/web/packages/extension-api/src/manifest.test.ts`

**Interfaces:**
- Produces:

```ts
export type FrameMethod =
  | "settings.get"
  | "settings.set"
  | "asset.search"
  | "asset.bytes"
  | "ui.resize";

export interface FrameMethodEntry {
  readonly capability: Capability | null;
  readonly write: boolean;
}
export const FRAME_METHODS: Readonly<Record<FrameMethod, FrameMethodEntry>>;

export interface FrameInit {
  readonly type: "yunari.frame.init";
  readonly nonce: string;
  readonly pluginKey: string;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly theme: { readonly palette: Readonly<Record<string, unknown>>; readonly typeTokens: Readonly<Record<string, unknown>> };
}
// FrameInit is the host-to-plugin `settings.render` event: it carries the
// initial settings once per frame load and expects no result.
export interface FrameRequest {
  readonly type: "yunari.frame.request";
  readonly nonce: string;
  readonly id: string;
  readonly method: FrameMethod;
  readonly params: unknown;
  readonly gestureToken?: string;
}
export interface FrameResult {
  readonly type: "yunari.frame.result";
  readonly id: string;
  readonly ok: boolean;
  readonly value?: unknown;
  readonly reason?: string;
}
export interface FrameEvent {
  readonly type: "yunari.frame.event";
  readonly event: "resize" | "ready";
  readonly height?: number;
}
export type EditorFrameMessage = FrameInit | FrameResult;
export type PluginFrameMessage = FrameRequest | FrameEvent;
export function readPluginFrameMessage(value: unknown): PluginFrameMessage | undefined;

export type SettingsField =
  | { readonly key: string; readonly label: string; readonly type: "text"; readonly default?: string; readonly maxLength?: number }
  | { readonly key: string; readonly label: string; readonly type: "number"; readonly default?: number; readonly min?: number; readonly max?: number }
  | { readonly key: string; readonly label: string; readonly type: "boolean"; readonly default?: boolean }
  | { readonly key: string; readonly label: string; readonly type: "select"; readonly options: readonly { readonly value: string; readonly label: string }[]; readonly default?: string }
  | { readonly key: string; readonly label: string; readonly type: "secret"; readonly default?: never };
```

`settingsPages` becomes:

```ts
readonly settingsPages?: readonly (
  | { readonly id: string; readonly label: string; readonly section?: string; readonly fields: readonly SettingsField[] }
  | { readonly id: string; readonly label: string; readonly section?: string; readonly ui: string }
)[];
```

Rules: a page with `fields` requires `settings:own` and `declarative` or higher. A page with `ui` requires `ui:frame`, `settings:own`, and `sandboxed-ui` or higher. A manifest with `ui` but no `ui:frame` capability is refused. Field keys match `^[a-z][a-zA-Z0-9.]{0,63}$`; no duplicate key within a page.

- [ ] **Step 1: Write the failing tests**

```ts
it("refuses a sandboxed page without ui:frame", () => {
  expect(readPluginManifest({ ...validManifest(), contributes: { settingsPages: [{ id: "acme", label: "Acme", ui: "settings/index.html" }] } })).toEqual({
    ok: false,
    reason: 'The settings page "acme" requires the "ui:frame" capability.',
  });
});

it("reads a valid frame request and refuses a write without a gesture token", () => {
  expect(readPluginFrameMessage({ type: "yunari.frame.request", nonce: "n", id: "1", method: "settings.set", params: {} })).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/extension-api/src/frame.test.ts packages/extension-api/src/manifest.test.ts
```

Expected: FAIL because the frame protocol and field schema do not exist.

- [ ] **Step 3: Implement the protocol and validators**

The frame protocol readers are total: a wrong nonce type, unknown method, extra key, or a write method without a string `gestureToken` returns `undefined`.

- [ ] **Step 4: Run the extension-api suite**

```bash
npx vitest run packages/extension-api/src
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/extension-api/src/frame.ts src/web/packages/extension-api/src/manifest.ts src/web/packages/extension-api/src/index.ts
git commit -m "feat(extension-api): define the frame protocol

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: Serve plugin UI under a restrictive CSP

**Files:**
- Create: `src/web/packages/host/src/server/extension-ui-routes.ts`
- Modify: `src/web/packages/host/src/server.ts`
- Modify: `src/web/packages/host/src/extensions/service.ts`
- Test: `src/web/packages/host/src/server/extension-ui-routes.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ExtensionUiRouteDeps {
  readonly service: ExtensionService;
}
export function handleExtensionUiRoutes(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  url: URL,
  deps: ExtensionUiRouteDeps,
): Promise<boolean>;
```

Routes: `GET /api/extensions/:publisher/:id/ui/*`. The path after `/ui/` is resolved against the installed plugin directory with `path.resolve`; a result outside the directory, a symlink (`lstat` is not a regular file), a directory, or a missing file is 404. MIME is by extension: `.html`, `.js`, `.css`, `.json`, `.png`, `.svg`, `.woff2`; anything else is `application/octet-stream` and `attachment`. Headers on every answer:

```text
content-security-policy: default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; frame-ancestors 'self'
x-content-type-options: nosniff
cache-control: no-store
```

The route is loopback-only, like the editor and every other management surface. A non-loopback request is 403 before the plugin directory is read.

- [ ] **Step 1: Write the failing test**

```ts
it("refuses a traversal path and serves the entry with CSP", async () => {
  expect(await get("/api/extensions/local/acme/ui/../secret.js")).toBe(404);
  const response = await get("/api/extensions/local/acme/ui/index.html");
  expect(response.status).toBe(200);
  expect(response.headers["content-security-policy"]).toContain("default-src 'none'");
  expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'self'");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run packages/host/src/server/extension-ui-routes.test.ts
```

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement the route**

Read the installed plugin through the service, never from a user-supplied path. Use `createReadStream` after `lstat` confirms a regular file inside the plugin directory.

- [ ] **Step 4: Run the host route test**

```bash
npx vitest run packages/host/src/server/extension-ui-routes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/host/src/server/extension-ui-routes.ts src/web/packages/host/src/server.ts src/web/packages/host/src/extensions/service.ts
git commit -m "feat(host): serve sandboxed plugin UI

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: Host the frame and gate every request

**Files:**
- Create: `src/web/packages/editor/src/plugin-frame/plugin-frame.tsx`
- Create: `src/web/packages/editor/src/plugin-frame/use-plugin-frame.ts`
- Test: `src/web/packages/editor/src/plugin-frame/plugin-frame.dom.test.tsx`
- Test: `src/web/packages/editor/src/plugin-frame/use-plugin-frame.dom.test.ts`

**Interfaces:**
- Produces:

```ts
export interface PluginFrameProps {
  readonly pluginKey: string;
  readonly entry: string;
  readonly title: string;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly theme: FrameInit["theme"];
  readonly onRequest: (request: FrameRequest, gestureToken: string | undefined) => Promise<unknown>;
  readonly onHeight?: (height: number) => void;
}

export function PluginFrame(props: PluginFrameProps): React.JSX.Element;

export interface PluginFrameSession {
  readonly nonce: string;
  readonly ready: boolean;
  readonly error: string | undefined;
  request(method: FrameMethod, params: unknown): Promise<unknown>;
  grantGesture(): string;
  setSettings(settings: Readonly<Record<string, unknown>>): void;
}
export function usePluginFrame(options: {
  readonly pluginKey: string;
  readonly entry: string;
  readonly iframe: React.RefObject<HTMLIFrameElement | null>;
  readonly onRequest: PluginFrameProps["onRequest"];
}): PluginFrameSession;
```

Rules:

- The iframe `src` is `/api/extensions/<publisher>/<id>/ui/<entry>`; `sandbox="allow-scripts"`; no `allow`.
- The editor creates a random nonce per mount and sends `FrameInit` on the frame's first `ready` event.
- A message is accepted only when `event.source === iframe.contentWindow`, `event.origin === window.location.origin`, and `message.nonce` matches. An opaque-origin sandboxed frame posts `event.origin === "null"`; compare the source and nonce, never the origin string.
- `grantGesture()` mints a random token and keeps it for one write request or 30 seconds, whichever comes first. The host surface draws an explicit "Enable controls" button; no pointer event inside the frame can mint a token.
- `request` calls `onRequest` with the token for write methods and `undefined` for reads. The frame never receives the token in a broadcast.

- [ ] **Step 1: Write the failing tests**

```ts
it("ignores a message from another source or with the wrong nonce", async () => {
  const onRequest = vi.fn();
  render(<PluginFrame {...props({ onRequest })} />);
  window.dispatchEvent(new MessageEvent("message", { data: validRequest({ nonce: "wrong" }), source: iframe.contentWindow }));
  expect(onRequest).not.toHaveBeenCalled();
});

it("passes a gesture token only to a write method", async () => {
  const session = renderHook(() => usePluginFrame(...));
  act(() => session.result.current.grantGesture());
  await session.result.current.request("settings.set", {});
  expect(onRequest).toHaveBeenCalledWith(expect.objectContaining({ method: "settings.set" }), expect.any(String));
  await session.result.current.request("settings.get", {});
  expect(onRequest).toHaveBeenLastCalledWith(expect.objectContaining({ method: "settings.get" }), undefined);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/editor/src/plugin-frame
```

Expected: FAIL because the frame host does not exist.

- [ ] **Step 3: Implement the frame host**

Use `useEffect` for the message listener, remove it on unmount, and revoke the gesture token after one use. A malformed message is ignored silently; a valid request whose method the session cannot answer returns a `FrameResult` with `ok: false` and a stated reason.

- [ ] **Step 4: Run the frame tests**

```bash
npx vitest run packages/editor/src/plugin-frame
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/editor/src/plugin-frame
git commit -m "feat(editor): host sandboxed plugin frames

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: Install and consent from the editor

**Files:**
- Create: `src/web/packages/editor/src/plugin-manager/plugin-manager.tsx`
- Create: `src/web/packages/editor/src/plugin-manager/use-extensions.ts`
- Create: `src/web/packages/editor/src/plugin-manager/plugin-manager.dom.test.tsx`
- Modify: `src/web/packages/editor/src/settings-mode/region.tsx`
- Modify: `src/web/packages/editor/src/settings-mode/nav.ts`

**Interfaces:**
- Produces:

```ts
export interface EditorProviderOrder {
  readonly version: 1;
  readonly pluginOrder: readonly string[];
}
export interface ExtensionClient {
  list(): Promise<readonly InstalledExtension[]>;
  install(bytes: Uint8Array): Promise<{ readonly ok: boolean; readonly message?: string }>;
  grant(key: string, fingerprint: string): Promise<{ readonly ok: boolean; readonly message?: string }>;
  remove(key: string): Promise<void>;
  readProviderOrder(): Promise<EditorProviderOrder>;
  writeProviderOrder(order: EditorProviderOrder): Promise<{ readonly ok: boolean; readonly message?: string }>;
}
export function useExtensions(client?: ExtensionClient): {
  readonly extensions: readonly InstalledExtension[];
  readonly providerOrder: EditorProviderOrder;
  readonly error: string | undefined;
  readonly refresh: () => Promise<void>;
  readonly install: (file: File) => Promise<void>;
  readonly grant: (key: string, fingerprint: string) => Promise<void>;
  readonly remove: (key: string) => Promise<void>;
  readonly reorderProvider: (key: string, direction: -1 | 1) => Promise<void>;
};

export interface PluginManagerProps {
  readonly extensions: readonly InstalledExtension[];
  readonly providerOrder: EditorProviderOrder;
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly onInstall: (file: File) => void;
  readonly onGrant: (key: string, fingerprint: string) => void;
  readonly onRemove: (key: string) => void;
  readonly onReorderProvider: (key: string, direction: -1 | 1) => void;
}
export function PluginManager(props: PluginManagerProps): JSX.Element;
```

Rules: the manager is a Settings page under a new `extensions` section, after the built-in pages. It lists each extension's name, qualified key, version, execution profile, capability list, contribution names, device allowlists, and declared panel commands — all as plain text, never rendered as markup. An extension with `consent: "missing"` shows an **Approve** button that passes the host-computed `fingerprint` back; the editor never computes a fingerprint. **Install** reads one `.zip` file as bytes and posts it; a 413 or a validation message is shown verbatim. **Remove** asks for confirmation that names the extension, then removes it. Providers listed in `providerOrder` render in that order with **Move up** / **Move down** buttons; the built-ins are not shown and cannot move. The page only calls the loopback-only `/api/extensions` routes.

- [ ] **Step 1: Write the failing tests**

```tsx
it("shows the capabilities and approves with the host fingerprint", async () => {
  const onGrant = vi.fn();
  render(<PluginManager extensions={[missingConsent()]} providerOrder={{ version: 1, pluginOrder: [] }} busy={false} onGrant={onGrant} onInstall={vi.fn()} onRemove={vi.fn()} onReorderProvider={vi.fn()} />);
  expect(screen.getByText("sensor:provide")).toBeInTheDocument();
  expect(screen.getByText("trusted-worker")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Approve" }));
  expect(onGrant).toHaveBeenCalledWith("local/acme-sensors", "yc1-abc123");
});

it("does not render plugin-supplied markup", () => {
  render(<PluginManager extensions={[pluginNamed("<img src=x onerror=alert(1)>")]} providerOrder={{ version: 1, pluginOrder: [] }} busy={false} onGrant={vi.fn()} onInstall={vi.fn()} onRemove={vi.fn()} onReorderProvider={vi.fn()} />);
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
});

it("installs one chosen file as bytes", async () => {
  const onInstall = vi.fn();
  render(<PluginManager extensions={[]} providerOrder={{ version: 1, pluginOrder: [] }} busy={false} onInstall={onInstall} onGrant={vi.fn()} onRemove={vi.fn()} onReorderProvider={vi.fn()} />);
  await user.upload(screen.getByLabelText("Install extension"), new File([new Uint8Array([1])], "acme.zip"));
  expect(onInstall).toHaveBeenCalledWith(expect.objectContaining({ name: "acme.zip" }));
});

it("moves a plugin provider down without moving built-ins", async () => {
  const onReorderProvider = vi.fn();
  render(<PluginManager extensions={[providerPlugin("local/acme")]} providerOrder={{ version: 1, pluginOrder: ["local/acme"] }} busy={false} onGrant={vi.fn()} onInstall={vi.fn()} onRemove={vi.fn()} onReorderProvider={onReorderProvider} />);
  await user.click(screen.getByRole("button", { name: "Move local/acme down" }));
  expect(onReorderProvider).toHaveBeenCalledWith("local/acme", 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/editor/src/plugin-manager/plugin-manager.dom.test.tsx
```

Expected: FAIL because the manager does not exist.

- [ ] **Step 3: Implement the manager and its client**

`ExtensionClient` wraps `fetch` with `credentials: "same-origin"` and the existing JSON error reader. `useExtensions` refreshes after every install, grant, removal, and reorder; `reorderProvider` swaps the key with its neighbour and PUTs the whole order. `PluginManager` uses the existing Settings `Page`, `Group`, and button components; no new visual language. Store installs that answer `consentRequired` open this same page with the extension's Approve button focused.

- [ ] **Step 4: Run the plugin-manager suite**

```bash
npx vitest run packages/editor/src/plugin-manager
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/editor/src/plugin-manager src/web/packages/editor/src/settings-mode
git commit -m "feat(editor): install and consent extensions

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: Render declarative settings pages

**Files:**
- Create: `src/web/packages/editor/src/settings-mode/plugin-pages.tsx`
- Modify: `src/web/packages/editor/src/settings-mode/nav.ts`
- Modify: `src/web/packages/editor/src/settings-mode/region.tsx`
- Modify: `src/web/packages/editor/src/settings-mode/use-host-settings.ts`
- Modify: `src/web/packages/host/src/extensions/settings.ts`
- Test: `src/web/packages/editor/src/settings-mode/plugin-pages.dom.test.tsx`
- Test: `src/web/packages/host/src/extensions/settings.test.ts`

**Interfaces:**
- Produces:

```ts
export type SettingsPage = BuiltinSettingsPage | `plugin:${string}`;

export interface PluginSettingsPage {
  readonly pluginKey: string;
  readonly id: string;
  readonly label: string;
  readonly section: string | undefined;
  readonly fields: readonly SettingsField[] | undefined;
  readonly ui: string | undefined;
}
export function pluginSettingsPages(extensions: readonly InstalledExtension[]): readonly PluginSettingsPage[];

export interface PluginSettingsStore {
  read(pluginKey: string): Promise<Readonly<Record<string, unknown>>>;
  write(pluginKey: string, values: Readonly<Record<string, unknown>>): Promise<{ readonly ok: boolean; readonly message?: string }>;
}
```

Routes: `GET /api/extensions/:key/settings` and `PUT /api/extensions/:key/settings`. The host validates against the page's declared fields: a text value is a string at most `maxLength`; a number is finite and within `[min,max]`; a boolean is boolean; a select value is one of the declared options; a secret is written to the plugin's secret store under the field key and never returned. Unknown keys are refused. Loopback and origin checked.

Editor: `SETTINGS_PAGES` remains the built-in list. `Settings` receives `pluginPages` and appends them under their `section` (default `editor`). A declarative page renders one `PluginSettingsForm`; a sandboxed page renders `PluginFrame` with `entry: ui`.

- [ ] **Step 1: Write the failing tests**

Host:

```ts
it("refuses an unknown settings key and leaves the file unchanged", async () => {
  expect(await store.write("local/acme", { extra: 1 })).toEqual({
    ok: false,
    message: 'The plugin settings page declares no "extra" field.',
  });
  expect(await store.read("local/acme")).toEqual({});
});
```

DOM:

```tsx
it("renders a plugin page under Settings and saves a declared field", async () => {
  render(<Settings ... pluginPages={[pageWithTextField()]} />);
  await user.click(screen.getByRole("button", { name: "Acme" }));
  await user.type(screen.getByLabelText("API key"), "secret");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(saveSettings).toHaveBeenCalledWith("local/acme", { apiKey: "secret" });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/host/src/extensions/settings.test.ts packages/editor/src/settings-mode/plugin-pages.dom.test.tsx
```

Expected: FAIL because plugin pages are not in Settings.

- [ ] **Step 3: Implement the settings store and pages**

Reuse `createJsonFile` and `createSecretStore`. A page with no `fields` and no `ui` is refused at manifest validation. The generic form uses the existing `ControlWell`, `Group`, and `Page` components; it does not add a second design language.

- [ ] **Step 4: Run the settings suites**

```bash
npx vitest run packages/host/src/extensions/settings.test.ts packages/editor/src/settings-mode
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/editor/src/settings-mode src/web/packages/host/src/extensions/settings.ts
git commit -m "feat: render plugin settings pages

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: Render sandboxed settings and custom asset bodies

**Files:**
- Modify: `src/web/packages/editor/src/settings-mode/plugin-pages.tsx`
- Create: `src/web/packages/editor/src/asset-finder/plugin-body.tsx`
- Modify: `src/web/packages/editor/src/asset-finder/finder-body.tsx`
- Modify: `src/web/packages/renderer-core/src/assets/wire.ts`
- Modify: `src/web/packages/host/src/assets/routes.ts`
- Test: `src/web/packages/editor/src/settings-mode/plugin-pages.dom.test.tsx`
- Test: `src/web/packages/editor/src/asset-finder/plugin-body.dom.test.tsx`
- Test: `src/web/packages/host/src/assets/routes.test.ts`

**Interfaces:**
- `AssetSourceListing.body` becomes `string`; the built-in bodies stay `"grid"`, `"font-picker"`, and `"wallpaper-engine"`.
- `PluginAssetBodyProps`:

```ts
export interface PluginAssetBodyProps {
  readonly source: AssetSourceListing;
  readonly page: AssetPage | undefined;
  readonly query: string;
  readonly onQuery: (query: string) => void;
  readonly onPage: (page: number) => void;
  readonly onPick: (result: AssetResult) => void;
}
```

Rules: `bodyOf` returns the source's body (the built-in bodies stay `"grid"`, `"font-picker"`, and `"wallpaper-engine"`); `finder-body.tsx` chooses `grid` for unknown bodies when the source has no `ui:frame` capability, and the plugin body when it does. The plugin body frame receives `query`, the current `AssetPage`, and sends `asset.search` / `asset.bytes` requests back through the frame bridge. A source with an unknown body and no `ui:frame` is listed but its body shows the stated refusal, not a blank grid.

- [ ] **Step 1: Write the failing tests**

```ts
it("renders the plugin body for a custom body with ui:frame", () => {
  render(<FinderBody source={source({ body: "melody", ui: true })} ... />);
  expect(screen.getByTitle("Melody")).toBeInTheDocument();
});

it("shows the refusal for a custom body without ui:frame", () => {
  render(<FinderBody source={source({ body: "melody", ui: false })} ... />);
  expect(screen.getByText("This source needs a plugin UI this build cannot show.")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/editor/src/asset-finder packages/host/src/assets/routes.test.ts
```

Expected: FAIL because the body union is still closed.

- [ ] **Step 3: Implement the custom body and route listing**

The host listing includes the source's `body` unchanged; no editor code names the new category. The frame's asset requests go through the existing `searchAssets` and `readAssetBytes` clients, so the plugin UI never receives a host credential.

- [ ] **Step 4: Run the asset-finder and asset-route suites**

```bash
npx vitest run packages/editor/src/asset-finder packages/host/src/assets/routes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/editor/src/settings-mode/plugin-pages.tsx src/web/packages/editor/src/asset-finder src/web/packages/renderer-core/src/assets/wire.ts src/web/packages/host/src/assets/routes.ts
git commit -m "feat: render plugin settings and asset bodies

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: Document the sandbox and run the gate

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/operations.md`

- [ ] **Step 1: Update the docs**

State the sandbox attributes, CSP, nonce protocol, gesture token, and the declarative field set.

- [ ] **Step 2: Run the gate**

```bash
cd src/web
npm run gate
echo "exit=$?"
```

Expected: `exit=0`.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture.md docs/operations.md
git commit -m "docs: describe the plugin UI sandbox

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```
