import type { DisplayRenderMode } from "@yunari/renderer-core";
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
 * The NZXT Kraken Z LCD: a **round 320x320 screen fed one frame into a bucket
 * that is not on the glass, then switched to**.
 *
 * **Two streams paint through the same ring, and the owner chooses one.**
 *
 * - **Mode A** is the 32-bit RGBA frame this driver has always sent: 409,600
 *   bytes of bulk, full colour, and the firmware takes about 140 ms to put a
 *   bucket on the glass. Its bucket is 401 slots (a 20-byte header plus the
 *   pixels) and it needs two buckets.
 * - **Mode B** is CAM's own stream: a 256-entry palette plus one 8-bit index
 *   per pixel, 103,424 bytes, exactly 101 slots. CAM sends it from all 16
 *   buckets, deletes the target twice, and never waits before switching; its
 *   frame starts are 110 ms apart. Relaying CAM's sequence is what closes the
 *   cadence gap, and the picture is the 256-colour one CAM shows.
 *
 * Mode A stays the default because every panel family accepts it and a record
 * that names nothing plays it.
 *
 * **The firmware refuses the bucket it is displaying.** Deleting or starting a
 * write on the bucket that is currently shown answers status `9`,
 * `BucketIsBeingDisplayed`, and the transfer that follows stores nothing; every
 * write still succeeds on the wire. So the driver writes a bucket that is not
 * displayed, which is what makes the picture move.
 *
 * **The payload goes out in one bulk write.** Splitting it into liquidctl's
 * 512-byte writes costs 800 USB round trips for the same bytes.
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
 * brightness and the mount's quarter turns in byte `0x1A`. The mode-B sequence
 * and cadence are from a capture of CAM's own traffic; `docs/hardware/`
 * records both.
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
/** Upload type `0x03`: a 256-entry RGBA palette, then 8-bit indices. */
const PALETTED_MODE = 0x03;
/** The unit a bucket's start and size are counted in, both on the device. */
const SLOT_BYTES = 1024;
/** The device's bucket table; every index in it can hold one frame. */
const BUCKET_COUNT = 16;
/** A frame is one 320x320 RGBA image, and the header counts against the
 *  bucket's size in the same units. */
const FRAME_BYTES = SIZE * SIZE * 4;
const HEADER_BYTES = HEADER_MAGIC.length + 8;
const BUCKET_SLOTS = Math.ceil((HEADER_BYTES + FRAME_BYTES) / SLOT_BYTES);
/**
 * **CAM's paletted bucket is exactly its payload.** 101 slots cover the 1,024
 * palette bytes and 102,400 indices with nothing left for the transfer header,
 * and CAM writes the header anyway — the 20 bytes land in the next region,
 * which the next frame deletes and recreates. Copying that keeps all 16 buckets
 * inside the frame memory CAM itself addresses.
 */
const PALETTED_SLOTS = 101;
/** A single blocking read's timeout. */
const READ_TIMEOUT_MS = 120;
/**
 * How long a command waits for its own reply.
 *
 * **A window in time, not a count of reports.** The firmware broadcasts an
 * unsolicited status report (`75 0x`) about once a second and the operating
 * system queues them, so a command issued after a quiet minute — a clock theme
 * sends one frame a minute — finds dozens of them ahead of its answer. Counting
 * reads spent the whole budget on broadcasts in microseconds and reported
 * "no reply" for answers that were already on their way.
 */
const REPLY_WINDOW_MS = 1_000;
/** How long the firmware gets to finish storing a mode-A bucket before it is
 *  shown. CAM's paletted stream needs no wait and this never applies to it. */
const UPLOAD_SETTLE_MS = 10;
/**
 * **The glass honours a mode-A switch only about every 140 ms.**
 *
 * The wire carries a 400 KB frame in ~90 ms, so the ring can be driven at
 * ~11 frames a second — but the firmware answers every command with status 1
 * and silently drops a switch that arrives before it has finished putting the
 * previous bucket on the glass. Filming the glass at 30 fps while the host
 * drove it at 70 ms showed about half the frames missing from the glass (59%
 * shown without the settle, 50% with it), in an irregular pattern, which is the
 * judder and the pull-back read as a frozen jump. At 130–135 ms a few per cent
 * of frames still vanished; from 140 ms every frame landed (129 sent, 130
 * pictures, no pull-back, no held tear).
 */
export const KRAKEN_FRAME_INTERVAL_MS = 140;
/**
 * **A paletted switch costs the glass about 110 ms.** CAM's captured frame
 * starts are 110 ms apart (median; p10 108, p90 114) — about 9.1 fps. The
 * quarter-size frame leaves the wire and the glass both inside that budget.
 */
