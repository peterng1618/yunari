import { describe, expect, it } from "vitest";
import type {
  DeviceBackend,
  DeviceDescriptor,
  DeviceHandle,
} from "./device-broker.js";
import { createDeviceBroker } from "./device-broker.js";

const VENDOR_ID = 0x1cbe;
const PRODUCT_ID = 0xa092;
const PLUGIN = "acme/panel";
const MiB = 1024 * 1024;

function declared(): {
  readonly transport: "usb";
  readonly vendorId: number;
  readonly productId: number;
} {
  return { transport: "usb", vendorId: VENDOR_ID, productId: PRODUCT_ID };
}

function declaredSelector(): {
  readonly transport: "usb";
  readonly vendorId: number;
  readonly productId: number;
} {
  return { transport: "usb", vendorId: VENDOR_ID, productId: PRODUCT_ID };
}

function descriptor(): DeviceDescriptor {
  return {
    transport: "usb",
    vendorId: VENDOR_ID,
    productId: PRODUCT_ID,
    path: "1:2",
    serial: undefined,
    product: undefined,
  };
}

class FakeHandle implements DeviceHandle {
  opened = false;
  closed = false;
  readonly transfers: { endpoint: number; bytes: Uint8Array }[] = [];
  /** A transfer waits here before it records itself, when set. */
  gate: Promise<void> | undefined;
  enteredCount = 0;
  onEntered: (() => void) | undefined;
  failWith: Error | undefined;

  async open(): Promise<void> {
    this.opened = true;
  }

  async bulkTransferOut(endpoint: number, bytes: Uint8Array): Promise<void> {
    this.enteredCount += 1;
    this.onEntered?.();
    if (this.gate !== undefined) await this.gate;
    if (this.failWith !== undefined) throw this.failWith;
    this.transfers.push({ endpoint, bytes });
  }

