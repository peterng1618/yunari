// @vitest-environment jsdom
import { ActiveSelection, Canvas, Rect } from "fabric/es";
import { describe, expect, it, vi } from "vitest";
import { createObjectLockManager } from "./index.js";

const locked = (object: Rect): boolean => object.get("locked") === true;

describe("ObjectLockManager", () => {
  it("locks and unlocks the active object and saves history", () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const object = new Rect({ id: "shape" });
    canvas.add(object);
    canvas.setActiveObject(object);
    const save = vi.fn();
    const manager = createObjectLockManager(canvas, save);

    manager.lockObject();
    // A lock is "cannot be transformed", not "cannot be selected": a locked
    // object stays clickable, so `selectable` must not be the flag that carries
    // it.
    expect(object.selectable).toBe(true);
    expect(object.evented).toBe(true);
    expect(object.get("locked")).toBe(true);

    manager.unlockObject();
    expect(object.get("locked")).toBe(false);
    expect(object.hasControls).toBe(true);

    expect(save).toHaveBeenCalledTimes(2);
  });

  it("accepts an explicit object instead of the active selection", () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const object = new Rect({ id: "shape" });
    const save = vi.fn();
    const manager = createObjectLockManager(canvas, save);

    manager.lockObject({ object });

    expect(object.get("locked")).toBe(true);
    expect(save).toHaveBeenCalledOnce();
  });

  it("leaves a locked object selectable, with nothing to grab", () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const object = new Rect({ width: 10, height: 10 });
    canvas.add(object);
    const manager = createObjectLockManager(canvas, saveOf());

    manager.lockObject({ object });

    // Still selectable: Fabric's own mousedown path requires this to activate.
    expect(object.selectable).toBe(true);
    // No handles, so selecting it does not imply it can be transformed.
    expect(object.hasControls).toBe(false);
    // And the drag itself is refused, not merely un-grabbable.
    expect(object.lockMovementX).toBe(true);
    expect(object.lockMovementY).toBe(true);
    expect(object.lockScalingX).toBe(true);
    expect(object.lockScalingY).toBe(true);
    expect(object.lockRotation).toBe(true);
  });

  it("restores Fabric's transform defaults on unlock", () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const object = new Rect({ width: 10, height: 10 });
    canvas.add(object);
    const manager = createObjectLockManager(canvas, saveOf());

    manager.lockObject({ object });
    manager.unlockObject({ object });

    expect(object.hasControls).toBe(true);
    expect(object.lockMovementX).toBe(false);
    expect(object.lockScalingY).toBe(false);
    expect(object.lockRotation).toBe(false);
  });

  it("keeps a locked object out of a multi-selection, so a drag cannot move it", () => {
    // The hole this closes: a member of an ActiveSelection is transformed
    // through the selection, which carries no lock flags of its own, so
    // `lockMovementX` on the child is never consulted and the child rides
    // along. Verified against Fabric rather than assumed.
    const canvas = new Canvas(document.createElement("canvas"));
    const a = new Rect({ left: 10, top: 10, width: 10, height: 10 });
    const b = new Rect({ left: 40, top: 40, width: 10, height: 10 });
    canvas.add(a, b);
    const manager = createObjectLockManager(canvas, saveOf());
    manager.lockObject({ object: a });

    canvas.setActiveObject(new ActiveSelection([a, b], { canvas }));
    canvas.fire("selection:created", { selected: [a, b] });

    const active = canvas.getActiveObject();
    const members =
      active instanceof ActiveSelection ? active.getObjects() : [active];
    expect(members).not.toContain(a);
  });

  it("re-derives the transform flags for a locked object that undo revived", () => {
    // Undo rebuilds the scene, so a revived object is a new instance at
    // Fabric's defaults. `locked` is the persisted state; if the flags were
    // only ever written at lock time, undo would silently un-break the lock.
    const canvas = new Canvas(document.createElement("canvas"));
    const object = new Rect({ width: 10, height: 10 });
    canvas.add(object);
    const manager = createObjectLockManager(canvas, saveOf());
    manager.lockObject({ object });

    const revived = new Rect({ width: 10, height: 10 });
    revived.set("locked", true);
    canvas.remove(object);
    canvas.add(revived);
    expect(revived.hasControls).toBe(true);

    canvas.fire("editor:history-state-loaded" as never);

    expect(revived.hasControls).toBe(false);
    expect(revived.lockMovementX).toBe(true);
    expect(locked(revived)).toBe(true);
  });

  it("releases its canvas listeners on destroy", () => {
    const canvas = new Canvas(document.createElement("canvas"));
    const a = new Rect({ left: 10, top: 10, width: 10, height: 10 });
    const b = new Rect({ left: 40, top: 40, width: 10, height: 10 });
    canvas.add(a, b);
    const manager = createObjectLockManager(canvas, saveOf());
    manager.lockObject({ object: a });
    manager.destroy();

    canvas.setActiveObject(new ActiveSelection([a, b], { canvas }));
    canvas.fire("selection:created", { selected: [a, b] });

    // A manager that outlived its canvas would keep rewriting selections.
    const active = canvas.getActiveObject();
    const members =
      active instanceof ActiveSelection ? active.getObjects() : [active];
    expect(members).toContain(a);
  });
});

const saveOf = (): (() => void) => vi.fn();
