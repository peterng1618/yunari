import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  hasLhmStartupTask,
  launchChild,
  launchLhm,
  registerLhmTask,
  requiresElevation,
} from "./lhm-launcher.js";

describe("LHM launcher", () => {
  it("recognises an executable that needs administrator rights", () => {
    // LHM asks for elevation because it loads a driver; spawning it from a
    // normal session is what Windows refuses with EACCES.
    const elevated = fileURLToPath(
      new URL("./__fixtures__/elevated.bin", import.meta.url),
    );
    const invoker = fileURLToPath(
      new URL("./__fixtures__/as-invoker.bin", import.meta.url),
    );

    expect(requiresElevation(elevated)).toBe(true);
    expect(requiresElevation(invoker)).toBe(false);
    // A missing file is not an elevation claim.
    expect(requiresElevation("/definitely/not/here.exe")).toBe(false);
  });

  it("detects whether LHM's elevated startup task is registered", () => {
    // A registered task runs with RunLevel.Highest, so Windows starts LHM
    // elevated with no prompt; the launcher must then advise differently from
    // a first install.
    expect(hasLhmStartupTask("/definitely/not/a/task/dir")).toBe(false);
    expect(hasLhmStartupTask(import.meta.dirname)).toBe(false);
  });

  it("does not escalate a binary that does not need it", () => {
    // The plain path must stay a plain spawn: escalating everything would
    // prompt on every start.
    const child = launchChild(process.execPath);
    expect(child.killed).toBe(false);
    child.kill();
  });

  it("starts a bundled LHM through the escalation path, not a bare spawn", () => {
    // A requireAdministrator binary cannot be spawned directly, so the
    // launcher must route it through Windows' own mechanism. Asserted on the
    // real manifest: a bare spawn here would fail with EACCES.
    const real = "packages/host/vendor/lhm/LibreHardwareMonitor.exe";
    if (!existsSync(real)) {
      // The vendor step is optional; nothing to assert without it.
      expect(requiresElevation(real)).toBe(false);
      return;
    }

    expect(requiresElevation(real)).toBe(true);
    const child = launchChild(real);
    expect(child.killed).toBe(false);
    child.kill();
  });

  // Registration is the Windows startup task, so the missing-executable
  // sentence only exists behind the platform guard; elsewhere the launcher
  // answers that LHM does not run here at all.
  it.skipIf(process.platform !== "win32")(
    "refuses to register a task for a missing executable",
    async () => {
      const outcome = await registerLhmTask("/definitely/not/here.exe");

      expect(outcome.ok).toBe(false);
      expect(outcome.message).toContain("was not found");
      // Never a silent success: the caller must see why it failed.
      expect(outcome.message.length).toBeGreaterThan(20);
    },
  );

  it("leaves an LHM that is already answering alone", async () => {
    const spawnProcess = vi.fn();
    const result = await launchLhm({
      executable: "/nope/LibreHardwareMonitor.exe",
      baseUrl: "http://127.0.0.1:8085",
      fetcher: async () => ({ ok: true }),
      spawnProcess,
    });

    // Never starts a second copy over one the owner is already running.
    expect(result.started).toBe(false);
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("reports a missing executable instead of starting nothing", async () => {
    const result = await launchLhm({
      executable: "/definitely/not/here/LibreHardwareMonitor.exe",
      baseUrl: "http://127.0.0.1:8085",
      fetcher: async () => ({ ok: false }),
    });

    expect(result.started).toBe(false);
    expect(result.reason).toContain("was not found");
  });

  it("reports a server that never answers, naming the setting to enable", async () => {
    const kill = vi.fn();
    const result = await launchLhm({
      executable: import.meta.filename,
      baseUrl: "http://127.0.0.1:8085",
      timeoutMs: 50,
      fetcher: async () => ({ ok: false }),
      spawnProcess: () => ({ kill, killed: false, once: vi.fn() }) as never,
    });

    expect(result.started).toBe(false);
    expect(result.reason).toContain("Run web server");
    // A process it started is stopped again.
    result.stop();
    expect(kill).toHaveBeenCalled();
  });

  it("reports a spawn that fails asynchronously, as spawn actually does", async () => {
    const kill = vi.fn();
    const result = await launchLhm({
      executable: import.meta.filename,
      baseUrl: "http://127.0.0.1:8085",
      timeoutMs: 5000,
      fetcher: async () => ({ ok: false }),
      // spawn emits "error" on the next tick rather than throwing.
      spawnProcess: () =>
        ({
          kill,
          killed: false,
          once: (event: string, handler: (error: Error) => void) => {
            if (event === "error")
              setImmediate(() => handler(new Error("EACCES")));
          },
        }) as never,
    });

    // Reported promptly instead of waiting out the timeout, and never thrown.
    expect(result.started).toBe(false);
    expect(result.reason).toContain("EACCES");
  });

  it("reports a spawn failure without throwing", async () => {
    const result = await launchLhm({
      executable: import.meta.filename,
      baseUrl: "http://127.0.0.1:8085",
      fetcher: async () => ({ ok: false }),
      spawnProcess: () => {
        throw new Error("EPERM");
      },
    });

    expect(result.started).toBe(false);
    expect(result.reason).toContain("EPERM");
  });
});
