import { describe, expect, it, vi } from "vitest";
import type { Sample } from "../types.js";
import {
  createLiveSource,
  type EventSourceLike,
  type LiveSourceStatus,
} from "./live-source.js";
import {
  createBatch,
  formatSseEvent,
  PROTOCOL_VERSION,
  SAMPLE_EVENT,
} from "./protocol.js";

const NOW = Date.parse("2026-01-01T00:00:10Z");

function ok(value: number, key = "cpu.load"): Sample {
  return {
    sensorId: `os:${key}`,
    timestamp: new Date(NOW).toISOString(),
    status: "ok",
    value,
    unit: "%",
  };
}

/** A stand-in for EventSource that a test can fire events at. */
function fakeStream() {
  const listeners = new Map<
    string,
    ((event: { readonly data: string }) => void)[]
  >();
  const stream: EventSourceLike & {
    closed: boolean;
    emit(type: string, data?: string): void;
  } = {
    closed: false,
    addEventListener(type, listener) {
      const existing = listeners.get(type) ?? [];

      existing.push(listener);
      listeners.set(type, existing);
    },
    close() {
      stream.closed = true;
    },
    emit(type, data = "") {
      for (const listener of listeners.get(type) ?? []) {
        listener({ data });
      }
    },
  };

  return stream;
}

