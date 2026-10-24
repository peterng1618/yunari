import {
  isObjectName,
  validateFabricThemeEnvelope,
  YUNARI_GLASS_PROPERTY,
} from "@yunari/renderer-core";
import {
  SCENE_PERSISTED_PROPERTIES,
  YUNARI_PAINT_PROPERTY,
  YUNARI_TEXT_PROPERTY,
} from "@yunari/scene-fabric";
import { classRegistry, type FabricObject } from "fabric/es";
import { describe, expect, it } from "vitest";
import {
  createNewChartDefaults,
  createNewPaintDefaults,
  createNewPanelDefaults,
  createNewShape,
  createNewTextDefaults,
  frostedShapeFill,
  NEW_OBJECT_INSET,
  NEW_OBJECT_STEP,
  NEW_PANEL_SIZE,
  newObjectName,
  newObjectPlacement,
  nextNewObjectPlacement,
  SHAPE_KINDS,
  type ShapeKind,
} from "./new-object-defaults.js";
import { insertGroups } from "./new-object-panel.js";
import { uiCopy } from "./ui-copy.js";

const globals = {
  palette: {
    none: {
      name: "None",
      value: { kind: "solid" as const, color: "transparent" },
    },
    background: {
      name: "Background",
      value: { kind: "solid" as const, color: "#0c0e13" },
    },
    ink: { name: "Ink", value: { kind: "solid" as const, color: "#102030" } },
  },
  typePresets: {
    body: {
      name: "Body",
      value: { family: "Inter", size: 16, weight: 500, lineHeight: 1.2 },
    },
  },
};

/** The shape of a real palette: a scene backdrop, a card surface and a content
    token. A shape the author draws has to be legible against the first and
    usable on the second, so all three have to be present for the rule to bite. */
const cardGlobals = {
  ...globals,
  palette: {
    ...globals.palette,
    panel: {
      name: "Panel",
      value: { kind: "solid" as const, color: "#081523d9" },
    },
    text: { name: "Text", value: { kind: "solid" as const, color: "#ecf5ff" } },
  },
};

/**
 * A shape that is drawn rather than stroked: the ones an author fills.
 *
 * **Listed, not derived by exclusion.** An exclusion filter cannot be wrong in
 * one direction: a kind added to `SHAPE_KINDS` and named in neither list falls
 * into this one by default, so it would be swept as filled without anyone
 * deciding that, and no partition check would notice. Naming every member means
 * a new kind has to be classified here on purpose, and the check below fails
 * until it is. `arc` is open for the reason a polyline is: it has no interior.
 */
const CLOSED_KINDS: readonly ShapeKind[] = [
  "rect",
  "ellipse",
  "polygon",
  "path",
  "wedge",
];

/** The other half of the same rule: an open shape is stroked, not filled. */
const OPEN_KINDS: readonly ShapeKind[] = ["polyline", "line", "arc"];

/**
 * The two lists must account for every kind, and for no kind twice.
 *
 * With both spelled out, adding a kind to `SHAPE_KINDS` and to neither list
 * leaves it in no sweep at all — checked as neither filled nor stroked, which is
 * a silent gap rather than a red one. This is what turns that into a failure.
 */
it("partitions every kind into filled or stroked, with none in both", () => {
  expect([...CLOSED_KINDS, ...OPEN_KINDS].sort()).toEqual(
    [...SHAPE_KINDS].sort(),
  );
  // And no kind is claimed by both, which the sorted comparison alone would not
  // catch if one appeared twice and another not at all.
  const overlap = CLOSED_KINDS.filter((kind) => OPEN_KINDS.includes(kind));
  expect(overlap).toEqual([]);
});

/**
 * The first cascade slot, which is where every one of these objects was placed
 * before the cascade existed. The cascade itself is exercised in its own
 * describe block; what these cases are about is everything a new object is
 * *not* — its name, its paint, its size — so they all share one position.
 */
const placement = newObjectPlacement(0, { width: 1920, height: 1080 });

