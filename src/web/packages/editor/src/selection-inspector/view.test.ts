// @vitest-environment jsdom
import type { FabricGlobals } from "@yunari/renderer-core";
import { MAX_OBJECT_NAME_LENGTH } from "@yunari/renderer-core";
import { ActiveSelection, Rect } from "fabric/es";
import { describe, expect, it } from "vitest";
import {
  type ChartFieldTarget,
  chartContentView,
  chartPaintView,
} from "../chart-manager/panel.js";
import { projectLayers } from "../editor-shell/layer-tree.js";
import { uiCopy } from "../ui-copy.js";
import {
  type ColumnSectionView,
  type ExtraView,
  editRefusal,
  type ProjectionPorts,
  projectSelection,
  readField,
} from "./view.js";

/**
 * The projection is a value: the whole of [ADR-0039] is that React holds this
 * and never a Fabric object. A JSON round-trip is one check and not the guard —
 * it cannot tell a Fabric object from a plain one that happens to serialise — so
 * the walk below rejects by prototype, and rejects a function, a DOM node and a
 * non-finite number where it finds them.
 */

const globals = {
  palette: {
    ink: { name: "Ink", value: { kind: "solid", color: "#e8ecf3" } },
  },
  typePresets: {
    body: { name: "Body", value: { family: "Inter", size: 16, weight: "600" } },
  },
} as unknown as FabricGlobals;

/** The read context the column already takes, with the real read halves of the
    geometry port rather than a stand-in. */
function ports(overrides: Partial<ProjectionPorts> = {}): ProjectionPorts {
  return {
    globals,
    locale: undefined,
    nodeBindings: undefined,
    sampleSource: undefined,
    geometry: { read: readField },
    ...overrides,
  };
}

/** Every leaf is a primitive, an array or a plain object — nothing else. */
function assertPlainValue(value: unknown, path: string): void {
  if (value === undefined || value === null) return;
  const kind = typeof value;
  if (kind === "string" || kind === "boolean") return;
  if (kind === "number") {
    expect(Number.isFinite(value), `${path} is a finite number`).toBe(true);
    return;
  }
  expect(kind, `${path} is not a ${kind}`).not.toBe("function");
  expect(value, `${path} is not a DOM node`).not.toBeInstanceOf(Node);
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertPlainValue(entry, `${path}[${index}]`),
    );
    return;
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  // A Fabric object is the failure this catches: its prototype is its class.
  expect(
    prototype === Object.prototype,
    `${path} is a plain object (saw ${prototype?.constructor?.name ?? "null"})`,
  ).toBe(true);
  for (const [key, child] of Object.entries(value)) {
    assertPlainValue(child, `${path}.${key}`);
  }
}

/** A shape carrying an authored name — the first arm of the name chain. */
function namedRect(name: string): Rect {
  const rect = new Rect({ id: "shape", width: 10, height: 10 });
  rect.set("name", name);
  return rect;
}

/** A chart the projection can be asked about, and the two arms it crosses as. */
const CHART: ChartFieldTarget = {
  id: "cpu-gauge",
  content: {
    family: "gauge",
    settings: {
      startAngle: 90,
      endAngle: -270,
      min: 0,
      max: 100,
      thickness: 10,
      track: { ref: "palette.ink" },
      progress: { ref: "palette.ink" },
      roundCap: true,
      segmentDivisor: 100,
    },
  },
  bindings: [{ id: "b1", semanticKey: "cpu.load" }],
};

const CHART_EXTRAS: readonly ExtraView[] = [
  { kind: "chartContent", content: chartContentView(CHART) },
  { kind: "chartPaint", paint: chartPaintView(CHART, undefined) },
];

/** A section holding the given extras, as the column hands one to the view. */
function chartSection(extras: readonly ExtraView[]): ColumnSectionView {
  return {
    id: "content",
    title: "Content",
    defaultOpen: true,
    count: extras.length,
    fields: [],
    extras,
  };
}

