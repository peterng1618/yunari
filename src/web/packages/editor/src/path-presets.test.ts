import { Path } from "fabric/es";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNewShape,
  newObjectPlacement,
  newShapeName,
} from "./new-object-defaults.js";
import { insertGroups } from "./new-object-panel.js";
import {
  activeRemovedPathPresetIds,
  activeUserPathPresets,
  REMOVED_PATH_PRESETS_STORAGE_KEY,
  readRemovedPathPresetIds,
  readUserPathPresets,
  removedPathPresetIdsKey,
  setActiveRemovedPathPresetIds,
  setActiveUserPathPresets,
  subscribeRemovedPathPresetIds,
  subscribeUserPathPresets,
  USER_PATH_PRESETS_STORAGE_KEY,
  type UserPathPreset,
  userPathPreset,
  userPathPresetFrom,
  userPathPresetsKey,
  writeRemovedPathPresetIds,
  writeUserPathPresets,
} from "./path-presets.js";

/** A store that keeps its entries in memory, so a case can read the JSON a
 *  write produced rather than trusting the writer's own boolean. */
function memoryStorage(entries: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

const globals = {
  palette: {
    ink: { name: "Ink", value: { kind: "solid" as const, color: "#102030" } },
  },
  typeTokens: { body: { family: "Inter" } },
};

const placement = newObjectPlacement(0, { width: 1920, height: 1080 });

function preset(label: string, data: string): UserPathPreset {
  const candidate = userPathPresetFrom(label, data);
  if ("reason" in candidate) throw new Error(`refused: ${candidate.reason}`);
  return candidate;
}

afterEach(() => {
  setActiveUserPathPresets([]);
  setActiveRemovedPathPresetIds([]);
});

describe("a preset made from the settings form", () => {
  it("keeps the author's name and data, under a user: id", () => {
    const preset = userPathPresetFrom("  Star  ", " M 0 0 L 10 0 L 10 10 Z ");

    expect(preset).toMatchObject({
      label: "Star",
      data: "M 0 0 L 10 0 L 10 10 Z",
      paint: "fill",
    });
    expect("reason" in preset).toBe(false);
    if (!("reason" in preset)) expect(preset.id).toMatch(/^user:/);
  });

  it("strokes an open path and fills a closed one, from the data alone", () => {
    expect(preset("Line", "M 0 0 L 100 0").paint).toBe("stroke");
    expect(preset("Square", "M 0 0 L 10 0 L 10 10 L 0 10 Z").paint).toBe(
      "fill",
    );
  });

  it("accepts a one-dimensional drawing, which is still a visible line", () => {
    // A horizontal line has no height. Refusing it as "empty" would make the
    // one preset the built-in catalogue already ships impossible to add.
    expect(preset("Rule", "M 0 0 L 100 0")).toMatchObject({
      paint: "stroke",
    });
  });

  it.each([
    ["", "M 0 0 L 10 0", "name"],
    ["   ", "M 0 0 L 10 0", "name"],
    ["Line", "", "data"],
    ["Line", "   ", "data"],
    ["Line", "not a path", "empty"],
    ["Line", "M 0 0", "empty"],
    ["Line", "M 0 0 C 1", "empty"],
  ])("refuses %o / %o with %s", (label, data, reason) => {
    expect(userPathPresetFrom(label, data)).toEqual({ reason });
  });
});

describe("the stored preset list", () => {
  it("round-trips through the one key", () => {
    const storage = memoryStorage();
    const presets = [preset("Star", "M 0 0 L 10 0 L 10 10 Z")];

    expect(writeUserPathPresets(storage, presets)).toBe(true);
    expect(storage.getItem(USER_PATH_PRESETS_STORAGE_KEY)).not.toBeNull();
    expect(readUserPathPresets(storage)).toEqual(presets);
  });

  it("drops malformed entries rather than failing the whole list", () => {
    const good = preset("Star", "M 0 0 L 10 0 L 10 10 Z");
    const storage = memoryStorage({
      [USER_PATH_PRESETS_STORAGE_KEY]: JSON.stringify([
        good,
        {
          id: "line",
          label: "No prefix",
          data: "M 0 0 L 1 0",
          paint: "stroke",
        },
        { id: "user:x", label: "", data: "M 0 0 L 1 0", paint: "stroke" },
        { id: "user:y", label: "No paint", data: "M 0 0 L 1 0" },
        null,
      ]),
    });

    expect(readUserPathPresets(storage)).toEqual([good]);
  });

  it.each([
    ["not JSON", "not json"],
    ["a non-array", JSON.stringify({ id: "user:x" })],
  ])("answers none for %s", (_name, raw) => {
    expect(
      readUserPathPresets(
        memoryStorage({ USER_PATH_PRESETS_STORAGE_KEY: raw }),
      ),
    ).toEqual([]);
  });

  it("answers none without a store, or where the store throws", () => {
    expect(readUserPathPresets(undefined)).toEqual([]);
    const refusing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
    } as unknown as Storage;
    expect(readUserPathPresets(refusing)).toEqual([]);
  });

  it("says a write will not survive when there is no store or it refuses", () => {
    expect(writeUserPathPresets(undefined, [])).toBe(false);
    const refusing = {
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    } as unknown as Storage;
    expect(writeUserPathPresets(refusing, [])).toBe(false);
  });
});