/**
 * The kinds a frosted treatment may sit on — a **different** set from
 * `CLOSED_KINDS` above, and the difference is the point. A closed path answers
 * "does an author fill this?", and `path` passes it. Frosting answers "is
 * there an interior to sample the backdrop through?", and a `Path` cannot
 * answer that: its closedness is whatever the author typed. Confusing the two
 * is how an open shape ends up with a blur under nothing.
 *
 * The two swept kinds differ from each other here for the same reason, and it
 * is the reason they are two kinds at all: a `wedge` is a region and can be
 * frosted, and an `arc` is a curve with nothing to sample through.
 */
const GLASS_KINDS: ReadonlySet<string> = new Set([
  "rect",
  "circle",
  "ellipse",
  "triangle",
  "polygon",
  "wedge",
]);

/** The same palette plus the frosted surface: the pair a glass card needs. */
const frostGlobals = {
  ...cardGlobals,
  palette: {
    ...cardGlobals.palette,
    frost: {
      name: "Frosted panel",
      value: { kind: "solid" as const, color: "#0815234d" },
    },
  },
};

describe("new object defaults", () => {
  it("derives a non-transparent palette reference for a new paintable object", () => {
    const defaults = createNewPaintDefaults(globals);

    expect(defaults.fill).toBe("#102030");
    expect(defaults[YUNARI_PAINT_PROPERTY]).toEqual({ fill: "palette.ink" });
  });

  it("places new text by its edges, as it places every other object", () => {
    // Measured on the surface: a text inserted from the Add pane arrived with
    // Fabric's centre origin, so the inspector's X and Y were the middle of the
    // object. A card is placed by its left edge, and a label that cannot be
    // placed by the same edge cannot be lined up with one.
    const defaults = createNewTextDefaults(globals, "New text", placement);

    expect(defaults).toMatchObject({ originX: "left", originY: "top" });
  });

  it("derives per-run palette and type-preset references for new text", () => {
    const defaults = createNewTextDefaults(globals, "New text", placement);

    expect(defaults).toMatchObject({
      fill: "#102030",
      fontFamily: "Inter",
      fontSize: 16,
      fontWeight: 500,
      lineHeight: 1.2,
      [YUNARI_PAINT_PROPERTY]: { fill: "palette.ink" },
      [YUNARI_TEXT_PROPERTY]: {
        runs: [
          {
            text: "New text",
            typePreset: "typePresets.body",
            style: { color: { ref: "palette.ink" } },
          },
        ],
      },
    });
  });

  it("refuses to invent local paint or type values when references are unavailable", () => {
    expect(() => createNewPaintDefaults(undefined)).toThrow("palette token");
    expect(() =>
      createNewTextDefaults(
        { palette: globals.palette },
        "New text",
        placement,
      ),
    ).toThrow("type preset");
  });

  it.each(["gauge", "line", "bar", "pie"] as const)(
    "derives %s settings using only existing palette references",
    (family) => {
      const settings = createNewChartDefaults(globals, family);

      expect(JSON.stringify(settings)).toContain("palette.ink");
      expect(JSON.stringify(settings)).not.toContain('"color"');
    },
  );

  it("refuses chart creation without a non-transparent palette token", () => {
    expect(() => createNewChartDefaults(undefined, "gauge")).toThrow(
      "palette token",
    );
  });

  it("names a new object after the button that made it", () => {
    // The Add pane's own labels are the naming this repo already has; a new
    // object that shows its id instead would be a wall of uuids from the first
    // click, and the author would have nothing to tell two panels apart.
    expect(createNewPanelDefaults(globals, placement).name).toBe(
      uiCopy.panels.panel,
    );
    expect(createNewTextDefaults(globals, "New text", placement).name).toBe(
      uiCopy.panels.text,
    );
  });

  it("names a fixed text box for what it is, so its layer row is not a bare Text", () => {
    const box = { width: 240, height: 96 };

    expect(
      createNewTextDefaults(globals, "New text", placement, box).name,
    ).toBe(uiCopy.panels.textBox);
    expect(uiCopy.panels.textBox).toBe("Text box");
  });

  it("carries the authored box only when the gesture drew one", () => {
    // A Text measures its own ink; handing `addText` a box would construct a
    // Textbox and give it a width it cannot honour.
    expect(
      createNewTextDefaults(globals, "New text", placement),
    ).not.toHaveProperty("box");
    expect(
      createNewTextDefaults(globals, "New text", placement, {
        width: 240,
        height: 96,
      }),
    ).toMatchObject({ box: { width: 240, height: 96 }, ...placement });
  });

  it("names a new chart after the family the author chose", () => {
    for (const family of ["gauge", "line", "bar", "pie"] as const) {
      expect(newObjectName(family)).toBe(uiCopy.chartFamilies[family]);
    }
  });

  it("keeps every default name inside the published bound", () => {
    // The envelope refuses a longer name, so a default that broke the bound
    // would make a newly inserted object unsaveable.
    for (const name of [
      newObjectName("panel"),
      newObjectName("text"),
      newObjectName("gauge"),
    ]) {
      expect(isObjectName(name)).toBe(true);
    }
  });

  it("names every insertable shape after the button that made it", () => {
    // A shape the Add pane can insert but cannot name would arrive as a bare
    // uuid, which is the exact gap F1.8 exists to close.
    for (const kind of SHAPE_KINDS) {
      expect(newObjectName(kind)).toBe(uiCopy.shapeKinds[kind]);
    }
  });

  it("gives a newly built shape the name its kind implies", () => {
    for (const kind of SHAPE_KINDS) {
      const shape = createNewShape(`panel-1`, globals, kind, placement);
      expect(shape.get("name")).toBe(newObjectName(kind));
    }
  });

  it("derives a new panel from a surface token, not a content one", () => {
    const defaults = createNewPanelDefaults(globals, placement);

    // A panel is a surface. `ink` is the token a new *text* object takes, and
    // painting a whole card in it would hide every label the author puts on it.
    expect(defaults.fill).toBe("#0c0e13");
    expect(defaults[YUNARI_PAINT_PROPERTY]).toEqual({
      fill: "palette.background",
    });
  });

  it("places a new panel inset, at artboard coordinates, sized and rounded", () => {
    const defaults = createNewPanelDefaults(globals, placement);

    expect(defaults.left).toBe(NEW_OBJECT_INSET);
    expect(defaults.top).toBe(NEW_OBJECT_INSET);
    // Fabric's own origin is the centre, which would put a new panel half off
    // the corner the author cannot easily click.
    expect(defaults.originX).toBe("left");
    expect(defaults.originY).toBe("top");
    expect(defaults.width).toBeGreaterThan(0);
    expect(defaults.height).toBeGreaterThan(0);
    expect(defaults.rx).toBe(defaults.ry);
    expect(defaults.rx).toBeGreaterThan(0);
  });

  it("refuses a new panel without a palette token", () => {
    expect(() => createNewPanelDefaults(undefined, placement)).toThrow(
      "palette token",
    );
  });
});

