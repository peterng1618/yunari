import { usb } from "usb";
import type {
  PanelDevice,
  PanelFamily,
  PanelHint,
  PanelVideo,
  PanelVideoPlacement,
} from "./panel-device.js";
import { commandPacket, type PanelCommand } from "./panel-protocol.js";
import { transparentPng } from "./tur-usb-overlay.js";
import { encodePanelH264, H264_BLOCK_BYTES } from "./tur-usb-video.js";

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
/** The panel can take this long to answer a command. A shorter read does not
 *  fail politely: the transfer is cancelled, and enough cancellations make the
 *  endpoint refuse writes until the cable is replugged. */
const READ_TIMEOUT_MS = 2_000;
/**
 * **A write is allowed to wait.** The panel NAKs bulk OUT while its H.264
 * buffer drains, and a timeout does not hand back a partial byte count: the
 * URB is cancelled mid-block, and the panel's USB stack then stops answering
 * altogether — the device has to be replugged. The vendor's own pipe timeout
 * is unbounded; five seconds is long enough to outlast a command's drain and
 * short enough to notice a dead cable.
 */
const WRITE_TIMEOUT_MS = 5_000;
/** A clip block waits far longer than a command: it is the transfer that
 *  wedges the panel when it is cancelled, so it is better to sit out a drain
 *  of tens of seconds than to break the device. */
const BLOCK_WRITE_TIMEOUT_MS = 30_000;
/** The level poll's read. Short so a saturated panel costs one cheap attempt
 *  per poll rather than a two-second wait. */
const LEVEL_READ_TIMEOUT_MS = 250;
/** The device refuses a payload past this; measured in both drivers. */
const MAX_PAYLOAD = 512_000;
/** Bounded so a talkative device cannot hold the frame loop; the vendor's own
 *  read_flush has no bound, but ours must not starve a tick. */
const MAX_QUEUED_REPLIES = 16;
/**
 * The panel's own quarter turn. **It is sticky**: whatever L-Connect left
 * persists across power cycles, so a host that does not pin it inherits a
 * picture that is upside down for reasons nothing records. Mode 2 is the one
 * measured upright with the display record's 90° rotation.
 */
const ROTATE_MODE = 2;
/** The vendor's own cadence, from `WinUsb.PlayH264`: a block goes out, the
 *  driver waits 30 ms, then reads the ack, and only a depth above 3 makes it
 *  drain. This host does not pace the feed any other way — the panel's
 *  reported depth is the clock. */
const BLOCK_PAUSE_MS = 30;
/**
 * **The feed leads the picture by 10%, and never by more.** A stream handed
 * over faster than it plays fills the decoder's ring and then starves: the
 * ring shows four blocks of picture (about two seconds), the host stops to let
 * it drain, and the glass runs dry before the feed resumes — the periodic
 * freeze. Sending a little ahead of realtime keeps the ring shallow without
 * letting it empty. The depth gate below is the ceiling; this is the pace.
 */
const FEED_LEAD = 0.9;
/** The depth the vendor drains above (`PlayH264`: `ret[8] > 3`). */
const ACK_DEPTH = 3;
/** The depth it drains to (`waitBuffer(2)`). */
const DRAIN_DEPTH = 2;
const DRAIN_POLL_MS = 50;
/** Bounded so a silent panel cannot hold the feed forever; the vendor waits
 *  until playback is cancelled. */
const DRAIN_WAIT_MS = 30_000;

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