export const KRAKEN_PALETTED_FRAME_INTERVAL_MS = 110;

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
   * firmware also emits status reports on its own. Anything that is not this
   * command's reply is dropped and the wait continues until the window closes,
   * so a queue full of broadcasts cannot hide an answer.
   */
  readUntil(first: number, second: number): HidReply | undefined {
    const deadline = Date.now() + REPLY_WINDOW_MS;

    while (Date.now() < deadline) {
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

/** A frame the device would not store. `status` is the firmware's byte 14, or
 *  `undefined` when the command drew no reply at all — the two need different
 *  repairs, so the caller has to see which it was. `stage` names the command,
 *  because a refused bucket setup and a refused switch are different faults. */
class FrameRefused extends Error {
  constructor(
    readonly status: number | undefined,
    readonly stage: string,
  ) {
    super(
      `The Kraken refused a frame upload (${stage}, status ${status ?? "none"}).`,
    );
  }
}

class KrakenPanel implements PanelDevice {
  readonly geometry: PanelGeometry = { width: SIZE, height: SIZE };
  /**
   * The glass drops a switch that arrives before it has put the previous frame
   * up, so this is the fastest cadence that shows every frame for the stream in
   * use; see the two interval constants. The runner skips a tick whose capture
   * is still in flight and overlaps capture with send, so this is a ceiling the
   * pipeline can fall short of, not a promise.
   */
  readonly frameIntervalMs: number;
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
    private readonly renderMode: DisplayRenderMode,
  ) {
    this.frameIntervalMs =
      renderMode === "mode-b"
        ? KRAKEN_PALETTED_FRAME_INTERVAL_MS
        : KRAKEN_FRAME_INTERVAL_MS;
  }

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
   * Sends one frame into a bucket that is not on the glass, then shows it.
   *
   * The first frame also clears the bucket table — whatever CAM or a previous
   * run left there — because this driver addresses fixed regions and another
   * object there would be overwritten.
   */
  async present(image: Uint8Array): Promise<void> {
    const rgba = decodePngRgba(image, SIZE, SIZE);

    if (!this.ready) {
      await this.prepare();
      this.ready = true;
    }

    // `prepare` leaves bucket 0 on the glass (in liquid mode), and every later
    // frame targets the bucket `shown` is not.
    const target = this.nextBucket();

    try {
      await this.writeFrame(target, rgba);
      this.shown = target;
    } catch (error) {
      if (!(error instanceof FrameRefused) || error.status !== 9) throw error;

      // **Status 9 means `shown` is wrong, and the ring can repair itself.**
      // The firmware refuses the bucket it is displaying, so a refused delete,
      // setup or switch to `target` is the firmware saying that bucket is on
      // the glass. The bucket `shown` names is therefore the one not displayed:
      // write it again, which recovers without liquefying the glass.
      const other = this.bucketAfter(target);

      try {
        await this.writeFrame(other, rgba);
        this.shown = other;
      } catch (retry) {
        // Neither bucket takes a frame: the table itself changed under us, so
        // the next frame rebuilds it.
        this.ready = false;
        throw retry;
      }
    }
  }

  /** The bucket this frame goes into: the one not on the glass. Mode A keeps a
   *  two-bucket ring because the firmware's 140 ms glass only fits two; mode B
   *  uses CAM's full 16, each holding exactly one paletted frame. */
  private nextBucket(): number {
    if (this.renderMode === "mode-a") return this.shown === 0 ? 1 : 0;

    return this.bucketAfter(this.shown ?? BUCKET_COUNT - 1);
  }

  /** The bucket after `index`, wrapping — mode A is a two-bucket ring. */
  private bucketAfter(index: number): number {
    const count = this.renderMode === "mode-a" ? 2 : BUCKET_COUNT;
    return (index + 1) % count;
  }

  /**
   * Liquefy the glass, then empty every bucket so the ring has its range.
   *
   * **It leaves bucket 0 on the glass**, in liquid mode. That is the bucket the
   * ring must not write next, so `shown` is set here rather than left at a
   * stale index: a rebuild after a refusal used to keep the old index and
   * write the bucket `prepare` had just switched to, which answered status 9
   * and started the rebuild again.
   */
  private async prepare(): Promise<void> {
    // Read `37 03`, not "the next report": the firmware emits `75 01` on its
    // own, and taking one as this reply shifts every read after it.
    this.control.write([0x36, 0x03]);
    this.control.readUntil(0x37, 0x03);
    // Liquid mode first: the firmware refuses to delete the bucket it plays.
    this.switchBucket(0, 0x02);
    this.shown = 0;

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
    const paletted = this.renderMode === "mode-b";
    const mode = paletted ? PALETTED_MODE : RGBA_MODE;
    const slots = paletted ? PALETTED_SLOTS : BUCKET_SLOTS;
    const payload = paletted ? toPalettedFrame(rgba) : rgba;

    let status = this.deleteBucket(index);
    // **A refused delete must never be written over or shown.** The firmware
    // keeps the first graphic a bucket stored, so a bucket whose delete was
    // refused still holds the previous frame, and the switch that follows
    // would put that older picture on the glass. A second delete is the retry
    // for a refusal the firmware answers once, and CAM deletes twice on every
    // paletted frame regardless.
    if (paletted || status !== 0x01) status = this.deleteBucket(index);
    if (status !== 0x01) throw new FrameRefused(status, "delete");

    // **Never stream into a bucket the firmware refused to set up.** liquidctl
    // only logs this refusal and streams anyway; on the 2023/2024 firmware
    // that produced wrong pictures and wedged the device into its bootloader.
    // Nothing can be shown from a setup that failed, so the frame is refused
    // instead and the glass keeps the frame it already has.
    status = this.createBucket(index, slots);
    if (status !== 0x01) throw new FrameRefused(status, "create");

    this.control.write([0x36, 0x01, index]);
    const started = this.control.readUntil(0x37, 0x01);
    const begin = started?.report[14];
    if (begin !== 0x01) {
      // **A begin whose reply was missed still opened the transfer.** Status 2
      // is the firmware saying "already transferring": the command landed, its
      // reply did not, and every later begin would answer 2 until something
      // ended it. (2026-11-04: that left the runner reopening the panel in a
      // loop of `none`, `2`, `disconnected`.) End the transfer before giving up
      // so the next tick starts clean; the one frame is lost, not the panel.
      if (begin === undefined || begin === 0x02) this.endTransfer(index);

      // **Only status 9 means the table is wrong**, and `present` repairs that
      // by addressing the next bucket. A busy device (18) left the table
      // intact, and the next tick's delete/create retries the same bucket.
      // Rebuilding for it liquefied the glass — a visible blank — every time
      // the device missed one frame (2026-11-04).
      throw new FrameRefused(begin, "begin");
    }

    await this.bulk.write(transferHeader(mode, payload.length));
    await this.bulk.write(payload);

    this.control.write([0x36, 0x02, index]);
    this.control.readUntil(0x37, 0x02);
    // **Mode A's switch races the write.** `36 02` answers before the glass has
    // the bucket's last tiles; switching on its heels shows a partly old
    // picture, which on a moving theme reads as a tear. Every command still
    // reports success, so no status check can see it. CAM's paletted stream
    // carries a quarter of the tiles and needs no settle; adding one there
    // would eat the frame budget it exists to fit.
    if (!paletted) {
      await new Promise((resolve) => setTimeout(resolve, UPLOAD_SETTLE_MS));
    }
    status = this.switchBucket(index);
    // The frame is in the bucket but not on the glass, so `shown` must not
    // move: the next tick rewrites this bucket and tries the switch again.
    if (status !== 0x01) throw new FrameRefused(status, "switch");
  }

  /**
   * Closes a transfer the firmware opened but this driver will not complete.
   *
   * The reply to the end is read and dropped: the device is back in its idle
   * state whether or not the report arrives, and a missed `37 02` must not
   * shift the next command's read.
   */
  private endTransfer(index: number): void {
    this.control.write([0x36, 0x02, index]);
    this.control.readUntil(0x37, 0x02);
  }

  /** The firmware's status byte for a delete, or undefined when it said
   *  nothing. `1` is success. */
  private deleteBucket(index: number): number | undefined {
    this.control.write([0x32, 0x02, index]);
    // `33 02`, not "the next report": the firmware emits status reports on its
    // own, and a stray `75 01` read as an answer reports a failed delete.
    return this.control.readUntil(0x33, 0x02)?.report[14];
  }

  private createBucket(index: number, slots: number): number | undefined {
    const start = index * slots;
    this.control.write([
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

    return this.control.readUntil(0x33, 0x01)?.report[14];
  }

  private switchBucket(index: number, mode = 0x04): number | undefined {
    this.control.write([0x38, 0x01, mode, index]);
    return this.control.readUntil(0x39, 0x01)?.report[14];
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
export async function openKraken(
  label: string,
  renderMode: DisplayRenderMode = "mode-a",
): Promise<PanelDevice> {
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
  const panel = new KrakenPanel(control, bulk, hid, renderMode);

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

/** The Kraken Z: HID control, a bucket ring, a picture that follows the host. */
export const KRAKEN_FAMILIES: readonly PanelFamily[] = [
  {
    id: "kraken-z3",
    label: KRAKEN_LABEL,
    vendorId: VENDOR_ID,
    productId: PRODUCT_ID,
    support: {
      maker: "NZXT",
      hardwareRevision: "Z53/Z63/Z73",
      // The firmware the opcode-10 probe reported on the hardware this driver
      // was measured against.
      supportedFirmware: ["5.11.0"],
      updatedAt: "2026-11-06",
    },
    commands: [],
    geometry: { width: SIZE, height: SIZE },
    renderModes: ["mode-a", "mode-b"],
    attached: () => Promise.resolve(attachedKrakens()),
    open: (options) =>
      openKraken("The NZXT Kraken", options?.renderMode ?? "mode-a"),
  },
];
