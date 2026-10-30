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
/** The vendor's pause between H.264 blocks. Shorter overruns the decoder's
 *  input buffer; the block ack's level is polled as a second guard. */
const VIDEO_BLOCK_PAUSE_MS = 30;

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
  /** The background feed, while a video plays. Mutated by `stop` so the loop
   *  sees the cancellation without a second round of awaits. */
  private videoLoop: { stopped: boolean } | undefined;
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

    const png = transparentPng(this.geometry.width, this.geometry.height);
    await this.device.nativeTransferOut(
      ENDPOINT,
      READ_TIMEOUT_MS,
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

    const h264 = await this.encode(mp4, this.geometry, { placement });

    this.stopVideoLoop();
    await this.exclusive(() => this.request("stop-play", READ_TIMEOUT_MS));

    const loop = { stopped: false };
    this.videoLoop = loop;

    // The first block is awaited so an encoder or wire failure still reaches
    // the runner, which then falls back to still frames; the rest is fed in the
    // background at the panel's own pace.
    await this.exclusive(() => this.writeVideoBlock(h264, 0));
    void this.feedVideo(h264, loop);
  }

  private async feedVideo(
    h264: Uint8Array,
    loop: { stopped: boolean },
  ): Promise<void> {
    try {
      let at = H264_BLOCK_BYTES;

      while (!loop.stopped) {
        if (at >= h264.length) at = 0;

        await this.exclusive(async () => {
          if (!loop.stopped) await this.writeVideoBlock(h264, at);
        });

        at += H264_BLOCK_BYTES;
      }
    } catch (error) {
      // Nothing above is awaiting this loop, so a failure has to be said here:
      // the panel keeps whatever it decoded last and the UI overlay goes on.
      if (!loop.stopped) {
        console.error(
          `Panel video: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async writeVideoBlock(h264: Uint8Array, at: number): Promise<void> {
    const end = Math.min(at + H264_BLOCK_BYTES, h264.length);
    const block = h264.subarray(at, end);

    await this.writeFrame(
      commandPacket(
        "play-block",
        this.elapsed(),
        { payloadLength: block.length, lastBlock: end === h264.length },
        block,
      ),
    );

    await new Promise((resolve) => setTimeout(resolve, VIDEO_BLOCK_PAUSE_MS));

    // Same flow control as the vendor driver: a level above 3 means the
    // decoder has not drained, and the next block would be dropped.
    const ack = await this.read(READ_TIMEOUT_MS);
    if (ack !== undefined && ack[8] !== undefined && ack[8] > 3) {
      await this.drain();
    }
  }

  /** Stops feeding and tells the panel, in that order: a block written after
   *  `StopPlay` starts a new playback nobody is feeding. */
  private async stopVideo(): Promise<void> {
    this.stopVideoLoop();
    if (!this.opened) return;
    await this.exclusive(() => this.request("stop-play", READ_TIMEOUT_MS));
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
      await this.request("overlay-layer", READ_TIMEOUT_MS, { parameter: 1 });
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
      await this.device.nativeTransferOut(ENDPOINT, READ_TIMEOUT_MS, write);
    } catch {
      await this.clearHalt();
      await this.device.nativeTransferOut(ENDPOINT, READ_TIMEOUT_MS, write);
    }
  }

  private async clearHalt(): Promise<void> {
    await this.device.clearHalt("out", ENDPOINT).catch(() => {});
    await this.device.clearHalt("in", ENDPOINT).catch(() => {});
  }

  private async drain(): Promise<void> {
    // The vendor cadence: poll every 50 ms, stop at level 2, and give up after
    // 30 s rather than holding the panel open forever.
    for (let attempt = 0; attempt < 600; attempt += 1) {
      const ack = await this.request("buffer-level", READ_TIMEOUT_MS);
      if (ack === undefined || ack[8] === undefined || ack[8] <= 2) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
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
