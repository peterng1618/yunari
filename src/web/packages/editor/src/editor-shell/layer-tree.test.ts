// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultGaugeSettings,
  defaultLineSettings,
} from "@yunari/renderer-core";
import { Arc, reviveThemeEnvelope, YunariChart } from "@yunari/scene-fabric";
import {
  Ellipse,
  FabricImage,
  type FabricObject,
  Group,
  Line,
  Rect,
  StaticCanvas,
  Textbox,
  util,
} from "fabric/es";
import { describe, expect, it } from "vitest";
import { CARD_LIBRARY, instantiateCard } from "../card-library.js";
import { createNewFabricTheme } from "../new-fabric-theme.js";
import { uiCopy } from "../ui-copy.js";
import {
  BACKGROUND_LAYER_ID,
  backgroundRow,
  findById,
  type LayerKind,
  type LayerRole,
  ownerOf,
  pathTo,
  projectLayers,
} from "./layer-tree.js";

/** Nothing is open: the default an author meets, and the state a flat scene is
 * permanently in. A group with children is shut unless it is named here. */
const base = { expanded: new Set<string>(), selected: [] } as const;

/** The same projection with the named groups opened. */
const opened = (...ids: string[]) => ({
  ...base,
  expanded: new Set(ids),
});

describe("layer projection", () => {
  it("lists top-most first, matching paint order reversed", () => {
    const bottom = new Rect({ id: "bottom", width: 10, height: 10 });
    const top = new Rect({ id: "top", width: 10, height: 10 });
    const rows = projectLayers({ ...base, root: [bottom, top] });
    expect(rows.map((row) => row.id)).toEqual(["top", "bottom"]);
  });

  it("indents group children and marks the group as having children", () => {
    const child = new Textbox("hi", { id: "child" });
    // Group's constructor is typed to Partial<GroupProps>, which carries no id.
    const group = new Group([child]);
    group.set("id", "group");
    const rows = projectLayers({ ...opened("group"), root: [group] });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: "group",
      depth: 0,
      hasChildren: true,
      kind: "group",
    });
    expect(rows[1]).toMatchObject({
      id: "child",
      depth: 1,
      parentId: "group",
      kind: "text",
    });
  });

  it("starts a group shut, and shows only the group until it is opened", () => {
    // The default an author meets. The starter's eight cards are fifty objects
    // that would otherwise open as sixty rows, which is the noise the panel is
    // being changed to remove — and it is a default rather than stored state
    // (§67), so nothing records "shut" anywhere.
    const group = new Group([new Rect({ id: "child", width: 10, height: 10 })]);
    group.set("id", "group");
    const rows = projectLayers({ ...base, root: [group] });
    expect(rows.map((row) => row.id)).toEqual(["group"]);
    expect(rows[0]).toMatchObject({ collapsed: true, hasChildren: true });
    // And opening it is the whole of the change.
    expect(
      projectLayers({ ...opened("group"), root: [group] }).map((row) => row.id),
    ).toEqual(["group", "child"]);
  });

  it("reports a group with nothing in it as neither shut nor open", () => {
    // There is nothing to open, so a twisty offering to open it would be a lie
    // — and the panel draws one for any row claiming `hasChildren`.
    const empty = new Group([]);
    empty.set("id", "empty");
    const rows = projectLayers({ ...base, root: [empty] });
    expect(rows[0]).toMatchObject({ hasChildren: false, collapsed: false });
  });

  it("takes visibility and lock from the whole ancestor path", () => {
    const child = new Rect({ id: "child", width: 10, height: 10 });
    const group = new Group([child], { visible: false });
    group.set("id", "group");
    // Fabric has no `locked` prop, so it is set the way the lock manager does.
    group.set("locked", true);
    const rows = projectLayers({ ...opened("group"), root: [group] });
    // The child's own flags are both false; its row must still report the
    // group's state, so this fails if either read stops walking the path.
    expect(child.visible).toBe(true);
    expect((child as { locked?: boolean }).locked).toBeUndefined();
    expect(rows[1]).toMatchObject({
      id: "child",
      visible: false,
      locked: true,
    });
  });

  it("reads a hidden group's children as hidden, however deep they sit", () => {
    // Depth 2 rather than 1, and with the intermediate group shut: a walk that
    // stopped at the first shut group would have nothing to read, and one that
    // checked only the immediate parent would call this visible.
    const leaf = new Rect({ id: "leaf", width: 10, height: 10 });
    const inner = new Group([leaf]);
    inner.set("id", "inner");
    const outer = new Group([inner], { visible: false });
    outer.set("id", "outer");
    const rows = projectLayers({
      ...opened("outer", "inner"),
      root: [outer],
    });
    expect(rows.find((row) => row.id === "leaf")).toMatchObject({
      depth: 2,
      parentId: "inner",
      visible: false,
    });
  });

  it("reports an empty group as having no children", () => {
    const empty = new Group([]);
    empty.set("id", "empty");
    const rows = projectLayers({ ...base, root: [empty] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "empty",
      kind: "group",
      hasChildren: false,
    });
  });

  it("marks the row whose object is selected, resolving a child through its group", () => {
    const group = new Group([new Rect({ id: "child", width: 10, height: 10 })]);
    group.set("id", "group");
    const rows = projectLayers({
      ...opened("group"),
      root: [group],
      selected: [group],
    });
    expect(rows.find((row) => row.id === "group")?.selected).toBe(true);
    expect(rows.find((row) => row.id === "child")?.selected).toBe(false);
  });

  it("prefers the object's own display name over the id", () => {
    const rect = new Rect({
      id: "header",
      width: 10,
      height: 10,
      name: "Header rule",
    });
    const rows = projectLayers({ ...base, root: [rect] });
    expect(rows[0]?.name).toBe("Header rule");
  });

  it("keeps the id as the row's key when the object is named", () => {
    // The name is a label; the id is what every bridge command targets and
    // what bindings reference, so naming must not move either.
    const rect = new Rect({
      id: "header",
      width: 10,
      height: 10,
      name: "Header rule",
    });
    const rows = projectLayers({ ...base, root: [rect] });
    expect(rows[0]?.id).toBe("header");
    expect(findById([rect], rows[0]!.id)).toBe(rect);
  });

  it("falls back to the id for an object authored before the field", () => {
    // The backward-compatibility contract: a scene with no name on the object
    // still opens and still shows something an author can recognise.
    const rect = new Rect({ id: "header", width: 10, height: 10 });
    const rows = projectLayers({ ...base, root: [rect] });
    expect(rows[0]?.name).toBe("header");
  });

  it("does not crash on an object with no id", () => {
    const rows = projectLayers({
      ...base,
      root: [new Rect({ width: 10, height: 10 })],
    });
    expect(rows[0]?.id).toBe("unidentified");
    expect(rows[0]?.name).toBe("unidentified");
  });

  it("gives each id-less object its own row id", () => {
    const rows = projectLayers({
      ...base,
      root: [
        new Rect({ width: 10, height: 10 }),
        new Rect({ width: 10, height: 10 }),
      ],
    });
    expect(rows.map((row) => row.id)).toEqual([
      "unidentified",
      "unidentified#2",
    ]);
    expect(rows[0]?.name).toBe("unidentified");
  });

  it("lists nothing a save would drop, so editor scaffolding is not a row", () => {
    // The shape vg-125 measured: the crop frame a mid-crop session draws over
    // the image carries no id, so before the filter it was a row literally named
    // `unidentified`, and `findById("unidentified")` resolved to it — an author
    // could rename the crop frame and have it vanish on cancel.
    const image = new Rect({ id: "image-1", width: 10, height: 10 });
    const frame = new Rect({ width: 10, height: 10, excludeFromExport: true });
    const rows = projectLayers({ ...base, root: [image, frame] });
    expect(rows.map((row) => row.id)).toEqual(["image-1"]);
    // Every walk agrees, so the id the panel drew resolves to the object it drew.
    expect(findById([image, frame], rows[0]!.id)).toBe(image);
    // And it does not consume a fallback id, or the numbering the projection
    // hands out would disagree with the numbering `findById` counts by.
    expect(findById([image, frame], "unidentified")).toBeUndefined();
  });

  it("skips an excluded object nested inside a listed group", () => {
    const member = new Rect({ id: "member", width: 10, height: 10 });
    const excluded = new Rect({
      width: 10,
      height: 10,
      excludeFromExport: true,
    });
    const group = new Group([member, excluded]);
    group.set("id", "group");
    const rows = projectLayers({ ...opened("group"), root: [group] });
    expect(rows.map((row) => row.id)).toEqual(["group", "member"]);
    expect(findById([group], "member")).toBe(member);
    expect(pathTo([group], "member")).toHaveLength(2);
    expect(ownerOf([group], "member")).toBe(group);
  });

  it("falls back to the kind when neither the name nor the id is usable", () => {
    // Whitespace counts as unusable: a blank row tells the author nothing.
    const rect = new Rect({ id: "   ", width: 10, height: 10, name: "  " });
    const rows = projectLayers({ ...base, root: [rect] });
    expect(rows[0]?.name).toBe("Shape");
  });

  it("keeps the id when only the name is blank", () => {
    const rect = new Rect({ id: "header", width: 10, height: 10, name: "   " });
    const rows = projectLayers({ ...base, root: [rect] });
    expect(rows[0]?.name).toBe("header");
  });

  it("reports collapse on the group itself, not on the children it hides", () => {
    const child = new Rect({ id: "child", width: 10, height: 10 });
    const group = new Group([child]);
    group.set("id", "group");
    const rows = projectLayers({ ...base, root: [group] });
    expect(rows[0]?.collapsed).toBe(true);
    expect(rows[0]?.hasChildren).toBe(true);
  });
});

