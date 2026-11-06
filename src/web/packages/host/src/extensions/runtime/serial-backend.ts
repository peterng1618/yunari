import { canonicalSerialPath } from "@yunari/extension-api";
import type { SerialTransport } from "../../panels/serial-transport.js";
import {
  listSerialPorts,
  openSerialPort,
} from "../../panels/serial-transport.js";
import type {
  DeviceBackend,
  DeviceDescriptor,
  DeviceHandle,
} from "./device-broker.js";

/**
 * The serial backend, over the host's existing serial seam.
 *
 * **Serial is addressed by path, not by ids.** A port that reports no ids is
 * still the device the user consented to, so the descriptor carries zero for
 * both and `open` matches the path alone.
 */

function unsupported(): Promise<never> {
  return Promise.reject(new Error("Unsupported device operation."));
}

class SerialHandle implements DeviceHandle {
  private transport: SerialTransport | undefined;

  constructor(private readonly path: string) {}

  async open(): Promise<void> {
    this.transport = await openSerialPort(this.path);
  }

  async serialWrite(bytes: Uint8Array): Promise<void> {
    await this.port().write(bytes);
  }

  async serialRead(timeoutMs: number): Promise<Uint8Array> {
    return this.port().read(timeoutMs);
  }

  async serialDrain(): Promise<Uint8Array> {
    return this.port().drainPending();
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

  hidWrite(): Promise<void> {
    return unsupported();
  }

  hidRead(): Promise<Uint8Array> {
    return unsupported();
  }

  async close(): Promise<void> {
    const transport = this.transport;
    this.transport = undefined;
    if (transport !== undefined) await transport.close();
  }

  private port(): SerialTransport {
    if (this.transport === undefined) {
      throw new Error("The serial port is not open.");
    }

    return this.transport;
  }
}

export function createSerialBackend(): DeviceBackend {
  return {
    async list() {
      const descriptors: DeviceDescriptor[] = [];

      for (const port of await listSerialPorts()) {
        descriptors.push({
          transport: "serial",
          // Zero means the port reports no id; the path is its address.
          vendorId: port.vendorId ?? 0,
          productId: port.productId ?? 0,
          path: canonicalSerialPath(port.path),
          serial: port.serialNumber,
          product: undefined,
        });
      }

      return descriptors;
    },

    async open(device) {
      return new SerialHandle(canonicalSerialPath(device.path));
    },
  };
}
