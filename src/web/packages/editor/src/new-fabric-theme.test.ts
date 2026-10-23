// @vitest-environment jsdom

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isKnownSemanticKey,
  isObjectName,
  MAX_OBJECT_NAME_LENGTH,
  validateFabricThemeEnvelope,
} from "@yunari/renderer-core";
import {
  reviveThemeEnvelope,
  serialiseThemeEnvelope,
  YunariChart,
} from "@yunari/scene-fabric";
import { readThemePackage } from "@yunari/theme-package";
import { type FabricObject, Group, StaticCanvas } from "fabric/es";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { CARD_LIBRARY } from "./card-library.js";
import {
  createBlankFabricTheme,
  createNewFabricTheme,
} from "./new-fabric-theme.js";
import { cpuCard } from "./new-fabric-theme-cards.js";
import { starterPalette } from "./new-fabric-theme-globals.js";
import {
  createNewChartDefaults,
  createNewPanelDefaults,
  newObjectPlacement,
} from "./new-object-defaults.js";
import { serializeThemePackage } from "./persist.js";
import { STARTER_BACKDROP_PATH } from "./starter-backdrop.js";

type ObjectJson = Readonly<Record<string, unknown>>;

/**
 * The reference artboard and the box of every card on it, measured off
 * `docs/superpowers/specs/2026-09-26-reference-theme-target.png`: the card
 * borders were located by the transition of its two-pixel outline. Stated here
 * rather than imported from the builder, so the assertion is against the
 * measurement and not against whatever the builder happens to emit.
 *
 * The id is the card's **group**, because the group is the card and carries the
 * panel's measured box; the frosted rectangle inside it is one part.
 */
const ARTBOARD = { width: 1672, height: 941 } as const;

const CARDS: ReadonlyArray<{
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}> = [
  { id: "group-time-card", left: 40, top: 187, width: 367, height: 307 },
  { id: "group-cpu-card", left: 421, top: 187, width: 280, height: 307 },
  { id: "group-gpu-card", left: 715, top: 187, width: 290, height: 307 },
  { id: "group-ram-card", left: 1019, top: 187, width: 299, height: 307 },
  { id: "group-vram-card", left: 1332, top: 187, width: 300, height: 307 },
  // The reference's trends card starts at x 294; this one spans the left
  // column to the 40-unit margin the rest of the composition uses, so the
  // reference's gap for the coffee mug is not reproduced as a hole.
  { id: "group-trends-card", left: 40, top: 507, width: 1084, height: 335 },
  { id: "group-storage-card", left: 1138, top: 507, width: 494, height: 165 },
  { id: "group-network-card", left: 1138, top: 687, width: 494, height: 155 },
];

const objectsOf = (theme: ReturnType<typeof createNewFabricTheme>) =>
  theme.scene.objects as readonly ObjectJson[];

const childrenOf = (object: ObjectJson): readonly ObjectJson[] =>
  (object["objects"] as readonly ObjectJson[] | undefined) ?? [];

/**
 * Every object in the document, at any depth.
 *
 * The starter's cards are groups, so a walk that stops at `scene.objects` sees
 * ten objects and would pass every assertion here by checking nothing: the
 * charts, the icons, the bindings and the prose all live one level down.
 */
const nodesOf = (
  theme: ReturnType<typeof createNewFabricTheme>,
): readonly ObjectJson[] => {
  const walk = (list: readonly ObjectJson[]): readonly ObjectJson[] =>
    list.flatMap((object) => [object, ...walk(childrenOf(object))]);
  return walk(objectsOf(theme));
};

const objectById = (
  theme: ReturnType<typeof createNewFabricTheme>,
  id: string,
) => nodesOf(theme).find((object) => object["id"] === id) ?? {};

const bindingsOf = (theme: ReturnType<typeof createNewFabricTheme>) =>
  theme.bindings ?? {};

const chartsOf = (theme: ReturnType<typeof createNewFabricTheme>) =>
  nodesOf(theme).filter((object) => object["type"] === "YunariChart");

/** Every string the document shows as authored prose, across all text runs. */
const literalText = (theme: ReturnType<typeof createNewFabricTheme>): string =>
  nodesOf(theme)
    .flatMap((object) => {
      const authored = object["yunariText"] as
        | { readonly runs?: ReadonlyArray<Record<string, unknown>> }
        | undefined;
      return (authored?.runs ?? []).map((run) => run["text"]);
    })
    .filter((text): text is string => typeof text === "string")
    .join("\n");

/** Fabric objects at any depth, so a revived starter is read whole. */
const fabricObjectsOf = (canvas: StaticCanvas): readonly FabricObject[] => {
  const walk = (list: readonly FabricObject[]): readonly FabricObject[] =>
    list.flatMap((object) =>
      object instanceof Group
        ? [object, ...walk(object.getObjects())]
        : [object],
    );
  return walk(canvas.getObjects());
};