function setup() {
  const stream = fakeStream();
  let nowMs = NOW;
  const statuses: { status: LiveSourceStatus; detail?: string }[] = [];
  const handle = createLiveSource({
    url: "/ws?keys=cpu.load",
    now: () => nowMs,
    open: () => stream,
    onStatus: (status, detail) =>
      statuses.push(detail === undefined ? { status } : { status, detail }),
  });

  const sendBatch = (...samples: [string, Sample][]) => {
    stream.emit(
      SAMPLE_EVENT,
      JSON.stringify(
        createBatch(
          samples.map(([semanticKey, sample]) => ({ semanticKey, sample })),
          NOW,
        ),
      ),
    );
  };

  return {
    stream,
    statuses,
    handle,
    sendBatch,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

describe("createLiveSource", () => {
  it("starts connecting, and is not live until a batch actually arrives", () => {
    const { stream, handle } = setup();

    expect(handle.status).toBe("connecting");

    stream.emit("open");

    // An open socket is not a reading. Reporting "live" here would misdescribe
    // a host that connects and then sends nothing at all.
    expect(handle.status).toBe("connecting");
    expect(handle.batchCount).toBe(0);
  });

  it("goes live and exposes samples through the pull interface", () => {
    const { handle, sendBatch } = setup();

    sendBatch(["cpu.load", ok(42)]);

    expect(handle.status).toBe("live");
    expect(handle.batchCount).toBe(1);
    expect(handle.source.latest("cpu.load")?.value).toBe(42);
  });

  it("timestamps received telemetry on the browser presentation clock", () => {
    const { handle, sendBatch } = setup();

    sendBatch(["cpu.load", ok(42)]);

    expect(handle.source.latest("cpu.load")).toMatchObject({
      timestamp: new Date(NOW).toISOString(),
      presentationTimestamp: new Date(NOW).toISOString(),
    });
  });

  it("reports the store's revision, once per accepted batch", () => {
    const { handle, sendBatch } = setup();

    expect(handle.source.revision).toBe(0);

    sendBatch(["cpu.load", ok(10)], ["cpu.load", ok(20)]);
    expect(handle.source.revision).toBe(1);

    sendBatch(["cpu.load", ok(30)]);
    expect(handle.source.revision).toBe(2);
  });

  it("accumulates history across batches", () => {
    const { handle, sendBatch, advance } = setup();

    sendBatch(["cpu.load", ok(10)]);
    sendBatch(["cpu.load", ok(20)]);

    advance(1_000);
    expect(
      handle.source.history("cpu.load", 60).map((sample) => sample.value),
    ).toEqual([10, 20]);
    expect(handle.batchCount).toBe(2);
  });

  it("keeps the source identity stable, so the plan builder can hold it", () => {
    const { handle, sendBatch } = setup();
    const before = handle.source;

    sendBatch(["cpu.load", ok(1)]);

    expect(handle.source).toBe(before);
  });

  it("carries a non-ok sample through without inventing a value (§83)", () => {
    const { handle, sendBatch, advance } = setup();
    const unavailable: Sample = {
      sensorId: "os:cpu.fan",
      timestamp: new Date(NOW).toISOString(),
      status: "unavailable",
      message: "no driver",
    };

    sendBatch(["cpu.fan", unavailable]);
    advance(1_000);

    const latest = handle.source.latest("cpu.fan");

    expect(latest?.status).toBe("unavailable");
    expect(latest).not.toHaveProperty("value");
  });

  it("reports an unmapped key as absent rather than as zero", () => {
    const { handle, sendBatch } = setup();

    sendBatch(["cpu.load", ok(42)]);

    expect(handle.source.latest("gpu.temp")).toBeUndefined();
    expect(handle.source.history("gpu.temp", 60)).toEqual([]);
  });

  describe("connection loss", () => {
    it("reports reconnecting and lets EventSource retry", () => {
      const { stream, handle } = setup();

      stream.emit(SAMPLE_EVENT, JSON.stringify(createBatch([], NOW)));
      expect(handle.status).toBe("live");

      stream.emit("error");

      expect(handle.status).toBe("reconnecting");
      // A dropped Wi-Fi link is EventSource's job to retry, so we must NOT
      // close the stream here.
      expect(stream.closed).toBe(false);
    });

    it("returns to live when batches resume", () => {
      const { stream, handle, sendBatch, advance } = setup();

      sendBatch(["cpu.load", ok(1)]);
      stream.emit("error");
      stream.emit("open");
      sendBatch(["cpu.load", ok(2)]);

      expect(handle.status).toBe("live");
      advance(1_000);
      expect(handle.source.latest("cpu.load")?.value).toBe(2);
    });

    it("keeps the last known values across a drop", () => {
      const { stream, handle, sendBatch, advance } = setup();

      sendBatch(["cpu.load", ok(42)]);
      advance(1_000);
      stream.emit("error");

      // Staleness is the store's and the renderer's call, not the transport's.
      // Discarding history on a blip would blank a chart on every hiccup.
      expect(handle.source.latest("cpu.load")?.value).toBe(42);
    });
  });

  describe("refusing an incompatible host (§141)", () => {
    it("refuses a newer protocol and stops rather than looping", () => {
      const { stream, handle, statuses } = setup();

      stream.emit(
        SAMPLE_EVENT,
        JSON.stringify({
          version: PROTOCOL_VERSION + 1,
          sentAt: "x",
          samples: [],
        }),
      );

      expect(handle.status).toBe("refused");
      // The important half: EventSource would otherwise reconnect forever into
      // a frame it cannot parse.
      expect(stream.closed).toBe(true);
      expect(statuses.at(-1)?.detail).toContain(String(PROTOCOL_VERSION + 1));
    });

    it("refuses an unparseable frame", () => {
      const { stream, handle } = setup();

      stream.emit(SAMPLE_EVENT, "{not json");

      expect(handle.status).toBe("refused");
      expect(stream.closed).toBe(true);
    });

    it("does not let the close it caused downgrade the refusal to reconnecting", () => {
      const { stream, handle } = setup();

      stream.emit(SAMPLE_EVENT, "{not json");
      // Closing a stream makes EventSource fire error. The refusal has to
      // survive it, or the display would claim it is retrying when it is not.
      stream.emit("error");

      expect(handle.status).toBe("refused");
    });

    it("leaves a previously good reading in place", () => {
      const { stream, handle, sendBatch, advance } = setup();

      sendBatch(["cpu.load", ok(42)]);
      advance(1_000);
      stream.emit(SAMPLE_EVENT, "{not json");

      expect(handle.source.latest("cpu.load")?.value).toBe(42);
    });
  });

  describe("close", () => {
    it("closes the stream", () => {
      const { stream, handle } = setup();

      handle.close();

      expect(stream.closed).toBe(true);
    });

    it("is idempotent", () => {
      const { stream, handle } = setup();
      const spy = vi.spyOn(stream, "close");

      handle.close();
      handle.close();

      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  it("parses what the host actually writes on the wire", () => {
    // Guards the seam the two modules share: if formatSseEvent and the
    // EventSource data contract ever disagree, this is where it shows.
    const { stream, handle, advance } = setup();
    const framed = formatSseEvent(
      SAMPLE_EVENT,
      JSON.stringify(
        createBatch([{ semanticKey: "cpu.load", sample: ok(7) }], NOW),
      ),
    );
    const data = framed
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice("data: ".length))
      .join("\n");

    stream.emit(SAMPLE_EVENT, data);

    advance(1_000);
    expect(handle.source.latest("cpu.load")?.value).toBe(7);
  });
});
