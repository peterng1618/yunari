import HID from "node-hid";
import { usb } from "usb";
import { reportedSerial } from "../settings/displays.js";
import type {
  PanelDevice,
  PanelFamily,
  PanelGeometry,
  PanelHint,
} from "./panel-device.js";
import { decodeStill } from "./panel-image.js";

/**
 * The NZXT Kraken Z LCD: a **round 320x320 screen that plays content from its
 * own memory**, not a frame stream.
 *
 * **This is the second mechanism the port has to carry, and it is why the port
 * is `present` rather than `push-jpeg`.** The Lian Li panels take one JPEG per
 * frame down a bulk endpoint and show it immediately; a Kraken takes a whole
 * still image once, into one of 16 buckets, and then plays it with the host
 * gone. Two verbs, one interface: what a panel shows, not how it gets there.
 *
 * The transport is two interfaces on one device, and neither alone is enough:
 * **control is HID** (interface 1, 64-byte reports) and **data is bulk**
 * (interface 0, endpoint 2). On Windows the HID interface is owned by the HID
 * class driver, so it is opened through `node-hid` rather than claimed through
 * libusb — claiming it fails with "incompatible driver is installed".
 *
 * **The bytes here were measured, not guessed** (firmware 5.11.0, decision
 * 0131): firmware answers `11 01` with 5.11.0, LCD info answers `31 01` with
 * brightness and orientation, and the 16-bucket table answers `31 04` with a
 * start/size pair each.
 */

const VENDOR_ID = 0x1e71;
const PRODUCT_ID = 0x3008;
/** The LCD is 320x320; liquidctl's table for this PID says the same. */
const SIZE = 320;
/** liquidctl's `_LCD_TOTAL_MEMORY`: how many 1024-byte slots the LCD has. */
const TOTAL_SLOTS = 24_320;
/** The unit a bucket's start and size are counted in, both on the device. */
const SLOT_BYTES = 1024;
const BUCKET_COUNT = 16;
/** Bulk writes are this size in liquidctl; the endpoint accepts it here. */
const BULK_CHUNK = 512;
/** The transfer header every upload begins with. */
const HEADER_MAGIC = [
  0x12, 0xfa, 0x01, 0xe8, 0xab, 0xcd, 0xef, 0x98, 0x76, 0x54, 0x32, 0x10,
];

/**
 * The 20 bytes that precede an upload's pixels: the 12-byte magic, then asset
 * mode `2` and the payload's byte count, each a 32-bit little-endian word.
 */
function transferHeader(payloadBytes: number): Uint8Array {
  const header = new Uint8Array(HEADER_MAGIC.length + 8);
  header.set(HEADER_MAGIC);
  header[12] = 0x02;

  new DataView(header.buffer).setUint32(16, payloadBytes, true);
  return header;
}
const MAX_READ_ATTEMPTS = 12;
const READ_TIMEOUT_MS = 300;
const HID_BULK_ENDPOINT = 0x02;
const USB_INTERFACE = 0;

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

  /** liquidctl's `_write_then_read`: a command whose only reply is its answer. */
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

interface Bucket {
  readonly index: number;
  readonly start: number;
  readonly size: number;
}

/** liquidctl's rule: the first bucket with nothing in it, else bucket 0. */
export function pickBucket(buckets: readonly Bucket[]): Bucket {
  const free = buckets.find((bucket) => bucket.size === 0);
  return free ?? buckets[0] ?? { index: 0, start: 0, size: 0 };
}

/**
 * Where to put `slots` without overwriting another bucket, counted in slots
 * from the device's own table. `-1` means nothing fits and the caller's only
 * option is to clear the memory.
 *
 * liquidctl's four rules, in its order: a deleted bucket keeps its old range
 * for reuse; otherwise append past the highest occupied byte; otherwise use the
 * gap before the lowest; otherwise give up.
 */
export function memoryOffset(
  buckets: readonly Bucket[],
  target: Bucket,
  slots: number,
): number {
  if (slots <= target.size) return target.start;

  let lowest = target.start;
  let highest = 0;
  let overlaps = false;

  for (const bucket of buckets) {
    const end = bucket.start + bucket.size;
    highest = Math.max(highest, end);
    lowest = Math.min(lowest, bucket.start);

    if (
      (bucket.start > target.start && bucket.start < target.start + slots) ||
      (bucket.start < target.start && end > target.start) ||
      (bucket.start === target.start && bucket.index !== target.index)
    ) {
      overlaps = true;
    }
  }

  if (!overlaps) return target.start;
  // `<`, not `<=`: liquidctl's own guard, and the last slot is not spare.
  if (highest + slots < TOTAL_SLOTS) return highest;
  if (slots < lowest) return 0;

  return -1;
}

