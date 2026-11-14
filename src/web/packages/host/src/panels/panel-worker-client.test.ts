import { describe, expect, it, vi } from "vitest";
import type { DeviceTelemetry } from "./device-sink.js";
import { openPanelWorker, type WorkerThread } from "./panel-worker-client.js";
import type {
  WorkerAsk,
  WorkerOpened,
  WorkerReply,
} from "./panel-worker-protocol.js";

/**
 * The client's job is the wire, so the thread is replaced by one that records
 * what it was asked and answers by hand. The device, the rasteriser and the
 * sink are the same interfaces the runner already drives, which is the property
 * these tests exist to hold.
 */

const OPENED: WorkerOpened = {
  geometry: { width: 640, height: 480 },
  stillFormat: "png",
  frameIntervalMs: 110,
  hasVideo: true,
  commands: ["brightness", "screen"],
  sink: {
    id: "kraken-0",
    kind: "kraken",
    name: "Kraken Z",
    lighting: {
      ledCount: 24,
      channels: [{ name: "ring", leds: 24 }],
      layout: { shape: "ring", width: 24, height: 1 },
    },
    controls: { pump: true, fans: false, telemetry: true },
    display: { kind: "panel", width: 640, height: 480 },
  },
};

const TELEMETRY: DeviceTelemetry = {
  liquidTempC: 31.5,
  pumpRpm: 1_900,
  fanRpm: 0,
  pumpPercent: 60,
  fanPercent: 0,
};

interface FakeThread {
  readonly thread: WorkerThread;
  readonly asks: Array<WorkerAsk & { readonly id: number }>;
  /** Shared, not copied, so a spread of this record still sees the truth. */
  readonly state: { terminated: boolean };
  reply(id: number, value?: unknown): void;
  refuse(id: number, message: string): void;
  crash(error: Error): void;
}

function threadOver(): FakeThread {
  const asks: Array<WorkerAsk & { readonly id: number }> = [];
  const messages: Array<(message: unknown) => void> = [];
  const errors: Array<(error: Error) => void> = [];
  const exits: Array<(code: number) => void> = [];
  const state = { terminated: false };

  const thread = {
    on(event: string, listener: (payload: never) => void): void {
      if (event === "message") {
        messages.push(listener as (message: unknown) => void);
        return;
      }
      if (event === "error") {
        errors.push(listener as (error: Error) => void);
        return;
      }
      exits.push(listener as (code: number) => void);
    },
    postMessage(message: unknown): void {
      asks.push(message as WorkerAsk & { readonly id: number });
    },
    unref(): void {},
    terminate: async (): Promise<number> => {
      state.terminated = true;
      return 0;
    },
  } as unknown as WorkerThread;

  const deliver = (reply: WorkerReply): void => {
    for (const listener of messages) listener(reply);
  };

  return {
    thread,
    asks,
    state,
    reply: (id: number, value?: unknown) =>
      deliver({ id, ok: true, ...(value === undefined ? {} : { value }) }),
    refuse: (id: number, message: string) =>
      deliver({ id, ok: false, message }),
    crash(error) {
      for (const listener of errors) listener(error);
    },
  };
}

/** Opens a worker whose `open` has been answered with {@link OPENED}. */
async function openedWorker(): Promise<
  FakeThread & { worker: Awaited<ReturnType<typeof openPanelWorker>> }
> {
  const fake = threadOver();
  const opening = openPanelWorker({
    vendorId: 0x1cbe,
    productId: 0xa092,
    spawn: () => fake.thread,
  });

  fake.reply(fake.asks[0]?.id ?? 0, OPENED);

  return { ...fake, worker: await opening };
}

