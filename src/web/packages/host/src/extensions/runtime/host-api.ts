import path from "node:path";
import {
  type CallContext,
  type ConsentRecord,
  gateExtensionCall,
  type InstalledPlugin,
  PLUGIN_METHODS,
  type PluginMethod,
} from "@yunari/extension-api";
import {
  guardedFetch,
  type HostLookup,
} from "../../providers/custom/fetch-source.js";
import {
  createScopedStores,
  type PluginSettingsScope,
  type ScopedStores,
  type SecretScope,
  type StorageScope,
} from "./scoped-stores.js";

/**
 * The host side of a plugin's worker calls. Every call rebuilds the authority
 * context from the stored grant and the installed manifest, so a caller cannot
 * widen what the gate sees. Denials name the method and the gate's reason, never
 * the parameters.
 */

export interface HostApiCall {
  readonly plugin: InstalledPlugin;
  readonly consent: ConsentRecord;
  readonly method: string;
  readonly params: unknown;
}

export interface HostApiDispatcher {
  call(input: HostApiCall): Promise<unknown>;
}

export interface HostApiOptions {
  readonly settingsDir: string;
  readonly fetchImpl?: typeof fetch;
  readonly resolve?: HostLookup;
}

const INVALID = "invalid-params";
const LOG_LIMIT = 2_048;
const NETWORK_BODY_BYTES = 1024 * 1024;
const LOG_LEVELS: ReadonlySet<string> = new Set(["info", "warn", "error"]);

type Params = Readonly<Record<string, unknown>>;

type ParamsResult =
  | { readonly ok: true; readonly value: Params }
  | { readonly ok: false; readonly reason: string };

function invalid(): { readonly ok: false; readonly reason: string } {
  return { ok: false, reason: INVALID };
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A closed key set per method: an unknown key is refused, not ignored. */
function strictParams(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
): ParamsResult {
  if (value === undefined) {
    return required.length === 0
      ? { ok: true, value: {} }
      : { ok: false, reason: INVALID };
  }
  if (!isObject(value)) return invalid();

  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return invalid();
  }
  for (const key of required) {
    if (!(key in value)) return invalid();
  }
  return { ok: true, value };
}

function stringOf(params: Params, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" ? value : undefined;
}

async function networkFetch(
  plugin: InstalledPlugin,
  params: unknown,
  options: HostApiOptions,
): Promise<unknown> {
  const read = strictParams(
    params,
    ["url", "method", "headers", "body"],
    ["url"],
  );
  if (!read.ok) return read;

  const url = stringOf(read.value, "url");
  if (url === undefined) return invalid();

  const method = read.value["method"];
  if (method !== undefined && method !== "GET" && method !== "POST") {
    return invalid();
  }

  const body = read.value["body"];
  if (body !== undefined && typeof body !== "string") return invalid();

  const rawHeaders = read.value["headers"];
  let headers: Record<string, string> | undefined;
  if (rawHeaders !== undefined) {
    if (!isObject(rawHeaders)) return invalid();
    const entries = Object.entries(rawHeaders);
    if (entries.some(([, value]) => typeof value !== "string"))
      return invalid();
    headers = Object.fromEntries(entries) as Record<string, string>;
  }

  let destination: URL;
  try {
    destination = new URL(url);
  } catch {
    return { ok: false, reason: "the request URL is not a URL" };
  }
  if (destination.protocol !== "https:") {
    return { ok: false, reason: "the request URL must be https" };
  }
  if (destination.username !== "" || destination.password !== "") {
    return { ok: false, reason: "the request URL carries credentials" };
  }

  return guardedFetch({
    url,
    allowedHosts: plugin.manifest.networkHosts ?? [],
    maxBytes: NETWORK_BODY_BYTES,
    // The plugin call has no caller signal of its own; the host owns the
    // abort controller so a future supervisor timeout can cancel the request.
    signal: new AbortController().signal,
    ...(method === undefined ? {} : { method }),
    ...(body === undefined ? {} : { body }),
    ...(headers === undefined ? {} : { headers }),
    ...(options.fetchImpl === undefined
      ? {}
      : { fetchImpl: options.fetchImpl }),
    ...(options.resolve === undefined ? {} : { resolve: options.resolve }),
  });
}

