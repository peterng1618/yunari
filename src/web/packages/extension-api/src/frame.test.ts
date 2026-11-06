import { describe, expect, it } from "vitest";
import {
  FRAME_METHODS,
  type FrameRequest,
  readPluginFrameMessage,
} from "./frame";

function request(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: "yunari.frame.request",
    nonce: "nonce-1",
    id: "req-1",
    method: "settings.get",
    params: {},
    ...overrides,
  };
}

describe("the frame method table", () => {
  it("names the capability and write rule for every method", () => {
    expect(FRAME_METHODS["settings.get"]).toEqual({
      capability: "settings:own",
      write: false,
    });
    expect(FRAME_METHODS["settings.set"]).toEqual({
      capability: "settings:own",
      write: true,
    });
    expect(FRAME_METHODS["ui.resize"]).toEqual({
      capability: null,
      write: false,
    });
  });
});

describe("readPluginFrameMessage", () => {
  it("reads a valid request", () => {
    expect(readPluginFrameMessage(request())).toEqual({
      type: "yunari.frame.request",
      nonce: "nonce-1",
      id: "req-1",
      method: "settings.get",
      params: {},
    } satisfies FrameRequest);
  });

  it("refuses a write without a gesture token", () => {
    expect(
      readPluginFrameMessage(request({ method: "settings.set" })),
    ).toBeUndefined();
  });

  it("reads a write that carries a gesture token", () => {
    expect(
      readPluginFrameMessage(
        request({ method: "settings.set", gestureToken: "gesture-1" }),
      ),
    ).toEqual({
      type: "yunari.frame.request",
      nonce: "nonce-1",
      id: "req-1",
      method: "settings.set",
      params: {},
      gestureToken: "gesture-1",
    });
  });

  it("refuses an unknown method", () => {
    expect(
      readPluginFrameMessage(request({ method: "host.exec" })),
    ).toBeUndefined();
  });

  it("refuses a wrong nonce type", () => {
    expect(readPluginFrameMessage(request({ nonce: 7 }))).toBeUndefined();
  });

  it("refuses an extra key", () => {
    expect(readPluginFrameMessage(request({ extra: true }))).toBeUndefined();
  });

  it("refuses a missing params field", () => {
    const value = request();
    delete value["params"];
    expect(readPluginFrameMessage(value)).toBeUndefined();
  });

  it("reads a ready event", () => {
    expect(
      readPluginFrameMessage({ type: "yunari.frame.event", event: "ready" }),
    ).toEqual({ type: "yunari.frame.event", event: "ready" });
  });

  it("reads a resize event with a finite height", () => {
    expect(
      readPluginFrameMessage({
        type: "yunari.frame.event",
        event: "resize",
        height: 320,
      }),
    ).toEqual({ type: "yunari.frame.event", event: "resize", height: 320 });
  });

  it("refuses a resize event without a usable height", () => {
    expect(
      readPluginFrameMessage({ type: "yunari.frame.event", event: "resize" }),
    ).toBeUndefined();
    expect(
      readPluginFrameMessage({
        type: "yunari.frame.event",
        event: "resize",
        height: -1,
      }),
    ).toBeUndefined();
  });

  it("refuses a value that is not a frame message", () => {
    expect(readPluginFrameMessage(null)).toBeUndefined();
    expect(readPluginFrameMessage("ready")).toBeUndefined();
    expect(
      readPluginFrameMessage({ type: "yunari.frame.result" }),
    ).toBeUndefined();
  });
});
