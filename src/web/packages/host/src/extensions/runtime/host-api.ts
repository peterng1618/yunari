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
  dnsLookup,
  guardedFetch,
  type HostLookup,
} from "../../providers/custom/fetch-source.js";
import { createPinnedFetch } from "../../providers/custom/pinned-fetch.js";
import {
  createScopedStores,
  isStorageKey,
  MAX_SETTINGS_BYTES,
  MAX_STORAGE_VALUE_BYTES,
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
const HOST_ERROR = "host-error";
const LOG_LIMIT = 2_048;
const NETWORK_BODY_BYTES = 1024 * 1024;
const CALL_TIMEOUT_MS = 30_000;
const TIMEOUT_ANSWER = { ok: false, reason: "timeout" };
const LOG_LEVELS: ReadonlySet<string> = new Set(["info", "warn", "error"]);

/** A value the plugin supplied is malformed. Only this class maps to
 *  `invalid-params`; every other throw is a host fault. */
class InvalidParamsError extends Error {}

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

function requireKey(key: string | undefined): string {
  if (key === undefined || !isStorageKey(key)) {
    throw new InvalidParamsError(`"${key ?? ""}" is not a storage key`);
  }
  return key;
}

function requireValue(value: string | undefined): string {
  if (value === undefined) {
    throw new InvalidParamsError("a value is required");
  }
  if (Buffer.byteLength(value, "utf8") > MAX_STORAGE_VALUE_BYTES) {
    throw new InvalidParamsError("a value is at most 1 MiB");
  }
  return value;
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
    try {
      // A header name or value `Headers` refuses is the plugin's param error,
      // not a host failure; surface it as one before any request is built.
      new Headers(entries as [string, string][]);
    } catch {
      throw new InvalidParamsError("a header name or value is invalid");
    }
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

  // The checked address must be the connected address: a plain global fetch
  // would resolve again at connect time, so the plugin path always pins.
  const fetchImpl =
    options.fetchImpl ??
    createPinnedFetch({ lookup: options.resolve ?? dnsLookup });

  return guardedFetch({
    url,
    allowedHosts: plugin.manifest.networkHosts ?? [],
    maxBytes: NETWORK_BODY_BYTES,
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    fetchImpl,
    ...(method === undefined ? {} : { method }),
    ...(body === undefined ? {} : { body }),
    ...(headers === undefined ? {} : { headers }),
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
      const key = requireKey(stringOf(read.value, "key"));
      return (await scope.get(key)) ?? null;
    }
    case "storage.set": {
      const read = strictParams(params, ["key", "value"], ["key", "value"]);
      if (!read.ok) return read;
      const key = requireKey(stringOf(read.value, "key"));
      const value = requireValue(stringOf(read.value, "value"));
      await scope.set(key, value);
      return null;
    }
    case "storage.remove": {
      const read = strictParams(params, ["key"], ["key"]);
      if (!read.ok) return read;
      const key = requireKey(stringOf(read.value, "key"));
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
      const key = requireKey(stringOf(read.value, "key"));
      return (await scope.get(key)) ?? null;
    }
    case "secrets.set": {
      const read = strictParams(params, ["key", "value"], ["key", "value"]);
      if (!read.ok) return read;
      const key = requireKey(stringOf(read.value, "key"));
      const value = requireValue(stringOf(read.value, "value"));
      await scope.set(key, value);
      return null;
    }
    case "secrets.remove": {
      const read = strictParams(params, ["key"], ["key"]);
      if (!read.ok) return read;
      const key = requireKey(stringOf(read.value, "key"));
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
      if (
        Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_SETTINGS_BYTES
      ) {
        throw new InvalidParamsError("settings are at most 64 KiB");
      }
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

function dispatchCall(
  input: HostApiCall,
  stores: ScopedStores,
  options: HostApiOptions,
): Promise<unknown> {
  switch (input.method as PluginMethod) {
    case "network.fetch":
      return networkFetch(input.plugin, input.params, options);
    case "storage.get":
    case "storage.set":
    case "storage.remove":
    case "storage.list":
      return storageCall(
        stores.storage,
        input.method as PluginMethod,
        input.params,
      );
    case "secrets.get":
    case "secrets.set":
    case "secrets.remove":
      return secretCall(
        stores.secrets,
        input.method as PluginMethod,
        input.params,
      );
    case "settings.get":
    case "settings.set":
      return settingsCall(
        stores.settings,
        input.method as PluginMethod,
        input.params,
      );
    case "log":
      return Promise.resolve(logCall(input.params));
    default:
      return Promise.resolve({ ok: false, reason: "not-supported" });
  }
}

/** A plugin cannot hold a host call open for ever. The inner request carries
 *  the same deadline, so a stalled socket is aborted rather than orphaned. */
function withDeadline(work: Promise<unknown>): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<unknown>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT_ANSWER), CALL_TIMEOUT_MS);
    (timer as { unref?: () => void }).unref?.();
  });
  return Promise.race([work, deadline]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

export function createHostApiDispatcher(
  options: HostApiOptions,
): HostApiDispatcher {
  const root = path.join(options.settingsDir, "extensions");
  /** One store object per installed content: the data tree stays
   *  `<publisher>/<id>`, but an update gets a fresh object so no stale one
   *  serves the previous version. */
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

      try {
        const stores = storesFor(input.plugin);
        return await withDeadline(dispatchCall(input, stores, options));
      } catch (error) {
        if (error instanceof InvalidParamsError) {
          return { ok: false, reason: INVALID };
        }
        // A genuine host fault is logged by method, never by parameter, and is
        // not mislabelled as the plugin's mistake.
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Extension call ${input.method} failed: ${message}`);
        return { ok: false, reason: HOST_ERROR };
      }
    },
  };
}
