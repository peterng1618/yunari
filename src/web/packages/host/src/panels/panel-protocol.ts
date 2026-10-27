import forge from "node-forge";

/**
 * The TUR USB packet: a 500-byte command, DES-CBC encrypted, framed in 512
 * bytes with a two-byte trailer.
 *
 * Pure, so the packet's bytes are testable against the constants three
 * independent drivers agree on (see docs/decisions/0130-panel-protocol.md).
 * Nothing here touches USB.
 */

/** The key is also the IV. Read from L-Connect's own traffic, not guessed. */
export const PACKET_KEY = "slv3tuzx";

export const COMMAND_SIZE = 500;
export const PACKET_SIZE = 512;
/** The frame's last two bytes. A packet without them is refused by the panel. */
export const TRAILER = Uint8Array.of(0xa1, 0x1a);
/** Bytes 2-3 of every command. Constant across commands and drivers. */
export const MAGIC = Uint8Array.of(0x1a, 0x6d);

export type PanelCommand =
  | "version"
  | "brightness"
  | "frame-rate"
  | "push-jpeg"
  | "buffer-level"
  | "clock";

/** The opcodes. Only non-destructive ones are named; firmware and storage
 *  writes are deliberately absent rather than merely unused. */
export const OPCODE: Readonly<Record<PanelCommand, number>> = {
  version: 10,
  brightness: 14,
  "frame-rate": 15,
  "push-jpeg": 101,
  "buffer-level": 122,
  clock: 51,
};

export interface CommandFields {
  /** The payload length, for a command that carries an image. */
  readonly payloadLength?: number;
  /** One byte at offset 8, for brightness and frame rate. */
  readonly parameter?: number;
}

/**
 * The plaintext command block, before encryption.
 *
 * `elapsedMs` becomes a little-endian 32-bit timestamp at offset 4. The device
 * does not verify it, so an arbitrary origin is sound; a monotonic-since-launch
 * value is what every driver sends.
 *
 * Exported for the test that asserts the field layout, which is the only
 * durable description of a protocol nobody documents.
 */
export function commandBlock(
  command: PanelCommand,
  elapsedMs: number,
  fields: CommandFields = {},
): Uint8Array {
  const block = new Uint8Array(COMMAND_SIZE);

  block[0] = OPCODE[command];
  block.set(MAGIC, 2);
  new DataView(block.buffer).setInt32(4, elapsedMs | 0, true);

  if (fields.payloadLength !== undefined) {
    new DataView(block.buffer).setInt32(8, fields.payloadLength, false);
  }

  if (fields.parameter !== undefined) {
    block[8] = fields.parameter;
  }

  return block;
}

/**
 * DES-CBC with PKCS7, keyed and initialised with the literal.
 *
 * `node:crypto` cannot do this on Node 24: DES moved to OpenSSL's legacy
 * provider, so `createCipheriv("des-cbc", …)` throws `ERR_OSSL_EVP_UNSUPPORTED`.
 * `node-forge` was already a host dependency for the local CA, so this costs a
 * call rather than a dependency — and unlike `--openssl-legacy-provider` it
 * cannot be lost by however the host is launched.
 */
export function encryptCommand(block: Uint8Array): Uint8Array {
  const cipher = forge.cipher.createCipher(
    "DES-CBC",
    forge.util.createBuffer(PACKET_KEY),
  );
  cipher.start({ iv: PACKET_KEY });
  cipher.update(forge.util.createBuffer(String.fromCharCode(...block)));
  cipher.finish();

  const bytes = cipher.output.getBytes();
  const packet = new Uint8Array(PACKET_SIZE);
  // The encrypted block is 504 bytes with PKCS7 padding; the trailer needs the
  // last two, so the copy is clipped rather than allowed to overrun.
  for (
    let i = 0;
    i < Math.min(bytes.length, PACKET_SIZE - TRAILER.length);
    i += 1
  ) {
    packet[i] = bytes.charCodeAt(i);
  }

  packet.set(TRAILER, PACKET_SIZE - TRAILER.length);
  return packet;
}

/**
 * One command as the bytes to write: the frame alone, or the frame with an
 * image behind it in the **same** transfer.
 *
 * One transfer is a device requirement rather than a convenience — two drivers
 * report that sending the frame and the image separately makes the panel
 * accept a frame briefly and then stop responding.
 */
export function commandPacket(
  command: PanelCommand,
  elapsedMs: number,
  fields: CommandFields = {},
  payload?: Uint8Array,
): Uint8Array {
  const frame = encryptCommand(commandBlock(command, elapsedMs, fields));

  if (payload === undefined || payload.length === 0) return frame;

  const write = new Uint8Array(frame.length + payload.length);
  write.set(frame, 0);
  write.set(payload, frame.length);
  return write;
}