  async controlTransferOut(): Promise<void> {}
  async interruptTransferIn(): Promise<Uint8Array> {
    return new Uint8Array();
  }
  async hidWrite(): Promise<void> {}
  async hidRead(): Promise<Uint8Array> {
    return new Uint8Array();
  }
  async serialWrite(): Promise<void> {}
  async serialRead(): Promise<Uint8Array> {
    return new Uint8Array();
  }
  async serialDrain(): Promise<Uint8Array> {
    return new Uint8Array();
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

function fakeBackend(devices: readonly DeviceDescriptor[] = [descriptor()]): {
  readonly backend: DeviceBackend;
  readonly opened: DeviceDescriptor[];
  readonly handles: FakeHandle[];
  readonly listCalls: () => number;
} {
  const opened: DeviceDescriptor[] = [];
  const handles: FakeHandle[] = [];
  let listCalls = 0;

  return {
    backend: {
      async list() {
        listCalls += 1;
        return devices;
      },
      async open(device) {
        opened.push(device);
        const handle = new FakeHandle();
        handles.push(handle);
        return handle;
      },
    },
    opened,
    handles,
    listCalls: () => listCalls,
  };
}

describe("createDeviceBroker", () => {
  it("refuses an undeclared device before opening", async () => {
    const { backend, opened, listCalls } = fakeBackend();
    const broker = createDeviceBroker({
      allowlists: () => [declared()],
      backend,
    });

    await expect(
      broker.open(PLUGIN, {
        transport: "usb",
        vendorId: VENDOR_ID,
        productId: 0xffff,
      }),
    ).rejects.toThrow("not declared");
    expect(opened).toEqual([]);
    expect(listCalls()).toBe(0);
  });

  it("opens the descriptor whose path the selector names", async () => {
    const { backend, opened } = fakeBackend([
      descriptor(),
      { ...descriptor(), path: "1:3" },
    ]);
    const broker = createDeviceBroker({
      allowlists: () => [declared()],
      backend,
    });

    await broker.open(PLUGIN, { ...declaredSelector(), path: "1:3" });

    expect(opened.map((device) => device.path)).toEqual(["1:3"]);
  });

  it("refuses a non-positive in-flight limit", () => {
    const { backend } = fakeBackend();

    expect(() =>
      createDeviceBroker({
        allowlists: () => [declared()],
        backend,
        maxInFlightPerPlugin: 0,
      }),
    ).toThrow("maxInFlightPerPlugin");
  });

  it("refuses another plugin's token", async () => {
    const { backend } = fakeBackend();
    const broker = createDeviceBroker({
      allowlists: () => [declared()],
      backend,
    });
    const token = await broker.open(PLUGIN, declaredSelector());

    await expect(
      broker.call("other/panel", token, "usb.bulkTransferOut", {
        endpoint: 1,
        bytes: new Uint8Array(),
      }),
    ).rejects.toThrow("not this plugin");
  });

  it("refuses a transfer above the cap", async () => {
    const { backend } = fakeBackend();
    const broker = createDeviceBroker({
      allowlists: () => [declared()],
      backend,
    });
    const token = await broker.open(PLUGIN, declaredSelector());

    await expect(
      broker.call(PLUGIN, token, "usb.bulkTransferOut", {
        endpoint: 1,
        bytes: new Uint8Array(MiB + 1),
      }),
    ).rejects.toThrow("too large");
  });

  it("refuses a declared device that is not attached", async () => {
    const { backend, opened } = fakeBackend([]);
    const broker = createDeviceBroker({
      allowlists: () => [declared()],
      backend,
    });

    await expect(broker.open(PLUGIN, declaredSelector())).rejects.toThrow(
      "not attached",
    );
    expect(opened).toEqual([]);
  });

  it("sends bytes through the handle", async () => {
    const { backend, handles } = fakeBackend();
    const broker = createDeviceBroker({
      allowlists: () => [declared()],
      backend,
    });
    const token = await broker.open(PLUGIN, declaredSelector());
    const bytes = new Uint8Array([1, 2, 3]);

    await expect(
      broker.call(PLUGIN, token, "usb.bulkTransfer", { endpoint: 0x02, bytes }),
    ).resolves.toBeUndefined();
    expect(handles[0]?.transfers).toEqual([{ endpoint: 0x02, bytes }]);
  });

  it("refuses a closed token", async () => {
    const { backend } = fakeBackend();
    const broker = createDeviceBroker({
      allowlists: () => [declared()],
      backend,
    });
    const token = await broker.open(PLUGIN, declaredSelector());

    await broker.close(PLUGIN, token);

    await expect(
      broker.call(PLUGIN, token, "usb.bulkTransfer", {
        endpoint: 1,
        bytes: new Uint8Array(),
      }),
    ).rejects.toThrow("not open");
  });

  it("closes every token for a plugin", async () => {
    const { backend, handles } = fakeBackend([descriptor(), descriptor()]);
    const broker = createDeviceBroker({
      allowlists: () => [declared()],
      backend,
    });
    const first = await broker.open(PLUGIN, declaredSelector());
    const second = await broker.open(PLUGIN, declaredSelector());

    await broker.closeAll(PLUGIN);

    expect(handles.every((handle) => handle.closed)).toBe(true);
    await expect(
      broker.call(PLUGIN, first, "usb.bulkTransfer", {
        endpoint: 1,
        bytes: new Uint8Array(),
      }),
    ).rejects.toThrow("not open");
    await expect(
      broker.call(PLUGIN, second, "usb.bulkTransfer", {
        endpoint: 1,
        bytes: new Uint8Array(),
      }),
    ).rejects.toThrow("not open");
  });

  it("drops a token whose transfer failed", async () => {
    const { backend, handles } = fakeBackend();
    const broker = createDeviceBroker({
      allowlists: () => [declared()],
      backend,
    });
    const token = await broker.open(PLUGIN, declaredSelector());
    const handle = handles[0];
    if (handle === undefined) throw new Error("no handle");
    handle.failWith = new Error("The cable was pulled.");

    await expect(
      broker.call(PLUGIN, token, "usb.bulkTransfer", {
        endpoint: 1,
        bytes: new Uint8Array([1]),
      }),
    ).rejects.toThrow("The cable was pulled.");
    expect(handle.closed).toBe(true);
    await expect(
      broker.call(PLUGIN, token, "usb.bulkTransfer", {
        endpoint: 1,
        bytes: new Uint8Array([1]),
      }),
    ).rejects.toThrow("not open");
  });

  it("admits a waiting transfer when a slot frees", async () => {
    const { backend, handles } = fakeBackend();
    const broker = createDeviceBroker({
      allowlists: () => [declared()],
      backend,
      maxInFlightPerPlugin: 1,
    });
    const token = await broker.open(PLUGIN, declaredSelector());
    const handle = handles[0];
    if (handle === undefined) throw new Error("no handle");

    let release!: () => void;
    handle.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      handle.onEntered = resolve;
    });

    const first = broker.call(PLUGIN, token, "usb.bulkTransfer", {
      endpoint: 1,
      bytes: new Uint8Array([1]),
    });
    await entered;

    const second = broker.call(PLUGIN, token, "usb.bulkTransfer", {
      endpoint: 2,
      bytes: new Uint8Array([2]),
    });
    await Promise.resolve();
    expect(handle.enteredCount).toBe(1);

    release();
    await Promise.all([first, second]);
    expect(handle.enteredCount).toBe(2);
  });
});
