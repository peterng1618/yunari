import {
  lucideCircuitBoard as board,
  lucideChartColumns as chartColumns,
  lucideChevronRight as chevron,
  lucideCpu as chip,
  lucideHardDrive as drive,
  lucideMemoryStick as stick,
  lucideWifi as waves,
} from "./lucide-icons.js";

/**
 * The starter's icons, taken from the Lucide set the editor already depends on.
 *
 * The scene is Fabric JSON, so a React icon component cannot be authored into
 * it: only geometry can. Lucide keeps each glyph's node array in the per-icon
 * module as `__iconData`; `lucide-icons.ts` copies those arrays so this package
 * stays React-free in Node. The arrays are the package's data, not paths this
 * repository invented.
 *
 * Lucide is ISC-licensed; the notice travels in `lucide-icons.ts`.
 */

/** A Fabric `Path` command: an SVG letter and its numeric arguments. */
export type PathCommand = readonly [string, ...number[]];

type IconNode = readonly [
  string,
  Readonly<Record<string, string | number | undefined>>,
];

/** Argument count per SVG path command; `0` for the closepath. */
const ARITY: Readonly<Record<string, number>> = {
  m: 2,
  l: 2,
  h: 1,
  v: 1,
  c: 6,
  s: 4,
  q: 4,
  t: 2,
  a: 7,
  z: 0,
};

/** How many coordinate pairs follow at `from`, for a moveto with no letter per pair. */
function countPairs(tokens: readonly string[], from: number): number {
  let at = from;
  let pairs = 0;
  while (tokens[at] !== undefined && !/[A-Za-z]/.test(tokens[at] as string)) {
    pairs += 1;
    at += 2;
  }
  return pairs;
}

