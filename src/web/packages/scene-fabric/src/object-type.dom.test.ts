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
 * A text object's face is its *first* authored run's token, resolved onto the
 * Fabric object; the runs keep the reference. Size, leading and tracking are
 * the run's own style, painted by `applyAuthoredText`/`refreshBoundText`, so
 * this pass must not overwrite them.
 */

function canvasOf(objects: readonly FabricObject[]): StaticCanvas {
  const canvas = new StaticCanvas(undefined, { width: 400, height: 300 });
  canvas.add(...objects);
  return canvas;
}

/** A token, in the shape `applyObjectTypeTokens` reads it. */
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

describe("object-level type", () => {
  it("applies the first run's token face to the object", () => {
    const object = textbox("metric", [literal("typeTokens.tracked")]);

    applyObjectTypeTokens(
      canvasOf([object]),
      globalsWith({ family: "Inter", weight: 700 }),
    );

    expect(object).toMatchObject({ fontFamily: "Inter", fontWeight: 700 });
  });

  it("leaves the run's size and leading to the run's own style", () => {
    // A token names the face; size and leading are element properties, so this
    // pass must not reset what the run authored.
    const object = textbox("metric", [literal("typeTokens.tracked")]);
    object.set({ fontSize: 12, lineHeight: 1.4 });

    applyObjectTypeTokens(
      canvasOf([object]),
      globalsWith({ family: "Inter", weight: 700 }),
    );

    expect(object.fontSize).toBe(12);
    expect(object.lineHeight).toBe(1.4);
  });
});

describe("token reassignment", () => {
  it("reapplies the face from the token that replaced the deleted one", () => {
    const object = textbox("metric", [literal("typeTokens.old")]);
    const canvas = canvasOf([object]);
    applyObjectTypeTokens(canvas, globalsWith({ family: "Old" }, "old"));
    expect(object.fontFamily).toBe("Old");

    reassignObjectTypeTokenReferences(
      canvas,
      "typeTokens.old",
      "typeTokens.tracked",
    );
    applyObjectTypeTokens(
      canvas,
      globalsWith({ family: "Inter", weight: 600 }),
    );

    expect(object).toMatchObject({ fontFamily: "Inter", fontWeight: 600 });
  });
});

describe("persistence", () => {
  it("carries the applied face through a scene round trip", async () => {
    const object = textbox("metric", [literal("typeTokens.tracked")]);
    const globals = globalsWith({ family: "Inter", weight: 700 });
    applyObjectTypeTokens(canvasOf([object]), globals);

    const scene = serialiseScene(canvasOf([object]));
    const revived = new StaticCanvas(undefined, { width: 400, height: 300 });
    await reviveScene(revived, scene);

    expect(revived.getObjects()[0]).toMatchObject({
      fontFamily: "Inter",
      fontWeight: 700,
    });
  });
});
