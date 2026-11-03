import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { InstallResult, RemoveServerResult } from "add-mcp";
import { afterEach, describe, expect, it } from "vitest";
import type { InstallChoices } from "./choices.js";
import { resolveChoices } from "./choices.js";
import {
  AGENT_TYPE,
  AUTO_APPROVAL_RULE,
  claudeSettingsPath,
  compareSkill,
  createPorts,
  type InstallPorts,
  install,
  removeAutoApprovalRule,
  resolveInterpreter,
  resolveSkillSourceDir,
  SKILL_AGENT,
  SKILL_NAME,
  serverEntryFor,
  skillFilePath,
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
  upserts: { agent: string; config: unknown; options: unknown }[];
  removes: { agent: string; options: unknown }[];
  approvals: number;
  probes: number;
  checks: number;
}

interface Behaviour {
  readonly skillsCode?: number;
  readonly skillsError?: string;
  readonly skillLocation?: "canonical" | "claude" | "none";
  readonly installedAlready?: boolean;
  readonly keepsSkillAfterRemove?: boolean;
  readonly upsertFails?: boolean;
  readonly upsertFailsFor?: string;
  readonly removeFails?: boolean;
  readonly approvalFails?: boolean;
  readonly serverInstalled?: boolean;
  readonly serverEntryMissing?: boolean;
  readonly serverEntryRecorded?: {
    readonly command?: string;
    readonly args: readonly string[];
  };
}

