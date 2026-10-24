import { expect, it } from "vitest";
import { TRAY_ICON_PNG_BASE64 } from "./tray-icon.js";

it("is a 32 by 32 PNG", () => {
  const png = Buffer.from(TRAY_ICON_PNG_BASE64, "base64");
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(png.readUInt32BE(16)).toBe(32);
  expect(png.readUInt32BE(20)).toBe(32);
});
