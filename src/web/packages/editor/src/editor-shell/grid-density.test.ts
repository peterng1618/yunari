import { describe, expect, it } from "vitest";
import {
  cardWidthFor,
  columnsForWidth,
  createGridDensityPreference,
  DEFAULT_GRID_DENSITY,
  GRID_COLUMNS_MAX,
  GRID_COLUMNS_MIN,
  GRID_DENSITY_LEVELS,
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

const KEY = "yunari.editor.store-density";

describe("columnsForWidth", () => {
  it("derives the count from the width at the chosen level", () => {
    expect(columnsForWidth(1352, "comfortable"), "1080p").toBe(6);
    expect(columnsForWidth(1352, "compact")).toBe(8);
    expect(columnsForWidth(1352, "roomy")).toBe(4);
    expect(columnsForWidth(1352, "spacious")).toBe(3);
  });

  it("follows a resize instead of freezing a chosen count", () => {
    expect(columnsForWidth(900, "comfortable")).toBe(4);
    expect(columnsForWidth(1900, "comfortable")).toBe(8);
    expect(columnsForWidth(3500, "comfortable")).toBe(GRID_COLUMNS_MAX);
  });

  it("keeps the two closest levels apart on a wide pane", () => {
    // At 2209 the densest two levels both reached the old ceiling of ten, so a
    // step of the ladder did nothing.
    expect(columnsForWidth(2209, "compact")).toBeGreaterThan(
      columnsForWidth(2209, "comfortable"),
    );
  });

  it("clamps to the offered range", () => {
    expect(columnsForWidth(0, "comfortable")).toBe(GRID_COLUMNS_MIN);
    expect(columnsForWidth(40000, "compact")).toBe(GRID_COLUMNS_MAX);
  });
});

describe("cardWidthFor", () => {
  it("answers the width a derived count gives the container", () => {
    expect(cardWidthFor(1000, 4), "four tracks and three gutters").toBe(241);
  });

  it("never divides by zero tracks", () => {
    expect(cardWidthFor(1000, 0)).toBe(1000);
  });
});

describe("createGridDensityPreference", () => {
  it("answers no choice until the viewer makes one", () => {
    expect(createGridDensityPreference(storage()).read()).toBeUndefined();
    expect(DEFAULT_GRID_DENSITY).toBe("comfortable");
  });

  it("round-trips a chosen level and forgets it on clear", () => {
    const store = storage();
    const preference = createGridDensityPreference(store);

    preference.write("roomy");
    expect(store.getItem(KEY)).toBe("roomy");
    expect(preference.read()).toBe("roomy");

    preference.clear();
    expect(preference.read()).toBeUndefined();
  });

  it("refuses a word no level names", () => {
    const store = storage();
    store.setItem(KEY, "gigantic");
    expect(createGridDensityPreference(store).read()).toBeUndefined();
  });

  it("is no storage when the storage refuses", () => {
    const preference = createGridDensityPreference(storage({ refuse: true }));
    expect(preference.read()).toBeUndefined();
    expect(() => {
      preference.write(GRID_DENSITY_LEVELS[0]);
      preference.clear();
    }).not.toThrow();
  });
});