describe("the kind, read as one glyph per row", () => {
  it("gives a text row its kind and no member of the object", () => {
    // The mark carries the kind alone. The object's own words, set in its own
    // face, were a 28px column trying to be a canvas — and a row says what it
    // holds through its name, its role and its bound key, which are columns
    // that can render a string without a legibility budget.
    const object = new Textbox("CPU", { id: "cpu-card-title" });
    const rows = projectLayers({ ...base, root: [object] });
    expect(rows[0]?.mark).toEqual({ kind: "text" });
  });

  it("names the primitive a shape row is, and none rather than guessing", () => {
    // Fabric's own `type` tag, which is the vocabulary the Add pane's
    // `SHAPE_KINDS` and this union already share. The two sweeps are
    // `scene-fabric`'s own classes — Fabric 7 ships no arc — but Fabric's
    // instance getter lowercases whatever the class calls itself, so they read
    // here like every built-in tag and a reader needs no special case.
    const filled = new Rect({ id: "panel", width: 10, height: 10 });
    const round = new Ellipse({ id: "chip", rx: 5, ry: 5 });
    const rule = new Line([0, 0, 10, 10], { id: "rule" });
    // A value rather than a fresh literal, for the reason the production file
    // gives: Fabric infers its options type from one, and the inferred type has
    // no room for the authored `id`.
    const arcOptions = {
      id: "sweep",
      radius: 10,
      startAngle: 0,
      endAngle: 90,
      stroke: "#f59e0b",
      fill: null,
    };
    const swept = new Arc(arcOptions);
    // A tag this build does not know is reported as none. Defaulting to a
    // neighbour would have a square stand for whatever a newer build wrote —
    // the one thing a kind mark must never do, so this is the case a theme made
    // by a newer build lands in. Defined on the instance rather than set:
    // Fabric's `type` setter is a documented no-op ("Setting type has no
    // effect"), so a test that assigned it would be asserting against `rect`.
    const future = new Rect({ id: "future", width: 10, height: 10 });
    Object.defineProperty(future, "type", { value: "star" });
    const rows = projectLayers({
      ...base,
      root: [filled, round, rule, swept, future],
    });
    const mark = (id: string): unknown =>
      rows.find((row) => row.id === id)?.mark;
    expect(mark("panel")).toEqual({ kind: "shape", shape: "rect" });
    // A `Circle` is an ellipse the author has not stretched, and the editor has
    // no circle kind: both classes are the one primitive.
    expect(mark("chip")).toEqual({ kind: "shape", shape: "ellipse" });
    expect(mark("rule")).toEqual({ kind: "shape", shape: "line" });
    expect(mark("sweep")).toEqual({ kind: "shape", shape: "arc" });
    expect(mark("future")).toEqual({ kind: "shape", shape: undefined });
  });

  it("names a chart's family, and names none rather than guessing", () => {
    const gauge = new YunariChart({
      id: "ram-gauge",
      family: "gauge",
      settings: defaultGaugeSettings,
      width: 10,
      height: 10,
    });
    const rows = projectLayers({ ...base, root: [gauge] });
    expect(rows[0]?.mark).toEqual({ kind: "chart", family: "gauge" });

    // A family this build does not know is reported as none. Defaulting to a
    // neighbour would have the row claim a chart is a gauge when the document
    // says otherwise — the one thing a kind mark must never do. A theme made
    // by a newer build is the case, so the cast is the point rather than a
    // convenience: `family` is validated on load, not here.
    const future = new YunariChart({
      id: "future",
      family: "radial",
      settings: defaultGaugeSettings,
      width: 10,
      height: 10,
    } as unknown as ConstructorParameters<typeof YunariChart>[0]);
    const unknown = projectLayers({ ...base, root: [future] });
    expect(unknown[0]?.mark).toEqual({ kind: "chart", family: undefined });
  });

  it("draws a group with no mark of its own", () => {
    const group = new Group([new Rect({ id: "child", width: 10, height: 10 })]);
    group.set("id", "group");
    const rows = projectLayers({ ...base, root: [group] });
    expect(rows[0]?.mark).toEqual({ kind: "group" });
  });

  it("reads a binding as the document's own key, and none as no key", () => {
    const bound = new Textbox("hi", { id: "ram-value" });
    const free = new Textbox("hi", { id: "wordmark" });
    const rows = projectLayers({
      ...base,
      root: [bound, free],
      bindings: {
        "ram-value": [{ id: "ram-percent", semanticKey: "ram.used.percent" }],
      },
    });
    // Read from the envelope, not typed in beside the object: a panel that
    // wrote the key itself would read correctly on the starter and be wrong on
    // every other theme.
    expect(rows.find((row) => row.id === "ram-value")?.bound).toEqual([
      "ram.used.percent",
    ]);
    expect(rows.find((row) => row.id === "wordmark")?.bound).toEqual([]);
  });

  it("keeps every key a chart reads, in the order the document declares them", () => {
    const trends = new YunariChart({
      id: "trends-chart",
      family: "line",
      settings: defaultLineSettings,
      width: 10,
      height: 10,
    });
    const rows = projectLayers({
      ...base,
      root: [trends],
      bindings: {
        "trends-chart": [
          { id: "trends-cpu", semanticKey: "cpu.load" },
          { id: "trends-gpu", semanticKey: "gpu.load" },
          { id: "trends-ram", semanticKey: "ram.used.percent" },
        ],
      },
    });
    // All three, not the first: a chart reading three keys and a row naming one
    // would make the other two invisible in the one panel that lists layers.
    expect(rows[0]?.bound).toEqual([
      "cpu.load",
      "gpu.load",
      "ram.used.percent",
    ]);
  });
});

