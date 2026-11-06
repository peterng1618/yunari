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
  type HostLookup,
} from "../../providers/custom/fetch-source.js";
import { createPinnedFetch } from "../../providers/custom/pinned-fetch.js";
import type { DeviceBroker } from "./device-broker.js";
import { guardedFetch } from "./network.js";
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
  /** Present when hardware plugins may reach a device. Absent means every
   *  device method answers `not-supported`. */
  readonly broker?: DeviceBroker;
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

const DEVICE_TRANSPORTS: ReadonlySet<string> = new Set([
  "usb",
  "hid",
  "serial",
]);

/** A device id is a whole number in the wire's own range. */
function integerParam(params: Params, key: string, max: number): number {
  const value = params[key];
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > max
  ) {
    throw new InvalidParamsError(
      `"${key}" must be a whole number between 0 and ${max}`,
    );
  }
  return value;
}

function bytesParam(params: Params): Uint8Array {
  const value = params["bytes"];
  if (!(value instanceof Uint8Array)) {
    throw new InvalidParamsError('"bytes" must be a Uint8Array');
  }
  return value;
}

function tokenParam(params: Params): string {
  const value = params["token"];
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidParamsError('"token" must be a non-empty string');
  }
  return value;
}

/** The method-specific half of a transfer call, excluding its token. */
interface TransferSpec {
  readonly keys: readonly string[];
  readonly read: (params: Params) => void;
}

const TRANSFER_CALLS: Readonly<Record<string, TransferSpec>> = {
  "usb.bulkTransfer": {
    keys: ["endpoint", "bytes"],
    read: (params) => {
      integerParam(params, "endpoint", 0xff);
      bytesParam(params);
    },
  },
  "usb.controlTransfer": {
    keys: ["requestType", "request", "value", "index", "bytes"],
    read: (params) => {
      integerParam(params, "requestType", 0xff);
      integerParam(params, "request", 0xff);
      integerParam(params, "value", 0xffff);
      integerParam(params, "index", 0xffff);
      bytesParam(params);
    },
  },
  "usb.interruptTransfer": {
    keys: ["endpoint", "length"],
    read: (params) => {
      integerParam(params, "endpoint", 0xff);
      integerParam(params, "length", 0xffff);
    },
  },
  "hid.write": { keys: ["bytes"], read: bytesParam },
  "hid.read": {
    keys: ["length"],
    read: (params) => {
      integerParam(params, "length", 0xffff);
    },
  },
  "serial.write": { keys: ["bytes"], read: bytesParam },
  "serial.read": {
    keys: ["timeoutMs"],
    read: (params) => {
      integerParam(params, "timeoutMs", 0x7fffffff);
    },
  },
  "serial.drain": { keys: [], read: () => undefined },
};

/** Every device call reaches the broker; the broker's refusal is the plugin's
 *  mistake, so it comes back as a reasoned value rather than a host fault. */
async function deviceCall(
  input: HostApiCall,
  broker: DeviceBroker | undefined,
): Promise<unknown> {
  if (broker === undefined) return { ok: false, reason: "not-supported" };

  try {
    if (input.method === "usb.open") {
      const read = strictParams(
        input.params,
        ["transport", "vendorId", "productId", "path", "interfaceNumber"],
        ["transport", "vendorId", "productId"],
      );
      if (!read.ok) return read;

      const transport = read.value["transport"];
      if (typeof transport !== "string" || !DEVICE_TRANSPORTS.has(transport)) {
        throw new InvalidParamsError('"transport" must be usb, hid or serial');
      }
      const vendorId = integerParam(read.value, "vendorId", 0xffff);
      const productId = integerParam(read.value, "productId", 0xffff);
      const path = read.value["path"];
      if (path !== undefined && typeof path !== "string") {
        throw new InvalidParamsError('"path" must be a string');
      }
      if (transport === "serial" && path === undefined) {
        throw new InvalidParamsError('a serial device needs a "path"');
      }
      const interfaceNumber =
        read.value["interfaceNumber"] === undefined
          ? undefined
          : integerParam(read.value, "interfaceNumber", 0xff);

      return await broker.open(input.plugin.key, {
        transport: transport as "usb" | "hid" | "serial",
        vendorId,
        productId,
        ...(path === undefined ? {} : { path }),
        ...(interfaceNumber === undefined ? {} : { interfaceNumber }),
      });
    }

    if (input.method === "usb.close") {
      const read = strictParams(input.params, ["token"], ["token"]);
      if (!read.ok) return read;
      await broker.close(input.plugin.key, tokenParam(read.value));
      return null;
    }

    const spec = TRANSFER_CALLS[input.method];
    if (spec === undefined) return { ok: false, reason: "not-supported" };

    const read = strictParams(
      input.params,
      ["token", ...spec.keys],
      ["token", ...spec.keys],
    );
    if (!read.ok) return read;

    const token = tokenParam(read.value);
    spec.read(read.value);
    return await broker.call(input.plugin.key, token, input.method, read.value);
  } catch (error) {
    if (error instanceof InvalidParamsError) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, reason };
  }
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
    case "usb.open":
    case "usb.close":
    case "usb.bulkTransfer":
    case "usb.controlTransfer":
    case "usb.interruptTransfer":
    case "hid.read":
    case "hid.write":
    case "serial.read":
    case "serial.write":
    case "serial.drain":
      return deviceCall(input, options.broker);
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
