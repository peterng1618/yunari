import type { DeviceAllowlist } from "@yunari/extension-api";
import { canonicalSerialPath } from "@yunari/extension-api";

/**
 * The host's device broker.
 *
 * **A plugin never holds a native handle.** `open` resolves a declared device,
 * opens it through a backend and returns an opaque token; every later call names
 * that token. The handle, the path and the ids stay here.
 *
 * The broker imports no native module: `createNativeDeviceBackend` in
 * `usb-backend.ts` composes the real backends, so this file's test runs with a
 * fake and never touches a device.
 */

export interface DeviceDescriptor {
  readonly transport: "usb" | "hid" | "serial";
  readonly vendorId: number;
  readonly productId: number;
  readonly path: string;
  readonly serial: string | undefined;
  readonly product: string | undefined;
  readonly interfaceNumber?: number;
}

export interface DeviceHandle {
  open(): Promise<void>;
  bulkTransferOut(endpoint: number, bytes: Uint8Array): Promise<void>;
  controlTransferOut(request: {
    requestType: number;
    request: number;
    value: number;
    index: number;
    bytes: Uint8Array;
  }): Promise<void>;
  interruptTransferIn(endpoint: number, length: number): Promise<Uint8Array>;
  hidWrite(bytes: Uint8Array): Promise<void>;
  hidRead(length: number): Promise<Uint8Array>;
  serialWrite(bytes: Uint8Array): Promise<void>;
  serialRead(timeoutMs: number): Promise<Uint8Array>;
  serialDrain(): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface DeviceBackend {
  list(): Promise<readonly DeviceDescriptor[]>;
  open(device: DeviceDescriptor): Promise<DeviceHandle>;
}

export interface DeviceBroker {
  list(pluginKey: string): Promise<readonly DeviceDescriptor[]>;
  /** `scope` names the runner that asked: every token it opens is closed
   *  together, so one display's failure cannot reach another's device. */
  open(
    pluginKey: string,
    selector: {
      readonly transport: "usb" | "hid" | "serial";
      readonly vendorId: number;
      readonly productId: number;
      readonly path?: string;
      readonly interfaceNumber?: number;
    },
    scope?: string,
  ): Promise<string>;
  call(
    pluginKey: string,
    token: string,
    method: string,
    params: unknown,
  ): Promise<unknown>;
  close(pluginKey: string, token: string): Promise<void>;
  closeAll(pluginKey: string): Promise<void>;
  /** Closes the tokens one runner opened, leaving the plugin's other devices
   *  open. A token with no scope is closed by `closeAll` only. */
  closeScope(pluginKey: string, scope: string): Promise<void>;
}

export interface DeviceBrokerOptions {
  readonly allowlists: (pluginKey: string) => readonly DeviceAllowlist[];
  readonly backend: DeviceBackend;
  readonly maxInFlightPerPlugin?: number;
  readonly maxTransferBytes?: number;
}

type Transport = DeviceDescriptor["transport"];

interface TokenRecord {
  readonly pluginKey: string;
  readonly scope: string | undefined;
  readonly transport: Transport;
  readonly handle: DeviceHandle;
}

type Selector = Parameters<DeviceBroker["open"]>[1];

const DEFAULT_MAX_IN_FLIGHT_PER_PLUGIN = 4;
const DEFAULT_MAX_TRANSFER_BYTES = 1024 * 1024;

/**
 * A slot per plugin. A transfer over the limit waits rather than being dropped,
 * so a plugin that pipelines frames keeps every byte instead of losing one.
 */
class Semaphore {
  private active = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next === undefined) {
      this.active -= 1;
      return;
    }

    // The slot moves to the waiter without passing through `active`.
    next();
  }
}

/** The declared entry this selector asks for, or nothing. */
function isDeclared(entry: DeviceAllowlist, selector: Selector): boolean {
  if (entry.transport === "serial") {
    return (
      selector.transport === "serial" &&
      selector.path !== undefined &&
      canonicalSerialPath(selector.path) === canonicalSerialPath(entry.path)
    );
  }

  if (selector.transport !== entry.transport) return false;
  if (
    selector.vendorId !== entry.vendorId ||
    selector.productId !== entry.productId
  ) {
    return false;
  }

  // The interface is declared and consented, not chosen at open: a selector
  // that names another interface is a different device.
  return selector.interfaceNumber === entry.interfaceNumber;
}

