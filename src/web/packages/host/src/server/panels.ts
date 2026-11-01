import type { PanelControlCommand } from "../panels/panel-device.js";
import { PanelNotRunningError } from "../panels/panel-manager.js";

/** A USB id as the form every device tool prints it, for a refusal's message. */
export function usbId(value: number): string {
  return value.toString(16).padStart(4, "0");
}

/** The panel's power-on mode, refused rather than rounded down to a neighbour. */
export function startModeOf(value: unknown): 0 | 1 | 2 {
  if (value === 0 || value === 1 || value === 2) return value;

  throw new Error("The start mode must be 0, 1 or 2.");
}

/**
 * One command from a request body, refusing what the adapter would refuse.
 *
 * The adapter's own checks stay: this one is what makes a bad value a 400
 * rather than a 500 from a driver that has already been asked to write. The
 * recognised kinds are the `PanelControlCommand` union, so a new command is an
 * edit here as well as there rather than a silent pass-through.
 */
export function panelCommand(body: unknown): PanelControlCommand {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("That is not a panel command.");
  }

  const { kind, level, on, startMode, flip, sleepDelay } = body as {
    readonly kind?: unknown;
    readonly level?: unknown;
    readonly on?: unknown;
    readonly startMode?: unknown;
    readonly flip?: unknown;
    readonly sleepDelay?: unknown;
  };

  if (kind === "brightness") {
    // A string "50" is not a level: coercing it would write a value the caller
    // did not ask for, and a fraction would be rounded behind their back.
    if (
      typeof level !== "number" ||
      !Number.isInteger(level) ||
      level < 0 ||
      level > 100
    ) {
      throw new Error("The brightness must be a whole percent from 0 to 100.");
    }

    return { kind: "brightness", level };
  }

  if (kind === "screen") {
    if (typeof on !== "boolean") {
      throw new Error("The screen command needs on to be true or false.");
    }

    return { kind: "screen", on };
  }

  if (kind === "panel-settings") {
    // The three values the panel stores: what it shows at power-on, whether the
    // image is upside down, and how long it waits before sleeping. Each is
    // refused rather than coerced — a mode of 4 is not "closest to video".
    const mode = startModeOf(startMode);
    if (typeof flip !== "boolean") {
      throw new Error("The image flip needs flip to be true or false.");
    }
    if (
      typeof sleepDelay !== "number" ||
      !Number.isInteger(sleepDelay) ||
      sleepDelay < 0 ||
      sleepDelay > 10
    ) {
      throw new Error("The sleep delay must be a whole number from 0 to 10.");
    }

    return { kind: "panel-settings", startMode: mode, flip, sleepDelay };
  }

  if (kind === "restart" || kind === "status" || kind === "hello") {
    return { kind };
  }

  throw new Error("That is not a command this panel accepts.");
}

/**
 * Whether a failed control is the transport rather than the host's own bug.
 *
 * A runner that is stopping still reports `running` until its stop begins, so
 * the command reaches a port that is already on its way down; that rejects with
 * an OS error carrying a `code` (or serialport's closed-port message), while
 * the adapter's own refusals and this host's bugs are plain errors with none.
 * The codes are an allowlist rather than any string: an `ENOENT` from a future
 * local-I/O control path is that path's failure, not a port conflict.
 */
export function isPortFailure(error: unknown): boolean {
  if (error instanceof PanelNotRunningError) return true;
  if (typeof error !== "object" || error === null) return false;

  const { code, disconnected, message } = error as {
    readonly code?: unknown;
    readonly disconnected?: unknown;
    readonly message?: unknown;
  };

  return (
    disconnected === true ||
    message === "Port is not open" ||
    (typeof code === "string" &&
      (code === "EIO" ||
        code === "EBADF" ||
        code === "ENXIO" ||
        code.startsWith("ERR_SERIAL_PORT_")))
  );
}
