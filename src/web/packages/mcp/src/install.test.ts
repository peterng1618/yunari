import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InstallResult, RemoveServerResult } from "add-mcp";
import { afterEach, describe, expect, it } from "vitest";
import {
  AGENT_TYPE,
  createPorts,
  type InstallPorts,
  install,
  serverEntryFor,
  skillFilePath,
  skillFilePaths,
  skillInstallArgs,
  skillRemoveArgs,
  status,
  uninstall,
} from "./install.js";

const homes: string[] = [];

function temporaryHome(): string {
  const home = mkdtempSync(join(tmpdir(), "yunari-mcp-install-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

interface Calls {
  skills: string[][];
  upserts: { config: unknown; options: unknown }[];
  removes: unknown[];
  probes: number;
  checks: number;
}

interface Behaviour {
  readonly skillsCode?: number;
  readonly skillsError?: string;
  readonly skillLocation?: "canonical" | "agent" | "none";
  readonly installedAlready?: boolean;
  readonly keepsSkillAfterRemove?: boolean;
  readonly upsertFails?: boolean;
  readonly removeFails?: boolean;
  readonly serverInstalled?: boolean;
}

/**
 * A port set whose writes only record themselves. The skills CLI fake creates
 * the file at the location the probe observed: `~/.claude/skills` for the
 * single-agent copy install, while the canonical `.agents/skills` path stays
 * accepted too.
 */
function fakePorts(
  home: string,
  behaviour: Behaviour = {},
): {
  ports: InstallPorts;
  calls: Calls;
  skillPath: string;
  canonicalPath: string;
} {
  const calls: Calls = {
    skills: [],
    upserts: [],
    removes: [],
    probes: 0,
    checks: 0,
  };
  const [canonicalPath = "", agentPath = ""] = skillFilePaths(home);
  const chosen =
    behaviour.skillLocation === "agent" ? agentPath : canonicalPath;
  let skillPresent = behaviour.installedAlready ?? false;

  const ports: InstallPorts = {
    home,
    skillSourceDir: join(home, "repo-skills", "yunari-theme-designer"),
    serverEntry: join(home, "packages", "mcp", "dist", "main.js"),
    runSkills: async (args) => {
      calls.skills.push([...args]);
      if (args[0] === "add" && behaviour.skillLocation !== "none") {
        skillPresent = true;
      }
      if (args[0] === "remove" && behaviour.keepsSkillAfterRemove !== true) {
        skillPresent = false;
      }
      return {
        code: behaviour.skillsCode ?? 0,
        ...(behaviour.skillsError === undefined
          ? {}
          : { error: behaviour.skillsError }),
      };
    },
    upsert: (config: unknown): InstallResult => {
      calls.upserts.push({ config, options: { local: false } });
      return behaviour.upsertFails === true
        ? { success: false, path: "/agent/config.json", error: "refused" }
        : {
            success: true,
            path: "/agent/config.json",
            extraPaths: ["/agent/settings.json"],
          };
    },
    remove: (): RemoveServerResult => {
      calls.removes.push({ local: false });
      return behaviour.removeFails === true
        ? {
            success: false,
            path: "/agent/config.json",
            removed: false,
            error: "refused",
          }
        : { success: true, path: "/agent/config.json", removed: true };
    },
    isServerInstalled: async () => {
      calls.checks += 1;
      return behaviour.serverInstalled ?? true;
    },
    fileExists: (path) => skillPresent && path === chosen,
    probeHost: async () => {
      calls.probes += 1;
      return { reachable: true, url: "http://127.0.0.1:5227" };
    },
  };

  return { ports, calls, skillPath: chosen, canonicalPath };
}

describe("install", () => {
  it("writes exactly one server entry and one skill path", async () => {
    const home = temporaryHome();
    const { ports, calls, skillPath } = fakePorts(home);

    const report = await install(ports);

    expect(report.ok).toBe(true);
    expect(report.skillPath).toBe(skillPath);
    expect(calls.skills).toEqual([
      skillInstallArgs(join(home, "repo-skills", "yunari-theme-designer")),
    ]);
    expect(calls.skills[0]).toEqual([
      "add",
      join(home, "repo-skills", "yunari-theme-designer"),
      "-g",
      "-a",
      AGENT_TYPE,
      "--copy",
      "-y",
    ]);
    expect(calls.upserts).toHaveLength(1);
    const entry = calls.upserts[0]?.config;
    expect(entry).toEqual({
      command: process.execPath,
      args: [join(home, "packages", "mcp", "dist", "main.js"), "serve"],
      autoApproveTools: [],
    });
    expect(calls.upserts[0]?.options).toEqual({ local: false });
    expect(calls.removes).toHaveLength(0);
    expect(report.steps.map((step) => step.step)).toEqual(["skill", "server"]);
  });

  it("accepts the agent skills directory the CLI actually writes", async () => {
    const home = temporaryHome();
    const { ports } = fakePorts(home, { skillLocation: "agent" });

    const report = await install(ports);

    expect(report.ok).toBe(true);
    expect(report.skillPath).toBe(
      join(home, ".claude", "skills", "yunari-theme-designer", "SKILL.md"),
    );
  });

  it("reports a failing skills CLI without claiming success", async () => {
    const home = temporaryHome();
    const { ports, calls } = fakePorts(home, { skillsCode: 1 });

    const report = await install(ports);

    expect(report.ok).toBe(false);
    const skill = report.steps.find((step) => step.step === "skill");
    expect(skill?.ok).toBe(false);
    expect(skill?.detail).toContain("exited 1");
    // The server half is still attempted and reported on its own.
    expect(calls.upserts).toHaveLength(1);
    expect(report.steps.find((step) => step.step === "server")?.ok).toBe(true);
  });

  it("fails when the CLI exits 0 but no skill file exists", async () => {
    const home = temporaryHome();
    const { ports } = fakePorts(home, { skillLocation: "none" });

    const report = await install(ports);

    expect(report.ok).toBe(false);
    expect(report.steps[0]?.detail).toContain("neither");
  });

  it("keeps a server refusal visible instead of claiming success", async () => {
    const home = temporaryHome();
    const { ports } = fakePorts(home, { upsertFails: true });

    const report = await install(ports);

    expect(report.ok).toBe(false);
    const server = report.steps.find((step) => step.step === "server");
    expect(server?.ok).toBe(false);
    expect(server?.detail).toContain("refused");
  });
});

describe("uninstall", () => {
  it("removes only the server entry and the skill", async () => {
    const home = temporaryHome();
    const { ports, calls, skillPath } = fakePorts(home, {
      installedAlready: true,
    });

    const report = await uninstall(ports);

    expect(report.ok).toBe(true);
    expect(calls.removes).toHaveLength(1);
    expect(calls.skills).toEqual([[...skillRemoveArgs()]]);
    expect([...skillRemoveArgs()]).toEqual([
      "remove",
      "-g",
      "-a",
      AGENT_TYPE,
      "-y",
      "yunari-theme-designer",
    ]);
    expect(calls.upserts).toHaveLength(0);
    expect(report.skillPath).toBe(skillPath);
  });

  it("reports a failed removal without claiming success", async () => {
    const home = temporaryHome();
    const { ports } = fakePorts(home, { removeFails: true, skillsCode: 1 });

    const report = await uninstall(ports);

    expect(report.ok).toBe(false);
    expect(report.steps.every((step) => !step.ok)).toBe(true);
    expect(report.steps[0]?.detail).toContain("refused");
    expect(report.steps[1]?.detail).toContain("exited 1");
  });

  it("reports a skill file the CLI failed to delete", async () => {
    const home = temporaryHome();
    const { ports } = fakePorts(home, {
      installedAlready: true,
      keepsSkillAfterRemove: true,
    });

    const report = await uninstall(ports);

    expect(report.ok).toBe(false);
    expect(report.steps[1]?.detail).toContain("still present");
  });
});

describe("status", () => {
  it("is read-only and reports all three states", async () => {
    const home = temporaryHome();
    const { ports, calls, skillPath } = fakePorts(home, {
      serverInstalled: true,
    });
    let wrote = false;
    const readonlyPorts: InstallPorts = {
      ...ports,
      upsert: () => {
        wrote = true;
        throw new Error("status must not write");
      },
      remove: () => {
        wrote = true;
        throw new Error("status must not write");
      },
      runSkills: async () => {
        wrote = true;
        throw new Error("status must not write");
      },
    };

    const report = await status(readonlyPorts);

    expect(wrote).toBe(false);
    expect(calls.probes).toBe(1);
    expect(calls.checks).toBe(1);
    expect(report.host.reachable).toBe(true);
    expect(report.server.present).toBe(true);
    expect(report.skill).toEqual({ present: false, path: skillPath });
  });

  it("reports the skill present at whichever path the CLI used", async () => {
    const home = temporaryHome();
    const { ports } = fakePorts(home, {
      installedAlready: true,
      skillLocation: "agent",
    });
    const agentPath = join(
      home,
      ".claude",
      "skills",
      "yunari-theme-designer",
      "SKILL.md",
    );

    await expect(status(ports)).resolves.toMatchObject({
      skill: { present: true, path: agentPath },
    });
  });
});

describe("createPorts", () => {
  it("points the entry at this Node and the built server", () => {
    const entry = serverEntryFor("C:/repo/packages/mcp/dist/main.js");
    expect(entry.command).toBe(process.execPath);
    expect(entry.args).toEqual(["C:/repo/packages/mcp/dist/main.js", "serve"]);
    expect(entry.autoApproveTools).toEqual([]);
  });

  it("honours an injected home without resolving the real one", () => {
    const home = temporaryHome();
    const ports = createPorts({
      home,
      probeHost: async () => ({ reachable: false }),
    });
    expect(ports.home).toBe(home);
    expect(skillFilePath(ports.home)).toBe(
      join(home, ".agents", "skills", "yunari-theme-designer", "SKILL.md"),
    );
  });
});