/**
 * A port set whose writes only record themselves. The skills CLI fake creates
 * the file where the named location says: the canonical `.agents/skills` path,
 * or the `.claude/skills` copy a `claude-code` install writes.
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
    approvals: 0,
    probes: 0,
    checks: 0,
  };
  const canonicalPath = skillFilePath(home);
  const claudePath = join(home, ".claude", "skills", SKILL_NAME, "SKILL.md");
  const locationPath =
    behaviour.skillLocation === "claude" ? claudePath : canonicalPath;
  let presentAt: string | undefined =
    behaviour.installedAlready === true ? locationPath : undefined;
  const serverEntry = join(home, "packages", "mcp", "bin", "yunari-mcp.js");

  const ports: InstallPorts = {
    home,
    skillSourceDir: join(home, "repo-skills", "yunari-theme-designer"),
    serverEntry,
    interpreter: process.execPath,
    bundledSkillDir: join(home, "bundled-skills", SKILL_NAME),
    runSkills: async (args) => {
      calls.skills.push([...args]);
      if (args[0] === "add" && behaviour.skillLocation !== "none") {
        presentAt = locationPath;
      }
      if (args[0] === "remove" && behaviour.keepsSkillAfterRemove !== true) {
        presentAt = undefined;
      }
      return {
        code: behaviour.skillsCode ?? 0,
        ...(behaviour.skillsError === undefined
          ? {}
          : { error: behaviour.skillsError }),
      };
    },
    upsert: (agent: string, config: unknown, options): InstallResult => {
      calls.upserts.push({ agent, config, options });
      return behaviour.upsertFails === true ||
        behaviour.upsertFailsFor === agent
        ? { success: false, path: "/agent/config.json", error: "refused" }
        : {
            success: true,
            path: "/agent/config.json",
            extraPaths: ["/agent/settings.json"],
          };
    },
    remove: (agent: string, options): RemoveServerResult => {
      calls.removes.push({ agent, options });
      return behaviour.removeFails === true
        ? {
            success: false,
            path: "/agent/config.json",
            removed: false,
            error: "refused",
          }
        : { success: true, path: "/agent/config.json", removed: true };
    },
    removeAutoApproval: () => {
      calls.approvals += 1;
      return behaviour.approvalFails === true
        ? {
            ok: false,
            removed: false,
            path: "/agent/settings.json",
            error: "refused",
          }
        : {
            ok: true,
            removed: true,
            path: "/agent/settings.json",
          };
    },
    isServerInstalled: async () => {
      calls.checks += 1;
      return behaviour.serverInstalled ?? true;
    },
    installedServer: async () =>
      behaviour.serverEntryRecorded ??
      (behaviour.serverInstalled === false
        ? undefined
        : { command: process.execPath, args: [serverEntry, "serve"] }),
    fileExists: (path) => {
      if (path === process.execPath) return true;
      if (path === serverEntry) return behaviour.serverEntryMissing !== true;
      return presentAt !== undefined && path === presentAt;
    },
    probeHost: async () => {
      calls.probes += 1;
      return { reachable: true, url: "http://127.0.0.1:5227" };
    },
  };

  return { ports, calls, skillPath: canonicalPath, canonicalPath };
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
      SKILL_AGENT,
      "--copy",
      "-y",
    ]);
    expect(calls.upserts).toHaveLength(1);
    const entry = calls.upserts[0]?.config;
    expect(entry).toEqual({
      command: process.execPath,
      args: [join(home, "packages", "mcp", "bin", "yunari-mcp.js"), "serve"],
      autoApproveTools: [],
    });
    expect(calls.upserts[0]?.options).toEqual({ local: false });
    expect(calls.removes).toHaveLength(0);
    expect(report.steps.map((step) => step.step)).toEqual(["skill", "server"]);
  });

  it("fails when the CLI exits 0 but only wrote the .claude copy", async () => {
    const home = temporaryHome();
    const { ports } = fakePorts(home, { skillLocation: "claude" });

    const report = await install(ports);

    expect(report.ok).toBe(false);
    const skill = report.steps.find((step) => step.step === "skill");
    expect(skill?.ok).toBe(false);
    expect(skill?.detail).toContain(skillFilePath(home));
    expect(skill?.detail).toContain("does not exist");
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
    expect(report.steps[0]?.detail).toContain(skillFilePath(home));
  });

  it("puts a named URL into the registered server's arguments", async () => {
    const home = temporaryHome();
    const { ports, calls } = fakePorts(home);

    const report = await install(
      ports,
      resolveChoices({ url: "http://127.0.0.1:6000" }, "/work"),
    );

    expect(report.ok).toBe(true);
    expect((calls.upserts[0]?.config as { args: string[] }).args).toEqual([
      ports.serverEntry,
      "serve",
      "--url",
      "http://127.0.0.1:6000",
    ]);
  });

  it("fails the server step when the registered entry does not exist", async () => {
    const home = temporaryHome();
    const { ports, calls } = fakePorts(home, { serverEntryMissing: true });

    const report = await install(ports);

    expect(report.ok).toBe(false);
    const server = report.steps.find((step) => step.step === "server");
    expect(server?.ok).toBe(false);
    expect(server?.detail).toContain(ports.serverEntry);
    expect(calls.upserts).toHaveLength(0);
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
  it("removes the server entry, its approval rule and the skill", async () => {
    const home = temporaryHome();
    const { ports, calls, skillPath } = fakePorts(home, {
      installedAlready: true,
    });

    const report = await uninstall(ports);

    expect(report.ok).toBe(true);
    expect(calls.removes).toEqual([
      { agent: AGENT_TYPE, options: { local: false } },
    ]);
    expect(calls.approvals).toBe(1);
    expect(calls.skills).toEqual([[...skillRemoveArgs()]]);
    expect([...skillRemoveArgs()]).toEqual([
      "remove",
      "-g",
      "-a",
      SKILL_AGENT,
      "-y",
      "yunari-theme-designer",
    ]);
    expect(calls.upserts).toHaveLength(0);
    expect(report.skillPath).toBe(skillPath);
    expect(report.steps.map((step) => step.step)).toEqual([
      "server",
      "approval",
      "skill",
    ]);
  });

  it("reports a failed removal without claiming success", async () => {
    const home = temporaryHome();
    const { ports } = fakePorts(home, { removeFails: true, skillsCode: 1 });

    const report = await uninstall(ports);

    expect(report.ok).toBe(false);
    expect(report.steps[0]?.detail).toContain("refused");
    expect(report.steps[2]?.detail).toContain("exited 1");
  });

  it("reports an approval rule it could not remove", async () => {
    const home = temporaryHome();
    const { ports } = fakePorts(home, {
      installedAlready: true,
      approvalFails: true,
    });

    const report = await uninstall(ports);

    expect(report.ok).toBe(false);
    const approval = report.steps.find((step) => step.step === "approval");
    expect(approval?.ok).toBe(false);
    expect(approval?.detail).toContain(AUTO_APPROVAL_RULE);
    expect(approval?.detail).toContain("refused");
  });

  it("reports a skill file the CLI failed to delete", async () => {
    const home = temporaryHome();
    const { ports } = fakePorts(home, {
      installedAlready: true,
      keepsSkillAfterRemove: true,
    });

    const report = await uninstall(ports);

    expect(report.ok).toBe(false);
    const skill = report.steps.find((step) => step.step === "skill");
    expect(skill?.detail).toContain("still present");
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
      removeAutoApproval: () => {
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
    expect(report.skill).toEqual({
      present: false,
      path: skillPath,
      state: "not-installed",
    });
  });

  it("reports the skill present at the canonical path", async () => {
    const home = temporaryHome();
    const { ports } = fakePorts(home, { installedAlready: true });

    await expect(status(ports)).resolves.toMatchObject({
      skill: { present: true, path: skillFilePath(home) },
    });
  });

  it("reports an entry whose interpreter vanished as absent with a repair", async () => {
    const home = temporaryHome();
    const { ports } = fakePorts(home, {
      serverEntryRecorded: {
        command: join(home, "gone", "node.exe"),
        args: [join(home, "pkg", "bin", "yunari-mcp.js"), "serve"],
      },
    });

    const report = await status(ports);

    expect(report.server.present).toBe(false);
    expect(report.server.detail).toContain("re-run install");
  });
});

describe("createPorts", () => {
  it("points the entry at this Node and the bin shim", () => {
    const entry = serverEntryFor("C:/repo/packages/mcp/bin/yunari-mcp.js");
    expect(entry.command).toBe(resolveInterpreter(process.execPath));
    expect(entry.args).toEqual([
      "C:/repo/packages/mcp/bin/yunari-mcp.js",
      "serve",
    ]);
    expect(entry.autoApproveTools).toEqual([]);
  });

  it("records the real interpreter, not a per-session shim", () => {
    const dir = mkdtempSync(join(tmpdir(), "yunari-interp-"));
    homes.push(dir);
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
    expect(
      serverEntryFor(
        "C:/pkg/bin/yunari-mcp.js",
        "http://127.0.0.1:5227",
        "C:/node.exe",
      ),
    ).toEqual({
      command: "C:/node.exe",
      args: [
        "C:/pkg/bin/yunari-mcp.js",
        "serve",
        "--url",
        "http://127.0.0.1:5227",
      ],
      autoApproveTools: [],
    });
  });

  it("honours an injected home without resolving the real one", () => {
    const home = temporaryHome();
    const ports = createPorts({
      home,
      probeHost: async () => ({ reachable: false }),
    });
    expect(ports.home).toBe(home);
    expect(ports.serverEntry.endsWith(join("bin", "yunari-mcp.js"))).toBe(true);
    expect(skillFilePath(ports.home)).toBe(
      join(home, ".agents", "skills", "yunari-theme-designer", "SKILL.md"),
    );
    expect(AGENT_TYPE).toBe("claude-code");
  });
});

describe("skill source and drift", () => {
  it("prefers the package-local skill and falls back to the checkout", () => {
    const packageDir = join(tmpdir(), "yunari-pkg");
    const bundled = join(packageDir, "skills", SKILL_NAME);
    expect(resolveSkillSourceDir(packageDir, (path) => path === bundled)).toBe(
      bundled,
    );
    expect(resolveSkillSourceDir(packageDir, () => false)).toBe(
      join(packageDir, "..", "..", "..", "..", "skills", SKILL_NAME),
    );
  });

  it("reports a drifted skill when a reference differs", () => {
    const bundled = mkdtempSync(join(tmpdir(), "yunari-skill-bundled-"));
    const installed = mkdtempSync(join(tmpdir(), "yunari-skill-installed-"));
    homes.push(bundled, installed);
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
});

describe("removeAutoApprovalRule", () => {
  it("removes exactly the yunari rule and keeps every other permission", () => {
    const home = temporaryHome();
    const path = claudeSettingsPath(home);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        model: "opus",
        permissions: {
          allow: [AUTO_APPROVAL_RULE, "mcp__other", "Bash(npm test)"],
          deny: ["Read(.env)"],
        },
      }),
      "utf8",
    );

    expect(removeAutoApprovalRule(home)).toEqual({
      ok: true,
      removed: true,
      path,
    });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      model: "opus",
      permissions: {
        allow: ["mcp__other", "Bash(npm test)"],
        deny: ["Read(.env)"],
      },
    });
  });

  it("leaves the file untouched when the rule is absent", () => {
    const home = temporaryHome();
    const path = claudeSettingsPath(home);
    mkdirSync(dirname(path), { recursive: true });
    const original = '{\n    "permissions": { "allow": ["mcp__other"] }\n}\n';
    writeFileSync(path, original, "utf8");

    expect(removeAutoApprovalRule(home)).toEqual({
      ok: true,
      removed: false,
      path,
    });
    expect(readFileSync(path, "utf8")).toBe(original);
  });

  it("reports a missing settings file without creating one", () => {
    const home = temporaryHome();
    const path = claudeSettingsPath(home);

    expect(removeAutoApprovalRule(home)).toEqual({
      ok: true,
      removed: false,
      path,
    });
    expect(() => readFileSync(path, "utf8")).toThrow();
  });
});

describe("install choices", () => {
  const choices = (
    overrides: Partial<InstallChoices> = {},
  ): InstallChoices => ({
    agents: ["claude-code"],
    scope: "global",
    skill: false,
    autoApprove: true,
    cwd: "/work",
    ...overrides,
  });

  it("registers the server for each selected agent exactly once", async () => {
    const home = temporaryHome();
    const { ports, calls } = fakePorts(home);

    const report = await install(
      ports,
      choices({ agents: ["claude-code", "cursor"] }),
    );

    expect(report.ok).toBe(true);
    expect(calls.upserts.map((call) => call.agent)).toEqual([
      "claude-code",
      "cursor",
    ]);
    expect(
      (calls.upserts[0]?.config as { autoApproveTools?: string[] })
        .autoApproveTools,
    ).toEqual([]);
  });

  it("reports failure and keeps the other agent's step when one agent fails", async () => {
    const home = temporaryHome();
    const { ports } = fakePorts(home, { upsertFailsFor: "cursor" });

    const report = await install(
      ports,
      choices({ agents: ["claude-code", "cursor"] }),
    );

    expect(report.ok).toBe(false);
    expect(
      report.steps.filter((step) => step.step === "server" && step.ok),
    ).toHaveLength(1);
  });

  it("keeps auto-approval out of the entry when the user declines it", async () => {
    const home = temporaryHome();
    const { ports, calls } = fakePorts(home);

    await install(ports, choices({ autoApprove: false }));

    expect(calls.upserts[0]?.config).not.toHaveProperty("autoApproveTools");
  });

  it("removes exactly the agents and halves it installed", async () => {
    const home = temporaryHome();
    const { ports, calls } = fakePorts(home);

    await install(ports, choices({ agents: ["claude-code", "cursor"] }));
    calls.removes.length = 0;
    calls.skills.length = 0;
    await uninstall(ports, choices({ agents: ["claude-code", "cursor"] }));

    expect(calls.removes.map((call) => call.agent)).toEqual([
      "claude-code",
      "cursor",
    ]);
    expect(calls.skills).toHaveLength(0);
  });
});
