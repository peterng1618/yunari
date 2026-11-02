/**
 * Corner rounding for a closed polygon authored as SVG path data.
 *
 * **The path data stays the only geometry.** The radius is not stored beside
 * it: it is read back from the fillets in the data, and a new radius rebuilds
 * the same data. That keeps a saved theme to one authored field and lets the
 * inspector's `Path data` row and its radius row describe one object rather
 * than two that could disagree.
 */
interface Point {
  readonly x: number;
  readonly y: number;
}

export interface PathCornerGeometry {
  /** The radius the current fillets encode, or `0` for a sharp polygon. */
  readonly radius: number;
  /** The largest radius every corner can take without eating a whole edge. */
  readonly max: number;
}

/** The commands Fabric stores for a `Path`, read only when they are the
 *  polygon subset this module can round: `M`, straight `L`s, our own `Q`
 *  fillets, and a final `Z`. A curve, an arc or a second subpath is refused
 *  rather than approximated. */
export function pathCornerGeometry(
  commands: unknown,
): PathCornerGeometry | undefined {
  const parsed = cornersOf(commands);
  if (parsed === undefined) return undefined;
  const max = maxRadius(parsed.vertices);
  return max < 1 ? undefined : { radius: parsed.radius, max };
}

/** Rebuilds the path with every straight corner rounded to `radius`, clamped to
 *  the largest radius its shortest edge allows. */
export function roundPathCorners(
  commands: unknown,
  radius: number,
): string | undefined {
  const parsed = cornersOf(commands);
  if (parsed === undefined) return undefined;
  const vertices = parsed.vertices;
  const r = Math.min(Math.max(radius, 0), maxRadius(vertices));
  const count = vertices.length;

  if (r < 0.5) {
    return `M ${point(vertices[0]!)}${vertices
      .slice(1)
      .map((vertex) => ` L ${point(vertex)}`)
      .join("")} Z`;
  }

  const entries: Point[] = [];
  const exits: Point[] = [];
  for (let index = 0; index < count; index += 1) {
    const vertex = vertices[index]!;
    const previous = vertices[(index - 1 + count) % count]!;
    const next = vertices[(index + 1) % count]!;
    const toPrevious = distance(vertex, previous);
    const toNext = distance(vertex, next);
    const tangent = Math.min(r, toPrevious / 2, toNext / 2);
    entries.push(toward(vertex, previous, tangent));
    exits.push(toward(vertex, next, tangent));
  }

  let data = `M ${point(entries[0]!)}`;
  for (let index = 0; index < count; index += 1) {
    data += ` Q ${point(vertices[index]!)} ${point(exits[index]!)}`;
    if (index < count - 1) data += ` L ${point(entries[index + 1]!)}`;
  }
  return `${data} Z`;
}

interface ParsedCorners {
  readonly vertices: readonly Point[];
  readonly radius: number;
}

/** The sharp vertices, with a fillet's control point standing in for the pair
 *  of line ends it replaced. */
function cornersOf(commands: unknown): ParsedCorners | undefined {
  if (!Array.isArray(commands) || commands.length === 0) return undefined;
  const vertices: Point[] = [];
  let closed = false;
  let radius: number | undefined;

  for (const raw of commands) {
    if (!Array.isArray(raw)) return undefined;
    const operation = raw[0];
    if (typeof operation !== "string") return undefined;
    switch (operation.toUpperCase()) {
      case "M": {
        if (vertices.length > 0) return undefined;
        const start = pointAt(raw, 1);
        if (start === undefined) return undefined;
        vertices.push(start);
        break;
      }
      case "L": {
        const end = pointAt(raw, 1);
        if (end === undefined || vertices.length === 0) return undefined;
        vertices.push(end);
        break;
      }
      case "Q": {
        // A fillet: its control point is the sharp vertex, and the two ends it
        // replaced are not vertices of the polygon.
        const control = pointAt(raw, 1);
        const end = pointAt(raw, 3);
        if (control === undefined || end === undefined) return undefined;
        const entry = vertices.pop();
        if (entry === undefined) return undefined;
        const tangent = distance(entry, control);
        if (!(tangent > 0)) return undefined;
        radius = radius === undefined ? tangent : Math.min(radius, tangent);
        vertices.push(control);
        break;
      }
      case "Z":
        closed = true;
        break;
      default:
        // Curves, arcs, horizontal/vertical shorthands and a second subpath are
        // not a polygon with corners this control can state.
        return undefined;
    }
  }

  if (!closed || vertices.length < 3) return undefined;
  const first = vertices[0]!;
  const last = vertices[vertices.length - 1]!;
  if (distance(first, last) < 1e-6) vertices.pop();
  if (vertices.length < 3) return undefined;
  return { vertices, radius: radius ?? 0 };
}

function maxRadius(vertices: readonly Point[]): number {
  let shortest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < vertices.length; index += 1) {
    const next = vertices[(index + 1) % vertices.length]!;
    shortest = Math.min(shortest, distance(vertices[index]!, next));
  }
  return Number.isFinite(shortest) ? shortest / 2 : 0;
}

function pointAt(
  command: readonly unknown[],
  index: number,
): Point | undefined {
  const x = command[index];
  const y = command[index + 1];
  return typeof x === "number" &&
    Number.isFinite(x) &&
    typeof y === "number" &&
    Number.isFinite(y)
    ? { x, y }
    : undefined;
}

function toward(from: Point, to: Point, by: number): Point {
  const length = distance(from, to);
  return {
    x: from.x + ((to.x - from.x) / length) * by,
    y: from.y + ((to.y - from.y) / length) * by,
  };
}

function distance(left: Point, right: Point): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

/** Three decimals is well inside an artboard unit and keeps the authored data
 *  readable in the inspector's own path field. */
function point({ x, y }: Point): string {
  return `${trim(x)} ${trim(y)}`;
}

function trim(value: number): string {
  return String(Number(value.toFixed(3)));
}
