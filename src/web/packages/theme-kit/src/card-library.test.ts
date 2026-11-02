// @vitest-environment node

import type { Binding, FabricGlobals } from "@yunari/renderer-core";
import { validateFabricThemeEnvelope } from "@yunari/renderer-core";
import { describe, expect, it } from "vitest";
import {
  CARD_LIBRARY,
  type CardUnit,
  cpuCard,
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

function unit(cardId: string): CardUnit {
  const found = CARD_LIBRARY.find((candidate) => candidate.id === cardId);
  if (found === undefined) throw new Error(`no ${cardId} unit`);
  return found;
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

describe("the card library", () => {
  it("offers one unit per card the starter itself draws", () => {
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
    expect(CARD_LIBRARY.map((entry) => entry.diagram)).toEqual([
      "time",
      "cpu",
      "gpu",
      "ram",
      "vram",
      "trends",
      "storage",
      "network",
    ]);
    expect(new Set(CARD_LIBRARY.map((entry) => entry.diagram)).size).toBe(
      CARD_LIBRARY.length,
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
      schemaVersion: "2.0.0" as const,
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
});
