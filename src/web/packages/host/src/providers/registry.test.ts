import type { Sample, SampleEntry } from "@yunari/renderer-core";
import { describe, expect, it, vi } from "vitest";
import type {
  ProviderHealth,
  SampleContext,
  SensorDescriptor,
  SensorProvider,
} from "./provider.js";
import { groupByAsk, ProviderRegistry, unionOfKeys } from "./registry.js";

const NOW = Date.parse("2026-01-01T00:00:10Z");

function sample(sensorId: string, value: number | string): Sample {
  return {
    sensorId,
    timestamp: new Date(NOW).toISOString(),
    status: "ok",
    ...(typeof value === "string"
      ? { textValue: value }
      : { value, unit: "%" }),
  };
}

/** A provider that answers a fixed set of keys and records every call. */
function stubProvider(
  id: string,
  answers: Record<string, number | string>,
  options: {
    readonly failWith?: string;
    /** Keys this provider reports as a gap rather than answering. */
    readonly gaps?: readonly string[];
  } = {},
): SensorProvider & {
  readonly calls: string[][];
  readonly contexts: SampleContext[];
} {
  const calls: string[][] = [];
  const contexts: SampleContext[] = [];
  const gaps = new Set(options.gaps ?? []);

  return {
    id,
    label: id,
    calls,
    contexts,
    describe(): Promise<readonly SensorDescriptor[]> {
      return Promise.resolve(
        Object.keys(answers).map((key) => ({
          sensorId: `${id}:${key}`,
          semanticKey: key,
          label: key,
          tier: "baseline" as const,
        })),
      );
    },
    sample(
      semanticKeys: readonly string[],
      _nowMs: number,
      context: SampleContext = {},
    ): Promise<readonly SampleEntry[]> {
      calls.push([...semanticKeys]);
      contexts.push(context);

      if (options.failWith !== undefined) {
        return Promise.reject(new Error(options.failWith));
      }

      return Promise.resolve(
        semanticKeys
          .filter((key) => key in answers)
          .map((key) => ({
            semanticKey: key,
            sample: gaps.has(key)
              ? {
                  sensorId: `${id}:${key}`,
                  timestamp: new Date(NOW).toISOString(),
                  status: "missing" as const,
                  message: `${id} cannot name that device`,
                }
              : sample(`${id}:${key}`, answers[key] ?? 0),
          })),
      );
    },
    health(): ProviderHealth {
      return { available: options.failWith === undefined };
    },
  };
}

describe("unionOfKeys", () => {
  it("merges what several displays need into one set", () => {
    expect(
      unionOfKeys([
        ["cpu.load", "ram.used"],
        ["cpu.load", "gpu.temp"],
      ]),
    ).toEqual(["cpu.load", "gpu.temp", "ram.used"]);
  });

  it("is empty when nothing is displayed, so nothing gets polled (§111)", () => {
    expect(unionOfKeys([])).toEqual([]);
    expect(unionOfKeys([[], []])).toEqual([]);
  });

  it("is stable regardless of client order", () => {
    const a = unionOfKeys([["b", "a"], ["c"]]);
    const b = unionOfKeys([["c"], ["a", "b"]]);

    expect(a).toEqual(b);
  });
});

