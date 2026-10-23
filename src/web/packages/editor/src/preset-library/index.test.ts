import { describe, expect, it } from "vitest";
import { createPresetLibrary } from "./index.js";

class MemoryStorage implements Storage {
  readonly #items = new Map<string, string>();

  get length(): number {
    return this.#items.size;
  }

  clear(): void {
    this.#items.clear();
  }

  getItem(key: string): string | null {
    return this.#items.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#items.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#items.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#items.set(key, value);
  }
}

class RefusingStorage extends MemoryStorage {
  override setItem(): void {
    throw new Error("storage denied");
  }
}

const KEY = "yunari.editor.presets";

describe("first run", () => {
  it("seeds 12 colours and 15 gradients, none of them persisted yet", () => {
    const storage = new MemoryStorage();
    const store = createPresetLibrary(storage);
    const library = store.getSnapshot();

    expect(library.colours).toHaveLength(12);
    expect(library.gradients).toHaveLength(15);
    for (const gradient of library.gradients) {
      expect(gradient.stops).toHaveLength(2);
      expect(gradient.stops[0]?.offset).toBe(0);
      expect(gradient.stops[1]?.offset).toBe(1);
    }
    // Presence of the key is what stops re-seeding, so reading must not create it.
    expect(storage.getItem(KEY)).toBeNull();
  });

  it("carries the cssgradient.io names and values, normalised to hex", () => {
    const store = createPresetLibrary(new MemoryStorage());
    const vital = store
      .getSnapshot()
      .gradients.find((gradient) => gradient.name === "Vital Ocean");

    expect(vital?.angle).toBe(0);
    expect(vital?.stops.map((stop) => stop.color)).toEqual([
      "#1cb5e0",
      "#000851",
    ]);
  });

  it("normalises a colour seed to the stored hex form", () => {
    const store = createPresetLibrary(new MemoryStorage());
    expect(store.getSnapshot().colours[0]?.value).toBe("#0f172a");
  });
});

describe("addColours", () => {
  it("normalises, skips invalid and duplicate values, and reports the count", () => {
    const storage = new MemoryStorage();
    const store = createPresetLibrary(storage);

    const result = store.addColours([
      { name: "Panel", value: "rgb(16 32 48)" },
      { name: "Same again", value: "#102030" },
      { name: "Slate seed", value: "#0f172a" },
      { name: "Not a colour", value: "nope" },
    ]);

    expect(result.added).toBe(1);
    expect(result.library.colours).toHaveLength(13);
    expect(result.library.colours.at(-1)).toMatchObject({
      name: "Panel",
      value: "#102030",
    });
    expect(storage.getItem(KEY)).not.toBeNull();
  });

  it("keeps an in-memory change when storage refuses the write", () => {
    const store = createPresetLibrary(new RefusingStorage());
    const result = store.addColours([{ name: "Panel", value: "#102030" }]);

    expect(result.added).toBe(1);
    expect(store.getSnapshot().colours.at(-1)?.value).toBe("#102030");
  });

  it("does not publish when nothing was added", () => {
    const store = createPresetLibrary(new MemoryStorage());
    const before = store.getSnapshot();

    expect(store.addColours([{ name: "Bad", value: "nope" }]).added).toBe(0);
    expect(store.getSnapshot()).toBe(before);
  });
});

