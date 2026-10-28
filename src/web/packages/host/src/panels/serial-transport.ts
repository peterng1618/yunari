import { SerialPort } from "serialport";

/**
 * The serial seam the TURZX adapter is written against.
 *
 * **The dependency stops here.** `serialport` is a native module, and the one
 * thing above this file that needs it is a driver whose bytes are unit-tested
 * with a fake; importing the binding anywhere else would make the adapter's
 * tests need a COM port. Everything above reads this interface.
 */

export interface SerialPortInfo {
  readonly path: string;
  readonly vendorId?: number;
  readonly productId?: number;
  readonly serialNumber?: string;
}

export interface SerialTransport {
  write(bytes: Uint8Array): Promise<void>;
  read(timeoutMs: number): Promise<Uint8Array>;
  /**
   * Everything the device has already sent and nobody has read, dropped out of
   * the queue and returned; empty when nothing is pending.
   *
   * A command that reads for an answer of its own must not be handed a reply
   * from before it — the panel answers HELLO and QUERY_STATUS even when nothing
   * asked. This never waits, so it is not a substitute for `read`.
   *
   * **Two contracts, split by whether a read is waiting.** With one, it returns
   * only sealed replies: a burst in progress belongs to that read. With none, it
   * also returns a partial burst **and** discards the rest of it until the wire
   * goes quiet, so the tail of a stale reply cannot be read as the next
   * command's answer.
   */
  drainPending(): Uint8Array;
  close(): Promise<void>;
}

/** The panel is a USB CDC gadget; the baud is nominal, but RTS/CTS is not. */
const BAUD_RATE = 115_200;

/**
 * A hex USB id, or `null` when the string is present but not a number.
 *
 * The distinction matters: an absent id is a port that reports none (skipped by
 * the adapter), while a malformed one is a listing this host cannot trust.
 */
function parseId(raw: string | undefined): number | null | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;

  const value = Number.parseInt(raw.trim(), 16);
  return Number.isNaN(value) ? null : value;
}

/** Every serial port this host can see, dropping listings with broken ids. */
export async function listSerialPorts(): Promise<readonly SerialPortInfo[]> {
  const ports: SerialPortInfo[] = [];

  for (const port of await SerialPort.list()) {
    const vendorId = parseId(port.vendorId);
    const productId = parseId(port.productId);
    if (vendorId === null || productId === null) continue;

    ports.push({
      path: port.path,
      ...(vendorId === undefined ? {} : { vendorId }),
      ...(productId === undefined ? {} : { productId }),
      ...(port.serialNumber === undefined
        ? {}
        : { serialNumber: port.serialNumber }),
    });
  }

  return ports;
}

/** A reply that has gone quiet this long is complete; the wire has no frame end. */
const READ_QUIET_MS = 50;

/**
 * Replies held for a later read. A device that chatters while nothing reads is
 * a device whose older replies matter least: the cap keeps the newest 64 and
 * drops the oldest sealed reply, matching reply or not.
 */
const MAX_QUEUED_REPLIES = 64;