/** What a saved document holds for one object: Fabric's own serialization,
    through the same property list the scene's owner uses. */
function saved(object: FabricObject): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(object.toObject([...SCENE_PERSISTED_PROPERTIES])),
  ) as Record<string, unknown>;
}

/** The smallest envelope the published validator accepts, around one object. */
function envelopeWith(
  object: Record<string, unknown>,
  document: unknown = globals,
): unknown {
  return {
    schemaVersion: 2,
    fabricVersion: "7.4.0",
    id: "theme",
    metadata: { themeLanguage: "en" },
    artboard: { width: 1920, height: 1080 },
    globals: document,
    scene: { version: "7.4.0", objects: [object] },
  };
}

/** The revival the editor's own save/open path performs, through the registry
    `loadFromJSON` reads. A shape the runtime cannot revive is a shape that does
    not survive a reload, whatever the author typed into it. */
async function revive(object: Record<string, unknown>): Promise<FabricObject> {
  const type = object["type"];
  if (typeof type !== "string") throw new Error("A scene object needs a type.");
  const revived = classRegistry.getClass(type) as {
    fromObject(json: unknown): Promise<FabricObject>;
  };
  return revived.fromObject(object);
}

describe("new shape defaults", () => {
  it.each(CLOSED_KINDS)(
    "fills a new %s as a card, not as the scene's own backdrop",
    (kind) => {
      const shape = createNewShape(
        `shape-${kind}`,
        cardGlobals,
        kind,
        placement,
      );

      // A shape the author draws is a surface they will put something on, and
      // `background` is what is painted behind it. Filling a whole shape with
      // the colour it sits on is not a card, it is nothing at all — and an
      // invisible object cannot be selected or edited.
      expect(shape.get(YUNARI_PAINT_PROPERTY), kind).toEqual({
        fill: "palette.panel",
      });
      expect(shape.fill, kind).toBe("#081523d9");
    },
  );

  it("keeps a new closed shape legible when the palette has no card token", () => {
    // A palette without a card surface still has to get a fill. `background` is
    // then the best surface it has, which is the fallback the surface list was
    // always for.
    for (const kind of CLOSED_KINDS) {
      const shape = createNewShape(`shape-${kind}`, globals, kind, placement);
      expect(shape.get(YUNARI_PAINT_PROPERTY), kind).toEqual({
        fill: "palette.background",
      });
    }
  });

  it.each(OPEN_KINDS)(
    "strokes an open %s with a content token rather than a surface",
    (kind) => {
      // The other half of the same rule: an open shape is stroked, and a
      // stroke in a surface colour is as invisible as a fill in one.
      const shape = createNewShape(
        `shape-${kind}`,
        cardGlobals,
        kind,
        placement,
      );

      expect(shape.get(YUNARI_PAINT_PROPERTY)).toEqual({
        stroke: "palette.text",
      });
      expect(shape.stroke, kind).toBe("#ecf5ff");
    },
  );

  it("fills a new path, because the path it arrives with closes", () => {
    // Named one at a time because the set-based cases above encode the same
    // claim as a filter — everything except `polyline` and `line` — and a filter
    // cannot say which kind it is protecting. The rule is about a shape's data,
    // not its name: `NEW_PATH` ends in `Z`, so a new path is a closed shape.
    // `paintPropertyFor` reads the same fact from the other side (an unfilled
    // Path's paint goes to its stroke), which is why the default is pinned here
    // rather than left to the two `it.each` sweeps.
    const shape = createNewShape("shape-path", cardGlobals, "path", placement);

    expect(shape.get(YUNARI_PAINT_PROPERTY)).toEqual({
      fill: "palette.panel",
    });
    expect(shape.fill).toBe("#081523d9");
  });

  it.each(SHAPE_KINDS)(
    "places a new %s inset, at artboard coordinates",
    (kind) => {
      const shape = createNewShape(`shape-${kind}`, globals, kind, placement);

      expect(shape.left).toBe(NEW_OBJECT_INSET);
      expect(shape.top).toBe(NEW_OBJECT_INSET);
      // Fabric's own origin is the centre, which would put every new shape half
      // off the corner the author cannot easily click.
      expect(shape.get("originX")).toBe("left");
      expect(shape.get("originY")).toBe("top");
      expect(shape.get("id")).toBe(`shape-${kind}`);
    },
  );

  it.each(SHAPE_KINDS)("gives a new %s a visible size", (kind) => {
    const shape = createNewShape(`shape-${kind}`, globals, kind, placement);

    expect(shape.width).toBeGreaterThan(0);
    expect(shape.height).toBeGreaterThan(0);
  });

  it.each(SHAPE_KINDS)(
    "gives a new %s a palette reference, not a literal",
    (kind) => {
      const shape = createNewShape(`shape-${kind}`, globals, kind, placement);

      // The saved document is only palette-reassignable if the shape carries its
      // own reference. An open shape is stroked, so it references a stroke.
      const stroked = OPEN_KINDS.includes(kind);
      expect(shape.get(YUNARI_PAINT_PROPERTY)).toEqual({
        [stroked ? "stroke" : "fill"]: stroked
          ? "palette.ink"
          : "palette.background",
      });
    },
  );

  it("refuses a new shape without a palette token", () => {
    for (const kind of SHAPE_KINDS) {
      expect(() =>
        createNewShape(`shape-${kind}`, undefined, kind, placement),
      ).toThrow("palette token");
    }
  });
});

