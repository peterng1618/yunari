import HID from "node-hid";
import { usb } from "usb";
import type {
  DeviceBackend,
  DeviceDescriptor,
  DeviceHandle,
} from "./device-broker.js";
import { createSerialBackend } from "./serial-backend.js";

/**
 * The two native USB backends: libusb through `usb`, and HID reports through
 * `node-hid`.
 *
 * **They are separate transports on purpose.** A device whose control channel
 * is HID and whose data channel is bulk (the Kraken Z) is two descriptors and
 * two handles; claiming the HID interface through libusb fails on Windows,
 * where the HID class driver owns it.
 */

const TRANSFER_TIMEOUT_MS = 2_000;
const CONFIGURATION = 1;

/** The package keeps its `UsbDevice` type private, so it is read off the one
 *  call that returns it rather than named a second time. */
type UsbNativeDevice = Awaited<ReturnType<typeof usb.getDevices>>[number];

type ControlRequestType = "standard" | "class" | "vendor";
type ControlRecipient = "device" | "interface" | "endpoint" | "other";

/**
 * The WebUSB string form of a libusb `bmRequestType`.
 *
 * Bits `0x60` are the request type and bits `0x1f` the recipient; a value that
 * does not name one of each is refused rather than guessed.
 */
function requestTypeOf(requestType: number): {
  readonly requestType: ControlRequestType;
  readonly recipient: ControlRecipient;
} {
  if ((requestType & ~0x7f) !== 0) {
    throw new Error("The control transfer request type is not supported.");
  }

  const kind = requestType & 0x60;
  const type =
    kind === 0x40
      ? "vendor"
      : kind === 0x20
        ? "class"
        : kind === 0x00
          ? "standard"
          : undefined;

  const bits = requestType & 0x1f;
  const recipient =
    bits === 0
      ? "device"
      : bits === 1
        ? "interface"
        : bits === 2
          ? "endpoint"
          : bits === 3
            ? "other"
            : undefined;

  if (type === undefined || recipient === undefined) {
    throw new Error("The control transfer request type is not supported.");
  }

  return { requestType: type, recipient };
}

function unsupported(): Promise<never> {
  return Promise.reject(new Error("Unsupported device operation."));
}

/** One libusb handle: bulk, control and interrupt transfers on one interface. */
class UsbHandle implements DeviceHandle {
  private claimed = false;

  constructor(
    private readonly device: UsbNativeDevice,
    private readonly interfaceNumber: number,
  ) {}

  async open(): Promise<void> {
    await this.device.open();
    await this.device.selectConfiguration(CONFIGURATION);
    await this.device.claimInterface(this.interfaceNumber);
    this.claimed = true;
  }

  async bulkTransferOut(endpoint: number, bytes: Uint8Array): Promise<void> {
    await this.device.nativeTransferOut(endpoint, TRANSFER_TIMEOUT_MS, bytes);
  }

  async controlTransferOut(request: {
    requestType: number;
    request: number;
    value: number;
    index: number;
    bytes: Uint8Array;
  }): Promise<void> {
    const { requestType, recipient } = requestTypeOf(request.requestType);

    await this.device.nativeControlTransferOut(
      {
        requestType,
        recipient,
        request: request.request,
        value: request.value,
        index: request.index,
      },
      TRANSFER_TIMEOUT_MS,
      request.bytes,
    );
  }

  async interruptTransferIn(
    endpoint: number,
    length: number,
  ): Promise<Uint8Array> {
    const bytes = await this.device.nativeTransferIn(
      endpoint,
      TRANSFER_TIMEOUT_MS,
      length,
    );

    return bytes ?? new Uint8Array();
  }

  hidWrite(): Promise<void> {
    return unsupported();
  }

  hidRead(): Promise<Uint8Array> {
    return unsupported();
  }

  serialWrite(): Promise<void> {
    return unsupported();
  }

  serialRead(): Promise<Uint8Array> {
    return unsupported();
  }

  serialDrain(): Promise<Uint8Array> {
    return unsupported();
  }

