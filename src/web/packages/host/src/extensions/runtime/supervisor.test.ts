import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Capability,
  ConsentRecord,
  InstalledPlugin,
} from "@yunari/extension-api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPluginSupervisor,
  type HostApiDispatcher,
  type PluginSupervisor,
} from "./supervisor.js";

/** The source file, forked under plain Node; the child must run without the
 *  workspace's bundler or extensionless TypeScript resolution. */
const WORKER_ENTRY = fileURLToPath(
  new URL("./plugin-host.ts", import.meta.url),
);

function record(overrides: Partial<ConsentRecord> = {}): ConsentRecord {
  return {
    pluginKey: "local/test-plugin",
    version: "1.0.0",
    fingerprint: "yc1-abc",
    grantedAt: "2026-11-06T00:00:00.000Z",
    ...overrides,
  };
}

function installed(directory: string): InstalledPlugin {
  return {
    key: "local/test-plugin",
    publisher: "local",
    directory,
    contentHash: "a".repeat(64),
    manifest: {
      manifestVersion: 1,
      id: "test-plugin",
      name: "Test Plugin",
      version: "1.0.0",
      description: "fixture",
      engines: { yunari: ">=0.1.0" },
      pluginApi: 1,
      execution: "trusted-worker",
      capabilities: ["sensor:provide", "storage:own"],
      contributes: {},
      main: "plugin.mjs",
    },
  };
}

function hostApi(
  call: HostApiDispatcher["call"] = async () => ({}),
): HostApiDispatcher {
  return { call };
}

