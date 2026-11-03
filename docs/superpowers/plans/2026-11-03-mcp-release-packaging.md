# MCP Release Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the MCP server and the theme-designer skill both inside the `yunari` bundle and as a standalone `yunari-mcp` package, with one interactive installer and a session-stable server entry.

**Architecture:** `@yunari/mcp` keeps ownership of the server, installer and wizard. `scripts/stage-npm-package.mjs` stages two trees from the same build; the publish workflow packs, smoke-tests and publishes both at one version. The host launcher routes `yunari mcp …` to the bundled bin and the tray gains one row that opens it.

**Tech Stack:** TypeScript, Node 22 stdlib (`readline/promises`, `realpathSync`), `add-mcp` 2.6.1, `skills` 1.7.5, Vite SSR, Vitest, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-03-mcp-release-packaging-design.md`

**Recommended execution:** native (`superpowers:executing-plans`). Tasks 1–4 all edit `src/web/packages/mcp/src/install.ts` in sequence and each signature is fixed here, so a fresh context per task would re-learn the same file; one implementer follows the chain with one final review.

## Global Constraints

- Node `>=22`; no new runtime dependency — the wizard uses `node:readline/promises`.
- Never hand-write an agent config: writes and reads go through `add-mcp`.
- The installed server entry must name `realpathSync(process.execPath)` when readable, and the package's own `bin/yunari-mcp.js`.
- The skill has no version of its own; one package version, one tag.
- Staged output must be outside the source tree and empty or absent.
- Every interactive choice has a flag; non-TTY without `--yes` exits 2.
- Missing telemetry is never fabricated; likewise a partial install is never reported as installed.
- Do not push, publish or merge to a remote. Local commits only.

## Review Focus

- Piped or CI install with no TTY must print the choices and exit 2, never block on stdin.
- A globally installed bin launched through a symlink or shim must record an interpreter that still exists next session.
- `--mcp-out` pointing at `--out`, inside the source tree, or at a non-empty directory must be refused before any copy.
- Two agents selected, one failing: the report must show per-half and per-agent failure and a non-zero exit.
- Standalone `yunari-mcp` tarball must contain no `@yunari/*` dependency and must start without a checkout.

---

### Task 1: Session-stable server entry

**Files:**
- Modify: `src/web/packages/mcp/src/install.ts`
- Test: `src/web/packages/mcp/src/install.test.ts`

**Interfaces:**
- Consumes: existing `ServerEntry`, `InstallPorts`, `createPorts`.
- Produces:
  - `export function resolveInterpreter(execPath: string): string` — returns `realpathSync(execPath)` when that succeeds, otherwise `execPath`.
  - `export function serverEntryFor(serverEntry: string, url: string | undefined, interpreter?: string): ServerEntry` — third parameter defaults to `resolveInterpreter(process.execPath)`.
  - `InstallPorts` gains `readonly interpreter: string`; `createPorts` accepts `interpreter?: string` and defaults to `resolveInterpreter(process.execPath)`.

- [ ] **Step 1: Write the failing test**

In `src/web/packages/mcp/src/install.test.ts` add:

```ts
import { mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";

it("records the real interpreter, not a per-session shim", () => {
  const dir = mkdtempSync(join(tmpdir(), "yunari-interp-"));
  const real = join(dir, "node.exe");
  writeFileSync(real, "");
  const shim = join(dir, "shim.exe");
  symlinkSync(real, shim);
  expect(resolveInterpreter(shim)).toBe(realpathSync(real));
});

it("leaves an unreadable interpreter path unchanged", () => {
  const missing = join(tmpdir(), "yunari-no-such-node.exe");
  expect(resolveInterpreter(missing)).toBe(missing);
});

it("serverEntryFor uses the supplied interpreter and the entry path verbatim", () => {
  expect(serverEntryFor("C:/pkg/bin/yunari-mcp.js", "http://127.0.0.1:5227", "C:/node.exe"))
    .toEqual({
      command: "C:/node.exe",
      args: ["C:/pkg/bin/yunari-mcp.js", "serve", "--url", "http://127.0.0.1:5227"],
      autoApproveTools: [],
    });
});
```

Adjust the third assertion to the current `serverEntryFor` argument order if the existing test differs; the production behaviour must not change beyond the interpreter default.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/web && npx vitest run packages/mcp/src/install.test.ts`
Expected: FAIL — `resolveInterpreter` is not exported.

- [ ] **Step 3: Implement**

In `install.ts`, import `realpathSync` from `node:fs` and add `resolveInterpreter`. Change `serverEntryFor` to take `interpreter = resolveInterpreter(process.execPath)` and use it for `command`. Add `interpreter` to `InstallPorts` and to `CreateIntegrationPortsOptions`; `install()` passes `ports.interpreter` to `serverEntryFor`.

- [ ] **Step 4: Run tests**

Run: `cd src/web && npx vitest run packages/mcp/src/install.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/mcp/src/install.ts src/web/packages/mcp/src/install.test.ts
git commit -m "fix(mcp): record a session-stable interpreter in the server entry"
```

---

### Task 2: Package-local skill source and drift status

**Files:**
- Modify: `src/web/packages/mcp/src/install.ts`
- Test: `src/web/packages/mcp/src/install.test.ts`

**Interfaces:**
- Consumes: `createPorts`, `status`, `InstallPorts`.
- Produces:
  - `export function resolveSkillSourceDir(packageDir: string, exists?: (path: string) => boolean): string` — returns `join(packageDir, "skills", SKILL_NAME)` when it exists, otherwise the checkout fallback `join(packageDir, "..", "..", "..", "..", "skills", SKILL_NAME)`.
  - `export type SkillState = "current" | "drifted" | "not-installed"`.
  - `export function compareSkill(installedDir: string | undefined, bundledDir: string): SkillState` — `"not-installed"` when `installedDir` is undefined; otherwise compares every `.md` file under `bundledDir` by relative POSIX path and byte equality; missing or differing file → `"drifted"`.
  - `StatusReport.skill` gains `state: SkillState`.
  - `InstallPorts` gains `readonly bundledSkillDir: string` and `readonly installedServer: (agents: readonly string[]) => Promise<{ readonly command?: string; readonly args: readonly string[] } | undefined>`; `createPorts` implements it through `listInstalledServers({global: true, agents})`.
  - `status()` reports `server.present` only when both the recorded `command` and the entry file in `args` exist, and names the repair `re-run install` otherwise.

- [ ] **Step 1: Write the failing tests**

```ts
it("prefers the package-local skill and falls back to the checkout", () => {
  const packageDir = join(tmpdir(), "yunari-pkg");
  const bundled = join(packageDir, "skills", SKILL_NAME);
  expect(resolveSkillSourceDir(packageDir, (p) => p === bundled)).toBe(bundled);
  expect(resolveSkillSourceDir(packageDir, () => false)).toBe(
    join(packageDir, "..", "..", "..", "..", "skills", SKILL_NAME),
  );
});

it("reports a drifted skill when a reference differs", () => {
  const bundled = mkdtempSync(join(tmpdir(), "yunari-skill-bundled-"));
  const installed = mkdtempSync(join(tmpdir(), "yunari-skill-installed-"));
  for (const dir of [bundled, installed]) {
    mkdirSync(join(dir, "references"));
    writeFileSync(join(dir, "SKILL.md"), "a");
    writeFileSync(join(dir, "references", "design-rules.md"), "b");
  }
  expect(compareSkill(installed, bundled)).toBe("current");
  writeFileSync(join(installed, "references", "design-rules.md"), "changed");
  expect(compareSkill(installed, bundled)).toBe("drifted");
  expect(compareSkill(undefined, bundled)).toBe("not-installed");
});

it("reports an entry whose interpreter vanished as absent with a repair", async () => {
  const ports = fakePorts(home, { serverEntryRecorded: {
    command: join(home, "gone", "node.exe"),
    args: [join(home, "pkg", "bin", "yunari-mcp.js"), "serve"],
  } });
  const report = await status(ports);
  expect(report.server.present).toBe(false);
  expect(report.server.detail).toContain("re-run install");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/web && npx vitest run packages/mcp/src/install.test.ts`
Expected: FAIL — `resolveSkillSourceDir` and `compareSkill` are not exported.

- [ ] **Step 3: Implement**

Use `readdirSync(..., { recursive: true, withFileTypes: true })` or a small recursive walk; compare `readFileSync(...).equals(...)`. Replace the inline `skillSourceDir` expression in `createPorts` with `resolveSkillSourceDir(packageDir)`, and set `bundledSkillDir` there. In `status()`, add `state: compareSkill(found, ports.bundledSkillDir)`.

**Ruling:** the spec's "entry names a different package version" check is dropped — the entry records no version, and adding one would change the registered command line for information `status` already has from the running package. Cost if wrong: a stale entry is reported as present until its interpreter or bin is missing. Upgrade path: append `--version` to the entry args and compare.

- [ ] **Step 4: Run tests**

Run: `cd src/web && npx vitest run packages/mcp/src/install.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/mcp/src/install.ts src/web/packages/mcp/src/install.test.ts
git commit -m "feat(mcp): resolve the skill inside the package and report drift"
```

---

### Task 3: Multi-agent install choices

**Files:**
- Modify: `src/web/packages/mcp/src/install.ts`
- Create: `src/web/packages/mcp/src/choices.ts`
- Test: `src/web/packages/mcp/src/install.test.ts`, `src/web/packages/mcp/src/choices.test.ts`

**Interfaces:**
- Consumes: `InstallPorts` from Tasks 1–2.
- Produces:
  - `export interface InstallChoices { readonly agents: readonly string[]; readonly scope: "global" | "local"; readonly skill: boolean; readonly autoApprove: boolean; readonly url?: string; readonly cwd: string }`
  - `export const DEFAULT_CHOICES: Omit<InstallChoices, "cwd">` — `{agents: ["claude-code"], scope: "global", skill: true, autoApprove: true}`.
  - `export function parseInstallArgs(argv: readonly string[]): { readonly kind: "choices"; readonly choices: Partial<InstallChoices>; readonly yes: boolean; readonly json: boolean } | { readonly kind: "error"; readonly message: string }` — handles `--agent <id>` (repeatable), `--scope global|local`, `--skill`, `--no-skill`, `--auto-approve all|none`, `--url <url>`, `--yes`, `--json`, `--help`.
  - `export function resolveChoices(partial: Partial<InstallChoices>, cwd: string): InstallChoices` — fills every unspecified value from `DEFAULT_CHOICES`; `--auto-approve all` → `true`.
  - `install(ports: InstallPorts, choices: InstallChoices)` replaces the old `install(ports, url?)`; `uninstall(ports, choices)` mirrors it.
- Port signature changes: `upsert(agent, config, options)`, `remove(agent, options)`, `isServerInstalled(agents, scope, cwd)`.

- [ ] **Step 1: Write the failing tests**

```ts
it("parses repeated agents and every flag", () => {
  expect(parseInstallArgs([
    "install", "--agent", "claude-code", "--agent", "cursor",
    "--scope", "local", "--no-skill", "--auto-approve", "none",
    "--url", "http://127.0.0.1:5300", "--yes", "--json",
  ])).toEqual({
    kind: "choices",
    choices: {
      agents: ["claude-code", "cursor"], scope: "local", skill: false,
      autoApprove: false, url: "http://127.0.0.1:5300",
    },
    yes: true, json: true,
  });
});

it("defaults every unspecified choice", () => {
  expect(resolveChoices({}, "/work")).toEqual({
    agents: ["claude-code"], scope: "global", skill: true,
    autoApprove: true, cwd: "/work",
  });
});

it("rejects an unknown flag and a bad scope", () => {
  expect(parseInstallArgs(["install", "--nope"]).kind).toBe("error");
  expect(parseInstallArgs(["install", "--scope", "everywhere"]).kind).toBe("error");
});
```

Installer test, using the existing `fakePorts` extended with agent recording:

```ts
it("registers the server for each selected agent exactly once", async () => {
  const ports = fakePorts(home);
  const report = await install(ports, {
    agents: ["claude-code", "cursor"], scope: "global", skill: false,
    autoApprove: true, cwd: home,
  });
  expect(report.ok).toBe(true);
  expect(ports.upserts.map((call) => call.agent)).toEqual(["claude-code", "cursor"]);
  expect(ports.upserts[0]?.config.autoApproveTools).toEqual([]);
});

it("reports failure and keeps the other agent's step when one agent fails", async () => {
  const ports = fakePorts(home, { upsertFailsFor: "cursor" });
  const report = await install(ports, {
    agents: ["claude-code", "cursor"], scope: "global", skill: false,
    autoApprove: true, cwd: home,
  });
  expect(report.ok).toBe(false);
  expect(report.steps.filter((step) => step.step === "server" && step.ok)).toHaveLength(1);
});

it("removes exactly the agents and halves it installed", async () => {
  const ports = fakePorts(home);
  await install(ports, {
    agents: ["claude-code", "cursor"], scope: "global", skill: false,
    autoApprove: true, cwd: home,
  });
  ports.removes.length = 0;
  await uninstall(ports, {
    agents: ["claude-code", "cursor"], scope: "global", skill: false,
    autoApprove: true, cwd: home,
  });
  expect(ports.removes.map((call) => call.agent)).toEqual(["claude-code", "cursor"]);
  expect(ports.skillCalls).toHaveLength(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/web && npx vitest run packages/mcp/src/choices.test.ts packages/mcp/src/install.test.ts`
Expected: FAIL — module `choices.js` not found; `install` arity mismatch.

- [ ] **Step 3: Implement**

`choices.ts` holds the constants and pure parser only; it imports no `add-mcp`. `install()` asks `ports.fileExists(ports.serverEntry)` once, then loops `choices.agents`, pushing one `server` step per agent with the agent id in `detail`. A successful step appends `result.droppedFields` to its detail when add-mcp reports any, so a field the target agent cannot read is visible rather than silent. `scope: "local"` passes `{local: true, cwd: choices.cwd}` to `upsert`/`remove`. `choices.skill` gates the existing skill block; skill installation stays one universal copy through `SKILL_AGENT`, because `~/.agents/skills` is read by Claude Code and Codex already. `uninstall` loops the same agents and skips the skill block when `choices.skill` is false.

- [ ] **Step 4: Run tests**

Run: `cd src/web && npx vitest run packages/mcp/src/choices.test.ts packages/mcp/src/install.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/mcp/src/install.ts src/web/packages/mcp/src/choices.ts \
  src/web/packages/mcp/src/choices.test.ts src/web/packages/mcp/src/install.test.ts
git commit -m "feat(mcp): install for several agents and scopes from one choice set"
```

---

### Task 4: Installer wizard and CLI

**Files:**
- Create: `src/web/packages/mcp/src/wizard.ts`
- Modify: `src/web/packages/mcp/src/main.ts`
- Test: `src/web/packages/mcp/src/wizard.test.ts`, `src/web/packages/mcp/src/main.test.ts`

**Interfaces:**
- Consumes: `parseInstallArgs`, `resolveChoices`, `InstallChoices`.
- Produces:
  - `export interface WizardIo { ask(question: string): Promise<string>; write(text: string): void }`
  - `export async function runWizard(io: WizardIo, cwd: string, detected: readonly string[], probe: () => Promise<string | undefined>): Promise<InstallChoices>` — asks agents (four common plus an “other id” answer, default `1` = claude-code), scope, skill, auto-approve, host URL; the URL question offers the probed answer when `probe()` finds one, accepts a typed URL, or leaves it unset; returns `resolveChoices(...)`.
  - `export function refusal(): string` — the text printed when choices are missing and stdin is not a TTY.
  - `main.ts`: `yunari-mcp` with no command on a TTY opens a menu `1) Install 2) Uninstall 3) Status 0) Exit`; `--json` prints `JSON.stringify(report)`; `--yes` fills defaults; non-TTY without `--yes` writes `refusal()` to stderr and returns 2.

- [ ] **Step 1: Write the failing tests**

```ts
it("takes its defaults from an empty answer list", async () => {
  const answers = ["", "", "", "", ""];
  const io = { ask: async () => answers.shift() ?? "", write: () => {} };
  expect(await runWizard(io, "/work", ["claude-code"], async () => undefined)).toEqual({
    agents: ["claude-code"], scope: "global", skill: true,
    autoApprove: true, cwd: "/work",
  });
});

it("accepts a comma list of agents", async () => {
  const answers = ["1,3", "2", "n", "2", ""];
  const io = { ask: async () => answers.shift() ?? "", write: () => {} };
  const choices = await runWizard(io, "/work", ["claude-code", "cursor", "vscode"], async () => undefined);
  expect(choices.agents).toEqual(["claude-code", "vscode"]);
  expect(choices.scope).toBe("local");
  expect(choices.skill).toBe(false);
  expect(choices.autoApprove).toBe(false);
});
```

`main.test.ts`: one case calls `run(["install"])` with an injected `{isTTY: false}` and expects exit code 2 and `refusal()` on the error stream.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/web && npx vitest run packages/mcp/src/wizard.test.ts packages/mcp/src/main.test.ts`
Expected: FAIL — `wizard.js` not found.

- [ ] **Step 3: Implement**

`wizard.ts` uses only `WizardIo`; `main.ts` builds it from `node:readline/promises` over `process.stdin`/`process.stdout`. The summary line lists each agent and whether the skill and auto-approval will be written, then one `ask("Install? [Y/n] ")`. `run()` gains an injectable `io?: {isTTY?: boolean}` on an options argument used only by tests.

- [ ] **Step 4: Run tests**

Run: `cd src/web && npx vitest run packages/mcp/src/wizard.test.ts packages/mcp/src/main.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/mcp/src/wizard.ts src/web/packages/mcp/src/wizard.test.ts \
  src/web/packages/mcp/src/main.ts src/web/packages/mcp/src/main.test.ts
git commit -m "feat(mcp): add the interactive installer wizard and its flags"
```

---

### Task 5: Stage the bundle and the standalone package

**Files:**
- Modify: `scripts/stage-npm-package.mjs`
- Test: `src/web/tests/scripts/stage-npm-package.test.ts`

**Interfaces:**
- Consumes: existing `stagePackage`, `runtimeDependencies`.
- Produces:
  - `export const MCP_DEPENDENCIES = ["@modelcontextprotocol/server", "add-mcp", "culori", "skills", "zod"]`
  - `export function stageMcpPackage({source, out, version, expectVersion, dependencies}): {ok: true; version; files; bytes} | {ok: false; errors: string[]}` — copies `bin/`, `dist/main.js`, `dist/main.js.map`, `skills/yunari-theme-designer/`, `LICENSE`, `THIRD-PARTY-NOTICES.md`; writes the manifest in the spec.
  - `stagePackage` gains the MCP tree, `bin.yunari-mcp`, and MCP dependencies in its manifest; CLI gains `--mcp-out <dir>` and refuses `--mcp-out` equal to `--out`, inside `--source`, or non-empty.

- [ ] **Step 1: Write the failing tests**

```ts
it("stages a standalone MCP package with no workspace dependency", () => {
  const fake = fakeTree();
  const out = join(fake.root, "mcp");
  const result = stageMcpPackage({
    source: fake.source, out, version: VERSION,
    dependencies: { "add-mcp": "2.6.1", skills: "1.7.5", zod: "4.6.7" },
  });
  expect(result.ok).toBe(true);
  const manifest = JSON.parse(readFileSync(join(out, "package.json"), "utf8"));
  expect(manifest.name).toBe("yunari-mcp");
  expect(manifest.bin).toEqual({ "yunari-mcp": "bin/yunari-mcp.js" });
  expect(Object.keys(manifest.dependencies).some((name) => name.startsWith("@yunari/"))).toBe(false);
  expect(existsSync(join(out, "skills", "yunari-theme-designer", "SKILL.md"))).toBe(true);
});

it("refuses an mcp-out inside the source tree", () => {
  const fake = fakeTree();
  const result = stageMcpPackage({
    source: fake.source, out: join(fake.source, "mcp"), version: VERSION,
    dependencies: {},
  });
  expect(result.ok).toBe(false);
});
```

`fakeTree` grows `src/web/packages/mcp/{bin/yunari-mcp.js,dist/main.js,dist/main.js.map}` and `skills/yunari-theme-designer/{SKILL.md,references/design-rules.md}`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/web && npx vitest run tests/scripts/stage-npm-package.test.ts`
Expected: FAIL — `stageMcpPackage` is not exported.

- [ ] **Step 3: Implement**

Share the refusal helpers (`inside`, empty-directory check, version check) rather than duplicating them. `stagePackage` appends the MCP COPY entries and unions `dependencies` with `runtimeDependencies()` from the lockfile at the CLI layer; the pure function keeps taking the dependency object. `main()` stages the bundle, then `--mcp-out` when given, printing one line per tree.

- [ ] **Step 4: Run tests**

Run: `cd src/web && npx vitest run tests/scripts/stage-npm-package.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/stage-npm-package.mjs src/web/tests/scripts/stage-npm-package.test.ts
git commit -m "feat(release): stage the MCP server as a bundle payload and a package"
```

---

### Task 6: Bundle routing and tray row

**Files:**
- Modify: `src/web/packages/host/src/main.ts`, `src/web/packages/host/src/tray/menu.ts`, `src/web/packages/host/src/main.ts` tray `act` switch
- Test: `src/web/packages/host/src/tray/menu.test.ts`, `src/web/packages/host/src/mcp-command.test.ts`

**Interfaces:**
- Consumes: staged `packages/mcp/bin/yunari-mcp.js` beside the host package.
- Produces:
  - `export function runMcpCommand(argv: readonly string[], packageRoot: string, spawn?: typeof spawnSync): number` in `src/web/packages/host/src/cli/mcp.ts` — returns the child's exit code, or `1` when the bin is missing with the message `The MCP tools are not installed in this package.`
  - `run(argv)` calls it when `argv[0] === "mcp"`, before `parseArgs`.
  - `TraySnapshot` gains `readonly mcp?: boolean`; `buildTrayMenu` adds `{title: "Agent tools (MCP)…", enabled: true, action: "mcp"}` directly after `Host Settings` when `snapshot.mcp === true`.
  - `TrayAction` gains `"mcp"`; the tray `act` case spawns `process.execPath` + `<packageRoot>/packages/mcp/bin/yunari-mcp.js` detached with `stdio: "ignore"`, `windowsHide: false` on Windows.

- [ ] **Step 0: Record the tray ruling**

**Ruling:** the tray renders flat rows only — the Windows adapter maps one action per index, and the Linux adapter cannot add a row after the first menu. The single row therefore opens the MCP CLI, whose own `1) Install 2) Uninstall 3) Status` menu is the submenu the spec asks for. Cost if wrong: the tray has one launch row and the command menu is one keystroke deeper. Upgrade path: a nested `TrayMenuItem.children` protocol in both adapters.

- [ ] **Step 1: Write the failing tests**

```ts
it("routes mcp to the bundled bin with the same arguments", () => {
  const calls: unknown[] = [];
  const code = runMcpCommand(["install", "--yes"], "C:/pkg", ((...args) => {
    calls.push(args);
    return { status: 7 } as never;
  }) as never);
  expect(code).toBe(7);
  expect(calls[0]).toEqual([
    process.execPath,
    join("C:/pkg", "packages", "mcp", "bin", "yunari-mcp.js"),
    "install", "--yes",
  ]);
});

it("omits the tray row when the bundle has no MCP files", () => {
  const titles = (mcp: boolean) =>
    buildTrayMenu({ port: 5227, lan: false, autostart: false, mcp })
      .map((item) => item.title);
  expect(titles(true)).toContain("Agent tools (MCP)…");
  expect(titles(false)).not.toContain("Agent tools (MCP)…");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/web && npx vitest run packages/host/src/cli/mcp.test.ts packages/host/src/tray/menu.test.ts`
Expected: FAIL — `mcp.js` not found; row missing.

- [ ] **Step 3: Implement**

`runMcpCommand` resolves the bin against the host package root (`here` is `packages/host/dist`, so the root is `path.join(here, "..", "..")`). `main.ts` computes `mcpAvailable` once with `existsSync` at startup and passes it in `readSnapshot`. Use `spawnSync` with `stdio: "inherit"` for the CLI route so the wizard keeps the terminal.

- [ ] **Step 4: Run tests**

Run: `cd src/web && npx vitest run packages/host/src/cli/mcp.test.ts packages/host/src/tray/menu.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/host/src/main.ts src/web/packages/host/src/cli/mcp.ts \
  src/web/packages/host/src/cli/mcp.test.ts src/web/packages/host/src/tray/menu.ts \
  src/web/packages/host/src/tray/menu.test.ts
git commit -m "feat(host): route yunari mcp and offer it from the tray"
```

---

### Task 7: Publish both packages

**Files:**
- Modify: `.github/workflows/publish.yml`

**Interfaces:**
- Consumes: `--mcp-out` from Task 5, standalone bin from Task 5.
- Produces: `install` job stages both trees, packs `yunari` and `yunari-mcp`, verifies both tarball listings, installs each in its own clean directory, asserts `yunari --help` and `yunari-mcp --version` answer, and zips both staged trees.

- [ ] **Step 1: Edit the workflow**

Add to the stage step:

```bash
node scripts/stage-npm-package.mjs --out "$STAGE" --mcp-out "$MCP_STAGE" --expect-version "$VERSION"
npm pack "$STAGE" --pack-destination "$TARBALLS"
npm pack "$MCP_STAGE" --pack-destination "$TARBALLS"
```

Add a verification loop that fails when `bin/yunari-mcp.js`, `dist/main.js` or `skills/yunari-theme-designer/SKILL.md` is absent from the standalone tarball, and when the tarball names any `@yunari/` dependency.

- [ ] **Step 2: Verify the YAML parses**

Run: `node -e "require('node:fs').readFileSync('.github/workflows/publish.yml','utf8')"` then push-free check with `npx --yes yaml-lint .github/workflows/publish.yml` if available; otherwise `node -e "const y=require('js-yaml');y.load(require('fs').readFileSync('.github/workflows/publish.yml','utf8'))"` from `src/web/`.
Expected: parses without error.

- [ ] **Step 3: Dry-run both publishes locally**

Run from `src/web`: build host, player, editor and MCP; stage to two temp directories outside the repo; `npm pack` each; `npm publish --dry-run <tarball>`.
Expected: both dry runs succeed and list the expected files.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/publish.yml
git commit -m "ci(release): publish and smoke-test both MCP-bearing packages"
```

---

### Task 8: Documentation

**Files:**
- Modify: `README.md`, `docs/operations.md`, `skills/yunari-theme-designer/references/tool-guide.md`

**Interfaces:**
- Consumes: the final command surface from Tasks 4–6.

- [ ] **Step 1: Update the release docs**

`README.md`: under the release section add `yunari mcp install` and `npm i -g yunari-mcp`. `docs/operations.md`: one paragraph — two tarballs, same tag, reinstall is the update path, first publish of each package is owner-run. `tool-guide.md`: the install/status commands and the non-TTY exit-2 rule.

- [ ] **Step 2: Run the docs check**

Run: `cd src/web && npm run docs:check`
Expected: exit 0.

- [ ] **Step 3: Run the full gate**

Run from `src/web`: `npm run gate` writing output to a file, then read the exit code.
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/operations.md skills/yunari-theme-designer/references/tool-guide.md
git commit -m "docs(release): document the MCP packages and installer"
```