/** Whether an attached descriptor is one this plugin declared. */
function isDeclaredDevice(
  entry: DeviceAllowlist,
  device: DeviceDescriptor,
): boolean {
  if (entry.transport === "serial") {
    return (
      device.transport === "serial" &&
      canonicalSerialPath(device.path) === canonicalSerialPath(entry.path)
    );
  }

  return (
    device.transport === entry.transport &&
    device.vendorId === entry.vendorId &&
    device.productId === entry.productId
  );
}

/** The attached descriptor the selector names, or nothing. */
function findAttached(
  devices: readonly DeviceDescriptor[],
  selector: Selector,
): DeviceDescriptor | undefined {
  return devices.find((device) => {
    if (selector.transport === "serial") {
      return (
        device.transport === "serial" &&
        selector.path !== undefined &&
        canonicalSerialPath(device.path) === canonicalSerialPath(selector.path)
      );
    }

    return (
      device.transport === selector.transport &&
      device.vendorId === selector.vendorId &&
      device.productId === selector.productId &&
      // Two panels can share ids; a supplied path picks the one the plugin
      // means instead of the first the backend enumerated.
      (selector.path === undefined || device.path === selector.path)
    );
  });
}

function parametersOf(params: unknown): Record<string, unknown> {
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    throw new Error("Invalid device parameters.");
  }

  return params as Record<string, unknown>;
}

