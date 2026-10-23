// @vitest-environment jsdom

import type { Binding, FabricGlobals } from "@yunari/renderer-core";
import { validateFabricThemeEnvelope } from "@yunari/renderer-core";
import { reviveScene, serialiseScene } from "@yunari/scene-fabric";
import { Canvas, type FabricObject, Group, util } from "fabric/es";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CARD_LIBRARY,
  type CardUnit,
  insertCard,
  instantiateCard,
} from "./card-library.js";
import { createNewFabricTheme } from "./new-fabric-theme.js";
import { cpuCard } from "./new-fabric-theme-cards.js";
import type { ObjectJson } from "./new-fabric-theme-objects.js";
import { uiCopy } from "./ui-copy.js";

// jsdom cannot drawImage an undecoded img, and a card carries a frosted panel,
// a gauge and a sparkline. Same proxy `starter-round-trip.dom.test.ts` installs.
beforeEach(() => {
  const real = document.createElement("canvas").getContext("2d");
  if (real === null) return;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      new Proxy(real, {
        get(target, property) {
          if (property === "drawImage") return (): void => {};
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
        set(target, property, value) {
          if (property === "patternQuality") return true;
          return Reflect.set(target, property, value);
        },
      }) as unknown as CanvasRenderingContext2D,
  );
});

const CPU_CARD = "group-cpu-card";
/** The frosted panel and the six parts printed on it; stated so a card that
 *  gained or lost a part fails here rather than quietly re-basing the rest. */
const CPU_PARTS = 7;

/** The starter's own globals, so a card's every reference resolves. */
const STARTER_GLOBALS = createNewFabricTheme().globals as FabricGlobals;

function unit(cardId: string) {
  const found = CARD_LIBRARY.find((candidate) => candidate.id === cardId);
  if (found === undefined) throw new Error(`no ${cardId} unit`);
  return found;
}

/** A card's parts, as the plain records the factories authored them as. */
function partsOf(card: ObjectJson): readonly ObjectJson[] {
  const children = card["objects"];
  return Array.isArray(children) ? children.filter(isRecord) : [];
}

