// @vitest-environment jsdom
import type { TypeToken } from "@yunari/renderer-core";
import { type FabricObject, StaticCanvas, Textbox } from "fabric/es";
import { describe, expect, it } from "vitest";
import { YUNARI_TEXT_PROPERTY } from "./fabric-text.js";
import {
  applyObjectTypeTokens,
  reassignObjectTypeTokenReferences,
} from "./object-type.js";
import { reviveScene, serialiseScene } from "./persist.js";

/**
 * Object-level type on the v2 path.
 *
 * A text object's own typography is the *first* authored run's preset, resolved
 * onto the Fabric object; the runs keep the reference. `letterSpacing` was the
 * one preset field that never reached Fabric, so a tracked wordmark rendered
 * untracked. Fabric's `charSpacing` is 1/1000 em of the object's own font size,
 * so the conversion needs that size — which is why the assertion is on the
 * ratio, not on a pixel count a different font stack would change.
 */

function canvasOf(objects: readonly FabricObject[]): StaticCanvas {
  const canvas = new StaticCanvas(undefined, { width: 400, height: 300 });
  canvas.add(...objects);
  return canvas;
}

/** A tracked token, in the shape `applyObjectTypeTokens` reads it. */
function globalsWith(
  value: Readonly<Record<string, unknown>>,
  id = "tracked",
): Parameters<typeof applyObjectTypeTokens>[1] {
  return { typeTokens: { [id]: value as unknown as TypeToken } };
}

function textbox(
  id: string,
  runs: readonly Readonly<Record<string, unknown>>[],
): Textbox {
  const object = new Textbox("CPU", { id });
  object.set(YUNARI_TEXT_PROPERTY, { runs });
  return object;
}

const literal = (typeToken: string) => ({
  kind: "literal",
  text: "CPU",
  typeToken,
});

describe("object-level tracking", () => {
  it("converts a preset's letter spacing into Fabric charSpacing", () => {
    const object = textbox("metric", [literal("typeTokens.tracked")]);

    applyObjectTypeTokens(
      canvasOf([object]),
      globalsWith({ family: "Inter", size: 32, letterSpacing: 0.8 }),
    );

    // 0.8px at 32px is 25/1000 em, which is what Fabric's charSpacing means.
    expect(object.charSpacing).toBeCloseTo(25, 6);
  });

  it("converts against the size it just applied, not a stale one", () => {
    // The editor's preset panel commits size and spacing together, so an object
    // already sitting at another size must not keep the old ratio.
    const object = textbox("metric", [literal("typeTokens.tracked")]);
    object.set({ fontSize: 12, charSpacing: 100 });

    applyObjectTypeTokens(
      canvasOf([object]),
      globalsWith({ family: "Inter", size: 32, letterSpacing: 0.8 }),
    );

    expect(object.fontSize).toBe(32);
    expect(object.charSpacing).toBeCloseTo(25, 6);
  });

  it("removes tracking when the preset stops carrying it", () => {
    const object = textbox("metric", [literal("typeTokens.tracked")]);
    object.set({ charSpacing: 40 });
    object.initDimensions();

    applyObjectTypeTokens(
      canvasOf([object]),
      globalsWith({ family: "Inter", size: 32 }),
    );

    // Clearing the panel field has to clear the screen, or the author edits a
    // number that does nothing.
    expect(object.charSpacing).toBe(0);
  });

  it("refuses a size that cannot convert instead of inventing a ratio", () => {
    const object = textbox("metric", [literal("typeTokens.tracked")]);
    applyObjectTypeTokens(
      canvasOf([object]),
      globalsWith({ family: "Inter", size: 32, letterSpacing: 0.8 }),
    );

    applyObjectTypeTokens(
      canvasOf([object]),
      globalsWith({ family: "Inter", size: 0, letterSpacing: 0.8 }),
    );

    // Fabric's ratio divides by the font size; a zero size is not zero
    // tracking, it is an absent conversion, so the last honest value stands.
    expect(object.charSpacing).toBeCloseTo(25, 6);
  });

  it("refuses a letter spacing that is not a finite number", () => {
    const object = textbox("metric", [literal("typeTokens.tracked")]);
    applyObjectTypeTokens(
      canvasOf([object]),
      globalsWith({ family: "Inter", size: 32, letterSpacing: 0.8 }),
    );

    applyObjectTypeTokens(
      canvasOf([object]),
      globalsWith({ family: "Inter", size: 32, letterSpacing: Number.NaN }),
    );

    expect(object.charSpacing).toBeCloseTo(25, 6);
  });
});

