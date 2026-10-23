// @vitest-environment jsdom

/**
 * The icon-ink rule, proved on pixels rather than on a property name.
 *
 * vg-092: an author set Fill on `storage-card-icon` and the icon flooded into a
 * solid slab. The counters that flooded are not a hole the path data declares —
 * `starterIcons.storage` carries one closed subpath (the drive body) and no
 * second, so the whole interior is one region under *any* fill rule. The proof
 * is therefore that a counter stays background after the author picks a colour,
 * and that a path which does declare a region still fills.
 *
 * Coordinates are the icon's rendered pixels, not its path units: Fabric places
 * a `Path` by its bounding box (33.33 × 26.67 at `storage(40)`), so path
 * `(x, y)` lands at `(x, y - 6.67)`. The divider centreline is path y = 12.01,
 * which is rendered y = 13.
 */

import { Path, StaticCanvas } from "fabric/es";
import { afterEach, describe, expect, it, vi } from "vitest";
import { starterIcons } from "../new-fabric-theme-icons.js";
import { createNewShape } from "../new-object-defaults.js";
import { idleCrop } from "./idle-crop.test-stage.js";
import { createSelectionInspector, type SelectionInspector } from "./index.js";
// The panel fill is a plan-1 `ControlSwatch` now, not a native `<select>`: a raw
// `change` event on the element no longer commits it.
import { choose } from "./runs.test-stage.js";

const INK = "#ecf5ff";
const globals = {
  palette: {
    panel: { name: "Panel", value: { kind: "solid", color: "#1a1f2b" } },
    text: { name: "Text", value: { kind: "solid", color: INK } },
  },
} as never;

/** The starter's storage icon, as the card authors it: stroked, and unfilled. */
function storageIcon(fill: string | null): Path {
  return new Path(
    starterIcons
      .storage(40)
      .map((command) => [command[0], ...command.slice(1)]) as never,
    {
      id: "storage-card-icon",
      left: 0,
      top: 0,
      fill,
      stroke: "#8fa3c8",
      strokeWidth: 3.3,
      strokeLineCap: "round",
      strokeLineJoin: "round",
    },
  );
}

/**
 * A real `StaticCanvas` over a real 2D context, so the pixels are Fabric's and
 * not a property readback. jsdom hands over node-canvas, which rasterises.
 */
function stageWith(object: Path, size = 80) {
  const canvas = new StaticCanvas(undefined, {
    width: size,
    height: size,
    backgroundColor: "#00000000",
  });
  canvas.add(object);

  const host = document.createElement("div");
  // Attached: a plan-1 select portals its list and commits only a real
  // interaction, and none of that reaches an element outside the document.
  document.body.append(host);
  live = createSelectionInspector(host, {
    editor: {
      canvas: {
        getActiveObject: () => object,
        getObjects: () => [object],
        requestRenderAll: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      },
      historyManager: { saveState: vi.fn() },
      errorManager: { warn: vi.fn(), error: vi.fn() },
      cropManager: idleCrop(),
    } as never,
    globals,
    refreshGlass: vi.fn(),
  });

  return {
    canvas,
    host,
    field: <T extends HTMLElement>(selector: string): T =>
      host.querySelector<T>(selector)!,
  };
}

/** The alpha of one rendered pixel; 0 is untouched background. */
function alphaAt(canvas: StaticCanvas, x: number, y: number): number {
  return canvas.getContext().getImageData(x, y, 1, 1).data[3] ?? 0;
}

// Each `stageWith` attaches its host so a converted control can open its list;
// the body is emptied between cases so the hosts do not pile up. The root is
// unmounted first: a portal is removed against the container it was opened in,
// and a container wiped before React closes it makes the removal throw.
let live: SelectionInspector | undefined;
afterEach(() => {
  live?.destroy();
  live = undefined;
  document.body.replaceChildren();
});

/** Inside the drive body, above the divider: the counter that flooded. */
const COUNTER: readonly [number, number] = [13, 7];
/** On the divider centreline, which the stroke draws. */
const INK_LINE: readonly [number, number] = [13, 13];

describe("an icon's counters survive a paint chosen from the panel", () => {
  it("leaves the space inside the drive body unpainted", async () => {
    const icon = storageIcon(null);
    const { canvas, host } = stageWith(icon);

    await choose(host, "data-yunari-panel-fill", "Text");
    canvas.renderAll();

    expect(alphaAt(canvas, ...COUNTER)).toBe(0);
    // The icon is still an icon: the divider is still ink.
    expect(alphaAt(canvas, ...INK_LINE)).toBeGreaterThan(0);
    // And the colour reached the object somewhere — a green test needs the
    // paint applied, not merely refused everywhere.
    expect(icon.stroke).toBe(INK);
  });

  it("names the control for what it paints on a stroked path", () => {
    const { host, field } = stageWith(storageIcon(null));
    const control = field<HTMLElement>("[data-yunari-panel-fill]");
    const label =
      host.querySelector<HTMLLabelElement>(`label[for="${control.id}"]`)
        ?.textContent ?? control.closest("label")?.textContent;

    // "Fill" was the wrong word: there is no region here to fill.
    expect(label).toBe("Ink");
    // One control on the stroke, not two.
    expect(host.querySelector("[data-yunari-panel-stroke]")).toBeNull();
  });

  it("still floods a path that declares the region it encloses", async () => {
    // The product's own "insert a path" default, which arrives filled.
    const arrow = createNewShape("shape", globals, "path", {
      left: 0,
      top: 0,
    }) as Path;
    expect(arrow.fill).not.toBe("");

    const { canvas, host } = stageWith(arrow, 400);
    const control = host.querySelector<HTMLElement>("[data-yunari-panel-fill]");
    const label =
      host.querySelector<HTMLLabelElement>(`label[for="${control?.id}"]`)
        ?.textContent ?? control?.closest("label")?.textContent;

    await choose(host, "data-yunari-panel-fill", "Text");
    canvas.renderAll();

    expect(label).toBe("Fill");
    expect(arrow.fill).toBe(INK);
    // The arrowhead's interior (path 240,100 → rendered 240,50), which a fill
    // is supposed to cover.
    expect(alphaAt(canvas, 240, 50)).toBeGreaterThan(0);
  });
});

describe("why a fill rule was not the fix", () => {
  it("leaves the storage icon flooded under `evenodd` as well", () => {
    // The counters are not declared as a hole: the drive body is one closed
    // subpath and the divider is an open centreline only the stroke draws, so
    // there is nothing for `evenodd` to alternate against. This is the case
    // that rules the mechanism out, kept executable so it cannot come back.
    for (const fillRule of ["nonzero", "evenodd"] as const) {
      const icon = storageIcon(INK);
      icon.set("fillRule", fillRule);
      const { canvas } = stageWith(icon);
      canvas.renderAll();

      expect(alphaAt(canvas, ...COUNTER), fillRule).toBeGreaterThan(0);
    }
  });
});