describe("the new Fabric document", () => {
  it("starts with a validated v2 dashboard on the reference artboard", () => {
    const document_ = createNewFabricTheme();

    expect(validateFabricThemeEnvelope(document_)).toEqual({
      ok: true,
      envelope: document_,
    });
    expect(document_.artboard).toMatchObject(ARTBOARD);
    expect(document_.metadata?.themeLanguage).toBe("en");
    expect(document_.globals?.typePresets).toMatchObject({
      "36-500": { value: { trioRole: "heading" } },
      "90-600": { value: { trioRole: "heading" } },
      "24-400": { value: { trioRole: "body" } },
      mono: { value: { trioRole: "mono" } },
    });
    // **The backdrop is a declared media asset, and nothing paints over it.**
    // The gradient plate it replaced was a scene object sitting on the canvas
    // and an opaque artboard paint behind it, so the media layer mounted below
    // the canvas could not have been seen through either. Both are gone, and
    // the background layer's colour is now the transparent token the media
    // needs.
    expect(document_.background).toMatchObject({
      color: { ref: "palette.none" },
      media: { assetId: "starter-backdrop", bounds: "theme" },
    });
    expect(objectsOf(document_).map((object) => object["id"])).not.toContain(
      "background",
    );
    // The declaration is what the player resolves and what the validator
    // refuses a dangling `assetId` for, so its path and the bytes the editor
    // hands `mount` are one fact, not two.
    expect(document_.assets).toHaveLength(1);
    expect(document_.assets?.[0]).toMatchObject({
      kind: "image",
      path: STARTER_BACKDROP_PATH,
      license: { name: "Unsplash License" },
    });
  });

  it("declares a backdrop whose bytes are really in the repository", () => {
    // A `sha256` in the declaration is a claim about a file, and a claim that
    // is never checked is worse than none. This is that check.
    const declared = createNewFabricTheme().assets?.[0];
    if (declared === undefined) throw new Error("no backdrop is declared");
    const bytes = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "starter-backdrop.jpg"),
    );
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      declared.sha256,
    );
    // JPEG, and the first two bytes say so — the editor types the preview blob
    // from the extension, and a mislabelled file would decode to nothing.
    expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it("binds only keys the vocabulary owns, and every value run resolves", () => {
    // The envelope validator checks that a `semanticKey` is a string of 1-120
    // characters and nothing else, so a validator-green document proves nothing
    // about a binding being live. `isKnownSemanticKey` is the actual vocabulary.
    const theme = createNewFabricTheme();
    const unknown = Object.entries(bindingsOf(theme)).flatMap(
      ([objectId, list]) =>
        list
          .filter((binding) => !isKnownSemanticKey(binding.semanticKey))
          .map((binding) => `${objectId} -> ${binding.semanticKey}`),
    );
    expect(unknown, "a starter binding no provider owns").toEqual([]);

    // A value run names a binding on its own object; pointing at one the object
    // does not declare renders an em dash and an unmapped-key issue instead.
    for (const object of nodesOf(theme)) {
      const id = String(object["id"]);
      const runs = (
        object["yunariText"] as
          | { readonly runs?: ReadonlyArray<Record<string, unknown>> }
          | undefined
      )?.runs;
      if (runs === undefined) continue;
      const declared = new Set(
        (bindingsOf(theme)[id] ?? []).map((binding) => binding.id),
      );
      for (const run of runs)
        if (run["kind"] === "value")
          expect(
            declared.has(String(run["bindingId"])),
            `${id}: ${String(run["bindingId"])}`,
          ).toBe(true);
    }

    // And the other direction: every binding the document declares is declared
    // against an object that still exists. Wrapping the cards in groups is
    // exactly the change that can drop one, and a dropped binding reads on the
    // display as an em dash with nothing to say why.
    const ids = new Set(nodesOf(theme).map((object) => String(object["id"])));
    expect(
      Object.keys(bindingsOf(theme)).filter((id) => !ids.has(id)),
      "a binding naming an object this document no longer has",
    ).toEqual([]);
  });

  it("spells system memory `ram`, never the stale `memory.` name", () => {
    // The defect this replaced: `memory.used` is in no provider's key list, the
    // host synthesises a `missing` sample, and a pie renormalises its remaining
    // slices to a false 100%. The starter now binds a key a provider owns.
    const theme = createNewFabricTheme();
    const keys = Object.values(bindingsOf(theme))
      .flat()
      .map((binding) => binding.semanticKey);
    expect(keys.filter((key) => key.startsWith("memory."))).toEqual([]);
    expect(bindingsOf(theme)["ram-gauge"]).toEqual([
      expect.objectContaining({ semanticKey: "ram.used.percent" }),
    ]);
  });

  it("ships the chart families the reference uses, and no others", () => {
    const charts = chartsOf(createNewFabricTheme());
    const families = charts.map((chart) => chart["family"]);
    const count = (family: string): number =>
      families.filter((value) => value === family).length;

    // Two gauges (partial arc, full ring), four line charts (two sparklines, the
    // performance chart, the network chart) and one bar (storage). The reference
    // has no pie, so the starter no longer ships one.
    expect(count("gauge")).toBe(2);
    expect(count("line")).toBe(4);
    expect(count("bar")).toBe(1);
    expect(families.filter((family) => family === "pie")).toEqual([]);
  });

  it("binds both gauges to a usage percentage over a 0-100 range", () => {
    const theme = createNewFabricTheme();
    // `max` is a plain number with no way to reference `ram.total`, so a gauge
    // bound to the absolute gigabytes would draw a clamped fraction of a total
    // it cannot know. The percentage key is the only honest option.
    expect(bindingsOf(theme)["ram-gauge"]).toEqual([
      expect.objectContaining({ semanticKey: "ram.used.percent" }),
    ]);
    expect(objectById(theme, "ram-gauge")["settings"]).toMatchObject({
      min: 0,
      max: 100,
    });
    expect(bindingsOf(theme)["vram-gauge"]).toEqual([
      expect.objectContaining({ semanticKey: "vram.used.percent" }),
    ]);
    expect(objectById(theme, "vram-gauge")["settings"]).toMatchObject({
      min: 0,
      max: 100,
    });
  });

  it("draws the RAM arc open at the bottom and the VRAM one as a full ring", () => {
    const theme = createNewFabricTheme();
    // Both are settings values on one family, not a new capability: the default
    // 225 -> -45 is the 270-degree arc the reference's RAM card shows, and
    // 0 -> 360 closes it.
    expect(objectById(theme, "ram-gauge")["settings"]).toMatchObject({
      startAngle: 225,
      endAngle: -45,
    });
    expect(objectById(theme, "vram-gauge")["settings"]).toMatchObject({
      startAngle: 0,
      endAngle: 360,
    });
  });

  it("keeps each gauge's capacity label a separate live-text object", () => {
    const theme = createNewFabricTheme();
    // `buildGaugeOption` hides `detail` and `axisLabel` outright, so there is no
    // chart-internal value text to suppress and no choice to make: the number in
    // the middle of a ring is an ordinary text object bound to a reading.
    for (const [gauge, reading] of [
      ["ram-gauge", "ram-value"],
      ["vram-gauge", "vram-value"],
    ] as const) {
      const value = objectById(theme, reading);
      expect(value["type"], reading).toBe("Textbox");
      const runs = (
        value["yunariText"] as { readonly runs: ReadonlyArray<ObjectJson> }
      ).runs;
      expect(runs[0]?.["kind"], reading).toBe("value");
      expect(
        (bindingsOf(theme)[reading] ?? []).map(
          (binding) => binding.semanticKey,
        ),
        reading,
      ).toEqual([
        gauge === "ram-gauge" ? "ram.used.percent" : "vram.used.percent",
      ]);
    }
  });

  it("authors no reading, device name or time axis that nothing supplies", () => {
    const prose = literalText(createNewFabricTheme());
    // Every one of these was authored text standing in for a reading. The
    // device names are now real readings — bound to `cpu.brand`, `gpu.name` and
    // `disk.name`, which resolve from the same device the figures beside them
    // describe — so they must appear as bindings, never as prose. Prose would
    // name one machine's hardware on every machine.
    for (const claim of [
      "7800X3D",
      "RTX 4080",
      "Games (D:)",
      "Seattle",
      "Mostly cloudy",
      "A calmer system",
      "6:30",
      "7:30",
      "All systems nominal",
    ])
      expect(prose, claim).not.toContain(claim);
  });

  it("binds each caption to the key that names the device its card measures", () => {
    const bindings = bindingsOf(createNewFabricTheme());
    const keyOf = (node: string, binding: string) =>
      bindings[node]?.find((b) => b.id === binding)?.semanticKey;

    expect(keyOf("cpu-card-caption", "cpu-card-model")).toBe("cpu.brand");
    expect(keyOf("gpu-card-caption", "gpu-card-model")).toBe("gpu.name");
    expect(keyOf("storage-card-name", "storage-card-volume")).toBe("disk.name");
    // The GPU caption and the GPU figures must resolve from one device, so a
    // theme cannot show card A's load under card B's name.
    expect(keyOf("gpu-card-value", "gpu-card-load")).toBe("gpu.load");
    expect(keyOf("storage-bar", "storage-used")).toBe("disk.used.percent");
  });

  it("names every object after the readable id it already carries", () => {
    const theme = createNewFabricTheme();
    const objects = nodesOf(theme);

    // The showcase theme is the document an author opens to learn from, and a
    // layer list of fifty-odd UUIDs is the problem F1.8 was about, not an
    // example of the fix. The builders already chose a readable id beside every
    // object, so the name is that id promoted — not a second, invented
    // vocabulary. Read at every depth: the cards' parts are children now.
    for (const object of objects) {
      const id = String(object["id"]);
      expect(object["name"], `${id} has no name`).toBe(id);
      // `name` is a bounded label, not free text, and the envelope refuses a
      // value outside the bound at import — so this is checked against the
      // guard's own predicate rather than assumed.
      expect(isObjectName(object["name"]), `${id}'s name is not a label`).toBe(
        true,
      );
      expect(
        String(object["name"]).length,
        `${id} exceeds the published bound`,
      ).toBeLessThanOrEqual(MAX_OBJECT_NAME_LENGTH);
    }

    // Unique across the whole document, not just at the top: a card's parts
    // are one level down now, and two rows reading the same is the same
    // ambiguity one level deeper.
    const names = objects.map((object) => String(object["name"]));
    expect(names).toHaveLength(new Set(names).size);

    // The names must not cost the document its validity: a name the validator
    // refuses would empty the canvas.
    expect(validateFabricThemeEnvelope(theme).ok).toBe(true);
  });

  it("persists those names in the saved package, not at load time", async () => {
    const theme = createNewFabricTheme();
    const canvas = new StaticCanvas(undefined, {
      width: theme.artboard.width,
      height: theme.artboard.height,
    });
    await reviveThemeEnvelope(canvas, theme);
    const saved = serialiseThemeEnvelope(canvas, theme);
    await canvas.dispose();

    // A name the editor added on the way in would be runtime state wearing an
    // authored hat (§67). What is written here is the package, and the names
    // are read back out of its `theme.json` — so this is the file, not a
    // revival of it.
    const bytes = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "starter-backdrop.jpg"),
    );
    const pkg = serializeThemePackage(saved, {
      [STARTER_BACKDROP_PATH]: new Uint8Array(bytes),
    });
    if (!pkg.ok) throw new Error(pkg.message);
    const themeJson = unzipSync(pkg.bytes)["theme.json"];
    if (themeJson === undefined) throw new Error("no theme.json in the zip");
    const written = JSON.parse(strFromU8(themeJson)) as {
      scene: { objects: ReadonlyArray<Record<string, unknown>> };
    };
    const persisted = written.scene.objects;
    const persistedNodes: Array<Record<string, unknown>> = [];
    const walk = (list: ReadonlyArray<Record<string, unknown>>): void => {
      for (const object of list) {
        persistedNodes.push(object);
        walk(
          (object["objects"] as
            | ReadonlyArray<Record<string, unknown>>
            | undefined) ?? [],
        );
      }
    };
    walk(persisted);
    expect(persistedNodes).toHaveLength(nodesOf(theme).length);
    for (const object of persistedNodes) {
      const id = String(object["id"]);
      expect(object["name"], `${id} lost its name in the saved file`).toBe(id);
    }
    // The stamp is authored state too (§67): a stamp the editor added on the way
    // in would be runtime state wearing an authored hat, and it would vanish the
    // first time this document was opened somewhere that derives its own rows.
    for (const unit of CARD_LIBRARY) {
      const card = persistedNodes.find((object) => object["id"] === unit.id);
      expect(
        card?.["provenance"],
        `${unit.id} lost its stamp in the file`,
      ).toMatchObject({ widgetId: unit.id });
    }
    // And the archive is still a package, not a document with extra bytes.
    expect(readThemePackage(pkg.bytes).ok).toBe(true);
  });

  it("places every reference card on its measured box", () => {
    const theme = createNewFabricTheme();
    for (const card of CARDS) {
      // The group *is* the card, and it carries the panel's measured box; the
      // frosted rectangle inside it is one part of that card.
      expect(
        {
          left: objectById(theme, card.id)["left"],
          top: objectById(theme, card.id)["top"],
          width: objectById(theme, card.id)["width"],
          height: objectById(theme, card.id)["height"],
        },
        card.id,
      ).toEqual({
        left: card.left,
        top: card.top,
        width: card.width,
        height: card.height,
      });
    }
  });

  it("keeps every object inside the artboard, measured where it is drawn", async () => {
    // Read from the revived canvas rather than from the document's own `left`:
    // a part inside a group is authored in the group's plane, so its box is only
    // an artboard box once the group transform has been applied to it. This is
    // also the assertion that fails if the group-local conversion is wrong.
    const theme = createNewFabricTheme();
    const { width, height } = theme.artboard;
    const canvas = new StaticCanvas(undefined, {
      width: theme.artboard.width,
      height: theme.artboard.height,
    });
    await reviveThemeEnvelope(canvas, theme);
    const objects = fabricObjectsOf(canvas);
    expect(
      objects.length,
      "no object was measured, so nothing was checked",
    ).toBeGreaterThan(50);
    for (const object of objects) {
      const id = String(object.get("id"));
      const rect = object.getBoundingRect();
      expect(rect.left, `${id} left`).toBeGreaterThanOrEqual(-1);
      expect(rect.top, `${id} top`).toBeGreaterThanOrEqual(-1);
      expect(rect.left + rect.width, `${id} right`).toBeLessThanOrEqual(
        width + 1,
      );
      expect(rect.top + rect.height, `${id} bottom`).toBeLessThanOrEqual(
        height + 1,
      );
    }
    await canvas.dispose();
  });

  it("gives every card the radius and border width measured off the reference", () => {
    const theme = createNewFabricTheme();
    // A card is a stroked Rect; the background is a Rect too, so the match set
    // is filtered rather than assumed. The frosted rectangle is inside its card
    // group now, so the match set is read at every depth.
    const cards = nodesOf(theme).filter(
      (object) => object["type"] === "Rect" && object["stroke"] !== undefined,
    );
    expect(cards.map((card) => card["id"]).sort()).toEqual(
      CARDS.map((card) => card.id.replace("group-", "")).sort(),
    );
    // Measured off docs/superpowers/specs/2026-09-26-reference-theme-target.png:
    // the top border occupies rows 187-188 and the left border columns 40-41 of
    // the 1672-wide reference, and first appears 10px in from the corner.
    for (const card of cards) {
      expect(card["strokeWidth"], String(card["id"])).toBe(2);
      expect(card["rx"], String(card["id"])).toBe(10);
      expect(card["ry"], String(card["id"])).toBe(10);
    }
  });

  it("composes every icon from Lucide, stroked rather than hand-drawn", () => {
    const theme = createNewFabricTheme();
    const icons = nodesOf(theme).filter((object) =>
      String(object["id"]).endsWith("-icon"),
    );
    // Every card the reference shows an icon on: CPU, GPU, RAM, VRAM, trends,
    // storage and network.
    expect(icons.map((icon) => icon["id"]).sort()).toEqual([
      "cpu-card-icon",
      "gpu-card-icon",
      "network-card-icon",
      "ram-card-icon",
      "storage-card-icon",
      "trends-card-icon",
      "vram-card-icon",
    ]);
    for (const icon of icons) {
      const id = String(icon["id"]);
      // Lucide glyphs are strokes on a 24-unit grid, never fills; a filled path
      // here is one of the hand-drawn constants the reference replaces.
      expect(icon["type"], id).toBe("Path");
      expect(Number(icon["strokeWidth"]), id).toBeGreaterThan(0);
      expect(icon["fill"], id).toBeNull();
      const commands = icon["path"] as ReadonlyArray<readonly unknown[]>;
      expect(commands.length, id).toBeGreaterThan(1);
      for (const command of commands)
        for (const value of command.slice(1))
          expect(Number.isFinite(Number(value)), `${id} ${command[0]}`).toBe(
            true,
          );
    }
    // The hand-drawn weather and thermal glyphs are gone, not kept alongside.
    expect(
      objectsOf(theme)
        .map((object) => String(object["id"]))
        .filter((id) => id.endsWith("-svg-path")),
    ).toEqual([]);
  });

  it("tracks only the wordmark and the strapline, and fits their boxes", async () => {
    // Typography, not a value dump. A tracked clock or reading does not read as
    // a clock or a reading: a numeral's advance is a grid cell, and opening it up
    // breaks the column it sits in.
    const theme = createNewFabricTheme();
    const presets = theme.globals?.typePresets as Record<
      string,
      { value: Readonly<Record<string, unknown>> }
    >;
    const spacingOf = (id: string): number | undefined => {
      const value = presets[id]?.value["letterSpacing"];
      return typeof value === "number" ? value : undefined;
    };

    // Tracked: the wordmark and the overline under it. Both values are measured
    // off the reference image rather than judged by eye — see the presets.
    expect(spacingOf("36-500"), "wordmark").toBeGreaterThan(0);
    expect(spacingOf("17-400"), "strapline").toBeGreaterThan(0);

    // Untracked: every other preset, including all the readings.
    for (const id of Object.keys(presets)) {
      if (id === "36-500" || id === "17-400") continue;
      expect(spacingOf(id) ?? 0, id).toBe(0);
    }

    const canvas = new StaticCanvas(undefined, {
      width: theme.artboard.width,
      height: theme.artboard.height,
    });
    await reviveThemeEnvelope(canvas, theme);
    // Keyed off each object's own run reference, not its id: an object id is
    // `ram-value` and the preset it uses is `60-600`.
    const tracked = fabricObjectsOf(canvas).filter((object) => {
      const authored = object.get("yunariText") as
        | { readonly runs?: ReadonlyArray<{ typePreset?: string }> }
        | undefined;
      const ref = authored?.runs?.[0]?.typePreset;
      const preset = ref?.slice("typePresets.".length);
      return preset !== undefined && spacingOf(preset) !== undefined;
    });
    // The fit check first, so an overflow is reported as an overflow rather than
    // as "the tracked set changed".
    for (const object of tracked) {
      const id = String(object.get("id"));
      const lines = (object as { textLines?: string[] }).textLines;
      expect(lines, id).toBeDefined();
      expect(lines?.length, id).toBe(1);
    }
    // A floor against the empty set, which is the loop's one vacuous mode.
    expect(
      tracked.map((object) => object.get("id")),
      "no tracked object was found, so nothing was checked",
    ).not.toHaveLength(0);
    await canvas.dispose();
  });

  it("writes the resolved tracking into every tracked object's own JSON", async () => {
    // Every other preset-derived Fabric field is written into the object, so the
    // starter would declare five of a preset's six and omit the sixth. Not a
    // live bug — the editor applies presets at mount — but the starter is the
    // document every other task copies from.
    const theme = createNewFabricTheme();
    const presets = theme.globals?.typePresets as Record<
      string,
      { value: Readonly<Record<string, unknown>> }
    >;
    const canvas = new StaticCanvas(undefined, {
      width: theme.artboard.width,
      height: theme.artboard.height,
    });
    await reviveThemeEnvelope(canvas, theme);

    const written: Array<[string, number]> = [];
    const absent: string[] = [];
    for (const object of fabricObjectsOf(canvas)) {
      const authored = object.get("yunariText") as
        | { readonly runs?: ReadonlyArray<{ typePreset?: string }> }
        | undefined;
      const presetId = authored?.runs?.[0]?.typePreset?.slice(
        "typePresets.".length,
      );
      if (presetId === undefined) continue;
      if (typeof presets[presetId]?.value["letterSpacing"] !== "number")
        continue;
      const id = String(object.get("id"));
      const writtenValue = object.get("charSpacing") as number;
      if (typeof writtenValue === "number" && writtenValue !== 0)
        written.push([id, writtenValue]);
      else absent.push(id);
    }

    // 28px at 36px is Fabric's 1/1000 em.
    expect(written).toEqual([
      ["wordmark", (28 / 36) * 1000],
      ["strapline", (6 / 17) * 1000],
    ]);
    expect(absent).toEqual([]);
    await canvas.dispose();
  });

  it("ships a frosted CPU card whose value and sparkline read one live key", async () => {
    const theme = createNewFabricTheme();

    // The panel is an ordinary card rectangle carrying the treatment the
    // inspector's glass control reads and writes — not a bespoke object kind.
    // Its fill is `frost`, not `panel`: at `panel`'s 85 % alpha the backdrop
    // behind this card reached the eye at 2.40/255 of contrast, measured, and
    // a blur applied under an almost-opaque panel is a blur of nothing.
    const card = objectById(theme, "cpu-card");
    expect(card).toMatchObject({
      type: "Rect",
      yunariPaint: { fill: "palette.frost", stroke: "palette.panelStroke" },
      yunariGlass: { blurRadius: expect.any(Number) },
    });
    const treatment = card["yunariGlass"] as { blurRadius: number };
    expect(treatment.blurRadius).toBeGreaterThan(0);
    // The published bound, read from the schema the validator enforces rather
    // than from a constant this package does not own.
    const schema = JSON.parse(
      readFileSync(
        resolve(
          dirname(fileURLToPath(import.meta.url)),
          "../../../../../schema/theme-document.schema.json",
        ),
        "utf8",
      ),
    ) as {
      $defs: Record<
        string,
        { properties?: Record<string, { maximum: number }> }
      >;
    };
    expect(treatment.blurRadius).toBeLessThanOrEqual(
      schema.$defs["glassTreatment"]?.["properties"]?.["blurRadius"]?.maximum ??
        Number.NaN,
    );

    // The reading: a value run and a smaller literal unit on one text object.
    const value = objectById(theme, "cpu-card-value");
    const runs = (value["yunariText"] as { runs: ReadonlyArray<ObjectJson> })
      .runs;
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({
      kind: "value",
      bindingId: "cpu-card-load",
      precision: 0,
      unitDisplay: "none",
    });
    expect(runs[1]).toMatchObject({ kind: "literal", text: "%" });
    expect(bindingsOf(theme)["cpu-card-value"]).toEqual([
      expect.objectContaining({ semanticKey: "cpu.load" }),
    ]);

    // The sparkline reads the same key, so the card cannot show a percentage and
    // a waveform for two different moments.
    expect(objectById(theme, "cpu-card-sparkline")).toMatchObject({
      type: "YunariChart",
      family: "line",
    });
    expect(bindingsOf(theme)["cpu-card-sparkline"]).toEqual([
      expect.objectContaining({ semanticKey: "cpu.load" }),
    ]);
    // The chart's ink is the glass ink, not `cpu`/`sparkArea`: this card
    // transmits, so its field is a photograph, and `#4da3ff` sits 37 luma from
    // the CPU card's bright horizon — under the one-pixel edge floor, which
    // reads as a grey line rather than a stroke.
    expect(objectById(theme, "cpu-card-sparkline")["settings"]).toMatchObject({
      area: { ref: "palette.frostArea" },
      stroke: { ref: "palette.frostInk" },
      showAxes: false,
    });
    expect(validateFabricThemeEnvelope(theme).ok).toBe(true);
  });

  it("round-trips the CPU card's treatment through revival and serialisation", async () => {
    const theme = createNewFabricTheme();
    const canvas = new StaticCanvas(undefined, {
      width: theme.artboard.width,
      height: theme.artboard.height,
    });
    await reviveThemeEnvelope(canvas, theme);

    // The authored radius itself, not just "some radius": 40 is the value that
    // dissolves the sunset's structure behind the card, and a round trip that
    // quietly fell back to a default would leave a panel that blurs without
    // diffusing — see `docs/decisions/0013-frost-is-diffusion-grain-saturation-and-an-edge.md`.
    const authored = childrenOf(cpuCard()).find(
      (object) => object["id"] === "cpu-card",
    )?.["yunariGlass"];
    const revived = fabricObjectsOf(canvas).find(
      (object) => object.get("id") === "cpu-card",
    );
    expect(revived?.get("yunariGlass")).toEqual(authored);

    const saved = serialiseThemeEnvelope(canvas, theme);
    const savedNodes: Array<Readonly<Record<string, unknown>>> = [];
    const walkSaved = (
      list: ReadonlyArray<Readonly<Record<string, unknown>>>,
    ): void => {
      for (const object of list) {
        savedNodes.push(object);
        walkSaved(
          (object["objects"] as
            | ReadonlyArray<Readonly<Record<string, unknown>>>
            | undefined) ?? [],
        );
      }
    };
    walkSaved(saved.scene.objects as ReadonlyArray<never>);
    expect(
      savedNodes.find((object) => object["id"] === "cpu-card")?.["yunariGlass"],
    ).toEqual(authored);
    expect(validateFabricThemeEnvelope(saved).ok).toBe(true);
    await canvas.dispose();
  });

  it("revives every card over a transparent artboard, and keeps the backdrop declared", async () => {
    const theme = createNewFabricTheme();
    const canvas = new StaticCanvas(undefined, {
      width: theme.artboard.width,
      height: theme.artboard.height,
    });
    await reviveThemeEnvelope(canvas, theme);

    // The round trip is where a declaration is easiest to drop: it is
    // `artboard` and `assets` data, not a Fabric object, so nothing on the
    // canvas would complain if either were lost.
    const saved = serialiseThemeEnvelope(canvas, theme);
    expect(saved.background?.media).toEqual({
      assetId: "starter-backdrop",
      bounds: "theme",
    });
    expect(saved.background?.color).toEqual({ ref: "palette.none" });
    expect(saved.assets).toEqual(theme.assets);

    const chart = fabricObjectsOf(canvas).find(
      (object) => object.get("id") === "cpu-card-icon",
    );
    expect(chart?.get("strokeWidth")).toBeGreaterThan(0);
    expect(
      (chart?.get("path") as unknown[] | undefined)?.length,
    ).toBeGreaterThan(1);

    expect(
      fabricObjectsOf(canvas).filter((object) => object instanceof YunariChart),
    ).toHaveLength(7);
    const validation = validateFabricThemeEnvelope(saved);
    if (!validation.ok)
      throw new Error(
        validation.issues
          .map((issue) => `${issue.path}: ${issue.message}`)
          .join("\n"),
      );
    expect(validation).toMatchObject({ ok: true });
    await canvas.dispose();
  });
});

