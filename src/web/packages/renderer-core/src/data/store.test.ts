import { describe, expect, it } from "vitest";
import type { Sample } from "../types.js";
import { emptySampleSource } from "./source.js";
import { SampleStore } from "./store.js";

const NOW = Date.parse("2026-01-01T00:00:10Z");

function ok(value: number, atMs = NOW): Sample {
  return {
    sensorId: "cpu.load.total",
    timestamp: new Date(atMs).toISOString(),
    status: "ok",
    value,
    unit: "%",
  };
}

describe("emptySampleSource", () => {
  it("maps nothing", () => {
    expect(emptySampleSource.latest("cpu.load.total")).toBeUndefined();
    expect(emptySampleSource.history("cpu.load.total", 60)).toEqual([]);
  });
});

describe("SampleStore", () => {
  it("returns the latest ingested sample per key", () => {
    const store = new SampleStore();
    store.ingest(
      [
        ["a", ok(1)],
        ["a", ok(2)],
      ],
      NOW,
    );

    expect(store.latest("a")?.value).toBe(2);
    expect(store.latest("b")).toBeUndefined();
  });

  it("windows history by age", () => {
    const store = new SampleStore();
    store.ingest(
      [
        ["a", ok(1, NOW - 61_000)],
        ["a", ok(2, NOW - 1000)],
      ],
      NOW,
    );

    expect(store.history("a", 60).map((sample) => sample.value)).toEqual([
      1, 2,
    ]);
  });

  it("returns the last sample before the window as a predecessor", () => {
    const store = new SampleStore();
    store.ingest(
      [
        ["a", ok(1, NOW - 61_000)],
        ["a", ok(2, NOW - 60_500)],
        ["a", ok(3, NOW - 1000)],
      ],
      NOW,
    );

    expect(store.history("a", 60).map((s) => s.value)).toEqual([2, 3]);
  });

  it("returns only the predecessor when the window is empty", () => {
    const store = new SampleStore();
    store.ingest([["a", ok(1, NOW - 61_000)]], NOW);
    expect(store.history("a", 60).map((s) => s.value)).toEqual([1]);
  });

  it("windows delayed live samples by presentation time", () => {
    const store = new SampleStore();
    store.ingest(
      [
        [
          "a",
          {
            ...ok(1, NOW - 3_600_000),
            presentationTimestamp: new Date(NOW - 1_000).toISOString(),
          },
        ],
      ],
      NOW,
    );

    expect(store.history("a", 60).map((sample) => sample.value)).toEqual([1]);
  });

  it("caps retained samples per key", () => {
    const store = new SampleStore({ maxSamplesPerKey: 2 });
    store.ingest(
      [
        ["a", ok(1, NOW - 2000)],
        ["a", ok(2, NOW - 1000)],
        ["a", ok(3, NOW)],
      ],
      NOW,
    );

    expect(store.history("a", 3600).map((sample) => sample.value)).toEqual([
      2, 3,
    ]);
  });

  it("drops samples older than the age bound on ingest", () => {
    const store = new SampleStore({ maxAgeSeconds: 60 });
    store.ingest([["a", ok(1, NOW - 3_600_000)]], NOW);
    store.ingest([["a", ok(2, NOW)]], NOW);

    expect(store.history("a", 3600).map((sample) => sample.value)).toEqual([2]);
  });

  it("reset clears every key", () => {
    const store = new SampleStore();
    store.ingest([["a", ok(1)]], NOW);
    store.reset();

    expect(store.latest("a")).toBeUndefined();
    expect(store.history("a", 60)).toEqual([]);
  });
});
