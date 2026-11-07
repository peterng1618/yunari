// @vitest-environment node

import type { Binding, FabricGlobals } from "@yunari/renderer-core";
import { validateFabricThemeEnvelope } from "@yunari/renderer-core";
import { describe, expect, it } from "vitest";
import {
  type CardUnit,
  instantiateCard,
  type ObjectJson,
  starterPalette,
  starterTypeTokens,
} from "./index.js";

const CPU_CARD = "group-cpu-card";

/** The starter's own globals, so a card's every reference resolves. */
const STARTER_GLOBALS = {
  palette: starterPalette,
  typeTokens: starterTypeTokens,
} as FabricGlobals;

/**
 * A card's readings, keyed by the authored object ids inside its group.
 *
 * A test fixture, not the shipped composition: the shipped cards live in the
 * committed packages now, and this file checks the copier, which must work for
 * any unit an author installs.
 */
const TEST_BINDINGS = {
  "cpu-card-value": [
    { id: "cpu-card-load", semanticKey: "cpu.load", precision: 0 },
  ],
  "cpu-card-sparkline": [{ id: "cpu-card-spark", semanticKey: "cpu.load" }],
  "cpu-card-caption": [{ id: "cpu-card-model", semanticKey: "cpu.brand" }],
  "cpu-card-freq": [
    {
      id: "cpu-card-clock",
      semanticKey: "cpu.clock",
      scale: 0.001,
      precision: 1,
    },
  ],
} as const satisfies Readonly<Record<string, readonly Binding[]>>;

/** A value run in a role the theme always carries, at the card's own size. */
function boundText(
  id: string,
  bindingId: string,
  typeToken: "typeTokens.heading" | "typeTokens.body",
): ObjectJson {
  return {
    type: "Textbox",
    id,
    left: 0,
    top: 0,
    yunariText: {
      runs: [
        {
          kind: "value",
          bindingId,
          typeToken,
          style: {
            color: { ref: "palette.text" },
            fontSize: { value: 90 },
          },
        },
      ],
    },
  };
}

/** A literal run, so the fixture's title is text a validator accepts. */
function literalText(id: string, text: string): ObjectJson {
  return {
    type: "Textbox",
    id,
    left: 0,
    top: 0,
    yunariText: {
      runs: [
        {
          kind: "literal",
          text,
          typeToken: "typeTokens.heading",
          style: {
            color: { ref: "palette.text" },
            fontSize: { value: 24 },
          },
        },
      ],
    },
  };
}

/** The CPU card's shape: a painted group over bound parts, with the ids the
 *  collision tests rename. */
function cpuCard(): ObjectJson {
  return {
    type: "Group",
    id: CPU_CARD,
    left: 0,
    top: 0,
    width: 280,
    height: 307,
    objects: [
      {
        type: "Rect",
        id: "cpu-card",
        left: 0,
        top: 0,
        width: 280,
        height: 307,
        yunariPaint: { fill: "palette.frost", stroke: "palette.panelStroke" },
      },
      {
        type: "Path",
        id: "cpu-card-icon",
        left: 0,
        top: 0,
        path: [
          ["M", 0, 0],
          ["L", 1, 1],
        ],
        strokeWidth: 1,
      },
      literalText("cpu-card-title", "CPU"),
      boundText("cpu-card-value", "cpu-card-load", "typeTokens.heading"),
      boundText("cpu-card-caption", "cpu-card-model", "typeTokens.body"),
      {
        type: "YunariChart",
        id: "cpu-card-sparkline",
        family: "line",
        left: 0,
        top: 0,
        width: 10,
        height: 10,
      },
      boundText("cpu-card-freq", "cpu-card-clock", "typeTokens.body"),
    ],
  };
}

/** One group over one bound part, for the seven cards whose shape the copier
 *  does not inspect beyond the group. */
function simpleCard(id: string, bindingId: string): ObjectJson {
  return {
    type: "Group",
    id,
    left: 0,
    top: 0,
    width: 10,
    height: 10,
    objects: [boundText(`${id}-value`, bindingId, "typeTokens.body")],
  };
}

/** The eight cards as insertion units, with the readings they carry. */
const CARD_UNITS: readonly CardUnit[] = [
  {
    id: "group-time-card",
    label: "Clock",
    diagram: "time",
    build: () => simpleCard("group-time-card", "time"),
  },
  {
    id: CPU_CARD,
    label: "CPU",
    diagram: "cpu",
    build: cpuCard,
    bindings: TEST_BINDINGS,
  },
  {
    id: "group-gpu-card",
    label: "GPU",
    diagram: "gpu",
    build: () => simpleCard("group-gpu-card", "gpu"),
  },
  {
    id: "group-ram-card",
    label: "RAM",
    diagram: "ram",
    build: () => simpleCard("group-ram-card", "ram"),
  },
  {
    id: "group-vram-card",
    label: "VRAM",
    diagram: "vram",
    build: () => simpleCard("group-vram-card", "vram"),
  },
  {
    id: "group-trends-card",
    label: "Performance trends",
    diagram: "trends",
    build: () => simpleCard("group-trends-card", "trends"),
  },
  {
    id: "group-storage-card",
    label: "Storage",
    diagram: "storage",
    build: () => simpleCard("group-storage-card", "storage"),
  },
  {
    id: "group-network-card",
    label: "Network",
    diagram: "network",
    build: () => simpleCard("group-network-card", "network"),
  },
];

