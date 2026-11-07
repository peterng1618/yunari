import { type ChildProcess, fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  type Capability,
  type ConsentRecord,
  HOST_API_METHODS,
  type HostMethod,
  type InstalledPlugin,
  PLUGIN_METHODS,
  type PluginMethod,
  readPluginMessage,
} from "@yunari/extension-api";
import { redactForBrowser } from "../../providers/provider.js";

/** Where a plugin's host calls land. The host API implementation (Plan 4)
 *  owns the table, the parameter checks and the authority recheck. */
export interface HostApiCall {
  readonly plugin: InstalledPlugin;
  readonly consent: ConsentRecord;
  readonly method: PluginMethod;
  readonly params: unknown;
  /** The display runner whose request the plugin is answering. */
  readonly scope?: string;
}

export interface HostApiDispatcher {
  call(input: HostApiCall): Promise<unknown>;
}

export interface PluginSupervisorOptions {
  readonly plugin: InstalledPlugin;
  readonly granted: readonly Capability[];
  readonly consent: ConsentRecord;
  readonly hostApi: HostApiDispatcher;
  readonly workerEntry?: string;
  readonly requestTimeoutMs?: number;
  readonly restartBaseMs?: number;
  readonly restartMaxMs?: number;
  readonly onCrash?: (reason: string) => void;
  /** A healthy worker that died is replaced; this reports the wait first. */
  readonly onRestart?: (attempt: number, delayMs: number) => void;
}

export interface PluginSupervisor {
  readonly alive: boolean;
  start(): Promise<void>;
  /** `scope` names the runner the request belongs to; a host call the plugin
   *  makes while answering it carries the same scope. `timeoutMs` bounds this
   *  one request; it defaults to the supervisor's request deadline. */
  request<T>(
    method: HostMethod,
    params: unknown,
    scope?: string,
    timeoutMs?: number,
  ): Promise<T>;
  stop(): Promise<void>;
}

/* A plugin call can wait on a host call, whose own deadline is 30 s
 * (`runtime/host-api.ts` CALL_TIMEOUT_MS); killing the worker first would turn
 * a slow fetch into a crash. Keep this above that deadline. */
const DEFAULT_REQUEST_TIMEOUT_MS = 35_000;
/* A crashed worker is replaced after this base delay; the delay doubles per
 * attempt and stops growing at the cap. */
const DEFAULT_RESTART_BASE_MS = 1_000;
const DEFAULT_RESTART_MAX_MS = 60_000;
const STARTUP_TIMEOUT_MS = 5_000;
const STOP_TIMEOUT_MS = 2_000;
const STOP_GRACE_MS = 1_000;
const STDERR_LIMIT = 2_048;

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The plugin-to-host methods this worker may call. `PLUGIN_METHODS` owns the
 *  plugin-callable half of the table, so a host-facing method never enters the
 *  whitelist. The child refuses anything else before it reaches IPC; the host
 *  rechecks every call anyway. */
function allowedPluginMethods(granted: readonly Capability[]): PluginMethod[] {
  const held = new Set(granted);
  return [...PLUGIN_METHODS].filter((name) => {
    const spec = HOST_API_METHODS[name];
    return (
      spec.surfaces.includes("worker") &&
      (spec.capabilities === null ||
        spec.capabilities.some((capability) => held.has(capability)))
    );
  });
}

