import {
  ARTBOARD_ORIENTATIONS,
  type ArtboardOrientation,
  type ArtboardShape,
} from "./artboard-presets.js";

/**
 * The preview ratios an author can look through: a stored list of `W:H` tokens
 * plus `Circle`, parsed into the lenses the display menu and the camera use.
 *
 * **A catalogue, not a derived table.** The presets used to be the list, so an
 * author could not add, remove or reset a preview and there was no square or
 * round display. The stored vocabulary stays closed (`W:H` or `Circle`) and is
 * validated once on read, so a hand-edited preference cannot frame the stage at
 * a ratio nobody chose.
 *
 * **Browser-local and camera state.** The list lives under `yunari.editor.*`
 * and never enters the theme envelope (§67): choosing a preview changes what
 * the camera looks at, not what the document holds.
 */

export type PreviewShape = "rect" | "circle";

export interface PreviewRatio {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly shape: PreviewShape;
}

/** What an author gets before they change anything: the common screens, a
 *  square panel and a round one. */
export const DEFAULT_PREVIEW_RATIO_TOKENS: readonly string[] = [
  "16:9",
  "19.5:9",
  "4:3",
  "1:1",
  "Circle",
];

export const PREVIEW_RATIO_STORAGE_KEY = "yunari.editor.preview-ratios";

/** A ratio's normalised id, or a refusal. Two integer edges are divided by
 *  their greatest common divisor (`32:18` is `16:9`); an edge with a decimal is
 *  kept as typed, because `19.5:9` is the spelling its author knows and
 *  dividing a decimal would rename a ratio nobody edited. */
export function parsePreviewRatio(input: string): PreviewRatio {
  const text = input.trim();
  if (text.toLowerCase() === "circle") {
    return { id: "Circle", width: 1, height: 1, shape: "circle" };
  }

  const parts = text.split(":");
  const [rawWidth, rawHeight] = parts;
  if (parts.length !== 2 || rawWidth === undefined || rawHeight === undefined) {
    throw new RangeError(`a preview ratio is W:H, not ${input}`);
  }
  const width = Number(rawWidth);
  const height = Number(rawHeight);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new RangeError(`preview ratio edges must be positive, not ${input}`);
  }

  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    return {
      id: `${rawWidth.trim()}:${rawHeight.trim()}`,
      width,
      height,
      shape: "rect",
    };
  }
  const divisor = gcd(width, height);
  return {
    id: `${width / divisor}:${height / divisor}`,
    width: width / divisor,
    height: height / divisor,
    shape: "rect",
  };
}

/** The stored list as the tokens that can be parsed, first duplicate winning.
 *  Anything unreadable is not an author choice, so it becomes the defaults. */
export function normalisePreviewRatioTokens(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return DEFAULT_PREVIEW_RATIO_TOKENS;

  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    let ratio: PreviewRatio;
    try {
      ratio = parsePreviewRatio(entry);
    } catch {
      continue;
    }
    if (seen.has(ratio.id)) continue;
    seen.add(ratio.id);
    tokens.push(ratio.id);
  }
  return tokens;
}

/** The stored list, or the defaults where there is none or it cannot be read.
 *  `Storage` is absent in a private window and throws when refused, so the
 *  reader never lets a preference break the editor. */
export function readPreviewRatioTokens(
  storage: Storage | undefined,
): readonly string[] {
  if (storage === undefined) return DEFAULT_PREVIEW_RATIO_TOKENS;
  let raw: string | null;
  try {
    raw = storage.getItem(PREVIEW_RATIO_STORAGE_KEY);
  } catch {
    return DEFAULT_PREVIEW_RATIO_TOKENS;
  }
  if (raw === null) return DEFAULT_PREVIEW_RATIO_TOKENS;
  try {
    return normalisePreviewRatioTokens(JSON.parse(raw));
  } catch {
    return DEFAULT_PREVIEW_RATIO_TOKENS;
  }
}