describe("plugin supervisor", () => {
  let root: string;
  const supervisors: PluginSupervisor[] = [];

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "yunari-plugin-"));
  });

  afterEach(async () => {
    for (const supervisor of supervisors.splice(0)) await supervisor.stop();
    await rm(root, { recursive: true, force: true });
  });

  async function writePlugin(source: string): Promise<InstalledPlugin> {
    const directory = await mkdtemp(path.join(root, "plugin-"));
    await writeFile(path.join(directory, "plugin.mjs"), source, "utf8");
    return installed(directory);
  }

  function supervise(
    plugin: InstalledPlugin,
    options: {
      readonly granted?: readonly Capability[];
      readonly hostApi?: HostApiDispatcher;
      readonly requestTimeoutMs?: number;
      readonly restartBaseMs?: number;
      readonly restartMaxMs?: number;
      readonly consent?: ConsentRecord;
      readonly onCrash?: (reason: string) => void;
      readonly onRestart?: (attempt: number, delayMs: number) => void;
    } = {},
  ): PluginSupervisor {
    const supervisor = createPluginSupervisor({
      plugin,
      granted: options.granted ?? ["sensor:provide"],
      consent: options.consent ?? record(),
      hostApi: options.hostApi ?? hostApi(),
      workerEntry: WORKER_ENTRY,
      ...(options.requestTimeoutMs === undefined
        ? {}
        : { requestTimeoutMs: options.requestTimeoutMs }),
      ...(options.restartBaseMs === undefined
        ? {}
        : { restartBaseMs: options.restartBaseMs }),
      ...(options.restartMaxMs === undefined
        ? {}
        : { restartMaxMs: options.restartMaxMs }),
      ...(options.onCrash === undefined ? {} : { onCrash: options.onCrash }),
      ...(options.onRestart === undefined
        ? {}
        : { onRestart: options.onRestart }),
    });
    supervisors.push(supervisor);
    return supervisor;
  }

  it("runs a real temp plugin over IPC and waits for its exit", async () => {
    const marker = path.join(root, "exited.txt");
    const plugin = await writePlugin(`
import { appendFileSync } from "node:fs";
process.on("exit", () => appendFileSync(${JSON.stringify(marker)}, "x"));
export async function describe() {
  return [{ sensorId: "x", semanticKey: "cpu.load", label: "Load", tier: "basic" }];
}
`);
    const supervisor = supervise(plugin);

    await supervisor.start();
    expect(await supervisor.request("describe", {})).toEqual([
      expect.objectContaining({ semanticKey: "cpu.load" }),
    ]);

    await supervisor.stop();
    await vi.waitFor(async () =>
      expect(await readFile(marker, "utf8")).toBe("x"),
    );
    await supervisor.stop();
  });

  it("settles a start that is stopped while still starting", async () => {
    const crashes: string[] = [];
    const plugin = await writePlugin(
      `export async function health() { return "ok"; }`,
    );
    const supervisor = supervise(plugin, {
      onCrash: (reason) => crashes.push(reason),
    });

    const starting = supervisor.start();
    const stopping = supervisor.stop();

    await expect(starting).rejects.toThrow("stopped");
    await stopping;
    expect(crashes).toEqual([]);
  });

  it("marks the supervisor dead when a request times out", async () => {
    const crashes: string[] = [];
    const plugin = await writePlugin(
      `export async function health() { return new Promise(() => {}); }`,
    );
    const supervisor = supervise(plugin, {
      requestTimeoutMs: 50,
      onCrash: (reason) => crashes.push(reason),
    });

    await supervisor.start();
    await expect(supervisor.request("health", {})).rejects.toThrow(
      "did not answer",
    );
    expect(supervisor.alive).toBe(false);
    expect(crashes).toHaveLength(1);
  });

  it("gives startup its own timeout, independent of the request timeout", async () => {
    const plugin = await writePlugin(`
await new Promise((resolve) => setTimeout(resolve, 100));
export async function health() { return "ok"; }
`);
    const supervisor = supervise(plugin, { requestTimeoutMs: 20 });

    await supervisor.start();
    expect(supervisor.alive).toBe(true);
  });

  it("forwards a plugin's host call through the dispatcher", async () => {
    const plugin = await writePlugin(`
let api;
export function setHostApi(value) { api = value; }
export async function describe() {
  return [await api.call("storage.get", { key: "one" })];
}
`);
    const supervisor = supervise(plugin, {
      granted: ["sensor:provide", "storage:own"],
      hostApi: hostApi(async ({ method, params }) => ({ method, params })),
    });

    await supervisor.start();
    expect(await supervisor.request("describe", {})).toEqual([
      { method: "storage.get", params: { key: "one" } },
    ]);
  });

  it("carries the runner's scope to a host call the plugin makes", async () => {
    const plugin = await writePlugin(`
let api;
export function setHostApi(value) { api = value; }
export async function describe() {
  return await api.call("storage.get", { key: "one" });
}
`);
    const scopes: (string | undefined)[] = [];
    const supervisor = supervise(plugin, {
      granted: ["sensor:provide", "storage:own"],
      hostApi: hostApi(async ({ scope }) => {
        scopes.push(scope);
        return null;
      }),
    });

    await supervisor.start();
    await supervisor.request("describe", {}, "display-1");
    await supervisor.request("describe", {});

    expect(scopes).toEqual(["display-1", undefined]);
  });

  it("lets a serial-only plugin call the device lifecycle pair", async () => {
    const plugin = await writePlugin(`
let api;
export function setHostApi(value) { api = value; }
export async function describe() {
  return await api.call("usb.open", { transport: "serial", vendorId: 1, productId: 2, path: "COM3" });
}
`);
    const methods: string[] = [];
    const supervisor = supervise(plugin, {
      granted: ["sensor:provide", "serial:device"],
      hostApi: hostApi(async ({ method }) => {
        methods.push(method);
        return "token";
      }),
    });

    await supervisor.start();
    expect(await supervisor.request("describe", {})).toBe("token");
    expect(methods).toEqual(["usb.open"]);
  });

  it("carries binary across IPC in both directions", async () => {
    const plugin = await writePlugin(`
let api;
export function setHostApi(value) { api = value; }
export async function describe(params) {
  const fromHost = params.bytes;
  const echoed = await api.call("storage.get", { bytes: fromHost });
  return {
    hostToChild: fromHost instanceof Uint8Array,
    childToHost: echoed.bytes instanceof Uint8Array,
    bytes: echoed.bytes,
  };
}
`);
    const supervisor = supervise(plugin, {
      granted: ["sensor:provide", "storage:own"],
      hostApi: hostApi(async ({ params }) => ({
        bytes: (params as { bytes: unknown }).bytes,
      })),
    });

    await supervisor.start();
    const answer = await supervisor.request<{
      hostToChild: boolean;
      childToHost: boolean;
      bytes: unknown;
    }>("describe", { bytes: new Uint8Array([1, 2, 3]) });

    expect(answer.hostToChild).toBe(true);
    expect(answer.childToHost).toBe(true);
    expect(answer.bytes).toBeInstanceOf(Uint8Array);
    expect([...(answer.bytes as Uint8Array)]).toEqual([1, 2, 3]);
  });

  it("refuses plugin calls outside the plugin-callable table", async () => {
    const plugin = await writePlugin(`
let api;
export function setHostApi(value) { api = value; }
export async function describe() {
  const reasons = [];
  for (const method of ["network.fetch", "describe"]) {
    try { await api.call(method, {}); reasons.push("allowed"); }
    catch (error) { reasons.push(error.message); }
  }
  return reasons;
}
`);
    const supervisor = supervise(plugin, { granted: ["sensor:provide"] });

    await supervisor.start();
    expect(await supervisor.request("describe", {})).toEqual([
      "method-not-allowed",
      "method-not-allowed",
    ]);
  });

  it("rejects a request after stop and reports a missing main entry", async () => {
    const plugin = await writePlugin(
      `export async function health() { return "ok"; }`,
    );
    const supervisor = supervise(plugin);

    await supervisor.start();
    await supervisor.stop();
    await expect(supervisor.request("health", {})).rejects.toThrow(
      "not running",
    );

    const withoutMain = {
      ...plugin,
      manifest: { ...plugin.manifest, main: undefined },
    } as unknown as InstalledPlugin;
    const refused = supervise(withoutMain);
    await expect(refused.start()).rejects.toThrow("main");
  });

  it("refuses consent for another plugin or version before forking", async () => {
    const plugin = await writePlugin(
      `export async function health() { return "ok"; }`,
    );

    const wrongKey = supervise(plugin, {
      consent: record({ pluginKey: "local/other-plugin" }),
    });
    await expect(wrongKey.start()).rejects.toThrow("Consent");

    const wrongVersion = supervise(plugin, {
      consent: record({ version: "2.0.0" }),
    });
    await expect(wrongVersion.start()).rejects.toThrow("Consent");
  });

  it("rejects start when the plugin entry crashes on import", async () => {
    const crashes: string[] = [];
    const plugin = await writePlugin(`throw new Error("boom-import");`);
    const supervisor = supervise(plugin, {
      onCrash: (reason) => crashes.push(reason),
    });

    await expect(supervisor.start()).rejects.toThrow();
    expect(supervisor.alive).toBe(false);
    expect(crashes).toHaveLength(1);
    expect(crashes[0]).toContain("boom-import");
  });

  it("rejects a pending request when the child exits mid-request", async () => {
    const crashes: string[] = [];
    const plugin = await writePlugin(
      `export async function health() { process.exit(3); }`,
    );
    const supervisor = supervise(plugin, {
      onCrash: (reason) => crashes.push(reason),
    });

    await supervisor.start();
    await expect(supervisor.request("health", {})).rejects.toThrow(
      "exited with code 3",
    );
    expect(supervisor.alive).toBe(false);
    expect(crashes).toHaveLength(1);
  });

  it("does not fork twice and reports one crash only", async () => {
    const crashes: string[] = [];
    const plugin = await writePlugin(
      `export async function health() { return "ok"; }`,
    );
    const supervisor = supervise(plugin, {
      onCrash: (reason) => crashes.push(reason),
    });

    await supervisor.start();
    await expect(supervisor.start()).rejects.toThrow("already running");
    expect(await supervisor.request("health", {})).toBe("ok");
    expect(crashes).toEqual([]);
  });

  it("crashes non-zero after the second handler throw", async () => {
    const crashes: string[] = [];
    const plugin = await writePlugin(
      `export async function health() { throw new Error("boom-handler"); }`,
    );
    const supervisor = supervise(plugin, {
      onCrash: (reason) => crashes.push(reason),
    });

    await supervisor.start();
    await expect(supervisor.request("health", {})).rejects.toThrow(
      "boom-handler",
    );
    await expect(supervisor.request("health", {})).rejects.toThrow(
      "boom-handler",
    );
    await vi.waitFor(() => expect(supervisor.alive).toBe(false));
    expect(crashes).toHaveLength(1);
  });

  it("drops a dead child's late host answer instead of its replacement", async () => {
    const marker = path.join(root, "is-b.txt");
    const plugin = await writePlugin(`
import { existsSync } from "node:fs";
let api;
export function setHostApi(value) { api = value; }
export async function describe() {
  const who = existsSync(${JSON.stringify(marker)}) ? "B" : "A";
  return [await api.call("storage.get", { who })];
}
`);
    const answers = new Map<string, (value: string) => void>();
    const supervisor = supervise(plugin, {
      granted: ["sensor:provide", "storage:own"],
      hostApi: hostApi(
        ({ params }) =>
          new Promise<string>((resolve) => {
            answers.set((params as { who: string }).who, resolve);
          }),
      ),
    });

    await supervisor.start();
    const fromA = supervisor
      .request("describe", {})
      .catch((error: Error) => error.message);
    await vi.waitFor(() => expect(answers.has("A")).toBe(true));

    await supervisor.stop();
    await writeFile(marker, "x");
    await supervisor.start();

    const fromB = supervisor.request("describe", {});
    await vi.waitFor(() => expect(answers.has("B")).toBe(true));

    // Both processes used child-side id `plugin-1`; only B's answer may land.
    answers.get("A")?.("answer-A");
    answers.get("B")?.("answer-B");

    expect(await fromB).toEqual(["answer-B"]);
    expect(await fromA).toBe("Plugin supervisor stopped.");
  });

  it("restarts a child that exits after a successful start", async () => {
    const spawns = path.join(root, "spawns.txt");
    const exited = path.join(root, "exited.txt");
    const plugin = await writePlugin(`
import { appendFileSync, existsSync } from "node:fs";
appendFileSync(${JSON.stringify(spawns)}, "x");
export async function health() {
  if (!existsSync(${JSON.stringify(exited)})) {
    appendFileSync(${JSON.stringify(exited)}, "x");
    process.exit(1);
  }
  return "ok";
}
`);
    const restarts: { attempt: number; delayMs: number }[] = [];
    const supervisor = supervise(plugin, {
      restartBaseMs: 10,
      restartMaxMs: 10,
      onRestart: (attempt, delayMs) => restarts.push({ attempt, delayMs }),
    });

    await supervisor.start();
    await expect(supervisor.request("health", {})).rejects.toThrow(
      "exited with code 1",
    );

    await vi.waitFor(() => expect(restarts).toHaveLength(1), {
      timeout: 5_000,
    });
    await vi.waitFor(() => expect(supervisor.alive).toBe(true), {
      timeout: 5_000,
    });
    expect(await supervisor.request("health", {})).toBe("ok");

    // The replacement is a second fork of the same worker entry.
    expect((await readFile(spawns, "utf8")).length).toBe(2);
  });

  it("grows restart delays while attempts keep failing and caps them", async () => {
    const plugin = await writePlugin(
      `export async function health() { process.exit(2); }`,
    );
    const delays: number[] = [];
    const supervisor = supervise(plugin, {
      restartBaseMs: 20,
      restartMaxMs: 50,
      onRestart: (_attempt, delayMs) => delays.push(delayMs),
    });

    await supervisor.start();
    // Every replacement now fails to start, so the attempt count keeps
    // climbing; a successful start would reset it to 1.
    await rm(path.join(plugin.directory, "plugin.mjs"));
    await expect(supervisor.request("health", {})).rejects.toThrow(
      "exited with code 2",
    );

    await vi.waitFor(() => expect(delays.length).toBeGreaterThanOrEqual(4), {
      timeout: 10_000,
    });
    expect(delays.slice(0, 4)).toEqual([20, 40, 50, 50]);
  });

  it("cancels a pending restart on stop", async () => {
    const spawns = path.join(root, "spawns.txt");
    const plugin = await writePlugin(`
import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(spawns)}, "x");
export async function health() { process.exit(4); }
`);
    const restarts: number[] = [];
    const supervisor = supervise(plugin, {
      restartBaseMs: 150,
      restartMaxMs: 150,
      onRestart: (attempt) => restarts.push(attempt),
    });

    await supervisor.start();
    await expect(supervisor.request("health", {})).rejects.toThrow(
      "exited with code 4",
    );
    await vi.waitFor(() => expect(restarts).toEqual([1]), { timeout: 5_000 });

    await supervisor.stop();
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(restarts).toEqual([1]);
    expect((await readFile(spawns, "utf8")).length).toBe(1);
  });

  it("does not restart after an initial start failure", async () => {
    const restarts: number[] = [];
    const plugin = await writePlugin(`throw new Error("boom-import");`);
    const supervisor = supervise(plugin, {
      restartBaseMs: 10,
      restartMaxMs: 10,
      onRestart: (attempt) => restarts.push(attempt),
    });

    await expect(supervisor.start()).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(restarts).toEqual([]);
    expect(supervisor.alive).toBe(false);
  });

  it("retries a restart that fails instead of leaving the worker dead", async () => {
    const plugin = await writePlugin(
      `export async function health() { process.exit(5); }`,
    );
    const restarts: number[] = [];
    const supervisor = supervise(plugin, {
      restartBaseMs: 10,
      restartMaxMs: 10,
      onRestart: (attempt) => restarts.push(attempt),
    });

    await supervisor.start();
    // The replacement cannot start, so only the retry path can reach attempt 2.
    await rm(path.join(plugin.directory, "plugin.mjs"));
    await expect(supervisor.request("health", {})).rejects.toThrow(
      "exited with code 5",
    );

    await vi.waitFor(() => expect(restarts.length).toBeGreaterThanOrEqual(2), {
      timeout: 5_000,
    });
    expect(supervisor.alive).toBe(false);
  });

  it("restarts after stop and reports a later crash", async () => {
    const crashes: string[] = [];
    const plugin = await writePlugin(
      `export async function health() { throw new Error("boom-handler"); }`,
    );
    const supervisor = supervise(plugin, {
      onCrash: (reason) => crashes.push(reason),
    });

    await supervisor.start();
    await supervisor.stop();
    await supervisor.start();
    expect(supervisor.alive).toBe(true);
    await expect(supervisor.request("health", {})).rejects.toThrow(
      "boom-handler",
    );
    await expect(supervisor.request("health", {})).rejects.toThrow(
      "boom-handler",
    );
    await vi.waitFor(() => expect(crashes).toHaveLength(1));
  });
});
