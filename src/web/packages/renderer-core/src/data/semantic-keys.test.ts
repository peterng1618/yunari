import { describe, expect, it } from "vitest";

import {
  BUILT_IN_FAMILIES,
  describeDynamicKey,
  describeSemanticKey,
  groupDescriptorsByFamily,
  isKnownSemanticKey,
  labelForSemanticKey,
  SEMANTIC_KEYS,
  semanticId,
  semanticKeysByFamily,
} from "./semantic-keys.js";

describe("the semantic key vocabulary", () => {
  it("declares every key exactly once", () => {
    const keys = SEMANTIC_KEYS.map((descriptor) => descriptor.key);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("spells system memory `ram`, not `memory`", () => {
    // The decision this module exists to own: `ram` and `vram` are separate
    // families, so neither needs a qualifier to be unambiguous.
    expect(isKnownSemanticKey("ram.used")).toBe(true);
    expect(isKnownSemanticKey("memory.used")).toBe(false);
    expect(isKnownSemanticKey("vram.used")).toBe(true);
  });

  it("keeps ram and vram in different families", () => {
    expect(describeSemanticKey("ram.used")?.family).toBe("ram");
    expect(describeSemanticKey("vram.used")?.family).toBe("vram");
  });

  it("treats a percentage as a qualifier on the quantity", () => {
    expect(describeSemanticKey("ram.used")?.unit).toBe("GB");
    expect(describeSemanticKey("ram.used.percent")?.unit).toBe("%");
  });

  it("marks the four keys the OS provider actually reads as baseline", () => {
    for (const key of [
      "cpu.load",
      "ram.used",
      "ram.used.percent",
      "ram.total",
    ]) {
      expect(describeSemanticKey(key)?.expectedTier).toBe("baseline");
    }
  });

  it("marks driver-dependent keys extended", () => {
    for (const key of ["cpu.temp", "gpu.load", "vram.used"]) {
      expect(describeSemanticKey(key)?.expectedTier).toBe("extended");
    }
  });

  it("declares no indexed multi-device form, which is still undecided", () => {
    // The reference sketches `gpu.0.load`. Guessing at it here would let a real
    // provider contradict the vocabulary later.
    expect(SEMANTIC_KEYS.filter((d) => /\.\d+\./.test(d.key))).toEqual([]);
  });

  it("declares the device identity keys as text, not as measurements", () => {
    // A caption is a name, not a quantity: no unit, and no `instant` (which
    // would make `plan.ts` reformat the provider's string as a date).
    for (const key of [
      "cpu.brand",
      "cpu.model",
      "cpu.manufacturer",
      "gpu.name",
      "disk.name",
    ]) {
      const declared = describeSemanticKey(key);

      expect(declared, key).toBeDefined();
      expect(declared?.unit, key).toBeUndefined();
      expect(declared?.instant, key).toBeUndefined();
      expect(isKnownSemanticKey(key), key).toBe(true);
    }
  });

  it("keeps the three CPU identity fields as separate keys", () => {
    // The library reports a manufacturer, a brand and a model that all differ
    // (`Intel` / `Core™ i9-10850K` / `165` on the dev machine), and which one
    // reads best is the theme author's choice.
    for (const key of ["cpu.brand", "cpu.model", "cpu.manufacturer"]) {
      expect(describeSemanticKey(key)?.family, key).toBe("cpu");
      expect(describeSemanticKey(key)?.label, key).toBeTruthy();
    }
  });

  it("puts a device caption in its own device's family", () => {
    // The family is what makes the settings page ask which device a theme
    // means, so a caption must ask exactly as the readings beside it do.
    expect(describeSemanticKey("gpu.name")?.family).toBe("gpu");
    expect(describeSemanticKey("disk.name")?.family).toBe("disk");
  });
});

describe("describeSemanticKey", () => {
  it("treats an unknown key as unknown rather than an error", () => {
    expect(describeSemanticKey("disk.nvme.queue-depth")).toBeUndefined();
    expect(isKnownSemanticKey("disk.nvme.queue-depth")).toBe(false);
  });
});

describe("labelForSemanticKey", () => {
  it("labels a known key", () => {
    expect(labelForSemanticKey("cpu.load")).toBe("CPU load");
  });

  it('falls back to the raw key, which is more informative than "unknown"', () => {
    expect(labelForSemanticKey("disk.nvme.queue-depth")).toBe(
      "disk.nvme.queue-depth",
    );
  });
});

describe("semanticKeysByFamily", () => {
  it("groups without losing or duplicating a key", () => {
    const grouped = semanticKeysByFamily();
    const total = [...grouped.values()].reduce(
      (sum, list) => sum + list.length,
      0,
    );

    expect(total).toBe(SEMANTIC_KEYS.length);
  });

  it("keeps declaration order inside a family", () => {
    expect(grouping("ram")).toEqual([
      "ram.used",
      "ram.used.percent",
      "ram.total",
    ]);
  });

  function grouping(family: "ram"): readonly string[] {
    return (semanticKeysByFamily().get(family) ?? []).map(
      (descriptor) => descriptor.key,
    );
  }
});

describe("the open family set", () => {
  it("exports the built-in families in declaration order, new ones after date", () => {
    expect(BUILT_IN_FAMILIES).toEqual([
      "cpu",
      "ram",
      "gpu",
      "vram",
      "disk",
      "network",
      "time",
      "date",
      "cooling",
      "motherboard",
      "battery",
      "psu",
      "system",
      "audio",
      "wifi",
      "weather",
      "media",
      "frame",
      "game",
      "custom",
    ]);
  });
});

describe("the added descriptor fields", () => {
  it("gives a package temperature the conversion contract", () => {
    const declared = describeSemanticKey("cpu.temp.package");

    expect(declared?.family).toBe("cpu");
    expect(declared?.unit).toBe("°C");
    expect(declared?.unitKind).toBe("temperature");
    expect(declared?.converts).toBe("temperature");
  });

  it("offers every unit a binding may pin for data and rate keys", () => {
    const data = describeSemanticKey("ram.total");
    expect(data?.unit).toBe("GB");
    for (const unit of ["MB", "GB", "TB", "MiB", "GiB", "TiB"]) {
      expect(data?.displayUnits, unit).toContain(unit);
    }

    const rate = describeSemanticKey("network.download");
    expect(rate?.unit).toBe("Mb/s");
    for (const unit of ["kb/s", "Mb/s", "Gb/s", "kB/s", "MB/s", "GB/s"]) {
      expect(rate?.displayUnits, unit).toContain(unit);
    }
  });

  it("keeps the existing 31 keys' unit, converts and instant values", () => {
    const contracts: readonly (readonly [
      string,
      string | undefined,
      "temperature" | undefined,
      { readonly defaultFormat: string } | undefined,
    ])[] = [
      ["cpu.load", "%", undefined, undefined],
      ["cpu.temp", "°C", "temperature", undefined],
      ["cpu.power", "W", undefined, undefined],
      ["cpu.clock", "MHz", undefined, undefined],
      ["cpu.fan", "RPM", undefined, undefined],
      ["cpu.manufacturer", undefined, undefined, undefined],
      ["cpu.brand", undefined, undefined, undefined],
      ["cpu.model", undefined, undefined, undefined],
      ["ram.used", "GB", undefined, undefined],
      ["ram.used.percent", "%", undefined, undefined],
      ["ram.total", "GB", undefined, undefined],
      ["gpu.load", "%", undefined, undefined],
      ["gpu.temp", "°C", "temperature", undefined],
      ["gpu.power", "W", undefined, undefined],
      ["gpu.clock", "MHz", undefined, undefined],
      ["gpu.fan", "RPM", undefined, undefined],
      ["gpu.name", undefined, undefined, undefined],
      ["vram.used", "GB", undefined, undefined],
      ["vram.used.percent", "%", undefined, undefined],
      ["vram.total", "GB", undefined, undefined],
      ["time.now", undefined, undefined, { defaultFormat: "HH:mm" }],
      ["date.today", undefined, undefined, { defaultFormat: "DD MMM YYYY" }],
      ["disk.used", "GB", undefined, undefined],
      ["disk.data.used", "GB", undefined, undefined],
      ["disk.data.used.percent", "%", undefined, undefined],
      ["disk.data.total", "GB", undefined, undefined],
      ["disk.used.percent", "%", undefined, undefined],
      ["disk.total", "GB", undefined, undefined],
      ["disk.name", undefined, undefined, undefined],
      ["network.download", "Mb/s", undefined, undefined],
      ["network.upload", "Mb/s", undefined, undefined],
    ];

    expect(contracts).toHaveLength(31);

    for (const [key, unit, converts, instant] of contracts) {
      const declared = describeSemanticKey(key);

      expect(declared, key).toBeDefined();
      expect(declared?.unit, key).toBe(unit);
      expect(declared?.converts, key).toBe(converts);
      expect(declared?.instant, key).toEqual(instant);
    }
  });
});

describe("describeDynamicKey", () => {
  it("describes a per-core reading with the key unchanged", () => {
    const declared = describeDynamicKey("cpu.core.3.temp");

    expect(declared?.key).toBe("cpu.core.3.temp");
    expect(declared?.family).toBe("cpu");
    expect(declared?.label).toContain("3");
    expect(declared?.unit).toBe("°C");
  });

  it("describes a custom source's field as a number", () => {
    const declared = describeDynamicKey("custom.my-source.cpu_load");

    expect(declared?.family).toBe("custom");
    expect(declared?.valueKind).toBe("number");
  });

  it("accepts the store's id alphabet in a custom key", () => {
    expect(describeDynamicKey("custom._local-source._my_field")?.family).toBe(
      "custom",
    );
    expect(describeDynamicKey("custom.my_source.Field2")?.family).toBe(
      "custom",
    );
  });

  it("rejects a custom key whose source segment is too long", () => {
    const id = "a".repeat(33);
    expect(describeDynamicKey(`custom.${id}.value`)).toBeUndefined();
  });

  it("describes the static image and text media keys", () => {
    expect(describeDynamicKey("weather.icon")?.mediaKind).toBe("image");
    expect(describeDynamicKey("media.title")?.valueKind).toBe("text");
  });

  it("describes a per-device disk quantity", () => {
    const declared = describeDynamicKey("disk.nvme0.free");

    expect(declared?.family).toBe("disk");
    expect(declared?.unit).toBe("GB");
    expect(declared?.label).toContain("free");
  });

  it("rejects a per-core number that is not 1-based", () => {
    expect(describeDynamicKey("cpu.core.0.load")).toBeUndefined();
  });
});

describe("semanticId", () => {
  it("slugs a name into the key shape", () => {
    expect(semanticId("Fan #3 / Pump")).toBe("fan-3-pump");
    expect(semanticId("Fan #3 / Pump")).toBe(semanticId("Fan #3 / Pump"));
  });

  it("truncates to 64 characters", () => {
    expect(semanticId("a".repeat(100))).toBe("a".repeat(64));
  });
});

describe("groupDescriptorsByFamily", () => {
  it("keeps descriptor order and accepts a family this build does not declare", () => {
    const custom = {
      key: "vendor.thing",
      family: "vendor",
      label: "Vendor thing",
      expectedTier: "extended",
    } as const;
    const grouped = groupDescriptorsByFamily([
      describeSemanticKey("cpu.temp")!,
      custom,
      describeSemanticKey("cpu.load")!,
    ]);

    expect(grouped.get("cpu")?.map((descriptor) => descriptor.key)).toEqual([
      "cpu.temp",
      "cpu.load",
    ]);
    expect(grouped.get("vendor")?.[0]).toBe(custom);
  });
});
