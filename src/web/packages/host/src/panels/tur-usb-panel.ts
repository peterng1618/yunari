import { usb } from "usb";
import type { PanelDevice, PanelHint } from "./panel-device.js";
import { commandPacket, type PanelCommand } from "./panel-protocol.js";

/**
 * A Lian Li / TUR family USB panel: bulk endpoints `0x01` out and `0x81` in,
 * one vendor interface, 512-byte frames.
 *
 * The 9.2" is the model this was written against and the only one measured;
 * the others in the table carry the same protocol, from the same three
 * independent drivers, and are listed so a second owner is a table row.
 */

/** One interface, vendor-specific, no alternate settings. */
const INTERFACE = 0;
const CONFIGURATION = 1;
const ENDPOINT = 1;
const READ_TIMEOUT_MS = 2_000;
/** A frame push usually renders without a readable ack, so the read is short. */
const ACK_TIMEOUT_MS = 250;
/** The device refuses a payload past this; measured in both drivers. */
const MAX_PAYLOAD = 512_000;

interface PanelShape {
  readonly id: string;
  readonly label: string;
  readonly vendorId: number;
  readonly productId: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The panel models this host can drive.
 *
 * **464×1920 portrait for the 9.2"**, not the 1920×462 the product page names:
 * the strip is landscape when mounted and the wire is its 90° rotation. Two
 * hardware-tested drivers agree; `lian-li-linux` marks this one tested.
 */
export const PANEL_MODELS: readonly PanelShape[] = [
  {
    id: "lianli-9-2",
    label: 'Lian Li 9.2" LCD',
    vendorId: 0x1cbe,
    productId: 0xa092,
    width: 464,
    height: 1920,
  },
  {
    id: "lianli-8-8",
    label: 'Lian Li Universal Screen 8.8"',
    vendorId: 0x1cbe,
    productId: 0xa088,
    width: 480,
    height: 1920,
  },
];

export function panelModelFor(
  vendorId: number,
  productId: number,
): PanelShape | undefined {
  return PANEL_MODELS.find(
    (model) => model.vendorId === vendorId && model.productId === productId,
  );
}

/** The panels attached right now, as hints a record can hold. */
export async function attachedPanels(): Promise<
  readonly (PanelHint & { readonly label: string })[]
> {
  const found: (PanelHint & { label: string })[] = [];

  for (const device of await usb.getDevices()) {
    const model = panelModelFor(device.vendorId, device.productId);
    if (model === undefined) continue;

    found.push({
      vendorId: device.vendorId,
      productId: device.productId,
      serial: device.serialNumber ?? "",
      label: model.label,
    });
  }

  return found;
}

/**
 * Only the members this driver uses. The library's own `UsbDevice` is declared
 * but not exported, so naming it here would be a second owner of a type the
 * package keeps private — and a structural subset is exactly what a panel
 * driver may rely on.
 */
type PanelUsbDevice = Awaited<ReturnType<typeof usb.findDeviceByIds>> & object;

class TurUsbPanel implements PanelDevice {
  readonly geometry: { readonly width: number; readonly height: number };
  private readonly device: PanelUsbDevice;
  private readonly started = Date.now() - 86_400_000;
  private opened = false;

  constructor(device: PanelUsbDevice, model: PanelShape) {
    this.device = device;
    this.geometry = { width: model.width, height: model.height };
  }

  async open(): Promise<void> {
    const device = this.device;

    await device.open();
    await device.selectConfiguration(CONFIGURATION);
    await device.claimInterface(INTERFACE);
    this.opened = true;

    // The sync exchange is what tells a panel it has a host. Every driver sends
    // it first, and a frame without it is ignored by some firmware.
    await this.request("version", READ_TIMEOUT_MS);
    await this.request("frame-rate", READ_TIMEOUT_MS, { parameter: 30 });
  }

  async present(jpeg: Uint8Array): Promise<void> {
    if (!this.opened) throw new Error("The panel is not open.");
    if (jpeg.length > MAX_PAYLOAD) {
      throw new Error(
        `A ${jpeg.length}-byte frame exceeds the panel's ${MAX_PAYLOAD}-byte limit.`,
      );
    }

    const write = commandPacket(
      "push-jpeg",
      this.elapsed(),
      {
        payloadLength: jpeg.length,
      },
      jpeg,
    );

    await this.device.nativeTransferOut(ENDPOINT, READ_TIMEOUT_MS, write);

    // Flow control: byte 8 of the ack is the device's buffer level. A push that
    // arrives faster than the panel drains fills it, and a full buffer is a
    // frame dropped or a panel that stops answering. A frame commonly renders
    // with no readable ack, so a timeout here is normal rather than an error.
    const ack = await this.read(ACK_TIMEOUT_MS);
    if (ack !== undefined && ack[8] !== undefined && ack[8] > 3) {
      await this.drain();
    }
  }

  private async drain(): Promise<void> {
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      const ack = await this.request("buffer-level", ACK_TIMEOUT_MS);
      if (ack === undefined || ack[8] === undefined || ack[8] <= 2) return;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  }

  private elapsed(): number {
    return Date.now() - this.started;
  }

  private async request(
    command: PanelCommand,
    timeoutMs: number,
    fields: { readonly parameter?: number } = {},
  ): Promise<Uint8Array | undefined> {
    await this.device.nativeTransferOut(
      ENDPOINT,
      READ_TIMEOUT_MS,
      commandPacket(command, this.elapsed(), fields),
    );

    return this.read(timeoutMs);
  }

  private async read(timeoutMs: number): Promise<Uint8Array | undefined> {
    try {
      const read = await this.device.nativeTransferIn(ENDPOINT, timeoutMs, 512);
      return read ?? undefined;
    } catch {
      // A read the device never answers is the common case for a frame, not a
      // failure: the write already landed.
      return undefined;
    }
  }

  async close(): Promise<void> {
    if (!this.opened) return;
    this.opened = false;

    try {
      await this.device.releaseInterface(INTERFACE);
    } catch {
      // Releasing a device that was unplugged mid-frame is not an error worth
      // reporting above the unplug itself.
    }

    try {
      await this.device.close();
    } catch {
      // Same: a panel that went away cannot be closed again.
    }
  }
}

/**
 * Opens the first attached panel of `model`.
 *
 * Refused with a sentence rather than a bare failure when none is attached,
 * because "not plugged in" and "another program holds it" are the two failures
 * an owner will actually meet and they need different answers. The second is
 * L-Connect: it claims the interface for as long as it runs.
 */
export async function openPanel(model: PanelShape): Promise<PanelDevice> {
  const device = await usb.findDeviceByIds(model.vendorId, model.productId);

  if (device === undefined) {
    throw new Error(
      `${model.label} is not attached. Check the panel's USB cable.`,
    );
  }

  const panel = new TurUsbPanel(device, model);

  try {
    await panel.open();
  } catch (error) {
    await panel.close();
    throw new Error(
      `${model.label} could not be opened: ${
        error instanceof Error ? error.message : String(error)
      }. Another program holding it — L-Connect 3 is the usual one — has to be closed first.`,
    );
  }

  return panel;
}
