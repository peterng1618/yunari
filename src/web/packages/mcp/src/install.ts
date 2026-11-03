import { spawn } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type InstallResult,
  listInstalledServers,
  type RemoveServerResult,
  removeServer,
  upsertServer,
} from "add-mcp";
import { type InstallChoices, resolveChoices } from "./choices.js";

/** The agent `add-mcp` registers the server for. */
export const AGENT_TYPE = "claude-code";

/**
 * The skills CLI agent whose global directory is the shared `~/.agents/skills`.
 *
 * `codex` is only the CLI's universal-selector name for that directory
 * (`skillsDir: ".agents/skills"`); it does not add a second MCP agent. The
 * server half stays `AGENT_TYPE`.
 */
export const SKILL_AGENT = "codex";

/** The server entry name the agent shows and the skill refers to. */
export const SERVER_NAME = "yunari";

/** The one permission rule `add-mcp` adds for this server's global install. */
export const AUTO_APPROVAL_RULE = `mcp__${SERVER_NAME}`;

/** The skill folder name, which is also its installed directory name. */
export const SKILL_NAME = "yunari-theme-designer";

/** The stdio entry a registered server runs. */
export interface ServerEntry {
  readonly command: string;
  readonly args: string[];
  /** An empty list means "every tool"; absent means no auto-approval at all. */
  readonly autoApproveTools?: string[];
}

/** The port shape every test injects; production defaults live in `createPorts`. */
export interface InstallPorts {
  /** The home directory the agent config and the skill directory live under. */
  readonly home: string;
  /** The skill folder in this repository. */
  readonly skillSourceDir: string;
  /** The built stdio entry the agent config points at. */
  readonly serverEntry: string;
  /**
   * The Node binary the entry runs. `realpathSync(process.execPath)` where
   * readable: under fnm/nvm `process.execPath` is a per-shell shim whose
   * directory disappears with that shell.
   */
  readonly interpreter: string;
  /** The skill folder inside this package, when it is packaged. */
  readonly bundledSkillDir: string;
  /** Runs the `skills` CLI and resolves its exit code. */
  readonly runSkills: (
    args: readonly string[],
  ) => Promise<{ readonly code: number | null; readonly error?: string }>;
  readonly upsert: (
    agent: string,
    config: ServerEntry,
    options: { readonly local: boolean; readonly cwd?: string },
  ) => InstallResult;
  readonly remove: (
    agent: string,
    options: { readonly local: boolean; readonly cwd?: string },
  ) => RemoveServerResult;
  readonly removeAutoApproval: (options: {
    readonly local: boolean;
    readonly cwd?: string;
  }) => AutoApprovalRemoval;
  readonly isServerInstalled: (
    agents: readonly string[],
    scope: "global" | "local",
    cwd: string,
  ) => Promise<boolean>;
  readonly installedServer: (
    agents: readonly string[],
    scope: "global" | "local",
    cwd: string,
  ) => Promise<
    { readonly command?: string; readonly args: readonly string[] } | undefined
  >;
  /** Every agent that still has the server registered, for shared removals. */
  readonly registeredAgents: (
    scope: "global" | "local",
    cwd: string,
  ) => Promise<readonly string[]>;
  readonly fileExists: (path: string) => boolean;
  readonly probeHost: () => Promise<HostProbe>;
}

/** What the uninstall's settings step found and did. */
export interface AutoApprovalRemoval {
  readonly ok: boolean;
  readonly removed: boolean;
  readonly path: string;
  readonly error?: string;
}

/** What `status` reports about the host: reachable, or the reason it is not. */
export interface HostProbe {
  readonly reachable: boolean;
  readonly url?: string;
  readonly error?: string;
}

/** One half of an install or uninstall, reported on its own. */
export interface StepOutcome {
  readonly step: "server" | "skill" | "approval";
  readonly ok: boolean;
  readonly detail: string;
}

/** Both halves are attempted; `ok` is true only when both succeeded. */
export interface InstallReport {
  readonly ok: boolean;
  readonly steps: readonly StepOutcome[];
  readonly skillPath: string;
}

/** What `status` answers without writing anything. */
export interface StatusReport {
  readonly host: HostProbe;
  readonly server: { readonly present: boolean; readonly detail: string };
  readonly skill: {
    readonly present: boolean;
    readonly path: string;
    readonly state: SkillState;
  };
}

/** Whether the installed skill still matches the copy the package ships. */
export type SkillState = "current" | "drifted" | "not-installed";

/** The canonical installed path named in the design. */
export function skillFilePath(home: string): string {
  return join(home, ".agents", "skills", SKILL_NAME, "SKILL.md");
}

