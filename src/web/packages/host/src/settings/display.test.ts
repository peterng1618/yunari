import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDisplaySettingsStore,
  EMPTY_DISPLAY_SETTINGS,
  normalizeDisplaySettings,
} from "./display.js";

describe("display settings", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "yunari-display-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("keeps a zone this runtime resolves", () => {
    expect(normalizeDisplaySettings({ timeZone: "Asia/Tokyo" })).toEqual({
      timeZone: "Asia/Tokyo",
    });
  });

  it("reads an emptied choice as this PC's own zone", () => {
    // Clearing the field is going back to the default, not choosing "".
    expect(normalizeDisplaySettings({ timeZone: "  " })).toEqual(
      EMPTY_DISPLAY_SETTINGS,
    );
    expect(normalizeDisplaySettings({})).toEqual(EMPTY_DISPLAY_SETTINGS);
    expect(normalizeDisplaySettings(null)).toEqual(EMPTY_DISPLAY_SETTINGS);
  });

  it("refuses a zone it cannot resolve rather than storing a dead setting", () => {
    expect(() =>
      normalizeDisplaySettings({ timeZone: "Mars/Olympus" }),
    ).toThrow(/not a time zone/);
  });

  it("keeps a measurement system this build can display", () => {
    expect(normalizeDisplaySettings({ measurement: "imperial" })).toEqual({
      measurement: "imperial",
    });
    // The page sends both fields together; neither may be lost to the other.
    expect(
      normalizeDisplaySettings({
        timeZone: "Asia/Tokyo",
        measurement: "imperial",
      }),
    ).toEqual({ timeZone: "Asia/Tokyo", measurement: "imperial" });
  });

  it("refuses a measurement system it cannot display", () => {
    expect(() => normalizeDisplaySettings({ measurement: "furlongs" })).toThrow(
      /not a measurement system/,
    );
    // An unchosen field is a form with nothing in it, not a third system.
    expect(normalizeDisplaySettings({ measurement: "" })).toEqual(
      EMPTY_DISPLAY_SETTINGS,
    );
  });

  it("keeps the unit preferences this build can display", () => {
    expect(
      normalizeDisplaySettings({
        units: { clock: "ghz", data: "decimal" },
      }),
    ).toEqual({ units: { clock: "ghz", data: "decimal" } });
  });

  it("refuses a unit preference it cannot display, naming the field", () => {
    expect(() => normalizeDisplaySettings({ units: { clock: "thz" } })).toThrow(
      /clock/,
    );
    expect(() =>
      normalizeDisplaySettings({ units: { nonsense: "whirls" } }),
    ).toThrow(/nonsense/);
  });

  it("reads a stored file without units as no unit preference", async () => {
    await writeFile(
      path.join(dir, "display.json"),
      JSON.stringify({ timeZone: "Europe/Lisbon" }),
      "utf8",
    );
    expect(await createDisplaySettingsStore(dir).read()).toEqual({
      timeZone: "Europe/Lisbon",
    });
  });

  it("ignores a retired fan preference without losing the other units", async () => {
    await writeFile(
      path.join(dir, "display.json"),
      JSON.stringify({
        timeZone: "Europe/Lisbon",
        units: { clock: "ghz", fan: "percent" },
      }),
      "utf8",
    );
    expect(await createDisplaySettingsStore(dir).read()).toEqual({
      timeZone: "Europe/Lisbon",
      units: { clock: "ghz" },
    });
  });

  it("round-trips unit preferences through the store", async () => {
    const store = createDisplaySettingsStore(dir);

    await store.write({ units: { clock: "ghz", pressure: "inhg" } });
    expect(await store.read()).toEqual({
      units: { clock: "ghz", pressure: "inhg" },
    });
  });

  it("round-trips through the store", async () => {
    const store = createDisplaySettingsStore(dir);

    expect(await store.read()).toEqual(EMPTY_DISPLAY_SETTINGS);
    await store.write({ timeZone: "Europe/Lisbon" });
    expect(await store.read()).toEqual({ timeZone: "Europe/Lisbon" });
    // Writing nothing is how a consumer goes back to this PC's own zone.
    await store.write({});
    expect(await store.read()).toEqual(EMPTY_DISPLAY_SETTINGS);
  });

  it("reads an unusable file as this PC's own zone instead of failing a poll", async () => {
    await writeFile(path.join(dir, "display.json"), "{ not json", "utf8");
    expect(await createDisplaySettingsStore(dir).read()).toEqual(
      EMPTY_DISPLAY_SETTINGS,
    );

    // A zone the runtime has since dropped must not break a display either.
    await writeFile(
      path.join(dir, "display.json"),
      JSON.stringify({ timeZone: "Mars/Olympus" }),
      "utf8",
    );
    expect(await createDisplaySettingsStore(dir).read()).toEqual(
      EMPTY_DISPLAY_SETTINGS,
    );
  });
});