describe("the surface a shape takes once it is frosted", () => {
  it("carries the frosted surface, because the card surface is 85 % opaque", () => {
    // The defect this rule exists for: `panel` is opaque enough that a blur
    // beneath it is a blur of nothing, so a card the author frosted through the
    // control read as a tint over a smooth gradient rather than as glass. The
    // treatment and the surface are one decision, and only one of the two
    // carried it.
    const shape = createNewShape("glass-1", frostGlobals, "rect", placement);

    expect(shape.get(YUNARI_PAINT_PROPERTY)).toEqual({
      fill: "palette.panel",
    });
    expect(frostedShapeFill(frostGlobals, "palette.panel")).toBe(
      "palette.frost",
    );
  });

  it("fills a shape that carries no reference, which is no reference at all", () => {
    // A shape saved before it carried a reference, or one written by hand, has
    // no token to have chosen — so it takes the frosted surface rather than
    // staying whatever colour it was last painted.
    expect(frostedShapeFill(frostGlobals, undefined)).toBe("palette.frost");
  });

  it("leaves a fill the author chose, because a choice is not a default", () => {
    for (const chosen of [
      "palette.text",
      "palette.ink",
      "palette.background",
    ] as const) {
      expect(frostedShapeFill(frostGlobals, chosen), chosen).toBeUndefined();
    }
  });

  it("leaves a shape already carrying the frosted surface alone", () => {
    expect(frostedShapeFill(frostGlobals, "palette.frost")).toBeUndefined();
  });

  it("changes nothing when the palette has no frosted surface of its own", () => {
    // One surface cannot become another: without a `frost` token the frosted
    // default resolves to the card surface, and a swap would be a no-op written
    // over the author's scene.
    expect(frostedShapeFill(cardGlobals, "palette.panel")).toBeUndefined();
  });

  it("changes nothing when the shape could not be given a surface at all", () => {
    expect(frostedShapeFill(undefined, "palette.panel")).toBeUndefined();
  });

  it("a frosted shape's surface survives the persisted envelope", async () => {
    // The fill reference is what a save keeps; the resolved colour is what the
    // author sees. Both have to come back, or the material is one reload from
    // being a flat tint again.
    const shape = createNewShape("glass-2", frostGlobals, "rect", placement);
    shape.set(YUNARI_PAINT_PROPERTY, {
      fill: frostedShapeFill(
        frostGlobals,
        "palette.panel",
      ) as `palette.${string}`,
    });
    shape.set(YUNARI_GLASS_PROPERTY, { blurRadius: 16 });

    const revived = await revive(saved(shape));
    const after = saved(revived);

    expect(
      validateFabricThemeEnvelope(envelopeWith(after, frostGlobals)).ok,
    ).toBe(true);
    expect(revived.get(YUNARI_PAINT_PROPERTY)).toEqual({
      fill: "palette.frost",
    });
    expect(revived.get(YUNARI_GLASS_PROPERTY)).toEqual({ blurRadius: 16 });
  });
});