export function writePreviewRatioTokens(
  storage: Storage | undefined,
  tokens: readonly string[],
): void {
  try {
    storage?.setItem(PREVIEW_RATIO_STORAGE_KEY, JSON.stringify(tokens));
  } catch {
    // The author's list still lives for the session; only persistence failed.
  }
}

/** Removing the key is "the defaults again", the same absence-means-default
 *  rule `palette.ts` uses. */
export function clearPreviewRatioTokens(storage: Storage | undefined): void {
  try {
    storage?.removeItem(PREVIEW_RATIO_STORAGE_KEY);
  } catch {
    // Nothing to undo: the key was never cleared, and the defaults still apply.
  }
}

export interface DisplayLens {
  readonly id: string;
  /** Width ÷ height of the display's screen. */
  readonly aspect: number;
  /** The orientation this lens is offered under. A square or circle files as
   *  landscape, per `artboardOrientation`'s "a square is not taller". */
  readonly orientation: ArtboardOrientation;
  readonly shape: PreviewShape;
}

/** A ratio derives a landscape lens, and a wide one a portrait twin as well.
 *  A square or a circle is 1:1 and does not duplicate. */
export function previewLenses(
  tokens: readonly string[],
): readonly DisplayLens[] {
  const lenses: DisplayLens[] = [];
  for (const token of tokens) {
    const ratio = parsePreviewRatio(token);
    lenses.push({
      id: ratio.id,
      aspect: ratio.width / ratio.height,
      orientation: "landscape",
      shape: ratio.shape,
    });
    if (ratio.width > ratio.height) {
      lenses.push({
        id: `${ratio.height}:${ratio.width}`,
        aspect: ratio.height / ratio.width,
        orientation: "portrait",
        shape: ratio.shape,
      });
    }
  }
  return lenses;
}

let activeTokens: readonly string[] = DEFAULT_PREVIEW_RATIO_TOKENS;
let active: readonly DisplayLens[] = previewLenses(
  DEFAULT_PREVIEW_RATIO_TOKENS,
);
let revision = 0;
const listeners = new Set<() => void>();

/** The live lenses. The **same array reference** between changes, because
 *  `useSyncExternalStore` compares snapshots. */
export function activePreviewLenses(): readonly DisplayLens[] {
  return active;
}

export function activePreviewRatioTokens(): readonly string[] {
  return activeTokens;
}

/** Written by the shell and the settings tab; replaces the list only when it
 *  actually differs, so a re-render or a repeated write does not bump the
 *  revision every consumer keys on. */
export function setActivePreviewRatios(tokens: readonly string[]): void {
  const nextTokens = normalisePreviewRatioTokens(tokens);
  const nextLenses = previewLenses(nextTokens);
  if (sameTokens(activeTokens, nextTokens) && sameLenses(active, nextLenses)) {
    return;
  }
  activeTokens = nextTokens;
  active = nextLenses;
  revision += 1;
  for (const listener of listeners) listener();
}