/**
 * The skill this package ships. A staged package carries its own copy, so an
 * installed package never reads the checkout it was built from; a repository
 * run still finds the root `skills/` folder.
 */
export function resolveSkillSourceDir(
  packageDir: string,
  exists: (path: string) => boolean = existsSync,
): string {
  const bundled = join(packageDir, "skills", SKILL_NAME);
  return exists(bundled)
    ? bundled
    : join(packageDir, "..", "..", "..", "..", "skills", SKILL_NAME);
}

/** Every file below `dir`, as relative POSIX paths. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      join(entry.parentPath, entry.name)
        .slice(dir.length + 1)
        .replaceAll("\\", "/"),
    )
    .sort();
}

/**
 * Compares the installed skill with the packaged copy by relative path and
 * bytes. An unreadable packaged copy is reported as drift, never as current.
 */
export function compareSkill(
  installedDir: string | undefined,
  bundledDir: string,
): SkillState {
  if (installedDir === undefined) return "not-installed";
  try {
    const expected = filesUnder(bundledDir);
    const actual = filesUnder(installedDir);
    if (expected.length !== actual.length) return "drifted";
    for (const file of expected) {
      if (
        !readFileSync(join(bundledDir, file)).equals(
          readFileSync(join(installedDir, file)),
        )
      ) {
        return "drifted";
      }
    }
    return "current";
  } catch {
    return "drifted";
  }
}

/** The settings file `add-mcp` writes its auto-approval rule into. A project
 *  install writes the project file instead of the global one. */
export function claudeSettingsPath(
  home: string,
  options: { readonly local?: boolean; readonly cwd?: string } = {},
): string {
  return options.local === true
    ? join(options.cwd ?? process.cwd(), ".claude", "settings.local.json")
    : join(home, ".claude", "settings.json");
}

/**
 * Removes only this server's auto-approval rule from the Claude settings file,
 * leaving every other permission and setting exactly as found. `add-mcp`'s
 * `removeServer` does not undo `installClaudeCodeAutoApproval`, so uninstall
 * does it here through the same file it wrote.
 */
export function removeAutoApprovalRule(
  home: string,
  options: { readonly local?: boolean; readonly cwd?: string } = {},
): AutoApprovalRemoval {
  const path = claudeSettingsPath(home, options);
  if (!existsSync(path)) return { ok: true, removed: false, path };

  let settings: unknown;
  try {
    settings = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { ok: false, removed: false, path, error: messageOf(error) };
  }
  if (
    typeof settings !== "object" ||
    settings === null ||
    Array.isArray(settings)
  ) {
    return {
      ok: false,
      removed: false,
      path,
      error: "it is not a JSON object",
    };
  }

  const record = settings as Record<string, unknown>;
  const permissions = record["permissions"];
  if (
    typeof permissions !== "object" ||
    permissions === null ||
    Array.isArray(permissions)
  ) {
    return { ok: true, removed: false, path };
  }

  const holder = permissions as Record<string, unknown>;
  const allow = holder["allow"];
  if (!Array.isArray(allow) || !allow.includes(AUTO_APPROVAL_RULE)) {
    return { ok: true, removed: false, path };
  }

  holder["allow"] = allow.filter((rule) => rule !== AUTO_APPROVAL_RULE);
  try {
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  } catch (error) {
    return { ok: false, removed: false, path, error: messageOf(error) };
  }
  return { ok: true, removed: true, path };
}