describe("the starter's cards are groups", () => {
  /**
   * Every part every card is made of, by the id it had when the composition was
   * a flat list of siblings. This is the check that catches a part dropped while
   * it was being wrapped: the wrap must not renumber, rename or lose one.
   */
  const CARD_PARTS: Readonly<Record<string, readonly string[]>> = {
    "group-time-card": [
      "time-card",
      "time",
      "time-period",
      "time-rule",
      "date",
    ],
    "group-cpu-card": [
      "cpu-card",
      "cpu-card-icon",
      "cpu-card-title",
      "cpu-card-value",
      "cpu-card-caption",
      "cpu-card-sparkline",
      "cpu-card-freq",
    ],
    "group-gpu-card": [
      "gpu-card",
      "gpu-card-icon",
      "gpu-card-title",
      "gpu-card-value",
      "gpu-card-caption",
      "gpu-card-sparkline",
      "gpu-card-freq",
      "gpu-card-temp",
    ],
    "group-ram-card": [
      "ram-card",
      "ram-card-icon",
      "ram-card-title",
      "ram-gauge",
      "ram-value",
      "ram-capacity",
    ],
    "group-vram-card": [
      "vram-card",
      "vram-card-icon",
      "vram-card-title",
      "vram-gauge",
      "vram-value",
      "vram-capacity",
    ],
    "group-trends-card": [
      "trends-card",
      "trends-card-icon",
      "trends-card-title",
      "trends-legend",
      "trends-chart",
    ],
    "group-storage-card": [
      "storage-card",
      "storage-card-icon",
      "storage-card-title",
      "storage-card-value",
      "storage-bar",
      "storage-card-name",
      "storage-chevron",
    ],
    "group-network-card": [
      "network-card",
      "network-card-icon",
      "network-card-title",
      "network-down",
      "network-up",
      "network-chart",
    ],
  };

  it("wraps every card in exactly one group, and loses no part doing it", () => {
    const theme = createNewFabricTheme();
    const groups = objectsOf(theme).filter(
      (object) => object["type"] === "Group",
    );
    expect(
      groups.map((group) => String(group["id"])).sort(),
      "the layer tree's top level is the eight cards and two loose labels",
    ).toEqual(Object.keys(CARD_PARTS).sort());

    for (const [id, parts] of Object.entries(CARD_PARTS)) {
      expect(
        childrenOf(objectById(theme, id)).map((child) => child["id"]),
        id,
      ).toEqual(parts);
    }

    // Nothing is duplicated and nothing is invented: the document is the eight
    // groups, their fifty parts and the two loose labels, each named once.
    const ids = nodesOf(theme).map((object) => String(object["id"]));
    expect(ids).toHaveLength(new Set(ids).size);
    expect(
      [...ids].sort(),
      "the document gained or lost an object while it was being grouped",
    ).toEqual(
      [
        "wordmark",
        "strapline",
        ...Object.values(CARD_PARTS).flat(),
        ...Object.keys(CARD_PARTS),
      ].sort(),
    );
  });

  it("leaves the wordmark and the strapline loose", () => {
    // They are not a card, and a design that made every object a group would
    // be the cage this project is explicitly avoiding.
    const theme = createNewFabricTheme();
    expect(
      objectsOf(theme)
        .filter((object) => object["type"] !== "Group")
        .map((object) => object["id"]),
    ).toEqual(["wordmark", "strapline"]);
  });

  it("composes a group's transform: moving it moves its parts by the same delta and rewrites none of them", async () => {
    const theme = createNewFabricTheme();
    const canvas = new StaticCanvas(undefined, {
      width: theme.artboard.width,
      height: theme.artboard.height,
    });
    await reviveThemeEnvelope(canvas, theme);

    const group = canvas
      .getObjects()
      .find((object) => object.get("id") === "group-cpu-card");
    if (!(group instanceof Group))
      throw new Error("the CPU card is not a group");
    const children = group.getObjects();
    expect(children.length).toBe(7);

    const delta = 137.5;
    const before = children.map((child) => ({
      id: String(child.get("id")),
      left: child.left,
      top: child.top,
      rect: child.getBoundingRect(),
    }));
    group.set({ left: group.left + delta });
    group.setCoords();
    for (const child of children) child.setCoords();

    // The composition §57 promises, and the reason the conversion was needed:
    // the parts move with the card, and their own coordinates are untouched —
    // a child that rewrote its own `left` on the first move would be wrong the
    // moment it moved again, and wrong immediately on insertion.
    for (const [index, child] of children.entries()) {
      const was = before[index];
      if (was === undefined) throw new Error("a part vanished on the move");
      const rect = child.getBoundingRect();
      expect(child.left, `${was.id} rewrote its own left`).toBe(was.left);
      expect(child.top, `${was.id} rewrote its own top`).toBe(was.top);
      expect(
        rect.left - was.rect.left,
        `${was.id} did not move with the card`,
      ).toBeCloseTo(delta, 6);
      expect(
        rect.top - was.rect.top,
        `${was.id} did not move with the card`,
      ).toBeCloseTo(0, 6);
    }
    await canvas.dispose();
  });

  it("puts every card's parts exactly where the flat composition drew them", async () => {
    // The conversion is one subtraction, so the whole check is that the scene
    // still measures the same: each frosted panel's world box is its measured
    // card, and every other part still lands inside the artboard.
    const theme = createNewFabricTheme();
    const canvas = new StaticCanvas(undefined, {
      width: theme.artboard.width,
      height: theme.artboard.height,
    });
    await reviveThemeEnvelope(canvas, theme);
    const byId = new Map(
      fabricObjectsOf(canvas).map((object) => [
        String(object.get("id")),
        object.getBoundingRect(),
      ]),
    );
    for (const card of CARDS) {
      const panel = byId.get(card.id.replace("group-", ""));
      expect(panel, card.id).toBeDefined();
      // The two-pixel border straddles the authored edge, so the painted box is
      // two units wider than the authored one and starts on the same edge.
      expect(
        {
          left: panel?.left,
          top: panel?.top,
          width: panel?.width,
          height: panel?.height,
        },
        card.id,
      ).toEqual({
        left: card.left,
        top: card.top,
        width: card.width + 2,
        height: card.height + 2,
      });
    }
    await canvas.dispose();
  });
});

