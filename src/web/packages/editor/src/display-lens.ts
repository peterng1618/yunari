import type { ArtboardShape } from "@yunari/renderer-core";
import {
  type ArtboardOrientation,
  artboardOrientation,
} from "@yunari/theme-kit";

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

/** A plain decimal edge: digits, optionally a fractional part. */
const DECIMAL_EDGE = /^\d+(?:\.\d+)?$/;

/** A ratio's id, kept as the author typed it. `21:9` is the name people
 *  recognise, so it is never reduced to `7:3`: an equivalent shape is refused
 *  by `previewRatioKey` instead, because renaming what was entered is the one
 *  thing the catalogue must not do. */
export function parsePreviewRatio(input: string): PreviewRatio {
  const text = input.trim();
  if (text.toLowerCase() === "circle") {
    return { id: "Circle", width: 1, height: 1, shape: "circle" };
  }

  const parts = text.split(":");
  if (parts.length !== 2) {
    throw new RangeError(`a preview ratio is W:H, not ${input}`);
  }
  const rawWidth = parts[0]?.trim();
  const rawHeight = parts[1]?.trim();
  // A plain decimal on each side: `Number` alone would quietly read `0x10`,
  // `1e2` and `+16` as ratios nobody typed.
  if (
    rawWidth === undefined ||
    rawHeight === undefined ||
    !DECIMAL_EDGE.test(rawWidth) ||
    !DECIMAL_EDGE.test(rawHeight)
  ) {
    throw new RangeError(`a preview ratio is W:H, not ${input}`);
  }
  const width = Number(rawWidth);
  const height = Number(rawHeight);
  // The regex admits an arbitrarily long digit string, which `Number` turns
  // into `Infinity`; a non-finite edge is no more a ratio than a negative one.
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new RangeError(`preview ratio edges must be positive, not ${input}`);
  }

  return { id: `${rawWidth}:${rawHeight}`, width, height, shape: "rect" };
}

/** The long-over-short aspect two spellings of one rect share, so `21:9` and
 *  `7:3` collide and `16:9` and `9:16` do too. Meaningful for a rect ratio
 *  only: a circle is a disc rather than a rect of equal edges, so a caller
 *  never compares its key with a rect's. */
export function previewRatioKey(ratio: PreviewRatio): number {
  return (
    Math.max(ratio.width, ratio.height) / Math.min(ratio.width, ratio.height)
  );
}

/** The stored list as the tokens that can be parsed, first equivalent token
 *  winning. Equivalence is a rect's aspect; `Circle` only collides with
 *  `Circle`, because a disc and a 1:1 rect are different pictures.
 *  Anything unreadable is not an author choice, so it becomes the defaults. */
export function normalisePreviewRatioTokens(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return DEFAULT_PREVIEW_RATIO_TOKENS;

  const tokens: string[] = [];
  const seenIds = new Set<string>();
  const seenKeys = new Set<number>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    let ratio: PreviewRatio;
    try {
      ratio = parsePreviewRatio(entry);
    } catch {
      continue;
    }
    if (seenIds.has(ratio.id)) continue;
    if (ratio.shape === "rect") {
      const key = previewRatioKey(ratio);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
    }
    seenIds.add(ratio.id);
    tokens.push(ratio.id);
  }
  return tokens;
}

/** A preview ratio's place in the one fixed order: landscape, square, portrait.
 *  A disc is square regardless of the edges `parsePreviewRatio` stores for it. */
function ratioGroup(ratio: PreviewRatio): DisplayLensGroupKind {
  if (ratio.shape === "circle") return "square";
  const aspect = ratio.width / ratio.height;
  return aspect > 1 ? "landscape" : aspect === 1 ? "square" : "portrait";
}

const GROUP_ORDER: readonly DisplayLensGroupKind[] = [
  "landscape",
  "square",
  "portrait",
];

/** The list as the preview settings draw it: landscape widest first, then 1:1
 *  and Circle, then portrait near square first. The display menu does not use
 *  this — it groups the derived lenses itself — so the stored order, and with
 *  it the default lens, is unaffected by a hand edit here. */
