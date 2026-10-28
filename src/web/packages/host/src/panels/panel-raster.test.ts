import { describe, expect, it } from "vitest";
import type { PanelGeometry } from "./panel-device.js";
import {
  captureOverlay,
  captureStill,
  type Devtools,
  screenshotParameters,
} from "./panel-raster.js";

const GEOMETRY: PanelGeometry = { width: 320, height: 480 };

interface Sent {
  readonly method: string;
  readonly params: Record<string, unknown>;
}

/** Records every request; a screenshot answers with a decodable image. */
function fakeDevtools(): {
  readonly devtools: Devtools;
  readonly sent: Sent[];
} {
  const sent: Sent[] = [];

  return {
    sent,
    devtools: {
      send: async (method, params = {}) => {
        sent.push({ method, params });
        return method === "Page.captureScreenshot"
          ? { result: { data: Buffer.from("still").toString("base64") } }
          : { result: {} };
      },
    },
  };
}

function request(sent: readonly Sent[], method: string): Sent {
  const found = sent.find((entry) => entry.method === method);
  if (found === undefined) throw new Error(`no ${method} was sent`);
  return found;
}

function expressionOf(sent: readonly Sent[]): string {
  return String(request(sent, "Runtime.evaluate").params["expression"]);
}

function screenshotOf(sent: readonly Sent[]): Record<string, unknown> {
  return request(sent, "Page.captureScreenshot").params;
}

const CLIP = { x: 0, y: 0, width: 320, height: 480, scale: 1 };

describe("screenshotParameters", () => {
  it("asks for PNG with no quality and JPEG 85 with one", () => {
    expect(screenshotParameters("png")).toEqual({ format: "png" });
    expect(screenshotParameters("jpeg")).toEqual({
      format: "jpeg",
      quality: 85,
    });
  });
});

describe("captureStill", () => {
  it("leaves overlay mode, clears the backdrop, then asks for JPEG 85", async () => {
    const { devtools, sent } = fakeDevtools();

    await captureStill(devtools, GEOMETRY, "jpeg");

    expect(sent.map((entry) => entry.method)).toEqual([
      "Runtime.evaluate",
      "Emulation.setDefaultBackgroundColorOverride",
      "Page.captureScreenshot",
    ]);
    // `if (false)` is the off branch: the style is removed rather than added.
    expect(expressionOf(sent)).toContain("if (false)");
    expect(expressionOf(sent)).toContain("style?.remove()");
    expect(
      request(sent, "Emulation.setDefaultBackgroundColorOverride").params,
    ).toEqual({});
    expect(screenshotOf(sent)).toEqual({
      format: "jpeg",
      quality: 85,
      clip: CLIP,
      captureBeyondViewport: false,
    });
  });

  it("asks for PNG and no quality when the device states that encoding", async () => {
    const { devtools, sent } = fakeDevtools();

    await captureStill(devtools, GEOMETRY, "png");

    expect(screenshotOf(sent)).toEqual({
      format: "png",
      clip: CLIP,
      captureBeyondViewport: false,
    });
  });
});

describe("captureOverlay", () => {
  it("enters overlay mode, asks for an alpha backdrop, then PNG", async () => {
    const { devtools, sent } = fakeDevtools();

    await captureOverlay(devtools, GEOMETRY);

    expect(sent.map((entry) => entry.method)).toEqual([
      "Runtime.evaluate",
      "Emulation.setDefaultBackgroundColorOverride",
      "Page.captureScreenshot",
    ]);

    const expression = expressionOf(sent);
    expect(expression).toContain("if (true)");
    expect(expression).toContain("yunari-panel-overlay");
    expect(expression).toContain("[data-yunari-background-media]");
    expect(expression).toContain("[data-yunari-display-disc]");
    expect(expression).toContain('host.style.background = "transparent"');
    expect(expression).toContain('host.dataset["panelOverlayBackground"]');
    // The save happens only once; every later entry re-asserts the clear.
    expect(expression).toContain("if (style === null)");

    expect(
      request(sent, "Emulation.setDefaultBackgroundColorOverride").params,
    ).toEqual({ color: { r: 0, g: 0, b: 0, a: 0 } });
    expect(screenshotOf(sent)).toEqual({
      format: "png",
      clip: CLIP,
      captureBeyondViewport: false,
    });
  });

  it("adds no second style on a repeat: the guard is in every entry script", async () => {
    const { devtools, sent } = fakeDevtools();

    await captureOverlay(devtools, GEOMETRY);
    await captureOverlay(devtools, GEOMETRY);

    const entries = sent.filter((entry) => entry.method === "Runtime.evaluate");
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(String(entry.params["expression"])).toContain(
        "if (style === null)",
      );
    }
  });
});