export function createPluginSupervisor(
  options: PluginSupervisorOptions,
): PluginSupervisor {
  const requestTimeoutMs =
    options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const restartBaseMs = options.restartBaseMs ?? DEFAULT_RESTART_BASE_MS;
  const restartMaxMs = options.restartMaxMs ?? DEFAULT_RESTART_MAX_MS;
  const workerEntry =
    options.workerEntry ??
    fileURLToPath(new URL("./plugin-host.js", import.meta.url));

  let child: ChildProcess | undefined;
  let alive = false;
  let stopped = false;
  let crashed = false;
  /** This process generation completed `start()`; an initial failure stays out. */
  let started = false;
  let restartAttempt = 0;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  let ready:
    | { resolve: () => void; reject: (error: Error) => void }
    | undefined;
  let readyTimer: ReturnType<typeof setTimeout> | undefined;
  let stderr = "";
  let nextId = 0;
  const pending = new Map<string, PendingRequest>();

  function rejectPending(reason: string): void {
    for (const [id, entry] of pending) {
      pending.delete(id);
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
  }

  /** One crash report per process. The last 2 KB of stderr is the diagnostic;
   *  `redactForBrowser` strips addresses and bounds it for a browser surface. */
  function crash(detail: string): void {
    if (crashed || stopped) return;
    crashed = true;
    alive = false;
    const captured = stderr.trim();
    const reason = redactForBrowser(
      captured.length === 0 ? detail : `${detail}: ${captured}`,
      STDERR_LIMIT,
    );
    rejectPending(reason);
    options.onCrash?.(reason);
  }

  /** A message is sent to one fork, never to whichever child is current now.
   *  The child process object is this supervisor's generation token: a late
   *  answer from a stopped plugin must not reach its replacement. */
  function sendTo(target: ChildProcess, message: object): void {
    if (!target.connected) return;
    try {
      target.send(message);
    } catch {
      // The exit handler reports the crash; a closed channel is not new.
    }
  }

  function send(message: object): void {
    if (child !== undefined) sendTo(child, message);
  }

  function sendRequest<T>(
    method: string,
    params: unknown,
    timeoutMs = requestTimeoutMs,
    scope?: string,
  ): Promise<T> {
    const running = child;
    if (running === undefined)
      return Promise.reject(new Error("Plugin supervisor is not running."));

    const id = `host-${++nextId}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        const error = new Error(
          `${method} did not answer within ${timeoutMs} ms`,
        );
        reject(error);
        crash(error.message);
        running.kill();
      }, timeoutMs);
      pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      try {
        running.send({
          type: "host.request",
          id,
          method,
          params,
          ...(scope === undefined ? {} : { scope }),
        });
      } catch (error) {
        pending.delete(id);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /** Only a process that had become healthy is replaced. An initial start
   *  failure is the caller's to report and leave out; retrying it here would
   *  keep a rejected plugin alive behind the caller's back. */
  function scheduleRestart(): void {
    if (stopped) return;
    restartAttempt += 1;
    const delayMs = Math.min(
      restartBaseMs * 2 ** (restartAttempt - 1),
      restartMaxMs,
    );
    options.onRestart?.(restartAttempt, delayMs);
    restartTimer = setTimeout(() => {
      restartTimer = undefined;
      // A manual start may have taken over while the timer was pending.
      if (stopped || alive || child !== undefined) return;
      void start().catch(() => {
        // This generation had been healthy, so a failed replacement is
        // retried rather than leaving the worker permanently dead.
        scheduleRestart();
      });
    }, delayMs);
  }

  function onExit(
    running: ChildProcess,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    // An exit event can arrive after stop() returned and a restart forked a
    // replacement; only the current child may report or settle anything.
    if (child !== running) return;
    child = undefined;
    alive = false;
    if (readyTimer !== undefined) clearTimeout(readyTimer);
    const detail = `Plugin process exited with code ${String(code)}${signal === null ? "" : ` (${signal})`}`;
    if (stopped) {
      rejectPending("Plugin supervisor stopped.");
      return;
    }
    crash(detail);
    ready?.reject(new Error(detail));
    if (started) scheduleRestart();
  }

  async function forward(
    running: ChildProcess,
    id: string,
    method: PluginMethod,
    params: unknown,
    scope: string | undefined,
  ): Promise<void> {
    try {
      const value = await options.hostApi.call({
        plugin: options.plugin,
        consent: options.consent,
        method,
        params,
        ...(scope === undefined ? {} : { scope }),
      });
      sendTo(
        running,
        value === undefined
          ? { type: "plugin.result", id, ok: true }
          : { type: "plugin.result", id, ok: true, value },
      );
    } catch (error) {
      sendTo(running, {
        type: "plugin.result",
        id,
        ok: false,
        reason: redactForBrowser(reasonOf(error)),
      });
    }
  }

  function onMessage(running: ChildProcess, raw: unknown): void {
    // Child call ids restart at `plugin-1` in every process, so a stale
    // message is indistinguishable from a current one by id alone.
    if (child !== running) return;

    const message = readPluginMessage(raw);
    if (message === undefined) return;

    if (message.type === "plugin.ready") {
      if (readyTimer !== undefined) clearTimeout(readyTimer);
      ready?.resolve();
      return;
    }

    if (message.type === "plugin.result") {
      const entry = pending.get(message.id);
      if (entry === undefined) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.ok) entry.resolve(message.value);
      else entry.reject(new Error(message.reason ?? "Plugin call failed."));
      return;
    }

    if (message.type === "plugin.request") {
      void forward(
        running,
        message.id,
        message.method,
        message.params,
        message.scope,
      );
    }
  }

  async function start(): Promise<void> {
    if (alive || child !== undefined)
      throw new Error("Plugin supervisor is already running.");

    /* The record binds this plugin and version; freshness and fingerprint
     * comparison stay with ExtensionService, which owns consent storage. */
    if (
      options.consent.pluginKey !== options.plugin.key ||
      options.consent.version !== options.plugin.manifest.version
    )
      throw new Error("Consent does not match the installed plugin.");

    const main = options.plugin.manifest.main;
    if (main === undefined) throw new Error('The plugin has no "main" entry.');

    stopped = false;
    crashed = false;
    started = false;
    stderr = "";

    const running = fork(workerEntry, [], {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      // Default JSON IPC turns a `Uint8Array` into `{ "0": 1, ... }`, so a
      // panel frame would reach the host as a plain object and every transfer
      // would fail its own type check. Advanced serialization keeps binary.
      serialization: "advanced",
      env: { PATH: process.env.PATH },
      ...(workerEntry.endsWith(".ts")
        ? { execArgv: ["--experimental-strip-types"] }
        : {}),
    });
    child = running;

    // A piped stdout nobody reads fills and blocks the child.
    running.stdout?.resume();
    running.stderr?.setEncoding("utf8");
    running.stderr?.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_LIMIT);
    });
    running.on("message", (message) => onMessage(running, message));
    running.on("exit", (code, signal) => onExit(running, code, signal));
    running.on("error", (error) => {
      if (child !== running) return;
      ready?.reject(new Error(reasonOf(error)));
      if (!stopped) crash(reasonOf(error));
    });

    const readyPromise = new Promise<void>((resolve, reject) => {
      ready = { resolve, reject };
      readyTimer = setTimeout(() => {
        ready = undefined;
        reject(new Error("Plugin did not become ready."));
        crash("Plugin did not send plugin.ready.");
        running.kill();
      }, STARTUP_TIMEOUT_MS);
    });

    await readyPromise;
    ready = undefined;

    try {
      const answer = await sendRequest<{ api?: unknown }>(
        "init",
        {
          directory: options.plugin.directory,
          main,
          allowedPluginMethods: allowedPluginMethods(options.granted),
          consent: options.consent,
        },
        STARTUP_TIMEOUT_MS,
      );
      if (
        typeof answer !== "object" ||
        answer === null ||
        (answer as { api?: unknown }).api !== 1
      )
        throw new Error("Plugin refused init.");
    } catch (error) {
      crash(reasonOf(error));
      running.kill();
      throw error;
    }

    alive = true;
    started = true;
    restartAttempt = 0;
  }

  function request<T>(
    method: HostMethod,
    params: unknown,
    scope?: string,
    timeoutMs = requestTimeoutMs,
  ): Promise<T> {
    if (!alive)
      return Promise.reject(new Error("Plugin supervisor is not running."));
    return sendRequest<T>(method, params, timeoutMs, scope);
  }

  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;
    alive = false;
    if (restartTimer !== undefined) {
      clearTimeout(restartTimer);
      restartTimer = undefined;
    }
    // A startup that is still waiting settles here; its child is killed below.
    ready?.reject(new Error("Plugin supervisor stopped."));
    ready = undefined;
    if (readyTimer !== undefined) clearTimeout(readyTimer);
    rejectPending("Plugin supervisor stopped.");

    const running = child;
    if (running === undefined) return;

    const exited = new Promise<void>((resolve) => {
      if (running.exitCode !== null || running.signalCode !== null) resolve();
      else running.once("exit", () => resolve());
    });

    if (running.connected) {
      send({
        type: "host.request",
        id: `stop-${++nextId}`,
        method: "stop",
        params: {},
      });
    }
    const killTimer = setTimeout(() => {
      running.kill();
    }, STOP_TIMEOUT_MS);
    const graceTimer = setTimeout(
      () => undefined,
      STOP_TIMEOUT_MS + STOP_GRACE_MS,
    );

    await Promise.race([exited, graceTimer]);
    clearTimeout(killTimer);
    clearTimeout(graceTimer);
    child = undefined;
    rejectPending("Plugin supervisor stopped.");
  }

  return {
    get alive() {
      return alive;
    },
    start,
    request,
    stop,
  };
}
