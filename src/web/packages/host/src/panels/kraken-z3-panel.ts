import HID from "node-hid";
import { usb } from "usb";
import { reportedSerial } from "../settings/displays.js";
import type {
  PanelDevice,
  PanelFamily,
  PanelGeometry,
  PanelHint,
} from "./panel-device.js";
import { decodePngRgba } from "./png-raster.js";

/**
 * The NZXT Kraken Z LCD: a **round 320x320 screen fed one 32-bit RGBA frame
 * into a bucket that is not on the glass, then switched to**.
 *
 * **The firmware refuses the bucket it is displaying.** Deleting or starting a
 * write on the bucket that is currently shown answers status `9`,
 * `BucketIsBeingDisplayed`, and the transfer that follows stores nothing; every
 * write still succeeds on the wire. So the driver keeps two buckets and always
 * writes the one that is not displayed, which is what makes the picture move.
 *
 * **Mode `0x03` streaming packets do not paint this firmware.** CAM's own
 * web-integration stream is a 20-byte header plus a 103,424-byte palette and
 * index plane, about nine times a second, and CAM's captured packets replayed
 * by hand are accepted without error and shown nowhere. The bucket ring above
 * is the transport that works on the attached Z73: 2,316 frames in three
 * minutes with no failed command, measured at 12.9 FPS.
 *
 * **The payload goes out in one bulk write.** The endpoint took all 409,600
 * bytes in 36 ms; splitting it into liquidctl's 512-byte writes costs 800 USB
 * round trips for the same bytes.
 *
 * The transport is two interfaces on one device, and neither alone is enough:
 * **control is HID** (interface 1, 64-byte reports) and **data is bulk**
 * (interface 0, endpoint 2). On Windows the HID interface is owned by the HID
 * class driver, so it is opened through `node-hid` rather than claimed through
 * libusb — claiming it fails with "incompatible driver is installed".
 *
 * **The driver does not rotate the picture.** The mount angle is the display
 * record's `rotation`, which the player has already applied when the frame is
 * captured; the `31 01` reply also reports one, and honouring both turned every
 * frame twice. The record is the owner because a person can see and change it.
 *
 * **The bytes here were measured, not guessed** against firmware 5.11.0:
 * firmware answers `11 01` with its version, and LCD info answers `31 01` with
 * brightness and the mount's quarter turns in byte `0x1A`.
 */

const VENDOR_ID = 0x1e71;
const PRODUCT_ID = 0x3008;
/** The LCD is 320x320. */
const SIZE = 320;
/** Bulk writes go to endpoint 2 on interface 0. */
const HID_BULK_ENDPOINT = 0x02;
const USB_INTERFACE = 0;
/** The transfer header every upload begins with. */
const HEADER_MAGIC = [
  0x12, 0xfa, 0x01, 0xe8, 0xab, 0xcd, 0xef, 0x98, 0x76, 0x54, 0x32, 0x10,
];
/** Upload type `0x02`: one still, 32 bits per pixel, alpha ignored. */
const RGBA_MODE = 0x02;
/** The unit a bucket's start and size are counted in, both on the device. */
const SLOT_BYTES = 1024;
/** The device's bucket table; every index in it can hold one frame. */
const BUCKET_COUNT = 16;
/** A frame is one 320x320 RGBA image, and the header counts against the
 *  bucket's size in the same units. */
const FRAME_BYTES = SIZE * SIZE * 4;
const HEADER_BYTES = HEADER_MAGIC.length + 8;
const BUCKET_SLOTS = Math.ceil((HEADER_BYTES + FRAME_BYTES) / SLOT_BYTES);
const MAX_READ_ATTEMPTS = 8;
const READ_TIMEOUT_MS = 120;
/**
 * The camera-ready cadence: the ring carried 12.9 FPS on this hardware, so the
 * runner is asked for one frame every 70 ms. A tick costs about a capture plus
 * a send and the runner overlaps those, so the achieved rate lands near 10 FPS
 * rather than the 9 CAM asks for.
 */
export const KRAKEN_FRAME_INTERVAL_MS = 70;

/**
 * The header that precedes a frame: the 12-byte magic, the transfer type, and
 * the payload's byte count as a 32-bit little-endian word.
 */