export function subscribeLenses(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function previewCatalogueKey(): string {
  return String(revision);
}

/** The catalogue's first landscape lens, or Fit when the catalogue is empty.
 *  Resolved from the live list rather than a module constant, because the list
 *  is the author's. */
export function defaultPreviewLens(): DisplayLens | undefined {
  return active.find((lens) => lens.orientation === "landscape");
}

export function resolveLens(id: string): DisplayLens | undefined {
  return active.find((lens) => lens.id === id);
}

/** The rect lens framing `shape`, or `undefined` — a user-managed list cannot
 *  guarantee every artboard shape a preview, so this never throws. */
export function lensMatching(shape: ArtboardShape): DisplayLens | undefined {
  let ratio: PreviewRatio;
  try {
    ratio = parsePreviewRatio(shape.ratio);
  } catch {
    return undefined;
  }
  const aspect =
    shape.orientation === "portrait"
      ? ratio.height / ratio.width
      : ratio.width / ratio.height;
  return active.find(
    (lens) =>
      lens.shape === "rect" &&
      lens.orientation === shape.orientation &&
      lens.aspect === aspect,
  );
}

interface DisplayLensGroup {
  readonly orientation: ArtboardOrientation;
  readonly lenses: readonly DisplayLens[];
}

/** The lenses by orientation, the artboard's own orientation first. A group
 *  with no lens is omitted rather than headed and empty. */
export function displayLensGroups(
  leading: ArtboardOrientation,
): readonly DisplayLensGroup[] {
  const order: readonly ArtboardOrientation[] = [
    leading,
    ...ARTBOARD_ORIENTATIONS.filter((orientation) => orientation !== leading),
  ];
  const groups: DisplayLensGroup[] = [];
  for (const orientation of order) {
    const lenses = active.filter((lens) => lens.orientation === orientation);
    if (lenses.length > 0) groups.push({ orientation, lenses });
  }
  return groups;
}

/** A box in **artboard units**, not host pixels: the camera transforms it, so
 *  the frame, its letterbox and display-bounded media move with the artwork. */
export interface LensBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The smallest rect of the lens's aspect that contains the artboard, centred.
 *  A circle lens is a disc whose bounding square is the artboard's diagonal, so
 *  the artboard's four corners lie on it. */
export function lensBox(
  lens: Pick<DisplayLens, "aspect" | "shape">,
  artboard: { readonly width: number; readonly height: number },
): LensBox {
  if (!Number.isFinite(lens.aspect) || lens.aspect <= 0) {
    throw new RangeError(
      `a display aspect must be positive and finite, not ${lens.aspect}`,
    );
  }
  if (lens.shape === "circle") {
    const side = Math.hypot(artboard.width, artboard.height);
    return {
      left: (artboard.width - side) / 2,
      top: (artboard.height - side) / 2,
      width: side,
      height: side,
    };
  }
  return lens.aspect >= artboard.width / artboard.height
    ? {
        left: (artboard.width - artboard.height * lens.aspect) / 2,
        top: 0,
        width: artboard.height * lens.aspect,
        height: artboard.height,
      }
    : {
        left: 0,
        top: (artboard.height - artboard.width / lens.aspect) / 2,
        width: artboard.width,
        height: artboard.width / lens.aspect,
      };
}

function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) {
    const remainder = x % y;
    x = y;
    y = remainder;
  }
  return x;
}

function sameTokens(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((token, index) => token === b[index]);
}

function sameLenses(
  a: readonly DisplayLens[],
  b: readonly DisplayLens[],
): boolean {
  return (
    a.length === b.length &&
    a.every((lens, index) => {
      const other = b[index];
      return (
        other !== undefined &&
        lens.id === other.id &&
        lens.aspect === other.aspect &&
        lens.orientation === other.orientation &&
        lens.shape === other.shape
      );
    })
  );
}

/**
 * A box in canvas coordinates — the frame `viewportTransform` is in — so the
 * same numbers place the on-stage frame and frame the artboard.
 */
export interface ScreenRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The largest rect of `aspect` that fits `viewport`, centred.
 *
 * The screen is sized to the window it is viewed in rather than at a fixed
 * pixel size, so the lens is the same shape at any stage size and the artboard
 * inside it is what carries the scale. Nothing here names an artboard: this is
 * the window, and the artboard is fitted into it by the camera.
 */
export function screenRect(
  viewport: { readonly width: number; readonly height: number },
  aspect: number,
): ScreenRect {
  if (!Number.isFinite(aspect) || aspect <= 0) {
    throw new RangeError(
      `a display aspect must be positive and finite, not ${aspect}`,
    );
  }
  const width = Math.min(viewport.width, viewport.height * aspect);
  const height = width / aspect;
  return {
    left: (viewport.width - width) / 2,
    top: (viewport.height - height) / 2,
    width,
    height,
  };
}