describe("a scene with no groups at all", () => {
  /** Review Focus 4, and the case the grouped default could quietly break:
   * a theme built from two hundred loose shapes has no group anywhere, so
   * every row is a root. Nothing here may assume a card is a rule about
   * themes — the starter is the only theme this plan builds, and the panel is
   * for all of them. */
  const loose = (count: number): FabricObject[] =>
    Array.from(
      { length: count },
      (_, at) =>
        new Rect({ id: `loose-${at}`, left: at * 10, width: 10, height: 10 }),
    );

  it("puts every row at depth 0 with no parent", () => {
    const scene = loose(200);
    const rows = projectLayers({ ...base, root: scene });
    expect(rows).toHaveLength(200);
    expect(rows.every((row) => row.depth === 0)).toBe(true);
    expect(rows.every((row) => row.parentId === undefined)).toBe(true);
    // Nothing to open, so nothing is shut and no row offers a twisty.
    expect(rows.every((row) => row.collapsed === false)).toBe(true);
    expect(rows.every((row) => row.hasChildren === false)).toBe(true);
  });

  it("keeps every loose object individually reachable and selectable", () => {
    // "Every one of those shapes keeps individually selectable, movable and
    // styleable" is the constraint, and a panel that hid or merged rows would
    // break it while still projecting the right number of them.
    const scene = loose(200);
    const rows = projectLayers({ ...base, root: scene, selected: [scene[7]!] });
    expect(rows.filter((row) => row.selected)).toHaveLength(1);
    expect(rows.find((row) => row.selected)?.id).toBe("loose-7");
    // Reversed paint order, so row 7 is `loose-192` — and it has to resolve
    // back to that object rather than to the one in the same index.
    expect(findById(scene, rows[7]!.id)).toBe(scene[192]);
    for (const row of rows)
      expect(row.visible && !row.locked, row.id).toBe(true);
  });

  it("reverses paint order without a group anywhere to reverse within", () => {
    const scene = loose(3);
    const rows = projectLayers({ ...base, root: scene });
    expect(rows.map((row) => row.id)).toEqual([
      "loose-2",
      "loose-1",
      "loose-0",
    ]);
  });
});

