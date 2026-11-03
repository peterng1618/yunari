import { describe, expect, it } from "vitest";
import { justifiedRows } from "./justified-rows.js";

interface Item {
  readonly id: string;
  readonly ratio: number;
}

const item = (id: string, ratio: number): Item => ({ id, ratio });

function rows(items: readonly Item[], width = 1000, targetHeight = 272) {
  return justifiedRows({
    items,
    ratioOf: (entry) => entry.ratio,
    width,
    targetHeight,
    gap: 12,
  });
}

/** A row's cards and gutters together, at the width it was scaled to. */
function rowWidth(row: { items: readonly { width: number }[] }): number {
  return (
    row.items.reduce((sum, card) => sum + card.width, 0) +
    12 * (row.items.length - 1)
  );
}

describe("justifiedRows", () => {
  it("answers nothing for no items", () => {
    expect(rows([])).toEqual([]);
  });

  it("leaves the final row at the target height, short on the right", () => {
    const [row] = rows([item("a", 1), item("b", 1), item("c", 1)]);
    expect(row?.height).toBe(272);
    expect(row && rowWidth(row)).toBe(840);
    expect(row?.short, "the fitting tail is not marked short").toBe(true);
  });

  it("scales a full row until it lands on the container edge", () => {
    // Three 16:9 cards: two fit at the target height, and adding the third
    // would shrink the row further than growing the pair would stretch it, so
    // the row keeps two and the third starts the tail.
    const laid = rows(
      [item("a", 1.67), item("b", 1.67), item("c", 1.67)],
      1000,
    );
    expect(laid).toHaveLength(2);
    const first = laid[0]!;
    expect(rowWidth(first), "the row is flush").toBe(1000);
    expect(first.height).toBeGreaterThan(272);
    expect(first.height).toBeLessThan(330);
    expect(laid[1]?.items.map((card) => card.item.id)).toEqual(["c"]);
    expect(laid[1]?.height, "the tail keeps the target").toBe(272);
  });

  it("keeps a wide theme in a row that lands nearer the target", () => {
    // Square + 16:9 fit; the 4:1 item only fits if the row shrinks, and that is
    // closer to the target than growing the pair to more than twice it.
    const laid = rows(
      [item("square", 1), item("wide16", 1.67), item("wide4", 4.16)],
      1690,
    );
    expect(laid).toHaveLength(1);
    expect(laid[0]?.items.map((card) => card.item.id)).toEqual([
      "square",
      "wide16",
      "wide4",
    ]);
    expect(rowWidth(laid[0]!)).toBe(1690);
    expect(laid[0]?.height).toBeLessThan(272);
    expect(laid[0]?.items.at(-1)?.width).toBeGreaterThan(900);
  });

  it("shrinks a lone ultra-wide card to the container", () => {
    const [row] = rows([item("strip", 8)], 1000);
    expect(row?.height).toBe(125);
    expect(rowWidth(row!)).toBe(1000);
  });

  it("treats a broken ratio as square rather than scaling by zero", () => {
    const [row] = rows([item("broken", Number.NaN)], 1000);
    expect(row?.items[0]?.width).toBe(272);
  });

  it("puts one card per row when the container has no width yet", () => {
    const laid = rows([item("a", 1.67), item("b", 1)], 0);
    expect(laid.map((row) => row.height)).toEqual([272, 272]);
    expect(laid[0]?.items[0]?.width).toBe(Math.round(272 * 1.67));
  });
});
