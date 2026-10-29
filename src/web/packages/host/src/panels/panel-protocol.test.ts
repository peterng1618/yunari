import { describe, expect, it } from "vitest";
import {
  COMMAND_SIZE,
  commandBlock,
  commandPacket,
  encryptCommand,
  OPCODE,
  PACKET_SIZE,
  TRAILER,
} from "./panel-protocol.js";

/**
 * The packet's bytes are the whole contract with a device that documents
 * nothing, so the layout is asserted field by field rather than by a golden
 * blob: a golden blob would pass a layout change that moved two fields into
 * each other.
 */
describe("commandBlock", () => {
  it("puts the opcode first, the magic at 2 and the timestamp at 4", () => {
    const block = commandBlock("version", 0x12345678);

    expect(block.length).toBe(COMMAND_SIZE);
    expect(block[0]).toBe(10);
    expect([block[2], block[3]]).toEqual([0x1a, 0x6d]);
    // Little-endian: the least significant byte first.
    expect([block[4], block[5], block[6], block[7]]).toEqual([
      0x78, 0x56, 0x34, 0x12,
    ]);
  });

  it("writes a payload length big-endian at byte 8", () => {
    const block = commandBlock("push-jpeg", 0, { payloadLength: 0x0001_0203 });

    expect([block[8], block[9], block[10], block[11]]).toEqual([
      0x00, 0x01, 0x02, 0x03,
    ]);
  });

  it("writes a one-byte parameter at byte 8", () => {
    const block = commandBlock("brightness", 0, { parameter: 60 });

    expect(block[8]).toBe(60);
    // Nothing spills into the field beside it.
    expect(block[9]).toBe(0);
  });

  it("uses the opcodes the drivers agree on", () => {
    expect(OPCODE).toMatchObject({
      version: 10,
      brightness: 14,
      "frame-rate": 15,
      rotate: 13,
      "push-jpeg": 101,
      "push-png": 102,
      "overlay-layer": 105,
      "play-block": 121,
      "stop-play": 123,
      "buffer-level": 122,
    });
  });

  it("names no destructive opcode", () => {
    // Firmware update, storage delete and device restart are the opcodes a
    // wrong write can brick a panel with. They are absent rather than unused.
    expect(Object.values(OPCODE)).not.toContain(38);
    expect(Object.values(OPCODE)).not.toContain(39);
    expect(Object.values(OPCODE)).not.toContain(40);
    expect(Object.values(OPCODE)).not.toContain(11);
  });
});

describe("encryptCommand", () => {
  it("produces a full 512-byte frame ending in the trailer", () => {
    const packet = encryptCommand(commandBlock("version", 0));

    expect(packet.length).toBe(PACKET_SIZE);
    expect([...packet.subarray(PACKET_SIZE - 2)]).toEqual([...TRAILER]);
  });

  it("is not the plaintext", () => {
    const block = commandBlock("version", 0);
    const packet = encryptCommand(block);

    // The opcode sits in the first DES block, so a packet that still starts
    // with 10 is one that was never encrypted.
    expect(packet[0]).not.toBe(10);
    expect(packet.subarray(0, 64)).not.toEqual(block.subarray(0, 64));
  });

  it("encrypts to the size three drivers carry", () => {
    // 500 bytes + PKCS7 to the 8-byte block is 504: the number every
    // implementation names. It is the cross-check that this is the right
    // primitive rather than merely a cipher that runs.
    const block = commandBlock("version", 0);
    const packet = encryptCommand(block);

    expect(block.length + 4).toBe(504);
    expect(packet.length).toBe(PACKET_SIZE);
  });

  it("is deterministic for one block", () => {
    const block = commandBlock("version", 1000);

    expect(encryptCommand(block)).toEqual(encryptCommand(block));
  });
});

describe("commandPacket", () => {
  it("is the frame alone with no payload", () => {
    const write = commandPacket("version", 0);

    expect(write.length).toBe(PACKET_SIZE);
  });

  it("puts the image behind the frame in one write", () => {
    const payload = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0);
    const write = commandPacket("push-jpeg", 0, { payloadLength: 4 }, payload);

    expect(write.length).toBe(PACKET_SIZE + 4);
    expect([...write.subarray(0, PACKET_SIZE).subarray(-2)]).toEqual([
      ...TRAILER,
    ]);
    expect([...write.subarray(PACKET_SIZE)]).toEqual([...payload]);
  });

  it("treats an empty payload as no payload", () => {
    expect(commandPacket("version", 0, {}, new Uint8Array()).length).toBe(
      PACKET_SIZE,
    );
  });
});