export function sortPreviewTokens(
  tokens: readonly string[],
): readonly string[] {
  return tokens
    .map((token) => ({ token, ratio: parsePreviewRatio(token) }))
    .sort((a, b) => {
      const group =
        GROUP_ORDER.indexOf(ratioGroup(a.ratio)) -
        GROUP_ORDER.indexOf(ratioGroup(b.ratio));
      if (group !== 0) return group;
      const aspect =
        b.ratio.width / b.ratio.height - a.ratio.width / a.ratio.height;
      if (aspect !== 0) return aspect;
      return a.token < b.token ? -1 : a.token > b.token ? 1 : 0;
    })
    .map(({ token }) => token);
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

/** Writes the list, and answers whether it will survive the reload.
 *
 *  A store that exists but refuses the write (a full quota, a browser policy)
 *  is the same outcome as no store at all: the list lives for the session
 *  only, and the surface that wrote it says so rather than letting the tab's
 *  other state claim a persistence that did not happen. */
export function writePreviewRatioTokens(
  storage: Storage | undefined,
  tokens: readonly string[],
): boolean {
  if (storage === undefined) return false;
  try {
    storage.setItem(PREVIEW_RATIO_STORAGE_KEY, JSON.stringify(tokens));
    return true;
  } catch {
    return false;
  }
}

/** Removing the key is "the defaults again", the same absence-means-default
 *  rule `palette.ts` uses. */
export function clearPreviewRatioTokens(storage: Storage | undefined): boolean {
  if (storage === undefined) return false;
  try {
    storage.removeItem(PREVIEW_RATIO_STORAGE_KEY);
    return true;
  } catch {
    // Nothing to undo: the key was never cleared, and the defaults still apply
    // for the session — but a reload would read the key that survived.
    return false;
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

/** A token at least as wide as it is tall derives a landscape lens, plus a
 *  portrait twin when it is strictly wider. A taller-than-wide token is already
 *  a portrait spelling and derives only itself. Derived ids are deduped, first
 *  occurrence wins, so `16:9` and `9:16` together emit `9:16` once. */
export function previewLenses(
  tokens: readonly string[],
): readonly DisplayLens[] {
  const lenses: DisplayLens[] = [];
  const seen = new Set<string>();
  const add = (lens: DisplayLens): void => {
    if (seen.has(lens.id)) return;
    seen.add(lens.id);
    lenses.push(lens);
  };
  for (const token of tokens) {
    const ratio = parsePreviewRatio(token);
    if (ratio.width < ratio.height) {
      add({
        id: ratio.id,
        aspect: ratio.width / ratio.height,
        orientation: "portrait",
        shape: ratio.shape,
      });
      continue;
    }
    add({
      id: ratio.id,
      aspect: ratio.width / ratio.height,
      orientation: "landscape",
      shape: ratio.shape,
    });
    if (ratio.width > ratio.height) {
      add({
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
let active: readonly DisplayLens[] = previewLenses(activeTokens);
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

export function resolveLens(id: string): DisplayLens | undefined {
  return active.find((lens) => lens.id === id);
}

/**
 * The catalogue lens whose aspect is closest to the artboard's, in log space so
 * a ratio and its reciprocal sit the same distance from their own orientation.
 *
 * A circle theme sees circle lenses and a rect theme sees rect lenses: a disc
 * and a 1:1 rect are different pictures, so a theme is never framed through the
 * other shape. The live list is the author's and may hold no matching lens, so
 * this answers `undefined` — Fit — rather than throwing.
 */
export function nearestPreviewLens(artboard: {
  readonly width: number;
  readonly height: number;
  readonly shape?: ArtboardShape;
}): DisplayLens | undefined {
  if (!(artboard.width > 0) || !(artboard.height > 0)) return undefined;
  const shape: PreviewShape = artboard.shape === "circle" ? "circle" : "rect";
  const aspect = artboard.width / artboard.height;
  let best: DisplayLens | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const lens of active) {
    if (lens.shape !== shape) continue;
    const distance = Math.abs(Math.log(lens.aspect / aspect));
    if (distance < bestDistance) {
      best = lens;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The catalogue lens that frames this artboard exactly, or `undefined` when no
 * stored ratio expresses it.
 *
 * Exactness is the aspect, not the token's spelling: `16:10` and `8:5` are one
 * frame, and a portrait artboard is framed by the landscape token it is the
 * turned twin of. A circle artboard matches `Circle` and no rect, for the
 * reason `nearestPreviewLens` gives — a disc is not a 1:1 rect.
 */
export function matchingPreviewLens(size: {
  readonly width: number;
  readonly height: number;
  readonly shape?: ArtboardShape;
}): DisplayLens | undefined {
  if (!(size.width > 0) || !(size.height > 0)) return undefined;
  const shape: PreviewShape = size.shape === "circle" ? "circle" : "rect";
  const key = longOverShort(size.width, size.height);
  const matches: DisplayLens[] = [];
  for (const lens of active) {
    if (lens.shape !== shape) continue;
    if (shape === "rect") {
      if (Math.abs(longOverShort(lens.aspect, 1) - key) > key * 1e-9) continue;
    }
    matches.push(lens);
  }
  // A ratio and its turned twin share an aspect, so the catalogue offers both.
  // The one that names this board the way up it is drawn wins.
  const orientation = artboardOrientation(size);
  return matches.find((lens) => lens.orientation === orientation) ?? matches[0];
}

/** The `W:H` token the catalogue would spell this artboard with, in lowest
 *  terms so a 1920 × 1080 board is offered as `16:9` rather than as its
 *  resolution. A circle's ratio is the disc, which the catalogue spells
 *  `Circle`. */
export function previewRatioTokenFor(size: {
  readonly width: number;
  readonly height: number;
  readonly shape?: ArtboardShape;
}): string {
  if (size.shape === "circle") return "Circle";
  const width = Math.round(size.width);
  const height = Math.round(size.height);
  const divisor = greatestCommonDivisor(width, height);
  return `${width / divisor}:${height / divisor}`;
}

/** Why an add did or did not reach the catalogue, so a surface can word the
 *  refusal instead of guessing from a boolean. */
export type PreviewRatioAddResult =
  | { readonly kind: "added"; readonly persisted: boolean }
  | { readonly kind: "duplicate" }
  | {
      readonly kind: "equivalent";
      readonly entered: string;
      readonly existing: string;
    }
  | { readonly kind: "invalid" };

/** The stored spelling of a rect token: long edge first, so one token derives
 *  both orientations in `previewLenses`. A circle is its own picture. */
function wideRatioId(ratio: PreviewRatio): string {
  if (ratio.shape === "circle" || ratio.width >= ratio.height) return ratio.id;

  const [width = "", height = ""] = ratio.id.split(":");
  return `${height}:${width}`;
}

/**
 * Adds a ratio the catalogue does not already express and makes it live. The
 * one add path, so the settings page and a new document cannot refuse or pair
 * differently: parse, canonicalise a rect to its wide spelling, refuse a
 * duplicate or an equivalent aspect, then write the store before the live list
 * (a refused store still leaves this session's list changed).
 */
export function addPreviewRatioToken(
  token: string,
  storage: Storage | undefined,
): PreviewRatioAddResult {
  let ratio: PreviewRatio;
  try {
    ratio = parsePreviewRatio(token);
  } catch (error) {
    // The parser's only refusal is a `RangeError`; anything else is a defect.
    if (!(error instanceof RangeError)) throw error;
    return { kind: "invalid" };
  }

  const id = wideRatioId(ratio);
  if (activeTokens.some((entry) => parsePreviewRatio(entry).id === id)) {
    return { kind: "duplicate" };
  }

  const equivalent =
    ratio.shape === "rect"
      ? activeTokens.find((entry) => {
          const existing = parsePreviewRatio(entry);
          return (
            existing.shape === "rect" &&
            previewRatioKey(existing) === previewRatioKey(ratio)
          );
        })
      : undefined;
  if (equivalent !== undefined) {
    return { kind: "equivalent", entered: ratio.id, existing: equivalent };
  }

  const next = sortPreviewTokens([...activeTokens, id]);
  const persisted = writePreviewRatioTokens(storage, next);
  setActivePreviewRatios(next);
  return { kind: "added", persisted };
}

/** Long over short, the one form that ignores which way up a rect sits. */
function longOverShort(a: number, b: number): number {
  return Math.max(a, b) / Math.min(a, b);
}

function greatestCommonDivisor(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y > 0) {
    const rest = x % y;
    x = y;
    y = rest;
  }
  return x === 0 ? 1 : x;
}

export type DisplayLensGroupKind = "landscape" | "square" | "portrait";
interface DisplayLensGroup {
  readonly kind: DisplayLensGroupKind;
  readonly lenses: readonly DisplayLens[];
}

/** The group a lens is listed under. A square rect and a disc share the 1:1
 *  group: their bounding boxes differ but their aspect does not. */
function groupOfLens(lens: DisplayLens): DisplayLensGroupKind {
  if (lens.shape === "circle" || lens.aspect === 1) return "square";
  return lens.aspect > 1 ? "landscape" : "portrait";
}

/** The lenses in the one fixed order — landscape widest first, then 1:1 and
 *  Circle, then portrait near square first — rather than led by the artboard.
 *  Within a group the widest comes first in both directions, which is what
 *  puts `4:3` ahead of `9:16` in the portrait half. A group with no lens is
 *  omitted rather than headed and empty. */
export function displayLensGroups(): readonly DisplayLensGroup[] {
  const groups: DisplayLensGroup[] = [];
  for (const kind of GROUP_ORDER) {
    const lenses = active
      .filter((lens) => groupOfLens(lens) === kind)
      .sort(
        (a, b) =>
          b.aspect - a.aspect || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
    if (lenses.length > 0) groups.push({ kind, lenses });
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