describe("a new shape through the persisted envelope", () => {
  it.each(SHAPE_KINDS)("the validator accepts a saved %s", (kind) => {
    const result = validateFabricThemeEnvelope(
      envelopeWith(
        saved(createNewShape(`shape-${kind}`, globals, kind, placement)),
      ),
    );

    expect(result.ok, kind).toBe(true);
  });

  it.each(SHAPE_KINDS)(
    "a saved %s keeps its own property through revival",
    async (kind) => {
      const before = saved(
        createNewShape(`shape-${kind}`, globals, kind, placement),
      );
      const revived = await revive(before);
      const after = saved(revived);

      // Position and size are the general fields' job; this is the property that
      // belongs to this kind alone, and it is the one a reload would lose. Both
      // sides are compared as saved, because Fabric rounds on export.
      expect(after["left"], kind).toBe(before["left"]);
      expect(after["top"], kind).toBe(before["top"]);
      expect(after["width"], kind).toBe(before["width"]);
      expect(after["height"], kind).toBe(before["height"]);
      expect((revived as { type?: string }).type, kind).toBe(kind);
      expect(after[ownPropertyOf(kind)], kind).toEqual(
        before[ownPropertyOf(kind)],
      );
    },
  );

  it.each(SHAPE_KINDS)(
    "the validator refuses a glass treatment on a %s",
    (kind) => {
      const object = {
        ...saved(createNewShape(`shape-${kind}`, globals, kind, placement)),
        [YUNARI_GLASS_PROPERTY]: { blurRadius: 16 },
      };

      const result = validateFabricThemeEnvelope(envelopeWith(object));

      // The rule is the geometry, not the shape list: the frosted surface needs
      // a closed path to sample the backdrop through, and these five have one.
      // `polyline` and `line` are open; `path` is arbitrary author data whose
      // closedness the product cannot know, so it is refused with them rather
      // than admitted on the hope that a particular path happens to close.
      expect(result.ok, kind).toBe(GLASS_KINDS.has(kind));
    },
  );

  it.each(SHAPE_KINDS)("the validator refuses a %s with no type", (kind) => {
    const object = saved(
      createNewShape(`shape-${kind}`, globals, kind, placement),
    );
    delete object["type"];

    expect(validateFabricThemeEnvelope(envelopeWith(object)).ok).toBe(false);
  });
});

