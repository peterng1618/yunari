import { describe, expect, it, vi } from "vitest";
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
    expect(emptySampleSource.revision).toBe(0);
    expect(emptySampleSource.latest("cpu.load.total")).toBeUndefined();
    expect(emptySampleSource.history("cpu.load.total", 60)).toEqual([]);
  });
});

describe("SampleStore", () => {
  it("counts accepted ingests, not the entries they carried", () => {
    const store = new SampleStore();

    expect(store.revision).toBe(0);

    store.ingest(
      [
        ["a", ok(1)],
        ["b", ok(2)],
        ["a", ok(3)],
      ],
      NOW,
    );
    expect(store.revision).toBe(1);

    store.ingest([["a", ok(4)]], NOW);
    expect(store.revision).toBe(2);

    store.reset();
    expect(store.revision).toBe(0);
  });

  it("keeps history for a sample mutated after ingest", () => {
    const store = new SampleStore();
    const sample = {
      ...ok(1, NOW),
      presentationTimestamp: new Date(NOW).toISOString(),
    };

    store.ingest([["a", sample]], NOW);

    // The time is captured at ingest, so destroying the source strings later
    // cannot drop a sample that was valid when accepted.
    const mutated = sample as {
      presentationTimestamp?: string;
      timestamp: string;
    };
    mutated.presentationTimestamp = "not a date";
    mutated.timestamp = "not a date";

    expect(store.history("a", 60)).toEqual([sample]);
  });

  it("queries a full window without re-parsing timestamps", () => {
    const store = new SampleStore();
    const entries: [string, Sample][] = [];

    for (let i = 0; i < 600; i++) {
      entries.push(["a", ok(i, NOW - (599 - i) * 500)]);
    }

    store.ingest(entries, NOW);

    const parse = vi.spyOn(Date, "parse");

    try {
      expect(store.history("a", 600)).toHaveLength(600);
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  });

  it("keeps the window intact when an unreadable time sits mid-list", () => {
    const store = new SampleStore();

    store.ingest(
      [
        ["a", ok(1, NOW - 3000)],
        ["a", { ...ok(2, NOW - 2000), timestamp: "not a date" }],
        ["a", ok(3, NOW - 1000)],
      ],
      NOW,
    );

    expect(store.history("a", 60).map((sample) => sample.value)).toEqual([
      1, 3,
    ]);
  });

  it("returns no samples for a non-finite window", () => {
    const store = new SampleStore();
    store.ingest([["a", ok(1)]], NOW);

    expect(store.history("a", Number.NaN)).toEqual([]);
  });

  it("keeps samples paired with their times after the count cap", () => {
    const store = new SampleStore({ maxSamplesPerKey: 2 });
    store.ingest(
      [
        ["a", ok(1, NOW - 2000)],
        ["a", ok(2, NOW - 1000)],
        ["a", ok(3, NOW)],
      ],
      NOW,
    );

    expect(store.history("a", 0.5).map((sample) => sample.value)).toEqual([3]);
  });

  it("keeps an unreadable sample out of history while it is retained", () => {
    const store = new SampleStore({ maxSamplesPerKey: 2 });
    store.ingest(
      [
        ["a", { ...ok(1, NOW - 1000), timestamp: "not a date" }],
        ["a", ok(2, NOW)],
      ],
      NOW,
    );

    expect(store.history("a", 3600).map((sample) => sample.value)).toEqual([2]);
    expect(store.latest("a")?.value).toBe(2);
  });

  it("drops an unreadable sample at the count cap like any other", () => {
    const store = new SampleStore({ maxSamplesPerKey: 1 });
    store.ingest(
      [
        ["a", { ...ok(1, NOW - 1000), timestamp: "not a date" }],
        ["a", ok(2, NOW)],
      ],
      NOW,
    );

    expect(store.history("a", 3600).map((sample) => sample.value)).toEqual([2]);
    expect(store.latest("a")?.value).toBe(2);
  });

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

    expect(store.history("a", 60).map((sample) => sample.value)).toEqual([2]);
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
