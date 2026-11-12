import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  PanelControlCommand,
  PanelControls,
  PanelDevice,
  PanelFamily,
  PanelHint,
  PanelVideo,
  PanelVideoPlacement,
} from "./panel-device.js";
import { decodePngRgba } from "./png-raster.js";
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
/**
 * The stored-size probe's own cap, shorter than a command's answer.
 *
 * A missing file has no verified reply, and a missed answer only means
 * "upload". Waiting out the ack timeout on the device that most needs the clip
 * adds ten seconds to every new video; a re-upload costs less than that.
 */
export const SIZE_PROBE_TIMEOUT_MS = 2_000;
/** The panel dropped an overlay update sent 8 ms after init; 1.5 s worked. */
const OVERLAY_SETTLE_MS = 1500;
/**
 * Shortest gap between two overlay updates, in milliseconds.
 *
 * The firmware stops draining its OUT endpoint under a live stream of updates:
 * 20–41 KB diffs sent every 1.5–2.5 s stalled it at update 87 (and at 56–90
 * across other runs), while the payloads were all well formed. The bytes are
 * not the cause — full still frames push far more data safely — so the panel's
 * own ingest is the ceiling. A 3 s floor carried 332 updates over 22 minutes and
 * 5 s carried 296 over 31 (measured 2026-11-12); a held-back frame is not a lost
 * one, because `previousOverlay` advances only when an update lands.
 */
const OVERLAY_MIN_GAP_MS = 3_000;
/** A 249-byte chunk plus its `0x00` pad is one frame. */
const FILE_CHUNK_BYTES = 249;
/**
 * Frames per write.
 *
 * The device reads a byte stream, not one write per frame, so a 249-byte write
 * buys nothing but a `write`+`drain` round trip: a 1.8 MB panel clip is about
 * 7,400 of them, and each waits for the port to drain before the next starts.
 * That was the upload's whole duration. 64 frames is 16 KB — far under the
 * 1.54 MB `present()` already writes in one call — and the bytes on the wire
 * are unchanged, frame for frame.
 */
const UPLOAD_BATCH_FRAMES = 64;
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
/** The upload's two acks: the file was opened, then the panel finished it. */
const UPLOAD_ACKS = ["create_success", "file_rev_done"] as const;
const OVERLAY_INIT_FAILED = "seq_png_init_failed";
/** Storage the vendor firmware reads clips from. */
const VIDEO_DIRECTORY = "/mnt/SDCARD/video";

/** The transcode the adapter runs before it uploads; a test seam. */
type Transcode = (
  bytes: Uint8Array,
  placement: PanelVideoPlacement,
  rotation: number,
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
  /** The OS instance id, for a reset that has to name the device. */
  readonly deviceId?: string;
}

const heldPanels = new Map<string, HeldPanel>();

/** One decoded still, in the shape the panel's own wire takes. */
export interface RawFrame {
  readonly width: number;
  readonly height: number;
  /** Straight RGBA, 4 bytes per pixel, row-major, top-left origin. */
  readonly rgba: Uint8Array;
}

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
  /** The host's disposable cache directory for encoded clips. */
  readonly cacheDir?: string;
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function quietlyClose(transport: SerialTransport): Promise<void> {
  try {
    return transport.close().catch(() => undefined);
  } catch {
    return Promise.resolve();
  }
}

/**
 * A listed port that opened but never answered, as the record's hint.
 *
 * It stays listed, with its OS instance id: the only way back is restarting the
 * USB node, and that action cannot name a device the host has already forgotten.
 */
function silentHint(
  port: SerialPortInfo & { vendorId: number; productId: number },
  detail: string,
): PanelHint {
  return {
    vendorId: port.vendorId,
    productId: port.productId,
    serial: port.serialNumber ?? "",
    label: LABEL,
    status: "disconnected",
    reason: notAnswering(detail).message,
    ...(port.pnpId === undefined ? {} : { deviceId: port.pnpId }),
  };
}

/**
 * The open refusal an owner can act on: the TURZX vendor app is the usual
 * holder, and the sentence is the same one the start path shows.
 */
function heldReason(message: string): string {
  return (
    `${LABEL} could not be opened: ${message}. Another program holding it — the ` +
    "TURZX vendor app is the usual one — has to be closed first."
  );
}

