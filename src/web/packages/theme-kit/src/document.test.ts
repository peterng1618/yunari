import { describe, expect, it } from "vitest";
import {
  addSceneObject,
  listSceneObjects,
  removeSceneObject,
  setArtboard,
  setBackground,
  setBindings,
  setPalette,
  setTypeTokens,
  updateSceneObject,
} from "./document.js";
import { createBlankTheme } from "./starter.js";

const ARTBOARD = { width: 1920, height: 1080 } as const;

function blank() {
  return createBlankTheme({ artboard: ARTBOARD });
}

describe("scene mutation", () => {
  it("appends a subtree with minted ids and leaves the input untouched", () => {
    const original = blank();
    const before = JSON.stringify(original);

    const { envelope, ids } = addSceneObject(original, {
      type: "Group",
      id: "card",
      left: 0,
      top: 0,
      objects: [{ type: "Rect", id: "panel" }],
    });

    expect(JSON.stringify(original)).toBe(before);
    expect(original.scene["objects"]).toEqual([]);
    expect(ids).toEqual(["object-card", "object-panel"]);
    expect(listSceneObjects(envelope).map((object) => object.id)).toEqual([
      "object-card",
      "object-panel",
    ]);
  });

  it("mints past an id the scene already holds", () => {
    const first = addSceneObject(blank(), { type: "Rect", id: "panel" });
    const second = addSceneObject(first.envelope, {
      type: "Rect",
      id: "panel",
    });
    expect(first.ids).toEqual(["object-panel"]);
    expect(second.ids).toEqual(["object-panel-2"]);
  });

  it("attaches a root binding list under the minted id", () => {
    const { envelope, ids } = addSceneObject(
      blank(),
      { type: "YunariChart", id: "chart" },
      [{ id: "chart-cpu", semanticKey: "cpu.load" }],
    );
    expect(envelope.bindings).toEqual({
      [ids[0] as string]: [{ id: "chart-cpu", semanticKey: "cpu.load" }],
    });
  });

  it("shallow-merges an update at any depth and refuses an unknown id", () => {
    const added = addSceneObject(blank(), {
      type: "Group",
      id: "card",
      name: "card",
      objects: [{ type: "Rect", id: "panel", fill: "old" }],
    }).envelope;

    const updated = updateSceneObject(added, "object-panel", { fill: "new" });
    expect(JSON.stringify(added)).not.toContain('"new"');
    const panel = JSON.parse(JSON.stringify(updated.scene["objects"]))[0]
      .objects[0];
    expect(panel).toMatchObject({ id: "object-panel", fill: "new" });
    expect(() => updateSceneObject(updated, "missing", {})).toThrow(/missing/);
  });

  it("removes an object, its descendants and their bindings", () => {
    const added = addSceneObject(blank(), {
      type: "Group",
      id: "card",
      objects: [{ type: "Textbox", id: "value" }],
    }).envelope;
    const withBindings = setBindings(added, "object-value", [
      { id: "cpu", semanticKey: "cpu.load" },
    ]);

    const removed = removeSceneObject(withBindings, "object-card");
    expect(listSceneObjects(removed)).toEqual([]);
    expect(removed.bindings).toEqual({});
    expect(() => removeSceneObject(removed, "object-card")).toThrow();
  });
});

describe("envelope setters", () => {
  it("sets one object's bindings while other objects keep theirs", () => {
    const original = {
      ...blank(),
      bindings: {
        a: [{ id: "a", semanticKey: "cpu.load" }],
        b: [{ id: "b", semanticKey: "gpu.load" }],
      },
    };
    const next = setBindings(original, "b", []);
    expect(next.bindings).toEqual({ a: original.bindings.a });
    expect(original.bindings.b).toHaveLength(1);
  });

  it("replaces the palette and type tokens without mutating either input", () => {
    const original = blank();
    const palette = { text: original.globals?.palette?.text as never };
    const next = setPalette(original, palette);
    expect(next.globals?.palette).toEqual(palette);
    expect(original.globals?.palette).not.toEqual(palette);

    const tokens = { body: { family: "Inter, sans-serif" } };
    const typed = setTypeTokens(original, tokens);
    expect(typed.globals?.typeTokens).toEqual(tokens);
    expect(original.globals?.typeTokens).not.toEqual(tokens);
  });

  it("replaces the artboard and drops a background when given none", () => {
    const original = blank();
    const moved = setArtboard(original, { width: 800, height: 480 });
    expect(moved.artboard).toEqual({ width: 800, height: 480 });
    expect(original.artboard).toEqual(ARTBOARD);

    const dropped = setBackground(moved, undefined);
    expect(dropped).not.toHaveProperty("background");
    expect(moved).toHaveProperty("background");
  });
});