describe("nested groups", () => {
  const nest = (): { outer: Group; inner: Group; leaf: FabricObject } => {
    const leaf = new Rect({ id: "leaf", width: 10, height: 10 });
    const inner = new Group([leaf]);
    inner.set("id", "inner");
    const outer = new Group([inner]);
    outer.set("id", "outer");
    return { outer, inner, leaf };
  };

  it("names the right parent at depth 2 and at depth 3", () => {
    const great = new Rect({ id: "great", width: 10, height: 10 });
    const grandchild = new Group([great]);
    grandchild.set("id", "grandchild");
    const child = new Group([grandchild]);
    child.set("id", "child");
    const { outer } = nest();
    outer.add(child);
    const rows = projectLayers({
      ...opened("outer", "inner", "child", "grandchild"),
      root: [outer],
    });
    // `outer` holds `inner` then `child`, and the walk reverses paint order at
    // every level, so `child` leads and `great` sits at depth 3.
    expect(
      rows.map((row) => ({
        id: row.id,
        depth: row.depth,
        parent: row.parentId,
      })),
    ).toEqual([
      { id: "outer", depth: 0, parent: undefined },
      { id: "child", depth: 1, parent: "outer" },
      { id: "grandchild", depth: 2, parent: "child" },
      { id: "great", depth: 3, parent: "grandchild" },
      { id: "inner", depth: 1, parent: "outer" },
      { id: "leaf", depth: 2, parent: "inner" },
    ]);
  });

  it("emits a parent before its children, so one forward pass reaches any depth", () => {
    // `layer-panel`'s group-context marking relies on this: it walks the rows
    // once, adding a row whose parent is already in the set.
    const { outer } = nest();
    const rows = projectLayers({
      ...opened("outer", "inner"),
      root: [outer],
    });
    const seen = new Set<string>();
    for (const row of rows) {
      if (row.parentId !== undefined) expect(seen.has(row.parentId)).toBe(true);
      seen.add(row.id);
    }
  });

  it("hides a whole shut subtree, and everything under it", () => {
    const { outer } = nest();
    const rows = projectLayers({ ...opened("inner"), root: [outer] });
    // `inner` is open but `outer` is shut, so nothing under `outer` is shown
    // however open the group inside it is.
    expect(rows.map((row) => row.id)).toEqual(["outer"]);
  });

  it("resolves an id inside a shut group to the object the panel drew it from", () => {
    // `findById` walks the whole document while the projection emits only what
    // is open, so the two must agree on what an id names — or a rename or a
    // hide lands on whichever object happened to be walked first.
    const { outer, inner, leaf } = nest();
    const rows = projectLayers({ ...opened("inner"), root: [outer] });
    expect(rows.map((row) => row.id)).toEqual(["outer"]);
    expect(findById([outer], "inner")).toBe(inner);
    expect(findById([outer], "leaf")).toBe(leaf);
  });

  it("keeps a loose row's fallback id pointing at that row when a shut group holds an id-less object", () => {
    // The fallback id is *positional* — `layerIds` numbers id-less objects by
    // walk order — and `findById` walks the whole document while the projection
    // emits only what is open. The id-less object *inside the shut group* is
    // what makes the two disagree: if the projection stopped at the shut group
    // it would never number it, `findById` would, and the loose row's id would
    // resolve to the hidden object instead. A rename or a hide would then land
    // on something the author never clicked.
    const hidden = new Rect({ width: 10, height: 10 });
    const group = new Group([hidden]);
    group.set("id", "group");
    const loose = new Rect({ left: 200, width: 10, height: 10 });
    const scene = [loose, group];

    const rows = projectLayers({ ...base, root: scene });
    // `hidden` is numbered `unidentified` even though it is behind a shut
    // group, which is why `loose` is the *second* id-less object. That gap is
    // the evidence: a walk that stopped at the shut group would have numbered
    // `loose` first, and `findById` — which does descend — would then have
    // resolved that id to `hidden` instead.
    expect(rows.map((row) => row.id)).toEqual(["group", "unidentified#2"]);
    // The row that drew `loose` is the one the panel would act on.
    expect(findById(scene, rows[1]!.id)).toBe(loose);
    expect(findById(scene, rows[1]!.id)).not.toBe(hidden);

    // And opening the group does not renumber it, or a row the author had
    // already clicked would resolve to a different object.
    const open = projectLayers({ ...opened("group"), root: scene });
    expect(open[2]!.id).toBe(rows[1]!.id);
    expect(findById(scene, open[2]!.id)).toBe(loose);
  });
});

