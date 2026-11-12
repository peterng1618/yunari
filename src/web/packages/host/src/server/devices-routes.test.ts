import http from "node:http";
import { Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  BridgeRequestError,
  DeviceNotFoundError,
  type SignalRgbBridge,
} from "../signalrgb/bridge.js";
import { createDeviceRoutes } from "./devices-routes.js";

interface Call {
  readonly status: number;
  readonly text: string;
  readonly json: () => unknown;
}

function bridgeRecorder(): {
  bridge: SignalRgbBridge;
  controls: unknown[];
  modes: unknown[];
} {
  const controls: unknown[] = [];
  const modes: unknown[] = [];

  return {
    controls,
    modes,
    bridge: {
      port: 7788,
      describe: () => ({
        hub: { name: "Yunari", vendor: "Yunari" },
        devices: [],
        stats: { received: 2, malformed: 0, dropped: 0 },
      }),
      controls: async (id, input) => {
        if (id !== "kraken-z")
          throw new DeviceNotFoundError(`No device ${id}.`);
        const body = input as Record<string, unknown>;
        if (typeof body["pumpPercent"] !== "number") {
          throw new BridgeRequestError("pumpPercent must be a number.");
        }
        controls.push({ id, input });
      },
      telemetry: async (id) => {
        if (id !== "kraken-z")
          throw new DeviceNotFoundError(`No device ${id}.`);
        return {
          liquidTempC: 31.5,
          pumpRpm: 1_800,
          fanRpm: 900,
          pumpPercent: 55,
          fanPercent: 40,
        };
      },
      lightingMode: async (id, input) => {
        if (id !== "kraken-z")
          throw new DeviceNotFoundError(`No device ${id}.`);
        modes.push({ id, input });
      },
      close: async () => undefined,
    },
  };
}

function call(
  deps: Parameters<typeof createDeviceRoutes>[0],
  options: {
    readonly method: string;
    readonly path: string;
    readonly body?: string;
    readonly remoteAddress?: string;
  },
): Promise<Call> {
  return new Promise((resolve) => {
    const request = new Readable({
      read() {
        if (options.body !== undefined) this.push(Buffer.from(options.body));
        this.push(null);
      },
    }) as unknown as http.IncomingMessage;

    request.method = options.method;
    request.url = options.path;
    request.headers = { host: "127.0.0.1:5227" };
    if (options.body !== undefined) {
      request.headers["content-length"] = String(
        Buffer.byteLength(options.body),
      );
    }
    (request as { socket: { remoteAddress: string } }).socket = {
      remoteAddress: options.remoteAddress ?? "127.0.0.1",
    };

    const chunks: Buffer[] = [];
    let statusCode = 200;
    const response = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    }) as unknown as http.ServerResponse;

    response.writeHead = ((status: number) => {
      statusCode = status;
      return response;
    }) as unknown as typeof response.writeHead;
    response.setHeader = (() =>
      response) as unknown as typeof response.setHeader;
    response.end = ((data?: unknown) => {
      // A 204 is set as `statusCode`; `writeHead` set the local one.
      if (response.statusCode !== undefined) statusCode = response.statusCode;
      if (data !== undefined) chunks.push(Buffer.from(data as string));
      const text = Buffer.concat(chunks).toString("utf8");
      resolve({ status: statusCode, text, json: () => JSON.parse(text) });
      return response;
    }) as unknown as typeof response.end;

    void createDeviceRoutes(deps)(
      request,
      response,
      new URL(options.path, "http://127.0.0.1:5227"),
    );
  });
}

describe("the device routes", () => {
  it("leaves the assignment path to the settings route", async () => {
    const { bridge } = bridgeRecorder();
    const handled = await createDeviceRoutes({ bridge: () => bridge })(
      { socket: { remoteAddress: "127.0.0.1" } } as http.IncomingMessage,
      {} as http.ServerResponse,
      new URL("http://127.0.0.1:5227/api/devices"),
    );

    expect(handled).toBe(false);
  });

  it("answers 404 for a device route when the bridge is not running", async () => {
    const answer = await call(
      { bridge: () => undefined },
      { method: "GET", path: "/api/devices/kraken-z/telemetry" },
    );

    expect(answer.status).toBe(404);
  });

  it("refuses a client that is not on this PC", async () => {
    const { bridge } = bridgeRecorder();
    const answer = await call(
      { bridge: () => bridge },
      {
        method: "GET",
        path: "/api/devices/kraken-z/telemetry",
        remoteAddress: "192.168.1.20",
      },
    );

    expect(answer.status).toBe(403);
  });

  it("writes controls and answers 204", async () => {
    const { bridge, controls } = bridgeRecorder();
    const answer = await call(
      { bridge: () => bridge },
      {
        method: "POST",
        path: "/api/devices/kraken-z/controls",
        body: JSON.stringify({ pumpPercent: 60, fanPercent: 40 }),
      },
    );

    expect(answer.status).toBe(204);
    expect(answer.text).toBe("");
    expect(controls).toEqual([
      { id: "kraken-z", input: { pumpPercent: 60, fanPercent: 40 } },
    ]);
  });

  it("answers the seam's own refusals", async () => {
    const { bridge } = bridgeRecorder();

    const missing = await call(
      { bridge: () => bridge },
      {
        method: "POST",
        path: "/api/devices/other/controls",
        body: JSON.stringify({ pumpPercent: 50 }),
      },
    );
    expect(missing.status).toBe(404);

    const badBody = await call(
      { bridge: () => bridge },
      {
        method: "POST",
        path: "/api/devices/kraken-z/controls",
        body: JSON.stringify({ fanPercent: "loud" }),
      },
    );
    expect(badBody.status).toBe(400);

    const badJson = await call(
      { bridge: () => bridge },
      {
        method: "POST",
        path: "/api/devices/kraken-z/controls",
        body: "{",
      },
    );
    expect(badJson.status).toBe(400);
  });

  it("answers telemetry and accepts a lighting mode", async () => {
    const { bridge, modes } = bridgeRecorder();

    const reading = await call(
      { bridge: () => bridge },
      { method: "GET", path: "/api/devices/kraken-z/telemetry" },
    );
    expect(reading.status).toBe(200);
    expect(reading.json()).toEqual({
      liquidTempC: 31.5,
      pumpRpm: 1_800,
      fanRpm: 900,
      pumpPercent: 55,
      fanPercent: 40,
    });

    const mode = await call(
      { bridge: () => bridge },
      {
        method: "POST",
        path: "/api/devices/kraken-z/lighting-mode",
        body: JSON.stringify({ mode: "forced", color: "#102030" }),
      },
    );
    expect(mode.status).toBe(204);
    expect(modes).toEqual([
      { id: "kraken-z", input: { mode: "forced", color: "#102030" } },
    ]);
  });

  it("states the method a path supports", async () => {
    const { bridge } = bridgeRecorder();
    const answer = await call(
      { bridge: () => bridge },
      { method: "GET", path: "/api/devices/kraken-z/controls" },
    );

    expect(answer.status).toBe(405);
    expect(answer.text).toContain("POST");
  });
});
