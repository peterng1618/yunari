// @vitest-environment jsdom

import { Path, StaticCanvas } from "fabric/es";
import { describe, expect, it } from "vitest";
import { lucidePath, type PathCommand, starterIcons } from "./icons.js";

const GLYPHS = Object.keys(starterIcons) as ReadonlyArray<
  keyof typeof starterIcons
>;

/**
 * Fabric's constructor takes mutable command tuples; the starter authors them
 * readonly because they are document data. The cast is the boundary, and it is
 * the reason this test builds a real `Path` at all.
 */
const asFabricPath = (commands: ReadonlyArray<PathCommand>) =>
  commands.map((command) => [
    command[0],
    ...command.slice(1),
  ]) as unknown as ConstructorParameters<typeof Path>[0];

/** The box every point of an absolute command list falls inside. */
function bounds(commands: ReadonlyArray<readonly [string, ...number[]]>) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [, ...args] of commands) {
    // An arc's rotation and flags are not coordinates; its two radii are, and
    // they are lengths the same scale applies to.
    const pairs: ReadonlyArray<readonly [number, number]> =
      args.length === 7
        ? [
            [args[0] ?? 0, args[0] ?? 0],
            [args[5] ?? 0, args[6] ?? 0],
          ]
        : Array.from({ length: args.length / 2 }, (_value, index) => [
            args[index * 2] ?? 0,
            args[index * 2 + 1] ?? 0,
          ]);
    for (const [x, y] of pairs) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, minY, maxX, maxY };
}

describe("Lucide icon geometry", () => {
  it("converts every starter glyph inside the box it was asked for", () => {
    // The scale is the whole point of the converter: Lucide draws on a 24-unit
    // grid, and a glyph scaled to 44 that reached 96 units would put every icon
    // over its neighbour without anything saying so.
    for (const name of GLYPHS) {
      const size = 44;
      const commands = starterIcons[name](size);
      expect(commands.length, name).toBeGreaterThan(2);
      const box = bounds(commands);
      expect(box.minX, `${name} minX`).toBeGreaterThanOrEqual(-0.001);
      expect(box.minY, `${name} minY`).toBeGreaterThanOrEqual(-0.001);
      expect(box.maxX, `${name} maxX`).toBeLessThanOrEqual(size + 0.001);
      expect(box.maxY, `${name} maxY`).toBeLessThanOrEqual(size + 0.001);
      // And it must actually draw: a glyph that collapsed to a point would
      // satisfy the bounds above. The floor is on the larger axis, because a
      // narrow glyph is legitimate — a chevron fills half its box across and
      // all of it down.
      expect(
        Math.max(box.maxX - box.minX, box.maxY - box.minY),
        `${name} extent`,
      ).toBeGreaterThan(size * 0.4);
    }
  });

  it("scales linearly, so two sizes are the same shape", () => {
    for (const name of GLYPHS) {
      const small = starterIcons[name](20);
      const large = starterIcons[name](40);
      expect(large.length, name).toBe(small.length);
      for (const [index, command] of small.entries()) {
        const other = large[index] as readonly [string, ...number[]];
        expect(other[0], name).toBe(command[0]);
        for (let axis = 1; axis < command.length; axis += 1) {
          // An arc's rotation and its two flags are angles and booleans, not
          // lengths; scaling them would describe a different arc, so they are
          // carried across rather than compared.
          if (command[0] === "A" && (axis === 3 || axis === 4 || axis === 5))
            expect(other[axis], `${name} A flag ${axis}`).toBe(command[axis]);
          else
            expect(
              Number(other[axis]) / Number(command[axis]),
              `${name} ${command[0]} arg ${axis}`,
            ).toBeCloseTo(2, 6);
        }
      }
    }
  });

  it("emits only commands Fabric renders, and survives a real Path", () => {
    for (const name of GLYPHS) {
      const commands = starterIcons[name](32);
      for (const command of commands) {
        expect(
          "MLCQZSA".includes(command[0]),
          `${name} command ${command[0]}`,
        ).toBe(true);
        for (const value of command.slice(1))
          expect(Number.isFinite(value), `${name} ${command[0]}`).toBe(true);
      }
      // Fabric rewrites the command list on revival; a list it cannot parse
      // would come back empty, and only a real Path shows that.
      const revived = new Path(asFabricPath(commands));
      expect((revived.path as unknown[]).length, name).toBeGreaterThan(2);
      expect(revived.width, name).toBeGreaterThan(0);
      expect(revived.height, name).toBeGreaterThan(0);
    }
  });

  // Pinned as a rule rather than as a glyph: every other test in this file
  // iterates the chosen set, so a converter that stopped reading a moveto's
  // implicit pairs would only be caught if one of the chosen glyphs happened
  // to use one. This spells it out.
  it("reads a moveto's letter-less coordinate pairs as linetos", () => {
    // `chevron-right` is written exactly this way.
    const commands = lucidePath([["path", { d: "m9 18 6-6-6-6" }]], 24);
    expect(commands).toEqual([
      ["M", 9, 18],
      ["L", 15, 12],
      ["L", 9, 6],
    ]);
    // Three pairs, not four: `9 18`, `6-6`, `-6-6`. A fourth would be a
    // reading the source as four moveto argument pairs and drawing a shape
    // Lucide never drew.
  });

  it("turns a rect's corner radius into arcs rather than dropping it", () => {
    const square = lucidePath(
      [["rect", { x: 4, y: 4, width: 16, height: 16, rx: 2 }]],
      48,
    );
    const sharp = lucidePath(
      [["rect", { x: 4, y: 4, width: 16, height: 16 }]],
      48,
    );
    expect(square.filter((command) => command[0] === "A").length).toBe(4);
    expect(sharp.filter((command) => command[0] === "A").length).toBe(0);
    // A zero radius is not an arc of radius zero; it is four corners.
    expect(sharp[0]).toEqual(["M", 8, 8]);
  });

  it("refuses a node kind it would otherwise drop", () => {
    // A silently skipped node is an icon with a piece missing and nothing to
    // say so, which is how the hand-drawn glyphs went stale in the first place.
    expect(() =>
      lucidePath([["ellipse", { cx: 12, cy: 12, rx: 6, ry: 4 }]], 24),
    ).toThrow(/ellipse/);
  });

  it("lands each authored icon where the object says it is", () => {
    // The converter's output is only half the answer: Fabric positions a Path by
    // its own bounding box unless the authored `left`/`top` say otherwise, and
    // this asserts the authored ones survive the revival.
    const canvas = new StaticCanvas(undefined, { width: 400, height: 400 });
    const object = new Path(asFabricPath(starterIcons.cpu(44)), {
      id: "cpu-card-icon",
      left: 456,
      top: 213,
      originX: "left",
      originY: "top",
      stroke: "#4da3ff",
      strokeWidth: 3.6,
      fill: null,
    });
    canvas.add(object);
    expect(object.left).toBe(456);
    expect(object.top).toBe(213);
    expect(object.getBoundingRect().left).toBeCloseTo(456, 5);
    void canvas.dispose();
  });
});
