// @vitest-environment jsdom

import type { Binding, FabricGlobals } from "@yunari/renderer-core";
import { validateFabricThemeEnvelope } from "@yunari/renderer-core";
import { reviveScene, serialiseScene } from "@yunari/scene-fabric";
import {
  type CardUnit,
  cpuCard,
  instantiateCard,
  type ObjectJson,
  starterTypeTokens,
} from "@yunari/theme-kit";
import { Canvas, type FabricObject, Group, util } from "fabric/es";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { insertCard } from "./card-library.js";
import { createNewFabricTheme } from "./new-fabric-theme.js";
import { installStarterUnits } from "./testing/widget-units.js";
import { activeWidgetUnits } from "./widget-packs.js";

beforeAll(async () => {
  await installStarterUnits();
});

/** A starter unit's label, as the installed pack declares it. */
function unitLabel(id: string): string {
  const unit = activeWidgetUnits().find((candidate) => candidate.id === id);
  if (unit === undefined) throw new Error(`no installed unit "${id}"`);
  return unit.label;
}

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
    historyManager: { attachEnvelope: () => {}, saveState: vi.fn() },
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

    expect(activeWidgetUnits().map((entry) => entry.id)).toEqual([
      "group-time-card",
      "group-cpu-card",
      "group-gpu-card",
      "group-ram-card",
      "group-vram-card",
      "group-trends-card",
      "group-storage-card",
      "group-network-card",
    ]);
    for (const entry of activeWidgetUnits()) {
      expect(
        cards.some((object) => object["id"] === entry.id),
        `${entry.id} is a card in the starter`,
      ).toBe(true);
    }

    // The stamp the library offers is the stamp the starter's own card carries: the
    // row on the reference composition and the row a copy makes are the same fact.
    // The word is not compared — both sides read the installed unit.
    for (const card of cards) {
      const id = String(card["id"]);
      const unit = activeWidgetUnits().find((entry) => entry.id === id);
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
      widgetName: unitLabel(CPU_CARD),
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
      unitLabel(CPU_CARD),
      unitLabel(CPU_CARD),
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
});

/**
 * A theme whose vocabulary is not the starter's.
 *
 * This is the design question the library has to answer: refusing is safe — an
 * unresolved reference reaches `snapshot`, validates and throws — and unusable,
 * because **on the host's default two-token palette every card would refuse and
 * on a blank theme seven of the eight would**. The library would be dead exactly
 * where an author meets it first.
 *
 * These are the pins for what the library does instead. The card is inserted, it
 * carries nothing the validator will refuse, the author is told what changed, and
 * a theme that genuinely cannot express the card is still refused.
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
    typeTokens: {
      label: { family: "Inter, sans-serif" },
      ...starterTypeTokens,
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

  it("refuses a type reference the theme has no token for, and names it", async () => {
    // A run must reference a token the document declares, so a theme with no
    // type token cannot express the card at all. Dropping the reference would
    // leave a document that looks right and refuses to save.
    await expect(
      insertCard(editorStub(stage()) as never, CPU_CARD, {
        globals: { palette: STARTER_GLOBALS.palette } as FabricGlobals,
        onBindings: vi.fn(),
      }),
    ).rejects.toThrow(/typeTokens\.body/);
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

  it("still serialises and validates — the session stays saveable", async () => {
    // The whole reason the guard exists. `validateFabricThemeEnvelope` is what
    // `snapshot()` calls before every save, and it answers `duplicate-id` for
    // two objects at one id, so a copy that fails here fails every later save.
    const copy = copied();
    const scene = serialiseScene(
      await enliven(copy.card),
    ) as unknown as Readonly<Record<string, unknown>>;

    const result = validateFabricThemeEnvelope({
      schemaVersion: "2.0.0",
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

  it("still serialises and validates — the session stays saveable", async () => {
    // The claim the test above it pins for one duplicate shape does not cover
    // this one, so it is stated again here: `validateFabricThemeEnvelope` is
    // what `snapshot()` calls before every save.
    const copy = copied();
    const scene = serialiseScene(
      await enliven(copy.card),
    ) as unknown as Readonly<Record<string, unknown>>;

    const result = validateFabricThemeEnvelope({
      schemaVersion: "2.0.0",
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
