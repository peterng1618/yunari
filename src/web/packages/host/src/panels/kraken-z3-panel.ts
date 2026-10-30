import HID from "node-hid";
import { usb } from "usb";
import { reportedSerial } from "../settings/displays.js";
import { toPalettedFrame } from "./kraken-palette.js";
import type {
  PanelDevice,
  PanelFamily,
  PanelGeometry,
  PanelHint,
} from "./panel-device.js";
import { decodePngRgba } from "./png-raster.js";

/**
 * The NZXT Kraken Z LCD: a **round 320x320 screen fed one paletted frame per
 * bulk transfer**.
 *
 * **A frame is a stream packet, not a bucket upload.** The 20-byte header is
 * the same magic liquidctl uses, with mode `0x03` where a still uses `0x02`;
 * the payload is a 256-entry `R,G,B,A` palette followed by 320x320 palette
 * indices, 103,424 bytes in total. A captured stream from CAM on this machine
 * sends exactly that packet about nine times a second and sends no control
 * command between frames — entering the streaming format is the header itself,
 * and the same holds after the panel has shown an Image/GIF asset.
 *
 * **Why not a still upload.** liquidctl's bucket path gives the device a stored
 * image it keeps with the host gone, but it costs 409,600 bytes per frame and
 * accepts roughly one per second; that is a slide, not a live theme.
 *
 * The transport is two interfaces on one device, and neither alone is enough:
 * **control is HID** (interface 1, 64-byte reports) and **data is bulk**
 * (interface 0, endpoint 2). On Windows the HID interface is owned by the HID
 * class driver, so it is opened through `node-hid` rather than claimed through
 * libusb — claiming it fails with "incompatible driver is installed".
 *
 * **The bytes here were measured, not guessed** against firmware 5.11.0:
 * firmware answers `11 01` with 5.11.0, and LCD info answers `31 01` with
 * brightness and orientation in byte `0x1A`. The frame layout and mode byte come
 * from CAM's own web-integration stream, captured from its WinUSB writes.
 */

const VENDOR_ID = 0x1e71;
const PRODUCT_ID = 0x3008;
/** The LCD is 320x320; liquidctl's table for this PID says the same. */
const SIZE = 320;
/** Bulk writes go to endpoint 2 on interface 0. */
const HID_BULK_ENDPOINT = 0x02;
const USB_INTERFACE = 0;
/** The transfer header every upload begins with. */
const HEADER_MAGIC = [
  0x12, 0xfa, 0x01, 0xe8, 0xab, 0xcd, 0xef, 0x98, 0x76, 0x54, 0x32, 0x10,
];
/** Mode `0x02` stores an image in a bucket; `0x03` streams one frame. */
const STREAM_MODE = 0x03;
const MAX_READ_ATTEMPTS = 12;
const READ_TIMEOUT_MS = 300;
/** The `31 01` reply holds the panel's quarter turns in byte `0x1A`. */
const ORIENTATION_BYTE = 0x1a;
/** CAM streams this panel at nine frames a second. */
export const KRAKEN_FRAME_INTERVAL_MS = 111;

/**
 * The 20 bytes that precede a frame: the 12-byte magic, then the transfer mode
 * and the payload's byte count, each a 32-bit little-endian word.
 */
function transferHeader(payloadBytes: number): Uint8Array {
  const header = new Uint8Array(HEADER_MAGIC.length + 8);
  header.set(HEADER_MAGIC);
  header[12] = STREAM_MODE;

  new DataView(header.buffer).setUint32(16, payloadBytes, true);
  return header;
}

export interface KrakenHint extends PanelHint {
  readonly model: "kraken-z3";
}

/** What the family calls this device. One owner: the hint and the family row
 *  both read it, so a surface and a driver cannot name it differently. */
export const KRAKEN_LABEL = "NZXT Kraken Z (Z53/Z63/Z73)";

interface HidReply {
  readonly report: Uint8Array;
}

