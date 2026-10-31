import type { FabricObject } from "fabric/es";
import { describe, expect, it } from "vitest";
import { createPendingPreview } from "./pending-preview.js";

const object = {} as FabricObject;

describe("createPendingPreview", () => {
  it("holds the preview until the gesture ends one way", () => {
    const pending = createPendingPreview();
    pending.record(object, "opacity", 0.75);

    expect(pending.current).toEqual({
      object,
      fieldId: "opacity",
      value: 0.75,
    });
    expect(pending.settle()).toBe(true);
    expect(pending.current).toBeUndefined();
    // A second end finds nothing: one preview is one edit.
    expect(pending.settle()).toBe(false);
  });

  it("drops a cancelled or committed field without owing history", () => {
    const pending = createPendingPreview();
    pending.record(object, "opacity", 0.75);

    pending.discard("opacity");

    expect(pending.current).toBeUndefined();
    expect(pending.settle()).toBe(false);
  });

  it("reports another field's ended gesture, but not the same field's", () => {
    const pending = createPendingPreview();
    pending.record(object, "opacity", 0.75);

    // The gesture that is starting is not the one that was in flight, so this
    // preview is still owed a history entry.
    expect(pending.settleOther("border.width")).toBe(true);
    expect(pending.current).toBeUndefined();

    pending.record(object, "opacity", 0.5);
    expect(pending.settleOther("opacity")).toBe(false);
    expect(pending.current?.value).toBe(0.5);
  });

  it("clears without claiming a save, for a restore that replaced the document", () => {
    const pending = createPendingPreview();
    pending.record(object, "opacity", 0.75);

    pending.clear();

    expect(pending.current).toBeUndefined();
    expect(pending.settle()).toBe(false);
  });
});
