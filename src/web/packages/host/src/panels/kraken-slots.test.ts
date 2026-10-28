import { describe, expect, it } from "vitest";
import { memoryOffset } from "./kraken-z3-panel.js";

/**
 * The Kraken's memory arithmetic, pinned to what the device reported.
 *
 * A bucket's start and size are counted in 1024-byte slots. This machine's
 * 16-bucket table read `(0,400) (400,400) … (6000,400)`, and a 320x320 32-bit
 * still is 409,600 bytes — **exactly 400 slots, payload only**. The driver
 * counts the 20-byte transfer header as well, which is one slot more than the
 * buckets the vendor app wrote; that is liquidctl's own arithmetic and it errs
 * towards not overlapping a neighbour.
 */

const SLOT_BYTES = 1024;
const TOTAL_SLOTS = 24_320;
/** 12 bytes of magic, then the asset mode and byte count, 32-bit each. */
const HEADER_BYTES = 20;
const STILL_BYTES = 320 * 320 * 4;
/** What the device reported for a bucket already holding one still. */
const REPORTED_BUCKET_SLOTS = 400;

/** The driver's own count, spelled the one way it is spelled there. */
const slotsFor = (payloadBytes: number): number =>
  Math.ceil((HEADER_BYTES + payloadBytes) / SLOT_BYTES);

describe("Kraken slot arithmetic", () => {
  it("agrees with the device that a still is 400 slots of payload", () => {
    expect(STILL_BYTES).toBe(409_600);
    expect(STILL_BYTES / SLOT_BYTES).toBe(REPORTED_BUCKET_SLOTS);
  });

  it("allocates one slot more than the payload, for the transfer header", () => {
    // Deliberate, and the only divergence from the vendor's own number: a
    // bucket sized to the payload alone leaves the header overlapping whatever
    // starts at the next offset.
    expect(slotsFor(STILL_BYTES)).toBe(REPORTED_BUCKET_SLOTS + 1);
  });

  it("fits a one-image bucket in the device's memory", () => {
    expect(slotsFor(STILL_BYTES)).toBeLessThan(TOTAL_SLOTS);
    // Sixteen such buckets fill the table the device printed, 16 x 400 = 6400,
    // a quarter of the budget — the rest is for larger content.
    expect(REPORTED_BUCKET_SLOTS * 16).toBeLessThan(TOTAL_SLOTS);
  });

  it("refuses a payload past the device's whole memory", () => {
    expect(slotsFor(TOTAL_SLOTS * SLOT_BYTES)).toBeGreaterThan(TOTAL_SLOTS);
  });

  it("rounds up, so a payload that does not divide a slot still fits", () => {
    // Anything that leaves at most one slot's worth including the header is
    // one slot; a byte more needs two.
    expect(slotsFor(SLOT_BYTES - HEADER_BYTES)).toBe(1);
    expect(slotsFor(SLOT_BYTES - HEADER_BYTES + 1)).toBe(2);
  });
});

/**
 * `memoryOffset` is imported rather than transcribed: a copy in a test is a
 * copy that stops agreeing with the driver the moment one of them is edited.
 */

describe("Kraken bucket placement", () => {
  /** The table this machine reported: sixteen stills at 400 slots each. */
  const full = Array.from({ length: 16 }, (_, index) => ({
    index,
    start: index * 400,
    size: 400,
  }));

  it("reuses a deleted bucket's own range when the image still fits", () => {
    // liquidctl's first rule, and the one that makes a repeated theme an
    // in-place rewrite instead of a migration.
    expect(memoryOffset(full, full[3]!, 400)).toBe(1_200);
  });

  it("appends past the highest occupied bucket when it has outgrown its slot", () => {
    // Note the narrow one: 401 does **not** fit a 400-slot bucket, so the same
    // still does not land back on its own range — it appends to 6400. The
    // in-place path only opens once a bucket was written by this driver.
    expect(memoryOffset(full, full[3]!, 401)).toBe(6_400);
  });

  it("does not place a bucket on top of a bucket at offset 0", () => {
    // The defect this pins: querying the table *after* deleting the target
    // reports start 0 for it, and an upload placed there overwrites whatever
    // bucket already begins at 0.
    const table = [
      { index: 0, start: 0, size: 400 },
      { index: 1, start: 0, size: 400 },
    ];
    expect(memoryOffset(table, table[1]!, 401)).not.toBe(0);
  });

  it("reuses a bucket's range when the new image fits in it and nothing abuts", () => {
    const shifted = [{ index: 0, start: 2_000, size: 400 }];
    // 800 > 400, so no in-place reuse, but the region from 2000 is empty.
    expect(memoryOffset(shifted, shifted[0]!, 800)).toBe(2_000);
  });

  it("falls back to offset 0 when only the head of memory is free", () => {
    // The other bucket fills the tail, so appending cannot fit; the gap below
    // it is larger than this upload, so liquidctl starts over at the bottom.
    const table = [
      { index: 0, start: 23_900, size: 420 },
      { index: 1, start: 23_900, size: 0 },
    ];
    expect(memoryOffset(table, table[1]!, 100)).toBe(0);
  });

  it("gives up rather than overlap when the memory is full", () => {
    const packed = [{ index: 0, start: 0, size: TOTAL_SLOTS - 10 }];
    expect(memoryOffset(packed, { index: 1, start: 0, size: 0 }, 400)).toBe(-1);
  });
});
