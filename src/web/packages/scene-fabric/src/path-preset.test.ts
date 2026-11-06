import { describe, expect, it } from "vitest";
import { pathPresetGeometry } from "./path-preset.js";

describe("a path preset's geometry", () => {
  it("reads the extent of an open path and strokes it", () => {
    expect(pathPresetGeometry("M 0 100 L 360 100")).toEqual({
      ok: true,
      width: 360,
      height: 0,
      paint: "stroke",
    });
  });

  it("fills a closed path", () => {
    expect(pathPresetGeometry("M 0 0 L 10 0 L 10 10 L 0 10 Z")).toEqual({
      ok: true,
      width: 10,
      height: 10,
      paint: "fill",
    });
  });

  it("strokes a path with one open subpath, even when another closes", () => {
    expect(pathPresetGeometry("M 0 0 L 10 0 Z M 20 0 L 30 0")).toMatchObject({
      ok: true,
      paint: "stroke",
    });
  });

  it("trims authored data before reading it", () => {
    expect(pathPresetGeometry("  M 0 0 L 10 10 Z  ")).toMatchObject({
      ok: true,
      width: 10,
      height: 10,
    });
  });

  it.each(["", "   ", "M 0 0", "M 0 0 L", "not a path"])(
    "refuses %o, which draws nothing",
    (data) => {
      expect(pathPresetGeometry(data)).toEqual({ ok: false, reason: "empty" });
    },
  );

  it("refuses a value it cannot parse", () => {
    // A route can hand the reader anything; only a real string is path data.
    expect(pathPresetGeometry(42 as unknown as string)).toEqual({
      ok: false,
      reason: "unreadable",
    });
  });
});
