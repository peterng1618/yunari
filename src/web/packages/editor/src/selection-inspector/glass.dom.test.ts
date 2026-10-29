// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultGaugeSettings, supportsGlass } from "@yunari/renderer-core";
import {
  Arc,
  Wedge,
  YUNARI_PAINT_PROPERTY,
  YunariChart,
} from "@yunari/scene-fabric";
import {
  ActiveSelection,
  Circle,
  Ellipse,
  FabricImage,
  Group,
  IText,
  Line,
  Path,
  Point,
  Polygon,
  Polyline,
  Rect,
  Text,
  Textbox,
  Triangle,
} from "fabric/es";
import { afterEach, describe, expect, it, vi } from "vitest";
import { glassFields, supportsGlassControl, writeGlassField } from "./glass.js";
import { idleCrop } from "./idle-crop.test-stage.js";
import { createSelectionInspector } from "./index.js";
// The shared React drivers: the converted glass and material controls are plan-1
// controls, so a raw `change` event no longer commits them.
import { click, segment, slide, valueText } from "./runs.test-stage.js";

const globals = {
  palette: {
    none: { name: "None", value: { kind: "solid", color: "transparent" } },
    panel: { name: "Panel", value: { kind: "solid", color: "#081523d9" } },
    frost: {
      name: "Frosted panel",
      value: { kind: "solid", color: "#0815234d" },
    },
  },
} as never;

// Each `setup` attaches its host so a converted control can hold focus; the body
// is emptied between cases so the hosts do not pile up.
afterEach(() => {
  document.body.replaceChildren();
});

/**
 * The kinds a published theme may carry `yunariGlass` on.
 *
 * `renderer-core` now exports the guard itself, so the control asks it rather
 * than keeping its own list. The **published schema** is that same list, and
 * `fabric-envelope-schema-sync.test.ts` fails if the two ever disagree, so the
 * schema is the independent check that the set is not silently re-spelled.
 */
interface PublishedSchema {
  readonly $defs: Record<
    string,
    Record<string, unknown> & {
      readonly properties?: Record<string, Record<string, unknown>>;
      readonly allOf?: readonly Record<string, unknown>[];
      readonly enum?: readonly string[];
    }
  >;
}

// The path is built from the string `import.meta.url` rather than from a
// `URL` object: under jsdom that object is jsdom's own class, which Node's
// `fileURLToPath` refuses as "not of scheme file".
const SCHEMA = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../../../schema/theme-document.schema.json",
    ),
    "utf8",
  ),
) as PublishedSchema;

const PUBLISHED_GLASS_TYPES: readonly string[] = (
  SCHEMA.$defs["fabricObject"]?.["allOf"]?.[0] as {
    readonly then: {
      readonly properties: { readonly type: { enum: string[] } };
    };
  }
).then.properties.type.enum;

/** The bound the schema publishes, which is the one the validator enforces. */
const PUBLISHED_BLUR_MAXIMUM = (
  SCHEMA.$defs["glassTreatment"]?.["properties"]?.["blurRadius"] as {
    readonly maximum: number;
  }
).maximum;

function setup(active: unknown) {
  const host = document.createElement("div");
  // Attached: a plan-1 control commits on blur, and jsdom fires a blur only for
  // an element that can hold focus — nothing is focusable while it is detached.
  document.body.append(host);
  const history = { saveState: vi.fn() };
  const refreshGlass = vi.fn();
  const editor = {
    canvas: {
      getActiveObject: () => active,
      getObjects: () => (active === undefined ? [] : [active]),
      requestRenderAll: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    },
    historyManager: history,
    errorManager: { warn: vi.fn(), error: vi.fn() },
    cropManager: idleCrop(),
    artboard: () => ({ width: 1920, height: 1080 }),
  };
  const inspector = createSelectionInspector(host, {
    editor: editor as never,
    globals,
    refreshGlass,
  });
  const field = <T extends HTMLElement>(selector: string): T =>
    host.querySelector<T>(selector)!;
  return { host, history, refreshGlass, editor, inspector, field };
}

function panel(): Rect {
  return new Rect({ id: "panel", left: 0, top: 0, width: 360, height: 200 });
}