  async close(): Promise<void> {
    if (this.claimed) {
      this.claimed = false;
      try {
        await this.device.releaseInterface(this.interfaceNumber);
      } catch {
        // An unplugged device cannot be released again.
      }
    }

    try {
      await this.device.close();
    } catch {
      // Same.
    }
  }
}

/** One HID handle, opened by the platform path node-hid enumerated. */
class HidHandle implements DeviceHandle {
  private hid: HID.HID | undefined;

  constructor(private readonly path: string) {}

  async open(): Promise<void> {
    this.hid = new HID.HID(this.path);
  }

  async hidWrite(bytes: Uint8Array): Promise<void> {
    this.handle().write(Buffer.from(bytes));
  }

  async hidRead(length: number): Promise<Uint8Array> {
    const report = Uint8Array.from(
      this.handle().readTimeout(TRANSFER_TIMEOUT_MS),
    );

    return report.length > length ? report.slice(0, length) : report;
  }

  bulkTransferOut(): Promise<void> {
    return unsupported();
  }

  controlTransferOut(): Promise<void> {
    return unsupported();
  }

  interruptTransferIn(): Promise<Uint8Array> {
    return unsupported();
  }

  serialWrite(): Promise<void> {
    return unsupported();
  }

  serialRead(): Promise<Uint8Array> {
    return unsupported();
  }

  serialDrain(): Promise<Uint8Array> {
    return unsupported();
  }

  async close(): Promise<void> {
    const hid = this.hid;
    this.hid = undefined;
    hid?.close();
  }

  private handle(): HID.HID {
    if (this.hid === undefined) {
      throw new Error("The HID device is not open.");
    }

    return this.hid;
  }
}

/** A USB address for a descriptor's `path`; the ids, not this, select it. */
function usbPath(device: UsbNativeDevice): string {
  return `${device.bus}:${device.address}`;
}

export function createUsbBackend(): DeviceBackend {
  return {
    async list() {
      const descriptors: DeviceDescriptor[] = [];

      for (const device of await usb.getDevices()) {
        descriptors.push({
          transport: "usb",
          vendorId: device.vendorId,
          productId: device.productId,
          path: usbPath(device),
          serial: device.serialNumber ?? undefined,
          product: device.productName ?? undefined,
        });
      }

      for (const device of HID.devices()) {
        if (device.path === undefined) continue;

        descriptors.push({
          transport: "hid",
          vendorId: device.vendorId,
          productId: device.productId,
          path: device.path,
          serial: device.serialNumber,
          product: device.product,
        });
      }

      return descriptors;
    },

    async open(device) {
      if (device.transport === "hid") {
        const candidates = HID.devices().filter(
          (candidate) =>
            candidate.vendorId === device.vendorId &&
            candidate.productId === device.productId &&
            candidate.path !== undefined,
        );
        // The descriptor's path is the device the broker resolved; ids alone
        // collide when two identical panels are attached.
        const found =
          candidates.find((candidate) => candidate.path === device.path) ??
          candidates[0];
        if (found?.path === undefined) {
          throw new Error("The device is not attached.");
        }

        return new HidHandle(found.path);
      }

      if (device.transport === "usb") {
        const candidates = (await usb.getDevices()).filter(
          (candidate) =>
            candidate.vendorId === device.vendorId &&
            candidate.productId === device.productId,
        );
        const found =
          candidates.find((candidate) => usbPath(candidate) === device.path) ??
          candidates[0];
        if (found === undefined) {
          throw new Error("The device is not attached.");
        }

        return new UsbHandle(found, device.interfaceNumber ?? 0);
      }

      throw new Error("Unsupported device operation.");
    },
  };
}

/** USB, HID and serial behind one backend, for the host's composition root. */
export function createNativeDeviceBackend(): DeviceBackend {
  const usbBackend = createUsbBackend();
  const serialBackend = createSerialBackend();

  return {
    async list() {
      return [...(await usbBackend.list()), ...(await serialBackend.list())];
    },

    async open(device) {
      return device.transport === "serial"
        ? serialBackend.open(device)
        : usbBackend.open(device);
    },
  };
}