/** One 64-byte command report, then read until `wanted` arrives. */
class KrakenControl {
  constructor(private readonly hid: HID.HID) {}

  write(bytes: readonly number[]): void {
    const report = new Array<number>(64).fill(0);
    bytes.forEach((value, index) => {
      report[index] = value;
    });

    // A 65-byte array is read as "report id + 64 bytes" and Windows refuses it
    // with 0x57; 64 bytes is the bare report this firmware expects.
    this.hid.write(report);
  }

  read(): HidReply | undefined {
    try {
      const report = this.hid.readTimeout(READ_TIMEOUT_MS);
      if (!Array.isArray(report) || report.length === 0) return undefined;
      return { report: Uint8Array.from(report) };
    } catch {
      // A read with nothing pending is the normal answer to a command the
      // device does not reply to, not an error worth raising.
      return undefined;
    }
  }

  /**
   * liquidctl's `_read_until`: commands do not answer in order, because the
   * firmware also emits status reports (`75 01`) on its own.
   */
  readUntil(first: number, second: number): HidReply | undefined {
    for (let attempt = 0; attempt < MAX_READ_ATTEMPTS; attempt += 1) {
      const reply = this.read();
      if (reply === undefined) continue;
      if (reply.report[0] === first && reply.report[1] === second) return reply;
    }

    return undefined;
  }

  drain(): void {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (this.read() === undefined) return;
    }
  }
}

class KrakenPanel implements PanelDevice {
  readonly geometry: PanelGeometry = { width: SIZE, height: SIZE };
  /**
   * Nine frames a second is what CAM asks this panel for and what the captured
   * stream ran at. The runner skips a tick whose capture is still in flight, so
   * this is a target rather than a promise about the pipeline.
   */
  readonly frameIntervalMs = KRAKEN_FRAME_INTERVAL_MS;
  /** The quarter turns the panel last reported; `open` establishes it. */
  private orientation = 0;
  /** The still is decoded here, so the rasteriser can skip a lossy step. */
  readonly stillFormat = "png";

  constructor(
    private readonly control: KrakenControl,
    private readonly bulk: BulkUploader,
    private readonly hid: HID.HID,
  ) {}

  /**
   * Proves the control channel answers before anything is written.
   *
   * The two queries are the check, not a record: what a panel says about its
   * firmware and its LCD is the only way to know that a HID handle which opened
   * is a handle the firmware is listening on, and every later step assumes that.
   * The LCD reply also carries the mount orientation the frame is rotated for.
   */
  async open(): Promise<void> {
    this.control.drain();

    this.control.write([0x10, 0x01]);
    if (this.control.readUntil(0x11, 0x01) === undefined) {
      throw new Error("The Kraken did not answer its firmware query.");
    }

    this.control.write([0x30, 0x01]);
    const lcd = this.control.readUntil(0x31, 0x01);
    if (lcd === undefined) {
      throw new Error("The Kraken did not answer its LCD query.");
    }
    this.orientation = quarterTurns(lcd.report);
  }

  /**
   * Sends one frame in the panel's streaming format.
   *
   * **The header and the payload are separate bulk writes, as CAM sends them.**
   * The device shows the frame as it arrives, so the picture tracks the theme
   * for as long as the runner runs; it keeps the last frame but does not animate
   * once the host stops, because there is no bucket holding a file.
   *
   * Rotation is host-side: the panel reports how it is mounted and expects an
   * upright picture for that mount, so the encoder turns each frame by the
   * reported quarter turns.
   */
  async present(image: Uint8Array): Promise<void> {
    const rgba = decodePngRgba(image, SIZE, SIZE);
    const payload = toPalettedFrame(rgba, this.orientation);

    await this.bulk.write(transferHeader(payload.length));
    await this.bulk.write(payload);
  }

  async close(): Promise<void> {
    await this.bulk.close();
    // A HID handle is a file; closing it is the release.
    this.hid.close();
  }
}