function transferHeader(mode: number, payloadBytes: number): Uint8Array {
  const header = new Uint8Array(HEADER_BYTES);
  header.set(HEADER_MAGIC);
  header[12] = mode;

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

  /** liquidctl's `_write_then_read`: a command whose next report is its answer. */
  ask(bytes: readonly number[]): Uint8Array | undefined {
    this.write(bytes);
    return this.read()?.report;
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
   * CAM asks this panel for nine frames a second; the ring itself ran at 12.9
   * FPS on this hardware. The runner skips a tick whose capture is still in
   * flight and overlaps capture with send, so this is a target the pipeline
   * can fall short of, not a promise.
   */
  readonly frameIntervalMs = KRAKEN_FRAME_INTERVAL_MS;
  /** The still is decoded here, so the rasteriser can skip a lossy step. */
  readonly stillFormat = "png";
  /** Whether the bucket table has been cleared for this driver. */
  private ready = false;
  /** The bucket on the glass, or undefined before the first frame. */
  private shown: number | undefined;

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
   */
  async open(): Promise<void> {
    this.control.drain();

    this.control.write([0x10, 0x01]);
    if (this.control.readUntil(0x11, 0x01) === undefined) {
      throw new Error("The Kraken did not answer its firmware query.");
    }

    this.control.write([0x30, 0x01]);
    if (this.control.readUntil(0x31, 0x01) === undefined) {
      throw new Error("The Kraken did not answer its LCD query.");
    }
  }

  /**
   * Sends one frame into the bucket that is not on the glass, then shows it.
   *
   * The first frame also clears the bucket table — whatever CAM or a previous
   * run left there — because this driver addresses its two buckets at fixed
   * offsets and another object in that range would be overwritten.
   */
  async present(image: Uint8Array): Promise<void> {
    const rgba = decodePngRgba(image, SIZE, SIZE);

    if (!this.ready) {
      await this.prepare();
      this.ready = true;
    }

    const target = this.shown === 0 ? 1 : 0;
    await this.writeFrame(target, rgba);
    this.shown = target;
  }

  /** Liquefy the glass, then empty every bucket so the ring has its range. */
  private async prepare(): Promise<void> {
    this.control.ask([0x36, 0x03]);
    // Liquid mode first: the firmware refuses to delete the bucket it plays.
    this.switchBucket(0, 0x02);

    for (let index = 0; index < BUCKET_COUNT; index += 1) {
      this.deleteBucket(index);
    }
  }

  /**
   * One frame: fresh bucket, header, pixels, end, switch.
   *
   * The bucket is deleted and recreated each frame because a bucket that
   * already holds an image is not overwritten in place — the firmware keeps
   * the first graphic it stored there.
   */
  private async writeFrame(index: number, rgba: Uint8Array): Promise<void> {
    this.deleteBucket(index);
    this.createBucket(index);

    this.control.write([0x36, 0x01, index]);
    const started = this.control.readUntil(0x37, 0x01);
    if (started?.report[14] !== 0x01) {
      // Status 9 is the bucket on the glass, 18 a busy device: either way this
      // frame was not stored, and the table is worth rebuilding next time.
      this.ready = false;
      throw new Error(
        `The Kraken refused a frame upload (status ${
          started?.report[14] ?? "none"
        }).`,
      );
    }

    await this.bulk.write(transferHeader(RGBA_MODE, rgba.length));
    await this.bulk.write(rgba);

    this.control.write([0x36, 0x02, index]);
    this.control.readUntil(0x37, 0x02);
    this.switchBucket(index);
  }

  private deleteBucket(index: number): boolean {
    this.control.write([0x32, 0x02, index]);
    // `33 02`, not "the next report": the firmware emits status reports on its
    // own, and a stray `75 01` read as an answer reports a failed delete.
    return this.control.readUntil(0x33, 0x02)?.report[14] === 0x01;
  }

  private createBucket(index: number): boolean {
    const start = index * BUCKET_SLOTS;
    this.control.write([
      0x32,
      0x01,
      index,
      index + 1,
      start & 0xff,
      (start >>> 8) & 0xff,
      BUCKET_SLOTS & 0xff,
      (BUCKET_SLOTS >>> 8) & 0xff,
      0x01,
    ]);

    return this.control.readUntil(0x33, 0x01)?.report[14] === 0x01;
  }

  private switchBucket(index: number, mode = 0x04): void {
    this.control.write([0x38, 0x01, mode, index]);
    this.control.readUntil(0x39, 0x01);
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

/** The Kraken Z: HID control, a two-bucket ring, a picture that follows the host. */
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