function isRecord(value: unknown): value is ObjectJson {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stage(): Canvas {
  const element = document.createElement("canvas");
  element.width = 1672;
  element.height = 941;
  document.body.append(element);
  return new Canvas(element);
}

/** Fabric's own revival, so the serialised scene is the one a save would write. */
async function enliven(card: ObjectJson): Promise<Canvas> {
  const canvas = stage();
  const [object] = await util.enlivenObjects<FabricObject>([card]);
  if (object === undefined) throw new Error("the card could not be revived");
  canvas.add(object);
  return canvas;
}

/** The surface an insertion writes through: the canvas, the history and the
 *  diagnostics, exactly as the editor's own managers use them. */
function editorStub(canvas: Canvas) {
  return {
    canvas,
    artboard: () => ({ width: 1672, height: 941 }),
    historyManager: { saveState: vi.fn() },
    errorManager: { warn: vi.fn(), error: vi.fn() },
  };
}

/** One session's envelope, as the bindings written into it accumulate. */
class Envelope {
  readonly bindings: Record<string, readonly Binding[]> = {};

  readonly write = (
    additions: Readonly<Record<string, readonly Binding[]>>,
  ): void => {
    Object.assign(this.bindings, additions);
  };
}

/** Inserts into `envelope` the way the session does: the readings already
 *  carried go in to be read, the new ones come back out. */
async function insert(
  canvas: Canvas,
  envelope: Envelope,
  cardId = CPU_CARD,
  globals: FabricGlobals | undefined = STARTER_GLOBALS,
): Promise<void> {
  await insertCard(editorStub(canvas) as never, cardId, {
    globals,
    bindings: envelope.bindings,
    onBindings: envelope.write,
  });
}

/** The readings one copy carries, read off its own parts on the canvas. */
function readingsOf(
  envelope: Envelope,
  card: FabricObject,
): readonly Binding[] {
  if (!(card instanceof Group)) throw new Error("a copy is a group");
  return card
    .getObjects()
    .flatMap((child) => envelope.bindings[String(child.get("id"))] ?? []);
}

function copy(canvas: Canvas): FabricObject {
  const object = canvas
    .getObjects()
    .find((candidate) => candidate.get("provenance") !== undefined);
  if (object === undefined) throw new Error("nothing was inserted");
  return object;
}

function copies(canvas: Canvas): FabricObject[] {
  return canvas.getObjects().filter((object) => object instanceof Group);
}

describe("the card library", () => {
  it("offers one unit per card the starter itself draws", () => {
    const scene = createNewFabricTheme().scene[
      "objects"
    ] as readonly ObjectJson[];
    const cards = scene.filter((object) => object["type"] === "Group");
    const objects: ObjectJson[] = [];
    const walk = (list: readonly ObjectJson[]): void => {
      for (const object of list) {
        objects.push(object);
        walk(partsOf(object));
      }
    };
    walk(scene);

    expect(CARD_LIBRARY.map((entry) => entry.id)).toEqual([
      "group-time-card",
      "group-cpu-card",
      "group-gpu-card",
      "group-ram-card",
      "group-vram-card",
      "group-trends-card",
      "group-storage-card",
      "group-network-card",
    ]);
    for (const entry of CARD_LIBRARY) {
      expect(
        cards.some((object) => object["id"] === entry.id),
        `${entry.id} is a card in the starter`,
      ).toBe(true);
    }

    // The stamp the library offers is the stamp the starter's own card carries: the
    // row on the reference composition and the row a copy makes are the same fact.
    // The word is not compared — both sides read `uiCopy.cardLibrary` (vg-168).
    for (const card of cards) {
      const id = String(card["id"]);
      const unit = CARD_LIBRARY.find((entry) => entry.id === id);
      expect(card["provenance"], `${id} carries no stamp`).toMatchObject({
        widgetId: unit?.id,
      });
    }
    // And nothing else in the starter claims to be a unit — a loose label, a part
    // inside a card, and the rest of the composition all read as themselves.
    for (const object of objects) {
      if (object["type"] === "Group") continue;
      expect(
        object["provenance"],
        `${String(object["id"])} is not a unit`,
      ).toBeUndefined();
    }
  });

  it("names one diagram per unit, so a tile depicts the unit it inserts", () => {
    // The pane maps this name to a glyph and fails to compile on one it does
    // not know, so the library's half is what is pinned here: one diagram per
    // unit, in the library's order — a ninth card cannot arrive undrawn, and
    // **no two units share a picture**, which is what makes the diagram an
    // identification rather than decoration (§5.2).
    const diagrams = CARD_LIBRARY.map((entry) => entry.diagram);
    expect(diagrams).toEqual([
      "time",
      "cpu",
      "gpu",
      "ram",
      "vram",
      "trends",
      "storage",
      "network",
    ]);
    expect(new Set(diagrams).size).toBe(CARD_LIBRARY.length);
  });

  // THE property. A copy that reused an id would be a twin the second save
  // refuses; a copy that minted a semantic key would be bound to a sensor
  // nobody publishes, and would arrive showing nothing (§93).
  it("inserts one card twice as two objects with different ids and the same semantic keys", async () => {
    const canvas = stage();
    const envelope = new Envelope();

    await insert(canvas, envelope);
    await insert(canvas, envelope);

    const [first, second] = copies(canvas);
    expect(copies(canvas)).toHaveLength(2);
    expect(first?.get("id")).toBe(`card-${CPU_CARD}`);
    expect(second?.get("id")).toBe(`card-${CPU_CARD}-2`);

    const firstReadings = readingsOf(envelope, first as FabricObject);
    const secondReadings = readingsOf(envelope, second as FabricObject);
    // The CPU card's own four, read off its parts: load, model name, the
    // sparkline's own load series and the clock.
    expect(firstReadings.map((b) => b.semanticKey).sort()).toEqual([
      "cpu.brand",
      "cpu.clock",
      "cpu.load",
      "cpu.load",
    ]);
    // Same readings, in the same order: this is the CPU card again.
    expect(secondReadings.map((b) => b.semanticKey)).toEqual(
      firstReadings.map((b) => b.semanticKey),
    );
    // And a fresh binding identity for each. A binding id is unique across the
    // document — the validator refuses one used twice — and it is not an object
    // id, so a copy that watched only the canvas would mint the second copy's
    // `cpu.load` onto the first copy's id and leave a document that cannot be
    // saved, reported nowhere.
    expect(secondReadings.map((b) => b.id)).not.toEqual(
      firstReadings.map((b) => b.id),
    );
    expect(secondReadings.map((b) => b.id)).toContain("card-cpu-card-load-2");
    expect(
      new Set(
        Object.values(envelope.bindings).flatMap((list) =>
          list.map((binding) => binding.id),
        ),
      ).size,
    ).toBe(Object.values(envelope.bindings).flatMap((list) => list).length);
  });

  it("keeps the whole card, and joins the scene at the top level", async () => {
    const canvas = stage();
    await insertCard(editorStub(canvas) as never, CPU_CARD, {
      globals: STARTER_GLOBALS,
      onBindings: vi.fn(),
    });

    const card = copy(canvas);
    expect(card).toBeInstanceOf(Group);
    expect((card as Group).getObjects()).toHaveLength(CPU_PARTS);
    expect(canvas.getObjects()).toEqual([card]);
  });

  it("points each run at the binding the copy actually carries", async () => {
    const canvas = stage();
    const envelope = new Envelope();
    await insert(canvas, envelope);

    let pointed = 0;
    for (const part of (copy(canvas) as Group).getObjects()) {
      const authored = part.get("yunariText") as
        | { runs: readonly { kind: string; bindingId?: string }[] }
        | undefined;
      if (authored === undefined) continue;
      const carried = envelope.bindings[String(part.get("id"))] ?? [];
      for (const run of authored.runs) {
        if (run.kind !== "value") continue;
        // THE defect a copy invites: rename the binding, forget the run, and
        // the run paints a placeholder for a sensor sitting right there.
        expect(carried.map((binding) => binding.id)).toContain(run.bindingId);
        pointed += 1;
      }
    }
    expect(pointed).toBeGreaterThan(0);
  });

  it("moves the root only, leaving a part's group-local coordinates alone", () => {
    const built = unit(CPU_CARD).build();
    const copied = instantiateCard({
      unit: unit(CPU_CARD),
      globals: STARTER_GLOBALS,
      existingIds: [],
      origin: { left: 1000, top: 500 },
    }).card;

    expect(copied["left"]).toBe(1000);
    expect(copied["top"]).toBe(500);

    const parts = partsOf(copied);
    const authored = partsOf(built);
    expect(parts).toHaveLength(authored.length);
    // §57: a child's coordinates are group-local, so offsetting them too would
    // shift every descendant twice.
    for (const [index, part] of parts.entries()) {
      expect(part["left"]).toBe(authored[index]?.["left"]);
      expect(part["top"]).toBe(authored[index]?.["top"]);
    }
  });

  it("records which unit the copy came from, on the root alone", () => {
    const copied = instantiateCard({
      unit: unit(CPU_CARD),
      globals: STARTER_GLOBALS,
      existingIds: [],
      origin: { left: 0, top: 0 },
    }).card;

    expect(copied["provenance"]).toEqual({
      widgetId: CPU_CARD,
      widgetName: uiCopy.cardLibrary.cpu,
    });
    expect(copied["name"]).toBe(uiCopy.cardLibrary.cpu);

    // Stamping every descendant would triple a deep card's size to say the
    // same thing.
    for (const part of partsOf(copied)) {
      expect(part["provenance"]).toBeUndefined();
    }
  });

  // Review Focus 5: where a copy came from is a fact, not a naming convention.
  it("keeps that fact across a save and reopen", async () => {
    const canvas = stage();
    await insertCard(editorStub(canvas) as never, CPU_CARD, {
      globals: STARTER_GLOBALS,
      onBindings: vi.fn(),
    });

    const scene = serialiseScene(canvas);
    const reopened = stage();
    await reviveScene(reopened, scene);

    expect(copy(reopened).get("provenance")).toEqual({
      widgetId: CPU_CARD,
      widgetName: uiCopy.cardLibrary.cpu,
    });
  });

  it("names both copies after the unit, so two CPU cards read as two", async () => {
    const canvas = stage();
    for (let n = 0; n < 2; n += 1) {
      await insertCard(editorStub(canvas) as never, CPU_CARD, {
        globals: STARTER_GLOBALS,
        onBindings: vi.fn(),
      });
    }

    expect(canvas.getObjects().map((object) => object.get("name"))).toEqual([
      uiCopy.cardLibrary.cpu,
      uiCopy.cardLibrary.cpu,
    ]);
  });

  it("mints past an id the document already holds rather than shadowing it", async () => {
    const canvas = stage();
    // The document already carries the authored card, so every copied id has
    // something to be distinct from.
    const held = new Group([]);
    held.set("id", `card-${CPU_CARD}`);
    canvas.add(held);

    await insertCard(editorStub(canvas) as never, CPU_CARD, {
      globals: STARTER_GLOBALS,
      onBindings: vi.fn(),
    });

    expect(copy(canvas).get("id")).toBe(`card-${CPU_CARD}-2`);
  });
});

describe("a global this theme cannot supply", () => {
  // §77 makes explicit global mapping the author's decision. Silently inlining
  // would quietly divorce the copy from the theme's tokens; silently dropping
  // would paint it wrong; either would be invisible until someone re-saves.
  it("reports the reference instead of inlining or dropping it", () => {
    const copied = instantiateCard({
      unit: unit(CPU_CARD),
      globals: undefined,
      existingIds: [],
      origin: { left: 0, top: 0 },
    });

    expect(new Set(copied.issues.map((issue) => issue.code))).toEqual(
      new Set(["unmapped-global"]),
    );
    const panel = partsOf(copied.card)[0];
    expect(panel?.["yunariPaint"]).toEqual({
      fill: "palette.frost",
      stroke: "palette.panelStroke",
    });
  });

  it("says which token, so the author can act on it", () => {
    const copied = instantiateCard({
      unit: unit(CPU_CARD),
      globals: undefined,
      existingIds: [],
      origin: { left: 0, top: 0 },
    });

    expect(copied.issues[0]?.detail).toContain("palette.frost");
    expect(copied.issues[0]?.detail).toContain("may mean something else");
  });

  it("refuses to insert, because a card the theme cannot express cannot be saved", async () => {
    const canvas = stage();

    // `snapshot` validates and throws, so a card that arrived anyway would
    // leave a canvas that looks right and a save that fails for the session.
    await expect(
      insertCard(editorStub(canvas) as never, CPU_CARD, {
        globals: undefined,
        onBindings: vi.fn(),
      }),
    ).rejects.toThrow(/palette\.frost/);
    expect(canvas.getObjects()).toHaveLength(0);
  });

  it("accepts a card whose every global the theme does have", () => {
    expect(
      instantiateCard({
        unit: unit(CPU_CARD),
        globals: STARTER_GLOBALS,
        existingIds: [],
        origin: { left: 0, top: 0 },
      }).issues,
    ).toEqual([]);
  });
});

/**
 * A theme whose vocabulary is not the starter's.
 *
 * `vg-128`, and the finding that made it a design question rather than a bug:
 * the old answer was to refuse, which is safe — an unresolved reference reaches
 * `snapshot`, validates and throws — and unusable, because **on the host's
 * default two-token palette every card refused and on a blank theme seven of the
 * eight did**. The library was dead exactly where an author meets it first.
 *
 * These are the pins for the replacement. The card is inserted, it carries
 * nothing the validator will refuse, the author is told what changed, and a
 * theme that genuinely cannot express the card is still refused.
 */
describe("a theme whose vocabulary is not the starter's", () => {
  /**
   * Two tokens the card never names, under the ids a theme is *about* rather
   * than the ids this starter happens to use.
   *
   * The role vocabulary (`paletteTokenRole`) reads a token's id, so the fixture
   * has to use ids the vocabulary recognises — `surface` and `ink` are its own
   * words, and a theme naming its page `page` rather than `surface` falls to
   * the "first token this document happens to have" fallback, exactly as a new
   * object's surface does.
   */
  const FOREIGN: FabricGlobals = {
    palette: {
      none: STARTER_GLOBALS.palette!["none"],
      surface: {
        name: "Surface",
        value: { kind: "solid", color: "#101418" },
      },
      ink: { name: "Ink", value: { kind: "solid", color: "#e8f0fa" } },
    },
    typePresets: {
      label: {
        name: "Label",
        value: { family: "Inter, sans-serif", size: 14, trioRole: "body" },
      },
    },
  } as FabricGlobals;

  it("inserts the card rather than refusing it", async () => {
    const canvas = stage();
    const editor = editorStub(canvas);

    await insertCard(editor as never, CPU_CARD, {
      globals: FOREIGN,
      onBindings: vi.fn(),
    });

    expect(canvas.getObjects()).toHaveLength(1);
    expect(copy(canvas)).toBeInstanceOf(Group);
  });

  it("carries no unresolved reference, so the document still saves", () => {
    // The pin that matters most. Every other assertion in this block would
    // pass on a card that looks right and refuses to save — which is the exact
    // failure the refusal was there to prevent, and the reason this is asserted
    // against `validateFabricThemeEnvelope` rather than by reading the refs.
    //
    // The document's background is re-pointed at this theme's own palette:
    // `surface` is a token FOREIGN declares, so the paint resolves here rather
    // than relying on the starter's transparent `none`.
    const copied = instantiateCard({
      unit: unit(CPU_CARD),
      globals: FOREIGN,
      existingIds: [],
      origin: { left: 0, top: 0 },
    });

    const envelope = {
      ...createNewFabricTheme(),
      artboard: {
        width: 1672,
        height: 941,
      },
      background: { color: { ref: "palette.surface" } },
      globals: FOREIGN,
      // The starter's own bindings name objects this scene does not carry, so
      // keeping them would fail the envelope on `unresolved-binding-ref` — the
      // card's own readings are added below and are what the claim is about.
      bindings: copied.bindings,
      scene: { version: "7.4.0", objects: [copied.card] },
    };

    // `ok`, not a filter on the issue codes: the whole claim is that the
    // document is saveable, and a card that carried one unresolved reference
    // among several other issues would pass a filter naming only that one.
    expect(validateFabricThemeEnvelope(envelope).ok).toBe(true);
  });

  it("tells the author which tokens were substituted, by name", async () => {
    const editor = editorStub(stage());

    await insertCard(editor as never, CPU_CARD, {
      globals: FOREIGN,
      onBindings: vi.fn(),
    });

    const [category, message] = editor.errorManager.warn.mock.calls[0]!;
    expect(category).toBe("controls");
    // Naming the token is the whole point: a card painted in a colour the
    // author did not choose, with nothing saying which one to edit, is a card
    // they cannot correct.
    expect(message).toContain("palette.frost");
    expect(message).toContain("palette.text");
  });

  it("maps by role, so a surface never lands on an ink", () => {
    const copied = instantiateCard({
      unit: unit(CPU_CARD),
      globals: FOREIGN,
      existingIds: [],
      origin: { left: 0, top: 0 },
    });

    // `frost` is the card's box and `surface` is the theme's; `panelStroke` and
    // `cpu` are ink and `ink` is the theme's. Answering both by "the first
    // token" would put the card's own surface on the theme's ink — a caption on
    // a caption, which is the failure the roles exist to prevent.
    const panel = partsOf(copied.card)[0];
    expect(panel?.["yunariPaint"]).toEqual({
      fill: "palette.surface",
      stroke: "palette.ink",
    });
  });

  it("is still refused when the theme has no token to map onto at all", async () => {
    // A document with no palette cannot express a painted card, and the
    // validator refuses a literal here too — so the refusal stands. This is the
    // case the original rule was written for, and it must not have been traded
    // away for the mapping.
    await expect(
      insertCard(editorStub(stage()) as never, CPU_CARD, {
        globals: undefined,
        onBindings: vi.fn(),
      }),
    ).rejects.toThrow(/palette\.frost/);
  });

  it("says nothing when every token was already there", async () => {
    const editor = editorStub(stage());

    await insertCard(editor as never, CPU_CARD, {
      globals: STARTER_GLOBALS,
      onBindings: vi.fn(),
    });

    expect(editor.errorManager.warn).not.toHaveBeenCalled();
  });
});

/**
 * A card that declares one id twice.
 *
 * `WidgetIssue["id-collision"]` was unreachable from `card-library.ts`: the
 * `claim` walk minted per authored id with no `has` guard, so both copies took
 * one id and the envelope validator answered `duplicate-id` — after which
 * `snapshot()` throws and **every later save in that session fails, reported
 * nowhere**. That is the same unsaveable-session outcome `insertCard` refuses
 * to create for `unmapped-global`, arriving by the other door, so the guard is
 * the one `claim()` in `widget.ts` keeps and the extraction left behind.
 */
describe("a card that declares one id twice", () => {
  /** The CPU card with its title part renamed onto its value part's id. */
  const DUPLICATE_CARD: CardUnit = {
    id: "group-duplicate-card",
    label: "Duplicate",
    diagram: "cpu",
    build: () => {
      const card = cpuCard();
      const parts = card["objects"] as readonly ObjectJson[];
      const renamed = parts.map((part) =>
        part["id"] === "cpu-card-title"
          ? { ...part, id: "cpu-card-value" }
          : part,
      );
      return { ...card, objects: renamed };
    },
  };

  const copied = (): ReturnType<typeof instantiateCard> =>
    instantiateCard({
      unit: DUPLICATE_CARD,
      globals: STARTER_GLOBALS,
      existingIds: [],
      origin: { left: 0, top: 0 },
    });

  it("reports the collision, by name", () => {
    const issue = copied().issues.find(
      (entry) => entry.code === "id-collision",
    );

    expect(issue).toBeDefined();
    expect(issue?.detail).toContain("cpu-card-value");
  });

  it("gives each declaration an id of its own, so nothing collides", () => {
    const parts = partsOf(copied().card);
    const ids = parts.map((part) => part["id"]);

    // The defect: both copies at one id is what the validator refuses. The
    // second is numbered the way a second *insertion* would number it, so a
    // duplicate reads as a copy rather than as an accident.
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("card-cpu-card-value");
    expect(ids).toContain("card-cpu-card-value-2");
  });

  it("still serialises and validates — the session stays saveable", async () => {
    // The whole reason the guard exists. `validateFabricThemeEnvelope` is what
    // `snapshot()` calls before every save, and it answers `duplicate-id` for
    // two objects at one id, so a copy that fails here fails every later save.
    const copy = copied();
    const scene = serialiseScene(
      await enliven(copy.card),
    ) as unknown as Readonly<Record<string, unknown>>;

    const result = validateFabricThemeEnvelope({
      schemaVersion: 2,
      fabricVersion: "7.4.0",
      id: "duplicate-card",
      // Carried from the starter rather than restated: the validator requires a
      // declared language, and a restated one is a second place to forget it.
      metadata: { themeLanguage: "en" },
      artboard: { width: 1672, height: 941 },
      scene,
      bindings: copy.bindings,
      globals: STARTER_GLOBALS,
    });

    expect(result.ok).toBe(true);
  });

  it("keeps the readings on one copy, so no binding id is claimed twice", () => {
    const copy = copied();
    const ids = Object.values(copy.bindings).flatMap((list) =>
      list.map((binding) => binding.id),
    );

    // A binding id is unique across the document. Two copies of one
    // declaration cannot both carry them without the validator refusing the
    // pair, so the first keeps them and the second arrives with none — reported
    // as the collision it is, rather than as a document that cannot be saved.
    expect(new Set(ids).size).toBe(ids.length);
    // The CPU card's four readings survive, under the first declaration's id.
    expect(ids).toHaveLength(4);
    expect(Object.keys(copy.bindings)).toContain("card-cpu-card-value");
    expect(Object.keys(copy.bindings)).not.toContain("card-cpu-card-value-2");
  });
});

/**
 * A card that declares one id twice *and* carries a part already named `…-2`.
 *
 * The `-2` suffix the guard mints a repeated declaration under is a real id an
 * author may already have written, and `createWidgetIdAllocator` memoises **by
 * key** — so asking for `…-2` twice answers with the id already issued for the
 * genuine part. `nth` is 1 for that genuine part, so no second `id-collision`
 * is reported and `declared` says one, and the duplicate is silent: two objects
 * at one id, `sceneObject` answers `duplicate-id`, `snapshot()` throws and every
 * later save in that session fails — the same outcome the guard above exists to
 * close, arriving by the numbering it introduced.
 *
 * No shipped card part carries a `-2` suffix, so nothing here is a regression
 * anyone can reach today. It is a hole in a guard added one commit ago, and the
 * pin is what says the hole is closed rather than merely unreached.
 */
describe("a card whose repeat mints the suffix a genuine part already holds", () => {
  /** The CPU card with its title onto its value part's id — a repeat — and one
   *  extra part genuinely named `cpu-card-value-2`. Both declared at once. */
  const SUFFIX_CARD: CardUnit = {
    id: "group-suffix-card",
    label: "Suffix",
    diagram: "cpu",
    build: () => {
      const card = cpuCard();
      const parts = card["objects"] as readonly ObjectJson[];
      const renamed = parts.map((part) =>
        part["id"] === "cpu-card-title"
          ? { ...part, id: "cpu-card-value" }
          : part,
      );
      // A ninth part, carrying the icon's own shape so it is a real object and
      // not a bare record: it claims `cpu-card-value-2` for itself, which is
      // the id the repeat will mint under.
      const icon = parts.find((part) => part["id"] === "cpu-card-icon");
      if (icon === undefined) throw new Error("no icon to clone");
      return {
        ...card,
        objects: [...renamed, { ...icon, id: "cpu-card-value-2" }],
      };
    },
  };

  const copied = (): ReturnType<typeof instantiateCard> =>
    instantiateCard({
      unit: SUFFIX_CARD,
      globals: STARTER_GLOBALS,
      existingIds: [],
      origin: { left: 0, top: 0 },
    });

  it("reports the collision, by name", () => {
    const issues = copied().issues.filter(
      (entry) => entry.code === "id-collision",
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.detail).toContain("cpu-card-value");
  });

  it("mints the repeat past the genuine `-2`, so no two parts share an id", () => {
    const ids = partsOf(copied().card).map((part) => part["id"]);

    // The defect: `nth === 1` for the genuine `-2`, so the second `…-2` key
    // returns the memoised id and both parts sit at it — which the envelope
    // validator refuses, leaving a canvas that looks right and a save that
    // fails for the rest of the session, told nothing.
    expect(ids).toHaveLength(CPU_PARTS + 1);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("card-cpu-card-value-2");
  });

  it("still serialises and validates — the session stays saveable", async () => {
    // The claim the test above it pins for one duplicate shape does not cover
    // this one, so it is stated again here: `validateFabricThemeEnvelope` is
    // what `snapshot()` calls before every save.
    const copy = copied();
    const scene = serialiseScene(
      await enliven(copy.card),
    ) as unknown as Readonly<Record<string, unknown>>;

    const result = validateFabricThemeEnvelope({
      schemaVersion: 2,
      fabricVersion: "7.4.0",
      id: "suffix-card",
      // Carried from the starter rather than restated: the validator requires a
      // declared language, and a restated one is a second place to forget it.
      metadata: { themeLanguage: "en" },
      artboard: { width: 1672, height: 941 },
      scene,
      bindings: copy.bindings,
      globals: STARTER_GLOBALS,
    });

    expect(result.ok).toBe(true);
  });

  it("records that the bump costs no reading — a fact, not a pin", () => {
    // **This cannot fail, and is not counted as coverage.** `cardBindings`
    // keys off `createNewFabricTheme().bindings`, which has no
    // `cpu-card-value-2` entry, so the bumped part carries `null` bindings in
    // *both* arms and the equality below is structurally forced whatever the
    // bump does — verified by mutation: deleting the `-2` bump loop leaves this
    // green. The two pins are `mints the repeat past the genuine -2` and
    // `still serialises and validates`, and both catch that mutation.
    //
    // What is worth recording is the property itself: the repeat alone, with no
    // genuine `-2` beside it, is the same card minus the collision, and every
    // reading the first copy carried survives the bump.
    const repeatOnly = instantiateCard({
      unit: {
        id: "group-repeat-card",
        label: "Repeat",
        diagram: "cpu",
        build: () => {
          const card = cpuCard();
          const parts = card["objects"] as readonly ObjectJson[];
          return {
            ...card,
            objects: parts.map((part) =>
              part["id"] === "cpu-card-title"
                ? { ...part, id: "cpu-card-value" }
                : part,
            ),
          };
        },
      },
      globals: STARTER_GLOBALS,
      existingIds: [],
      origin: { left: 0, top: 0 },
    });

    expect(Object.keys(copied().bindings).sort()).toEqual(
      Object.keys(repeatOnly.bindings).sort(),
    );
    const bindings = Object.values(copied().bindings).flatMap((list) =>
      list.map((binding) => binding.id),
    );
    // And a binding id is unique across the document, so bumping must not have
    // traded one collision for another.
    expect(new Set(bindings).size).toBe(bindings.length);
  });
});

describe("cards this theme cannot express", () => {
  it("refuses a card the library does not have, by name", async () => {
    await expect(
      insertCard(editorStub(stage()) as never, "group-twin-card", {
        globals: STARTER_GLOBALS,
        onBindings: vi.fn(),
      }),
    ).rejects.toThrow(/group-twin-card/);
  });
});