/** Where the CLI put the skill, if it is at the canonical path. */
function installedSkillPath(
  ports: Pick<InstallPorts, "home" | "fileExists">,
): string | undefined {
  const path = skillFilePath(ports.home);
  return ports.fileExists(path) ? path : undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function describeExit(result: {
  readonly code: number | null;
  readonly error?: string;
}): string {
  if (result.error !== undefined) return result.error;
  return `the skills CLI exited ${result.code === null ? "without a status" : result.code}`;
}

/** The skill is installed globally at the shared path, copied rather than linked. */
export function skillInstallArgs(skillSourceDir: string): readonly string[] {
  return ["add", skillSourceDir, "-g", "-a", SKILL_AGENT, "--copy", "-y"];
}

/** Removal names the skill, not a source path. */
export function skillRemoveArgs(): readonly string[] {
  return ["remove", "-g", "-a", SKILL_AGENT, "-y", SKILL_NAME];
}

/** Whether `child` sits under `parent`, across Windows drive differences. */
function inside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * The interpreter a registered entry runs.
 *
 * **Never a path under the temp directory.** Some version managers run Node
 * from a per-session extraction under `os.tmpdir()`; recording that path leaves
 * the agent pointing at an interpreter the next session cannot find, and the
 * failure reads as a broken server rather than a stale entry. Such a run
 * registers the stable name `node`, which the agent resolves from `PATH`. An
 * installed interpreter keeps its absolute path, which survives a PATH that
 * does not include Node.
 */
export function nodeCommand(
  execPath: string,
  tempRoot: string = tmpdir(),
): string {
  return inside(tempRoot, execPath) ? "node" : execPath;
}

/**
 * The stable path behind a version-manager shim. fnm resolves
 * `process.execPath` through a multishell directory that exists only for the
 * shell that created it, so recording it leaves a later session with a missing
 * interpreter. A path that cannot be resolved is kept as given.
 */
export function resolveInterpreter(execPath: string): string {
  try {
    return realpathSync(execPath);
  } catch {
    return execPath;
  }
}

/**
 * The entry the server config carries: this Node, the built server, `serve`.
 *
 * A named URL travels in the arguments so a host on a custom port survives a
 * later session; without one the server keeps its probe range.
 */
export function serverEntryFor(
  serverEntry: string,
  url?: string,
  interpreter: string = resolveInterpreter(process.execPath),
  autoApprove = true,
): ServerEntry {
  return {
    command: nodeCommand(interpreter),
    args: [serverEntry, "serve", ...(url === undefined ? [] : ["--url", url])],
    ...(autoApprove ? { autoApproveTools: [] } : {}),
  };
}

/**
 * Installs both halves and reports each one. A failure on one half does not
 * abandon the other, and a partial result is never reported as success.
 */
export async function install(
  ports: InstallPorts,
  choices: InstallChoices = resolveChoices({}, process.cwd()),
): Promise<InstallReport> {
  const canonical = skillFilePath(ports.home);
  let skillPath = canonical;
  const steps: StepOutcome[] = [];

  if (choices.skill) {
    try {
      const run = await ports.runSkills(skillInstallArgs(ports.skillSourceDir));
      if (run.code !== 0) {
        steps.push({
          step: "skill",
          ok: false,
          detail: `could not install the skill: ${describeExit(run)}`,
        });
      } else {
        const found = installedSkillPath(ports);
        if (found === undefined) {
          steps.push({
            step: "skill",
            ok: false,
            detail: `the skills CLI succeeded but ${canonical} does not exist`,
          });
        } else {
          skillPath = found;
          steps.push({ step: "skill", ok: true, detail: `installed ${found}` });
        }
      }
    } catch (error) {
      steps.push({
        step: "skill",
        ok: false,
        detail: `could not install the skill: ${messageOf(error)}`,
      });
    }
  }

  // The bin shim is the entry the agent runs: it explains a missing build
  // instead of failing on an unresolved import. Registering a path that does
  // not exist would hand the agent that stack trace at the next session.
  if (!ports.fileExists(ports.serverEntry)) {
    steps.push({
      step: "server",
      ok: false,
      detail: `${ports.serverEntry} does not exist; build it with "npm run build -w @yunari/mcp"`,
    });
  } else {
    const options =
      choices.scope === "local"
        ? { local: true, cwd: choices.cwd }
        : { local: false };
    for (const agent of choices.agents) {
      try {
        const result = ports.upsert(
          agent,
          serverEntryFor(
            ports.serverEntry,
            choices.url,
            ports.interpreter,
            choices.autoApprove,
          ),
          options,
        );
        if (!result.success) {
          steps.push({
            step: "server",
            ok: false,
            detail: `could not register "${SERVER_NAME}" for ${agent}: ${result.error ?? result.path}`,
          });
          continue;
        }
        const extra =
          result.extraPaths === undefined || result.extraPaths.length === 0
            ? ""
            : ` (also wrote ${result.extraPaths.join(", ")})`;
        const dropped =
          result.droppedFields === undefined ||
          result.droppedFields.length === 0
            ? ""
            : ` (${agent} ignores ${result.droppedFields.join(", ")})`;
        steps.push({
          step: "server",
          ok: true,
          detail: `registered "${SERVER_NAME}" for ${agent} in ${result.path}${extra}${dropped}`,
        });
      } catch (error) {
        steps.push({
          step: "server",
          ok: false,
          detail: `could not register "${SERVER_NAME}" for ${agent}: ${messageOf(error)}`,
        });
      }
    }
  }

  return {
    ok: steps.every((step) => step.ok),
    steps,
    skillPath,
  };
}

/**
 * Removes the server entry, the auto-approval rule it wrote and the skill. The
 * entry's own result says whether it was present; the skill half fails if the
 * CLI fails or the file survives.
 */
export async function uninstall(
  ports: InstallPorts,
  choices: InstallChoices = resolveChoices({}, process.cwd()),
): Promise<InstallReport> {
  const canonical = skillFilePath(ports.home);
  const skillPath = installedSkillPath(ports) ?? canonical;
  const steps: StepOutcome[] = [];
  const options =
    choices.scope === "local"
      ? { local: true, cwd: choices.cwd }
      : { local: false };
  for (const agent of choices.agents) {
    try {
      const result = ports.remove(agent, options);
      if (!result.success) {
        steps.push({
          step: "server",
          ok: false,
          detail: `could not remove "${SERVER_NAME}" for ${agent}: ${result.error ?? result.path}`,
        });
      } else {
        steps.push({
          step: "server",
          ok: true,
          detail: result.removed
            ? `removed "${SERVER_NAME}" for ${agent} from ${result.path}`
            : `"${SERVER_NAME}" was not registered for ${agent} in ${result.path}`,
        });
      }
    } catch (error) {
      steps.push({
        step: "server",
        ok: false,
        detail: `could not remove "${SERVER_NAME}" for ${agent}: ${messageOf(error)}`,
      });
    }
  }

  let remaining: readonly string[] = [];
  try {
    remaining = await ports.registeredAgents(choices.scope, choices.cwd);
  } catch {
    // An unreadable registry is treated as "may still be used", below.
    remaining = choices.agents;
  }

  // The rule belongs to the Claude Code config `add-mcp` wrote it into; another
  // agent's uninstall must not strip it from a surviving install.
  if (choices.agents.includes("claude-code")) {
    try {
      const approval = ports.removeAutoApproval(options);
      if (!approval.ok) {
        steps.push({
          step: "approval",
          ok: false,
          detail: `could not remove "${AUTO_APPROVAL_RULE}" from ${approval.path}: ${approval.error ?? "unknown error"}`,
        });
      } else {
        steps.push({
          step: "approval",
          ok: true,
          detail: approval.removed
            ? `removed "${AUTO_APPROVAL_RULE}" from ${approval.path}`
            : `no "${AUTO_APPROVAL_RULE}" rule in ${approval.path}`,
        });
      }
    } catch (error) {
      steps.push({
        step: "approval",
        ok: false,
        detail: `could not remove "${AUTO_APPROVAL_RULE}": ${messageOf(error)}`,
      });
    }
  }

  if (choices.skill) {
    if (remaining.length > 0) {
      // One global copy serves every client: removing it under a surviving
      // install would break the agents the user kept.
      steps.push({
        step: "skill",
        ok: true,
        detail: `kept ${skillPath}; still used by ${remaining.join(", ")}`,
      });
    } else {
      try {
        const run = await ports.runSkills(skillRemoveArgs());
        if (run.code !== 0) {
          steps.push({
            step: "skill",
            ok: false,
            detail: `could not remove the skill: ${describeExit(run)}`,
          });
        } else {
          const leftover = installedSkillPath(ports);
          if (leftover !== undefined) {
            steps.push({
              step: "skill",
              ok: false,
              detail: `the skills CLI succeeded but ${leftover} is still present`,
            });
          } else {
            steps.push({
              step: "skill",
              ok: true,
              detail: `removed ${skillPath}`,
            });
          }
        }
      } catch (error) {
        steps.push({
          step: "skill",
          ok: false,
          detail: `could not remove the skill: ${messageOf(error)}`,
        });
      }
    }
  }

  return {
    ok: steps.every((step) => step.ok),
    steps,
    skillPath,
  };
}

/** Reads the three states the user needs; every port here is read-only. */
export async function status(
  ports: InstallPorts,
  choices: InstallChoices = resolveChoices({}, process.cwd()),
): Promise<StatusReport> {
  const names = choices.agents.join(", ");
  let host: HostProbe;
  try {
    host = await ports.probeHost();
  } catch (error) {
    host = { reachable: false, error: messageOf(error) };
  }

  let server: StatusReport["server"];
  try {
    const present = await ports.isServerInstalled(
      choices.agents,
      choices.scope,
      choices.cwd,
    );
    if (!present) {
      server = {
        present: false,
        detail: `"${SERVER_NAME}" is not registered for ${names} (${choices.scope})`,
      };
    } else {
      const entry = await ports.installedServer(
        choices.agents,
        choices.scope,
        choices.cwd,
      );
      const missing = [entry?.command, entry?.args[0]].filter(
        (path): path is string => path !== undefined && !ports.fileExists(path),
      );
      server =
        missing.length === 0
          ? {
              present: true,
              detail: `"${SERVER_NAME}" is registered for ${names} (${choices.scope})`,
            }
          : {
              present: false,
              detail: `"${SERVER_NAME}" is registered, but ${missing.join(" and ")} is missing; re-run install`,
            };
    }
  } catch (error) {
    server = {
      present: false,
      detail: `the agent config could not be read: ${messageOf(error)}`,
    };
  }

  const found = installedSkillPath(ports);
  return {
    host,
    server,
    skill: {
      present: found !== undefined,
      path: found ?? skillFilePath(ports.home),
      state: compareSkill(
        found === undefined ? undefined : dirname(found),
        ports.bundledSkillDir,
      ),
    },
  };
}

/** The `skills` package's CLI, resolved beside the installed dependencies. */
function skillsCliPath(): string {
  const require = createRequire(import.meta.url);
  return join(
    dirname(require.resolve("skills/package.json")),
    "bin",
    "cli.mjs",
  );
}

/** Runs the CLI with telemetry off and its output on this process's streams. */
function runSkillsCli(
  args: readonly string[],
): Promise<{ readonly code: number | null; readonly error?: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [skillsCliPath(), ...args], {
      env: { ...process.env, DISABLE_TELEMETRY: "1" },
      stdio: "inherit",
    });
    child.once("error", (error) =>
      resolve({ code: null, error: error.message }),
    );
    child.once("close", (code) => resolve({ code }));
  });
}