async function storageCall(
  scope: StorageScope,
  method: PluginMethod,
  params: unknown,
): Promise<unknown> {
  switch (method) {
    case "storage.get": {
      const read = strictParams(params, ["key"], ["key"]);
      if (!read.ok) return read;
      const key = stringOf(read.value, "key");
      if (key === undefined) return invalid();
      return (await scope.get(key)) ?? null;
    }
    case "storage.set": {
      const read = strictParams(params, ["key", "value"], ["key", "value"]);
      if (!read.ok) return read;
      const key = stringOf(read.value, "key");
      const value = stringOf(read.value, "value");
      if (key === undefined || value === undefined) return invalid();
      await scope.set(key, value);
      return null;
    }
    case "storage.remove": {
      const read = strictParams(params, ["key"], ["key"]);
      if (!read.ok) return read;
      const key = stringOf(read.value, "key");
      if (key === undefined) return invalid();
      await scope.remove(key);
      return null;
    }
    case "storage.list": {
      const read = strictParams(params, [], []);
      if (!read.ok) return read;
      return scope.list();
    }
    default:
      return { ok: false, reason: "not-supported" };
  }
}

async function secretCall(
  scope: SecretScope,
  method: PluginMethod,
  params: unknown,
): Promise<unknown> {
  switch (method) {
    case "secrets.get": {
      const read = strictParams(params, ["key"], ["key"]);
      if (!read.ok) return read;
      const key = stringOf(read.value, "key");
      if (key === undefined) return invalid();
      return (await scope.get(key)) ?? null;
    }
    case "secrets.set": {
      const read = strictParams(params, ["key", "value"], ["key", "value"]);
      if (!read.ok) return read;
      const key = stringOf(read.value, "key");
      const value = stringOf(read.value, "value");
      if (key === undefined || value === undefined) return invalid();
      await scope.set(key, value);
      return null;
    }
    case "secrets.remove": {
      const read = strictParams(params, ["key"], ["key"]);
      if (!read.ok) return read;
      const key = stringOf(read.value, "key");
      if (key === undefined) return invalid();
      await scope.remove(key);
      return null;
    }
    default:
      return { ok: false, reason: "not-supported" };
  }
}

async function settingsCall(
  scope: PluginSettingsScope,
  method: PluginMethod,
  params: unknown,
): Promise<unknown> {
  switch (method) {
    case "settings.get": {
      const read = strictParams(params, [], []);
      if (!read.ok) return read;
      return scope.get();
    }
    case "settings.set": {
      const read = strictParams(params, ["value"], ["value"]);
      if (!read.ok) return read;
      const value = read.value["value"];
      if (!isObject(value)) return invalid();
      await scope.set(value);
      return null;
    }
    default:
      return { ok: false, reason: "not-supported" };
  }
}

function logCall(params: unknown): unknown {
  const read = strictParams(params, ["level", "message"], ["level", "message"]);
  if (!read.ok) return read;

  const level = read.value["level"];
  const message = read.value["message"];
  if (typeof level !== "string" || !LOG_LEVELS.has(level)) return invalid();
  if (typeof message !== "string") return invalid();

  const bounded = message.slice(0, LOG_LIMIT);
  if (level === "warn") console.warn(bounded);
  else if (level === "error") console.error(bounded);
  else console.info(bounded);
  return null;
}

export function createHostApiDispatcher(
  options: HostApiOptions,
): HostApiDispatcher {
  const root = path.join(options.settingsDir, "extensions");
  /** One store object per installed content: an update gets a fresh tree, so a
   *  stale object cannot keep writing under the previous version's path. */
  const storesByPlugin = new Map<string, ScopedStores>();
  const storesFor = (plugin: InstalledPlugin): ScopedStores => {
    const key = `${plugin.key}${plugin.contentHash}`;
    let stores = storesByPlugin.get(key);
    if (stores === undefined) {
      stores = createScopedStores(root, plugin);
      storesByPlugin.set(key, stores);
    }
    return stores;
  };

  return {
    async call(input) {
      const context: CallContext = {
        method: input.method,
        surface: "worker",
        consent: { fingerprint: input.consent.fingerprint },
        granted: input.plugin.manifest.capabilities,
      };

      const decision = gateExtensionCall(context);
      if (!decision.ok) {
        console.warn(
          `Extension call ${input.method} denied: ${decision.reason}`,
        );
        return { ok: false, reason: decision.reason };
      }

      if (!PLUGIN_METHODS.has(input.method as PluginMethod)) {
        return { ok: false, reason: "not-supported" };
      }

      const method = input.method as PluginMethod;
      const stores = storesFor(input.plugin);

      switch (method) {
        case "network.fetch":
          return networkFetch(input.plugin, input.params, options);
        case "storage.get":
        case "storage.set":
        case "storage.remove":
        case "storage.list":
          return storageCall(stores.storage, method, input.params);
        case "secrets.get":
        case "secrets.set":
        case "secrets.remove":
          return secretCall(stores.secrets, method, input.params);
        case "settings.get":
        case "settings.set":
          return settingsCall(stores.settings, method, input.params);
        case "log":
          return logCall(input.params);
        default:
          return { ok: false, reason: "not-supported" };
      }
    },
  };
}
