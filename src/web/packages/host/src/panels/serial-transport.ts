import { SerialPort } from "serialport";

/**
 * The serial seam the TURZX adapter is written against.
 *
 * **The dependency stops here.** `serialport` is a native module, and the one
 * thing above this file that needs it is a driver whose bytes are unit-tested
 * with a fake; importing the binding anywhere else would make the adapter's
 * tests need a COM port. Everything above reads this interface.
 */

export interface SerialPortInfo {
  readonly path: string;
  readonly vendorId?: number;
  readonly productId?: number;
  readonly serialNumber?: string;
}

export interface SerialTransport {
  write(bytes: Uint8Array): Promise<void>;
  read(timeoutMs: number): Promise<Uint8Array>;
  close(): Promise<void>;
}

/** The panel is a USB CDC gadget; the baud is nominal, but RTS/CTS is not. */
const BAUD_RATE = 115_200;

/**
 * A hex USB id, or `null` when the string is present but not a number.
 *
 * The distinction matters: an absent id is a port that reports none (skipped by
 * the adapter), while a malformed one is a listing this host cannot trust.
 */
function parseId(raw: string | undefined): number | null | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;

  const value = Number.parseInt(raw.trim(), 16);
  return Number.isNaN(value) ? null : value;
}

/** Every serial port this host can see, dropping listings with broken ids. */
export async function listSerialPorts(): Promise<readonly SerialPortInfo[]> {
  const ports: SerialPortInfo[] = [];

  for (const port of await SerialPort.list()) {
    const vendorId = parseId(port.vendorId);
    const productId = parseId(port.productId);
    if (vendorId === null || productId === null) continue;

    ports.push({
      path: port.path,
      ...(vendorId === undefined ? {} : { vendorId }),
      ...(productId === undefined ? {} : { productId }),
      ...(port.serialNumber === undefined
        ? {}
        : { serialNumber: port.serialNumber }),
    });
  }

  return ports;
}

/**
 * One open port, with the two shapes the adapter needs.
 *
 * A write resolves after `drain` rather than after `write`: `write` only hands
 * the bytes to the OS, and a panel ignores a frame that arrives half-sent.
 * A read settles at the timeout with whatever arrived — a device that stays
 * quiet is the normal case for a command, not an error.
 */
class OpenSerialPort implements SerialTransport {
  constructor(private readonly port: SerialPort) {
    // A port that disconnects emits `error`; without a listener Node throws.
    // The disconnect still surfaces through the next write or an empty read.
    this.port.on("error", () => {});
  }

  write(bytes: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      this.port.write(Buffer.from(bytes), (error) => {
        if (error !== null && error !== undefined) {
          reject(error);
          return;
        }

        this.port.drain((drainError) => {
          if (drainError !== null && drainError !== undefined) {
            reject(drainError);
            return;
          }

          resolve();
        });
      });
    });
  }

  read(timeoutMs: number): Promise<Uint8Array> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      const finish = () => {
        clearTimeout(timer);
        this.port.off("data", collect);
        this.port.off("error", finish);
        resolve(Uint8Array.from(Buffer.concat(chunks)));
      };
      const collect = (chunk: Buffer) => {
        chunks.push(chunk);
      };
      const timer = setTimeout(finish, timeoutMs);

      this.port.on("data", collect);
      this.port.on("error", finish);
    });
  }

  async close(): Promise<void> {
    if (!this.port.isOpen) return;

    await new Promise<void>((resolve) => {
      this.port.close(() => resolve());
    });
  }
}

/** Opens one serial port for the panel's adapter. */
export function openSerialPort(path: string): Promise<SerialTransport> {
  return new Promise((resolve, reject) => {
    let port: SerialPort;

    try {
      port = new SerialPort({
        path,
        baudRate: BAUD_RATE,
        rtscts: true,
        autoOpen: false,
      });
    } catch (error) {
      reject(error);
      return;
    }

    port.open((error) => {
      if (error !== null && error !== undefined) {
        reject(error);
        return;
      }

      resolve(new OpenSerialPort(port));
    });
  });
}
