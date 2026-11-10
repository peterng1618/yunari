import type { PanelControlCommand, PanelControls } from "./panel-device.js";
import type { PanelCommand } from "./panel-protocol.js";

/**
 * The Lian Li panel's control channel: percent in, the opcode's byte mapping
 * kept here.
 *
 * It takes the driver's own locked exchange rather than a transport, so a
 * control cannot interleave with a frame or the video feed, and this module
 * stays beside the streaming driver instead of growing it past the size stop.
 */
export interface TurUsbControlChannel {
  request(
    command: PanelCommand,
    timeoutMs: number,
    fields?: { readonly parameter?: number },
  ): Promise<Uint8Array | undefined>;
  exclusive<T>(work: () => Promise<T>): Promise<T>;
}

export function turUsbControls(
  channel: TurUsbControlChannel,
  readTimeoutMs: number,
): PanelControls {
  /** The level a screen-on restores: the last brightness this host wrote. Full
   *  before the first write, so turning the glass back on shows a picture. */
  const screen = { level: 100, off: false };

  return {
    commands: ["brightness", "screen", "status"],
    run: (command) => runControl(channel, readTimeoutMs, screen, command),
  };
}

async function runControl(
  channel: TurUsbControlChannel,
  readTimeoutMs: number,
  screen: { level: number; off: boolean },
  command: PanelControlCommand,
): Promise<string> {
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

      return await channel.exclusive(async () => {
        // Opcode 14's parameter is the percent itself, 0..100 — not a 0..255
        // weight. L-Connect's own constants are exactly 0 and 100.
        await channel.request("brightness", readTimeoutMs, {
          parameter: level,
        });
        // Asking for a level is also asking for the screen back.
        screen.level = level;
        screen.off = false;

        // The ack carries no text, so a host sentence would be read as the
        // panel's reply.
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

      return await channel.exclusive(async () => {
        // Brightness is the only off switch this panel documents: zero draws
        // nothing and leaves the cable open, while a level the owner asks for
        // turns the glass back on.
        screen.off = !on;
        await channel.request("brightness", readTimeoutMs, {
          parameter: screen.off ? 0 : screen.level,
        });
        return "";
      });
    }
    case "status":
      return await channel.exclusive(async () => {
        const reply = await channel.request("version", readTimeoutMs);
        const firmware = reply === undefined ? undefined : firmwareOf(reply);

        if (firmware === undefined) {
          throw new Error("The panel did not answer its firmware query.");
        }

        return firmware;
      });
    default:
      throw new Error("That is not a command this panel accepts.");
  }
}

/**
 * The firmware name in a GetVer reply: ASCII from byte 8, zero terminated.
 * `undefined` when the reply carried no name, which is what a request the panel
 * did not handle leaves behind.
 */
function firmwareOf(reply: Uint8Array): string | undefined {
  const body = reply.subarray(8);
  const end = body.indexOf(0);
  const text = new TextDecoder()
    .decode(end === -1 ? body : body.subarray(0, end))
    .trim();

  return text === "" ? undefined : text;
}