/** A panel as the Add pane makes it: the card surface it hands every new shape. */
function newPanel(): Rect {
  const rect = panel();
  rect.set(YUNARI_PAINT_PROPERTY, { fill: "palette.panel" });
  rect.set("fill", "#081523d9");
  return rect;
}

/**
 * The glass switch, as the converted surface emits it: a plan-1 `ControlToggle`,
 * whose hook rides the focus target — a `role="switch"` button — rather than a
 * native checkbox. The old `HTMLInputElement` selector read a control that no
 * longer exists and would have narrowed silently.
 */
function glassControl(host: HTMLElement): HTMLElement | null {
  return host.querySelector<HTMLElement>("[data-yunari-glass-enabled]");
}

/** Whether the switch reads as on, from the state it announces. */
function glassOn(host: HTMLElement): boolean {
  return glassControl(host)?.getAttribute("aria-checked") === "true";
}

/**
 * Flips the switch to `checked`, the way a person does: `ControlToggle` commits
 * a click, not a raw `change` event, so setting `.checked` on the button (a
 * no-op) and dispatching `change` would leave the object untouched.
 */
async function setGlass(host: HTMLElement, checked: boolean): Promise<void> {
  if (glassOn(host) === checked) return;
  await click(glassControl(host)!);
}

/**
 * The accessible name a control announces: a `<label for>` where it has one, or
 * the element its `aria-labelledby` names — a slider's thumb is labelled the
 * second way (`ControlRow` renders a span, not a `for`-label, for a composite).
 */
function nameOf(host: HTMLElement, control: HTMLElement): string {
  const byFor = host
    .querySelector<HTMLLabelElement>(`label[for="${control.id}"]`)
    ?.textContent?.trim();
  if (byFor !== undefined && byFor !== "") return byFor;
  const labelledby = control.getAttribute("aria-labelledby");
  return labelledby === null
    ? ""
    : (host
        .querySelector<HTMLElement>(`[id="${labelledby}"]`)
        ?.textContent?.trim() ?? "");
}

/** The glass blur slider, re-read because a committed edit republished the view. */
function blurField(host: HTMLElement): HTMLInputElement {
  return host.querySelector<HTMLInputElement>("[data-yunari-glass-blur]")!;
}

/** The visible invalid-input line a converted number field shows, when one is. */
function invalidLine(host: HTMLElement): Element | null {
  return host.querySelector("[id$='-invalid']");
}

/** A live object of every kind the editor can have selected. */
const LIVE_KIND: Readonly<Record<string, () => unknown>> = {
  Rect: () => panel(),
  Circle: () => new Circle({ left: 0, top: 0, radius: 20 }),
  Ellipse: () => new Ellipse({ left: 0, top: 0, rx: 20, ry: 12 }),
  Triangle: () => new Triangle({ left: 0, top: 0, width: 40, height: 40 }),
  Polygon: () =>
    new Polygon([new Point(0, -20), new Point(20, 20), new Point(-20, 20)]),
  // A sector is a region, so the backdrop can be sampled through it exactly as
  // through a disc. Its open counterpart, `Arc`, is deliberately absent: there
  // is no interior to sample, which is the same reason `Polyline` is.
  Wedge: () =>
    new Wedge({ left: 0, top: 0, radius: 20, startAngle: 0, endAngle: 90 }),
  Polyline: () =>
    new Polyline([new Point(0, 0), new Point(20, 20), new Point(40, 0)]),
  Line: () => new Line([0, 0, 20, 20]),
  Path: () => new Path("M 0 0 L 20 20 L 40 0"),
  Arc: () =>
    new Arc({ left: 0, top: 0, radius: 20, startAngle: 0, endAngle: 90 }),
  Group: () => new Group([new Rect({ width: 40, height: 40 })]),
  ActiveSelection: () => new ActiveSelection([panel(), panel()]),
  Textbox: () => new Textbox("Hi", { left: 0, top: 0, width: 40 }),
  Text: () => new Text("Hi", { left: 0, top: 0 }),
  IText: () => new IText("Hi", { left: 0, top: 0 }),
  Image: () => new FabricImage("", { left: 0, top: 0, width: 40, height: 40 }),
  YunariChart: () =>
    new YunariChart({
      id: "chart",
      family: "gauge",
      width: 100,
      height: 100,
      settings: defaultGaugeSettings,
    }),
};