describe("the built-in presets the author removed", () => {
  it("round-trips through its own key, deduped", () => {
    const storage = memoryStorage();

    expect(writeRemovedPathPresetIds(storage, ["arc", "arc"])).toBe(true);
    expect(storage.getItem(REMOVED_PATH_PRESETS_STORAGE_KEY)).not.toBeNull();
    expect(readRemovedPathPresetIds(storage)).toEqual(["arc"]);
  });

  it("drops entries that are not ids rather than failing the list", () => {
    const storage = memoryStorage({
      [REMOVED_PATH_PRESETS_STORAGE_KEY]: JSON.stringify([
        "wedge",
        7,
        null,
        "line",
      ]),
    });

    expect(readRemovedPathPresetIds(storage)).toEqual(["wedge", "line"]);
  });

  it("keeps the author's presets and removes only the built-in from the Add pane", () => {
    const first = preset("Star", "M 0 0 L 10 0 L 10 10 Z");
    setActiveUserPathPresets([first]);
    setActiveRemovedPathPresetIds(["arc"]);

    const custom = insertGroups().find((group) => group.id === "custom-shape");
    const shapes = custom?.objects.flatMap((object) =>
      object.kind === "shape" ? [object.shape] : [],
    );

    expect(shapes).toContain(first.id);
    expect(shapes).toContain("line");
    expect(shapes).not.toContain("arc");
  });

  it("notifies on a real removal change only", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRemovedPathPresetIds(listener);

    setActiveRemovedPathPresetIds(["arc"]);
    expect(listener).toHaveBeenCalledTimes(1);
    const key = removedPathPresetIdsKey();

    setActiveRemovedPathPresetIds(["arc"]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(removedPathPresetIdsKey()).toBe(key);

    setActiveRemovedPathPresetIds([]);
    expect(activeRemovedPathPresetIds()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    setActiveRemovedPathPresetIds(["line"]);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("the live list the Add pane and Settings share", () => {
  it("notifies once per real change, and keeps the same snapshot otherwise", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeUserPathPresets(listener);
    const first = preset("Star", "M 0 0 L 10 0 L 10 10 Z");

    setActiveUserPathPresets([first]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(activeUserPathPresets()).toHaveLength(1);
    const key = userPathPresetsKey();

    // `useSyncExternalStore` compares snapshots, so the same content is not a
    // change and must not schedule another render.
    setActiveUserPathPresets([{ ...first }]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(userPathPresetsKey()).toBe(key);

    setActiveUserPathPresets([]);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(userPathPresetsKey()).not.toBe(key);

    unsubscribe();
    setActiveUserPathPresets([first]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("finds the preset an insertion id names", () => {
    const first = preset("Star", "M 0 0 L 10 0 L 10 10 Z");
    setActiveUserPathPresets([first]);

    expect(userPathPreset(first.id)).toEqual(first);
    expect(userPathPreset("user:missing")).toBeUndefined();
  });

  it("offers every user preset in the Add pane's custom shape group", () => {
    const first = preset("Star", "M 0 0 L 10 0 L 10 10 Z");
    setActiveUserPathPresets([first]);

    const custom = insertGroups().find((group) => group.id === "custom-shape");
    const tile = custom?.objects.find(
      (object) => object.kind === "shape" && object.shape === first.id,
    );

    expect(tile).toMatchObject({
      kind: "shape",
      label: "Star",
      path: { data: first.data, paint: first.paint },
    });
  });

  it("names and constructs a new shape from the author's preset", () => {
    const first = preset("Star", "M 0 0 L 10 0 L 10 10 Z");
    setActiveUserPathPresets([first]);

    expect(newShapeName(first.id)).toBe("Star");
    const shape = createNewShape("star-1", globals, first.id, placement);

    expect(shape).toBeInstanceOf(Path);
    expect(shape.get("name")).toBe("Star");
    expect((shape as Path).path).toEqual(new Path(first.data).path);
  });
});
