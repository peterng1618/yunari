/** Uniform mapping from logical artboard coordinates to a viewport. */

export type ContentFit = "contain" | "cover";

/** Rectangular glass, or a round panel whose disc is the screen. */
export type DisplayShape = "rect" | "circle";

/** How a display presents the composition: its glass and its mounting angle. */
export interface DisplayPresentation {
  readonly shape: DisplayShape;
  /** Whole degrees clockwise; omitted means upright. */
  readonly rotation?: number;
}

export interface ArtboardSize {
  readonly width: number;
  readonly height: number;
}

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

/** Size of one letterbox bar per axis, in viewport pixels. */
export interface ArtboardBars {
  readonly x: number;
  readonly y: number;
}

/** Document-space amount cropped from each edge in cover mode. */
export interface ArtboardCrop {
  readonly x: number;
  readonly y: number;
}

export interface ArtboardTransform {
  /** Single uniform scale; split x/y scaling would distort authored content. */
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly contentFit: ContentFit;
  readonly bars: ArtboardBars;
  readonly crop: ArtboardCrop;
  /** Whole degrees clockwise applied to the whole composition. */
  readonly rotation: number;
  /**
   * `[a, b, c, d, tx, ty]` as a Canvas 2D matrix: the one form Fabric's
   * viewport and the point mapping both read.
   */
  readonly matrix: readonly [number, number, number, number, number, number];
  /** Legitimate zero-area viewport state, e.g. hidden or mid-rotation. */
  readonly isDegenerate: boolean;
}

export interface ComputeArtboardTransformInput {
  readonly artboard: ArtboardSize;
  readonly viewport: ViewportSize;
  readonly contentFit?: ContentFit;
  /** Whole degrees clockwise; a rect display accepts quarter turns only. */
  readonly rotation?: number;
  readonly shape?: DisplayShape;
}

