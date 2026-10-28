import { describe, expect, it } from "vitest";
import {
  bgraPayload,
  frame,
  parseHello,
  TURZX_COMMAND,
  TURZX_GEOMETRY,
} from "./turzx-protocol.js";

describe("frame", () => {
  it("pads HELLO to exactly 250 bytes with the verified prefix", () => {
    const bytes = frame(TURZX_COMMAND.hello);
    expect(bytes.length).toBe(250);
    expect([...bytes.slice(0, 12)]).toEqual([
      0x01, 0xef, 0x69, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0xc5, 0xd3,
    ]);
    expect([...bytes.slice(12)].every((byte) => byte === 0)).toBe(true);
  });

  it("pads the bitmap start with 0x2c", () => {
    const bytes = frame(Uint8Array.of(0x2c), "bitmap");
    expect(bytes.length).toBe(250);
    expect([...bytes].every((byte) => byte === 0x2c)).toBe(true);
  });
});

describe("parseHello", () => {
  it("reads the model, device and firmware", () => {
    expect(
      parseHello(new TextEncoder().encode("chs_5inch.dev1_rom1.88\0")),
    ).toEqual({
      model: "chs_5inch",
      device: "dev1",
      firmware: "1.88",
    });
  });

  it("refuses a reply that is not a panel identity", () => {
    expect(
      parseHello(new TextEncoder().encode("play_video_success")),
    ).toBeUndefined();
    expect(parseHello(new Uint8Array())).toBeUndefined();
  });
});

describe("bgraPayload", () => {
  it("swaps red and blue, joins 249-byte chunks with 0x00, and pads", () => {
    // Two pixels: pure red then pure blue, RGBA.
    const rgba = Uint8Array.of(255, 0, 0, 255, 0, 0, 255, 255);
    const payload = bgraPayload(rgba);
    expect(payload.length % 250).toBe(0);
    expect([...payload.slice(0, 8)]).toEqual([0, 0, 255, 255, 255, 0, 0, 255]);
  });

  it("states the panel geometry", () => {
    expect(TURZX_GEOMETRY).toEqual({ width: 800, height: 480 });
  });
});