/** The Lian Li screens: one bulk endpoint, one JPEG per frame. */
export const TUR_FAMILIES: readonly PanelFamily[] = [
  {
    id: "lianli-9-2",
    label: 'Lian Li 9.2" LCD',
    vendorId: 0x1cbe,
    productId: 0xa092,
    support: {
      maker: "Lian Li",
      hardwareRevision: '9.2"',
      supportedFirmware: [],
      updatedAt: "2026-10-28",
    },
    commands: [],
    attached: () => attachedPanels(),
    open: () => {
      const model = panelModelFor(0x1cbe, 0xa092);
      if (model === undefined) throw new Error('The 9.2" model is not listed.');
      return openPanel(model);
    },
  },
  {
    id: "lianli-8-8",
    label: 'Lian Li Universal Screen 8.8"',
    vendorId: 0x1cbe,
    productId: 0xa088,
    support: {
      maker: "Lian Li",
      hardwareRevision: '8.8"',
      supportedFirmware: [],
      updatedAt: "2026-10-28",
    },
    commands: [],
    attached: () => attachedPanels(),
    open: () => {
      const model = panelModelFor(0x1cbe, 0xa088);
      if (model === undefined) throw new Error('The 8.8" model is not listed.');
      return openPanel(model);
    },
  },
];

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

export class TurUsbPanel implements PanelDevice {
  readonly geometry: { readonly width: number; readonly height: number };
  /** The panel decodes H.264 itself, so it can play a video background. */
  readonly video: PanelVideo;
  private readonly device: PanelUsbDevice;
  private readonly started = Date.now() - 86_400_000;
  private opened = false;
  /**
   * Whether the PNG layer is showing. The panel keeps it across a push, so the
   * enable is spent once rather than before every frame: re-enabling per push
   * blanks the layer while the new PNG loads, and every push shares the
   * endpoint the clip is being fed on.
   */
  private overlayShown = false;
  /** The background feed, while a video plays. Mutated by `stop` so the loop
   *  sees the cancellation without a second round of awaits. */
  private videoLoop: { stopped: boolean } | undefined;
  /** The block size the panel asked to be fed in, learnt before playback. */
  private blockBytes = H264_BLOCK_BYTES;
  /** The playing clip's length, so each block can wait its own share. Zero
   *  when the encoder did not report a duration: the fixed pause is used. */
  private clipBytes = 0;
  private clipMs = 0;
  /** Every write to the endpoint is queued behind this: a video feed runs on
   *  its own loop, and overlapping it with an overlay push is what the addon
   *  reports as "Cancelled". */
  private lock: Promise<void> = Promise.resolve();

  constructor(
    device: PanelUsbDevice,
    model: PanelShape,
    /** Test seam for the encoder, which spawns ffmpeg in production. */
    private readonly encode: typeof encodePanelH264 = encodePanelH264,
  ) {
    this.device = device;
    this.geometry = { width: model.width, height: model.height };
    this.video = {
      start: (mp4, placement) => this.startVideo(mp4, placement),
      presentOverlay: (png) => this.presentOverlay(png),
      stop: () => this.stopVideo(),
    };
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
    await this.request("rotate", READ_TIMEOUT_MS, { parameter: ROTATE_MODE });
    await this.clearOverlay();
  }

  /**
   * Empties the panel's PNG layer, where L-Connect leaves its sensor
   * dashboard — the last picture survives L-Connect exiting and every JPEG
   * this driver pushes, so a Yunari theme otherwise renders underneath a ghost.
   * A transparent PNG replaces it; the layer must be shown for the push to
   * land, and showing an empty layer changes nothing else.
   */
  private async clearOverlay(): Promise<void> {
    await this.request("overlay-layer", READ_TIMEOUT_MS, { parameter: 1 });
    this.overlayShown = true;

    const png = transparentPng(this.geometry.width, this.geometry.height);
    await this.device.nativeTransferOut(
      ENDPOINT,
      WRITE_TIMEOUT_MS,
      commandPacket(
        "push-png",
        this.elapsed(),
        { payloadLength: png.length },
        png,
      ),
    );
    await this.read(READ_TIMEOUT_MS);
  }

  async present(jpeg: Uint8Array): Promise<void> {
    if (!this.opened) throw new Error("The panel is not open.");
    if (jpeg.length > MAX_PAYLOAD) {
      throw new Error(
        `A ${jpeg.length}-byte frame exceeds the panel's ${MAX_PAYLOAD}-byte limit.`,
      );
    }

    await this.exclusive(() => this.sendFrame(jpeg));
  }

