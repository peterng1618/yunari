/**
 * The store gallery's packing: rows of one height, widths following each
 * theme's own ratio.
 *
 * **A row is scaled as a whole.** Items are collected until their natural
 * widths at the target height pass the container; the row then takes whichever
 * of "drop the last item and grow the rest" or "keep the last item and shrink
 * the row" lands nearer the target height. Every kept row is scaled to the
 * container's width exactly, so it is flush at both edges. The final row is
 * never grown: it keeps the target height and is short on the right.
 *
 * The gutter is part of the sum, so a row's cards and gaps together equal the
 * container rather than leaving a hidden remainder.
 */
export interface GalleryRowItem<T> {
  readonly item: T;
  /** The card's width in the same unit as the container. */
  readonly width: number;
}

export interface GalleryRow<T> {
  readonly items: readonly GalleryRowItem<T>[];
  /** The picture height every card in the row shares. */
  readonly height: number;
  /** Whether the row keeps the target height and stops short of the container
   *  rather than being scaled to fill it. Only a final row whose cards fit at
   *  the target can be short. */
  readonly short: boolean;
}

export interface JustifiedRowsInput<T> {
  readonly items: readonly T[];
  /** The authored width/height of one item; a non-positive or non-finite value
   *  is refused to the caller's fallback rather than scaling a row by zero. */
  readonly ratioOf: (item: T) => number;
  /** The container's content width. */
  readonly width: number;
  /** The height one card aims for; the row scales away from it only as far as
   *  the width demands. */
  readonly targetHeight: number;
  readonly gap: number;
}

/** Builds the rows; see the module comment for the rule. */
export function justifiedRows<T>(
  input: JustifiedRowsInput<T>,
): readonly GalleryRow<T>[] {
  const total = input.items.length;
  if (total === 0) return [];

  const width = Number.isFinite(input.width) ? input.width : 0;
  const target = Math.max(1, input.targetHeight);
  const gap = Math.max(0, input.gap);
  const ratioOf = (index: number): number => {
    const ratio = input.ratioOf(input.items[index]!);
    return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  };

  // A container with no width to divide (first paint, a hidden pane) puts one
  // card per row at its natural size rather than collapsing every row to zero.
  if (width <= 0) {
    return input.items.map((item, index) => ({
      items: [
        {
          item,
          width: Math.max(1, Math.round(target * ratioOf(index))),
        },
      ],
      height: target,
      short: true,
    }));
  }

  const rows: GalleryRow<T>[] = [];
  let index = 0;

  while (index < total) {
    // The longest prefix whose natural width still fits.
    let fitted = 0;
    let natural = 0;
    while (index + fitted < total) {
      const next = target * ratioOf(index + fitted);
      const withGap = natural + (fitted === 0 ? 0 : gap) + next;
      if (fitted > 0 && withGap > width) break;
      natural = withGap;
      fitted += 1;
    }

    const fitHeight = heightAt(width, natural, target);
    const overflowHeight =
      index + fitted < total
        ? heightAt(
            width,
            natural + gap + target * ratioOf(index + fitted),
            target,
          )
        : undefined;

    // The last row is never grown: only a too-wide tail is shrunk to fit.
    const last = index + fitted >= total;
    const count = last
      ? fitted
      : pickCount(fitted, fitHeight, overflowHeight, target);
    const isTail = index + count >= total;

    const naturalWidth = naturalWidthOf(count, index, target, gap, ratioOf);
    // The tail keeps the target height only when its cards fit at it; a tail
    // that overflows is shrunk to the container like any other row.
    const ragged = isTail && naturalWidth <= width;
    const rawHeight = isTail
      ? Math.min(target, heightAt(width, naturalWidth, target))
      : heightAt(width, naturalWidth, target);

    const widths = widthsOf(count, index, rawHeight, gap, ratioOf);
    const fixed = Math.round(width);
    const used =
      widths.reduce((sum, value) => sum + value, 0) + gap * (count - 1);
    // The row's last card absorbs the rounding remainder, so the row lands on
    // the container's edge rather than a fraction short of it. The ragged tail
    // keeps its own width and stays short on purpose.
    if (!ragged && widths.length > 0) {
      widths[widths.length - 1] = Math.max(
        1,
        widths[widths.length - 1]! + (fixed - Math.round(used)),
      );
    }

    rows.push({
      items: widths.map((cardWidth, offset) => ({
        item: input.items[index + offset]!,
        width: cardWidth,
      })),
      height: rawHeight,
      short: ragged,
    });
    index += count;
  }

  return rows;
}

/** The height a row of `natural` width reaches when scaled to the container. */
function heightAt(width: number, natural: number, target: number): number {
  if (!(natural > 0)) return target;
  return (target * width) / natural;
}

/** Which of the fitted row and the row plus its overflowing item is nearer the
 *  target height. */
function pickCount(
  fitted: number,
  fitHeight: number,
  overflowHeight: number | undefined,
  target: number,
): number {
  if (overflowHeight === undefined) return fitted;
  const fitDistance = Math.abs(fitHeight - target);
  const overflowDistance = Math.abs(overflowHeight - target);
  return overflowDistance <= fitDistance ? fitted + 1 : fitted;
}

function naturalWidthOf(
  count: number,
  start: number,
  target: number,
  gap: number,
  ratioOf: (index: number) => number,
): number {
  let sum = 0;
  for (let offset = 0; offset < count; offset += 1) {
    sum += target * ratioOf(start + offset);
    if (offset > 0) sum += gap;
  }
  return sum;
}

/** Whole-pixel widths at `height`; the caller adjusts the final card. */
function widthsOf(
  count: number,
  start: number,
  height: number,
  gap: number,
  ratioOf: (index: number) => number,
): number[] {
  const widths: number[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    widths.push(Math.max(1, Math.round(height * ratioOf(start + offset))));
  }
  return widths;
}