const TOKENS = /[A-Za-z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g;

/**
 * Lucide node arrays to Fabric path commands at `size` units square, absolute.
 *
 * Absolute because Fabric's own `makePathSimpler` rewrites relative commands
 * during revival: authoring them absolute makes the document the starter ships
 * and the document a save produces the same one, so a round trip is provable.
 */
export function lucidePath(
  node: readonly IconNode[],
  size: number,
): PathCommand[] {
  const scale = size / 24;
  const commands: PathCommand[] = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;

  for (const [tag, attributes] of node) {
    if (tag === "rect") {
      commands.push(...roundedRect(attributes, scale));
      continue;
    }
    if (tag === "circle") {
      commands.push(...circle(attributes, scale));
      continue;
    }
    if (tag !== "path") {
      // A silently dropped node is an icon that renders with a piece missing,
      // and nothing would say so. The starter is a template, not a renderer.
      throw new Error(
        `Lucide node <${tag}> is not a path or rect; convert it before authoring it into a scene.`,
      );
    }
    const tokens = String(attributes["d"] ?? "").match(TOKENS) ?? [];
    for (let index = 0; index < tokens.length; ) {
      const letter = tokens[index] as string;
      const arity = ARITY[letter.toLowerCase()];
      if (arity === undefined)
        throw new Error(`Lucide path command "${letter}" has no arity.`);
      const relative = letter === letter.toLowerCase();
      const upper = letter.toUpperCase();
      if (upper === "Z") {
        commands.push(["Z"]);
        index += 1;
        [x, y] = [startX, startY];
        continue;
      }
      // A moveto takes further coordinate pairs carrying no letter of their
      // own, and each of them is a lineto. `chevron-right` is written
      // `m9 18 6-6-6-6`, so reading only the first pair leaves `6-6-6` to be
      // mistaken for a command letter.
      const pairs = upper === "M" ? countPairs(tokens, index + 1) : 1;
      const args = tokens
        .slice(index + 1, index + 1 + pairs * arity)
        .map((token) => Number(token));
      if (
        args.length !== pairs * arity ||
        args.some((value) => !Number.isFinite(value))
      )
        throw new Error(`Lucide path command "${letter}" is truncated.`);
      index += 1 + pairs * arity;
      if (upper === "M") {
        for (let pair = 0; pair < pairs; pair += 1) {
          const end = absolute(
            args[pair * arity] ?? 0,
            args[pair * arity + 1] ?? 0,
            x,
            y,
            relative,
          );
          commands.push(
            pair === 0
              ? ["M", end[0] * scale, end[1] * scale]
              : ["L", end[0] * scale, end[1] * scale],
          );
          if (pair === 0) [startX, startY] = end;
          [x, y] = end;
        }
        continue;
      }
      const resolved = resolve(upper, args, x, y, relative, scale);
      commands.push(resolved.command);
      [x, y] = resolved.end;
    }
  }
  return commands;
}

/** Resolve a coordinate pair against the running point when the command is relative. */
function absolute(
  rawX: number,
  rawY: number,
  x: number,
  y: number,
  relative: boolean,
): [number, number] {
  return relative ? [rawX + x, rawY + y] : [rawX, rawY];
}

/**
 * One command resolved against the running point, scaled, and reduced to the
 * letters Fabric actually renders.
 *
 * `H` and `V` become `L`: Fabric's own simplifier rewrites them on revival, so
 * emitting them would make the authored document differ from the saved one for
 * no gain. An arc keeps its rotation and its two flags, which are not lengths.
 */
function resolve(
  command: string,
  args: readonly number[],
  x: number,
  y: number,
  relative: boolean,
  scale: number,
): { command: PathCommand; end: [number, number] } {
  // Interleaved x,y arguments — every command except an arc, whose last two
  // sit at offsets 5 and 6 rather than at the end of a run of pairs.
  const at = (point: readonly [number, number]): [number, number] => [
    point[0] * scale,
    point[1] * scale,
  ];
  switch (command) {
    case "H": {
      const endX = relative ? (args[0] ?? 0) + x : (args[0] ?? 0);
      return { command: ["L", endX * scale, y * scale], end: [endX, y] };
    }
    case "V": {
      const endY = relative ? (args[0] ?? 0) + y : (args[0] ?? 0);
      return { command: ["L", x * scale, endY * scale], end: [x, endY] };
    }
    case "A": {
      // The rotation and the two flags are not lengths; scaling them would turn
      // a half turn into a different arc.
      const end = at([
        relative ? (args[5] ?? 0) + x : (args[5] ?? 0),
        relative ? (args[6] ?? 0) + y : (args[6] ?? 0),
      ]);
      return {
        command: [
          "A",
          (args[0] ?? 0) * scale,
          (args[1] ?? 0) * scale,
          args[2] ?? 0,
          args[3] ?? 0,
          args[4] ?? 0,
          end[0],
          end[1],
        ],
        end: [end[0] / scale, end[1] / scale],
      };
    }
    default: {
      // Control points scale on the same parity as the end point: even index x,
      // odd index y. The end point is the last pair.
      const scaled = args.map(
        (value, index) =>
          (relative ? value + (index % 2 === 0 ? x : y) : value) * scale,
      );
      const endX = scaled[scaled.length - 2] ?? 0;
      const endY = scaled[scaled.length - 1] ?? 0;
      return {
        command: [command, ...scaled],
        end: [endX / scale, endY / scale],
      };
    }
  }
}

function roundedRect(
  attributes: Readonly<Record<string, string | number | undefined>>,
  scale: number,
): PathCommand[] {
  const x = Number(attributes["x"] ?? 0) * scale;
  const y = Number(attributes["y"] ?? 0) * scale;
  const w = Number(attributes["width"] ?? 0) * scale;
  const h = Number(attributes["height"] ?? 0) * scale;
  // A zero radius degenerates to four corners, and an arc of radius zero is not
  // a thing the engine has to survive.
  const r = Math.max(
    0,
    Math.min(Number(attributes["rx"] ?? 0) * scale, w / 2, h / 2),
  );
  if (r === 0)
    return [
      ["M", x, y],
      ["L", x + w, y],
      ["L", x + w, y + h],
      ["L", x, y + h],
      ["Z"],
    ];
  return [
    ["M", x + r, y],
    ["L", x + w - r, y],
    ["A", r, r, 0, 0, 1, x + w, y + r],
    ["L", x + w, y + h - r],
    ["A", r, r, 0, 0, 1, x + w - r, y + h],
    ["L", x + r, y + h],
    ["A", r, r, 0, 0, 1, x, y + h - r],
    ["L", x, y + r],
    ["A", r, r, 0, 0, 1, x + r, y],
    ["Z"],
  ];
}

function circle(
  attributes: Readonly<Record<string, string | number | undefined>>,
  scale: number,
): PathCommand[] {
  const cx = Number(attributes["cx"] ?? 0) * scale;
  const cy = Number(attributes["cy"] ?? 0) * scale;
  const r = Number(attributes["r"] ?? 0) * scale;
  return [
    ["M", cx, cy - r],
    ["A", r, r, 0, 0, 1, cx + r, cy],
    ["A", r, r, 0, 0, 1, cx, cy + r],
    ["A", r, r, 0, 0, 1, cx - r, cy],
    ["A", r, r, 0, 0, 1, cx, cy - r],
    ["Z"],
  ];
}

/**
 * The glyphs the reference's cards carry, each at the size its card shows it.
 *
 * Lucide draws on a 24-unit square and lets the glyph's own aspect decide its
 * proportions, so `size` is the glyph's box: a wide DIMM stays wide and a chip
 * stays square, exactly as the reference does. Sizes are the reference's own
 * icon-box measurements, not free choices.
 */
export const starterIcons = {
  cpu: (size: number): PathCommand[] => lucidePath(chip, size),
  gpu: (size: number): PathCommand[] => lucidePath(board, size),
  ram: (size: number): PathCommand[] => lucidePath(stick, size),
  vram: (size: number): PathCommand[] => lucidePath(stick, size),
  trends: (size: number): PathCommand[] => lucidePath(chartColumns, size),
  storage: (size: number): PathCommand[] => lucidePath(drive, size),
  network: (size: number): PathCommand[] => lucidePath(waves, size),
  chevron: (size: number): PathCommand[] => lucidePath(chevron, size),
} as const;
