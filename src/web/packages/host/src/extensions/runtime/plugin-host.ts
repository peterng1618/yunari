/**
 * The child half of the plugin worker protocol.
 *
 * Runtime imports are `node:` builtins only. The tests fork this source file
 * under plain Node with `--experimental-strip-types`, and Node cannot resolve
 * this workspace's extensionless TypeScript specifiers, so every type-only
 * import is erased and nothing here may import the workspace or a sibling
 * module at runtime.
 *
 * The parent sends one `init` request first. Only after that does the child
 * import the plugin module, and only when the resolved entry stays inside the
 * installed directory.
 *
 * A plugin module may export `setHostApi(api)`. The child calls it once after
 * the import with `{ call(method, params) }`; that call becomes a
 * `plugin.request` on IPC and resolves with the matching `plugin.result`. The
 * child forwards only the method names the init message listed in
 * `allowedPluginMethods`; the host rechecks every call.
 *
 * A request handler that throws answers `ok: false` with a short reason and the
 * worker keeps serving: an expected gap (a missing key, a provider outage) is
 * the plugin's answer, not a crash. Only a genuine crash exits the process —
 * an uncaught exception, an unhandled rejection, or an entry that cannot load.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginMethod } from "@yunari/extension-api";

type PluginModule = Readonly<Record<string, unknown>>;

interface HostRequest {
  readonly type: "host.request";
  readonly id: string;
  readonly method: string;
  readonly params: unknown;
  readonly scope?: string;
}

interface PluginResultMessage {
  readonly type: "plugin.result";
  readonly id: string;
  readonly ok: boolean;
  readonly value?: unknown;
  readonly reason?: string;
}

interface PendingCall {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
}

const HANDLERS = new Set([
  "describe",
  "sample",
  "health",
  "stop",
  "asset.search",
  "asset.bytes",
  "panel.attached",
  "panel.open",
  "panel.present",
  "panel.command",
  "panel.close",
]);

/** The runner whose request is being answered. A host call the plugin makes
 *  inside that handler carries the scope back, so the host can close exactly
 *  that display's devices. Async-local, because two displays may interleave. */
const runnerScope = new AsyncLocalStorage<string>();

const pending = new Map<string, PendingCall>();
let allowed: ReadonlySet<string> = new Set();
let pluginModule: PluginModule | undefined;
let calls = 0;

function send(message: unknown, after?: () => void): void {
  if (typeof process.send !== "function") {
    process.stderr.write("plugin host started without an IPC channel\n");
    process.exit(1);
  }
  process.send(message, () => after?.());
}

function reasonOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 200);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readHostRequest(value: unknown): HostRequest | undefined {
  if (!isRecord(value)) return undefined;
  if (value["type"] !== "host.request") return undefined;
  if (typeof value["id"] !== "string") return undefined;
  if (typeof value["method"] !== "string") return undefined;
  const scope = value["scope"];
  return {
    type: "host.request",
    id: value["id"],
    method: value["method"],
    params: value["params"],
    ...(typeof scope === "string" ? { scope } : {}),
  };
}

function hostCall(method: string, params?: unknown): Promise<unknown> {
  if (!allowed.has(method)) {
    return Promise.reject(new Error("method-not-allowed"));
  }
  const id = `plugin-${++calls}`;
  const scope = runnerScope.getStore();
  return new Promise((resolveCall, rejectCall) => {
    pending.set(id, { resolve: resolveCall, reject: rejectCall });
    send({
      type: "plugin.request",
      id,
      method,
      params,
      ...(scope === undefined ? {} : { scope }),
    });
  });
}

async function initialise(params: unknown): Promise<unknown> {
  if (pluginModule !== undefined) throw new Error("already-initialised");
  if (!isRecord(params)) throw new Error("invalid-init");
  const directory = params["directory"];
  const main = params["main"];
  if (typeof directory !== "string" || typeof main !== "string")
    throw new Error("invalid-init");

  const root = resolve(directory);
  const target = resolve(root, main);
  if (!target.startsWith(root + sep)) throw new Error("main-outside-directory");

  const methods = params["allowedPluginMethods"];
  allowed = new Set(
    Array.isArray(methods)
      ? methods.filter((value): value is string => typeof value === "string")
      : [],
  );

  let imported: PluginModule;
  try {
    imported = (await import(pathToFileURL(target).href)) as PluginModule;
  } catch (error) {
    // An entry that cannot load is a crash, not a protocol answer: the parent
    // reports it through the exit code and captured stderr.
    process.stderr.write(`${reasonOf(error)}\n`);
    process.exit(1);
  }

  pluginModule = imported;
  const setHostApi = imported["setHostApi"];
  if (typeof setHostApi === "function") {
    (setHostApi as (api: unknown) => void)({
      call: (method: PluginMethod | string, callParams?: unknown) =>
        hostCall(method, callParams),
    });
  }
  return { api: 1 };
}

async function dispatch(method: string, params: unknown): Promise<unknown> {
  const loaded = pluginModule;
  if (loaded === undefined || !HANDLERS.has(method))
    throw new Error("unknown-method");
  const handler = loaded[method];
  if (typeof handler !== "function") throw new Error("unknown-method");
  return (handler as (input: unknown) => unknown)(params);
}

async function handle(request: HostRequest): Promise<void> {
  let result: PluginResultMessage;
  try {
    const value =
      request.method === "init"
        ? await initialise(request.params)
        : await dispatch(request.method, request.params);
    result = { type: "plugin.result", id: request.id, ok: true, value };
  } catch (error) {
    // A handler's throw, an unknown method and a failed init are all answers
    // to this request. Initialise exits on its own only for an entry that
    // cannot load.
    result = {
      type: "plugin.result",
      id: request.id,
      ok: false,
      reason: reasonOf(error),
    };
  }

  if (request.method === "stop") {
    send(result, () => process.exit(0));
    return;
  }
  send(result);
}

process.on("uncaughtException", (error) => {
  process.stderr.write(`${reasonOf(error)}\n`);
  process.exit(1);
});
process.on("unhandledRejection", (error) => {
  process.stderr.write(`${reasonOf(error)}\n`);
  process.exit(1);
});

process.on("message", (value: unknown) => {
  if (isRecord(value) && value["type"] === "plugin.result") {
    const id = value["id"];
    if (typeof id !== "string") return;
    const call = pending.get(id);
    if (call === undefined) return;
    pending.delete(id);
    if (value["ok"] === true) call.resolve(value["value"]);
    else {
      const reason = value["reason"];
      call.reject(
        new Error(typeof reason === "string" ? reason : "Host call failed."),
      );
    }
    return;
  }

  const request = readHostRequest(value);
  if (request !== undefined) {
    const run = (): Promise<void> => handle(request);
    void (request.scope === undefined
      ? run()
      : runnerScope.run(request.scope, run));
  }
});

send({ type: "plugin.ready", pluginApi: 1 });