class KrakenPanel implements PanelDevice {
  readonly geometry: PanelGeometry = { width: SIZE, height: SIZE };
  /**
   * A `present` here is a storage write: a header plus ~800 bulk transfers,
   * each one a flash write. A one-second cadence would rewrite the panel's
   * memory every second for a picture nobody asked to change that fast, so the
   * floor is a minute — slow enough to be a still, fast enough that an owner
   * who edits the theme sees the result without restarting anything.
   */
  readonly minimumIntervalMs = 60_000;

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
   * Sends one still to a free bucket and switches to it.
   *
   * **The panel keeps showing it after this returns**, which is the whole
   * difference from a streaming panel: the host may sleep, exit, or lose the
   * cable's owner, and the picture stays up because the pixels live on the
   * device.
   */
  async present(image: Uint8Array): Promise<void> {
    const frame = await decodeStill(image, SIZE, SIZE);
    // The protocol takes 32-bit ARGB with the alpha byte ignored, so the raster
    // is widened and the channels reordered rather than sent as RGBA.
    const payload = toArgb(frame.rgba);

    // One slot is 1024 bytes, and the whole transfer — header included — is
    // counted in slots. The device's own report is payload only: a bucket
    // holding one 320x320 still reports size 400, and 409,600 / 1024 = 400.
    // Counting the header rounds that to 401, which is liquidctl's arithmetic
    // and errs towards not overlapping the next bucket rather than into it.
    const header = transferHeader(payload.length);
    const slots = Math.ceil((header.length + payload.length) / SLOT_BYTES);

    if (slots > TOTAL_SLOTS) {
      throw new Error(
        `A ${payload.length}-byte frame needs ${slots} of ${TOTAL_SLOTS} slots.`,
      );
    }

    // End any transfer, then read the table **before** deleting. A deleted
    // bucket reports start 0, so choosing the offset afterwards puts this
    // upload at offset 0 and over whatever bucket already lives there.
    this.control.ask([0x36, 0x03]);
    const buckets = this.queryBuckets();
    let target = pickBucket(buckets);
    let start = memoryOffset(buckets, target, slots);

    if (start < 0) {
      // Nothing fits without overlap: liquidctl's last resort, clear and go.
      this.deleteAllBuckets();
      target = { index: 0, start: 0, size: 0 };
      start = 0;
    }

    this.deleteBucket(target.index);
    this.setupBucket(target.index, start, slots);
    this.control.ask([0x36, 0x01, target.index]);

    await this.bulk.write(header);

    for (let offset = 0; offset < payload.length; offset += BULK_CHUNK) {
      await this.bulk.write(payload.subarray(offset, offset + BULK_CHUNK));
    }

    this.control.ask([0x36, 0x02]);
    this.switchBucket(target.index);
  }

  /** The bucket table, as the device reports it. */
  queryBuckets(): readonly Bucket[] {
    const buckets: Bucket[] = [];

    for (let index = 0; index < BUCKET_COUNT; index += 1) {
      const reply = this.control.ask([0x30, 0x04, index]);
      if (reply === undefined) continue;

      buckets.push({
        index,
        start: (reply[17] ?? 0) | ((reply[18] ?? 0) << 8),
        size: (reply[19] ?? 0) | ((reply[20] ?? 0) << 8),
      });
    }

    return buckets;
  }

  private deleteBucket(index: number): boolean {
    this.control.write([0x32, 0x02, index]);
    // `33 02`, not "the next report": the firmware emits status reports on its
    // own, and a stray `75 01` read as an answer reports a failed delete.
    return this.control.readUntil(0x33, 0x02)?.report[14] === 0x01;
  }

  private deleteAllBuckets(): void {
    // Liquid mode first: the firmware refuses to delete the bucket it is
    // currently playing.
    this.switchBucket(0, 0x02);
    for (let index = 0; index < BUCKET_COUNT; index += 1) {
      this.deleteBucket(index);
    }
  }

  private setupBucket(index: number, start: number, slots: number): boolean {
    const reply = this.control.ask([
      0x32,
      0x01,
      index,
      index + 1,
      start & 0xff,
      (start >>> 8) & 0xff,
      slots & 0xff,
      (slots >>> 8) & 0xff,
      0x01,
    ]);

    return reply?.[14] === 0x01;
  }

  private switchBucket(index: number, mode = 0x04): void {
    this.control.ask([0x38, 0x01, mode, index]);
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

/** RGBA to the ARGB the firmware reads, alpha left at zero. */
function toArgb(rgba: Uint8Array): Uint8Array {
  const argb = new Uint8Array(rgba.length);

  for (let index = 0; index < rgba.length; index += 4) {
    argb[index] = 0;
    argb[index + 1] = rgba[index] ?? 0;
    argb[index + 2] = rgba[index + 1] ?? 0;
    argb[index + 3] = rgba[index + 2] ?? 0;
  }

  return argb;
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

/** The Kraken Z: HID control, bulk data, and content that outlives the host. */
export const KRAKEN_FAMILIES: readonly PanelFamily[] = [
  {
    id: "kraken-z3",
    label: KRAKEN_LABEL,
    vendorId: VENDOR_ID,
    productId: PRODUCT_ID,
    stores: true,
    support: {
      maker: "NZXT",
      hardwareRevision: "Z53/Z63/Z73",
      supportedFirmware: [],
      updatedAt: "2026-10-28",
    },
    commands: [],
    attached: () => Promise.resolve(attachedKrakens()),
    open: () => openKraken("The NZXT Kraken"),
  },
];
