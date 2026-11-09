import { describe, expect, it, vi } from "vitest";
import { createThemeRecents } from "./index.js";

/** The browser's store, without the browser: the module reads and writes
 *  `Storage` and nothing else, so a map is the whole contract. */
class MemoryStorage {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  clear(): void {
    this.data.clear();
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  get length(): number {
    return this.data.size;
  }
}

const KEY = "yunari.editor.recent-themes";

function seeded(entries: unknown): MemoryStorage {
  const storage = new MemoryStorage();
  storage.setItem(KEY, JSON.stringify({ version: 1, entries }));
  return storage;
}

describe("theme recents", () => {
  it("lists opens newest first, and a reopen moves rather than repeats", () => {
    const store = createThemeRecents(new MemoryStorage());
    store.record("a", "Alpha");
    store.record("b", "Beta");
    store.record("a", "Alpha");

    expect(store.getSnapshot()).toEqual([
      { id: "a", name: "Alpha" },
      { id: "b", name: "Beta" },
    ]);
  });

  it("keeps five, dropping the oldest", () => {
    const store = createThemeRecents(new MemoryStorage());
    for (const id of ["a", "b", "c", "d", "e", "f"]) store.record(id, id);

    expect(store.getSnapshot().map((entry) => entry.id)).toEqual([
      "f",
      "e",
      "d",
      "c",
      "b",
    ]);
  });

  it("publishes only a list that moved", () => {
    // The snapshot is the subscription's value, so a `record` that changed
    // nothing must not wake the menu — and an unchanged call cannot leave a
    // new array behind, which would re-render on every open.
    const store = createThemeRecents(new MemoryStorage());
    store.record("a", "Alpha");
    const before = store.getSnapshot();
    const listener = vi.fn();
    store.subscribe(listener);

    store.record("a", "Alpha");

    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(before);
  });

  it("reads a stored list back, dropping a row that no longer parses", () => {
    const storage = seeded([
      { id: "a", name: "Alpha" },
      { id: "", name: "nameless" },
      { name: "missing id" },
      "not an entry",
      { id: "b", name: "Beta" },
    ]);

    expect(createThemeRecents(storage).getSnapshot()).toEqual([
      { id: "a", name: "Alpha" },
      { id: "b", name: "Beta" },
    ]);
  });

  it("starts empty from a store it cannot read, and still records in memory", () => {
    // A refused or full store is a missing menu, not a broken editor: the
    // session keeps its list for as long as it is open.
    const refusing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    } as unknown as Storage;
    const store = createThemeRecents(refusing);

    store.record("a", "Alpha");

    expect(store.getSnapshot()).toEqual([{ id: "a", name: "Alpha" }]);
    expect(createThemeRecents(undefined).getSnapshot()).toEqual([]);
  });
});
