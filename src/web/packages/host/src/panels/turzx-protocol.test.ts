import { describe, expect, it } from "vitest";
import {
  bgraPayload,
  frame,
  overlayTrailer,
  overlayUpdate,
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

  it("carries the bitmap length field the reference driver sends", () => {
    // The reference sends DISPLAY_BITMAP_5INCH followed by a big-endian
    // width^2/64 field (480x480/64 = 3600): the frame is 8 bytes, not 6. The
    // panel ignores a full-image send whose field is zero.
    expect([...TURZX_COMMAND.displayBitmap]).toEqual([
      0xc8, 0xef, 0x69, 0x00, 0x17, 0x70, 0x0e, 0x10,
    ]);
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

  it("puts one 0x00 after each 249-byte chunk and pads the tail", () => {
    // Three chunks: 249 bytes, a 0x00 join, 249 bytes, a 0x00 join, 249 bytes,
    // then zero padding to the next 250-byte multiple. Filled with 0xff so a
    // missing join cannot read as an expected zero.
    const payload = bgraPayload(new Uint8Array(249 * 3).fill(0xff));
    expect(payload.length).toBe(750);
    expect(payload[248]).toBe(0xff);
    expect(payload[249]).toBe(0);
    expect(payload[499]).toBe(0);
    expect(payload[500]).toBe(0xff);
    expect([...payload.slice(749)].every((byte) => byte === 0)).toBe(true);
  });

  it("states the panel geometry", () => {
    expect(TURZX_GEOMETRY).toEqual({ width: 800, height: 480 });
  });
});

function blank(width: number, height: number): Uint8Array {
  return new Uint8Array(width * height * 4);
}

function red(
  width: number,
  height: number,
  rect: { x: number; y: number; w: number; h: number },
): Uint8Array {
  const pixels = blank(width, height);
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      const i = (y * width + x) * 4;
      pixels[i] = 255;
      pixels[i + 2] = 0;
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

describe("overlayUpdate", () => {
  it("encodes a new rectangle as its pixels plus a visible segment", () => {
    const update = overlayUpdate(
      blank(4, 2),
      red(4, 2, { x: 1, y: 0, w: 2, h: 1 }),
      { width: 4, height: 2 },
    );
    // One row-0 changed segment: offset 3 bytes, width 2, then 2 pixels of 3 bytes.
    expect([...update.body.slice(0, 5)]).toEqual([0, 0, 1, 0, 2]);
    // A fully opaque red pixel: blue 0, green 0, red 15, alpha 15, split across
    // three bytes as b<<4|a_hi, g<<4|a_lo, r<<4.
    expect([...update.body.slice(5, 11)]).toEqual([
      0x03, 0x03, 0xf0, 0x03, 0x03, 0xf0,
    ]);
    // The visible list repeats that segment after the changed pixels.
    expect([...update.body.slice(11, 16)]).toEqual([0, 0, 1, 0, 2]);
    expect(update.visibleBytes).toBe(5);
    expect(update.imageSize).toBe(5 + 6 + 5 + 2);
  });

  it("drops the old position from the visible list", () => {
    const update = overlayUpdate(
      red(4, 2, { x: 0, y: 0, w: 2, h: 1 }),
      red(4, 2, { x: 2, y: 0, w: 2, h: 1 }),
      { width: 4, height: 2 },
    );
    // A cleared pixel is not re-sent: only the new rectangle appears, and the
    // visible list names x=2 alone, which is what clears x=0.
    expect([...update.body.slice(0, 5)]).toEqual([0, 0, 2, 0, 2]);
    expect([...update.body.slice(11, 16)]).toEqual([0, 0, 2, 0, 2]);
  });

  it("refuses a frame that is not the geometry's RGBA size", () => {
    expect(() =>
      overlayUpdate(new Uint8Array(3), blank(4, 2), { width: 4, height: 2 }),
    ).toThrow(/previous overlay is 3 bytes/);
    expect(() =>
      overlayUpdate(blank(4, 2), new Uint8Array(3), { width: 4, height: 2 }),
    ).toThrow(/decoded overlay is 3 bytes/);
  });
});

describe("overlayTrailer", () => {
  it.each([
    [250, 2, 0],
    [251, 2, 0],
    [300, 2, 0],
    [500, 8, 7],
    [498, 8, 7],
    [499, 8, 7],
  ])("aligns a %i-byte payload", (length, size, extra) => {
    const trailer = overlayTrailer(length);
    expect(trailer.bytes.length).toBe(size);
    expect(trailer.extra).toBe(extra);
    expect([...trailer.bytes.slice(-2)]).toEqual([0xef, 0x69]);
  });
});