/** Every id one card's own JSON declares, groups descended — the list a second
 * copy has to avoid so two copies of a unit get two sets of ids. */
function idsOf(card: object): readonly string[] {
  const ids: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    const record = value as { readonly [key: string]: unknown };
    if (typeof record["id"] === "string") ids.push(record["id"]);
    for (const entry of Object.values(record)) walk(entry);
  };
  walk(card);
  return ids;
}

describe("the starter theme", () => {
  /** The starter is what this plan changed, so it is measured rather than
   * assumed: `new-fabric-theme.test.ts` states these parts so a card that
   * gained or lost one fails where the failure can name itself. The GPU card is
   * the eight-part one; this is not a limit. */
  const CARD_PARTS = 8;
  /** Ten top-level rows, not eight: the wordmark and the strapline are loose by
   * design — they are not a card, and a design that made every object a group
   * is the cage this project is written to avoid (`new-fabric-theme.test.ts`
   * pins that). Eight is the count of *cards*, which is what the plan's prose
   * means; the row count an author reads is ten. */
  const TOP_LEVEL_ROWS = 10;
  const CARDS = 8;
  /** Every object in the document, at any depth. */
  const TOTAL_OBJECTS = 60;

  const starter = async (): Promise<readonly FabricObject[]> => {
    const theme = createNewFabricTheme();
    const canvas = new StaticCanvas(undefined, {
      width: theme.artboard.width,
      height: theme.artboard.height,
    });
    await reviveThemeEnvelope(canvas, theme);
    return canvas.getObjects();
  };

  it("projects to its top-level rows, with every card shut", async () => {
    const roots = await starter();
    const rows = projectLayers({ ...base, root: roots });
    expect(rows).toHaveLength(TOP_LEVEL_ROWS);
    expect(
      rows.every((row) => row.depth === 0 && row.parentId === undefined),
    ).toBe(true);
    const cards = rows.filter((row) => row.kind === "group");
    expect(cards).toHaveLength(CARDS);
    expect(cards.every((row) => row.collapsed && row.hasChildren)).toBe(true);
    // The two loose labels are rows too, at the same level as the cards.
    expect(rows.filter((row) => row.kind === "text")).toHaveLength(2);
  });

  it("reaches every object once every card is opened", async () => {
    const roots = await starter();
    const rows = projectLayers({
      ...base,
      expanded: new Set(
        roots
          .filter((object) => object instanceof Group)
          .map((group) => String(group.get("id"))),
      ),
      root: roots,
    });
    expect(rows).toHaveLength(TOTAL_OBJECTS);
    // And each row names a distinct object, so nothing is lost or doubled by
    // the walk reaching into groups.
    expect(new Set(rows.map((row) => row.id)).size).toBe(TOTAL_OBJECTS);
    expect(rows.every((row) => row.depth === 1 || row.depth === 0)).toBe(true);
  });

  it("keeps the CPU and GPU cards at their measured part counts", async () => {
    const roots = await starter();
    const rows = projectLayers({
      ...base,
      expanded: new Set(["group-cpu-card", "group-gpu-card"]),
      root: roots,
    });
    const under = (card: string): number =>
      rows.filter((row) => row.parentId === card).length;
    expect(under("group-cpu-card")).toBe(7);
    expect(under("group-gpu-card")).toBe(CARD_PARTS);
  });

  it("gives every row a treatment the author can read without its name", async () => {
    // The claim this whole pass rests on, measured on the revived starter
    // rather than on fixtures: sixty objects projecting to rows, and every one
    // of them saying what it is. A row that falls back to nothing here would
    // pass every fixture-based test above and leave the author with a name and
    // a blank column.
    const theme = createNewFabricTheme();
    const canvas = new StaticCanvas(undefined, {
      width: theme.artboard.width,
      height: theme.artboard.height,
    });
    await reviveThemeEnvelope(canvas, theme);
    const rows = projectLayers({
      ...base,
      expanded: new Set(
        canvas
          .getObjects()
          .filter((object) => object instanceof Group)
          .map((group) => String(group.get("id"))),
      ),
      root: canvas.getObjects(),
      bindings: theme.bindings ?? {},
    });

    expect(rows).toHaveLength(TOTAL_OBJECTS);
    for (const row of rows) {
      if (row.kind === "group") {
        // A group draws no mark; its twisty and a bold name are its mark.
        expect(row.mark).toEqual({ kind: "group" });
        continue;
      }
      expect(row.mark.kind).toBe(row.kind);
    }
    // The readings that make a card a card, named off the document.
    const mark = (id: string): unknown =>
      rows.find((row) => row.id === id)?.mark;
    expect(rows.find((row) => row.id === "cpu-card-title")?.mark).toEqual({
      kind: "text",
    });
    expect(mark("ram-gauge")).toEqual({ kind: "chart", family: "gauge" });
    expect(rows.find((row) => row.id === "cpu-card-value")?.bound).toEqual([
      "cpu.load",
    ]);
    // The three-key chart, so the column that names several is exercised on the
    // one object in the starter that reads several.
    expect(rows.find((row) => row.id === "trends-chart")?.bound).toEqual([
      "cpu.load",
      "gpu.load",
      "ram.used.percent",
    ]);
    // And the wordmark, which is a loose label rather than a card — the case
    // that keeps a card being a fact about the starter.
    expect(rows.find((row) => row.id === "wordmark")?.kind).toBe("text");
  });

  it("names the unit on every card row, and nothing else anywhere", async () => {
    const roots = await starter();
    // Every card opened, so a part is a row too: a part behind a shut group is
    // not a row the panel ever renders, and the kinds beside the cards are read
    // from the rows this opens.
    const rows = projectLayers({
      ...base,
      expanded: new Set(
        roots
          .filter((object) => object instanceof Group)
          .map((group) => String(group.get("id"))),
      ),
      root: roots,
    });

    // THE row this plan exists for: on the composition every author meets
    // first, a card says which card it is rather than the bare group arm. Keyed
    // by id rather than by position, because the projection walks the root array
    // reversed and a list comparison would pin paint order instead of identity.
    const named = Object.fromEntries(
      rows
        .filter((row) => row.role.kind === "group")
        .map((row) => [
          row.id,
          row.role.kind === "group" ? row.role.unit : undefined,
        ]),
    );
    expect(named).toEqual(
      Object.fromEntries(CARD_LIBRARY.map((unit) => [unit.id, unit.label])),
    );

    // The two loose labels are not units and must not borrow one: their rows are
    // the text arm, and the parts beside them are shapes and charts.
    expect(
      rows
        .filter((row) => row.role.kind !== "group")
        .map((row) => row.role.kind),
    ).toEqual(expect.arrayContaining(["text", "shape", "chart"]));
  });

  it("tells two copies of one unit apart, and neither loses its stamp", async () => {
    // Review Focus 4. Both cards come off the real copy path, so the pair they
    // share is the one a second insertion of the same unit actually writes.
    const built = CARD_LIBRARY.find((unit) => unit.id === "group-cpu-card");
    if (built === undefined) throw new Error("the library has no CPU unit");
    const globals = createNewFabricTheme().globals;
    const first = instantiateCard({
      unit: built,
      globals,
      existingIds: [],
      origin: { left: 0, top: 0 },
    });
    const second = instantiateCard({
      unit: built,
      globals,
      existingIds: idsOf(first.card),
      origin: { left: 400, top: 0 },
    });

    const roots = await util.enlivenObjects<FabricObject>([
      first.card,
      second.card,
    ]);
    const copies = projectLayers({ ...base, root: roots }).filter(
      (row) => row.role.kind === "group",
    );
    // The same unit on both rows — the fact a copy is a copy of — and an id of
    // its own, so neither arrival erased the other.
    expect(
      copies.map((row) =>
        row.role.kind === "group" ? row.role.unit : undefined,
      ),
    ).toEqual([built.label, built.label]);
    expect(new Set(copies.map((row) => row.id)).size).toBe(2);
  });
});

