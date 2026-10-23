import { describe, expect, it } from "vitest";
import {
  areaFromPoint,
  areaPoint,
  areaValueText,
  CHANNEL_RANGES,
  channelRatio,
  channelValue,
  steppedValue,
  withChannel,
  withChannelRatio,
} from "./colour-picker-model.js";

/** Half of every normalised channel, so each percentage has an obvious answer. */
const HSV = { h: 180, s: 0.5, v: 0.5, a: 0.5 } as const;

describe("the channel model", () => {
  it("reads each channel in its own unit", () => {
    expect(channelValue("hue", HSV)).toBe(180);
    expect(channelValue("saturation", HSV)).toBe(50);
    expect(channelValue("value", HSV)).toBe(50);
    expect(channelValue("alpha", HSV)).toBe(50);
    expect(CHANNEL_RANGES.hue).toEqual({ min: 0, max: 360, step: 1 });
    expect(CHANNEL_RANGES.alpha).toEqual({ min: 0, max: 100, step: 1 });
  });

  it("writes only the named channel", () => {
    expect(withChannel(HSV, "hue", 270)).toEqual({ ...HSV, h: 270 });
    expect(withChannel(HSV, "saturation", 25)).toEqual({ ...HSV, s: 0.25 });
    expect(withChannel(HSV, "value", 80)).toEqual({ ...HSV, v: 0.8 });
    expect(withChannel(HSV, "alpha", 0)).toEqual({ ...HSV, a: 0 });
  });

  it("refuses a non-finite channel instead of letting NaN through", () => {
    // The alternative — coercing to zero — would silently paint black.
    expect(withChannel(HSV, "saturation", Number.NaN)).toBe(HSV);
    expect(withChannelRatio(HSV, "hue", Number.NaN)).toBe(HSV);
  });

  it("round-trips a channel as a 0–1 ratio", () => {
    expect(channelRatio("hue", HSV)).toBe(0.5);
    expect(channelRatio("value", HSV)).toBe(0.5);
    expect(withChannelRatio(HSV, "value", 0.25)).toEqual({ ...HSV, v: 0.25 });
    expect(withChannelRatio(HSV, "hue", 2)).toEqual({ ...HSV, h: 360 });
  });
});

describe("keyboard stepping", () => {
  it("moves the arrows by one step", () => {
    expect(steppedValue(10, 0, 100, 1, "ArrowRight", false)).toBe(11);
    expect(steppedValue(10, 0, 100, 1, "ArrowLeft", false)).toBe(9);
    expect(steppedValue(10, 0, 100, 1, "ArrowUp", false)).toBe(11);
    expect(steppedValue(10, 0, 100, 1, "ArrowDown", false)).toBe(9);
  });

  it("moves a page by ten steps, and Shift+PageUp by the same ten", () => {
    // Page and Shift+Page both step by ten: the multiplier is the page's own,
    // so pressing Shift cannot turn one page into a hundred steps.
    expect(steppedValue(10, 0, 100, 1, "PageUp", false)).toBe(20);
    expect(steppedValue(10, 0, 100, 1, "PageUp", true)).toBe(20);
    expect(steppedValue(10, 0, 100, 1, "PageDown", false)).toBe(0);
  });

  it("takes Shift as ten arrow steps", () => {
    expect(steppedValue(10, 0, 100, 1, "ArrowRight", true)).toBe(20);
  });

  it("reaches the ends and refuses every other key", () => {
    expect(steppedValue(10, 0, 100, 1, "Home", false)).toBe(0);
    expect(steppedValue(10, 0, 100, 1, "End", false)).toBe(100);
    expect(steppedValue(10, 0, 100, 1, "a", false)).toBeUndefined();
  });

  it("clamps a step at the bound", () => {
    expect(steppedValue(99.5, 0, 100, 1, "ArrowRight", false)).toBe(100);
    expect(steppedValue(0.005, 0, 1, 0.01, "ArrowLeft", false)).toBe(0);
  });
});

describe("the saturation × brightness area", () => {
  it("places the handle with y inverted, top brightness", () => {
    expect(areaPoint({ h: 0, s: 1, v: 1, a: 1 })).toEqual({ x: 100, y: 0 });
    expect(areaPoint({ h: 0, s: 0, v: 0, a: 1 })).toEqual({ x: 0, y: 100 });
    expect(areaFromPoint(0.5, 0.25)).toEqual({ s: 0.5, v: 0.75 });
  });

  it("announces both channels and the colour", () => {
    const text = areaValueText({ h: 200, s: 0.5, v: 0.25, a: 1 }, "#102030");
    expect(text).toContain("Saturation");
    expect(text).toContain("brightness");
    expect(text).toContain("#102030");
  });
});
