import { describe, expect, it } from "vitest";
import {
  addSceneObject,
  listSceneObjects,
  moveSceneObject,
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

  it("restacks one object among its siblings", () => {
    const a = addSceneObject(blank(), { type: "Rect", id: "a" });
    const b = addSceneObject(a.envelope, { type: "Rect", id: "b" });
    const c = addSceneObject(b.envelope, { type: "Rect", id: "c" });
    const idsOf = (envelope: ReturnType<typeof blank>): readonly unknown[] =>
      (envelope.scene["objects"] as readonly { readonly id?: string }[]).map(
        (object) => object.id,
      );

    const front = moveSceneObject(c.envelope, "object-a", "front");
    expect(front.moved).toBe(true);
    expect(idsOf(front.envelope)).toEqual(["object-b", "object-c", "object-a"]);

    const back = moveSceneObject(front.envelope, "object-a", "back");
    expect(back.moved).toBe(true);
    expect(idsOf(back.envelope)).toEqual(["object-a", "object-b", "object-c"]);

    // Already at the end it was sent to: an answer, not a refusal.
    const still = moveSceneObject(back.envelope, "object-a", "back");
    expect(still.moved).toBe(false);
    expect(idsOf(still.envelope)).toEqual(idsOf(back.envelope));
  });

  it("restacks a grouped child within its group, never into the root", () => {
    const { envelope } = addSceneObject(blank(), {
      type: "Group",
      id: "card",
      objects: [
        { type: "Rect", id: "one" },
        { type: "Rect", id: "two" },
      ],
    });

    const moved = moveSceneObject(envelope, "object-one", "front");
    expect(moved.moved).toBe(true);
    const [group] = moved.envelope.scene["objects"] as readonly {
      readonly id?: string;
      readonly objects?: readonly { readonly id?: string }[];
    }[];
    expect(group?.id).toBe("object-card");
    expect(group?.objects?.map((object) => object.id)).toEqual([
      "object-two",
      "object-one",
    ]);
  });

  it("refuses to restack an object the scene does not hold", () => {
    expect(() => moveSceneObject(blank(), "absent", "front")).toThrow(
      'There is no object "absent" in this scene.',
    );
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

  it("refuses a binding id that is already in the document", () => {
    const first = addSceneObject(
      blank(),
      { type: "YunariChart", id: "chart" },
      [{ id: "chart-cpu", semanticKey: "cpu.load" }],
    );
    expect(() =>
      addSceneObject(first.envelope, { type: "YunariChart", id: "chart" }, [
        { id: "chart-cpu", semanticKey: "cpu.load" },
      ]),
    ).toThrow(/Binding id "chart-cpu"/);
  });

  it("refuses a binding record keyed by an object it is not inserting", () => {
    expect(() =>
      addSceneObject(
        blank(),
        { type: "Group", id: "card" },
        {
          missing: [{ id: "cpu-load", semanticKey: "cpu.load" }],
        },
      ),
    ).toThrow(/There is no object "missing" in this insertion/);
  });

  it("refuses a binding id repeated inside one insertion", () => {
    expect(() =>
      addSceneObject(
        blank(),
        { type: "Group", id: "card" },
        {
          card: [
            { id: "same", semanticKey: "cpu.load" },
            { id: "same", semanticKey: "gpu.load" },
          ],
        },
      ),
    ).toThrow(/Binding id "same"/);
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
    const base = blank();
    const original = {
      ...base,
      scene: {
        ...base.scene,
        objects: [{ id: "a" }, { id: "b" }],
      },
      bindings: {
        a: [{ id: "a", semanticKey: "cpu.load" }],
        b: [{ id: "b", semanticKey: "gpu.load" }],
      },
    };
    const next = setBindings(original, "b", []);
    expect(next.bindings).toEqual({ a: original.bindings.a });
    expect(original.bindings.b).toHaveLength(1);
  });

  it("refuses bindings on an object this scene does not hold", () => {
    expect(() => setBindings(blank(), "missing", [])).toThrow(
      /There is no object "missing"/,
    );
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