/**
 * The sweep, through save and reopen.
 *
 * An angle that survives only in memory is an angle the author loses on the
 * first reload, which is the difference between a primitive and a drawing
 * tool. Every value the inspector writes is asserted here as *saved* JSON and
 * then read back through the same registry `loadFromJSON` uses, so a kind that
 * revives into something else — the failure a rectangle fallback would produce
 * — cannot pass by reviving at all.
 */
describe("a swept angle through the persisted envelope", () => {
  // Spelled out rather than filtered from `SHAPE_KINDS`: a filter yields an
  // empty sweep while the kinds are missing, and an `it.each` over nothing
  // collects no cases at all — which passes for a suite that is doing its job.
  const SWEPT = ["arc", "wedge"] as const;

  const SWEEPS: readonly [number, number][] = [
    [0, 90],
    [45, 270],
    [270, 360],
  ];

  it("puts both kinds in the one list every surface reads", () => {
    // The single list is the guard against drift: the Add pane and the
    // inspector all read `SHAPE_KINDS`, so a kind absent from it cannot
    // be inserted anywhere and a kind present in two lists can disagree.
    for (const kind of SWEPT) {
      expect(SHAPE_KINDS, kind).toContain(kind);
    }
  });

  it("offers both kinds in the groups the Add pane and the canvas context menu share", () => {
    // The list is only half the claim; what an author can actually insert is
    // `insertGroups`, which is what both surfaces render. Asserting against the
    // list alone would pass with a group builder that filtered the new kinds
    // out — and the shape would then be namable but not insertable.
    const shapes = insertGroups()
      .flatMap((group) => group.objects)
      .filter((object) => object.kind === "shape")
      .map((object) => object.shape);

    for (const kind of SWEPT) {
      expect(shapes, kind).toContain(kind);
      // And it arrives under the name the label table gives it, or the layer
      // list falls back to something else the moment it is inserted.
      expect(newObjectName(kind), kind).toBe(uiCopy.shapeKinds[kind]);
    }
  });

  it.each(SWEPT)(
    "a %s keeps both angles across save and reopen",
    async (kind) => {
      for (const [start, end] of SWEEPS) {
        const before = saved(
          createNewShape(`shape-${kind}`, globals, kind, placement),
        );
        before["startAngle"] = start;
        before["endAngle"] = end;

        const revived = await revive(before);
        const after = saved(revived);

        expect(after["startAngle"], `${kind} ${start}–${end}`).toBe(start);
        expect(after["endAngle"], `${kind} ${start}–${end}`).toBe(end);
      }
    },
  );

  it.each(SWEPT)(
    "a %s arrives at the quarter-disc the vocabulary could not say",
    (kind) => {
      // The case from the spec: a quarter-disc used to be a hand-authored SVG
      // path. These two are what replaced that, and the default has to be the
      // move rather than something an author has to discover and re-angle.
      const shape = createNewShape(`shape-${kind}`, globals, kind, placement);

      expect(shape.get("startAngle")).toBe(0);
      expect(shape.get("endAngle")).toBe(90);
    },
  );
});

/** The one property a kind owns that no other kind has. An ellipse owns none —
    it is width and height like a rectangle — so its kind is what is checked. */
