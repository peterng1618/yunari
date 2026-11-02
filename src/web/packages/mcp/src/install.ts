import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type InstallResult,
  listInstalledServers,
  type RemoveServerResult,
  removeServer,
  upsertServer,
} from "add-mcp";

/** The agent this installer targets. */
export const AGENT_TYPE = "claude-code";

/** The server entry name the agent shows and the skill refers to. */
export const SERVER_NAME = "yunari";

/** The skill folder name, which is also its installed directory name. */
export const SKILL_NAME = "yunari-theme-designer";

/** The stdio entry a registered server runs. */
export interface ServerEntry {
  readonly command: string;
  readonly args: string[];
  /** An empty list means "every tool", which is the user's chosen default. */
  readonly autoApproveTools: string[];
}

/** The port shape every test injects; production defaults live in `createPorts`. */
export interface InstallPorts {
  /** The home directory the agent config and the skill directory live under. */
  readonly home: string;
  /** The skill folder in this repository. */
  readonly skillSourceDir: string;
  /** The built stdio entry the agent config points at. */
  readonly serverEntry: string;
  /** Runs the `skills` CLI and resolves its exit code. */
  readonly runSkills: (
    args: readonly string[],
  ) => Promise<{ readonly code: number | null; readonly error?: string }>;
  readonly upsert: (config: ServerEntry) => InstallResult;
  readonly remove: () => RemoveServerResult;
  readonly isServerInstalled: () => Promise<boolean>;
  readonly fileExists: (path: string) => boolean;
  readonly probeHost: () => Promise<HostProbe>;
}

/** What `status` reports about the host: reachable, or the reason it is not. */
export interface HostProbe {
  readonly reachable: boolean;
  readonly url?: string;
  readonly error?: string;
}

/** One half of an install or uninstall, reported on its own. */
export interface StepOutcome {
  readonly step: "server" | "skill";
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
  readonly skill: { readonly present: boolean; readonly path: string };
}

/** The installed `SKILL.md` path the CLI may write: the canonical copy first. */
export function skillFilePaths(home: string): readonly string[] {
  return [
    skillFilePath(home),
    join(home, ".claude", "skills", SKILL_NAME, "SKILL.md"),
  ];
}

/** The canonical installed path named in the design. */
export function skillFilePath(home: string): string {
  return join(home, ".agents", "skills", SKILL_NAME, "SKILL.md");
}