/** The bulk half: interface 0, endpoint 2, opened through libusb. */
interface BulkUploader {
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

async function openBulk(): Promise<BulkUploader> {
  const device = await usb.findDeviceByIds(VENDOR_ID, PRODUCT_ID);

  if (device === undefined) {
    throw new Error("The NZXT Kraken is not attached.");
  }

  await device.open();
  await device.selectConfiguration(1);
  await device.claimInterface(USB_INTERFACE);

  let closed = false;

  return {
    async write(bytes: Uint8Array): Promise<void> {
      await device.nativeTransferOut(HID_BULK_ENDPOINT, 2_000, bytes);
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;

      try {
        await device.releaseInterface(USB_INTERFACE);
      } catch {
        // An unplugged panel cannot be released again.
      }
      try {
        await device.close();
      } catch {
        // Same.
      }
    },
  };
}

/** The `31 01` reply's orientation byte: 0..3 quarter turns, clockwise. */
export function quarterTurns(report: Uint8Array): number {
  const value = report[ORIENTATION_BYTE] ?? 0;
  return value <= 3 ? value : 0;
}

/** One enumerated HID device, in the fields a hint reads. */
export interface KrakenDescriptor {
  readonly vendorId: number;
  readonly productId: number;
  /** Absent when the firmware reports none, as node-hid itself reports it. */
  readonly serialNumber?: string | undefined;
}

/**
 * A device's hint, or nothing when it is not a Kraken.
 *
 * `serialNumber` is the unit's own string, the same one libusb enumerates and a
 * record stores. **The HID path is not** — its `#8&1ebeab3b&0&0000#` segment is
 * this boot's bus instance and moves on replug, so a record keyed by it reads
 * as detached forever after the next enumeration.
 */
export function krakenHint(
  device: KrakenDescriptor,
): (PanelHint & { readonly model: "kraken-z3" }) | undefined {
  if (device.vendorId !== VENDOR_ID || device.productId !== PRODUCT_ID) {
    return undefined;
  }

  return {
    vendorId: VENDOR_ID,
    productId: PRODUCT_ID,
    serial: reportedSerial(device.serialNumber) ?? "",
    label: KRAKEN_LABEL,
    model: "kraken-z3",
  };
}

/** The attached Kraken, as a hint a display record can hold. */
export function attachedKrakens(): readonly KrakenHint[] {
  return HID.devices()
    .map((device) => krakenHint(device))
    .filter((hint): hint is KrakenHint => hint !== undefined);
}

/** Opens the attached Kraken, or refuses with the reason it could not. */
export async function openKraken(label: string): Promise<PanelDevice> {
  const [info] = HID.devices().filter(
    (device) =>
      device.vendorId === VENDOR_ID && device.productId === PRODUCT_ID,
  );

  if (info === undefined || info.path === undefined) {
    throw new Error(`${label} is not attached. Check its USB cable.`);
  }

  const hid = new HID.HID(info.path);
  const control = new KrakenControl(hid);
  const bulk = await openBulk();
  const panel = new KrakenPanel(control, bulk, hid);

  try {
    await panel.open();
  } catch (error) {
    await panel.close();
    throw new Error(
      `${label} could not be opened: ${
        error instanceof Error ? error.message : String(error)
      }. NZXT CAM holding the LCD is the usual reason.`,
    );
  }

  return panel;
}

/** The Kraken Z: HID control, bulk frames, and a picture that follows the host. */
export const KRAKEN_FAMILIES: readonly PanelFamily[] = [
  {
    id: "kraken-z3",
    label: KRAKEN_LABEL,
    vendorId: VENDOR_ID,
    productId: PRODUCT_ID,
    support: {
      maker: "NZXT",
      hardwareRevision: "Z53/Z63/Z73",
      supportedFirmware: [],
      updatedAt: "2026-10-30",
    },
    commands: [],
    attached: () => Promise.resolve(attachedKrakens()),
    open: () => openKraken("The NZXT Kraken"),
  },
];