/**
 * The kinds the treatment reaches, and the kinds it does not — **the owner's
 * own answers**, over every kind the editor can have selected, so a kind added
 * here joins the right case without anyone remembering to list it.
 *
 * `FROSTABLE` and `UNFROSTABLE` stay, and stay hand-kept: they are the
 * independent witness that the predicate still answers for the kinds this file
 * thought about, and the guard below is what fails if the two ever part.
 */
const FROSTABLE_KINDS: readonly string[] = Object.keys(LIVE_KIND).filter(
  (kind) => supportsGlassControl(LIVE_KIND[kind]!() as never),
);
const UNFROSTABLE_KINDS: readonly string[] = Object.keys(LIVE_KIND).filter(
  (kind) => !supportsGlassControl(LIVE_KIND[kind]!() as never),
);

/** The kinds the treatment reaches, which is the owner's answer, not a list. */
const FROSTABLE: readonly string[] = [
  "Rect",
  "Circle",
  "Ellipse",
  "Triangle",
  "Polygon",
  "Wedge",
];

/**
 * The kinds a selection can be in that the treatment cannot reach, each one
 * here because it is a shape the editor really does offer a selection of.
 */
const UNFROSTABLE: readonly string[] = [
  "Polyline",
  "Path",
  "Line",
  "Arc",
  "Textbox",
  "YunariChart",
];

