import type { FabricThemeEnvelope } from "@yunari/renderer-core";
import { describe, expect, it } from "vitest";
import { envelopePlan } from "./hosted-plan.js";

/** The shape a host serves: artboard paint is a palette reference (the envelope
 *  validator refuses a local literal), and a palette entry is a structured paint
 *  rather than a bare colour. A solid paint resolves to its colour, which is the
 *  form `scene-fabric` paints. */
function envelope(paint: { readonly kind: "solid"; readonly color: string }) {
  return {
    schemaVersion: "2.1.0" as const,
    fabricVersion: "7.4.0",
    id: "hosted",
    artboard: {
      width: 640,
      height: 360,
    },
    background: {
      color: { ref: "palette.paper" as const },
    },
    globals: {
      palette: {
        paper: { name: "Paper", value: paint },
      },
    },
    scene: {},
  } satisfies FabricThemeEnvelope;
}

describe("hosted envelope plan", () => {
  // The plan resolves the artboard's palette references before the renderer
  // sees them: no renderer draws a `{ ref: "palette.paper" }`, so a plan that
  // carried one leaves the page showing behind the artboard.
  it("paints the artboard from its palette references", () => {
    const { artboard } = envelopePlan(
      envelope({ kind: "solid", color: "#e8e4da" }),
    );

    expect(artboard.background).toBe("#e8e4da");
  });

  it("carries the artboard box through", () => {
    const { artboard, nodes } = envelopePlan(
      envelope({ kind: "solid", color: "#e8e4da" }),
    );

    expect(artboard).toMatchObject({
      width: 640,
      height: 360,
      contentFit: "contain",
    });
    expect(nodes).toEqual([]);
  });

  // A reference the envelope does not define is an authoring gap, not a paint:
  // reported, and left unpainted rather than filled with a guessed colour.
  it("reports an undefined reference and paints nothing", () => {
    const theme = envelope({ kind: "solid", color: "#e8e4da" });
    const missing: FabricThemeEnvelope = {
      ...theme,
      globals: { palette: {} },
    };

    const plan = envelopePlan(missing);

    expect(plan.artboard.background).toBeUndefined();
    expect(plan.issues.map((issue) => issue.detail)).toEqual([
      'Global "palette.paper" is not defined in this document.',
    ]);
  });
});