/** Reads the agent config through add-mcp's own reader, never a hand-rolled one. */
async function serverIsInstalled(
  agents: readonly string[],
  scope: "global" | "local",
  cwd: string,
): Promise<boolean> {
  const listings = await listInstalledServers({
    global: scope === "global",
    agents: agents as never,
    cwd,
  });
  return listings.some((listing) =>
    listing.servers.some((server) => server.serverName === SERVER_NAME),
  );
}

/** Every agent whose config still holds the server. */
async function registeredAgents(
  scope: "global" | "local",
  cwd: string,
): Promise<readonly string[]> {
  const listings = await listInstalledServers({
    global: scope === "global",
    cwd,
  });
  return listings
    .filter((listing) =>
      listing.servers.some((server) => server.serverName === SERVER_NAME),
    )
    .map((listing) => listing.agentType);
}

/** The registered entry's `command` and `args`, as add-mcp read them back. */
async function installedServerEntry(
  agents: readonly string[],
  scope: "global" | "local",
  cwd: string,
): Promise<
  { readonly command?: string; readonly args: readonly string[] } | undefined
> {
  const listings = await listInstalledServers({
    global: scope === "global",
    agents: agents as never,
    cwd,
  });
  for (const listing of listings) {
    for (const server of listing.servers) {
      if (server.serverName !== SERVER_NAME) continue;
      const config = server.config as { command?: unknown; args?: unknown };
      return {
        ...(typeof config.command === "string"
          ? { command: config.command }
          : {}),
        args: Array.isArray(config.args)
          ? config.args.filter((arg): arg is string => typeof arg === "string")
          : [],
      };
    }
  }
  return undefined;
}

