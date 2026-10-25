import { describe, expect, it } from "vitest";
import {
  FakeSampleSource,
  PROFILES,
  profileFor,
  stableHash,
  waveform,
} from "./index.js";

const T0 = Date.parse("2026-01-01T00:00:00Z");

describe("determinism", () => {
  it("gives the same value for the same key and instant", () => {
    // The property a screenshot test depends on. If this fails, every visual
    // fixture becomes flaky.
    const a = new FakeSampleSource(T0);
    const b = new FakeSampleSource(T0);

    expect(a.sampleAt("cpu.load.total", T0)).toEqual(
      b.sampleAt("cpu.load.total", T0),
    );
  });

  it("does not depend on the order keys were asked for", () => {
    const source = new FakeSampleSource(T0);
    const first = source.sampleAt("gpu.temp", T0);
    source.sampleAt("cpu.load.total", T0);

    expect(source.sampleAt("gpu.temp", T0)).toEqual(first);
  });

  it("hashes strings the same way every time", () => {
    // The JS counterpart of the C# StableHash problem: nothing in either
    // runtime promises a stable string hash, so this is hand-written.
    expect(stableHash("cpu.load.total")).toBe(stableHash("cpu.load.total"));
    expect(stableHash("cpu.load.total")).not.toBe(stableHash("gpu.load.total"));
  });

  it("produces a 32-bit unsigned hash", () => {
    for (const key of ["", "a", "cpu.load.total", "x".repeat(200)]) {
      const hash = stableHash(key);
      expect(Number.isInteger(hash)).toBe(true);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe("waveform", () => {
  it("stays inside the profile range", () => {
    // A gauge clamps for display but reports the raw value, so a source that
    // strayed outside its own range would produce readouts the theme's axis
    // cannot explain.
    for (const [name, profile] of Object.entries(PROFILES)) {
      for (let second = 0; second < 600; second += 7) {
        const value = waveform(`test.${name}`, T0 + second * 1000, profile);
        expect(value).toBeGreaterThanOrEqual(profile.min);
        expect(value).toBeLessThanOrEqual(profile.max);
      }
    }
  });

  it("moves over time", () => {
    const profile = PROFILES["load"]!;
    const values = new Set(
      Array.from({ length: 20 }, (_, i) =>
        waveform("cpu.load.total", T0 + i * 1000, profile),
      ),
    );

    expect(values.size).toBeGreaterThan(10);
  });

  it("gives two keys with one profile different phases", () => {
    // A dashboard where every gauge agrees looks broken.
    const profile = PROFILES["load"]!;
    const cpu = waveform("cpu.load.total", T0, profile);
    const gpu = waveform("gpu.load.total", T0, profile);

    expect(cpu).not.toBe(gpu);
  });

  it("shifts everything when seeded differently", () => {
    const profile = PROFILES["temp"]!;
    expect(waveform("cpu.temp", T0, profile, 0)).not.toBe(
      waveform("cpu.temp", T0, profile, 7),
    );
  });
});

describe("profiles", () => {
  it("selects by the last segment of the key", () => {
    expect(profileFor("cpu.package.temp").unit).toBe("°C");
    expect(profileFor("gpu.core.load").unit).toBe("%");
  });

  it("falls back for an unknown segment rather than throwing", () => {
    const profile = profileFor("something.unrecognised");
    expect(profile.min).toBe(0);
    expect(profile.max).toBe(100);
  });

  it("handles a key with no dots", () => {
    expect(() => profileFor("load")).not.toThrow();
    expect(profileFor("load").unit).toBe("%");
  });
});

describe("latest", () => {
  it("holds still between sampling ticks", () => {
    // Matches the §122 one-second baseline. A source that produced a new value
    // per frame would let a theme look smooth for reasons the real system
    // cannot reproduce — and a value readout would flicker through digits.
    const source = new FakeSampleSource(T0, { sampleIntervalMs: 1000 });
    const first = source.latest("cpu.load.total");

    source.setNow(T0 + 400);
    expect(source.latest("cpu.load.total")).toEqual(first);

    source.setNow(T0 + 1000);
    expect(source.latest("cpu.load.total")).not.toEqual(first);
  });

  it("answers a capacity total as the constant it is", () => {
    // A device's total is not a moving quantity: the real host reports the same
    // 31.87 GB every tick while `used` moves. Both totals are above `used`'s
    // range (max 22.5 GB) so a theme reading the pair still adds up.
    const source = new FakeSampleSource(T0);

    for (const [key, total] of [
      ["ram.total", 32],
      ["vram.total", 24],
    ] as const) {
      expect(source.latest(key)?.value).toBe(total);
      source.setNow(T0 + 61_000);
      expect(source.latest(key)?.value).toBe(total);
      expect(source.sampleAt(key, T0 + 7_777)?.value).toBe(total);
      expect(
        new Set(source.history(key, 60).map((sample) => sample.value)).size,
      ).toBe(1);
    }
  });

  it("still moves the used reading a total is a share of", () => {
    const source = new FakeSampleSource(T0);
    source.setNow(T0 + 9_000);

    expect(source.latest("ram.used")?.value).not.toBe(
      source.sampleAt("ram.used", T0).value,
    );
  });

  it("carries the profile unit", () => {
    const source = new FakeSampleSource(T0);
    expect(source.latest("cpu.package.temp")?.unit).toBe("°C");
  });

  it("reports text values where configured", () => {
    const source = new FakeSampleSource(T0, {
      textValues: { "gpu.name": "RTX 4080" },
    });
    const sample = source.latest("gpu.name");

    expect(sample).toMatchObject({ status: "ok", textValue: "RTX 4080" });
    expect(sample?.value).toBeUndefined();
  });
});

describe("history", () => {
  it("is full immediately, so a 60 s chart does not take a minute to fill", () => {
    const source = new FakeSampleSource(T0, { sampleIntervalMs: 1000 });
    const history = source.history("cpu.load.total", 60);

    expect(history).toHaveLength(62);
  });

  it("is ordered oldest first", () => {
    const source = new FakeSampleSource(T0);
    const times = source
      .history("cpu.load.total", 10)
      .map((s) => Date.parse(s.timestamp));

    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("ends at the current quantised tick", () => {
    const source = new FakeSampleSource(T0 + 1500, { sampleIntervalMs: 1000 });
    const history = source.history("cpu.load.total", 5);

    expect(history.at(-1)!.timestamp).toBe(new Date(T0 + 1000).toISOString());
  });

  it("agrees with latest at the right edge", () => {
    const source = new FakeSampleSource(T0 + 12_345);
    expect(source.history("cpu.load.total", 30).at(-1)).toEqual(
      source.latest("cpu.load.total"),
    );
  });

  it("returns a single sample for a zero-length window", () => {
    expect(new FakeSampleSource(T0).history("cpu.load.total", 0)).toHaveLength(
      2,
    );
  });

  it("puts exactly one sample before the window's cutoff", () => {
    const source = new FakeSampleSource(T0, { sampleIntervalMs: 1000 });
    const history = source.history("cpu.load.total", 10);
    const cutoff = Date.parse(history.at(-1)!.timestamp) - 10_000;
    const before = history.filter((s) => Date.parse(s.timestamp) < cutoff);

    expect(before).toHaveLength(1);
  });
});

describe("failure simulation", () => {
  it("pins a key to a status, with no value attached", () => {
    const source = new FakeSampleSource(T0, {
      forcedStatus: { "cpu.temp": "unavailable" },
    });
    const sample = source.latest("cpu.temp");

    expect(sample?.status).toBe("unavailable");
    // §83: a non-ok sample carries no value, and the wire format omits the key.
    expect(sample && "value" in sample).toBe(false);
  });

  it("produces deterministic outage windows", () => {
    const source = new FakeSampleSource(T0, {
      outages: [{ semanticKey: "gpu.temp", everySeconds: 20, forSeconds: 5 }],
    });

    const statuses = source.history("gpu.temp", 60).map((s) => s.status);

    // Both states must appear, or the gap rendering this exists to exercise
    // would never be visible.
    expect(statuses).toContain("ok");
    expect(statuses).toContain("error");
  });

  it("leaves other keys alone", () => {
    const source = new FakeSampleSource(T0, {
      outages: [{ semanticKey: "gpu.temp", everySeconds: 2, forSeconds: 2 }],
    });

    expect(source.history("cpu.temp", 30).every((s) => s.status === "ok")).toBe(
      true,
    );
  });

  it("honours a custom outage status", () => {
    const source = new FakeSampleSource(T0, {
      outages: [
        {
          semanticKey: "gpu.temp",
          everySeconds: 10,
          forSeconds: 10,
          status: "stale",
        },
      ],
    });

    expect(source.latest("gpu.temp")?.status).toBe("stale");
  });

  it("reports an unmapped key as having no sample at all", () => {
    // Distinct from a `missing` status: nothing is mapped, so the theme needs
    // remapping (§141) rather than a retry. Without this option the source
    // would invent a value for every key and hide the case entirely.
    const source = new FakeSampleSource(T0, { unmappedKeys: ["disk.queue"] });

    expect(source.latest("disk.queue")).toBeUndefined();
    expect(source.history("disk.queue", 60)).toEqual([]);
    expect(source.latest("cpu.load")).toBeDefined();
  });

  it("ignores a rule with a non-positive cycle instead of dividing by zero", () => {
    const source = new FakeSampleSource(T0, {
      outages: [{ semanticKey: "gpu.temp", everySeconds: 0, forSeconds: 5 }],
    });

    expect(source.latest("gpu.temp")?.status).toBe("ok");
  });
});
