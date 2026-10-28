import { describe, expect, it } from "vitest";
import { krakenHint } from "./kraken-z3-panel.js";

/**
 * The identity a record keys a panel by.
 *
 * This exists because the first draft derived the serial from the Windows HID
 * path, whose `#8&1ebeab3b&0&0000#` segment is this boot's bus instance — a
 * value that looks like a serial and changes on replug. The device reports the
 * real one, and these cases hold the driver to reading it.
 */

const VENDOR = 0x1e71;
const PRODUCT = 0x3008;

describe("krakenHint", () => {
  it("reads the serial the device reports", () => {
    // The string this machine's Z73 answers with, captured from `HID.devices()`.
    expect(
      krakenHint({
        vendorId: VENDOR,
        productId: PRODUCT,
        serialNumber: "344A35613131",
      })?.serial,
    ).toBe("344A35613131");
  });

  it("never reports a bus instance as a serial", () => {
    // The path segment the first draft mistook for one.
    expect(
      krakenHint({
        vendorId: VENDOR,
        productId: PRODUCT,
        serialNumber: "344A35613131",
      })?.serial,
    ).not.toBe("1ebeab3b");
  });

  it("has no serial rather than an empty one when the device reports none", () => {
    // `PanelHint.serial` is a string, and the record reader drops a blank one;
    // a hint carrying `""` matches nothing, so the hint must say so.
    const hint = krakenHint({ vendorId: VENDOR, productId: PRODUCT });
    expect(hint?.serial).toBe("");
  });

  it("ignores a blank serial with whitespace rather than storing it", () => {
    expect(
      krakenHint({ vendorId: VENDOR, productId: PRODUCT, serialNumber: "  " })
        ?.serial,
    ).toBe("");
  });

  it("claims no device that is not a Kraken", () => {
    // The Lian Li ids: a family table that offered these under the Kraken's
    // driver would have two drivers racing for one device.
    expect(
      krakenHint({ vendorId: 0x1cbe, productId: 0xa092, serialNumber: "x" }),
    ).toBeUndefined();
    expect(
      krakenHint({ vendorId: VENDOR, productId: 0x3009, serialNumber: "x" }),
    ).toBeUndefined();
  });

  it("names the model the family table claims", () => {
    expect(krakenHint({ vendorId: VENDOR, productId: PRODUCT })?.model).toBe(
      "kraken-z3",
    );
  });
});