describe("groupByAsk", () => {
  it("samples once per distinct assignment, not once per display", async () => {
    // Three connections on three displays, two of which resolved the same
    // devices: the host groups them before it samples, so this PC is polled
    // twice — a poll is the machine's work, not a screen's.
    const os = stubProvider("os", { "gpu.temp": 60 });
    const registry = new ProviderRegistry([os]);

    const groups = groupByAsk([
      {
        display: "this-pc",
        semanticKeys: ["gpu.temp"],
        assignment: { gpu: "gpu-0" },
      },
      {
        display: "desk",
        semanticKeys: ["gpu.temp"],
        assignment: { gpu: "gpu-0" },
      },
      {
        display: "kitchen-tablet",
        semanticKeys: ["gpu.temp"],
        assignment: { gpu: "gpu-1" },
      },
    ]);

    for (const group of groups) {
      await registry.sample(group.semanticKeys, NOW, {
        assignment: group.assignment,
        ...(group.language === undefined ? {} : { language: group.language }),
      });
    }

    expect(groups.map((group) => group.displays)).toEqual([
      ["this-pc", "desk"],
      ["kitchen-tablet"],
    ]);
    expect(os.calls).toHaveLength(2);
    // Each poll was made with the assignment its own displays resolved, which
    // is what makes the two answers differ.
    expect(os.contexts).toEqual([
      { assignment: { gpu: "gpu-0" } },
      { assignment: { gpu: "gpu-1" } },
    ]);
  });

  it("asks for the union of what the displays it grouped need", () => {
    const groups = groupByAsk([
      {
        display: "this-pc",
        semanticKeys: ["cpu.load", "gpu.temp"],
        assignment: {},
      },
      { display: "desk", semanticKeys: ["gpu.temp"], assignment: {} },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.semanticKeys).toEqual(["cpu.load", "gpu.temp"]);
  });

  it("samples twice for one assignment shown in two languages", async () => {
    // Localization is per display, so the language is part of what makes a
    // poll: one assignment in German and English is two answers, not one.
    const os = stubProvider("os", { "weather.temp": 10 });
    const registry = new ProviderRegistry([os]);

    const groups = groupByAsk([
      {
        display: "desk",
        semanticKeys: ["weather.temp"],
        assignment: {},
        language: "de",
      },
      {
        display: "phone",
        semanticKeys: ["weather.temp"],
        assignment: {},
        language: "en",
      },
    ]);

    expect(groups).toHaveLength(2);

    for (const group of groups) {
      await registry.sample(group.semanticKeys, NOW, {
        assignment: group.assignment,
        ...(group.language === undefined ? {} : { language: group.language }),
      });
    }

    expect(os.calls).toHaveLength(2);
    expect(os.contexts).toEqual([
      { assignment: {}, language: "de" },
      { assignment: {}, language: "en" },
    ]);
  });

  it("keeps one group when the languages match too", () => {
    const groups = groupByAsk([
      {
        display: "desk",
        semanticKeys: ["weather.condition"],
        assignment: {},
        language: "de",
      },
      {
        display: "phone",
        semanticKeys: ["weather.condition"],
        assignment: {},
        language: "de",
      },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.displays).toEqual(["desk", "phone"]);
  });
});

describe("ProviderRegistry", () => {
  it("polls each provider ONCE per cycle for the union, not once per client", async () => {
    const os = stubProvider("os", { "cpu.load": 10 });
    const registry = new ProviderRegistry([os]);

    // Two phones both showing cpu.load is one key, and must be one poll.
    const keys = unionOfKeys([["cpu.load"], ["cpu.load"]]);
    await registry.sample(keys, NOW);

    expect(os.calls).toEqual([["cpu.load"]]);
  });

  it("does not poll at all when no display needs anything", async () => {
    const os = stubProvider("os", { "cpu.load": 10 });
    const registry = new ProviderRegistry([os]);

    const cycle = await registry.sample([], NOW);

    expect(os.calls).toEqual([]);
    expect(cycle.entries).toEqual([]);
  });

  it("merges entries from several providers in one cycle", async () => {
    const registry = new ProviderRegistry([
      stubProvider("os", { "cpu.load": 10 }),
      stubProvider("lhm", { "cpu.temp.package": 65 }),
    ]);

    const cycle = await registry.sample(["cpu.load", "cpu.temp.package"], NOW);

    expect(cycle.entries.map((entry) => entry.semanticKey).sort()).toEqual([
      "cpu.load",
      "cpu.temp.package",
    ]);
    expect(cycle.failures).toEqual([]);
  });

  describe("failure isolation", () => {
    it("keeps baseline telemetry when the extended provider throws", async () => {
      const os = stubProvider("os", { "cpu.load": 10 });
      const lhm = stubProvider(
        "lhm",
        { "cpu.temp.package": 65 },
        { failWith: "LHM not running" },
      );
      const registry = new ProviderRegistry([os, lhm]);

      const cycle = await registry.sample(
        ["cpu.load", "cpu.temp.package"],
        NOW,
      );

      // The whole point: LHM being absent is normal, and must not take the
      // machine's CPU load down with it.
      expect(cycle.entries).toHaveLength(1);
      expect(cycle.entries[0]?.semanticKey).toBe("cpu.load");
      expect(cycle.failures).toEqual([
        { providerId: "lhm", message: "LHM not running" },
      ]);
    });

    it("isolates a failure regardless of precedence position", async () => {
      // A failing FIRST provider must not discard the second's results either
      // — which is what Promise.all would have done.
      const registry = new ProviderRegistry([
        stubProvider("os", { "cpu.load": 10 }, { failWith: "boom" }),
        stubProvider("lhm", { "cpu.temp.package": 65 }),
      ]);

      const cycle = await registry.sample(
        ["cpu.load", "cpu.temp.package"],
        NOW,
      );

      expect(cycle.entries.map((entry) => entry.semanticKey)).toEqual([
        "cpu.temp.package",
      ]);
      expect(cycle.failures.map((failure) => failure.providerId)).toEqual([
        "os",
      ]);
    });

    it("reports a key a failed provider owned as unmapped, not as zero (§83)", async () => {
      const registry = new ProviderRegistry([
        stubProvider(
          "lhm",
          { "cpu.temp.package": 65 },
          { failWith: "no web server" },
        ),
      ]);

      const cycle = await registry.sample(["cpu.temp.package"], NOW);

      expect(cycle.entries).toEqual([]);
      expect(cycle.unmapped).toEqual(["cpu.temp.package"]);
    });

    it("survives a provider rejecting with a non-Error", async () => {
      const registry = new ProviderRegistry([
        {
          id: "rude",
          label: "rude",
          describe: () => Promise.resolve([]),
          sample: () => Promise.reject("just a string"),
          health: () => ({ available: false }),
        },
      ]);

      const cycle = await registry.sample(["cpu.load"], NOW);

      expect(cycle.failures[0]).toMatchObject({
        providerId: "rude",
        message: "just a string",
      });
    });
  });

  describe("ownership precedence", () => {
    it("gives an overlapping key to the earlier provider", async () => {
      // The spec's mapping table: the OS owns cpu.load even when LHM offers it.
      const registry = new ProviderRegistry([
        stubProvider("os", { "cpu.load": 10 }),
        stubProvider("lhm", { "cpu.load": 99 }),
      ]);

      const cycle = await registry.sample(["cpu.load"], NOW);

      expect(cycle.entries).toHaveLength(1);
      expect(cycle.entries[0]?.sample.sensorId).toBe("os:cpu.load");
      expect(cycle.entries[0]?.sample.value).toBe(10);
    });

    it("falls through to a later provider when the earlier one cannot answer", async () => {
      const registry = new ProviderRegistry([
        stubProvider("os", { "cpu.load": 10 }),
        stubProvider("lhm", { "cpu.temp.package": 65 }),
      ]);

      const cycle = await registry.sample(["cpu.temp.package"], NOW);

      expect(cycle.entries[0]?.sample.sensorId).toBe("lhm:cpu.temp.package");
    });

    it("gives an overlapping caption to the earlier provider, as it does a reading", async () => {
      // What precedence alone guarantees: one provider owns both keys. The
      // pair's coherence is not the registry's to decide — it is each provider
      // emitting a caption only for the device it also answered figures for.
      const registry = new ProviderRegistry([
        stubProvider("lhm", {
          "gpu.temp": 60,
          "gpu.name": "AMD Radeon RX 6800",
        }),
        stubProvider("library", {
          "gpu.temp": 55,
          "gpu.name": "GeForce RTX 3080",
        }),
      ]);

      const cycle = await registry.sample(["gpu.temp", "gpu.name"], NOW);
      const ids = cycle.entries.map((entry) => entry.sample.sensorId);

      expect(ids).toEqual(["lhm:gpu.temp", "lhm:gpu.name"]);
    });

    it("splits the pair when the preferred provider answers the figure but not the name", async () => {
      // The cross-provider residual, pinned rather than wished away: LHM read a
      // temperature it could not attribute, and the library's caption claims
      // the key anyway. Both providers are internally consistent, so nothing
      // here is wrong — but the frame pairs one provider's figure with
      // another's name. Closing it needs a host-owned epoch, which is a
      // provider-contract change and deliberately not in this task.
      const registry = new ProviderRegistry([
        stubProvider(
          "lhm",
          { "gpu.temp": 60, "gpu.name": "AMD Radeon RX 6800" },
          { gaps: ["gpu.name"] },
        ),
        stubProvider("library", {
          "gpu.temp": 55,
          "gpu.name": "GeForce RTX 3080",
        }),
      ]);

      const cycle = await registry.sample(["gpu.temp", "gpu.name"], NOW);
      const ids = cycle.entries.map((entry) => entry.sample.sensorId);

      expect(ids).toEqual(["lhm:gpu.temp", "library:gpu.name"]);
      // The declined caption carried the preferred provider's reason, so the
      // display can tell "cannot name it" from "never read".
      expect(
        cycle.entries.find((entry) => entry.semanticKey === "gpu.name")?.sample,
      ).toMatchObject({ textValue: "GeForce RTX 3080" });
    });

    it("does not let a declined caption block a later provider's", async () => {
      const registry = new ProviderRegistry([
        stubProvider("lhm", { "gpu.temp": 60 }, { failWith: "not running" }),
        stubProvider("library", { "gpu.name": "GeForce RTX 3080" }),
      ]);

      const cycle = await registry.sample(["gpu.name"], NOW);

      expect(cycle.entries.map((entry) => entry.sample.sensorId)).toEqual([
        "library:gpu.name",
      ]);
    });

    it("falls through for a caption when the preferred provider cannot read", async () => {
      const registry = new ProviderRegistry([
        stubProvider("lhm", {}, { failWith: "not running" }),
        stubProvider("library", { "gpu.name": "GeForce RTX 3080" }),
      ]);

      const cycle = await registry.sample(["gpu.name"], NOW);

      expect(cycle.entries[0]?.sample.sensorId).toBe("library:gpu.name");
      expect(cycle.failures).toEqual([
        { providerId: "lhm", message: "not running" },
      ]);
    });
  });

  describe("unmapped keys", () => {
    it("reports a key nothing provides rather than inventing one (§97)", async () => {
      const registry = new ProviderRegistry([
        stubProvider("os", { "cpu.load": 10 }),
      ]);

      const cycle = await registry.sample(
        ["cpu.load", "disk.nvme.queue-depth"],
        NOW,
      );

      expect(cycle.unmapped).toEqual(["disk.nvme.queue-depth"]);
      expect(cycle.entries.map((entry) => entry.semanticKey)).toEqual([
        "cpu.load",
      ]);
    });

    it("is empty when everything resolved", async () => {
      const registry = new ProviderRegistry([
        stubProvider("os", { "cpu.load": 10 }),
      ]);

      expect((await registry.sample(["cpu.load"], NOW)).unmapped).toEqual([]);
    });
  });

  describe("describe", () => {
    it("tags every descriptor with the provider that owns it", async () => {
      const registry = new ProviderRegistry([
        stubProvider("os", { "cpu.load": 10 }),
        stubProvider("lhm", { "cpu.temp.package": 65 }),
      ]);

      const described = await registry.describe();

      expect(described).toEqual([
        expect.objectContaining({ semanticKey: "cpu.load", providerId: "os" }),
        expect.objectContaining({
          semanticKey: "cpu.temp.package",
          providerId: "lhm",
        }),
      ]);
    });

    it("forwards the fields a picker needs, without interpreting them", async () => {
      // The editor's catalogue is built from these: a family to group by, the
      // unit's kind, the value's kind, and whether the binding is a picture.
      // The registry only tags; it never derives a field of its own.
      const rich: SensorProvider = {
        id: "lhm",
        label: "lhm",
        describe: () =>
          Promise.resolve([
            {
              sensorId: "lhm:gpu.temp",
              semanticKey: "gpu.temp",
              label: "GPU temperature",
              tier: "extended",
              family: "gpu",
              unitKind: "temperature",
              displayUnits: ["°C", "°F"],
              valueKind: "number",
            },
            {
              sensorId: "lhm:media.image",
              semanticKey: "media.image",
              label: "Picture",
              tier: "extended",
              family: "media",
              mediaKind: "image",
            },
          ]),
        sample: () => Promise.resolve([]),
        health: () => ({ available: true }),
      };

      const described = await new ProviderRegistry([rich]).describe();

      expect(described[0]).toMatchObject({
        providerId: "lhm",
        family: "gpu",
        unitKind: "temperature",
        displayUnits: ["°C", "°F"],
        valueKind: "number",
      });
      expect(described[1]).toMatchObject({
        providerId: "lhm",
        family: "media",
        mediaKind: "image",
      });
    });

    it("still lists healthy providers when one cannot describe itself", async () => {
      const broken: SensorProvider = {
        id: "broken",
        label: "broken",
        describe: () => Promise.reject(new Error("nope")),
        sample: () => Promise.resolve([]),
        health: () => ({ available: false }),
      };
      const registry = new ProviderRegistry([
        broken,
        stubProvider("os", { "cpu.load": 10 }),
      ]);

      const described = await registry.describe();

      expect(described.map((descriptor) => descriptor.providerId)).toEqual([
        "os",
      ]);
    });
  });

  it("passes the host clock through to providers rather than letting each read its own", async () => {
    const spy = vi.fn(() => Promise.resolve([]));
    const registry = new ProviderRegistry([
      {
        id: "os",
        label: "os",
        describe: () => Promise.resolve([]),
        sample: spy,
        health: () => ({ available: true }),
      },
    ]);

    await registry.sample(["cpu.load"], NOW);

    // One clock per cycle keeps every sample in a batch comparable.
    expect(spy).toHaveBeenCalledWith(["cpu.load"], NOW, undefined);
  });

  it("passes the whole context through to every provider", async () => {
    const os = stubProvider("os", { "weather.condition": "Overcast" });

    await new ProviderRegistry([os]).sample(["weather.condition"], NOW, {
      assignment: { gpu: "gpu-0" },
      language: "de",
    });

    expect(os.contexts).toEqual([
      { assignment: { gpu: "gpu-0" }, language: "de" },
    ]);
  });
});
