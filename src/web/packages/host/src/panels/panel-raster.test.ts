import { describe, expect, it } from "vitest";
import { screenshotParameters } from "./panel-raster.js";

describe("screenshotParameters", () => {
  it("asks for PNG with no quality and JPEG 85 with one", () => {
    expect(screenshotParameters("png")).toEqual({ format: "png" });
    expect(screenshotParameters("jpeg")).toEqual({
      format: "jpeg",
      quality: 85,
    });
  });
});