/** The slice of `serialport`'s `SerialPort` the read seam needs, for a fake. */
export interface SerialPortLike {
  readonly isOpen: boolean;
  close(callback?: (error: Error | null | undefined) => void): unknown;
  on(event: "data", listener: (chunk: Buffer) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  off(event: "data", listener: (chunk: Buffer) => void): unknown;
  off(event: "error", listener: (error: Error) => void): unknown;
}

/**
 * A transport over a `SerialPort`-shaped object.
 *
 * The fake seam is deliberately narrower than `serialport`'s overloaded
 * `write`, which no structural fake reproduces; production passes the real
 * `SerialPort`, tests pass an emitter, and only `read` reaches the port itself.
 * A write after `close()` is refused before the port is touched, so that guard
 * is testable through this seam too.
 */
export function transportOver(port: SerialPortLike): SerialTransport {
  return new OpenSerialPort(port as unknown as SerialPort);
}

/**
 * One open port, with the two shapes the adapter needs.
 *
 * A write resolves after `drain` rather than after `write`: `write` only hands
 * the bytes to the OS, and a panel ignores a frame that arrives half-sent.
 *
 * **The data listener belongs to the port, not to a read.** A reply can arrive
 * while the caller is still writing — the panel acknowledges an upload before
 * the last chunk is drained — and a listener attached only for the duration of
 * `read` would drop exactly those bytes. So one listener runs for the port's
 * life, and reads drain what it collected.
 *
 * A reply is a burst: everything the device sends, sealed by a quiet gap of
 * `READ_QUIET_MS`. Sealing happens whether or not a read is waiting, and the
 * wire has no frame end, so two replies separated by more than that gap come
 * back as two reads in arrival order; a single reply split by more than the
 * same gap comes back as two reads, because the transport cannot tell that
 * apart from two replies and does not guess. A reply that already arrived is
 * answered at once. `timeoutMs` is the hard ceiling, after which a read answers
 * whatever it holds — empty for a device that never speaks.
 */
class OpenSerialPort implements SerialTransport {
  /** Whole replies the device sent while no read was waiting. */
  private readonly queued: Uint8Array[] = [];
  /** The burst still arriving, not yet sealed by the quiet gap. */
  private burst: Buffer[] = [];
  /** Seals `burst` after the wire has been quiet long enough. */
  private quiet: ReturnType<typeof setTimeout> | undefined;
  /** After a drain: incoming chunks are a stale reply's tail, not an answer. */
  private discarding = false;
  /** The one read waiting for a reply; the adapter reads sequentially. */
  private waiting:
    | {
        readonly resolve: (bytes: Uint8Array) => void;
        readonly timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
  /** Reads run one at a time: two callers must not share one waiter slot. */
  private reading: Promise<unknown> = Promise.resolve();
  private closed = false;

  private readonly onData = (chunk: Buffer): void => {
    // The rest of a drained reply's burst seals later and would otherwise be
    // served to the next read as that command's answer.
    if (!this.discarding) this.burst.push(chunk);
    this.armQuiet();
  };

  /**
   * A disconnect mid-read must not wait out the read cap.
   *
   * What arrived is still handed over, and the next write or read surfaces the
   * disconnection itself — a cabled gadget that vanished is not a reply.
   */
  private readonly onPortError = (): void => {
    this.discarding = false;
    if (this.quiet !== undefined) {
      clearTimeout(this.quiet);
      this.quiet = undefined;
    }

    if (this.burst.length === 0) {
      this.settle(new Uint8Array());
      return;
    }

    this.seal();
  };

  constructor(private readonly port: SerialPort) {
    // A port that disconnects emits `error`; without a listener Node throws.
    // The disconnect still surfaces through the next write or an empty read.
    this.port.on("error", this.onPortError);
    this.port.on("data", this.onData);
  }

  write(bytes: Uint8Array): Promise<void> {
    // A close that has begun owns the port: the binding queues a write on a
    // closed handle until the next `open` event, so a command racing a stop
    // would hang forever instead of failing. `closed` is set before the
    // asynchronous close, so this covers a stop already in progress too.
    if (this.closed) {
      return Promise.reject(
        Object.assign(new Error("The serial port is closed."), {
          code: "ERR_SERIAL_PORT_CLOSED",
        }),
      );
    }

    return new Promise((resolve, reject) => {
      this.port.write(Buffer.from(bytes), (error) => {
        if (error !== null && error !== undefined) {
          reject(error);
          return;
        }

        this.port.drain((drainError) => {
          if (drainError !== null && drainError !== undefined) {
            reject(drainError);
            return;
          }

          resolve();
        });
      });
    });
  }

  read(timeoutMs: number): Promise<Uint8Array> {
    const next = this.reading.then(
      () => this.readOnce(timeoutMs),
      () => this.readOnce(timeoutMs),
    );

    // The chain only sequences; its own tail never rejects, so a second read
    // queued behind a failed one still runs.
    this.reading = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  drainPending(): Uint8Array {
    const parts = this.queued.splice(0);

    // A burst still arriving may belong to a read already waiting for it, so
    // it is only dropped when nobody is reading.
    if (this.waiting === undefined) {
      parts.push(...this.burst.map((chunk) => Uint8Array.from(chunk)));
      this.burst = [];

      // The rest of that burst can still be on the wire; everything until the
      // next quiet gap is its tail, not an answer to what we send next.
      this.discarding = true;
      this.armQuiet();
    }

    const bytes = new Uint8Array(
      parts.reduce((total, part) => total + part.length, 0),
    );
    let at = 0;
    for (const part of parts) {
      bytes.set(part, at);
      at += part.length;
    }

    return bytes;
  }

  private readOnce(timeoutMs: number): Promise<Uint8Array> {
    return new Promise((resolve) => {
      if (this.closed) {
        resolve(new Uint8Array());
        return;
      }

      // A reply that arrived before this read is already whole.
      const ready = this.queued.shift();
      if (ready !== undefined) {
        resolve(ready);
        return;
      }

      const timer = setTimeout(() => {
        if (this.waiting === undefined) return;

        // The cap is the ceiling, not a discard: what arrived is still a
        // reply, and an empty burst is the honest answer to silence.
        this.waiting = undefined;
        if (this.quiet !== undefined) {
          clearTimeout(this.quiet);
          this.quiet = undefined;
        }

        const reply =
          this.burst.length === 0
            ? new Uint8Array()
            : Uint8Array.from(Buffer.concat(this.burst));
        this.burst = [];
        resolve(reply);
      }, timeoutMs);

      this.waiting = { resolve, timer };

      // Bytes already arriving belong to this read; their seal timer is
      // running. One that was starting anyway must not be re-armed from here,
      // or a chunk arriving mid-read would restart a gap the burst had
      // already waited out.
      if (this.burst.length > 0 && this.quiet === undefined) this.armQuiet();
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    this.discarding = false;
    this.port.off("data", this.onData);
    this.port.off("error", this.onPortError);
    if (this.quiet !== undefined) {
      clearTimeout(this.quiet);
      this.quiet = undefined;
    }

    // A read after close answers empty rather than waiting a cap for a device
    // that is no longer there.
    this.queued.length = 0;
    this.burst = [];
    this.settle(new Uint8Array());

    if (!this.port.isOpen) return;

    await new Promise<void>((resolve) => {
      this.port.close(() => resolve());
    });
  }

  /** Restarts the quiet gap that ends the burst in progress. */
  private armQuiet(): void {
    if (this.quiet !== undefined) clearTimeout(this.quiet);

    this.quiet = setTimeout(() => {
      this.quiet = undefined;
      // The gap ends the discarded tail: anything from here is a new reply.
      this.discarding = false;
      this.seal();
    }, READ_QUIET_MS);
  }

  /** Ends the burst: hands it to the waiting read, or parks it for the next. */
  private seal(): void {
    if (this.burst.length === 0) return;

    const reply = Uint8Array.from(Buffer.concat(this.burst));
    this.burst = [];
    this.deliver(reply);
  }

  /** Hands a reply to the read waiting for it, or holds it for the next one. */
  private deliver(reply: Uint8Array): void {
    const waiting = this.waiting;
    if (waiting !== undefined) {
      this.waiting = undefined;
      clearTimeout(waiting.timer);
      waiting.resolve(reply);
      return;
    }

    this.queued.push(reply);
    // A device that talks faster than the host reads must not grow this
    // process. The oldest goes first and may be one this read wanted; the
    // alternative is unbounded memory for chatter nobody may ever read.
    if (this.queued.length > MAX_QUEUED_REPLIES) this.queued.shift();
  }

  /** Settles the waiting read with `reply`; no read waiting is not an error. */
  private settle(reply: Uint8Array): void {
    const waiting = this.waiting;
    if (waiting === undefined) return;

    this.waiting = undefined;
    clearTimeout(waiting.timer);
    waiting.resolve(reply);
  }
}

/** Opens one serial port for the panel's adapter. */
export function openSerialPort(path: string): Promise<SerialTransport> {
  return new Promise((resolve, reject) => {
    let port: SerialPort;

    try {
      port = new SerialPort({
        path,
        baudRate: BAUD_RATE,
        rtscts: true,
        autoOpen: false,
      });
    } catch (error) {
      reject(error);
      return;
    }

    port.open((error) => {
      if (error !== null && error !== undefined) {
        reject(error);
        return;
      }

      resolve(new OpenSerialPort(port));
    });
  });
}