function ownPropertyOf(kind: ShapeKind): string {
  switch (kind) {
    case "rect":
      return "rx";
    // No circle and no triangle: a circle is an ellipse that nothing kept
    // round, and a triangle is a 3-sided polygon. See vg-078.
    case "ellipse":
      return "ry";
    case "polygon":
    case "polyline":
      return "points";
    case "line":
      return "x2";
    case "path":
      return "path";
    // Both swept kinds own their two angles, and an arc owns nothing else:
    // it is a circle's radii with the sector's closing lines left off.
    case "arc":
    case "wedge":
      return "startAngle";
  }
}

/** The reference theme's artboard, and the frame the cascade wraps inside. */
const REFERENCE_ARTBOARD = { width: 1920, height: 1080 } as const;

/**
 * The defect: every object the Add pane inserted landed on the same fixed
 * inset, so three shapes gave three layer rows and **one** visible shape. Each
 * case below is the half of that which fails if the cascade is reverted.
 */
describe("where a new object lands", () => {
  it("puts the first object at the inset", () => {
    // The inset is where an author already expects a new object to appear, and
    // it is the one placement that was already right — the defect was only
    // that every object after it inherited it.
    expect(newObjectPlacement(0, REFERENCE_ARTBOARD)).toEqual({
      left: NEW_OBJECT_INSET,
      top: NEW_OBJECT_INSET,
    });
  });

  it("offsets the second object from the first", () => {
    const first = newObjectPlacement(0, REFERENCE_ARTBOARD);
    const second = newObjectPlacement(1, REFERENCE_ARTBOARD);

    // The measured defect, stated as a difference rather than as a number: any
    // change to the step keeps this true, which is what the property is.
    expect(second).not.toEqual(first);
    expect(second.left).toBeGreaterThan(first.left);
  });

  it("steps the n-th object n steps from the inset", () => {
    for (let index = 1; index < 6; index += 1) {
      const place = newObjectPlacement(index, REFERENCE_ARTBOARD);
      expect(place.left, `object ${index}`).toBe(
        NEW_OBJECT_INSET + index * NEW_OBJECT_STEP,
      );
      expect(place.top, `object ${index}`).toBe(NEW_OBJECT_INSET);
    }
  });

  it("wraps at the artboard edge rather than walking off it", () => {
    // The bound is the artboard, measured against a new object's own
    // footprint: an object outside the authored frame is not shown at all, so a
    // ladder that kept going would put the last objects in the letterbox.
    const across = Math.floor(
      (REFERENCE_ARTBOARD.width - NEW_OBJECT_INSET - NEW_PANEL_SIZE.width) /
        NEW_OBJECT_STEP,
    );
    const down = Math.floor(
      (REFERENCE_ARTBOARD.height - NEW_OBJECT_INSET - NEW_PANEL_SIZE.height) /
        NEW_OBJECT_STEP,
    );

    for (let index = 0; index < (across + 1) * (down + 1) + 20; index += 1) {
      const place = newObjectPlacement(index, REFERENCE_ARTBOARD);
      // The whole object inside the frame, not merely its corner.
      expect(
        place.left + NEW_PANEL_SIZE.width,
        `object ${index} leaves the right edge`,
      ).toBeLessThanOrEqual(REFERENCE_ARTBOARD.width);
      expect(
        place.top + NEW_PANEL_SIZE.height,
        `object ${index} leaves the bottom edge`,
      ).toBeLessThanOrEqual(REFERENCE_ARTBOARD.height);
    }

    // And it really does wrap rather than saturate: the object after a full
    // pass is back at the inset, not parked at the last free step.
    expect(
      newObjectPlacement((across + 1) * (down + 1), REFERENCE_ARTBOARD),
    ).toEqual(newObjectPlacement(0, REFERENCE_ARTBOARD));
  });

  it("keeps every object inside an artboard too small to hold the step", () => {
    // A naive step walks objects off a small artboard, and the author is left
    // inserting things they cannot see. An artboard this size has one slot, and
    // that is where every object goes.
    const tiny = { width: 200, height: 120 };

    for (let index = 0; index < 8; index += 1) {
      expect(newObjectPlacement(index, tiny), `object ${index}`).toEqual({
        left: NEW_OBJECT_INSET,
        top: NEW_OBJECT_INSET,
      });
    }
  });

  it("re-fits the ladder when the artboard is resized", () => {
    // A narrower frame holds fewer steps, so the same n-th object lands
    // somewhere new. That is the point: the artboard is the bound, so a resize
    // has to change the answer or the ladder no longer ends inside the frame.
    const wide = newObjectPlacement(3, REFERENCE_ARTBOARD);
    const narrow = newObjectPlacement(3, { width: 400, height: 300 });

    expect(narrow.left).toBeLessThan(400);
    expect(narrow.top).toBeLessThan(300);
    expect(narrow).not.toEqual(wide);
  });

  it("reads the step off the document, so a removed object frees its slot", () => {
    // The count is the document's own rather than a counter held beside it: an
    // undo that removes an object shortens the ladder, and the next insert
    // fills the gap it left instead of leaving a hole in the staircase. The
    // editor supplies both halves — the canvas it is about to join and the
    // artboard that canvas is a viewport onto — so neither can be a stale copy.
    const withObjects = (count: number) => ({
      canvas: { getObjects: () => Array.from({ length: count }, () => ({})) },
      artboard: () => REFERENCE_ARTBOARD,
    });

    expect(nextNewObjectPlacement(withObjects(2))).toEqual(
      newObjectPlacement(2, REFERENCE_ARTBOARD),
    );
    expect(nextNewObjectPlacement(withObjects(0))).toEqual(
      newObjectPlacement(0, REFERENCE_ARTBOARD),
    );
  });
});