describe("font readiness", () => {
  it("derives tracking from the preset's size alone, and reapplying is stable", () => {
    // **What this does not cover:** whether a face that has not loaded measures
    // differently. That is not unit-testable here — jsdom measures every family
    // with the same fallback, and `applyObjectTypeTokens` overwrites
    // `fontFamily` from the preset, so a deliberately-missing family would be
    // replaced before anything read it. The rendered guarantee is the value
    // being em-relative, which is arithmetic rather than measurement: Fabric
    // multiplies `charSpacing` by the object's own `fontSize`, so a face
    // arriving late cannot rescale it. `adapter.ts` remeasures text on
    // `loadingdone` for the widths that *do* depend on the face.
    //
    // So what is asserted here is the half that is testable: the ratio comes
    // from the preset's declared size, and reapplying it — which is what a font
    // load, a preset edit and an undo each cause — does not drift it.
    const globals = globalsWith({
      family: "Inter",
      size: 32,
      letterSpacing: 0.8,
    });
    const object = textbox("metric", [literal("typeTokens.tracked")]);
    const canvas = canvasOf([object]);

    applyObjectTypeTokens(canvas, globals);
    expect(object.charSpacing).toBeCloseTo(25, 6);

    // The preset's size is the denominator, not the object's current one: an
    // object sitting at another size must not keep a stale ratio.
    object.set({ fontSize: 12 });
    applyObjectTypeTokens(canvas, globals);
    expect(object.fontSize).toBe(32);
    expect(object.charSpacing).toBeCloseTo(25, 6);

    // Idempotent, so a second application cannot drift the value.
    applyObjectTypeTokens(canvas, globals);
    expect(object.charSpacing).toBeCloseTo(25, 6);
  });
});

describe("preset reassignment", () => {
  it("reapplies tracking from the preset that replaced the deleted one", () => {
    const object = textbox("metric", [literal("typeTokens.old")]);
    const canvas = canvasOf([object]);
    applyObjectTypeTokens(
      canvas,
      globalsWith({ family: "Inter", size: 32, letterSpacing: 4 }, "old"),
    );
    expect(object.charSpacing).toBeCloseTo(125, 6);

    reassignObjectTypeTokenReferences(
      canvas,
      "typeTokens.old",
      "typeTokens.tracked",
    );
    applyObjectTypeTokens(
      canvas,
      globalsWith({ family: "Inter", size: 32, letterSpacing: 0.8 }),
    );

    expect(object.charSpacing).toBeCloseTo(25, 6);
  });
});

describe("persistence", () => {
  it("carries tracking through a scene round trip", async () => {
    // The display reads the persisted Fabric object, so a resolved ratio that
    // never reaches the saved scene is a ratio only the editor can see.
    const object = textbox("metric", [literal("typeTokens.tracked")]);
    const globals = globalsWith({
      family: "Inter",
      size: 32,
      letterSpacing: 0.8,
    });
    applyObjectTypeTokens(canvasOf([object]), globals);

    const scene = serialiseScene(canvasOf([object]));
    const revived = new StaticCanvas(undefined, { width: 400, height: 300 });
    await reviveScene(revived, scene);

    const restored = revived.getObjects()[0] as Textbox;
    expect(restored.charSpacing).toBeCloseTo(25, 6);
  });
});