describe("the glass control in the selection inspector", () => {
  it("offers frosted glass with a blur radius, both named", async () => {
    const { host } = setup(panel());
    const enabled = glassControl(host)!;
    // Non-vacuous: the selection really is a rectangle, so a gate that refused
    // everything cannot satisfy the control assertions below.
    expect(panel()).toBeInstanceOf(Rect);
    expect(enabled.tagName).toBe("BUTTON");
    expect(enabled.getAttribute("role")).toBe("switch");
    expect(host.querySelector("[data-yunari-glass-blur]")).toBeNull();

    await setGlass(host, true);

    const blur = blurField(host);
    // The blur is a bounded number, so it is a slider — the same
    // affordance the pre-plan field drew.
    expect(blur.type).toBe("range");
    for (const selector of [
      "[data-yunari-glass-enabled]",
      "[data-yunari-glass-blur]",
    ]) {
      const control = host.querySelector<HTMLElement>(selector)!;
      expect(nameOf(host, control), selector).toBeTruthy();
    }
  });

  it("writes the treatment and tells the glass lifecycle when it is enabled", async () => {
    const rect = panel();
    const { history, refreshGlass, host } = setup(rect);

    await setGlass(host, true);

    // The authored property is the only place a radius exists.
    expect(rect.get("yunariGlass")).toEqual({
      blurRadius: expect.any(Number),
    });
    // Nothing re-resolves the glass lifecycle on its own, so the control is
    // what has to ask; without this call the blur never appears on screen.
    expect(refreshGlass).toHaveBeenCalledTimes(1);
    expect(history.saveState).toHaveBeenCalledTimes(1);
  });

  it("removes the treatment when the author turns it off", async () => {
    const rect = panel();
    rect.set("yunariGlass", { blurRadius: 12 });
    const { history, refreshGlass, host } = setup(rect);

    expect(host.querySelector("[data-yunari-glass-blur]")).not.toBeNull();

    await setGlass(host, false);

    expect(rect.get("yunariGlass")).toBeUndefined();
    expect(refreshGlass).toHaveBeenCalledTimes(1);
    expect(history.saveState).toHaveBeenCalledTimes(1);
    // A radius box over a panel with no treatment accepts an edit and applies
    // none, so it goes with the treatment.
    expect(host.querySelector("[data-yunari-glass-blur]")).toBeNull();
  });

  it("reads back the radius an author already set", () => {
    const rect = panel();
    rect.set("yunariGlass", { blurRadius: 24 });
    const { host } = setup(rect);

    expect(blurField(host).value).toBe("24");
  });

  it("offers the sampling beside the blur, whatever the background is", () => {
    const rect = panel();
    rect.set("yunariGlass", { blurRadius: 24 });
    const { host } = setup(rect);

    const segments = [...host.querySelectorAll("[data-yunari-glass-sampling]")];
    expect(segments.map((segment) => segment.textContent)).toEqual([
      "Dynamic",
      "Static",
    ]);
  });

  it("flips the sampling to static on the panel it is attached to", async () => {
    const rect = panel();
    rect.set("yunariGlass", { blurRadius: 24 });
    const { history, refreshGlass, host } = setup(rect);

    await segment(host, "data-yunari-glass-sampling", "Static");

    expect(rect.get("yunariGlass")).toEqual({
      blurRadius: 24,
      sampling: "static",
    });
    expect(refreshGlass).toHaveBeenCalledTimes(1);
    expect(history.saveState).toHaveBeenCalledTimes(1);
  });

  it("offers the blur as a slider bounded by the published maximum", () => {
    const rect = panel();
    rect.set("yunariGlass", { blurRadius: 24 });
    const { host } = setup(rect);
    const blur = blurField(host);

    // A bounded number is the design's slider, and the pre-plan field drew
    // one because both bounds were present. The maximum is the owner's constant,
    // asked of `renderer-core` rather than restated, and the well reads the
    // value back.
    expect(blur.type).toBe("range");
    expect(blur.getAttribute("min")).toBe("0");
    expect(blur.getAttribute("max")).toBe(String(PUBLISHED_BLUR_MAXIMUM));
    expect(blur.value).toBe("24");
  });

  it("moves the blur radius and refreshes the composite", async () => {
    const rect = panel();
    rect.set("yunariGlass", { blurRadius: 8 });
    const { history, refreshGlass, host } = setup(rect);

    // One keyboard step: jsdom has no layout, so a pointer drag ends on no
    // value at all (see `slide`), and a step is the gesture that reaches a
    // commit here.
    await slide(blurField(host), "ArrowRight");

    expect(rect.get("yunariGlass")).toEqual({ blurRadius: 9 });
    expect(refreshGlass).toHaveBeenCalledTimes(1);
    expect(history.saveState).toHaveBeenCalledTimes(1);
  });

  it("lands on the published maximum when the author sweeps to the end", async () => {
    const bound = PUBLISHED_BLUR_MAXIMUM;
    const rect = panel();
    rect.set("yunariGlass", { blurRadius: 12 });
    const { history, host } = setup(rect);

    await slide(blurField(host), "End");

    // The finding was "took me a while to figure out blur only accepts 48
    // maximum": the ceiling is the control's own bound, so the slider stops
    // there and the well reads the landed value — a bound the author can reach
    // is what teaches it. The writer lands the value on the owner's own
    // `MAX_GLASS_BLUR_RADIUS` too, for a bypassed commit.
    expect(rect.get("yunariGlass")).toEqual({ blurRadius: bound });
    expect(history.saveState).toHaveBeenCalled();
    expect(blurField(host).value).toBe(String(bound));
  });

  it("lands on zero when the author sweeps to the start", async () => {
    const rect = panel();
    rect.set("yunariGlass", { blurRadius: 12 });
    const { history, host } = setup(rect);

    await slide(blurField(host), "Home");

    expect(rect.get("yunariGlass")).toEqual({ blurRadius: 0 });
    expect(history.saveState).toHaveBeenCalled();
    expect(blurField(host).value).toBe("0");
  });

  it("disconnects a glass control when the selection moves under it", () => {
    const first = panel();
    first.set("yunariGlass", { blurRadius: 12 });
    const { host, history, editor, inspector } = setup(first);
    const blur = blurField(host);
    const second = panel();
    second.set("id", "second");
    (editor.canvas as { getActiveObject: () => unknown }).getActiveObject =
      () => second;

    // The republish a real selection change fires. React keys each row by the
    // revision it was projected from, so the control bound to `first` is
    // unmounted and an edit from it cannot reach the object the panel now
    // describes. Reporting "that value cannot be applied" would blame the
    // author's number for a selection change, which is the one thing here that
    // is not the number's fault — so nothing is reported either.
    inspector.render();

    expect(first.get("yunariGlass")).toEqual({ blurRadius: 12 });
    expect(history.saveState).not.toHaveBeenCalled();
    expect(editor.errorManager.warn).not.toHaveBeenCalled();
    expect(blur.isConnected).toBe(false);
  });

  it("refuses a glass edit for an object the panel no longer describes", () => {
    const first = panel();
    const { host, history, refreshGlass, editor, inspector } = setup(first);
    const enabled = glassControl(host)!;
    const second = panel();
    second.set("id", "second");
    (editor.canvas as { getActiveObject: () => unknown }).getActiveObject =
      () => second;

    inspector.render();

    expect(first.get("yunariGlass")).toBeUndefined();
    expect(history.saveState).not.toHaveBeenCalled();
    expect(refreshGlass).not.toHaveBeenCalled();
    expect(enabled.isConnected).toBe(false);
  });

  it("offers no glass section on a subject that cannot carry it, and takes nothing else with it", () => {
    // `vg-465`: the section is **withheld** from a kind the treatment cannot
    // reach, which reverses `vg-006` — and no reason is printed for it either:
    // the subject's inability is a fact about its kind, not a question the
    // column has to answer. The fields the editor does serve stay untouched.
    const text = new Textbox("Hi", { left: 0, top: 0, width: 40 });
    const { host } = setup(text);

    expect(glassControl(host)).toBeNull();
    expect(host.querySelector("[data-yunari-glass-refusal]")).toBeNull();
    expect(host.querySelector("[data-yunari-opacity]")).not.toBeNull();
    expect(host.querySelector("[data-yunari-subject-name]")).not.toBeNull();
  });

  it.each(FROSTABLE)("offers the control enabled on a %s", (kind) => {
    const make = LIVE_KIND[kind];
    expect(typeof make, `${kind} has no live object`).toBe("function");
    if (make === undefined) return;
    const { host } = setup(make());

    const control = glassControl(host);
    expect(control, kind).not.toBeNull();
    expect(control?.getAttribute("aria-disabled"), kind).toBeNull();
    expect(control?.hasAttribute("disabled"), kind).toBe(false);
    expect(control?.getAttribute("aria-checked"), kind).toBe("false");
    // A kind that can carry the treatment is never refused it.
    expect(host.querySelector("[data-yunari-glass-refusal]"), kind).toBeNull();
  });

  it.each(UNFROSTABLE_KINDS)(
    "withholds the control from a %s, and offers no explanation",
    (kind) => {
      const make = LIVE_KIND[kind];
      expect(typeof make, `${kind} has no live object`).toBe("function");
      if (make === undefined) return;
      const { host } = setup(make());

      expect(glassControl(host), kind).toBeNull();
      // The absence itself is the answer; a sentence for every unsupported
      // kind was noise beside the subject, so nothing is printed for it.
      expect(
        host.querySelector("[data-yunari-glass-refusal]"),
        kind,
      ).toBeNull();
    },
  );

  it("withholds the treatment the section is gone from, and warns nobody about it", async () => {
    // Two claims, because the button's absence and the write's refusal are
    // different facts: the panel no longer offers the edit, and the boundary
    // still refuses it — a bypassed write must not land a treatment the
    // renderer would never composite.
    const line = new Line([0, 0, 20, 20]);
    const { history, refreshGlass, editor, host } = setup(line);

    expect(glassControl(host)).toBeNull();
    // No alert line: the author did nothing wrong, so the editor's own decision
    // is not reported as their error.
    expect(editor.errorManager.warn).not.toHaveBeenCalled();
    expect(invalidLine(host)).toBeNull();

    // The boundary, asked directly: `glass.ts`'s own writer is what a bypassed
    // control would reach, and it refuses.
    const wrote = writeGlassField(
      line,
      { editor: editor as never, globals },
      "glass-enabled",
      true,
    );

    expect(wrote).toBe(false);
    expect(line.get("yunariGlass")).toBeUndefined();
    expect(history.saveState).not.toHaveBeenCalled();
    expect(refreshGlass).not.toHaveBeenCalled();
  });

  it("offers a rect its material fields and a group none", () => {
    const rect = panel();
    const { host } = setup(rect);
    for (const hook of [
      "[data-yunari-panel-fill]",
      "[data-yunari-panel-stroke]",
      "[data-yunari-panel-border]",
      "[data-yunari-panel-shadow]",
    ]) {
      expect(host.querySelector(hook), hook).not.toBeNull();
    }

    // A group has no own fill, border or radius — Fabric gives it nothing to
    // paint with — so it is offered none of the material fields, and a control
    // that accepted an edit and applied none is not shown.
    const group = new Group([new Rect({ width: 40, height: 40 })]);
    const absence = setup(group).host;
    for (const hook of [
      "[data-yunari-panel-fill]",
      "[data-yunari-panel-stroke]",
      "[data-yunari-panel-border]",
      "[data-yunari-panel-radius]",
      "[data-yunari-panel-shadow]",
    ]) {
      expect(absence.querySelector(hook), hook).toBeNull();
    }
    // And no Paint section stands over the group at all: the glass row was the
    // only thing left in it, and a section whose whole body is one refusal is
    // not a question a group is asked (`vg-465`).
    expect(absence.querySelector('[data-yunari-section="paint"]')).toBeNull();
    expect(absence.querySelector("[data-yunari-glass-refusal]")).toBeNull();
  });

  it("withholds glass from a locked object, which the editor refuses to write", () => {
    const rect = panel();
    rect.set("locked", true);
    const { host } = setup(rect);

    expect(host.querySelector("[data-yunari-glass-enabled]")).toBeNull();
    expect(host.querySelector("[data-yunari-panel-fill]")).toBeNull();
  });

  it("gives a new card the frosted surface, not the opaque one", async () => {
    // The control named for glass did not carry it. A card the author frosted
    // kept `panel` at 85 % — opaque enough that the blur beneath it is a blur of
    // nothing, so the card read as a tint over a smooth gradient and the
    // photograph behind it was one select away in a control called "Fill".
    const rect = newPanel();
    const { history, refreshGlass, host } = setup(rect);

    await setGlass(host, true);

    expect(rect.get(YUNARI_PAINT_PROPERTY)).toEqual({
      fill: "palette.frost",
    });
    // Resolved, not only referenced: a reference nothing re-resolves would leave
    // the card painted in the colour it had a frame earlier.
    expect(rect.get("fill")).toBe("#0815234d");
    // The treatment and the surface are one edit, so one undo takes both back.
    expect(history.saveState).toHaveBeenCalledTimes(1);
    expect(refreshGlass).toHaveBeenCalledTimes(1);
  });

  it("shows the frosted surface in the fill picker, not only on the canvas", async () => {
    const { host } = setup(newPanel());

    await setGlass(host, true);

    // The picker shows the token's own name, so the author reads the same word
    // the palette panel does rather than a raw reference.
    expect(valueText(host, "data-yunari-panel-fill")).toBe("Frosted panel");
  });

  it("leaves a fill the author chose, because glass is not the author", async () => {
    // The other half of the rule: a token the author picked in the Fill picker
    // is a choice, and a treatment layered over it must not overwrite it. There
    // is no record of which hand set a reference, so the current card default is
    // the only honest test for "a default" — and anything else is left alone.
    const rect = newPanel();
    rect.set(YUNARI_PAINT_PROPERTY, { fill: "palette.none" });
    const { history, host } = setup(rect);

    await setGlass(host, true);

    expect(rect.get("yunariGlass")).toEqual({
      blurRadius: expect.any(Number),
    });
    expect(rect.get(YUNARI_PAINT_PROPERTY)).toEqual({ fill: "palette.none" });
    expect(history.saveState).toHaveBeenCalledTimes(1);
  });

  it("leaves a card that already carries the frosted surface alone", async () => {
    const rect = newPanel();
    rect.set(YUNARI_PAINT_PROPERTY, { fill: "palette.frost" });
    const { host } = setup(rect);

    await setGlass(host, true);

    expect(rect.get(YUNARI_PAINT_PROPERTY)).toEqual({ fill: "palette.frost" });
  });

  it("does not put a surface on a shape the treatment cannot reach", async () => {
    // A group is in the owner's set and the renderer still refuses it: Fabric
    // overrides `Group.drawObject`, so a group never fires `before:render` and
    // `scene-fabric/src/glass.ts` refuses the treatment at attach. Enabling it
    // here would take an edit that paints nothing, so no control is offered for
    // it — and the write that a bypassed one would reach still refuses.
    const group = new Group([new Rect({ width: 40, height: 40 })]);
    const { history, refreshGlass, editor, host } = setup(group);

    expect(glassControl(host)).toBeNull();

    const wrote = writeGlassField(
      group,
      { editor: editor as never, globals },
      "glass-enabled",
      true,
    );

    expect(wrote).toBe(false);
    expect(group.get("yunariGlass")).toBeUndefined();
    expect(group.get(YUNARI_PAINT_PROPERTY)).toBeUndefined();
    expect(history.saveState).not.toHaveBeenCalled();
    expect(refreshGlass).not.toHaveBeenCalled();
  });

  it("agrees with the owner's guard for every kind Fabric ships", () => {
    /**
     * The regression test for the second owner. `fed6dc3` spelled the set out
     * as an `instanceof` chain, which agrees with `GLASS_OBJECT_TYPES` only
     * until someone adds a kind there — and then a shape is frostable in a
     * theme and un-authorable in the inspector, with no error anywhere. The
     * predicate now asks, so this is the guard that has to notice if it stops.
     */
    const disagrees: string[] = [];
    for (const [kind, make] of Object.entries(LIVE_KIND)) {
      if (supportsGlassControl(make() as never) !== supportsGlass(kind))
        disagrees.push(kind);
    }

    // `Group` alone, and named: it is the one kind the owner admits that this
    // renderer cannot composite. Listing the disagreement rather than excluding
    // it is what keeps it from being the first kind quietly left out of the
    // next widening.
    expect(disagrees).toEqual(["Group"]);

    // And the two hand-kept lists below are the independent witness: the cases
    // are driven from the predicate's own answers, so these are what fail if it
    // silently starts answering for a kind this file thought about.
    expect(
      FROSTABLE.filter((kind) => !FROSTABLE_KINDS.includes(kind)),
      "the hand-kept frostable kinds",
    ).toEqual([]);
    expect(
      UNFROSTABLE.filter((kind) => !UNFROSTABLE_KINDS.includes(kind)),
      "the hand-kept unfrostable kinds",
    ).toEqual([]);
  });

  it("has a live object for every kind the published schema allows", () => {
    for (const type of PUBLISHED_GLASS_TYPES)
      expect(typeof LIVE_KIND[type], `${type} has no live object`).toBe(
        "function",
      );
  });

  it("offers the control exactly for the kinds the renderer can frost", () => {
    for (const type of PUBLISHED_GLASS_TYPES) {
      const make = LIVE_KIND[type];
      // Named first: a kind added to the vocabulary with no live object here
      // has no authoring decision either, and must not pass silently.
      expect(
        typeof make,
        `${type} is in the published schema with no live object`,
      ).toBe("function");
      if (make === undefined) continue;

      const object = make() as never;
      const { host } = setup(make());
      expect(glassControl(host) !== null, type).toBe(
        supportsGlassControl(object),
      );
      // A withheld control is the whole answer: no sentence is printed for it.
      expect(
        host.querySelector("[data-yunari-glass-refusal]"),
        type,
      ).toBeNull();
    }
  });
});

