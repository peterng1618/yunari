import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SIGNALRGB_UDP_PORT } from "../signalrgb/bridge.js";
import { createSignalRgbBridgeSettings } from "./signalrgb-bridge.js";

describe("SignalRGB bridge settings", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "yunari-signalrgb-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads the contract's port when nothing is stored", async () => {
    const store = createSignalRgbBridgeSettings(dir);
    expect(await store.read()).toBe(DEFAULT_SIGNALRGB_UDP_PORT);
  });

  it("stores a whole port from 1 to 65535 and reads it back", async () => {
    const store = createSignalRgbBridgeSettings(dir);
    expect(await store.writeUdpPort(9000)).toBe(9000);
    expect(await store.read()).toBe(9000);
    expect(
      JSON.parse(
        await readFile(path.join(dir, "signalrgb-bridge.json"), "utf8"),
      ),
    ).toEqual({
      udpPort: 9000,
    });
  });

  it("refuses a port this host could never bind", async () => {
    const store = createSignalRgbBridgeSettings(dir);

    for (const bad of [0, 65_536, 1.5, "7788", undefined, null]) {
      await expect(store.writeUdpPort(bad)).rejects.toThrow(
        /whole number from 1 to 65535/,
      );
    }
    expect(await store.read()).toBe(DEFAULT_SIGNALRGB_UDP_PORT);
  });
});