function unit(cardId: string): CardUnit {
  const found = CARD_UNITS.find((candidate) => candidate.id === cardId);
  if (found === undefined) throw new Error(`no ${cardId} unit`);
  return found;
}

/** The smallest card the copier accepts: one group over one bound text part. */
function group(id: string, semanticKey: string): ObjectJson {
  return {
    id,
    type: "group",
    left: 0,
    top: 0,
    objects: [
      { id: `${id}-value`, type: "text", text: semanticKey, left: 0, top: 0 },
    ],
  };
}

function partsOf(card: ObjectJson): readonly ObjectJson[] {
  const children = card["objects"];
  return Array.isArray(children) ? children.filter(isRecord) : [];
}

function isRecord(value: unknown): value is ObjectJson {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function atomic(value: ObjectJson): readonly string[] {
  const id = typeof value["id"] === "string" ? [value["id"]] : [];
  return [...id, ...partsOf(value).flatMap(atomic)];
}

function bindingIds(
  bindings: Readonly<Record<string, readonly Binding[]>>,
): readonly string[] {
  return Object.values(bindings)
    .flat()
    .map((binding) => binding.id);
}

/** Every run on every text object in a card, as the document stores them. */
function runsOf(card: ObjectJson): readonly ObjectJson[] {
  const runs: ObjectJson[] = [];
  const visit = (object: ObjectJson): void => {
    const text = object["yunariText"];
    const authored =
      isRecord(text) && Array.isArray(text["runs"]) ? text["runs"] : [];
    for (const run of authored) {
      if (isRecord(run)) runs.push(run);
    }
    for (const child of partsOf(object)) visit(child);
  };
  visit(card);
  return runs;
}

describe("a card unit", () => {
  it("carries the unit's own bindings", () => {
    const unit: CardUnit = {
      id: "group-cpu-card",
      label: "CPU",
      diagram: "cpu",
      build: () => group("group-cpu-card", "cpu.load"),
      bindings: {
        "group-cpu-card": [{ id: "cpu-binding", semanticKey: "cpu.load" }],
      },
    };
    const copy = instantiateCard({
      unit,
      globals: undefined,
      existingIds: [],
      origin: { left: 0, top: 0 },
    });
    expect(copy.bindings["card-group-cpu-card"]?.[0]?.semanticKey).toBe(
      "cpu.load",
    );
  });

  it("inserts one card twice as two objects with different ids and the same semantic keys", () => {
    const first = instantiateCard({
      unit: unit(CPU_CARD),
      globals: STARTER_GLOBALS,
      existingIds: [],
      origin: { left: 0, top: 0 },
    });
    const second = instantiateCard({
      unit: unit(CPU_CARD),
      globals: STARTER_GLOBALS,
      existingIds: atomic(first.card),
      existingBindingIds: bindingIds(first.bindings),
      origin: { left: 0, top: 0 },
    });

    expect(first.card["id"]).toBe(`card-${CPU_CARD}`);
    expect(second.card["id"]).toBe(`card-${CPU_CARD}-2`);
    expect(new Set(atomic(second.card)).size).toBe(atomic(second.card).length);
    expect(new Set(bindingIds(second.bindings)).size).toBe(
      bindingIds(second.bindings).length,
    );
    expect(new Set(bindingIds(first.bindings)).size).toBe(
      bindingIds(first.bindings).length,
    );
    const keys = (bindings: Readonly<Record<string, readonly Binding[]>>) =>
      Object.values(bindings)
        .flat()
        .map((binding) => binding.semanticKey)
        .sort();
    expect(keys(second.bindings)).toEqual(keys(first.bindings));
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
      widgetName: "CPU",
    });
    expect(copied["name"]).toBe("CPU");
    for (const part of partsOf(copied)) {
      expect(part["provenance"]).toBeUndefined();
    }
  });
});

