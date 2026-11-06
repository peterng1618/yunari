import { isRecord, type ObjectValue } from "./manifest-values";

/**
 * The worker protocol: every message crosses a process boundary that neither
 * side controls, so the reader is total and each message's key set is closed.
 */

export type HostMethod =
  | "init"
  | "describe"
  | "sample"
  | "health"
  | "stop"
  | "asset.search"
  | "asset.bytes";

export type PluginMethod =
  | "network.fetch"
  | "storage.get"
  | "storage.set"
  | "storage.remove"
  | "storage.list"
  | "secrets.get"
  | "secrets.set"
  | "secrets.remove"
  | "settings.get"
  | "settings.set"
  | "log";

export interface HostRequest {
  readonly type: "host.request";
  readonly id: string;
  readonly method: HostMethod;
  readonly params: unknown;
}
export interface PluginRequest {
  readonly type: "plugin.request";
  readonly id: string;
  readonly method: PluginMethod;
  readonly params: unknown;
}
export interface PluginResult {
  readonly type: "plugin.result";
  readonly id: string;
  readonly ok: boolean;
  readonly value?: unknown;
  readonly reason?: string;
}
export interface PluginReady {
  readonly type: "plugin.ready";
  readonly pluginApi: 1;
}
export interface PluginLog {
  readonly type: "plugin.log";
  readonly level: "info" | "warn" | "error";
  readonly message: string;
}

export type HostMessage = HostRequest;
export type PluginMessage =
  | PluginRequest
  | PluginResult
  | PluginReady
  | PluginLog;

const PLUGIN_REQUEST_KEYS = ["type", "id", "method", "params"] as const;
const PLUGIN_RESULT_KEYS = ["type", "id", "ok", "value", "reason"] as const;
const PLUGIN_READY_KEYS = ["type", "pluginApi"] as const;
const PLUGIN_LOG_KEYS = ["type", "level", "message"] as const;

/** The plugin-to-host calls the worker protocol accepts. Host-facing methods
 *  (`init`, `describe`, `sample`, `health`, `stop`) are not in this set, so a
 *  plugin naming one is refused rather than forwarded. */
export const PLUGIN_METHODS: ReadonlySet<PluginMethod> = new Set<PluginMethod>([
  "network.fetch",
  "storage.get",
  "storage.set",
  "storage.remove",
  "storage.list",
  "secrets.get",
  "secrets.set",
  "secrets.remove",
  "settings.get",
  "settings.set",
  "log",
]);

const LOG_LEVELS: ReadonlySet<string> = new Set<PluginLog["level"]>([
  "info",
  "warn",
  "error",
]);

function hasExactKeys(value: ObjectValue, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

/** `undefined` for anything the protocol does not recognise, never a throw. */
export function readPluginMessage(value: unknown): PluginMessage | undefined {
  if (!isRecord(value)) return undefined;
  const type = value["type"];

  if (type === "plugin.request") {
    if (!hasExactKeys(value, PLUGIN_REQUEST_KEYS)) return undefined;
    const id = value["id"];
    const method = value["method"];
    if (typeof id !== "string") return undefined;
    if (
      typeof method !== "string" ||
      !PLUGIN_METHODS.has(method as PluginMethod)
    )
      return undefined;
    if (!("params" in value)) return undefined;
    return {
      type,
      id,
      method: method as PluginMethod,
      params: value["params"],
    };
  }

  if (type === "plugin.result") {
    if (!hasExactKeys(value, PLUGIN_RESULT_KEYS)) return undefined;
    const id = value["id"];
    const ok = value["ok"];
    const result = value["value"];
    const reason = value["reason"];
    if (typeof id !== "string" || typeof ok !== "boolean") return undefined;
    if (reason !== undefined && typeof reason !== "string") return undefined;
    if (!ok && reason === undefined) return undefined;
    return {
      type,
      id,
      ok,
      ...(result === undefined ? {} : { value: result }),
      ...(reason === undefined ? {} : { reason }),
    };
  }

  if (type === "plugin.ready") {
    if (!hasExactKeys(value, PLUGIN_READY_KEYS)) return undefined;
    if (value["pluginApi"] !== 1) return undefined;
    return { type, pluginApi: 1 };
  }

  if (type === "plugin.log") {
    if (!hasExactKeys(value, PLUGIN_LOG_KEYS)) return undefined;
    const level = value["level"];
    const message = value["message"];
    if (typeof level !== "string" || !LOG_LEVELS.has(level)) return undefined;
    if (typeof message !== "string") return undefined;
    return { type, level: level as PluginLog["level"], message };
  }

  return undefined;
}