describe("addGradient", () => {
  const valid = {
    name: "Test",
    angle: 45,
    stops: [
      { offset: 0, color: "rgb(255 0 0)" },
      { offset: 1, color: "#0000ff" },
    ],
  };

  it("accepts a valid gradient and normalises its stops", () => {
    const store = createPresetLibrary(new MemoryStorage());
    const result = store.addGradient(valid);

    expect(result.added).toBe(true);
    expect(result.library.gradients).toHaveLength(16);
    expect(result.library.gradients.at(-1)).toMatchObject({
      name: "Test",
      angle: 45,
      stops: [
        { offset: 0, color: "#ff0000" },
        { offset: 1, color: "#0000ff" },
      ],
    });
  });

  it("refuses a degenerate or malformed gradient", () => {
    const store = createPresetLibrary(new MemoryStorage());

    expect(
      store.addGradient({ ...valid, stops: [{ offset: 0, color: "#ff0000" }] })
        .added,
    ).toBe(false);
    expect(store.addGradient({ ...valid, angle: Number.NaN }).added).toBe(
      false,
    );
    expect(
      store.addGradient({
        ...valid,
        stops: [
          { offset: 0, color: "#ff0000" },
          { offset: 1.5, color: "#0000ff" },
        ],
      }).added,
    ).toBe(false);
    expect(
      store.addGradient({
        ...valid,
        stops: [
          { offset: 0, color: "nope" },
          { offset: 1, color: "#0000ff" },
        ],
      }).added,
    ).toBe(false);
    expect(store.getSnapshot().gradients).toHaveLength(15);
  });

  it("skips an exact duplicate of angle and stops", () => {
    const store = createPresetLibrary(new MemoryStorage());
    expect(store.addGradient(valid).added).toBe(true);
    expect(store.addGradient(valid).added).toBe(false);
    expect(store.getSnapshot().gradients).toHaveLength(16);
  });
});

describe("deletePreset", () => {
  it("removes by id, persists, and survives a reload", () => {
    const storage = new MemoryStorage();
    const store = createPresetLibrary(storage);
    const target = store.getSnapshot().colours[0]!;

    store.deletePreset("colour", target.id);

    expect(store.getSnapshot().colours).toHaveLength(11);
    expect(createPresetLibrary(storage).getSnapshot().colours).toHaveLength(11);
  });

  it("does not resurrect the seeds once every preset is deleted", () => {
    const storage = new MemoryStorage();
    const store = createPresetLibrary(storage);

    for (const preset of store.getSnapshot().colours) {
      store.deletePreset("colour", preset.id);
    }
    for (const preset of store.getSnapshot().gradients) {
      store.deletePreset("gradient", preset.id);
    }

    expect(JSON.parse(storage.getItem(KEY) ?? "null")).toMatchObject({
      version: 1,
      colours: [],
      gradients: [],
    });
    const reopened = createPresetLibrary(storage);
    expect(reopened.getSnapshot().colours).toHaveLength(0);
    expect(reopened.getSnapshot().gradients).toHaveLength(0);
  });
});

describe("reading a damaged payload", () => {
  it("falls back to the seeds for corrupt JSON and a wrong version", () => {
    const corrupt = new MemoryStorage();
    corrupt.setItem(KEY, "{oops");
    expect(createPresetLibrary(corrupt).getSnapshot().colours).toHaveLength(12);

    const stale = new MemoryStorage();
    stale.setItem(
      KEY,
      JSON.stringify({ version: 2, colours: [], gradients: [] }),
    );
    expect(createPresetLibrary(stale).getSnapshot().gradients).toHaveLength(15);
  });

  it("drops a malformed entry without replacing it or seeding over the list", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        colours: [
          { id: "kept", name: "Kept", value: "rgb(16 32 48)" },
          { id: "bad-value", name: "Bad", value: "nope" },
          { id: "bad-shape", value: "#102030" },
        ],
        gradients: [],
      }),
    );

    const library = createPresetLibrary(storage).getSnapshot();
    expect(library.colours).toEqual([
      { id: "kept", name: "Kept", value: "#102030" },
    ]);
    // The key exists, so the empty gradient list is the author's, not an absence.
    expect(library.gradients).toHaveLength(0);
  });
});

describe("subscription", () => {
  it("notifies on add and delete, and keeps the snapshot stable between changes", () => {
    const store = createPresetLibrary(new MemoryStorage());
    const before = store.getSnapshot();
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls++;
    });

    expect(store.getSnapshot()).toBe(before);
    store.addColours([{ name: "Panel", value: "#102030" }]);
    expect(store.getSnapshot()).not.toBe(before);
    store.deletePreset("colour", store.getSnapshot().colours[0]!.id);
    expect(calls).toBe(2);

    unsubscribe();
    store.addColours([{ name: "Other", value: "#102031" }]);
    expect(calls).toBe(2);
  });
});
