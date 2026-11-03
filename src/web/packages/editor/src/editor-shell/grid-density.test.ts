import { describe, expect, it } from "vitest";
import {
  autoColumnsForWidth,
  createGridDensityPreference,
  GRID_COLUMNS_MAX,
  GRID_COLUMNS_MIN,
} from "./grid-density.js";

/** A `Storage` over a Map, with the two faults a real one can show. */
function storage(options: { readonly refuse?: boolean } = {}): Storage {
  const values = new Map<string, string>();
  const refuse = (): never => {
    throw new Error("storage refused");
  };
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) =>
      options.refuse === true ? refuse() : (values.get(key) ?? null),
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      if (options.refuse === true) refuse();
      values.delete(key);
    },
    setItem: (key, value) => {
      if (options.refuse === true) refuse();
      values.set(key, value);
    },
  };
}

const KEY = "yunari.editor.store-grid-columns";

describe("autoColumnsForWidth", () => {
  it("answers the width in 272px columns, clamped to the offered range", () => {
    // The store region's width at the small and large ends: a narrow pane holds
    // the minimum, and 4K holds the maximum rather than a wall of slivers.
    expect(autoColumnsForWidth(0)).toBe(GRID_COLUMNS_MIN);
    expect(autoColumnsForWidth(700)).toBe(GRID_COLUMNS_MIN);
    expect(autoColumnsForWidth(1352), "1080p's content width").toBe(4);
    expect(autoColumnsForWidth(2400), "1440p ultrawide").toBe(8);
    expect(autoColumnsForWidth(3500), "4K").toBe(GRID_COLUMNS_MAX);
  });
});

describe("createGridDensityPreference", () => {
  it("answers no choice until the viewer makes one", () => {
    expect(createGridDensityPreference(storage()).read()).toBeUndefined();
  });

  it("round-trips a chosen density and forgets it on clear", () => {
    const store = storage();
    const preference = createGridDensityPreference(store);

    preference.write(6);
    expect(store.getItem(KEY)).toBe("6");
    expect(preference.read()).toBe(6);

    preference.clear();
    expect(preference.read()).toBeUndefined();
  });

  it("refuses a stored value outside the range rather than clamping it", () => {
    const store = storage();
    store.setItem(KEY, "99");
    expect(createGridDensityPreference(store).read()).toBeUndefined();
    store.setItem(KEY, "1");
    expect(createGridDensityPreference(store).read()).toBeUndefined();
    store.setItem(KEY, "six");
    expect(createGridDensityPreference(store).read()).toBeUndefined();
  });

  it("reads and writes nothing where storage itself refuses", () => {
    const preference = createGridDensityPreference(storage({ refuse: true }));
    expect(preference.read()).toBeUndefined();
    expect(() => preference.write(4)).not.toThrow();
    expect(() => preference.clear()).not.toThrow();
  });

  it("answers no choice where the browser has no storage at all", () => {
    expect(createGridDensityPreference(undefined).read()).toBeUndefined();
  });
});