describe("glass sampling", () => {
  const samplingOf = (object: Rect) =>
    glassFields(object).find((field) => field.id === "glass-sampling");

  it("offers the sampling beside the blur, defaulting to dynamic", () => {
    const rect = new Rect({
      width: 40,
      height: 40,
      yunariGlass: { blurRadius: 8 },
    });
    expect(samplingOf(rect)).toMatchObject({
      control: "segmented",
      value: "dynamic",
      options: [
        { id: "dynamic", name: "Dynamic" },
        { id: "static", name: "Static" },
      ],
    });
  });

  it("writes the chosen sampling and keeps the radius", () => {
    const rect = new Rect({
      width: 40,
      height: 40,
      yunariGlass: { blurRadius: 8 },
    });
    // The context is only read when the treatment is enabled, so it is absent.
    const context = undefined as never;
    expect(writeGlassField(rect, context, "glass-sampling", "static")).toBe(
      true,
    );
    expect(rect.get("yunariGlass")).toEqual({
      blurRadius: 8,
      sampling: "static",
    });
    expect(samplingOf(rect)).toMatchObject({ value: "static" });

    // Only the two names are a sampling.
    expect(writeGlassField(rect, context, "glass-sampling", "live")).toBe(
      false,
    );
    expect(samplingOf(rect)).toMatchObject({ value: "static" });
  });
});
