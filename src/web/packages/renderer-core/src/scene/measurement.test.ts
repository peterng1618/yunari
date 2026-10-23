import { describe, expect, it } from "vitest";
import {
  convertForDisplay,
  DEFAULT_UNIT_PREFERENCES,
  normalizeUnitPreferences,
} from "./measurement.js";

describe("measurement preference", () => {
  it("shows what the provider measured under metric", () => {
    // The measurement is untouched; a preference never rewrites it.
    expect(
      convertForDisplay("cpu.temp", 63, "°C", { measurement: "metric" }),
    ).toEqual({ value: 63, unit: "°C" });
  });

  it("converts temperature to Fahrenheit when asked", () => {
    expect(
      convertForDisplay("cpu.temp", 100, "°C", { measurement: "imperial" }),
    ).toEqual({ value: 212, unit: "°F" });
    expect(
      convertForDisplay("gpu.temp", 0, "°C", { measurement: "imperial" }),
    ).toEqual({ value: 32, unit: "°F" });
  });

  it("leaves a family the vocabulary does not convert alone", () => {
    // A unit preference must not pretend to cover what it cannot convert.
    expect(
      convertForDisplay("ram.used", 10.5, "GB", { measurement: "imperial" }),
    ).toEqual({ value: 10.5, unit: "GB" });
    expect(
      convertForDisplay("disk.used", 300, "GB", { measurement: "imperial" }),
    ).toEqual({ value: 300, unit: "GB" });
    expect(
      convertForDisplay("network.download", 1.2, "Mb/s", {
        measurement: "imperial",
      }),
    ).toEqual({ value: 1.2, unit: "Mb/s" });
  });

  it("does not convert a value whose unit is not the one it expects", () => {
    // A provider reporting a non-Celsius temperature is left as measured.
    expect(
      convertForDisplay("cpu.temp", 300, "K", { measurement: "imperial" }),
    ).toEqual({ value: 300, unit: "K" });
  });

  it("leaves an unknown key alone", () => {
    expect(
      convertForDisplay("nonexistent.sensor", 5, "x", {
        measurement: "imperial",
      }),
    ).toEqual({ value: 5, unit: "x" });
  });
});

describe("clock units", () => {
  it("pins GHz or MHz when asked", () => {
    expect(
      convertForDisplay("cpu.clock", 3800, "MHz", { clock: "ghz" }),
    ).toEqual({ value: 3.8, unit: "GHz", precision: 2 });
    expect(
      convertForDisplay("cpu.clock", 3800, "MHz", { clock: "mhz" }),
    ).toEqual({ value: 3800, unit: "MHz" });
  });

  it("auto-scales at 1000 MHz without rounding the converted value", () => {
    expect(
      convertForDisplay("cpu.clock", 800, "MHz", { clock: "auto" }),
    ).toEqual({ value: 800, unit: "MHz" });
    expect(
      convertForDisplay("cpu.clock", 3800, "MHz", { clock: "auto" }),
    ).toEqual({ value: 3.8, unit: "GHz", precision: 2 });
    expect(
      convertForDisplay("cpu.clock", 12000, "MHz", { clock: "auto" }),
    ).toEqual({ value: 12, unit: "GHz", precision: 1 });

    // The value keeps every decimal an authored precision may ask for.
    expect(
      convertForDisplay("cpu.clock", 12345, "MHz", { clock: "auto" }),
    ).toEqual({ value: 12.345, unit: "GHz", precision: 1 });
  });

  it("offers two decimals below 10 GHz and one above", () => {
    expect(
      convertForDisplay("cpu.clock", 3845, "MHz", { clock: "ghz" }),
    ).toEqual({ value: 3.845, unit: "GHz", precision: 2 });
    expect(
      convertForDisplay("cpu.clock", 10000, "MHz", { clock: "ghz" }),
    ).toEqual({ value: 10, unit: "GHz", precision: 1 });
  });
});

describe("data units", () => {
  it("converts the stored 2^30 value when decimal is asked", () => {
    // 16 × 2^30 bytes is 17.18 billion bytes, not a relabelled 16 GB.
    const converted = convertForDisplay("ram.used", 16, "GB", {
      data: "decimal",
    });

    expect(converted.unit).toBe("GB");
    expect(converted.value).toBeCloseTo(17.18, 2);
  });

  it("pins a magnitude with the binary ratio", () => {
    expect(convertForDisplay("ram.used", 2, "GB", { dataScale: "mb" })).toEqual(
      {
        value: 2048,
        unit: "MB",
      },
    );
    expect(
      convertForDisplay("ram.used", 2048, "GB", { dataScale: "tb" }),
    ).toEqual({ value: 2, unit: "TB" });
  });

  it("auto-scales a capacity by its magnitude", () => {
    expect(
      convertForDisplay("ram.used", 0.5, "GB", { dataScale: "auto" }),
    ).toEqual({ value: 512, unit: "MB" });
    expect(
      convertForDisplay("ram.used", 2048, "GB", { dataScale: "auto" }),
    ).toEqual({ value: 2, unit: "TB" });
  });

  it("converts a discovered disk capacity, whose descriptor is built at runtime", () => {
    expect(
      convertForDisplay("disk.nvme0.used", 2048, "GB", { dataScale: "tb" }),
    ).toEqual({ value: 2, unit: "TB" });
  });
});