export interface CreateIntegrationPortsOptions {
  readonly home?: string;
  readonly skillSourceDir?: string;
  /** The copy `status` compares against; defaults to the package's own skill. */
  readonly bundledSkillDir?: string;
  readonly serverEntry?: string;
  /** Defaults to `resolveInterpreter(process.execPath)`. */
  readonly interpreter?: string;
  /** `status` has to know whether a host answers; the CLI supplies this. */
  readonly probeHost: () => Promise<HostProbe>;
}

/** Production ports: the real home, the real CLI and the real agent config. */
export function createPorts(
  options: CreateIntegrationPortsOptions,
): InstallPorts {
  const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
  const home = options.home ?? homedir();
  return {
    home,
    skillSourceDir: options.skillSourceDir ?? resolveSkillSourceDir(packageDir),
    bundledSkillDir:
      options.bundledSkillDir ?? resolveSkillSourceDir(packageDir),
    serverEntry:
      options.serverEntry ?? join(packageDir, "bin", "yunari-mcp.js"),
    interpreter: options.interpreter ?? resolveInterpreter(process.execPath),
    runSkills: runSkillsCli,
    upsert: (agent, config, upsertOptions) =>
      upsertServer(agent as never, SERVER_NAME, config, upsertOptions),
    remove: (agent, removeOptions) =>
      removeServer(agent as never, SERVER_NAME, removeOptions),
    removeAutoApproval: (options) => removeAutoApprovalRule(home, options),
    isServerInstalled: serverIsInstalled,
    installedServer: installedServerEntry,
    registeredAgents,
    fileExists: existsSync,
    probeHost: options.probeHost,
  };
}
