import { createHash } from "node:crypto";
import type {
  PanelControlCommand,
  PanelControls,
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
  FRAME_SIZE,
  frame,
  overlayHeader,
  overlayUpdate,
  parseHello,
  parseHelloText,
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
/**
 * A file command's answer loop gives up after this long, not after a fixed
 * number of reads: the transport now retains every ack the device sent, and a
 * start writes three commands whose acks can all sit ahead of the reply.
 */
const FILE_REPLY_DEADLINE_MS = 30_000;
/**
 * The overlay init's two answers; the bare prefix is not one of them.
 *
 * ponytail: `seq_png_init_sucess` was observed on hardware; the `_failed`
 * phrase is inherited from the vendor protocol's spelling and has never been
 * captured. A hardware run that sees a refusal must record its exact text.
 */
const OVERLAY_INIT_OK = "seq_png_init_sucess";
const OVERLAY_INIT_FAILED = "seq_png_init_failed";
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

  /** The still is decoded to BGRA, so a lossy intermediate is loss for nothing. */
  readonly stillFormat = "png";

  readonly video: PanelVideo;

  /** Hardware controls, percent in and the byte mapping kept here. */
  readonly controls: PanelControls = {
    commands: ["brightness", "screen", "restart", "status", "hello"],
    run: (command) => this.runControl(command),
  };

  private queue: Promise<unknown> = Promise.resolve();
  /** The transparent overlay sent at init; the diff encoder updates from it. */
  private previousOverlay: Uint8Array | undefined;
  /** UPDATE_BITMAP's count field: the verified probe sent 0 first. */
  private overlayCount = 0;
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
      presentOverlay: (png) => this.presentOverlay(png),
      stop: () => this.enqueue(() => this.send(TURZX_COMMAND.stopVideo)),
    };
  }

  /** Already opened by `openTurzxPanel`, which is the family's `open`. */
  async open(): Promise<void> {}

  async present(still: Uint8Array): Promise<void> {
    await this.enqueue(async () => {
      const raw = await this.decode(
        still,
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

      // **The panel is looping the clip from this point.** The runner only
      // marks the clip playing once this method resolves, so a failure here —
      // the start's own ack timing out, the overlay's init refused, an earlier
      // clip's delete — would leave it running with no host behind it. Stop it
      // before rethrowing, and keep the original error when the stop fails too:
      // that failure is the reason the caller must hear.
      try {
        await this.readFor("play_video_success");

        await this.send(TURZX_COMMAND.preUpdate);
        await this.send(TURZX_COMMAND.startBitmap);
        await this.send(TURZX_COMMAND.displayOnVideo);

        // The overlay starts fully transparent: every pixel the UI does not
        // paint shows the playing video underneath.
        const transparent = new Uint8Array(
          this.geometry.width * this.geometry.height * 4,
        );
        await this.send(bgraPayload(transparent));
        await this.send(frame(TURZX_COMMAND.initVideoOverlay));
        await this.send(frame(TURZX_COMMAND.overlayTerminate));

        // Init answers `seq_png_init_sucessneedReSend:0|renderCnt:N`; the first
        // update must wait out the panel's settle. A failed init says so in the
        // same territory and must not be treated as a ready overlay. The full
        // word is matched: a reply split after the shared prefix is not an
        // answer either way.
        const init = await this.readUntil('"seq_png_init_"', (text) =>
          text.includes(OVERLAY_INIT_OK) || text.includes(OVERLAY_INIT_FAILED)
            ? text
            : undefined,
        );
        if (init.includes(OVERLAY_INIT_FAILED)) {
          throw new Error(
            `The panel could not initialize its overlay: ${init}.`,
          );
        }
        await this.sleep(OVERLAY_SETTLE_MS);
        await this.send(TURZX_COMMAND.queryStatus);

        this.previousOverlay = transparent;
        // A fresh init re-renders from scratch, so a count carried over from the
        // last session is meaningless. The probe sent 0 first and the panel took
        // it, so the field's meaning is unverified; Task 12 observes it.
        this.overlayCount = 0;
        if (
          this.previousVideoPath !== undefined &&
          this.previousVideoPath !== remotePath
        ) {
          await this.send(
            fileHeader(TURZX_COMMAND.deleteFile, this.previousVideoPath),
          );
        }
        this.previousVideoPath = remotePath;
      } catch (error) {
        try {
          await this.send(TURZX_COMMAND.stopVideo);
        } catch {
          // The clip's stop is best-effort; the original failure is the answer.
        }
        throw error;
      }
    });
  }

  /**
   * Sends one overlay diff over the playing video: the UPDATE_BITMAP header and
   * its body in one queue slot, so no control command lands between them, then
   * keeps the frame as the base for the next diff.
   */
  private async presentOverlay(png: Uint8Array): Promise<void> {
    await this.enqueue(async () => {
      const previous = this.previousOverlay;
      if (previous === undefined) {
        throw new Error(
          "The panel's overlay is not initialized; start the video before sending an update.",
        );
      }

      const current = await this.decode(
        png,
        this.geometry.width,
        this.geometry.height,
      );
      const update = overlayUpdate(previous, current.rgba, this.geometry);

      const count = this.overlayCount;
      await this.send(
        overlayHeader(update.imageSize, count, update.visibleBytes),
      );
      await this.send(update.body);
      // Advance only once both writes landed, so a failed update does not skip
      // a number. The first update carries 0, the value the verified probe
      // sent; whether the count matters is Task 12's observation.
      this.overlayCount = count + 1;
      this.previousOverlay = current.rgba;
    });
  }

  /** The device's stored size for `remotePath`, or 0 when it holds nothing. */
  private async fileSize(remotePath: string): Promise<number> {
    await this.send(fileHeader(TURZX_COMMAND.getFileSize, remotePath));

    // ponytail: GET_FILE_SIZE's reply for a missing file is unverified; no
    // numeral within the cap means unknown, so upload rather than strand the
    // panel that is exactly the one needing the clip.
    return (await this.readReplies(parseFileSizeText)).accepted ?? 0;
  }

  private async upload(remotePath: string, bytes: Uint8Array): Promise<void> {
    await this.send(
      fileHeader(TURZX_COMMAND.uploadFile, remotePath, bytes.length),
    );

    for (let start = 0; start < bytes.length; start += FILE_CHUNK_BYTES) {
      await this.send(frame(bytes.subarray(start, start + FILE_CHUNK_BYTES)));
    }

    await this.readFor("create_success");
  }

  /**
   * The first reply carrying `phrase`; earlier stale acks are skipped and an
   * empty read or the deadline ends the wait. Only init, query, start and
   * create are recorded as text replies, so a phrase match is all this protocol
   * can pin.
   */
  private readFor(phrase: string): Promise<string> {
    return this.readUntil(`"${phrase}"`, (text) =>
      text.includes(phrase) ? text : undefined,
    );
  }

  /**
   * Reads until `accept` answers, then returns that answer.
   *
   * `openTurzxPanel` ends on QUERY_STATUS, so its text reply is buffered and is
   * the first bytes the next read returns; a DELETE_FILE acknowledgement may
   * trail a reply too. Accepting by content rather than by position tolerates
   * those, and an empty read or the deadline keeps a foreign device from
   * hanging the queue.
   */
  private async readUntil<T>(
    wanted: string,
    accept: (text: string) => T | undefined,
  ): Promise<T> {
    const { accepted, last } = await this.readReplies(accept);
    if (accepted !== undefined) return accepted;

    throw new Error(
      `The panel did not answer with ${wanted}; last reply: ${
        last === "" ? "no reply" : last
      }.`,
    );
  }

  /**
   * Reads until `accept` answers, an empty read ends the wait, or the deadline.
   *
   * A non-empty reply that does not match is a stale ack from an earlier
   * command — the port retains them now — and is skipped rather than spending
   * the one attempt the reply was supposed to get. An empty read is the
   * transport's 10 s cap for a device that said nothing, so the trade is a fast
   * answer for a `GET_FILE_SIZE` the device never acknowledges rather than a
   * full 30 s wait. The last non-empty reply is returned even when nothing was
   * accepted, so the caller can name it.
   */
  private async readReplies<T>(
    accept: (text: string) => T | undefined,
  ): Promise<{ readonly accepted: T | undefined; readonly last: string }> {
    let last = "";
    const deadline = Date.now() + FILE_REPLY_DEADLINE_MS;

    while (Date.now() < deadline) {
      const text = decodeReply(await this.transport.read(FILE_TIMEOUT_MS));
      if (text === "") return { accepted: undefined, last };

      const accepted = accept(text);
      if (accepted !== undefined) return { accepted, last: text };

      last = text;
    }

    return { accepted: undefined, last };
  }

  /**
   * One control on the same queue as the frames, so a write cannot land inside
   * a frame or between an overlay header and its body.
   *
   * A brightness the panel cannot take is refused before it reaches the wire;
   * so is a fraction, rather than rounded into a value the owner did not ask
   * for.
   */
  private async runControl(command: PanelControlCommand): Promise<string> {
    switch (command.kind) {
      case "brightness": {
        const level = command.level;
        if (!Number.isInteger(level)) {
          throw new Error(
            `The brightness must be a whole percent; received ${level}.`,
          );
        }
        if (level < 0 || level > 100) {
          throw new Error(
            `The brightness must be from 0 to 100; received ${level}.`,
          );
        }

        return await this.enqueue(async () => {
          const weight = Math.round((level / 100) * 255);
          await this.send(
            frame(Uint8Array.of(...TURZX_COMMAND.brightness, weight)),
          );

          // Write-only: the device answers nothing, and a host sentence here
          // would be shown as the panel's reply.
          return "";
        });
      }
      case "screen": {
        const on = command.on;
        // A route that lost the field would otherwise read as "off": blanking
        // the panel is a state change nobody asked for.
        if (typeof on !== "boolean") {
          throw new Error("The screen command needs on to be true or false.");
        }

        return await this.enqueue(async () => {
          await this.send(
            on ? TURZX_COMMAND.screenOn : TURZX_COMMAND.screenOff,
          );

          // Write-only: the device answers nothing.
          return "";
        });
      }
      case "restart":
        return await this.enqueue(async () => {
          await this.send(TURZX_COMMAND.restart);

          // The interface drops for ~15 s, so no reply is read: waiting on the
          // queue here would wedge every later command behind it. The device
          // says nothing, so the reply is empty rather than a host sentence.
          return "";
        });
      case "status":
        return await this.enqueue(async () => {
          // The open-time QUERY_STATUS answer and any earlier ack are not this
          // command's reply; dropping them is what makes one read one answer.
          this.transport.drainPending();
          await this.send(TURZX_COMMAND.queryStatus);

          // ponytail: sending QUERY_STATUS while a video overlay is playing is
          // unverified on hardware; the class doc says a query is never
          // appended after a frame. A hardware run is owed before Task 8 ships
          // a status action during video.
          return await this.readUntil('"QUERY_STATUS"', (text) =>
            isStatusText(text) ? text : undefined,
          );
        });
      case "hello":
        return await this.enqueue(async () => {
          this.transport.drainPending();
          await this.send(TURZX_COMMAND.hello);

          // Only the HELLO shape is an answer; anything earlier was drained.
          return await this.readUntil('"HELLO"', (text) =>
            parseHelloText(text) === undefined ? undefined : text,
          );
        });
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
  const length =
    command.length + 4 + pathBytes.length + (size === undefined ? 0 : 4);
  if (length > FRAME_SIZE) {
    throw new Error(`The panel path is too long: ${remotePath}.`);
  }

  const header = new Uint8Array(length);
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

/** A QUERY_STATUS answer: the panel names its own counters in the reply. */
function isStatusText(text: string): boolean {
  return text.includes("needReSend") || text.includes("renderCnt");
}

function parseFileSizeText(text: string): number | undefined {
  const trimmed = text.trim();

  return /^\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : undefined;
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
