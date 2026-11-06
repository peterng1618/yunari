import { BUILTIN_PATH_PRESETS } from "@yunari/theme-package";
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
  loadPathPresets,
  REMOVED_PATH_PRESETS_STORAGE_KEY,
  readRemovedPathPresetIds,
  readUserPathPresets,
  removeBuiltinPathPreset,
  removedPathPresetIdsKey,
  removePathPreset,
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

function jsonAnswer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fetchFailing(): typeof fetch {
  return vi.fn(async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;
}

function fetchAcceptingMigration(state: {
  readonly presets: readonly UserPathPreset[];
  readonly removedBuiltins: readonly string[];
}): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/path-presets/migrate") {
      return jsonAnswer({
        version: 1,
        presets: state.presets,
        removedBuiltins: state.removedBuiltins,
        migrated: true,
      });
    }
    return jsonAnswer({
      version: 1,
      presets: [],
      removedBuiltins: [],
      migrated: false,
    });
  }) as unknown as typeof fetch;
}

/** A host whose migration is refused, so the browser rows stay the source of
 *  the merged list and a later mutation is answered from that same host. */
function hostRetainingLocalRows(): typeof fetch {
  let removed: string[] = [];
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === "/api/path-presets/migrate") {
      return jsonAnswer({ error: "refused" }, 500);
    }
    if (url === "/api/path-presets/builtins/arc/remove" && method === "POST") {
      removed = ["arc"];
      return jsonAnswer({ ok: true });
    }
    if (url === "/api/path-presets" && method === "GET") {
      return jsonAnswer({
        version: 1,
        presets: [...BUILTIN_PATH_PRESETS],
        removedBuiltins: removed,
        migrated: false,
      });
    }
    if (method === "DELETE") return jsonAnswer({ ok: true });
    return jsonAnswer({ error: "unexpected request" }, 500);
  }) as unknown as typeof fetch;
}

afterEach(() => {
  setActiveUserPathPresets([]);
  setActiveRemovedPathPresetIds([]);
});

describe("loading the host's preset list at boot", () => {
  const mine = (): UserPathPreset => preset("Mine", "M 0 0 L 10 0");

  it("keeps browser presets when the host refuses migration", async () => {
    const stored = mine();
    const storage = memoryStorage({
      "yunari.editor.path-presets": JSON.stringify([stored]),
      "yunari.editor.removed-path-presets": JSON.stringify(["star"]),
    });
    await expect(loadPathPresets(fetchFailing(), storage)).resolves.toEqual({
      version: 1,
      presets: [stored],
      removedBuiltins: ["star"],
      migrated: false,
    });
    expect(storage.getItem("yunari.editor.path-presets")).toBe(
      JSON.stringify([stored]),
    );
  });

  it("clears browser presets only after the host accepts them", async () => {
    const storage = memoryStorage({
      "yunari.editor.path-presets": JSON.stringify([mine()]),
      "yunari.editor.removed-path-presets": JSON.stringify(["star"]),
    });
    await loadPathPresets(
      fetchAcceptingMigration({ presets: [mine()], removedBuiltins: ["star"] }),
      storage,
    );
    expect(storage.getItem("yunari.editor.path-presets")).toBeNull();
    expect(storage.getItem("yunari.editor.removed-path-presets")).toBeNull();
  });

  it("retries an unavailable host's migration on the next load", async () => {
    const stored = mine();
    const storage = memoryStorage({
      "yunari.editor.path-presets": JSON.stringify([stored]),
      "yunari.editor.removed-path-presets": JSON.stringify([]),
    });
    await loadPathPresets(fetchFailing(), storage);

    const migrate = vi.fn(async () =>
      jsonAnswer({
        version: 1,
        presets: [stored],
        removedBuiltins: [],
        migrated: true,
      }),
    );
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/path-presets/migrate") return migrate();
        return jsonAnswer({
          version: 1,
          presets: [],
          removedBuiltins: [],
          migrated: false,
        });
      },
    ) as unknown as typeof fetch;

    await loadPathPresets(fetcher, storage);

    expect(migrate).toHaveBeenCalledTimes(1);
    expect(storage.getItem("yunari.editor.path-presets")).toBeNull();
  });

  it("keeps a retained local row when a built-in is removed", async () => {
    const stored = mine();
    const storage = memoryStorage({
      [USER_PATH_PRESETS_STORAGE_KEY]: JSON.stringify([stored]),
    });
    await loadPathPresets(hostRetainingLocalRows(), storage);

    await removeBuiltinPathPreset("arc");

    expect(activeUserPathPresets()).toEqual([stored]);
    expect(activeRemovedPathPresetIds()).toEqual(["arc"]);
    expect(storage.getItem(USER_PATH_PRESETS_STORAGE_KEY)).toBe(
      JSON.stringify([stored]),
    );
  });

  it("removes a retained local row from its key and the live list", async () => {
    const stored = mine();
    const storage = memoryStorage({
      [USER_PATH_PRESETS_STORAGE_KEY]: JSON.stringify([stored]),
    });
    await loadPathPresets(hostRetainingLocalRows(), storage);

    await removePathPreset(stored.id);

    expect(activeUserPathPresets()).toEqual([]);
    expect(readUserPathPresets(storage)).toEqual([]);
    expect(storage.getItem(USER_PATH_PRESETS_STORAGE_KEY)).toBe("[]");
  });

  it("does not migrate a host that has already migrated", async () => {
    const stored = mine();
    const storage = memoryStorage({
      "yunari.editor.path-presets": JSON.stringify([stored]),
      "yunari.editor.removed-path-presets": JSON.stringify([]),
    });
    const post = vi.fn();
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") post();
        return jsonAnswer({
          version: 1,
          presets: [stored],
          removedBuiltins: [],
          migrated: true,
        });
      },
    ) as unknown as typeof fetch;

    await loadPathPresets(fetcher, storage);

    expect(post).not.toHaveBeenCalled();
  });

  it("writes no built-in or pack row into browser storage", async () => {
    const stored = mine();
    const storage = memoryStorage({
      [USER_PATH_PRESETS_STORAGE_KEY]: JSON.stringify([stored]),
    });
    const setItem = vi.spyOn(storage, "setItem");
    const packed = {
      id: "pack:pack-one:star",
      label: "Pack star",
      data: "M 0 0 L 10 0 L 10 10 Z",
      paint: "fill" as const,
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/api/path-presets/migrate"
        ? jsonAnswer({
            version: 1,
            presets: [...BUILTIN_PATH_PRESETS, packed, stored],
            removedBuiltins: [],
            migrated: true,
          })
        : jsonAnswer({
            version: 1,
            presets: [...BUILTIN_PATH_PRESETS, packed],
            removedBuiltins: [],
            migrated: false,
          }),
    ) as unknown as typeof fetch;

    await loadPathPresets(fetcher, storage);

    // The accepted migration clears the browser's rows; nothing writes the
    // host's built-ins or pack rows back under either key.
    expect(storage.getItem(USER_PATH_PRESETS_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(REMOVED_PATH_PRESETS_STORAGE_KEY)).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
    expect(activeUserPathPresets()).toEqual([packed, stored]);
  });
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