  private async sendFrame(jpeg: Uint8Array): Promise<void> {
    const write = commandPacket(
      "push-jpeg",
      this.elapsed(),
      {
        payloadLength: jpeg.length,
      },
      jpeg,
    );

    // The vendor driver stops playback before **every** frame: a panel that is
    // still playing keeps ingesting into a buffer it never drains, and after
    // about thirty frames every transfer is cancelled.
    await this.request("stop-play", READ_TIMEOUT_MS);

    await this.writeFrame(write);

    // Flow control: byte 8 of the ack is the device's buffer level. A push that
    // arrives faster than the panel drains fills it, and a full buffer is a
    // frame dropped or a panel that stops answering. A frame commonly renders
    // with no readable ack, so a timeout here is normal rather than an error.
    const ack = await this.read(READ_TIMEOUT_MS);
    if (ack !== undefined && ack[8] !== undefined && ack[8] > 3) {
      await this.drain();
    }
  }

  /**
   * Plays an MP4 on the panel's own decoder.
   *
   * The host sends compressed blocks and then stops: motion no longer costs a
   * capture per frame, which is the whole reason this path exists.
   *
   * **The feed is L-Connect's own.** The vendor asks the panel for its block
   * size, tells it the clip's frame rate, and then hands it block after block
   * with a 30 ms pause, flagging the file's final block and draining the ring
   * only when an ack says the decoder has stopped reading. Copying that
   * exactly is what this method does; nothing here invents a cadence.
   *
   * **The feed never ends at end of file.** The panel drains a buffer while the
   * host writes, and the vendor's own driver rewinds and keeps sending for as
   * long as playback is wanted (`WinUsb.PlayH264`, `isRepeat`). A stream that
   * simply stops is a clip that plays once and then rests on its last frame.
   */
  private async startVideo(
    mp4: Uint8Array,
    placement: PanelVideoPlacement,
  ): Promise<void> {
    if (!this.opened) throw new Error("The panel is not open.");

    const clip = await this.encode(mp4, this.geometry, { placement });
    const h264 = clip.h264;
    this.clipBytes = h264.length;
    this.clipMs = clip.seconds * 1000;

    this.stopVideoLoop();

    const loop = { stopped: false };
    this.videoLoop = loop;

    // The first block is awaited so an encoder or wire failure still reaches
    // the runner, which then falls back to still frames; the rest is fed in the
    // background.
    try {
      await this.exclusive(async () => {
        this.blockBytes = await this.queryBlockBytes();
        // The vendor also sets the rate before playback, from the file itself.
        if (clip.fps > 0) {
          await this.request("frame-rate", READ_TIMEOUT_MS, {
            parameter: clip.fps,
          });
        }
        await this.request("stop-play", READ_TIMEOUT_MS);
        await this.writeVideoBlock(h264, 0, loop);
      });
    } catch (error) {
      this.stopVideoLoop();
      throw error;
    }

    void this.feedVideo(h264, loop);
  }

  /** The block size this panel wants, with the vendor's own default when it
   *  answers zero or not at all (`WinUsb.CheckH264Block`). */
  private async queryBlockBytes(): Promise<number> {
    const reply = await this.request("h264-block", READ_TIMEOUT_MS);
    if (reply === undefined || reply.length < 12) return H264_BLOCK_BYTES;

    const size = new DataView(
      reply.buffer,
      reply.byteOffset,
      reply.byteLength,
    ).getUint32(8, false);
    return size === 0 ? H264_BLOCK_BYTES : size;
  }