describe("projectSelection", () => {
  it("carries no Fabric object, DOM node, function or non-finite number", () => {
    const rect = new Rect({
      id: "shape",
      left: 0,
      top: 0,
      width: 40,
      height: 20,
    });
    const view = projectSelection(rect, 1, ports());

    assertPlainValue(view, "view");
    // Round-tripped without an undefined-valued key to drop, so the two agree
    // field for field — a function or a node would not have survived.
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });

  it("carries a section as a value, and rejects the element the old body slot held", () => {
    // No section is handed in as an element any more, so the walk is proved
    // non-vacuous on the sections arm by planting one: a DOM node inside a
    // `ColumnSectionView` is what Review Focus 1's walk rejects, and that is the
    // failure the deleted `body` slot used to be able to produce.
    const rect = new Rect({ id: "shape", width: 10, height: 10 });
    const section: ColumnSectionView = {
      id: "content",
      title: "Content",
      defaultOpen: true,
      count: 1,
      fields: [],
      extras: [],
    };
    const view = projectSelection(rect, 1, ports(), [section]);

    expect(view.sections).toHaveLength(1);
    expect(view.sections[0]?.count).toBe(1);
    assertPlainValue(view, "view");

    const planted = {
      ...view,
      sections: [{ ...section, body: [document.createElement("div")] }],
    };
    expect(() => assertPlainValue(planted, "view")).toThrow(/DOM node/);
  });

  it("walks a chart's own field arms, and rejects a Fabric object planted in one", () => {
    // A chart crosses as `chartContent`/`chartPaint` payloads — the arms this
    // suite gave values to. Walking a view whose `extras` is empty proves
    // nothing about them, so the fixture projects a real chart and the walk
    // reaches inside both arms.
    const rect = new Rect({ id: "shape", width: 10, height: 10 });
    const view = projectSelection(rect, 1, ports(), [
      chartSection(CHART_EXTRAS),
    ]);

    assertPlainValue(view, "view");

    // And the walk is not vacuous on those arms: a Fabric object smuggled into
    // one is what the guard exists to catch (ADR-0039), so it must throw.
    const planted = chartSection([
      {
        kind: "chartContent",
        content: {
          ...chartContentView(CHART),
          content: new Rect({ id: "leak" }),
        },
      } as unknown as ExtraView,
    ]);
    const dirty = projectSelection(rect, 1, ports(), [planted]);
    expect(() => assertPlainValue(dirty, "view")).toThrow(/plain object/);
  });

  it("is empty when nothing is selected", () => {
    const view = projectSelection(undefined, 0, ports());

    expect(view.subject).toBeUndefined();
    expect(view.sections).toHaveLength(0);
    expect(view.locked).toBe(false);
    expect(view.targetRevision).toBe(0);
    // Undefined is valid state but JSON omits it; the round-trip must not gain a
    // `subject` key, and raw equality is not the proof for that reason.
    expect("subject" in JSON.parse(JSON.stringify(view))).toBe(false);
  });

  it("names the subject exactly as the layer row names the same object", () => {
    // The agreement is the test, not a copy of the rule: whatever the tree
    // prints for an object's own row is what the column must print for it, so a
    // second copy of the fallback chain cannot drift back in. Every arm the
    // chain has is covered, the blank-id one included — the case the two copies
    // disagreed about before they shared an owner.
    const cases: readonly [string, Rect][] = [
      ["Header panel", namedRect("Header panel")],
      ["cpu-card", new Rect({ id: "cpu-card", width: 10, height: 10 })],
      [
        uiCopy.panels.layerKinds.shape,
        new Rect({ id: "   ", width: 10, height: 10 }),
      ],
      ["unidentified", new Rect({ width: 10, height: 10 })],
    ];
    for (const [expected, object] of cases) {
      const row = projectLayers({
        root: [object],
        selected: [],
        expanded: new Set(),
      })[0];
      expect(row?.name, `layer row names ${expected}`).toBe(expected);
      expect(projectSelection(object, 1, ports()).subject?.name).toBe(
        row?.name,
      );
    }
  });

  it("carries the kind, and the key a binding carries", () => {
    const rect = new Rect({ id: "shape", width: 10, height: 10 });
    const kind = projectSelection(rect, 1, ports()).subject?.kind;
    expect(kind).toBe("shape");

    const bound = projectSelection(
      rect,
      1,
      ports({
        nodeBindings: () => [{ id: "b1", semanticKey: "cpu.load" }],
      }),
    ).subject?.key;
    expect(bound).toBe("cpu.load");
    // Unbound is a state, not a missing read: the header draws no key line for
    // it rather than a line saying nothing.
    expect(projectSelection(rect, 1, ports()).subject?.key).toBeUndefined();
  });

  it("gives a multi-selection its own kind, which has no layer kind's glyph", () => {
    // `SubjectView.kind` is `selectionKindOf`'s answer, not a `LayerKind`: the
    // header narrows the one member the per-kind glyph map does not hold, so the
    // union has to cross the boundary whole.
    const multi = new ActiveSelection([namedRect("a"), namedRect("b")]);
    expect(projectSelection(multi, 1, ports()).subject?.kind).toBe(
      "activeSelection",
    );
  });

  it("reports the lock on the subject", () => {
    const rect = new Rect({ id: "shape", width: 10, height: 10 });
    rect.set("locked", true);

    expect(projectSelection(rect, 3, ports()).locked).toBe(true);
    expect(projectSelection(rect, 3, ports()).targetRevision).toBe(3);
  });
});

/**
 * The guard in front of the write funnel. It is a pure decision so it can be
 * driven without a React control: the dispatcher consults the same function at
 * call time, and a control that outlived its selection is refused here rather
 * than writing through a funnel that would resolve the *current* target.
 */
