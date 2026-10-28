import { createHash } from "node:crypto";
import type {
  PanelDevice,
  PanelFamily,
  PanelHint,
  PanelVideo,
  PanelVideoPlacement,
} from "./panel-device.js";
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
import { type TranscodeResult, transcodeForPanel } from "./turzx-video.js";

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
/** A file command's answer may follow a whole upload, not just its header. */
const FILE_TIMEOUT_MS = 10_000;
/** The panel dropped an overlay update sent 8 ms after init; 1.5 s worked. */
const OVERLAY_SETTLE_MS = 1500;
/** A 249-byte chunk plus its `0x00` pad is one frame. */
const FILE_CHUNK_BYTES = 249;
/** Storage the vendor firmware reads clips from. */
const VIDEO_DIRECTORY = "/mnt/SDCARD/video";

/** The transcode the adapter runs before it uploads; a test seam. */
type Transcode = (
  bytes: Uint8Array,
  placement: PanelVideoPlacement,
) => Promise<TranscodeResult>;

/** One panel this host is driving, by the port it holds.
 *
 * **The port a host drives cannot be opened again**, so discovery that only
 * probes would report a running panel as absent. Recording the identity at open
 * is what lets `attachedTurzxPanels` state the device it already knows about and
 * skip the port it cannot reopen. */
interface HeldPanel {
  readonly vendorId: number;
  readonly productId: number;
  readonly serial: string;
  readonly model: string;
  readonly firmware: string;
}

