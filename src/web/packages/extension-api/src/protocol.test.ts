import { describe, expect, it } from "vitest";
import { readPluginMessage } from "./protocol";

const REQUEST = {
  type: "plugin.request",
  id: "1",
  method: "network.fetch",
  params: {},
} as const;

describe("readPluginMessage", () => {
  it("reads a plugin request and refuses an unknown method", () => {
    expect(readPluginMessage(REQUEST)).toMatchObject({
      method: "network.fetch",
    });
    expect(
      readPluginMessage({ ...REQUEST, method: "process.spawn" }),
    ).toBeUndefined();
  });

  it("refuses anything that is not a known message type", () => {
    expect(
      readPluginMessage({ type: "plugin.unknown", id: "1" }),
    ).toBeUndefined();
    expect(readPluginMessage(null)).toBeUndefined();
    expect(readPluginMessage([])).toBeUndefined();
    expect(readPluginMessage("plugin.request")).toBeUndefined();
  });

  it("refuses a request whose method belongs to the host or has no id", () => {
    expect(readPluginMessage({ ...REQUEST, method: "init" })).toBeUndefined();
    expect(readPluginMessage({ ...REQUEST, method: 42 })).toBeUndefined();
    expect(readPluginMessage({ ...REQUEST, id: 1 })).toBeUndefined();
    expect(readPluginMessage({ ...REQUEST, id: undefined })).toBeUndefined();
    const { params, ...withoutParams } = REQUEST;
    expect(params).toEqual({});
    expect(readPluginMessage(withoutParams)).toBeUndefined();
  });

  it("refuses a request with an extra key", () => {
    expect(readPluginMessage({ ...REQUEST, extra: true })).toBeUndefined();
  });

  it("reads a successful result carrying any value", () => {
    expect(
      readPluginMessage({ type: "plugin.result", id: "1", ok: true, value: 7 }),
    ).toEqual({ type: "plugin.result", id: "1", ok: true, value: 7 });
    expect(
      readPluginMessage({ type: "plugin.result", id: "1", ok: true }),
    ).toEqual({ type: "plugin.result", id: "1", ok: true });
  });

  it("requires a string reason on a failed result", () => {
    expect(
      readPluginMessage({
        type: "plugin.result",
        id: "1",
        ok: false,
        reason: "boom",
      }),
    ).toEqual({ type: "plugin.result", id: "1", ok: false, reason: "boom" });
    expect(
      readPluginMessage({ type: "plugin.result", id: "1", ok: false }),
    ).toBeUndefined();
    expect(
      readPluginMessage({
        type: "plugin.result",
        id: "1",
        ok: false,
        reason: 42,
      }),
    ).toBeUndefined();
  });

  it("refuses a malformed result", () => {
    expect(
      readPluginMessage({ type: "plugin.result", id: "1", ok: "yes" }),
    ).toBeUndefined();
    expect(
      readPluginMessage({ type: "plugin.result", id: 1, ok: true }),
    ).toBeUndefined();
    expect(
      readPluginMessage({
        type: "plugin.result",
        id: "1",
        ok: true,
        extra: true,
      }),
    ).toBeUndefined();
    expect(
      readPluginMessage({
        type: "plugin.result",
        id: "1",
        ok: true,
        reason: 42,
      }),
    ).toBeUndefined();
  });

  it("reads a ready handshake for this plugin API only", () => {
    expect(readPluginMessage({ type: "plugin.ready", pluginApi: 1 })).toEqual({
      type: "plugin.ready",
      pluginApi: 1,
    });
    expect(
      readPluginMessage({ type: "plugin.ready", pluginApi: 2 }),
    ).toBeUndefined();
    expect(
      readPluginMessage({ type: "plugin.ready", pluginApi: 1, extra: true }),
    ).toBeUndefined();
  });

  it("reads a log with a known level and a string message only", () => {
    for (const level of ["info", "warn", "error"] as const) {
      expect(
        readPluginMessage({ type: "plugin.log", level, message: "hello" }),
      ).toEqual({ type: "plugin.log", level, message: "hello" });
    }
    expect(
      readPluginMessage({ type: "plugin.log", level: "debug", message: "x" }),
    ).toBeUndefined();
    expect(
      readPluginMessage({ type: "plugin.log", level: "info", message: 1 }),
    ).toBeUndefined();
    expect(
      readPluginMessage({
        type: "plugin.log",
        level: "info",
        message: "x",
        extra: true,
      }),
    ).toBeUndefined();
  });
});