  private async feedVideo(
    h264: Uint8Array,
    loop: { stopped: boolean },
  ): Promise<void> {
    let at = this.blockBytes;

    while (!loop.stopped) {
      if (at >= h264.length) at = 0;

      const blockBytes = Math.min(this.blockBytes, h264.length - at);
      const started = performance.now();

      try {
        await this.exclusive(async () => {
          if (!loop.stopped) await this.writeVideoBlock(h264, at, loop);
        });
        at += this.blockBytes;
      } catch (error) {
        if (loop.stopped) return;

        // Nothing above is awaiting this loop, so a failure has to be said
        // here: the panel keeps whatever it decoded last and the UI overlay
        // goes on.
        console.error(
          `Panel video: ${error instanceof Error ? error.message : String(error)}. Restarting the clip.`,
        );

        try {
          await this.resync();
        } catch {
          // The next block reports again; a panel that is really gone is the
          // runner's problem, not this loop's.
        }

        at = 0;
      }

      // **The pace is kept outside the endpoint's lock.** Sleeping under it
      // would hold the UI overlay for a whole block's playing time, and the
      // overlay is the only other writer this panel has.
      const playMs =
        this.clipBytes > 0
          ? (blockBytes / this.clipBytes) * this.clipMs * FEED_LEAD
          : 0;
      const spent = performance.now() - started;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(BLOCK_PAUSE_MS, playMs - spent)),
      );
    }
  }

  /**
   * Recovers from a cancelled block transfer.
   *
   * **The block is not rewritten.** A cancelled bulk OUT can leave the decoder
   * holding part of a block, so writing the same bytes again duplicates them
   * into the elementary stream — and a stream whose reference frames are
   * wrong is the ghost trail, not a stutter. Stopping playback and starting
   * again from the clip's first block hands the decoder a fresh keyframe.
   */
  private async resync(): Promise<void> {
    await this.exclusive(async () => {
      await this.clearHalt();
      await this.request("stop-play", READ_TIMEOUT_MS);
    });
  }

  private async writeVideoBlock(
    h264: Uint8Array,
    at: number,
    loop: { stopped: boolean },
  ): Promise<void> {
    const end = Math.min(at + this.blockBytes, h264.length);
    const block = h264.subarray(at, end);

    await this.device.nativeTransferOut(
      ENDPOINT,
      BLOCK_WRITE_TIMEOUT_MS,
      commandPacket(
        "play-block",
        this.elapsed(),
        // **The stream never ends.** The feed wraps and keeps sending while a
        // clip is wanted, the way the vendor driver rewinds. The final block
        // of each pass carries the vendor's end-of-file flag so the panel can
        // finish the stream it was handed.
        {
          payloadLength: block.length,
          lastBlock: end >= h264.length,
        },
        block,
      ),
    );

    // **The ack is the flow control.** Its byte 8 is the decoder's depth: at
    // or below the vendor's threshold the ring is draining, and above it the
    // decoder has stopped reading — another block there is an overrun, which
    // the panel plays out as a freeze.
    const ack = await this.read(LEVEL_READ_TIMEOUT_MS);
    const depth = ack?.[8];
    if (depth !== undefined && depth > ACK_DEPTH) await this.drain(loop);
  }

  /** Waits until the decoder has room, polling the way `waitBuffer(2)` does.
   *
   *  **A long wait here is normal.** The ring holds blocks, and at this clip's
   *  bitrate one block is about a second of picture: draining from four blocks
   *  to two takes about two seconds of playback by construction. Only a drain
   *  that never ends says the decoder has stopped. */
  private async drain(loop?: { stopped: boolean }): Promise<void> {
    const began = Date.now();
    const deadline = began + DRAIN_WAIT_MS;
    let drained = false;

    while (!(loop?.stopped ?? false) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, DRAIN_POLL_MS));

      // A panel that stops answering stops the drain as well: silence is not
      // permission to keep writing.
      const depth = await this.level();
      if (depth === undefined || depth <= DRAIN_DEPTH) {
        drained = true;
        break;
      }
    }

    if (loop?.stopped ?? false) return;

    if (!drained) {
      // The decoder is not reading at all: the picture is starved until it
      // starts again, and nothing else in this host can see that.
      const waited = Date.now() - began;
      console.error(
        `Panel video: the decoder stopped draining after ${waited} ms.`,
      );
    }
  }

  /** The decoder's latest reported depth.
   *
   * **Flush first, then ask.** Every block queues an ack, so a plain read after
   * the poll answers with an ack from an earlier block — a depth that says
   * "room" exactly when there is none. Emptying the queue and then reading the
   * one reply that follows the command is the only reading that describes the
   * ring now. A short timeout keeps a saturated panel from turning each poll
   * into a two-second wait. */
  private async level(): Promise<number | undefined> {
    await this.flushReplies();
    await this.device.nativeTransferOut(
      ENDPOINT,
      WRITE_TIMEOUT_MS,
      commandPacket("buffer-level", this.elapsed()),
    );

    return (await this.readOne(LEVEL_READ_TIMEOUT_MS))?.[8];
  }

  /** Stops feeding and tells the panel, in that order: a block written after
   *  `StopPlay` starts a new playback nobody is feeding. */
  private async stopVideo(): Promise<void> {
    this.stopVideoLoop();
    if (!this.opened) return;
    await this.exclusive(() => this.request("stop-play", READ_TIMEOUT_MS));
    // A stopped clip leaves the layer off; the next overlay enables it again.
    this.overlayShown = false;
  }

  private stopVideoLoop(): void {
    const loop = this.videoLoop;
    this.videoLoop = undefined;
    if (loop !== undefined) loop.stopped = true;
  }

  /** One writer at a time on the endpoint. */
  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.lock;
    let release: () => void = () => {};
    this.lock = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }

  /** Replaces the UI layer over the playing video. The panel composites it
   *  with the decoded picture; alpha is what lets the video show through. */
  private async presentOverlay(png: Uint8Array): Promise<void> {
    if (!this.opened) throw new Error("The panel is not open.");
    if (png.length > MAX_PAYLOAD) {
      throw new Error(
        `A ${png.length}-byte overlay exceeds the panel's ${MAX_PAYLOAD}-byte limit.`,
      );
    }

    await this.exclusive(async () => {
      if (!this.overlayShown) {
        await this.request("overlay-layer", READ_TIMEOUT_MS, { parameter: 1 });
        this.overlayShown = true;
      }
      await this.writeFrame(
        commandPacket(
          "push-png",
          this.elapsed(),
          { payloadLength: png.length },
          png,
        ),
      );
      await this.read(READ_TIMEOUT_MS);
    });
  }

  /** Sends one frame, recovering a stalled endpoint the way the vendor does:
   *  clear both halts and write again. `reset()` is avoided because it takes
   *  down the LED MCU beside the panel. */
  private async writeFrame(write: Uint8Array): Promise<void> {
    try {
      await this.device.nativeTransferOut(ENDPOINT, WRITE_TIMEOUT_MS, write);
    } catch {
      await this.clearHalt();
      await this.device.nativeTransferOut(ENDPOINT, WRITE_TIMEOUT_MS, write);
    }
  }

  private async clearHalt(): Promise<void> {
    await this.device.clearHalt("out", ENDPOINT).catch(() => {});
    await this.device.clearHalt("in", ENDPOINT).catch(() => {});
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
      WRITE_TIMEOUT_MS,
      commandPacket(command, this.elapsed(), fields),
    );

    return this.read(timeoutMs);
  }

  /**
   * One reply, then whatever else the panel already queued.
   *
   * **A reply left unread backs up the IN queue**, and once it is full the panel
   * stops accepting writes — a freeze that reads as a panel fault and only a
   * replug clears. The vendor driver calls `read_flush()` after every read for
   * the same reason. A read with nothing waiting answers with a zero-length
   * transfer rather than a timeout, so this costs one cheap call per command.
   */
  private async read(timeoutMs: number): Promise<Uint8Array | undefined> {
    const first = await this.readOne(timeoutMs);
    await this.flushReplies();
    return first;
  }

  private async flushReplies(): Promise<void> {
    for (let attempt = 0; attempt < MAX_QUEUED_REPLIES; attempt += 1) {
      const reply = await this.readOne(READ_TIMEOUT_MS);
      if (reply === undefined || reply.length === 0) return;
    }
  }

  private async readOne(timeoutMs: number): Promise<Uint8Array | undefined> {
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
    this.stopVideoLoop();
    // Let the block already in flight finish before the interface goes away.
    await this.lock.catch(() => undefined);

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