const heldPanels = new Map<string, HeldPanel>();

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
  /** Defaults to `transcodeForPanel`; the seam keeps uploads out of tests. */
  readonly transcode?: Transcode;
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
  // A panel this host is driving is stated from what opening it already told
  // us: its port cannot be reopened to ask again.
  const hints: PanelHint[] = [...heldPanels.values()].map((panel) => ({
    vendorId: panel.vendorId,
    productId: panel.productId,
    serial: panel.serial,
    label: LABEL,
    model: panel.model,
    firmware: panel.firmware,
  }));

  for (const port of ports) {
    if (!hasIds(port)) continue;
    if (heldPanels.has(port.path)) continue;

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

  readonly video: PanelVideo;

  private queue: Promise<unknown> = Promise.resolve();
  /** The transparent overlay sent at init; the diff encoder updates from it. */
  private previousOverlay: Uint8Array | undefined;
  /** The clip most recently started; a different one deletes it. */
  private previousVideoPath: string | undefined;

  constructor(
    private readonly transport: SerialTransport,
    private readonly decode: NonNullable<TurzxOptions["decode"]>,
    /** The port recorded in `heldPanels`, released with the transport. */
    private readonly path: string,
    private readonly transcode: Transcode,
    private readonly sleep: (ms: number) => Promise<void>,
  ) {
    this.video = {
      start: (mp4, placement) => this.startVideo(mp4, placement),
      // The diff encoder lands in Task 11; until then an overlay update is a
      // wiring mistake, not a frame this adapter can send.
      presentOverlay: () =>
        Promise.reject(
          new Error("The TURZX overlay encoder is not wired yet."),
        ),
      stop: () => this.enqueue(() => this.send(TURZX_COMMAND.stopVideo)),
    };
  }

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

  /**
   * Transcodes, uploads a clip the panel does not already hold, plays it and
   * initializes the transparent overlay a UI is drawn over.
   */
  private async startVideo(
    mp4: Uint8Array,
    placement: PanelVideoPlacement,
  ): Promise<void> {
    await this.enqueue(async () => {
      const transcoded = await this.transcode(mp4, placement);
      if (!transcoded.ok) throw new Error(transcoded.message);

      const remotePath = `${VIDEO_DIRECTORY}/yunari-${sha256(transcoded.bytes).slice(0, 16)}.mp4`;
      const stored = await this.fileSize(remotePath);

      if (stored !== transcoded.bytes.length) {
        if (stored > 0) {
          await this.send(fileHeader(TURZX_COMMAND.deleteFile, remotePath));
        }
        await this.upload(remotePath, transcoded.bytes);
      }

      await this.send(fileHeader(TURZX_COMMAND.startVideo, remotePath));
      this.expect("play_video_success", await this.reply(), "start playback");

      await this.send(TURZX_COMMAND.preUpdate);
      await this.send(TURZX_COMMAND.startBitmap);
      await this.send(TURZX_COMMAND.displayOnVideo);

      // The overlay starts fully transparent: every pixel the UI does not
      // paint shows the playing video underneath.
      const transparent = new Uint8Array(
        this.geometry.width * this.geometry.height * 4,
      );
      await this.send(bgraPayload(transparent));
      await this.send(
        frame(Uint8Array.of(0xd0, 0xef, 0x69, 0x00, 0x00, 0x00, 0x02)),
      );
      await this.send(frame(Uint8Array.of(0xef, 0x69)));

      // Init answers `seq_png_init_sucessneedReSend:0|renderCnt:N`; the first
      // update must wait out the panel's settle.
      await this.reply();
      await this.sleep(OVERLAY_SETTLE_MS);
      await this.send(TURZX_COMMAND.queryStatus);

      this.previousOverlay = transparent;
      if (
        this.previousVideoPath !== undefined &&
        this.previousVideoPath !== remotePath
      ) {
        await this.send(
          fileHeader(TURZX_COMMAND.deleteFile, this.previousVideoPath),
        );
      }
      this.previousVideoPath = remotePath;
    });
  }

  /** The device's stored size for `remotePath`, or 0 when it holds nothing. */
  private async fileSize(remotePath: string): Promise<number> {
    await this.send(fileHeader(TURZX_COMMAND.getFileSize, remotePath));

    let size = parseFileSize(await this.reply());
    if (size === undefined) {
      // `openTurzxPanel` ends on QUERY_STATUS, whose text reply is buffered and
      // is what this first read returns. The size answer is behind it.
      size = parseFileSize(await this.reply());
    }

    return size ?? 0;
  }

  private async upload(remotePath: string, bytes: Uint8Array): Promise<void> {
    await this.send(
      fileHeader(TURZX_COMMAND.uploadFile, remotePath, bytes.length),
    );

    for (let start = 0; start < bytes.length; start += FILE_CHUNK_BYTES) {
      await this.send(frame(bytes.subarray(start, start + FILE_CHUNK_BYTES)));
    }

    this.expect("create_success", await this.reply(), "accept the video file");
  }

  private reply(): Promise<Uint8Array> {
    return this.transport.read(FILE_TIMEOUT_MS);
  }

  private expect(phrase: string, reply: Uint8Array, action: string): void {
    const text = decodeReply(reply);
    if (!text.includes(phrase)) {
      throw new Error(
        `The panel did not ${action}: ${text === "" ? "no reply" : text}.`,
      );
    }
  }

  async close(): Promise<void> {
    // Released even when the close itself throws: after a failed close the port
    // is no longer this host's, and a stale entry would keep reporting a device
    // nothing is driving.
    heldPanels.delete(this.path);
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
 * A path command: the six-byte command, a one-byte path length, three nulls,
 * the ASCII path, and — for an upload — the file size as int32 little-endian.
 * Framed separately, because every write the panel reads is 250 bytes.
 */
function fileHeader(
  command: Uint8Array,
  remotePath: string,
  size?: number,
): Uint8Array {
  const pathBytes = new TextEncoder().encode(remotePath);
  if (pathBytes.length > 255) {
    throw new Error(`The panel path is too long: ${remotePath}.`);
  }

  const header = new Uint8Array(
    command.length + 4 + pathBytes.length + (size === undefined ? 0 : 4),
  );
  header.set(command);
  header[command.length] = pathBytes.length;
  header.set(pathBytes, command.length + 4);
  if (size !== undefined) {
    new DataView(header.buffer).setInt32(
      command.length + 4 + pathBytes.length,
      size,
      true,
    );
  }

  return frame(header);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function decodeReply(reply: Uint8Array): string {
  return new TextDecoder("latin1").decode(reply).replace(/[\0\s]+$/, "");
}

function parseFileSize(reply: Uint8Array): number | undefined {
  const text = decodeReply(reply).trim();

  return /^\d+$/.test(text) ? Number.parseInt(text, 10) : undefined;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const transcode: Transcode =
    options.transcode ??
    ((bytes, placement) => transcodeForPanel(bytes, { placement }));
  const sleep = options.sleep ?? wait;

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

    heldPanels.set(port.path, {
      vendorId: port.vendorId,
      productId: port.productId,
      serial: port.serialNumber ?? "",
      model: identity.model,
      firmware: identity.firmware,
    });

    return new TurzxPanel(transport, decode, port.path, transcode, sleep);
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