/**
 * The constraint that is not negotiable: **the position is authored; the rule
 * that produced it is not** (§67). Everything here is asserted on the persisted
 * JSON rather than on the live object, because a test on in-memory state
 * passes whether or not the property actually holds.
 */
describe("a new object's placement through the persisted envelope", () => {
  it.each(SHAPE_KINDS)(
    "saves a cascaded %s as a plain coordinate, with no trace of the rule",
    async (kind) => {
      // Placed three steps in, as the third object inserted would be.
      const object = createNewShape(
        `shape-${kind}`,
        globals,
        kind,
        newObjectPlacement(3, REFERENCE_ARTBOARD),
      );
      const json = saved(object);

      // The position the cascade chose is authored, so it is in the document…
      expect(json["left"]).toBe(NEW_OBJECT_INSET + 3 * NEW_OBJECT_STEP);
      expect(json["top"]).toBe(NEW_OBJECT_INSET);
      // …and it is the only thing about the placement that is. No index, no
      // step count, no cascade marker: a reader of the file cannot tell this
      // object was the third, and neither can a machine reopening it.
      expect(Object.keys(json)).toEqual(
        expect.not.arrayContaining([
          "index",
          "step",
          "cascade",
          "slot",
          "placementIndex",
        ]),
      );
      const serialised = JSON.stringify(json);
      expect(serialised).not.toContain("NEW_OBJECT_STEP");
      expect(serialised).not.toContain("cascade");

      // And the round trip is what the property is really for: the revived
      // object stands at the same coordinates, on any machine, whatever the
      // document was called.
      const revived = await revive(json);
      expect(revived.left).toBe(NEW_OBJECT_INSET + 3 * NEW_OBJECT_STEP);
      expect(revived.top).toBe(NEW_OBJECT_INSET);
      expect(validateFabricThemeEnvelope(envelopeWith(json)).ok).toBe(true);
    },
  );

  it("saves two objects at different steps without either recording which", () => {
    // The pair the defect was about: two shapes, one visible. Distinct
    // coordinates in the document, and no ordering information beyond them.
    const first = saved(
      createNewShape(
        "rect-a",
        globals,
        "rect",
        newObjectPlacement(0, REFERENCE_ARTBOARD),
      ),
    );
    const second = saved(
      createNewShape(
        "rect-b",
        globals,
        "rect",
        newObjectPlacement(1, REFERENCE_ARTBOARD),
      ),
    );

    expect([first["left"], first["top"]]).not.toEqual([
      second["left"],
      second["top"],
    ]);
    // Swapping their positions is indistinguishable from never having a
    // cascade: the document holds coordinates, and coordinates are all.
    expect(Object.keys(first).sort()).toEqual(Object.keys(second).sort());
  });
});