describe("the blank Fabric document", () => {
  /** The nine the product decision names, plus `none` — which the validator
      requires of any palette (`paletteNone`, `fabric-envelope-validate.ts`) and
      which `new-object-defaults.ts` filters out before choosing a surface, so it
      is not one of the tokens a new object can be painted with. */
  const BLANK_PALETTE_IDS = [
    "none",
    "text",
    "dim",
    "panel",
    "frost",
    "panelStroke",
    "rule",
    "chartTrack",
    "frostInk",
    "frostArea",
  ] as const;
  /** What the decision rules out, and `none` with it: the reference
      composition's device colours are not a starting vocabulary. */
  const BLANK_PALETTE_ABSENT = [
    "cpu",
    "gpu",
    "ram",
    "vram",
    "down",
    "sparkArea",
    "storageFill",
    "bars",
    "background",
  ] as const;

  it("is a valid document at the artboard it was given, not the starter's", () => {
    const blank = createBlankFabricTheme({ width: 1920, height: 1080 });

    expect(validateFabricThemeEnvelope(blank)).toEqual({
      ok: true,
      envelope: blank,
    });
    expect(blank.artboard).toMatchObject({ width: 1920, height: 1080 });
    expect(blank.artboard).not.toMatchObject({
      width: createNewFabricTheme().artboard.width,
    });
  });

  it("is empty: no scene objects, no assets, no bindings", () => {
    const blank = createBlankFabricTheme({ width: 1920, height: 1080 });

    // An author who opens the product is handed a dashboard they did not make.
    // "Blank" that still carries the reference composition is the defect itself,
    // so each of these is asserted separately: a theme could be emptied of
    // objects and still carry the backdrop it declared.
    expect(blank.scene["objects"]).toEqual([]);
    expect(blank.assets).toEqual([]);
    expect(blank.bindings).toEqual({});
    // The backdrop is a packaged asset, so dropping the objects has to drop it
    // too — a declaration without bytes is a theme the player renders nothing
    // behind and the validator refuses.
    expect(blank.background?.media).toBeUndefined();
  });

  it("starts from exactly the minimal token set, taken by id from the starter", () => {
    const blank = createBlankFabricTheme({ width: 1920, height: 1080 });
    const palette = blank.globals?.palette ?? {};

    expect(Object.keys(palette).sort()).toEqual([...BLANK_PALETTE_IDS].sort());
    // The reference palette's device colours are not a starting set: an author
    // who has no CPU has a theme with a CPU token in it.
    for (const absent of BLANK_PALETTE_ABSENT) {
      expect(palette[absent], absent).toBeUndefined();
    }
    // Narrowed by id, never restated: the entries are the starter's own, so a
    // change to the starter's tint reaches a blank theme instead of leaving a
    // second literal behind to drift.
    for (const id of BLANK_PALETTE_IDS) {
      expect(palette[id], id).toBe(starterPalette[id]);
    }
  });

  it("paints its artboard from tokens the blank palette actually has", () => {
    const blank = createBlankFabricTheme({ width: 1920, height: 1080 });
    const palette = blank.globals?.palette ?? {};
    const ids = (value: unknown): string[] =>
      value === undefined ? [] : [String((value as { ref: string }).ref)];

    for (const ref of ids(blank.background?.color)) {
      expect(ref.startsWith("palette."), ref).toBe(true);
      expect(palette[ref.slice("palette.".length)], ref).toBeDefined();
    }
  });

  it("gives a new panel and a new chart tokens that exist and differ", () => {
    const blank = createBlankFabricTheme({ width: 1920, height: 1080 });
    const globals = blank.globals;
    const palette = globals?.palette ?? {};
    const token = (ref: string | undefined): string =>
      (ref ?? "").replace(/^palette\./, "");

    // A card filled with the page, or a gauge whose track and data are one
    // colour, is an object the author cannot see — which is what the
    // surface-token rules in `new-object-defaults.ts` exist to prevent, and
    // they only hold if the blank palette names the surfaces they reach for.
    // Only the card's fill is under test here, so it takes the first cascade
    // slot: this is a palette assertion, not a placement one.
    const card = createNewPanelDefaults(
      globals,
      newObjectPlacement(0, blank.artboard),
    );
    const chart = createNewChartDefaults(globals, "gauge");
    const cardFill = token(card.yunariPaint?.fill);
    const track = token((chart.track as { ref?: string } | undefined)?.ref);
    const progress = token((chart.progress as { ref?: string }).ref);
    const page = token(
      (blank.background?.color as { ref?: string } | undefined)?.ref,
    );

    for (const id of [cardFill, track, progress]) {
      expect(palette[id], id).toBeDefined();
    }
    expect(cardFill, "a card is not the page it sits on").not.toBe(page);
    expect(track, "a gauge's track is not its data").not.toBe(progress);
  });
});

describe("document identity", () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  it("mints a fresh id for every new document", () => {
    const first = createNewFabricTheme();
    const second = createNewFabricTheme();
    expect(first.id).toMatch(UUID);
    expect(second.id).toMatch(UUID);
    expect(first.id).not.toBe(second.id);
  });
  it("mints a fresh id for a blank document too", () => {
    expect(createBlankFabricTheme({ width: 800, height: 480 }).id).toMatch(
      UUID,
    );
  });
});