describe("rate units", () => {
  it("converts bits to bytes by dividing by eight", () => {
    expect(
      convertForDisplay("network.download", 500, "Mb/s", { rate: "bytes" }),
    ).toEqual({ value: 62.5, unit: "MB/s" });
  });

  it("auto-scales a byte rate across kB/s, MB/s and GB/s", () => {
    const preferences = { rate: "bytes", rateScale: "auto" } as const;

    expect(
      convertForDisplay("network.download", 4, "Mb/s", preferences),
    ).toEqual({ value: 500, unit: "kB/s" });
    expect(
      convertForDisplay("network.download", 500, "Mb/s", preferences),
    ).toEqual({ value: 62.5, unit: "MB/s" });
    expect(
      convertForDisplay("network.download", 10_000, "Mb/s", preferences),
    ).toEqual({ value: 1.25, unit: "GB/s" });
  });

  it("auto-scales a bit rate across kb/s, Mb/s and Gb/s", () => {
    const preferences = { rate: "bits", rateScale: "auto" } as const;

    expect(
      convertForDisplay("network.download", 0.5, "Mb/s", preferences),
    ).toEqual({ value: 500, unit: "kb/s" });
    expect(
      convertForDisplay("network.download", 500, "Mb/s", preferences),
    ).toEqual({ value: 500, unit: "Mb/s" });
    expect(
      convertForDisplay("network.download", 2500, "Mb/s", preferences),
    ).toEqual({ value: 2.5, unit: "Gb/s" });
  });

  it("keeps byte-native disk throughput in bytes under the default preference", () => {
    // A disk reads in MB/s; the bit/byte preference governs link rates only.
    expect(convertForDisplay("disk.nvme0.read", 500, "MB/s", {})).toEqual({
      value: 500,
      unit: "MB/s",
    });
    expect(
      convertForDisplay("disk.nvme0.read", 500, "MB/s", {
        rate: "bits",
      }),
    ).toEqual({ value: 500, unit: "MB/s" });
  });

  it("still auto-scales byte-native throughput with byte prefixes", () => {
    expect(
      convertForDisplay("disk.nvme0.read", 500, "MB/s", {
        rateScale: "auto",
      }),
    ).toEqual({ value: 500, unit: "MB/s" });
    expect(
      convertForDisplay("disk.nvme0.read", 1500, "MB/s", {
        rateScale: "auto",
      }),
    ).toEqual({ value: 1.5, unit: "GB/s" });
    expect(
      convertForDisplay("disk.nvme0.read", 0.5, "MB/s", {
        rateScale: "auto",
      }),
    ).toEqual({ value: 500, unit: "kB/s" });
    expect(
      convertForDisplay("disk.nvme0.read", 500, "MB/s", { rateScale: "g" }),
    ).toEqual({ value: 0.5, unit: "GB/s" });
  });
});

describe("fan units", () => {
  it("never converts an RPM reading to a guessed percentage", () => {
    expect(
      convertForDisplay("cooling.fan.1.rpm", 1200, "RPM", { fan: "percent" }),
    ).toEqual({ value: 1200, unit: "RPM" });
  });

  it("leaves a control reading in percent", () => {
    expect(
      convertForDisplay("cooling.fan.1.percent", 60, "%", { fan: "percent" }),
    ).toEqual({ value: 60, unit: "%" });
  });
});

describe("weather units", () => {
  it("converts pressure to inches of mercury", () => {
    const converted = convertForDisplay("weather.pressure", 1013.25, "hPa", {
      pressure: "inhg",
    });

    expect(converted.unit).toBe("inHg");
    expect(converted.value).toBeCloseTo(29.92, 2);
  });

  it("converts wind speed to miles per hour or metres per second", () => {
    const mph = convertForDisplay("weather.windSpeed", 100, "km/h", {
      windSpeed: "mph",
    });
    expect(mph.unit).toBe("mph");
    expect(mph.value).toBeCloseTo(62.14, 2);

    expect(
      convertForDisplay("weather.windSpeed", 36, "km/h", { windSpeed: "ms" }),
    ).toEqual({ value: 10, unit: "m/s" });
  });
});

describe("binding overrides", () => {
  it("reports an override the key cannot display and keeps the measured value", () => {
    expect(
      convertForDisplay("cpu.load", 42, "%", DEFAULT_UNIT_PREFERENCES, {
        unit: "GHz",
      }),
    ).toEqual({ value: 42, unit: "%", unsupportedUnit: true });
  });

  it("lets a supported override win over the display preference", () => {
    expect(
      convertForDisplay(
        "cpu.clock",
        3800,
        "MHz",
        { clock: "mhz" },
        {
          unit: "GHz",
        },
      ),
    ).toEqual({ value: 3.8, unit: "GHz", precision: 2 });
  });

  it("lets an author ask for auto-scaling on a key with several units", () => {
    expect(
      convertForDisplay(
        "ram.used",
        2048,
        "GB",
        { dataScale: "gb" },
        {
          autoScale: true,
        },
      ),
    ).toEqual({ value: 2, unit: "TB" });
  });
});

describe("normalizeUnitPreferences", () => {
  it("keeps the values this build can display", () => {
    expect(
      normalizeUnitPreferences({
        clock: "ghz",
        data: "decimal",
        rateScale: "auto",
      }),
    ).toEqual({ clock: "ghz", data: "decimal", rateScale: "auto" });
  });

  it("reads absent or unusable input as no preferences", () => {
    expect(normalizeUnitPreferences(undefined)).toEqual({});
    expect(normalizeUnitPreferences({ clock: "" })).toEqual({});
  });

  it("refuses a value it cannot display rather than storing a no-op", () => {
    expect(() => normalizeUnitPreferences({ clock: "thz" })).toThrow(/clock/);
    expect(() => normalizeUnitPreferences({ fan: 50 })).toThrow(/fan/);
  });
});
