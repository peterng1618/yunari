import type { Capability } from "./capabilities";

export type ExtensionSurface = "worker" | "frame";

export interface ReadResult<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly reason?: string;
}

export interface HostApiMethod {
  readonly capability: Capability | null;
  readonly surfaces: readonly ExtensionSurface[];
  readonly scope: "plugin" | "device";
  readonly since: string;
  readonly readParams: (value: unknown) => ReadResult<unknown>;
  readonly readResult: (value: unknown) => ReadResult<unknown>;
}

/** The Plan 2 table, closed. A new method is added here and, where a key
 *  schema exists, at its handler; the gate refuses anything absent. */
export type HostApiMethodName =
  | "init"
  | "describe"
  | "sample"
  | "health"
  | "stop"
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
  | "log"
  | "usb.open"
  | "usb.close"
  | "usb.bulkTransfer"
  | "usb.controlTransfer"
  | "usb.interruptTransfer"
  | "hid.read"
  | "hid.write"
  | "serial.read"
  | "serial.write"
  | "serial.drain";

/** Plain means an object literal or a null-prototype bag; a Date, Map, Set or
 *  class instance is not JSON params and is refused. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Params are absent or one plain JSON object. Key-level schemas land with each
 *  method's implementation (Plan 4/5), not in this shared reader. */
function readParams(value: unknown): ReadResult<unknown> {
  if (value === undefined) return { ok: true };
  if (!isRecord(value))
    return { ok: false, reason: "Host API params must be an object." };
  return { ok: true, value };
}

/** Results are any JSON value; `describe` and `sample` return arrays. */
function readResult(value: unknown): ReadResult<unknown> {
  return value === undefined ? { ok: true } : { ok: true, value };
}

function method(
  capability: Capability | null,
  surfaces: readonly ExtensionSurface[],
): HostApiMethod {
  return {
    capability,
    surfaces,
    scope: "plugin",
    since: "0.1.0",
    readParams,
    readResult,
  };
}

const WORKER: readonly ExtensionSurface[] = ["worker"];

/** A device method reaches hardware through the host's broker, so its scope is
 *  the device the plugin opened rather than the plugin's own data. */
function deviceMethod(capability: Capability): HostApiMethod {
  return { ...method(capability, WORKER), scope: "device" };
}

export const HOST_API_METHODS: Readonly<
  Record<HostApiMethodName, HostApiMethod>
> = {
  init: method(null, WORKER),
  describe: method("sensor:provide", WORKER),
  sample: method("sensor:provide", WORKER),
  health: method("sensor:provide", WORKER),
  stop: method(null, WORKER),
  "network.fetch": method("network:fetch", WORKER),
  "storage.get": method("storage:own", WORKER),
  "storage.set": method("storage:own", WORKER),
  "storage.remove": method("storage:own", WORKER),
  "storage.list": method("storage:own", WORKER),
  "secrets.get": method("secrets:own", WORKER),
  "secrets.set": method("secrets:own", WORKER),
  "secrets.remove": method("secrets:own", WORKER),
  "settings.get": method("settings:own", WORKER),
  "settings.set": method("settings:own", WORKER),
  log: method(null, ["worker", "frame"]),
  "usb.open": deviceMethod("usb:device"),
  "usb.close": deviceMethod("usb:device"),
  "usb.bulkTransfer": deviceMethod("usb:device"),
  "usb.controlTransfer": deviceMethod("usb:device"),
  "usb.interruptTransfer": deviceMethod("usb:device"),
  "hid.read": deviceMethod("usb:device"),
  "hid.write": deviceMethod("usb:device"),
  "serial.read": deviceMethod("serial:device"),
  "serial.write": deviceMethod("serial:device"),
  "serial.drain": deviceMethod("serial:device"),
};

export function hostApiMethod(name: string): HostApiMethod | undefined {
  if (!Object.hasOwn(HOST_API_METHODS, name)) return undefined;
  return HOST_API_METHODS[name as HostApiMethodName];
}