/** Where the CLI actually put the skill, if anywhere. */
function installedSkillPath(
  ports: Pick<InstallPorts, "home" | "fileExists">,
): string | undefined {
  return skillFilePaths(ports.home).find((path) => ports.fileExists(path));
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

/** The skill is installed globally for Claude Code, copied rather than linked. */
export function skillInstallArgs(skillSourceDir: string): readonly string[] {
  return ["add", skillSourceDir, "-g", "-a", AGENT_TYPE, "--copy", "-y"];
}

/** Removal names the skill, not a source path. */
export function skillRemoveArgs(): readonly string[] {
  return ["remove", "-g", "-a", AGENT_TYPE, "-y", SKILL_NAME];
}

/** The entry the server config carries: this Node, the built server, `serve`. */
export function serverEntryFor(serverEntry: string): ServerEntry {
  return {
    command: process.execPath,
    args: [serverEntry, "serve"],
    autoApproveTools: [],
  };
}

/**
 * Installs both halves and reports each one. A failure on one half does not
 * abandon the other, and a partial result is never reported as success.
 */
export async function install(ports: InstallPorts): Promise<InstallReport> {
  const paths = skillFilePaths(ports.home);
  let skillPath = skillFilePath(ports.home);
  const steps: StepOutcome[] = [];

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
          detail: `the skills CLI succeeded but neither ${paths.join(" nor ")} exists`,
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

  try {
    const result = ports.upsert(serverEntryFor(ports.serverEntry));
    if (!result.success) {
      steps.push({
        step: "server",
        ok: false,
        detail: `could not register "${SERVER_NAME}": ${result.error ?? result.path}`,
      });
    } else {
      const extra =
        result.extraPaths === undefined || result.extraPaths.length === 0
          ? ""
          : ` (also wrote ${result.extraPaths.join(", ")})`;
      steps.push({
        step: "server",
        ok: true,
        detail: `registered "${SERVER_NAME}" in ${result.path}${extra}`,
      });
    }
  } catch (error) {
    steps.push({
      step: "server",
      ok: false,
      detail: `could not register "${SERVER_NAME}": ${messageOf(error)}`,
    });
  }

  return {
    ok: steps.every((step) => step.ok),
    steps,
    skillPath,
  };
}

/**
 * Removes exactly the server entry and the skill. The entry's own result says
 * whether it was present; the skill half fails if the CLI fails or the file
 * survives.
 */
export async function uninstall(ports: InstallPorts): Promise<InstallReport> {
  const skillPath = installedSkillPath(ports) ?? skillFilePath(ports.home);
  const steps: StepOutcome[] = [];
  try {
    const result = ports.remove();
    if (!result.success) {
      steps.push({
        step: "server",
        ok: false,
        detail: `could not remove "${SERVER_NAME}": ${result.error ?? result.path}`,
      });
    } else {
      steps.push({
        step: "server",
        ok: true,
        detail: result.removed
          ? `removed "${SERVER_NAME}" from ${result.path}`
          : `"${SERVER_NAME}" was not registered in ${result.path}`,
      });
    }
  } catch (error) {
    steps.push({
      step: "server",
      ok: false,
      detail: `could not remove "${SERVER_NAME}": ${messageOf(error)}`,
    });
  }

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
        steps.push({ step: "skill", ok: true, detail: `removed ${skillPath}` });
      }
    }
  } catch (error) {
    steps.push({
      step: "skill",
      ok: false,
      detail: `could not remove the skill: ${messageOf(error)}`,
    });
  }

  return {
    ok: steps.every((step) => step.ok),
    steps,
    skillPath,
  };
}

/** Reads the three states the user needs; every port here is read-only. */
export async function status(ports: InstallPorts): Promise<StatusReport> {
  let host: HostProbe;
  try {
    host = await ports.probeHost();
  } catch (error) {
    host = { reachable: false, error: messageOf(error) };
  }

  let server: StatusReport["server"];
  try {
    const present = await ports.isServerInstalled();
    server = {
      present,
      detail: present
        ? `"${SERVER_NAME}" is registered for ${AGENT_TYPE}`
        : `"${SERVER_NAME}" is not registered for ${AGENT_TYPE}`,
    };
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
async function serverIsInstalled(): Promise<boolean> {
  const listings = await listInstalledServers({
    global: true,
    agents: [AGENT_TYPE],
  });
  return listings.some((listing) =>
    listing.servers.some((server) => server.serverName === SERVER_NAME),
  );
}

export interface CreateIntegrationPortsOptions {
  readonly home?: string;
  readonly skillSourceDir?: string;
  readonly serverEntry?: string;
  /** `status` has to know whether a host answers; the CLI supplies this. */
  readonly probeHost: () => Promise<HostProbe>;
}

/** Production ports: the real home, the real CLI and the real agent config. */
export function createPorts(
  options: CreateIntegrationPortsOptions,
): InstallPorts {
  const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
  return {
    home: options.home ?? homedir(),
    skillSourceDir:
      options.skillSourceDir ??
      join(packageDir, "..", "..", "..", "..", "skills", SKILL_NAME),
    serverEntry: options.serverEntry ?? join(packageDir, "dist", "main.js"),
    runSkills: runSkillsCli,
    upsert: (config) =>
      upsertServer(AGENT_TYPE, SERVER_NAME, config, { local: false }),
    remove: () => removeServer(AGENT_TYPE, SERVER_NAME, { local: false }),
    isServerInstalled: serverIsInstalled,
    fileExists: existsSync,
    probeHost: options.probeHost,
  };
}