describe("layer tree lookups", () => {
  it("resolves an id to the same object the projection named", () => {
    const child = new Rect({ id: "child", width: 10, height: 10 });
    const group = new Group([child]);
    group.set("id", "group");
    const rows = projectLayers({ ...opened("group"), root: [group] });
    // The id the row carried has to resolve back to the object that row drew,
    // including the nested child, or every bridge command targets the wrong one.
    expect(findById([group], rows[1]!.id)).toBe(child);
  });

  it("resolves the anonymous fallback ids the projection hands out", () => {
    const first = new Rect({ width: 10, height: 10 });
    const second = new Rect({ width: 10, height: 10 });
    const rows = projectLayers({ ...base, root: [first, second] });
    expect(rows.map((row) => row.id)).toEqual([
      "unidentified",
      "unidentified#2",
    ]);
    expect(findById([first, second], rows[0]!.id)).toBe(second);
    expect(findById([first, second], rows[1]!.id)).toBe(first);
  });

  it("names the owning group of a child and nothing above a top-level object", () => {
    const child = new Rect({ id: "child", width: 10, height: 10 });
    const group = new Group([child]);
    group.set("id", "group");
    expect(ownerOf([group], "child")).toBe(group);
    expect(ownerOf([group], "group")).toBeUndefined();
    expect(ownerOf([group], "missing")).toBeUndefined();
  });

  it("returns the root-first path to a nested id, and nothing for a miss", () => {
    const child = new Rect({ id: "child", width: 10, height: 10 });
    const inner = new Group([child]);
    inner.set("id", "inner");
    const outer = new Group([inner]);
    outer.set("id", "outer");
    expect(pathTo([outer], "child")).toEqual([outer, inner, child]);
    expect(pathTo([outer], "missing")).toEqual([]);
  });
});

