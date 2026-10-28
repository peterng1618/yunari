import type { PanelDevice, PanelFamily, PanelHint } from "./panel-device.js";
import { decodeStill, type RawFrame } from "./panel-image.js";
import {
  listSerialPorts,
  openSerialPort,
  type SerialPortInfo,
  type SerialTransport,
} from "./serial-transport.js";
import {
  bgraPayload,
  frame,
  parseHello,
  TURZX_COMMAND,
  TURZX_GEOMETRY,
  type TurzxIdentity,
} from "./turzx-protocol.js";

/**
 * The TURZX 5" serial panel: a USB CDC gadget that takes a full BGRA frame per
 * update, not a JPEG stream.
 *
 * Discovery has to ask the device, not the USB ids: `1D6B:0106` is a generic
 * gadget pair, so HELLO is what distinguishes a panel from any other serial
 * gadget running the same firmware family. The bytes themselves are
 * `turzx-protocol.ts`; this file owns the port and the queue.
 */

const LABEL = 'TURZX 5" Panel';
/** Long enough for a 23-byte HELLO reply at 115200, short enough to probe many. */
const PROBE_TIMEOUT_MS = 500;

export interface TurzxOptions {
  readonly ports?: () => Promise<readonly SerialPortInfo[]>;
  readonly open?: (path: string) => Promise<SerialTransport>;
  readonly decode?: (
    bytes: Uint8Array,
    width: number,
    height: number,
  ) => Promise<RawFrame>;
  /** The settle interval a later video overlay waits out. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** A port whose listing carries the ids the family row claims. */
function hasIds(
  port: SerialPortInfo,
): port is SerialPortInfo & { vendorId: number; productId: number } {
  return port.vendorId !== undefined && port.productId !== undefined;
}

/** Writes HELLO and reads its answer; anything but a panel's reply is `undefined`. */
async function identify(
  transport: SerialTransport,
): Promise<TurzxIdentity | undefined> {
  await transport.write(frame(TURZX_COMMAND.hello));

  return parseHello(await transport.read(PROBE_TIMEOUT_MS));
}

async function quietlyClose(transport: SerialTransport): Promise<void> {
  try {
    await transport.close();
  } catch {
    // A port that went away on its own cannot be closed again, and that is
    // the unplug the caller already knows about.
  }
}

/**
 * Every attached panel, one hint each.
 *
 * A port with no USB ids is invisible to a record, so it is not opened. A port
 * another program holds fails to open and is skipped here; `openTurzxPanel`
 * turns that same failure into the sentence an owner can act on.
 */
export async function attachedTurzxPanels(
  options: TurzxOptions = {},
): Promise<readonly PanelHint[]> {
  const ports = await (options.ports ?? listSerialPorts)();
  const open = options.open ?? openSerialPort;
  const hints: PanelHint[] = [];

  for (const port of ports) {
    if (!hasIds(port)) continue;

    let transport: SerialTransport;
    try {
      transport = await open(port.path);
    } catch {
      continue;
    }

    try {
      const identity = await identify(transport);
      if (identity === undefined) continue;

      hints.push({
        vendorId: port.vendorId,
        productId: port.productId,
        serial: port.serialNumber ?? "",
        label: LABEL,
        model: identity.model,
        firmware: identity.firmware,
      });
    } catch {
      // A read that failed mid-probe is a port that did not answer HELLO.
    } finally {
      await quietlyClose(transport);
    }
  }

  return hints;
}

/**
 * The device behind one already-open port.
 *
 * Every write goes through one promise chain: a frame is four writes that must
 * stay together, and a control command that slipped between them would land in
 * the middle of the panel's bitmap state. A query is never appended after a
 * frame — a query between updates stopped rendering during probing.
 */
class TurzxPanel implements PanelDevice {
  readonly geometry = {
    width: TURZX_GEOMETRY.width,
    height: TURZX_GEOMETRY.height,
  };

  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly transport: SerialTransport,
    private readonly decode: NonNullable<TurzxOptions["decode"]>,
  ) {}

  /** Already opened by `openTurzxPanel`, which is the family's `open`. */
  async open(): Promise<void> {}

  async present(jpeg: Uint8Array): Promise<void> {
    await this.enqueue(async () => {
      const raw = await this.decode(
        jpeg,
        this.geometry.width,
        this.geometry.height,
      );

      await this.send(TURZX_COMMAND.preUpdate);
      await this.send(TURZX_COMMAND.startBitmap);
      await this.send(TURZX_COMMAND.displayBitmap);
      await this.send(bgraPayload(raw.rgba));
    });
  }

  async close(): Promise<void> {
    await this.transport.close();
  }

  private send(bytes: Uint8Array): Promise<void> {
    return this.transport.write(frame(bytes));
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);

    this.queue = next.then(
      () => undefined,
      () => undefined,
    );

    return next;
  }
}

/**
 * The first attached panel whose HELLO parses, with its video and media stopped.
 *
 * Refused with a sentence rather than a bare failure, because "not plugged in"
 * and "another program holds it" are the two failures an owner meets and they
 * need different answers. The usual holder is the TURZX vendor application.
 */
export async function openTurzxPanel(
  options: TurzxOptions = {},
): Promise<PanelDevice> {
  const ports = await (options.ports ?? listSerialPorts)();
  const open = options.open ?? openSerialPort;
  const decode =
    options.decode ??
    ((bytes: Uint8Array, width: number, height: number) =>
      decodeStill(bytes, width, height));

  const candidates = ports.filter(hasIds);

  if (candidates.length === 0) throw notAttached();

  let held: string | undefined;

  for (const port of candidates) {
    let transport: SerialTransport;
    try {
      transport = await open(port.path);
    } catch (error) {
      held = error instanceof Error ? error.message : String(error);
      continue;
    }

    let identity: TurzxIdentity | undefined;
    try {
      identity = await identify(transport);
    } catch {
      identity = undefined;
    }

    if (identity === undefined) {
      await quietlyClose(transport);
      continue;
    }

    try {
      await transport.write(frame(TURZX_COMMAND.stopVideo));
      await transport.write(frame(TURZX_COMMAND.stopMedia));
      await transport.write(frame(TURZX_COMMAND.queryStatus));
    } catch (error) {
      await quietlyClose(transport);
      throw new Error(
        `${LABEL} answered HELLO but could not be prepared: ${
          error instanceof Error ? error.message : String(error)
        }.`,
      );
    }

    return new TurzxPanel(transport, decode);
  }

  if (held !== undefined) {
    throw new Error(
      `${LABEL} could not be opened: ${held}. Another program holding it — the ` +
        "TURZX vendor app is the usual one — has to be closed first.",
    );
  }

  throw notAttached();
}

function notAttached(): Error {
  return new Error(`${LABEL} is not attached. Check the panel's USB cable.`);
}

/**
 * The registry row. The adapter owns the model, support and command list, so a
 * second TURZX board is an edit here rather than in the central table.
 */
export const TURZX_FAMILIES: readonly PanelFamily[] = [
  {
    id: "turzx-5",
    label: LABEL,
    vendorId: 0x1d6b,
    productId: 0x0106,
    stores: false,
    commands: ["brightness", "screen", "restart", "status", "hello"],
    support: {
      maker: "TURZX",
      hardwareRevision: "Rev C",
      supportedFirmware: ["1.88"],
      updatedAt: "2026-10-29",
    },
    attached: () => attachedTurzxPanels(),
    open: () => openTurzxPanel(),
  },
];
