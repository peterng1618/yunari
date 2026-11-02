import { Path } from "fabric/es";
import { describe, expect, it } from "vitest";
import { pathCornerGeometry, roundPathCorners } from "./path-corners.js";

const square = new Path("M 0 0 L 10 0 L 10 10 L 0 10 Z");
const commands = (data: string): unknown => new Path(data).get("path");

describe("a closed polygon's corner radius", () => {
  it("reads a sharp square as radius zero with half its shortest edge to give", () => {
    expect(pathCornerGeometry(square.get("path"))).toEqual({
      radius: 0,
      max: 5,
    });
  });

  it("writes fillets into the path data, and reads the same radius back", () => {
    const rounded = roundPathCorners(square.get("path"), 2);
    expect(rounded).toContain("Q ");
    const geometry = pathCornerGeometry(commands(rounded!));
    expect(geometry?.radius).toBeCloseTo(2, 2);
    // The geometry stays one authored path: a new radius rebuilds from the
    // fillets rather than from a second stored source.
    expect(roundPathCorners(commands(rounded!), 3)).toContain("Q ");
    expect(
      pathCornerGeometry(commands(roundPathCorners(commands(rounded!), 3)!))
        ?.radius,
    ).toBeCloseTo(3, 2);
  });

  it("a zero radius restores the sharp corners", () => {
    const rounded = roundPathCorners(square.get("path"), 2)!;
    const sharp = roundPathCorners(commands(rounded), 0);
    expect(sharp).not.toContain("Q ");
    expect(pathCornerGeometry(commands(sharp!))?.radius).toBe(0);
  });

  it("refuses a path with curves rather than approximating them", () => {
    expect(pathCornerGeometry(commands("M 0 0 C 5 0 5 10 10 10 Z"))).toBe(
      undefined,
    );
  });

  it("refuses an open path, which has no closed corner to round", () => {
    expect(pathCornerGeometry(commands("M 0 0 L 10 0 L 10 10"))).toBe(
      undefined,
    );
  });
});