/** The codes a held COM port answers with on Windows and Linux. */
const HELD_OPEN_CODES = new Set(["EBUSY", "EACCES", "EPERM"]);

/**
 * The named reason when `error` means another process holds the port, or
 * nothing when the port merely vanished. The two must not be conflated: a
 * missing panel needs its cable checked, a held one needs the vendor app shut.
 */
function heldOpenReason(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
  const held =
    (code !== undefined && HELD_OPEN_CODES.has(code)) ||
    /access (?:is )?denied|permission denied|busy|being used/i.test(message);

  return held ? heldReason(message) : undefined;
}

/**
 * Every attached panel, one hint each.
 *
 * A port with no USB ids is invisible to a record, so it is not opened. A port
 * another program holds is reported as `disconnected` with the reason the
 * start path gives, rather than dropped: the owner can see it plugged in. A
 * recorded panel is stated only while its port is still in the listing — the
 * recording stands in for a port the host cannot reopen, not for a cable that
 * is gone.
 */
export async function attachedTurzxPanels(
  options: TurzxOptions = {},
): Promise<readonly PanelHint[]> {
  const ports = await (options.ports ?? listSerialPorts)();
  const open = options.open ?? openSerialPort;
  const present = new Set(ports.map((port) => port.path));
  const hints: PanelHint[] = [];

  // A panel this host is driving is stated from what opening it already told
  // us: its port cannot be reopened to ask again. Once the port leaves the
  // listing, the entry is what keeps an unplugged panel looking attached.
  for (const [path, panel] of heldPanels) {
    if (!present.has(path)) {
      heldPanels.delete(path);
      continue;
    }

    hints.push({
      vendorId: panel.vendorId,
      productId: panel.productId,
      serial: panel.serial,
      label: LABEL,
      model: panel.model,
      firmware: panel.firmware,
      ...(panel.deviceId === undefined ? {} : { deviceId: panel.deviceId }),
    });
  }

  for (const port of ports) {
    if (!hasIds(port)) continue;
    if (heldPanels.has(port.path)) continue;

    let transport: SerialTransport;
    try {
      transport = await open(port.path);
    } catch (error) {
      const reason = heldOpenReason(error);
      if (reason !== undefined) {
        hints.push({
          vendorId: port.vendorId,
          productId: port.productId,
          serial: port.serialNumber ?? "",
          label: LABEL,
          status: "disconnected",
          reason,
          ...(port.pnpId === undefined ? {} : { deviceId: port.pnpId }),
        });
      }
      continue;
    }

    try {
      const identity = await identify(transport);
      // Silence is not evidence of a wedged panel: a device that answers with
      // something else is simply not this family. Only a write that never
      // completes means the endpoint stopped taking data.
      if (identity === undefined) continue;

      hints.push({
        vendorId: port.vendorId,
        productId: port.productId,
        serial: port.serialNumber ?? "",
        label: LABEL,
        model: identity.model,
        firmware: identity.firmware,
        ...(port.pnpId === undefined ? {} : { deviceId: port.pnpId }),
      });
    } catch (error) {
      // A device that opened and stopped taking data is present, not absent:
      // the record needs it listed so its owner can restart the USB node.
      hints.push(silentHint(port, messageOf(error)));
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
    commands: [
      "brightness",
      "screen",
      "panel-settings",
      "restart",
      "status",
      "hello",
    ],
    run: (command) => this.runControl(command),
  };

  private queue: Promise<unknown> = Promise.resolve();
  /** The transparent overlay sent at init; the diff encoder updates from it. */
  private previousOverlay: Uint8Array | undefined;
  /** UPDATE_BITMAP's count field: the verified probe sent 0 first. */
  private overlayCount = 0;
  /** When the last overlay update was sent, for the gap below. */
  private lastOverlayAt = 0;
  /**
   * The brightness byte this host last wrote, full by default.
   *
   * The settings packet carries brightness in its first byte and the panel
   * offers no read-back, so a mode or flip change would otherwise rewrite the
   * level with a value nobody chose. What the owner set before this host
   * started is unknown and is replaced by this one's last write.
   */
  private brightnessWeight = 255;
  /** True between a screen-off and a screen-on, so every later brightness
   *  write stays dark until the owner asks for light again. */
  private screenOff = false;
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
      start: (mp4, placement, rotation = 0) =>
        this.startVideo(mp4, placement, rotation),
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
    rotation: number,
  ): Promise<void> {
    await this.enqueue(async () => {
      const began = Date.now();
      const transcoded = await this.transcode(mp4, placement, rotation);
      if (!transcoded.ok) throw new Error(transcoded.message);
      const encoded = Date.now();

      const remotePath = `${VIDEO_DIRECTORY}/yunari-${sha256(transcoded.bytes).slice(0, 16)}.mp4`;
      const stored = await this.fileSize(remotePath);
      const sized = Date.now();

      if (stored !== transcoded.bytes.length) {
        if (stored > 0) {
          await this.send(fileHeader(TURZX_COMMAND.deleteFile, remotePath));
        }
        await this.upload(remotePath, transcoded.bytes);
      }
      const uploaded = Date.now();

      await this.send(fileHeader(TURZX_COMMAND.startVideo, remotePath));

      // **The panel is looping the clip from this point.** The runner only
      // marks the clip playing once this method resolves, so a failure here —
      // the start's own ack timing out, the overlay's init refused, an earlier
      // clip's delete — would leave it running with no host behind it. Stop it
      // before rethrowing, and keep the original error when the stop fails too:
      // that failure is the reason the caller must hear.
      try {
        await this.readFor("play_video_success");
        const started = Date.now();

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
        const settled = Date.now();

        // One line per start, as the panel manager keeps one per runner: the
        // first video is the slow one, so the phases that follow the cache hit
        // are what a report of "uploads are slow" has to name.
        console.log(
          `Panel ${this.path}: clip ready in ${settled - began} ms ` +
            `(encode ${encoded - began}, size ${sized - encoded}, ` +
            `upload ${uploaded - sized}, start ${started - uploaded}, ` +
            `overlay ${settled - started}).`,
        );

        this.previousOverlay = transparent;
        // A fresh init re-renders from scratch, so a count carried over from the
        // last session is meaningless. The probe sent 0 first and the panel took
        // it, so the field's meaning is unverified; Task 12 observes it.
        this.overlayCount = 0;
        // The settle above is the wait this first update needed; the pacing gap
        // belongs to a stream, not to the frame after an init.
        this.lastOverlayAt = 0;
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
   * keeps the frame as the base for the next diff. Answers `false` inside the
   * pacing gap, having sent nothing and kept the older base.
   */
  private async presentOverlay(png: Uint8Array): Promise<boolean> {
    return this.enqueue(async () => {
      const previous = this.previousOverlay;
      if (previous === undefined) {
        throw new Error(
          "The panel's overlay is not initialized; start the video before sending an update.",
        );
      }

      if (Date.now() - this.lastOverlayAt < OVERLAY_MIN_GAP_MS) return false;

      const current = await this.decode(
        png,
        this.geometry.width,
        this.geometry.height,
      );
      const update = overlayUpdate(previous, current.rgba, this.geometry);

      const count = this.overlayCount;
      if (process.env["YUNARI_PANEL_DEBUG"] !== undefined) {
        console.error(
          `[turzx ${this.path}] overlay ${count}: image ${update.imageSize} B, visible ${update.visibleBytes} B, body ${update.body.length} B`,
        );
      }
      await this.send(
        overlayHeader(update.imageSize, count, update.visibleBytes),
      );
      await this.send(update.body);
      // Advance only once both writes landed, so a failed update does not skip
      // a number. The first update carries 0, the value the verified probe
      // sent; whether the count matters is Task 12's observation.
      this.overlayCount = count + 1;
      this.lastOverlayAt = Date.now();
      this.previousOverlay = current.rgba;
      return true;
    });
  }

  /** The device's stored size for `remotePath`, or 0 when it holds nothing. */
  private async fileSize(remotePath: string): Promise<number> {
    await this.send(fileHeader(TURZX_COMMAND.getFileSize, remotePath));

    // ponytail: GET_FILE_SIZE's reply for a missing file is unverified; no
    // numeral within the cap means unknown, so upload rather than strand the
    // panel that is exactly the one needing the clip.
    return (
      (await this.readReplies(parseFileSizeText, SIZE_PROBE_TIMEOUT_MS))
        .accepted ?? 0
    );
  }

  private async upload(remotePath: string, bytes: Uint8Array): Promise<void> {
    await this.send(
      fileHeader(TURZX_COMMAND.uploadFile, remotePath, bytes.length),
    );

    // **`create_success` first, before any chunk.** A chunk written before the
    // panel has opened the file is dropped: the panel then answers neither ack
    // and the upload strands (rom1.88, measured — the same bytes land when the
    // create is waited for). `file_rev_done` says the panel finished writing.
    // Starting the clip between them is refused: START_VIDEO went unanswered
    // and the runner fell back to full-frame stills.
    const seen = new Set<string>();

    await this.readUntil('"create_success"', (text) => {
      for (const phrase of UPLOAD_ACKS) {
        if (text.includes(phrase)) seen.add(phrase);
      }

      return seen.has("create_success") ? true : undefined;
    });

    // Whole frames are batched into one write. Each still ends on its own 250-
    // byte boundary with its own pad, so the stream the panel reads is identical;
    // only the number of host-side drains changes.
    const batch = new Uint8Array(UPLOAD_BATCH_FRAMES * FRAME_SIZE);
    let filled = 0;
    for (let start = 0; start < bytes.length; start += FILE_CHUNK_BYTES) {
      const framed = frame(bytes.subarray(start, start + FILE_CHUNK_BYTES));
      batch.set(framed, filled);
      filled += framed.length;
      if (filled === batch.length) {
        await this.send(batch);
        filled = 0;
      }
    }
    if (filled > 0) await this.send(batch.subarray(0, filled));

    // A firmware that emits the completion before the create has already said
    // it; waiting again would be waiting for a reply it does not send twice.
    if (!seen.has("file_rev_done")) await this.readFor("file_rev_done");
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
    readTimeoutMs: number = FILE_TIMEOUT_MS,
  ): Promise<{ readonly accepted: T | undefined; readonly last: string }> {
    let last = "";
    const deadline = Date.now() + FILE_REPLY_DEADLINE_MS;

    while (Date.now() < deadline) {
      const text = decodeReply(await this.transport.read(readTimeoutMs));
      if (text === "") return { accepted: undefined, last };

      const accepted = accept(text);
      if (accepted !== undefined) return { accepted, last: text };

      last = text;
    }

    return { accepted: undefined, last };
  }

  /** The brightness byte the panel should be showing right now. */
  private brightnessByte(): number {
    return this.screenOff ? 0 : this.brightnessWeight;
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
          // The settings packet rewrites this byte, so it carries this value.
          // Asking for a level is also asking for the screen back.
          this.brightnessWeight = weight;
          this.screenOff = false;

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
          // **Brightness, not the sleep opcode.** 131 takes the panel off the
          // USB bus — its port disappears and nothing can be written after it —
          // so a screen turned off that way could not be turned back on. Zero
          // brightness draws nothing and leaves the port open; waking restores
          // the level this host last wrote, which is what the vendor does before
          // it sleeps the panel.
          this.screenOff = !on;
          await this.send(
            frame(
              Uint8Array.of(...TURZX_COMMAND.brightness, this.brightnessByte()),
            ),
          );

          // Write-only: the device answers nothing.
          return "";
        });
      }
      case "panel-settings": {
        const { startMode, flip, sleepDelay } = command;
        if (startMode !== 0 && startMode !== 1 && startMode !== 2) {
          throw new Error(
            `The start mode must be 0, 1 or 2; received ${startMode}.`,
          );
        }
        if (typeof flip !== "boolean") {
          throw new Error("The image flip needs flip to be true or false.");
        }
        if (
          !Number.isInteger(sleepDelay) ||
          sleepDelay < 0 ||
          sleepDelay > 10
        ) {
          throw new Error(
            `The sleep delay must be a whole number from 0 to 10; received ${sleepDelay}.`,
          );
        }

        return await this.enqueue(async () => {
          await this.send(
            frame(
              Uint8Array.of(
                ...TURZX_COMMAND.panelSettings,
                this.brightnessByte(),
                startMode,
                0,
                flip ? 1 : 0,
                sleepDelay,
              ),
            ),
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
    const framed = frame(bytes);
    const debugging = process.env["YUNARI_PANEL_DEBUG"] !== undefined;
    if (!debugging) return this.transport.write(framed);

    // Temporary diagnosis for a device that stops consuming mid-write: the
    // duration says whether the wire is keeping up, and the last line before
    // the stall names the write that met the stopped endpoint.
    const began = Date.now();
    return this.transport.write(framed).then(
      () => {
        console.error(
          `[turzx ${this.path}] sent ${framed.length} B in ${Date.now() - began} ms`,
        );
      },
      (error: unknown) => {
        // The exact payload that met the stopped endpoint: replaying it after a
        // USB restart is what tells a malformed frame apart from a device that
        // fell over on its own.
        try {
          writeFileSync(
            join(tmpdir(), `turzx-stall-${Date.now()}.bin`),
            framed,
          );
        } catch {
          // The dump is diagnosis; failing to write it must not hide the send.
        }
        console.error(
          `[turzx ${this.path}] send ${framed.length} B failed after ${Date.now() - began} ms: ${String(error)}`,
        );
        throw error;
      },
    );
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

/**
 * A text reply, cut at the first NUL.
 *
 * The wire pads replies with NULs, and a burst can carry a drained reply's tail
 * followed by this command's answer — observed on hardware as the same phrase
 * twice, NULs between. The first NUL is the boundary; everything after it is
 * not part of one reply.
 */
function decodeReply(reply: Uint8Array): string {
  return new TextDecoder("latin1")
    .decode(reply)
    .split("\0")[0]!
    .replace(/\s+$/, "");
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
  // In process, because the rasteriser wrote this PNG itself: a spawn and a
  // 70 MB digest per frame is a subprocess the host already paid to avoid.
  const decode =
    options.decode ??
    ((bytes: Uint8Array, width: number, height: number) =>
      Promise.resolve({
        width,
        height,
        rgba: decodePngRgba(bytes, width, height),
      }));
  const transcode: Transcode =
    options.transcode ??
    ((bytes, placement, rotation) =>
      transcodeForPanel(bytes, {
        placement,
        rotation,
        ...(options.cacheDir === undefined
          ? {}
          : { cacheDir: options.cacheDir }),
      }));
  const sleep = options.sleep ?? wait;

  const candidates = ports.filter(hasIds);

  if (candidates.length === 0) throw notAttached();

  let held: string | undefined;
  /** The first port that opened but never answered: attached, not absent. */
  let unanswered: string | undefined;

  for (const port of candidates) {
    let transport: SerialTransport;
    try {
      transport = await open(port.path);
    } catch (error) {
      // Only a port another process holds earns the vendor-app sentence; one
      // that vanished is the missing-panel answer below.
      held = heldOpenReason(error);
      continue;
    }

    let identity: TurzxIdentity | undefined;
    try {
      identity = await identify(transport);
    } catch (error) {
      unanswered = messageOf(error);
      identity = undefined;
    }

    if (identity === undefined) {
      unanswered ??= "HELLO was not answered.";
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
      ...(port.pnpId === undefined ? {} : { deviceId: port.pnpId }),
    });

    return new TurzxPanel(transport, decode, port.path, transcode, sleep);
  }

  if (held !== undefined) throw new Error(held);
  if (unanswered !== undefined) throw notAnswering(unanswered);

  throw notAttached();
}

/**
 * A device that opened and then stopped taking data is neither absent nor held
 * by another program: it needs its USB node reset, and that is an elevated
 * action on this machine.
 */
function notAnswering(detail: string): Error {
  return new Error(
    `${LABEL} is attached but did not answer: ${detail} ` +
      "Unplug and replug it, or restart its USB device.",
  );
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
    commands: [
      "brightness",
      "screen",
      "panel-settings",
      "restart",
      "status",
      "hello",
    ],
    support: {
      maker: "TURZX",
      hardwareRevision: "Rev C",
      supportedFirmware: ["1.88"],
      updatedAt: "2026-10-29",
    },
    geometry: {
      width: TURZX_GEOMETRY.width,
      height: TURZX_GEOMETRY.height,
    },
    attached: () => attachedTurzxPanels(),
    open: (options) => openTurzxPanel(options),
  },
];