describe("a global this theme cannot supply", () => {
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
    expect(copied.issues[0]?.detail).toContain("palette.frost");
    expect(copied.issues[0]?.detail).toContain("may mean something else");
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

describe("a theme whose vocabulary is not the starter's", () => {
  const FOREIGN: FabricGlobals = {
    palette: {
      none: starterPalette.none,
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

  it("carries no unresolved reference, so the document still saves", () => {
    const copied = instantiateCard({
      unit: unit(CPU_CARD),
      globals: FOREIGN,
      existingIds: [],
      origin: { left: 0, top: 0 },
    });

    const envelope = {
      schemaVersion: "2.1.0" as const,
      fabricVersion: "7.4.0",
      id: "theme",
      artboard: { width: 1672, height: 941 },
      background: { color: { ref: "palette.surface" } },
      metadata: { themeLanguage: "en" },
      globals: FOREIGN,
      bindings: copied.bindings,
      scene: { version: "7.4.0", objects: [copied.card] },
    };
    expect(validateFabricThemeEnvelope(envelope).ok).toBe(true);
  });

  it("maps by role, so a surface never lands on an ink", () => {
    const copied = instantiateCard({
      unit: unit(CPU_CARD),
      globals: FOREIGN,
      existingIds: [],
      origin: { left: 0, top: 0 },
    });

    const panel = partsOf(copied.card)[0];
    expect(panel?.["yunariPaint"]).toEqual({
      fill: "palette.surface",
      stroke: "palette.ink",
    });
    expect(copied.substitutions).toContainEqual({
      from: "palette.frost",
      to: "palette.surface",
    });
  });

  it("keeps the role the theme declares, and the card's own size", () => {
    const copied = instantiateCard({
      unit: unit(CPU_CARD),
      globals: FOREIGN,
      existingIds: [],
      origin: { left: 0, top: 0 },
    });

    const declared = new Set([
      "typeTokens.heading",
      "typeTokens.body",
      "typeTokens.mono",
    ]);
    const visit = (object: ObjectJson): void => {
      const authored = object["yunariText"] as
        | { readonly runs?: ReadonlyArray<Record<string, unknown>> }
        | undefined;
      for (const run of authored?.runs ?? []) {
        expect(declared.has(String(run["typeToken"]))).toBe(true);
      }
      for (const child of partsOf(object)) visit(child);
    };
    visit(copied.card);
    const value = runsOf(copied.card).find((run) => run["kind"] === "value");
    expect(value?.["style"]).toMatchObject({ fontSize: { value: 90 } });
    expect(
      copied.substitutions.filter((entry) =>
        entry.from.startsWith("typeTokens."),
      ),
    ).toEqual([]);
  });
});

describe("a card that declares one id twice", () => {
  const DUPLICATE_CARD: CardUnit = {
    id: "group-duplicate-card",
    label: "Duplicate",
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
    bindings: TEST_BINDINGS,
  };

  const copied = () =>
    instantiateCard({
      unit: DUPLICATE_CARD,
      globals: STARTER_GLOBALS,
      existingIds: [],
      origin: { left: 0, top: 0 },
    });

  it("reports the collision, by name, and gives each declaration its own id", () => {
    const result = copied();
    const issue = result.issues.find((entry) => entry.code === "id-collision");
    expect(issue?.detail).toContain("cpu-card-value");

    const ids = partsOf(result.card).map((part) => part["id"]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("card-cpu-card-value");
    expect(ids).toContain("card-cpu-card-value-2");
  });

  it("keeps the readings on one copy, so no binding id is claimed twice", () => {
    const result = copied();
    const ids = bindingIds(result.bindings);
    expect(new Set(ids).size).toBe(ids.length);
    // The CPU card's four readings survive, under the first declaration's id.
    expect(ids).toHaveLength(4);
    expect(Object.keys(result.bindings)).toContain("card-cpu-card-value");
    expect(Object.keys(result.bindings)).not.toContain("card-cpu-card-value-2");
  });
});

/**
 * The type vocabulary a theme always has is the role ids, and a card names one
 * of those — never the `size-weight` id the old presets were called by.
 */
describe("the type tokens a shipped card names", () => {
  it("is a role the theme always carries, for every card", () => {
    const refs: string[] = [];
    for (const entry of CARD_UNITS) {
      const copied = instantiateCard({
        unit: entry,
        globals: STARTER_GLOBALS,
        existingIds: [],
        origin: { left: 0, top: 0 },
      });
      expect(copied.issues, `${entry.id} does not insert`).toEqual([]);
      expect(
        copied.substitutions,
        `${entry.id} substituted a reference`,
      ).toEqual([]);
      for (const run of runsOf(copied.card)) {
        refs.push(String(run["typeToken"]));
      }
    }

    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect([
        "typeTokens.heading",
        "typeTokens.body",
        "typeTokens.mono",
      ]).toContain(ref);
    }
  });
});

/**
 * A repeat that mints the suffix a genuine part already holds.
 *
 * `createWidgetIdAllocator` memoises by key, so asking twice for `…-2` answers
 * with the id already issued for the genuine part: two objects at one id, and
 * every later save in that session fails.
 */
describe("a card whose repeat mints the suffix a genuine part already holds", () => {
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
      const icon = parts.find((part) => part["id"] === "cpu-card-icon");
      if (icon === undefined) throw new Error("no icon to clone");
      return {
        ...card,
        objects: [...renamed, { ...icon, id: "cpu-card-value-2" }],
      };
    },
    bindings: TEST_BINDINGS,
  };

  const copied = () =>
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

  it("mints the repeat past the genuine -2, so no two parts share an id", () => {
    const ids = partsOf(copied().card).map((part) => part["id"]);
    const authored = partsOf(unit(CPU_CARD).build());
    expect(ids).toHaveLength(authored.length + 1);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("card-cpu-card-value-2");
  });

  it("trades no reading for the bump", () => {
    const bindings = bindingIds(copied().bindings);
    expect(new Set(bindings).size).toBe(bindings.length);
  });
});
