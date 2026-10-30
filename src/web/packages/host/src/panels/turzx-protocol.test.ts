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

function grey(width: number, height: number, value: number): Uint8Array {
  const pixels = blank(width, height);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = value;
    pixels[i + 1] = value;
    pixels[i + 2] = value;
    pixels[i + 3] = 255;
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
    // A fully opaque red pixel: blue 0, green 0, red 255, alpha 15, split across
    // three bytes as b|a_hi, g|a_lo, r.
    expect([...update.body.slice(5, 11)]).toEqual([
      0x03, 0x03, 0xff, 0x03, 0x03, 0xff,
    ]);
    // The visible list repeats that segment after the changed pixels.
    expect([...update.body.slice(11, 16)]).toEqual([0, 0, 1, 0, 2]);
    expect(update.visibleBytes).toBe(5);
    expect(update.imageSize).toBe(5 + 6 + 5 + 2);
  });

  it("keeps sub-nibble colour instead of quantizing to four bits", () => {
    // The vendor's encoder sends B6|A2, G6|A2, R8; a 128 grey is 0x83, 0x83,
    // 0x80, and every pixel is identical. Four bits per channel would send
    // 0x80 in each top nibble and a dither to hide the band.
    const update = overlayUpdate(blank(4, 4), grey(4, 4, 128), {
      width: 4,
      height: 4,
    });
    let at = 0;
    for (let y = 0; y < 4; y += 1) {
      at += 5; // the row's segment header: offset, width
      for (let x = 0; x < 4; x += 1) {
        expect([...(update.body.slice(at, at + 3) ?? [])]).toEqual([
          0x83, 0x83, 0x80,
        ]);
        at += 3;
      }
    }
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

  it("chunks a large message and reports the aligned image size", () => {
    const update = overlayUpdate(
      blank(800, 480),
      red(800, 480, { x: 0, y: 0, w: 800, h: 221 }),
      { width: 800, height: 480 },
    );
    // 221 rows of 5 + 800*3 changed bytes plus 221 visible spans of 5 is a
    // 532610-byte message; joined at 249 with a 0x00 between chunks it is
    // 534748 bytes, and 534748 % 250 === 248, which is the aligned form.
    expect(update.imageSize).toBe(532610 + 7);
    expect(update.visibleBytes).toBe(221 * 5 + 5);
    expect(update.body.length).toBe(534748 + 8);
    expect(update.body[249]).toBe(0x00);
    expect(update.body[499]).toBe(0x00);
    expect([...update.body.slice(-8)]).toEqual([
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0xef, 0x69,
    ]);
  });

  it("leaves a message of exactly 250 bytes unchunked", () => {
    const update = overlayUpdate(
      blank(800, 480),
      red(800, 480, { x: 0, y: 0, w: 80, h: 1 }),
      { width: 800, height: 480 },
    );
    // One row of 80 opaque pixels: 5 + 80*3 changed bytes + 5 visible = 250.
    // Chunking it would add a separator and a byte, so the body would be 253.
    expect(update.imageSize).toBe(252);
    expect(update.body.length).toBe(252);
    expect([...update.body.slice(245)]).toEqual([
      0x00, 0x00, 0x00, 0x00, 0x50, 0xef, 0x69,
    ]);
  });

  it("writes the offset and width big-endian", () => {
    const update = overlayUpdate(
      blank(800, 1),
      red(800, 1, { x: 300, y: 0, w: 260, h: 1 }),
      { width: 800, height: 1 },
    );
    // Offset 300 = 0x00012c, width 260 = 0x0104; each carries a byte above ff.
    expect([...update.body.slice(0, 5)]).toEqual([
      0x00, 0x01, 0x2c, 0x01, 0x04,
    ]);
  });

  it("keeps a one-pixel transparent gap through the lookahead", () => {
    const current = blank(4, 2);
    for (const x of [0, 2]) {
      const i = x * 4;
      current[i] = 255;
      current[i + 3] = 255;
    }
    const update = overlayUpdate(blank(4, 2), current, {
      width: 4,
      height: 2,
    });

    // One changed span of width 3: the gap's three transparent bytes are sent
    // because the pixel after it is opaque.
    expect([...update.body.slice(0, 5)]).toEqual([0, 0, 0, 0, 3]);
    expect([...update.body.slice(5, 14)]).toEqual([
      0x03, 0x03, 0xff, 0x00, 0x00, 0x00, 0x03, 0x03, 0xff,
    ]);
    // The visible list carries spans only: offset and width, no pixel bytes.
    expect([...update.body.slice(14, 19)]).toEqual([0, 0, 0, 0, 3]);
    expect(update.body.length).toBe(19 + 2);
    expect(update.visibleBytes).toBe(5);
  });

  it("does not look past the end of a row", () => {
    const current = blank(4, 2);
    // Opaque at row 0's last pixel, and at row 1's first pixel.
    for (const i of [3 * 4, 4 * 4]) {
      current[i] = 255;
      current[i + 3] = 255;
    }
    const update = overlayUpdate(blank(4, 2), current, {
      width: 4,
      height: 2,
    });

    // Row 0's span is x=3 alone, not a lookahead into row 1's pixel.
    expect([...update.body.slice(0, 5)]).toEqual([0, 0, 3, 0, 1]);
    expect([...update.body.slice(8, 13)]).toEqual([0, 0, 4, 0, 1]);
    expect([...update.body.slice(16, 21)]).toEqual([0, 0, 3, 0, 1]);
    expect([...update.body.slice(21, 26)]).toEqual([0, 0, 4, 0, 1]);
    expect(update.body.length).toBe(26 + 2);
  });

  it("uses the row stride in a segment's offset", () => {
    const update = overlayUpdate(
      blank(4, 4),
      red(4, 4, { x: 1, y: 2, w: 1, h: 1 }),
      { width: 4, height: 4 },
    );
    // Pixel (1,2) is offset 2 * 4 + 1 = 9.
    expect([...update.body.slice(0, 5)]).toEqual([0, 0, 9, 0, 1]);
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

  it("returns fresh bytes rather than a shared module array", () => {
    expect(overlayTrailer(10).bytes).not.toBe(overlayTrailer(10).bytes);
    expect(overlayTrailer(500).bytes).not.toBe(overlayTrailer(500).bytes);
  });
});
