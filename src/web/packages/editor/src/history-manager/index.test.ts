import type { FabricGlobals } from "@yunari/renderer-core";
import { describe, expect, it, vi } from "vitest";
import { EditorHistory } from "./index.js";

const canvasStub = () => ({ fire: vi.fn(), getActiveObject: () => undefined });

const paletteOf = (colour: string): FabricGlobals => ({
  palette: {
    accent: { name: "Accent", value: { kind: "solid", color: colour } },
  },
});

describe("EditorHistory", () => {
  it("revives an earlier authored scene without saving the revive", async () => {
    const canvas = { fire: vi.fn(), getActiveObject: () => undefined };
    const scenes = [
      { version: "7.4.0", objects: [] },
      { version: "7.4.0", objects: [{ id: "later" }] },
    ];
    const serialize = vi.fn(() => scenes.shift()!);
    const revive = vi.fn(async () => {});
    const history = new EditorHistory({
      canvas: canvas as never,
      serialize,
      revive,
    });

    history.reset();
    history.save();
    await history.undo();

    expect(revive).toHaveBeenCalledWith(canvas, {
      version: "7.4.0",
      objects: [],
    });
    expect(serialize).toHaveBeenCalledTimes(2);
    expect(canvas.fire).toHaveBeenCalledWith("editor:history-state-loaded");
  });

  it("raises the commit on the canvas, and only when an entry is recorded", () => {
    const canvas = { fire: vi.fn(), getActiveObject: () => undefined };
    let value = 0;
    const history = new EditorHistory({
      canvas: canvas as never,
      serialize: () => ({ value }) as never,
      revive: async () => {},
    });
    history.reset();

    // A refused edit changes nothing, so a save that records no entry is not
    // the fix and must not retire the reason the author was given.
    history.save();
    const release = history.suspend();
    value = 1;
    history.save();
    release();
    expect(canvas.fire).not.toHaveBeenCalled();

    history.save();
    expect(canvas.fire).toHaveBeenCalledTimes(1);
    expect(canvas.fire).toHaveBeenCalledWith("editor:edit-committed");
  });

  it("records one entry for a suspended burst, and none while suspended", async () => {
    let value = 0;
    const history = new EditorHistory({
      canvas: {
        fire: () => undefined,
        getActiveObject: () => undefined,
      } as never,
      serialize: () => ({ value }) as never,
      revive: async (_canvas, scene) => {
        value = (scene as unknown as { value: number }).value;
      },
    });
    history.reset();

    const release = history.suspend();
    value = 1;
    history.save(); // suppressed: the counter is non-zero
    release();
    history.save(); // the entry `endBurst` must produce

    value = 2;
    history.save();

    await history.undo();
    expect(value).toBe(1);
    await history.undo();
    expect(value).toBe(0); // straight past the burst: it is ONE entry
  });

  it("steps one entry per press when two undos are still in flight", async () => {
    // An author who sees an undo do nothing hits the chord again, and a restore
    // is asynchronous: both presses reading `#index` before either finishes
    // land on the same entry, so two presses undo one edit and the rest of the
    // history looks unreachable.
    let value = 0;
    let reviving = 0;
    const history = new EditorHistory({
      canvas: {
        fire: () => undefined,
        getActiveObject: () => undefined,
      } as never,
      serialize: () => ({ value }) as never,
      revive: async (_canvas, scene) => {
        reviving += 1;
        while (reviving > 0) {
          reviving -= 1;
          await Promise.resolve();
        }
        value = (scene as unknown as { value: number }).value;
      },
    });
    history.reset();
    value = 1;
    history.save();
    value = 2;
    history.save();

    await Promise.all([history.undo(), history.undo()]);

    expect(value).toBe(0);
    await history.undo();
    expect(value).toBe(0);
  });

  it("records an entry when only the globals changed", () => {
    const canvas = canvasStub();
    let globals: FabricGlobals | undefined = {};
    const history = new EditorHistory({
      canvas: canvas as never,
      serialize: () => ({ version: "7.4.0", objects: [] }) as never,
      revive: async () => {},
    });
    history.attachGlobals({
      read: () => globals,
      write: (next) => {
        globals = next;
      },
    });
    history.reset();

    // A palette edit touches no Fabric object, so the scene is identical and
    // the only difference an entry can see is the envelope's half.
    globals = paletteOf("red");
    history.save();

    expect(canvas.fire).toHaveBeenCalledWith("editor:edit-committed");
  });

  it("writes the previous globals after reviving the scene", async () => {
    const order: string[] = [];
    let globals: FabricGlobals | undefined = paletteOf("red");
    const history = new EditorHistory({
      canvas: canvasStub() as never,
      serialize: () => ({ version: "7.4.0", objects: [] }) as never,
      revive: async () => {
        order.push("revive");
      },
    });
    history.attachGlobals({
      read: () => globals,
      write: (next) => {
        order.push("globals");
        globals = next;
      },
    });
    history.reset();
    globals = paletteOf("blue");
    history.save();

    await history.undo();

    expect(globals).toEqual(paletteOf("red"));
    // The scene is what the globals were authored against, so it goes back
    // first: a palette written before the revive paints the old scene.
    expect(order).toEqual(["revive", "globals"]);
  });

  it("patches the first entry when the port attaches after reset", async () => {
    const canvas = canvasStub();
    let globals: FabricGlobals | undefined;
    const history = new EditorHistory({
      canvas: canvas as never,
      serialize: () => ({ version: "7.4.0", objects: [] }) as never,
      revive: async () => {},
    });
    history.reset();

    // The shell captures the opening document before it has a document to ask,
    // so entry 0 is recorded without globals. Undoing to it must restore the
    // palette that was present when the port attached, not delete it.
    const attached = paletteOf("red");
    globals = attached;
    history.attachGlobals({
      read: () => globals,
      write: (next) => {
        globals = next;
      },
    });
    expect(canvas.fire).not.toHaveBeenCalled();

    globals = paletteOf("blue");
    history.save();
    await history.undo();

    expect(globals).toEqual(attached);
  });

  it("records one entry when neither the scene nor the globals changed", async () => {
    const canvas = canvasStub();
    let globals: FabricGlobals | undefined = paletteOf("red");
    const history = new EditorHistory({
      canvas: canvas as never,
      serialize: () => ({ version: "7.4.0", objects: [] }) as never,
      revive: async () => {},
    });
    history.attachGlobals({
      read: () => globals,
      write: (next) => {
        globals = next;
      },
    });
    history.reset();
    globals = paletteOf("blue");
    history.save();
    globals = paletteOf("blue");
    history.save();

    expect(canvas.fire).toHaveBeenCalledTimes(1);

    await history.undo();
    expect(globals).toEqual(paletteOf("red"));
  });
});