describe("openPanelWorker", () => {
  it("answers the opened device's own members", async () => {
    const { worker } = await openedWorker();

    expect(worker.device.geometry).toEqual({ width: 640, height: 480 });
    expect(worker.device.stillFormat).toBe("png");
    expect(worker.device.frameIntervalMs).toBe(110);
    expect(worker.device.controls?.commands).toEqual(["brightness", "screen"]);
    expect(worker.device.video).toBeDefined();
    expect(worker.device.sink?.id).toBe("kraken-0");
    expect(worker.device.sink?.lighting?.ledCount).toBe(24);
    expect(worker.device.sink?.controls?.pump).toBe(true);
    expect(worker.device.sink?.display).toEqual({
      kind: "panel",
      width: 640,
      height: 480,
    });
  });

  it("asks the thread for a frame and refuses with the thread's message", async () => {
    const { worker, asks, reply, refuse } = await openedWorker();
    const frame = Uint8Array.of(9, 8, 7);

    const sent = worker.device.present(frame);
    const ask = asks.at(-1);
    expect(ask).toMatchObject({ kind: "present" });
    expect((ask as { still: Uint8Array }).still).toEqual(frame);

    reply(ask?.id ?? 0);
    await expect(sent).resolves.toBeUndefined();

    const refused = worker.device.present(frame);
    refuse(asks.at(-1)?.id ?? 0, "the panel refused the frame");
    await expect(refused).rejects.toThrow("the panel refused the frame");
  });

  it("sends commands, lighting and controls as requests", async () => {
    const { worker, asks, reply } = await openedWorker();

    const run = worker.device.controls?.run({ kind: "status" });
    expect(asks.at(-1)).toMatchObject({
      kind: "command",
      command: { kind: "status" },
    });
    reply(asks.at(-1)?.id ?? 0, "ok");
    await expect(run).resolves.toBe("ok");

    const colours = worker.device.sink?.writeColors(Uint8Array.of(1, 2, 3));
    expect(asks.at(-1)).toMatchObject({ kind: "colors" });
    reply(asks.at(-1)?.id ?? 0);
    await colours;

    const set = worker.device.sink?.controls?.set({ pumpPercent: 60 });
    expect(asks.at(-1)).toMatchObject({
      kind: "set-controls",
      input: { pumpPercent: 60 },
    });
    reply(asks.at(-1)?.id ?? 0);
    await set;

    const read = worker.device.sink?.controls?.read();
    expect(asks.at(-1)).toMatchObject({ kind: "read-controls" });
    reply(asks.at(-1)?.id ?? 0, TELEMETRY);
    await expect(read).resolves.toEqual(TELEMETRY);
  });

  it("attaches a page, captures through it, and gives the page back", async () => {
    const { worker, asks, reply } = await openedWorker();
    const closePage = vi.fn(async () => {});

    const attaching = worker.attach({
      pageUrl: "ws://127.0.0.1:1/devtools/page/t1",
      url: "http://127.0.0.1:5227/?display=strip&panel=1",
      closePage,
    });
    expect(asks.at(-1)).toMatchObject({
      kind: "attach",
      pageUrl: "ws://127.0.0.1:1/devtools/page/t1",
      url: "http://127.0.0.1:5227/?display=strip&panel=1",
    });
    reply(asks.at(-1)?.id ?? 0);

    const rasterizer = await attaching;

    const still = rasterizer.capture();
    expect(asks.at(-1)).toMatchObject({ kind: "capture", overlay: false });
    reply(asks.at(-1)?.id ?? 0, Uint8Array.of(5, 6));
    await expect(still).resolves.toEqual(Uint8Array.of(5, 6));

    const overlay = rasterizer.captureOverlay();
    expect(asks.at(-1)).toMatchObject({ kind: "capture", overlay: true });
    reply(asks.at(-1)?.id ?? 0, Uint8Array.of(7));
    await expect(overlay).resolves.toEqual(Uint8Array.of(7));

    const closing = rasterizer.close();
    expect(asks.at(-1)).toMatchObject({ kind: "close-raster" });
    reply(asks.at(-1)?.id ?? 0);
    await closing;

    expect(closePage).toHaveBeenCalledTimes(1);
  });

  it("closes the device on the thread and stops it", async () => {
    const fake = await openedWorker();
    const { worker, asks } = fake;

    const closing = worker.device.close();
    expect(asks.at(-1)).toMatchObject({ kind: "close" });

    fake.reply(asks.at(-1)?.id ?? 0);
    await closing;

    expect(fake.state.terminated).toBe(true);
    await expect(worker.device.present(Uint8Array.of(1))).rejects.toThrow(
      "closed",
    );
  });

  it("fails every waiting request when the thread dies", async () => {
    const fake = await openedWorker();
    const waiting = fake.worker.device.present(Uint8Array.of(1));

    fake.crash(new Error("the panel worker died"));

    await expect(waiting).rejects.toThrow("the panel worker died");
    await expect(fake.worker.device.present(Uint8Array.of(2))).rejects.toThrow(
      "the panel worker died",
    );
  });

  it("stops the thread when the device cannot be opened", async () => {
    const fake = threadOver();
    const opening = openPanelWorker({
      vendorId: 0x1cbe,
      productId: 0xa092,
      spawn: () => fake.thread,
    });

    fake.refuse(fake.asks[0]?.id ?? 0, "the panel is held by another program");

    await expect(opening).rejects.toThrow("held by another program");
    expect(fake.state.terminated).toBe(true);
  });
});