describe("the row's role, in the document's own terms", () => {
  it("counts a chart's series from its own bindings and names its family", () => {
    const trends = new YunariChart({
      id: "trends",
      family: "line",
      settings: defaultLineSettings,
      width: 10,
      height: 10,
    });
    const rows = projectLayers({
      ...base,
      root: [trends],
      bindings: {
        trends: [
          { id: "a", semanticKey: "cpu.load" },
          { id: "b", semanticKey: "gpu.load" },
          { id: "c", semanticKey: "ram.used.percent" },
        ],
      },
    });
    // The count is the length of the same list the bound column prints, so the
    // two cannot disagree.
    expect(rows[0]?.role).toEqual({ kind: "chart", family: "line", series: 3 });
    expect(rows[0]?.bound).toHaveLength(3);
  });

  it("counts no series for a chart the document binds to nothing", () => {
    // An unbound chart must not throw, and must report zero rather than one:
    // the count is the document's, not a default a chart is assumed to have.
    const gauge = new YunariChart({
      id: "gauge",
      family: "gauge",
      settings: defaultGaugeSettings,
      width: 10,
      height: 10,
    });
    const rows = projectLayers({ ...base, root: [gauge] });
    expect(rows[0]?.role).toEqual({
      kind: "chart",
      family: "gauge",
      series: 0,
    });
  });

  it("names no family for a chart family this build does not know", () => {
    // Review Focus 1. The settings are a gauge's, and the mark already refuses
    // to claim that family — the role must refuse it for the same reason, or
    // the row names a kind the document never did. A theme made by a newer
    // build is the case, so the cast is the point rather than a convenience.
    const future = new YunariChart({
      id: "future",
      family: "mystery",
      settings: defaultGaugeSettings,
      width: 10,
      height: 10,
    } as unknown as ConstructorParameters<typeof YunariChart>[0]);
    const rows = projectLayers({
      ...base,
      root: [future],
      bindings: { future: [{ id: "x", semanticKey: "cpu.load" }] },
    });
    expect(rows[0]?.role).toEqual({
      kind: "chart",
      family: undefined,
      series: 1,
    });
  });

  it("reads a card's unit from the document's own stamp, and nothing without one", () => {
    const card = (id: string, provenance?: unknown): Group => {
      const group = new Group([new Rect({ width: 10, height: 10 })]);
      group.set("id", id);
      if (provenance !== undefined) group.set("provenance", provenance);
      return group;
    };
    const stamped = card("cpu-card", { widgetId: "cpu", widgetName: "CPU" });
    const bare = card("bare-card");
    const idOnly = card("id-only-card", { widgetId: "odd" });
    const notAString = card("odd-card", { widgetId: "odd", widgetName: 7 });
    // A stamp that names the unit with nothing says nothing, exactly as an
    // absent one does — and a `??` at the render site cannot tell them apart,
    // so the projection is where the blank stops being a unit name.
    const blank = card("blank-card", { widgetId: "blank", widgetName: "" });
    const spaces = card("spaces-card", {
      widgetId: "spaces",
      widgetName: "   ",
    });

    const rows = projectLayers({
      ...base,
      root: [stamped, bare, idOnly, notAString, blank, spaces],
    });
    const at = (id: string): LayerRole | undefined =>
      rows.find((row) => row.id === id)?.role;
    // Review Focus 2, and load-bearing since the starter gained stamps of its
    // own: `cpu-card` names a unit no `CARD_LIBRARY` entry has, and the row
    // still says CPU. Resolving a name through the library would make a document
    // another version wrote read as one this build recognises. The unstamped
    // case is every group the author makes, which `Ctrl+G` writes with no stamp.
    expect(at("cpu-card")).toEqual({ kind: "group", unit: "CPU" });
    expect(at("bare-card")).toEqual({ kind: "group", unit: undefined });
    expect(at("id-only-card")).toEqual({ kind: "group", unit: undefined });
    expect(at("odd-card")).toEqual({ kind: "group", unit: undefined });
    expect(at("blank-card")).toEqual({ kind: "group", unit: undefined });
    expect(at("spaces-card")).toEqual({ kind: "group", unit: undefined });
  });

  it("reads a nested group's own stamp, and lends it to nothing beneath", () => {
    // A constructed document, because the starter holds no nested group and a
    // starter assertion about one could only fail if a card legitimately gained
    // it — vg-167. The card's stamp belongs to the card: a group inside it that
    // names a unit of its own reads that one, and one that names none reads the
    // bare arm rather than borrowing the stamp above it, which would claim a
    // unit the document never wrote there.
    const stamp = (widgetName: string) => ({ widgetId: "unit", widgetName });
    const nested = new Group([new Rect({ width: 10, height: 10 })]);
    nested.set("id", "nested");
    nested.set("provenance", stamp("GPU"));
    const bare = new Group([new Rect({ width: 10, height: 10 })]);
    bare.set("id", "bare");
    const card = new Group([nested, bare]);
    card.set("id", "card");
    card.set("provenance", stamp("CPU"));

    const rows = projectLayers({
      ...opened("card", "nested", "bare"),
      root: [card],
    });
    const at = (id: string): LayerRole | undefined =>
      rows.find((row) => row.id === id)?.role;
    expect(at("card")).toEqual({ kind: "group", unit: "CPU" });
    expect(at("nested")).toEqual({ kind: "group", unit: "GPU" });
    expect(at("bare")).toEqual({ kind: "group", unit: undefined });
  });

  it("gives every kind the projection can return a role arm of its own", () => {
    // Driven from the kind union rather than from one example object: a kind
    // added to `LayerKind` without an arm breaks the `Record` below, so the
    // gap is a compile failure and not an unfilled field.
    const group = new Group([]);
    group.set("id", "group-1");
    // The background is not a Fabric object, so the projection never returns it;
    // the row is appended by the bridge instead.
    const examples: Record<Exclude<LayerKind, "background">, FabricObject> = {
      text: new Textbox("hi", { id: "text-1" }),
      shape: new Rect({ id: "shape-1", width: 10, height: 10 }),
      chart: new YunariChart({
        id: "chart-1",
        family: "gauge",
        settings: defaultGaugeSettings,
        width: 10,
        height: 10,
      }),
      group,
      image: new FabricImage(document.createElement("img"), {
        id: "image-1",
        width: 10,
        height: 10,
      }),
    };
    for (const kind of Object.keys(examples) as (keyof typeof examples)[]) {
      const rows = projectLayers({ ...base, root: [examples[kind]] });
      expect(rows[0]?.kind, kind).toBe(kind);
      expect(rows[0]?.role.kind, kind).toBe(kind);
    }
  });

  it("keeps the six kind words out of the projection", () => {
    // Read from the source rather than from a rendered row: the assertion is
    // that the words have one owner, `uiCopy.panels.layerKinds`, and that a
    // private copy is not sitting beside the projection waiting to drift.
    // The path is built from the string `import.meta.url` rather than from a
    // `URL` object: under jsdom that object is jsdom's own class, which Node's
    // `fileURLToPath` refuses as "not of scheme file".
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "layer-tree.ts"),
      "utf8",
    );
    expect(source).not.toMatch(
      /["'](Text|Shape|Chart|Group|Image|Background)["']/,
    );
    expect(uiCopy.panels.layerKinds).toEqual({
      text: "Text",
      shape: "Shape",
      chart: "Chart",
      group: "Group",
      image: "Image",
      background: "Background",
    });
  });

  it("owns no unit vocabulary of its own", () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "layer-tree.ts"),
      "utf8",
    );
    // The projection reports what the document holds. Resolving a name through
    // the library would be a second owner of the unit's words, and it would make
    // a document written by another version read as one this build recognises.
    expect(source).not.toMatch(/card-library/);
  });
});

describe("the background row", () => {
  it("places the background last and below every object", () => {
    // The bridge appends this row after the projection rather than projecting
    // it, so nothing in the object tree can restack the bottom-most layer.
    const rows = projectLayers({
      ...base,
      root: [new Rect({ id: "rect", width: 10, height: 10 })],
    });
    const withBackground = [...rows, backgroundRow({ selected: false })];
    expect(BACKGROUND_LAYER_ID).toBe("$background");
    expect(withBackground.at(-1)?.id).toBe("$background");
    expect(withBackground.at(-1)?.kind).toBe("background");
    expect(withBackground.at(-1)).toMatchObject({
      depth: 0,
      parentId: undefined,
      hasChildren: false,
      collapsed: false,
      locked: false,
    });
  });

  it("keeps the background row when the theme has no background at all", () => {
    // The row is the layer, not the media: a theme with no background still
    // has a bottom-most plane the author can select and configure.
    expect(backgroundRow({ selected: false }).visible).toBe(true);
  });

  it("reads its selection from the flag rather than from Fabric", () => {
    expect(backgroundRow({ selected: true }).selected).toBe(true);
    expect(backgroundRow({ selected: false }).selected).toBe(false);
  });
});