function integerOf(record: Record<string, unknown>, name: string): number {
  const value = record[name];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid device parameters: ${name}.`);
  }

  return value;
}

function bytesOf(record: Record<string, unknown>): Uint8Array {
  const value = record.bytes;
  if (!(value instanceof Uint8Array)) {
    throw new Error("Invalid device parameters: bytes.");
  }

  return value;
}

interface MethodSpec {
  readonly transport: Transport;
  readonly invoke: (
    handle: DeviceHandle,
    params: Record<string, unknown>,
  ) => Promise<unknown>;
}

const METHODS: Readonly<Record<string, MethodSpec>> = {
  "usb.bulkTransfer": {
    transport: "usb",
    invoke: (handle, params) =>
      handle.bulkTransferOut(integerOf(params, "endpoint"), bytesOf(params)),
  },
  "usb.controlTransfer": {
    transport: "usb",
    invoke: (handle, params) =>
      handle.controlTransferOut({
        requestType: integerOf(params, "requestType"),
        request: integerOf(params, "request"),
        value: integerOf(params, "value"),
        index: integerOf(params, "index"),
        bytes: bytesOf(params),
      }),
  },
  "usb.interruptTransfer": {
    transport: "usb",
    invoke: (handle, params) =>
      handle.interruptTransferIn(
        integerOf(params, "endpoint"),
        integerOf(params, "length"),
      ),
  },
  "hid.write": {
    transport: "hid",
    invoke: (handle, params) => handle.hidWrite(bytesOf(params)),
  },
  "hid.read": {
    transport: "hid",
    invoke: (handle, params) => handle.hidRead(integerOf(params, "length")),
  },
  "serial.write": {
    transport: "serial",
    invoke: (handle, params) => handle.serialWrite(bytesOf(params)),
  },
  "serial.read": {
    transport: "serial",
    invoke: (handle, params) =>
      handle.serialRead(integerOf(params, "timeoutMs")),
  },
  "serial.drain": {
    transport: "serial",
    invoke: (handle) => handle.serialDrain(),
  },
};

export function createDeviceBroker(options: DeviceBrokerOptions): DeviceBroker {
  const { allowlists, backend } = options;
  const maxInFlight =
    options.maxInFlightPerPlugin ?? DEFAULT_MAX_IN_FLIGHT_PER_PLUGIN;
  if (!Number.isInteger(maxInFlight) || maxInFlight < 1) {
    throw new Error("maxInFlightPerPlugin must be a positive integer.");
  }
  const maxTransferBytes =
    options.maxTransferBytes ?? DEFAULT_MAX_TRANSFER_BYTES;
  const tokens = new Map<string, TokenRecord>();
  const semaphores = new Map<string, Semaphore>();

  const semaphoreFor = (pluginKey: string): Semaphore => {
    let semaphore = semaphores.get(pluginKey);
    if (semaphore === undefined) {
      semaphore = new Semaphore(maxInFlight);
      semaphores.set(pluginKey, semaphore);
    }

    return semaphore;
  };

  /** Closes and drops every token matching `match`, leaving the rest open. */
  const closeWhere = async (
    match: (record: TokenRecord) => boolean,
  ): Promise<void> => {
    const closing: Promise<void>[] = [];

    for (const [token, record] of tokens) {
      if (!match(record)) continue;

      tokens.delete(token);
      closing.push(record.handle.close().catch(() => undefined));
    }

    await Promise.all(closing);
  };

  return {
    async list(pluginKey) {
      const declared = allowlists(pluginKey);
      const devices = await backend.list();

      return devices.filter((device) =>
        declared.some((entry) => isDeclaredDevice(entry, device)),
      );
    },

    async open(pluginKey, selector, scope) {
      const declared = allowlists(pluginKey);
      if (!declared.some((entry) => isDeclared(entry, selector))) {
        throw new Error("The device is not declared for this plugin.");
      }

      const device = findAttached(await backend.list(), selector);
      if (device === undefined) {
        throw new Error("The device is not attached.");
      }

      // The selector's interface is the one the plugin consented to; the
      // backend claims it on `open`.
      const target: DeviceDescriptor =
        selector.interfaceNumber === undefined
          ? device
          : { ...device, interfaceNumber: selector.interfaceNumber };

      const handle = await backend.open(target);
      try {
        await handle.open();
      } catch (error) {
        // A claim that failed after the device opened must not leave the
        // native handle open with no token to reach it.
        await handle.close().catch(() => undefined);
        throw error;
      }

      const token = crypto.randomUUID();
      tokens.set(token, {
        pluginKey,
        scope,
        transport: selector.transport,
        handle,
      });

      return token;
    },

    async call(pluginKey, token, method, params) {
      const record = tokens.get(token);
      if (record === undefined) {
        // A token that was never issued and one that has closed are one state
        // to a plugin, and the message names it without naming the device.
        throw new Error("The device is not open.");
      }
      if (record.pluginKey !== pluginKey) {
        throw new Error("The device is not this plugin's.");
      }

      const values = parametersOf(params);
      const bytes = values.bytes;
      if (bytes instanceof Uint8Array && bytes.length > maxTransferBytes) {
        throw new Error("The transfer is too large.");
      }
      const length = values.length;
      if (typeof length === "number" && length > maxTransferBytes) {
        throw new Error("The transfer is too large.");
      }

      const spec = METHODS[method];
      if (spec === undefined) {
        throw new Error("Unknown device method.");
      }
      if (spec.transport !== record.transport) {
        throw new Error("Unsupported device operation.");
      }

      const semaphore = semaphoreFor(pluginKey);
      await semaphore.acquire();

      try {
        return await spec.invoke(record.handle, values);
      } catch (error) {
        // A handle that threw may be wedged or unplugged; it is closed and its
        // token dropped so the next call reports the state rather than reusing
        // it.
        tokens.delete(token);
        await record.handle.close().catch(() => undefined);
        throw error;
      } finally {
        semaphore.release();
      }
    },

    async close(pluginKey, token) {
      const record = tokens.get(token);
      if (record === undefined) {
        throw new Error("The device is not open.");
      }
      if (record.pluginKey !== pluginKey) {
        throw new Error("The device is not this plugin's.");
      }

      tokens.delete(token);
      await record.handle.close();
    },

    async closeAll(pluginKey) {
      await closeWhere((record) => record.pluginKey === pluginKey);
    },

    async closeScope(pluginKey, scope) {
      await closeWhere(
        (record) => record.pluginKey === pluginKey && record.scope === scope,
      );
    },
  };
}