/** Computes the centred rotate-then-fit transform. Invalid geometry or angle throws. */
export function computeArtboardTransform(
  input: ComputeArtboardTransformInput,
): ArtboardTransform {
  const { artboard, viewport } = input;
  const contentFit = input.contentFit ?? "contain";
  const shape = input.shape ?? "rect";
  const rotation = readRotation(shape, input.rotation);

  assertFinite(artboard.width, "artboard.width");
  assertFinite(artboard.height, "artboard.height");
  assertFinite(viewport.width, "viewport.width");
  assertFinite(viewport.height, "viewport.height");

  if (artboard.width <= 0 || artboard.height <= 0) {
    throw new RangeError(
      `Artboard must have positive dimensions; got ${artboard.width}x${artboard.height}.`,
    );
  }

  // Viewport collapse is transient layout state, not an invalid document.
  const viewportWidth = Math.max(0, viewport.width);
  const viewportHeight = Math.max(0, viewport.height);

  if (viewportWidth === 0 || viewportHeight === 0) {
    return {
      scale: 0,
      offsetX: 0,
      offsetY: 0,
      contentFit,
      bars: { x: 0, y: 0 },
      crop: { x: 0, y: 0 },
      rotation,
      matrix: [0, 0, 0, 0, 0, 0],
      isDegenerate: true,
    };
  }

  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  // Rect: the rotated bounding box drives the contain/cover ratio. Circle: the
  // artboard's diagonal is the disc's diameter, so the angle cannot change it.
  const boxWidth =
    shape === "circle"
      ? artboard.width
      : Math.abs(artboard.width * cos) + Math.abs(artboard.height * sin);
  const boxHeight =
    shape === "circle"
      ? artboard.height
      : Math.abs(artboard.width * sin) + Math.abs(artboard.height * cos);

  let scale: number;
  if (shape === "circle") {
    scale =
      Math.min(viewportWidth, viewportHeight) /
      Math.hypot(artboard.width, artboard.height);
  } else {
    const ratioX = viewportWidth / boxWidth;
    const ratioY = viewportHeight / boxHeight;
    scale =
      contentFit === "contain"
        ? Math.min(ratioX, ratioY)
        : Math.max(ratioX, ratioY);
  }

  const a = scale * cos;
  const b = scale * sin;
  // `-0` is numerically equal to `0` but not deep-equal; normalise it so the
  // upright matrix compares exactly with the one this function always returned.
  const c = -scale * sin + 0;
  const d = scale * cos;

  // Centre the composition's centre on the viewport's centre.
  const offsetX =
    viewportWidth / 2 - (a * artboard.width) / 2 - (c * artboard.height) / 2;
  const offsetY =
    viewportHeight / 2 - (b * artboard.width) / 2 - (d * artboard.height) / 2;

  const matrix: readonly [number, number, number, number, number, number] = [
    a,
    b,
    c,
    d,
    offsetX,
    offsetY,
  ];

  if (shape === "circle") {
    return {
      scale,
      offsetX,
      offsetY,
      contentFit,
      bars: { x: 0, y: 0 },
      crop: { x: 0, y: 0 },
      rotation,
      matrix,
      isDegenerate: false,
    };
  }

  const slackX = (viewportWidth - boxWidth * scale) / 2;
  const slackY = (viewportHeight - boxHeight * scale) / 2;

  if (contentFit === "contain") {
    return {
      scale,
      offsetX,
      offsetY,
      contentFit,
      bars: { x: Math.max(0, slackX), y: Math.max(0, slackY) },
      crop: { x: 0, y: 0 },
      rotation,
      matrix,
      isDegenerate: false,
    };
  }

  return {
    scale,
    offsetX,
    offsetY,
    contentFit,
    bars: { x: 0, y: 0 },
    crop: {
      x: Math.max(0, -slackX / scale),
      y: Math.max(0, -slackY / scale),
    },
    rotation,
    matrix,
    isDegenerate: false,
  };
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export function documentToViewport(
  transform: ArtboardTransform,
  point: Point,
): Point {
  const [a, b, c, d, tx, ty] = transform.matrix;
  return {
    x: a * point.x + c * point.y + tx,
    y: b * point.x + d * point.y + ty,
  };
}

/** Exact inverse for finite transforms; degenerate transforms map to the origin. */
export function viewportToDocument(
  transform: ArtboardTransform,
  point: Point,
): Point {
  const [a, b, c, d, tx, ty] = transform.matrix;
  const determinant = a * d - b * c;
  if (determinant === 0) {
    return { x: 0, y: 0 };
  }

  const x = point.x - tx;
  const y = point.y - ty;
  return {
    x: (d * x - c * y) / determinant,
    y: (a * y - b * x) / determinant,
  };
}

/** CSS transform for a host using `transform-origin: 0 0`. */
export function toCssTransform(transform: ArtboardTransform): string {
  const translate = `translate(${transform.offsetX}px, ${transform.offsetY}px)`;
  if (transform.rotation === 0) {
    return `${translate} scale(${transform.scale})`;
  }
  return `${translate} rotate(${transform.rotation}deg) scale(${transform.scale})`;
}

export function isFullyVisible(transform: ArtboardTransform): boolean {
  return (
    !transform.isDegenerate && transform.crop.x === 0 && transform.crop.y === 0
  );
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number; got ${value}.`);
  }
}

/** Refuses an angle the display's shape cannot hold; never clamps it. */
function readRotation(
  shape: DisplayShape,
  rotation: number | undefined,
): number {
  if (rotation === undefined) {
    return 0;
  }
  if (!Number.isInteger(rotation)) {
    throw new RangeError(
      `rotation must be a whole number of degrees; got ${rotation}.`,
    );
  }
  const allowed =
    shape === "circle"
      ? rotation >= 0 && rotation < 360
      : rotation === 0 ||
        rotation === 90 ||
        rotation === 180 ||
        rotation === 270;
  if (!allowed) {
    throw new RangeError(
      `rotation ${rotation} is not valid for a ${shape} display.`,
    );
  }
  return rotation;
}