describe("editRefusal", () => {
  const live = { targetRevision: 4, locked: false };
  const edit = (
    overrides: Partial<{
      expectedRevision: number;
      fieldId: string;
      value: string | number | boolean;
    }> = {},
  ) => ({ expectedRevision: 4, fieldId: "left", value: 5, ...overrides });

  it("lets a current, writable, finite edit through", () => {
    expect(editRefusal(edit(), live)).toBeUndefined();
  });

  it("refuses an edit projected from another revision", () => {
    // The failure this exists for: a field's draft outlives its selection, so
    // its revision no longer matches the live target's.
    expect(editRefusal(edit({ expectedRevision: 3 }), live)).toBe("stale");
  });

  it("refuses a write to a locked object", () => {
    expect(editRefusal(edit(), { ...live, locked: true })).toBe("locked");
  });

  it("refuses a field the dispatcher cannot write", () => {
    expect(editRefusal(edit({ fieldId: "chart-fill" }), live)).toBe("unknown");
  });

  it("refuses a name past the published bound, and takes one that is not", () => {
    // The name is writable, so it is a value rule rather than an unknown field:
    // a blank one clears the key, and one the envelope would refuse on import
    // is refused here rather than stored.
    expect(editRefusal(edit({ fieldId: "name", value: "Header" }), live)).toBe(
      undefined,
    );
    expect(editRefusal(edit({ fieldId: "name", value: "   " }), live)).toBe(
      undefined,
    );
    expect(
      editRefusal(
        edit({
          fieldId: "name",
          value: "x".repeat(MAX_OBJECT_NAME_LENGTH + 1),
        }),
        live,
      ),
    ).toBe("invalid");
    expect(editRefusal(edit({ fieldId: "name", value: 12 }), live)).toBe(
      "invalid",
    );
  });

  it("refuses a value that is not a finite number rather than coercing it", () => {
    expect(editRefusal(edit({ value: Number.NaN }), live)).toBe("invalid");
    expect(editRefusal(edit({ value: "12" }), live)).toBe("invalid");
  });

  it("refuses a fractional geometry value at the boundary, whatever the control let through", () => {
    // Every geometry field the Position section converts refused a fraction
    // pre-plan — the old `numberField` demanded `Number.isInteger` — and the
    // control's own refusal is a convenience: this is the copy that must hold.
    // A fraction is refused, not rounded: authoring a fraction is a different
    // act from *displaying* a dimension a drag left fractional.
    expect(editRefusal(edit({ fieldId: "angle", value: 45.5 }), live)).toBe(
      "invalid",
    );
    expect(editRefusal(edit({ fieldId: "angle", value: 45 }), live)).toBe(
      undefined,
    );
    for (const fieldId of ["left", "top", "width", "height"]) {
      expect(editRefusal(edit({ fieldId, value: 45.5 }), live), fieldId).toBe(
        "invalid",
      );
      expect(editRefusal(edit({ fieldId, value: 45 }), live), fieldId).toBe(
        undefined,
      );
    }
    // Opacity is the one field that is not geometry: a fraction is its normal
    // value, so it is unchanged.
    expect(editRefusal(edit({ fieldId: "opacity", value: 45.5 }), live)).toBe(
      undefined,
    );
  });

  it("refuses a fractional Paint number at the boundary too", () => {
    // The same rule the geometry fields carry. The panel's border, radius and
    // both shadow numbers, and the glass blur, all refused a fraction before
    // their fields were converted; `ControlNumber`'s `integer` flag restates it
    // for the author, and this is the copy the write funnel depends on.
    for (const fieldId of [
      "panel-border",
      "panel-radius",
      "panel-shadow-blur",
      "panel-shadow-offset",
      "glass-blur",
    ]) {
      expect(editRefusal(edit({ fieldId, value: 4.5 }), live), fieldId).toBe(
        "invalid",
      );
      expect(editRefusal(edit({ fieldId, value: 4 }), live), fieldId).toBe(
        undefined,
      );
    }
  });

  it("takes a palette reference, or the empty a cleared picker writes, and nothing else", () => {
    // Paint references: a token id, or the `""` a cleared picker writes. The
    // writer resolves one through the palette owner; a value that is not one is
    // refused here rather than handed to a resolver that would take it for
    // nothing.
    for (const fieldId of ["panel-fill", "panel-stroke", "panel-shadow"]) {
      expect(
        editRefusal(edit({ fieldId, value: "palette.text" }), live),
        fieldId,
      ).toBeUndefined();
      expect(editRefusal(edit({ fieldId, value: "" }), live), fieldId).toBe(
        undefined,
      );
      expect(
        editRefusal(edit({ fieldId, value: "#ecf5ff" }), live),
        fieldId,
      ).toBe("invalid");
      expect(editRefusal(edit({ fieldId, value: 12 }), live), fieldId).toBe(
        "invalid",
      );
    }
    // The glass switch is a boolean, not a reference.
    expect(
      editRefusal(edit({ fieldId: "glass-enabled", value: true }), live),
    ).toBeUndefined();
    expect(
      editRefusal(edit({ fieldId: "glass-enabled", value: "yes" }), live),
    ).toBe("invalid");
  });

  it("reports a stale draft ahead of the lock it would also fail", () => {
    // Precedence is part of the contract: the newer selection is the reason the
    // draft is wrong, so that is what a caller is told.
    expect(
      editRefusal(edit({ expectedRevision: 3 }), { ...live, locked: true }),
    ).toBe("stale");
  });
});
