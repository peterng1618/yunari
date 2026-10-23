// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildLineOption,
  defaultLineSettings,
  glassTreatment,
  objectName,
  type Sample,
  validateFabricThemeEnvelope,
  YUNARI_GLASS_PROPERTY,
  YUNARI_NAME_PROPERTY,
} from "@yunari/renderer-core";
import {
  Circle,
  Ellipse,
  FabricImage,
  FabricText,
  Group,
  Path,
  Rect,
  Shadow,
  StaticCanvas,
  Textbox,
} from "fabric/es";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { YunariChart, type YunariChartOptions } from "./chart-object.js";
import { refreshBoundText, YUNARI_TEXT_PROPERTY } from "./fabric-text.js";
import {
  objectAssetReference,
  setObjectAssetReference,
  YUNARI_ASSET_PROPERTY,
} from "./object-asset.js";
import {
  applyObjectPalettePaints,
  paintPropertyFor,
  YUNARI_PAINT_PROPERTY,
} from "./object-paint.js";
import {
  applyObjectTypePresets,
  reassignObjectTypePresetReferences,
} from "./object-type.js";
import { reassignObjectPaletteReferences } from "./palette-references.js";
import type { SerialisedScene } from "./persist.js";
import {
  assertFabricThemeEnvelopeCompatible,
  reviveScene,
  reviveThemeEnvelope,
  SCENE_PERSISTED_PROPERTIES,
  serialiseScene,
  serialiseThemeEnvelope,
} from "./persist.js";
import { Arc, Wedge } from "./sector-object.js";

/**
 * What a saved scene contains, asserted exactly.
 *
 * Two things here are unusual on purpose.
 *
 * **The key sets are `toEqual`, never `toMatchObject`.** A subset match cannot
 * see a key that should *not* be there, and every key this format has had to
 * exclude — `subTargetCheck`, `interactive`, `layoutManager`, `renderScale`,
 * a built chart option carrying live samples — was a key nobody thought to look
 * for. The next Fabric minor adding one to `toObject` should fail here.
 *
 * **Identity is tested through a whole-canvas round trip**, not through one
 * object's `toObject`. `id` reaches the output as a `propertiesToInclude`
 * argument, so the interesting question is never "does `toObject` support it"
 * but "did the save path pass it" — and the failure when it did not is a
 * document full of anonymous objects that reports nothing.
 */

const NOW_MS = Date.UTC(2026, 8, 15, 12, 0, 0);

function sample(value: number): Sample {
  return {
    sensorId: "cpu.load",
    timestamp: new Date(NOW_MS).toISOString(),
    status: "ok",
    value,
  };
}

function chartOptions(
  overrides: Partial<YunariChartOptions> = {},
): YunariChartOptions {
  return {
    family: "line",
    settings: { ...defaultLineSettings },
    width: 300,
    height: 180,
    option: buildLineOption(
      defaultLineSettings,
      [{ sensorId: "cpu.load", samples: [sample(1)] }],
      NOW_MS,
      false,
    ),
    ...overrides,
  } as YunariChartOptions;
}

function canvasOf(...objects: readonly object[]): StaticCanvas {
  const canvas = new StaticCanvas(undefined, { width: 400, height: 300 });

  for (const object of objects) {
    canvas.add(object as Rect);
  }

  return canvas;
}

/**
 * The scene JSON `reviveScene` hands to `loadFromJSON`, without the load.
 *
 * jsdom never decodes an image, so a real revive of one that names a URL waits
 * on an `onload` that cannot arrive. What is under test is what Fabric is
 * given, so the load is captured rather than performed.
 */
async function sceneFabricWouldLoad(
  scene: SerialisedScene,
  resolveAsset?: (assetId: string) => string | undefined,
): Promise<SerialisedScene> {
  let handed: SerialisedScene | undefined;
  const canvas = new StaticCanvas(undefined, { width: 400, height: 300 });
  vi.spyOn(canvas, "loadFromJSON").mockImplementation((json: unknown) => {
    handed = json as SerialisedScene;
    return Promise.resolve(canvas);
  });
  await reviveScene(canvas, scene, resolveAsset);
  if (handed === undefined) throw new Error("Fabric was never asked to load.");
  return handed;
}

function keysOf(
  scene: { readonly objects: readonly Readonly<Record<string, unknown>>[] },
  index = 0,
): string[] {
  return Object.keys(scene.objects[index]!).sort();
}

/** A `FabricImage` with no source: enough to serialise, no decode in jsdom. */
function image(): FabricImage {
  return new FabricImage(null as unknown as HTMLImageElement, {
    width: 10,
    height: 10,
  });
}

describe("the persisted key set, per class", () => {
  // Defaults are stripped, so each list is exactly what the author deviated
  // from plus Fabric's three unstrippable keys (`left`, `top`, `type`) and its
  // version stamp. Anything else appearing here is a format change.
  //
  // `styles` and `crossOrigin` are absent by the same rule as `subTargetCheck`:
  // Fabric writes both and neither is authored, so the serialiser takes them
  // back off rather than letting a repaint's table or a decode's network policy
  // into the package.
  const CASES: readonly (readonly [string, () => object, readonly string[]])[] =
    [
      [
        "Rect",
        () => new Rect({ width: 10, height: 10 }),
        // No `yunariGlass`: the allowlist makes a property *available*, not
        // mandatory, so an old scene gains no key. This exact-key assertion is
        // what proves that, for every listed class.
        ["height", "id", "left", "top", "type", "version", "width"],
      ],
      [
        "Ellipse",
        () => new Ellipse({ rx: 5, ry: 4 }),
        ["height", "id", "left", "rx", "ry", "top", "type", "version", "width"],
      ],
      [
        "FabricText",
        () => new FabricText("hi"),
        ["height", "id", "left", "text", "top", "type", "version", "width"],
      ],
      [
        "Textbox",
        () => new Textbox("hi", { width: 40 }),
        ["height", "id", "left", "text", "top", "type", "version", "width"],
      ],
      [
        "FabricImage",
        image,
        [
          "filters",
          "height",
          "id",
          "left",
          "src",
          "top",
          "type",
          "version",
          "width",
        ],
      ],
      [
        "Group",
        () => new Group([new Rect({ width: 4, height: 4 })]),
        ["height", "id", "left", "objects", "top", "type", "version", "width"],
      ],
      [
        "YunariChart",
        () => new YunariChart(chartOptions()),
        [
          "family",
          "height",
          "id",
          "left",
          "settings",
          "top",
          "type",
          "version",
          "width",
        ],
      ],
    ];

  it.each(CASES)(
    "%s persists exactly its authored surface",
    (_name, make, expected) => {
      const object = make();
      (object as Rect).set("id", "node-1");

      expect(keysOf(serialiseScene(canvasOf(object)))).toEqual([...expected]);
    },
  );

  it("never persists the built chart option or the render scale", () => {
    // §67, structurally rather than by inspection: the built option holds live
    // samples in `series[].data`, and a guard on key *names* passed while they
    // sat there. `renderScale` is device state in a portable document.
    const chart = new YunariChart(chartOptions());
    chart.set("id", "chart-1");

    const keys = keysOf(serialiseScene(canvasOf(chart)));

    expect(keys).not.toContain("option");
    expect(keys).not.toContain("renderScale");
  });
});

describe("Fabric’s own keys are held to the same rule", () => {
  it("keeps editor interaction state and engine internals out of a display scene", () => {
    // `Group.toObject` forces `subTargetCheck` and `interactive` into its
    // output unconditionally, and emits `layoutManager` whenever defaults are
    // included. Stripping is what removes all three — there is no filter.
    const group = new Group([new Rect({ width: 4, height: 4 })]);
    group.set("id", "group-1");

    const keys = keysOf(serialiseScene(canvasOf(group)));

    expect(keys).not.toContain("subTargetCheck");
    expect(keys).not.toContain("interactive");
    expect(keys).not.toContain("layoutManager");
  });

  it("strips them again when a save happens while the editor has group entry on", () => {
    // Spec 0013 stage 4 arms `subTargetCheck` + `interactive` on the group an
    // author entered, which makes them non-default and therefore serialized.
    // Saving from inside a group is a third path out of that state, beside
    // exit and history reload, so serialization strips them rather than letting
    // editor state land in a portable document (§67).
    const group = new Group([new Rect({ width: 4, height: 4 })], {
      subTargetCheck: true,
      interactive: true,
    });
    group.set("id", "group-1");

    expect(keysOf(serialiseScene(canvasOf(group)))).toEqual([
      "height",
      "id",
      "left",
      "objects",
      "top",
      "type",
      "version",
      "width",
    ]);
  });

  it("never persists the derived per-character style table", () => {
    // `FabricText.toObject` writes `styles` on every text object whatever the
    // caller asked for, and the table is a race with the repaint that wrote it
    // — two exports of one document disagree on the range. The authored
    // equivalent is `yunariText.runs`; nothing reads `styles` back.
    const text = new FabricText("CPU 48%");
    text.set("id", "readout");
    text.set("styles", { 0: { 0: { fontSize: 24 } } });

    expect(keysOf(serialiseScene(canvasOf(text)))).not.toContain("styles");
  });

  it("never persists the image's runtime crossOrigin flag", () => {
    // `crossOrigin` is what the session that decoded the image asked the
    // network for, not a choice an author made, and a revived reader makes its
    // own. It reaches `toObject` because it is a set property rather than a
    // Fabric default.
    const source = image();
    source.set("crossOrigin", "anonymous");

    expect(keysOf(serialiseScene(canvasOf(source)))).not.toContain(
      "crossOrigin",
    );
  });
});

describe("identity survives a round trip", () => {
  // jsdom cannot drawImage an image it never decoded, and reviving an image
  // that names a URL makes Fabric render it. A proxy over a real context
  // forwards everything and no-ops only drawImage.
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

  it("retains an image asset reference without serialising its preview URL", async () => {
    const source = image();
    setObjectAssetReference(source, { assetId: "logo", kind: "svg" });
    const scene = serialiseScene(canvasOf(source));
    const revived = new StaticCanvas(undefined, { width: 400, height: 300 });

    await reviveScene(revived, scene);

    expect(scene.objects[0]![YUNARI_ASSET_PROPERTY]).toEqual({
      assetId: "logo",
      kind: "svg",
    });
    expect(objectAssetReference(revived.getObjects()[0]!)).toEqual({
      assetId: "logo",
      kind: "svg",
    });
  });

  it("persists a flip only while it is on, and revives it", async () => {
    // Fabric owns `flipX`/`flipY`, so with defaults stripped the key is the
    // flip: absent is off, and nothing had to be added to the format.
    const source = image();
    setObjectAssetReference(source, { assetId: "picture", kind: "image" });
    expect(keysOf(serialiseScene(canvasOf(source)))).not.toContain("flipX");

    source.set({ flipX: true });
    const scene = serialiseScene(canvasOf(source));
    expect(scene.objects[0]!["flipX"]).toBe(true);
    expect(scene.objects[0]).not.toHaveProperty("flipY");

    const revived = new StaticCanvas(undefined, { width: 400, height: 300 });
    await reviveScene(revived, scene);
    expect(revived.getObjects()[0]!.flipX).toBe(true);
  });

  it("keeps a group member's flip on the member, not on the group", () => {
    const inside = image();
    inside.set({ flipX: true });
    const scene = serialiseScene(canvasOf(new Group([inside])));
    const children = scene.objects[0]!["objects"] as Record<string, unknown>[];

    expect(children[0]!["flipX"]).toBe(true);
    expect(scene.objects[0]).not.toHaveProperty("flipX");
  });

  it("does not persist the URL an asset-referenced image was decoded from", () => {
    // Fabric writes `src` on every image whatever the caller asked for, so it
    // has to be taken back off. What it wrote was the `blob:` handle of
    // whichever session decoded it, and every reader resolves the reference
    // before the load — persisting it shipped a dead handle beside the live
    // thing, and into every exported package.
    const source = image();
    setObjectAssetReference(source, { assetId: "logo", kind: "image" });
    // Not awaited: these cases are about what the serialiser leaves out, and the
    // synchronous test bodies have nothing to wait on. `void` says that out loud,
    // where a bare call reads as an oversight.
    void source.setSrc?.("blob:http://127.0.0.1:5311/081c983e");

    const scene = serialiseScene(canvasOf(source));

    expect(scene.objects[0]![YUNARI_ASSET_PROPERTY]).toEqual({
      assetId: "logo",
      kind: "image",
    });
    expect(scene.objects[0]).not.toHaveProperty("src");
  });

  it("keeps the URL of an image nothing declared", () => {
    // The strip is for objects whose picture is the asset. An image with no
    // reference has nothing to resolve, and dropping its `src` would leave a
    // picture no reader could load — the one case where the URL is all there is.
    const scene = serialiseScene(canvasOf(image()));

    expect(scene.objects[0]![YUNARI_ASSET_PROPERTY]).toBeUndefined();
    expect(scene.objects[0]!["src"]).toBeDefined();
  });

  it("takes the URL off an asset-referenced image inside a group too", () => {
    const inside = image();
    setObjectAssetReference(inside, { assetId: "logo", kind: "image" });
    // Not awaited: this case is about what the serialiser leaves out, and the
    // synchronous test body has nothing to wait on. `void` says that out loud,
    // where a bare call reads as an oversight.
    void inside.setSrc?.("blob:http://127.0.0.1:5311/inside");
    const plain = image();
    const scene = serialiseScene(canvasOf(new Group([inside, plain])));

    const children = scene.objects[0]!["objects"] as Record<string, unknown>[];
    expect(children[0]).not.toHaveProperty("src");
    expect(children[1]).toHaveProperty("src");
  });

  it("hands Fabric the URL an asset resolves to, not the one the save carried", async () => {
    // A pasted image saves the `blob:` URL of the session that decoded it,
    // which means nothing in another tab, another browser or on a phone — the
    // bytes ship, the picture does not. Fabric enlivens from `src` alone, so
    // the reference has to be resolved BEFORE the load; after it, the image is
    // already missing. The load itself is stubbed because jsdom never decodes an
    // image and would wait on an `onload` that cannot come.
    const source = new FabricImage(null as unknown as HTMLImageElement, {
      left: 0,
      top: 0,
      width: 4,
      height: 4,
    });
    setObjectAssetReference(source, { assetId: "pasted-probe", kind: "image" });
    const scene = serialiseScene(canvasOf(source));
    // What the editor's session happened to be holding when it saved.
    (scene.objects[0] as Record<string, unknown>)["src"] =
      "blob:http://127.0.0.1:5311/081c983e";
    const asked: string[] = [];

    const handed = await sceneFabricWouldLoad(scene, (assetId) => {
      asked.push(assetId);
      return assetId === "pasted-probe"
        ? "/api/themes/demo/assets/pasted-probe.png?t=session"
        : undefined;
    });

    expect(asked).toEqual(["pasted-probe"]);
    expect(handed.objects[0]!["src"]).toBe(
      "/api/themes/demo/assets/pasted-probe.png?t=session",
    );
    // The reference is untouched: it is the authored truth, and the URL is what
    // this session resolves it to.
    expect(handed.objects[0]![YUNARI_ASSET_PROPERTY]).toEqual({
      assetId: "pasted-probe",
      kind: "image",
    });
  });

  it("resolves an image inside a group, and leaves one nobody can name alone", async () => {
    // Nothing is invented for an asset the resolver cannot name: the object
    // keeps the `src` it arrived with and fails visibly, rather than being
    // pointed at a placeholder that would paint the wrong picture.
    const inside = new FabricImage(null as unknown as HTMLImageElement, {
      left: 0,
      top: 0,
      width: 4,
      height: 4,
    });
    setObjectAssetReference(inside, { assetId: "known", kind: "image" });
    const missing = new FabricImage(null as unknown as HTMLImageElement, {
      left: 8,
      top: 0,
      width: 4,
      height: 4,
    });
    setObjectAssetReference(missing, { assetId: "unknown", kind: "image" });
    const group = new Group([inside, missing], { left: 0, top: 0 });
    const scene = serialiseScene(canvasOf(group));
    const children = scene.objects[0]!["objects"] as Record<string, unknown>[];
    children[0]!["src"] = "blob:http://x/known";
    children[1]!["src"] = "blob:http://x/unknown";

    const handed = await sceneFabricWouldLoad(scene, (assetId) =>
      assetId === "known" ? "/assets/known.png" : undefined,
    );

    const revivedChildren = handed.objects[0]!["objects"] as Record<
      string,
      unknown
    >[];
    expect(revivedChildren[0]!["src"]).toBe("/assets/known.png");
    expect(revivedChildren[1]!["src"]).toBe("blob:http://x/unknown");
  });

  it("changes nothing when the caller has no resolver", async () => {
    const source = new FabricImage(null as unknown as HTMLImageElement, {
      left: 0,
      top: 0,
      width: 4,
      height: 4,
    });
    setObjectAssetReference(source, { assetId: "pasted-probe", kind: "image" });
    const scene = serialiseScene(canvasOf(source));
    (scene.objects[0] as Record<string, unknown>)["src"] = "blob:http://x/y";

    const handed = await sceneFabricWouldLoad(scene);

    expect(handed.objects[0]!["src"]).toBe("blob:http://x/y");
  });

  it("persists palette references and reapplies their resolved paint", async () => {
    const rect = new Rect({ width: 10, height: 10, fill: "#000" });
    rect.set("id", "panel");
    rect.set(YUNARI_PAINT_PROPERTY, { fill: "palette.panel" });
    const scene = serialiseScene(canvasOf(rect));
    const revived = new StaticCanvas(undefined, { width: 400, height: 300 });
    await reviveScene(revived, scene);

    applyObjectPalettePaints(revived, {
      palette: { panel: { name: "Panel", value: "#123456" } },
    });

    expect(scene.objects[0]![YUNARI_PAINT_PROPERTY]).toEqual({
      fill: "palette.panel",
    });
    expect(revived.getObjects()[0]!.fill).toBe("#123456");
  });

  it("retains an authored glass treatment through serialisation and revival", async () => {
    // The registration that matters here is the persisted-properties
    // allowlist, not a Fabric subclass: an unlisted property is dropped on
    // save, so a missing entry fails here rather than at some later render.
    const panel = new Rect({ width: 40, height: 24, rx: 8, ry: 8 });
    panel.set("id", "panel");
    panel.set(YUNARI_GLASS_PROPERTY, { blurRadius: 16 });
    const scene = serialiseScene(canvasOf(panel));
    const revived = new StaticCanvas(undefined, { width: 400, height: 300 });

    await reviveScene(revived, scene);

    expect(scene.objects[0]![YUNARI_GLASS_PROPERTY]).toEqual({
      blurRadius: 16,
    });
    expect(glassTreatment(revived.getObjects()[0]!)).toEqual({
      blurRadius: 16,
    });
  });

  it("retains an authored display name through serialisation and revival", async () => {
    // The registration that matters here is the persisted-properties
    // allowlist, not a Fabric subclass: an unlisted property is dropped on
    // save, so a missing entry fails here rather than at some later render.
    const rect = new Rect({ width: 40, height: 24 });
    rect.set("id", "panel");
    rect.set(YUNARI_NAME_PROPERTY, "Header panel");
    const scene = serialiseScene(canvasOf(rect));
    const revived = new StaticCanvas(undefined, { width: 400, height: 300 });

    await reviveScene(revived, scene);

    expect(scene.objects[0]![YUNARI_NAME_PROPERTY]).toBe("Header panel");
    expect(objectName(revived.getObjects()[0]!)).toBe("Header panel");
  });

  it("adds no name key to an object that has none", async () => {
    // Absence is the backward-compatibility contract: a scene authored before
    // the field must not grow an empty name on the next save.
    const rect = new Rect({ width: 40, height: 24 });
    rect.set("id", "panel");
    const scene = serialiseScene(canvasOf(rect));
    const revived = new StaticCanvas(undefined, { width: 400, height: 300 });

    await reviveScene(revived, scene);

    expect(keysOf(scene)).not.toContain(YUNARI_NAME_PROPERTY);
    expect(objectName(revived.getObjects()[0]!)).toBeUndefined();
  });

  it("drops the name again when an author clears it", async () => {
    // Clearing is a real edit, not a blank label: the key goes rather than
    // holding "", so the reader falls back to the id exactly as it would for a
    // scene that never had a name.
    const rect = new Rect({ width: 40, height: 24 });
    rect.set("id", "panel");
    rect.set(YUNARI_NAME_PROPERTY, "Header panel");
    const canvas = canvasOf(rect);
    rect.set(YUNARI_NAME_PROPERTY, undefined);

    const scene = serialiseScene(canvas);

    expect(keysOf(scene)).not.toContain(YUNARI_NAME_PROPERTY);
  });

  it("retains a nested display name on a grouped child", async () => {
    const panel = new Rect({ width: 40, height: 24 });
    panel.set("id", "panel");
    panel.set(YUNARI_NAME_PROPERTY, "Header panel");
    const group = new Group([panel]);
    group.set("id", "card");
    group.set(YUNARI_NAME_PROPERTY, "Card");
    const scene = serialiseScene(canvasOf(group));
    const revived = new StaticCanvas(undefined, { width: 400, height: 300 });

    await reviveScene(revived, scene);

    const [revivedGroup] = revived.getObjects();
    expect(objectName(revivedGroup!)).toBe("Card");
    // A group's children are read through Fabric's own accessor; the persisted
    // key list reaches them, but the revived instance is what a surface sees.
    const child = (revivedGroup as Group).getObjects()[0]!;
    expect(objectName(child)).toBe("Header panel");
  });

  it("retains a nested glass treatment on a grouped panel", async () => {
    const panel = new Rect({ width: 40, height: 24, rx: 8, ry: 8 });
    panel.set("id", "panel");
    panel.set(YUNARI_GLASS_PROPERTY, { blurRadius: 24 });
    const group = new Group([panel]);
    group.set("id", "card");
    const scene = serialiseScene(canvasOf(group));
    const revived = new StaticCanvas(undefined, { width: 400, height: 300 });

    await reviveScene(revived, scene);

    const children = (revived.getObjects()[0] as Group).getObjects();
    expect(glassTreatment(children[0]!)).toEqual({ blurRadius: 24 });
  });

  it("never hands a renderer a treatment that revival could not validate", async () => {
    // `reviveScene` restores Fabric JSON as given; it is not a validator, and
    // the envelope validator is what refuses a bad radius at import. This
    // pins the second layer: a scene that reaches revival by another route
    // still cannot produce a live treatment, because the reader treats a
    // malformed value as off instead of coercing it to a default.
    const revived = new StaticCanvas(undefined, { width: 400, height: 300 });

    await reviveScene(revived, {
      version: "7.4.0",
      objects: [
        { type: "Rect", id: "a", yunariGlass: { blurRadius: 9999 } },
        { type: "Rect", id: "b", yunariGlass: { blurRadius: "16" } },
        { type: "Rect", id: "c", yunariGlass: { blurRadius: 16, surface: 1 } },
        { type: "Rect", id: "d", yunariGlass: { blurRadius: 12 } },
      ],
    });

    expect(
      revived.getObjects().map((object) => glassTreatment(object)),
    ).toEqual([undefined, undefined, undefined, { blurRadius: 12 }]);
  });

  it("carries a glass treatment through the duplicate a clipboard makes", async () => {
    // Duplicate is the other author-mutating save path: it clones with the
    // same allowlist, so a treatment survives it only if the entry exists.
    const panel = new Rect({ width: 40, height: 24, rx: 8, ry: 8 });
    panel.set("id", "panel");
    panel.set(YUNARI_GLASS_PROPERTY, { blurRadius: 12 });

    const copy = await panel.clone([...SCENE_PERSISTED_PROPERTIES]);
    copy.set("id", "panel-copy");

    const scene = serialiseScene(canvasOf(copy as Rect));
    expect(scene.objects[0]![YUNARI_GLASS_PROPERTY]).toEqual({
      blurRadius: 12,
    });
  });

  it("persists no surface, resolved colour, reading or media with the treatment", () => {
    // The saved document is the product's portable state. Whatever a live
    // render attaches to the object — a scratch surface, a device-pixel
    // blur, a sampled reading, a video element — must not ride along, or a
    // theme package would carry device state between machines.
    const panel = new Rect({ width: 40, height: 24, rx: 8, ry: 8 });
    panel.set("id", "panel");
    panel.set(YUNARI_GLASS_PROPERTY, { blurRadius: 16 });
    panel.set("yunariGlassSurface", { width: 1280, height: 720 });
    panel.set("yunariGlassTint", "rgba(10,15,22,0.82)");
    panel.set("yunariGlassSample", 42.7);
    panel.set("yunariGlassMedia", { kind: "video", element: "<video />" });

    const scene = serialiseScene(canvasOf(panel));
    const json = JSON.stringify(scene);

    expect(scene.objects[0]![YUNARI_GLASS_PROPERTY]).toEqual({
      blurRadius: 16,
    });
    for (const leak of [
      "yunariGlassSurface",
      "yunariGlassTint",
      "yunariGlassSample",
      "yunariGlassMedia",
      "42.7",
      "<video",
    ]) {
      expect(json, leak).not.toContain(leak);
    }
  });

  it("resolves a persisted shadow colour through the palette, not a literal", async () => {
    // The assertion has to end on serialised output: reading the live object
    // after `applyObjectPalettePaints` would pass even if the palette never
    // reached the save path, because the same in-memory object is inspected.
    // Re-serialising proves the reference survived the round trip *and* that
    // the resolved colour is what the document now carries.
    const panel = new Rect({
      width: 40,
      height: 24,
      shadow: new Shadow({ color: "#000000", blur: 18, offsetY: 4 }),
    });
    panel.set("id", "panel");
    panel.set(YUNARI_PAINT_PROPERTY, { shadowColor: "palette.edge" });
    const scene = serialiseScene(canvasOf(panel));
    const revived = new StaticCanvas(undefined, { width: 400, height: 300 });

    await reviveScene(revived, scene);
    applyObjectPalettePaints(revived, {
      palette: { edge: { name: "Edge", value: "#123456" } },
    });

    const saved = serialiseScene(revived).objects[0]!;
    const shadow = saved["shadow"] as Record<string, unknown>;

    expect(saved[YUNARI_PAINT_PROPERTY]).toEqual({
      shadowColor: "palette.edge",
    });
    expect(shadow["color"]).toBe("#123456");
    // The native geometry stays the author's; only the colour is resolved.
    expect(shadow["blur"]).toBe(18);
    expect(shadow["offsetY"]).toBe(4);
  });

  it("reapplies a persisted text run type preset", () => {
    const text = new Textbox("CPU", { fontFamily: "Old", fontSize: 10 });
    text.set(YUNARI_TEXT_PROPERTY, {
      runs: [
        { kind: "literal", text: "CPU", typePreset: "typePresets.metric" },
      ],
    });
    const canvas = canvasOf(text);

    applyObjectTypePresets(canvas, {
      typePresets: {
        metric: {
          name: "Metric",
          value: { family: "Inter", size: 32, weight: 700, lineHeight: 1.1 },
        },
      },
    });

    expect(text).toMatchObject({
      fontFamily: "Inter",
      fontSize: 32,
      fontWeight: 700,
      lineHeight: 1.1,
    });
  });

  it("reassigns object paint and authored text references before token deletion", () => {
    const text = new Textbox("CPU");
    text.set(YUNARI_PAINT_PROPERTY, { fill: "palette.old" });
    text.set(YUNARI_TEXT_PROPERTY, {
      runs: [
        {
          kind: "literal",
          text: "CPU",
          style: { color: { ref: "palette.old" } },
        },
      ],
    });
    const canvas = canvasOf(text);

    expect(
      reassignObjectPaletteReferences(canvas, "palette.old", "palette.new"),
    ).toBe(2);
    expect(text.get(YUNARI_PAINT_PROPERTY)).toEqual({ fill: "palette.new" });
    expect(text.get(YUNARI_TEXT_PROPERTY)).toMatchObject({
      runs: [{ style: { color: { ref: "palette.new" } } }],
    });
  });

  it("reassigns every authored text-run type preset before deletion", () => {
    const text = new Textbox("CPU 42%");
    text.set(YUNARI_TEXT_PROPERTY, {
      runs: [
        { kind: "literal", text: "CPU ", typePreset: "typePresets.old" },
        { kind: "literal", text: "42%", typePreset: "typePresets.old" },
      ],
    });
    const canvas = canvasOf(text);

    expect(
      reassignObjectTypePresetReferences(
        canvas,
        "typePresets.old",
        "typePresets.new",
      ),
    ).toBe(2);
    expect(text.get(YUNARI_TEXT_PROPERTY)).toMatchObject({
      runs: [
        { typePreset: "typePresets.new" },
        { typePreset: "typePresets.new" },
      ],
    });
  });

  it("keeps authored text runs available after Fabric revival", async () => {
    const authored = {
      runs: [
        { kind: "literal" as const, text: "CPU " },
        { kind: "value" as const, bindingId: "load" },
      ],
    };
    const text = new FabricText("CPU 48%");
    text.set("id", "readout");
    text.set(YUNARI_TEXT_PROPERTY, authored);

    const scene = serialiseScene(canvasOf(text));
    const revived = new StaticCanvas(undefined, { width: 400, height: 300 });
    await reviveScene(revived, scene);

    expect(scene.objects[0]![YUNARI_TEXT_PROPERTY]).toEqual(authored);
    expect(revived.getObjects()[0]!.get(YUNARI_TEXT_PROPERTY)).toEqual(
      authored,
    );
  });

  it("does not save a runtime text value", () => {
    const text = new FabricText("CPU --");
    text.set("id", "readout");
    text.set(YUNARI_TEXT_PROPERTY, {
      runs: [
        { kind: "literal", text: "CPU " },
        { kind: "value", bindingId: "load" },
      ],
    });
    const canvas = canvasOf(text);

    refreshBoundText(
      canvas,
      { readout: [{ id: "load", semanticKey: "cpu.load" }] },
      {
        latest: () => sample(48),
        history: () => [],
      },
      undefined,
    );

    expect(text.text).toBe("CPU 48");
    expect(serialiseScene(canvas).objects[0]!.text).toBe("CPU —");
  });

  it("reapplies ellipsis when a bound value grows at runtime", () => {
    const text = new Textbox("--", {
      width: 40,
      fontSize: 20,
      textAlign: "right",
      left: 100,
    });
    text.set("id", "readout");
    text.clipPath = new Rect({ width: 40, height: 30 });
    text.set(YUNARI_TEXT_PROPERTY, {
      runs: [{ kind: "value", bindingId: "load" }],
      wrap: false,
      overflow: "ellipsis",
      align: "right",
      verticalAlign: "bottom",
    });

    refreshBoundText(
      canvasOf(text),
      { readout: [{ id: "load", semanticKey: "cpu.load" }] },
      {
        latest: () => sample(123456789),
        history: () => [],
      },
      undefined,
    );

    expect(text.text).toContain("…");
    expect(text.text).not.toBe("123456789");
    expect((text.clipPath as Rect).width).toBe(40);
  });

  it("repositions a revived visible value at its authored edge", async () => {
    const text = new FabricText("--", {
      fontSize: 20,
      textAlign: "right",
      left: 100,
      top: 100,
    });
    text.set("id", "readout");
    text.set(YUNARI_TEXT_PROPERTY, {
      runs: [{ kind: "value", bindingId: "load" }],
      overflow: "visible",
      align: "right",
      verticalAlign: "bottom",
    });

    const revived = new StaticCanvas(undefined, { width: 400, height: 300 });
    await reviveScene(revived, serialiseScene(canvasOf(text)));
    const restored = revived.getObjects()[0] as FabricText;
    const right = restored.left + (restored.width * restored.scaleX) / 2;
    const bottom = restored.top + (restored.height * restored.scaleY) / 2;

    refreshBoundText(
      revived,
      { readout: [{ id: "load", semanticKey: "cpu.load" }] },
      {
        latest: () => sample(123456789),
        history: () => [],
      },
      undefined,
    );

    expect(restored.left + (restored.width * restored.scaleX) / 2).toBeCloseTo(
      right,
      6,
    );
    expect(restored.top + (restored.height * restored.scaleY) / 2).toBeCloseTo(
      bottom,
      6,
    );
  });

  it("paints a hosted reading in the consumer's units, not the author's", () => {
    const text = new FabricText("--");
    text.set("id", "readout");
    text.set(YUNARI_TEXT_PROPERTY, {
      runs: [{ kind: "value", bindingId: "temp", precision: 0 }],
    });
    const source = {
      latest: () => ({
        sensorId: "gpu.temp",
        timestamp: new Date(NOW_MS).toISOString(),
        status: "ok" as const,
        value: 39,
        unit: "°C",
      }),
      history: () => [],
    };

    // A hosted theme is revived, not planned, so this is the only place its
    // readings can be converted; the sample itself stays what was measured.
    refreshBoundText(
      canvasOf(text),
      { readout: [{ id: "temp", semanticKey: "gpu.temp" }] },
      source,
      undefined,
      "imperial",
    );

    expect(text.text).toBe("102°F");
    expect(source.latest().unit).toBe("°C");
  });

  it("carries an id on every object, nested ones included", async () => {
    const child = new FabricText("inner");
    child.set("id", "child");
    const group = new Group([child]);
    group.set("id", "group");
    const rect = new Rect({ width: 10, height: 10 });
    rect.set("id", "rect");

    const revived = new StaticCanvas(undefined, { width: 400, height: 300 });
    await reviveScene(revived, serialiseScene(canvasOf(rect, group)));

    const objects = revived.getObjects();

    expect(objects.map((object) => object.get("id"))).toEqual([
      "rect",
      "group",
    ]);
    expect(
      (objects[1] as Group).getObjects().map((object) => object.get("id")),
    ).toEqual(["child"]);
  });

  it("keeps an authored interaction lock across a round trip", async () => {
    // The bug this pins: undo revives through this save path, and Fabric omits
    // `selectable`, `evented` and `locked` from `toObject`, so a scene saved
    // without them came back with every object selectable — an authored
    // background, or a locked object, unbroke itself on the first undo. The
    // first mount looked correct only because the authored JSON still carried
    // the flags literally; nothing had been saved and revived yet.
    const background = new Rect({ width: 400, height: 300, fill: "#123" });
    background.set({ id: "background", selectable: false, evented: false });
    const locked = new Rect({ width: 10, height: 10 });
    locked.set({
      id: "locked",
      selectable: false,
      evented: false,
      locked: true,
    });
    const ordinary = new Rect({ width: 10, height: 10 });
    ordinary.set("id", "ordinary");

    const revived = new StaticCanvas(undefined, { width: 400, height: 300 });
    await reviveScene(
      revived,
      serialiseScene(canvasOf(background, locked, ordinary)),
    );

    const state = revived
      .getObjects()
      .map((object) => [
        object.get("id"),
        object.selectable,
        object.evented,
        object.get("locked"),
      ]);

    expect(state).toEqual([
      ["background", false, false, undefined],
      ["locked", false, false, true],
      // The other half of the contract: an ordinary object is still selectable,
      // so a fix that disarmed everything would fail here rather than pass.
      ["ordinary", true, true, undefined],
    ]);
  });

  it("strips the interaction flags again for an object that is ordinary", () => {
    const ordinary = new Rect({ width: 10, height: 10 });
    ordinary.set("id", "ordinary");

    // Listing a property is not the same as persisting it: defaults still go,
    // so an ordinary object adds no keys to the document.
    expect(keysOf(serialiseScene(canvasOf(ordinary)))).not.toContain(
      "selectable",
    );
  });

  it("matches by id and never by position", async () => {
    // The failure this prevents is silent: with position matching, inserting
    // one object at index 0 shifts every binding by one node and each id still
    // resolves to *some* object, so nothing raises an issue and every readout
    // is simply on the wrong node.
    const first = new Rect({ width: 10, height: 10 });
    first.set("id", "bound-chart");
    const second = new Rect({ width: 20, height: 20 });
    second.set("id", "other");

    const scene = serialiseScene(canvasOf(first, second));
    const inserted = new Rect({ width: 5, height: 5 });
    inserted.set("id", "inserted");

    const revived = new StaticCanvas(undefined, { width: 400, height: 300 });
    await reviveScene(revived, scene);
    revived.insertAt(0, inserted);

    const found = revived
      .getObjects()
      .find((object) => object.get("id") === "bound-chart");

    expect(found).toBeDefined();
    expect(revived.getObjects().indexOf(found!)).toBe(1);
  });

  it("emits no id at all when the argument is not passed", () => {
    // The reason this module exists. `canvas.toObject()` is a perfectly
    // ordinary call that silently produces an anonymous document, and nothing
    // downstream reports it until a binding fails to resolve.
    const rect = new Rect({ width: 10, height: 10 });
    rect.set("id", "rect");
    const canvas = canvasOf(rect);

    expect(keysOf(serialiseScene(canvas))).toContain("id");
    expect(
      Object.keys(canvas.toObject()["objects"][0] as object),
    ).not.toContain("id");
  });
});

describe("the Fabric theme envelope", () => {
  it("revives every baseline class used by the v2 demo fixture", async () => {
    const target = canvasOf();
    const envelope = {
      schemaVersion: 2,
      fabricVersion: "7.4.0",
      id: "demo",
      artboard: { width: 1, height: 1 },
      scene: {
        version: "7.4.0",
        objects: [
          { type: "Circle", radius: 1 },
          {
            type: "Path",
            path: [
              ["M", 0, 0],
              ["L", 1, 1],
            ],
          },
          { type: "Rect", width: 1, height: 1 },
          { type: "Textbox", text: "demo" },
        ],
      },
    } as const;

    await reviveThemeEnvelope(target, envelope);

    expect(target.getObjects()).toEqual([
      expect.any(Circle),
      expect.any(Path),
      expect.any(Rect),
      expect.any(Textbox),
    ]);
  });

  it("records this Fabric version and only authored scene state", () => {
    const rect = new Rect({ width: 10, height: 10 });
    rect.set("id", "rect");

    const envelope = serialiseThemeEnvelope(canvasOf(rect), {
      id: "theme",
      artboard: { width: 400, height: 300 },
      metadata: { themeLanguage: "en" },
      bindings: { rect: [] },
    });

    expect(envelope).toMatchObject({
      schemaVersion: 2,
      id: "theme",
      fabricVersion: "7.4.0",
    });
    expect((envelope.scene as SerialisedScene).objects[0]).toMatchObject({
      id: "rect",
      type: "Rect",
    });
    expect(validateFabricThemeEnvelope(envelope)).toMatchObject({ ok: true });
  });

  it("refuses a different Fabric version before replacing the scene", async () => {
    const target = canvasOf(new Rect({ width: 5, height: 5 }));
    const envelope = serialiseThemeEnvelope(
      canvasOf(new Rect({ width: 10, height: 10 })),
      {
        id: "theme",
        artboard: { width: 400, height: 300 },
      },
    );
    const incompatible = { ...envelope, fabricVersion: "7.5.0" };

    expect(() => assertFabricThemeEnvelopeCompatible(incompatible)).toThrow(
      "incompatible",
    );
    await expect(reviveThemeEnvelope(target, incompatible)).rejects.toThrow(
      "incompatible",
    );
    expect(target.getObjects()).toHaveLength(1);
  });
});

describe("reviving replaces chart resources", () => {
  it("disposes existing charts, including charts nested in groups", async () => {
    const chart = new YunariChart(chartOptions());
    const existing = canvasOf(new Group([chart]));
    const replacement = serialiseScene(
      canvasOf(new Rect({ width: 10, height: 10 })),
    );

    await reviveScene(existing, replacement);

    expect(chart.disposed).toBe(true);
    expect(existing.getObjects()).toHaveLength(1);
    expect(existing.getObjects()[0]).toBeInstanceOf(Rect);
  });
});

describe("a settings object cannot be mutated in place", () => {
  it("freezes what it was given, deeply", () => {
    const settings = { ...defaultLineSettings };
    const chart = new YunariChart(
      chartOptions({ settings } as Partial<YunariChartOptions>),
    );

    expect(Object.isFrozen(chart.settings)).toBe(true);
    // Fabric copies custom properties by reference, so the snapshot *is* the
    // live object — which is fine precisely because neither can be written.
    expect(() => {
      (chart.settings as unknown as Record<string, unknown>)["unit"] =
        "changed";
    }).toThrow(TypeError);
  });

  it("leaves an earlier snapshot unchanged when settings are replaced", () => {
    const chart = new YunariChart(chartOptions());
    chart.set("id", "chart-1");

    const before = serialiseScene(canvasOf(chart)).objects[0]!["settings"];

    chart.set("settings", { ...defaultLineSettings, unit: "replaced" });

    expect(chart.settings).not.toBe(before);
    expect((before as Record<string, unknown>)["unit"]).not.toBe("replaced");
  });
});

describe("there is exactly one owner of scene serialisation", () => {
  it("is the only module in the package that calls toObject", () => {
    // A grep, not a judgement. The rule it enforces — every save passes
    // `['id']` and strips defaults — is unenforceable by any test of
    // `persist.ts` itself, because the way to break it is to not call it.
    const root = dirname(fileURLToPath(import.meta.url));

    const walk = (directory: string): string[] =>
      readdirSync(directory).flatMap((entry) => {
        const full = join(directory, entry);

        if (statSync(full).isDirectory()) {
          return walk(full);
        }

        return entry.endsWith(".ts") && !entry.endsWith(".test.ts")
          ? [full]
          : [];
      });

    // Comment lines are dropped first, crudely but on purpose: `adapter.ts`
    // documents the save path as `canvas.toObject() -> envelope.scene`, and a
    // scan that cannot tell prose from a call would force the one module that
    // explains this rule to stop explaining it. A call hidden after code on the
    // same line as a `//` is not caught; that is a worse way to break the rule
    // than any this is likely to meet.
    const code = (file: string): string =>
      readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => !/^\s*(?:\/\/|\/?\*)/.test(line))
        .join("\n");

    const offenders = walk(root)
      .filter((file) => !file.endsWith("persist.ts"))
      .filter((file) => /\.toObject\s*\(/.test(code(file)))
      .map((file) => relative(root, file).replaceAll("\\", "/"));

    expect(
      offenders,
      `serialise through persist.ts — a bare toObject() drops every id and strips nothing:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("scans real sources", () => {
    // The guard on the guard: the scan above passes forever if it walks
    // nothing, and it walks a directory by path.
    const root = dirname(fileURLToPath(import.meta.url));

    expect(
      readdirSync(root).filter((entry: string) => entry.endsWith(".ts")).length,
    ).toBeGreaterThan(10);
    expect(SCENE_PERSISTED_PROPERTIES).toEqual([
      "id",
      YUNARI_NAME_PROPERTY,
      YUNARI_TEXT_PROPERTY,
      YUNARI_PAINT_PROPERTY,
      YUNARI_ASSET_PROPERTY,
      YUNARI_GLASS_PROPERTY,
      // The unit a card was authored as, on the starter and on a copy (§77).
      // Named literally rather than through a constant, because there is no
      // Fabric-side constant for it and one would have a single reader.
      "provenance",
      "selectable",
      "evented",
      "locked",
    ]);
  });
});

/**
 * The refusal, on the path a **display** takes.
 *
 * Round 2 enforced it in the editor's paint pass, which the player never runs:
 * `grep applyObjectPalettePaints packages/player` returns nothing, and the
 * adapter resolves no paint at all. Fabric restores a serialised `fill` inside
 * `loadFromJSON`, so a theme carrying a hand-authored filled arc reached a phone
 * as the 1933-pixel chord — the figure these two kinds exist to eliminate — while
 * the editor that authored it showed the curve. That inverts the plan's own
 * position: the device is a lens on the document only if both agree what the
 * document is.
 *
 * `reviveScene` is the one function both surfaces traverse, so it is the one
 * place that can settle it for both. These cases go through the player's own
 * entry, `reviveThemeEnvelope`, rather than the editor's, because an editor-side
 * assertion cannot carry this finding — the editor already had the refusal.
 */
describe("a refusal both surfaces apply", () => {
  /** A saved theme whose arc asks to be filled, as a hand-authored one would. */
  const filledArcEnvelope = (): ReturnType<typeof serialiseThemeEnvelope> => {
    const arc = new Arc({
      left: 20,
      top: 20,
      radius: 100,
      startAngle: 0,
      endAngle: 90,
      fill: "#4da3ff",
      stroke: "",
    });
    arc.set(YUNARI_PAINT_PROPERTY, { fill: "palette.cpu" });
    return serialiseThemeEnvelope(canvasOf(arc), {
      id: "theme",
      artboard: { width: 1920, height: 1080 },
    });
  };

  it("stops a filled arc painting its chord when a display revives it", async () => {
    // Through `reviveThemeEnvelope`, which is what `player/src/main.ts` calls.
    // No paint pass runs here, so anything painted is what Fabric restored.
    const canvas = new StaticCanvas(undefined, { width: 400, height: 300 });
    await reviveThemeEnvelope(canvas, filledArcEnvelope());

    const arc = canvas.getObjects()[0] as Arc;
    expect(arc.fill, "the chord never reaches a display").toBe("");
    expect(paintPropertyFor(arc)).toBe("stroke");
  });

  it("keeps the authored reference, because refusing a fill is not deleting it", async () => {
    // The same guarantee R1 made for the editor, on the display's path: the
    // document still says what it asked for, and still round-trips.
    const canvas = new StaticCanvas(undefined, { width: 400, height: 300 });
    await reviveThemeEnvelope(canvas, filledArcEnvelope());

    const arc = canvas.getObjects()[0] as Arc;
    expect(arc.get(YUNARI_PAINT_PROPERTY)).toEqual({ fill: "palette.cpu" });
    expect(serialiseScene(canvas).objects[0]![YUNARI_PAINT_PROPERTY]).toEqual({
      fill: "palette.cpu",
    });
  });

  it("leaves a wedge's fill alone, because its sector is a region it has", async () => {
    const wedge = new Wedge({
      left: 20,
      top: 20,
      radius: 100,
      startAngle: 0,
      endAngle: 90,
      fill: "#4da3ff",
    });
    const canvas = new StaticCanvas(undefined, { width: 400, height: 300 });
    await reviveThemeEnvelope(
      canvas,
      serialiseThemeEnvelope(canvasOf(wedge), {
        id: "theme",
        artboard: { width: 1920, height: 1080 },
      }),
    );

    expect((canvas.getObjects()[0] as Wedge).fill).toBe("#4da3ff");
  });

  it("refuses an arc nested in a group, which is where a card puts it", async () => {
    const group = new Group([
      new Arc({
        left: 0,
        top: 0,
        radius: 40,
        startAngle: 0,
        endAngle: 90,
        fill: "#4da3ff",
      }),
    ]);
    const canvas = new StaticCanvas(undefined, { width: 400, height: 300 });
    await reviveThemeEnvelope(
      canvas,
      serialiseThemeEnvelope(canvasOf(group), {
        id: "theme",
        artboard: { width: 1920, height: 1080 },
      }),
    );

    const revived = canvas.getObjects()[0] as Group;
    expect((revived.getObjects()[0] as Arc).fill).toBe("");
  });
});

/**
 * The refusal is reported **once**, from whichever site raised it.
 *
 * Two sites refuse, and both are load-bearing for the render (ADR-0026): revival
 * withholds what Fabric restored, and the editor's paint pass declines to
 * re-resolve the reference afterwards. Only one of them can be the one that
 * speaks for a given arc, because otherwise a single load says the same
 * sentence twice — and the half that said *nothing* was the half no test
 * reached, because every arc fixture in the suite set `YUNARI_PAINT_PROPERTY`.
 */
describe("a refusal is spoken once, from the site that raised it", () => {
  /** A filled arc as a hand-authored file carries it, with or without a
   *  palette reference — the two cases that belong to different sites. */
  const envelopeWith = (arc: Arc): ReturnType<typeof serialiseThemeEnvelope> =>
    serialiseThemeEnvelope(canvasOf(arc), {
      id: "theme",
      artboard: { width: 1920, height: 1080 },
    });

  const bareArc = (): Arc =>
    new Arc({
      left: 20,
      top: 20,
      radius: 100,
      startAngle: 0,
      endAngle: 90,
      fill: "#4da3ff",
      stroke: "",
    });

  it("speaks for the arc no palette reference points at", async () => {
    // The silent half. Revival refuses it; the paint pass never sees it, because
    // there is no reference to walk. Before, the author watched a figure vanish
    // from their document with nothing said at all.
    const told: string[] = [];
    const canvas = new StaticCanvas(undefined, { width: 400, height: 300 });
    await reviveThemeEnvelope(canvas, envelopeWith(bareArc()), undefined, {
      onRefusedPaint: (message) => told.push(message),
    });

    expect((canvas.getObjects()[0] as Arc).fill, "the fill is withheld").toBe(
      "",
    );
    expect(told, "and the author is told").toHaveLength(1);
    expect(told[0]).toMatch(/arc/i);
  });

  it("leaves the reference-carrying arc to the paint pass, so it is not said twice", async () => {
    // Both sites refuse this one and both have a channel. Reporting it here as
    // well would make one load two identical sentences, which is the same
    // crying wolf the diagnostic exists to avoid.
    const arc = bareArc();
    arc.set(YUNARI_PAINT_PROPERTY, { fill: "palette.cpu" });
    const told: string[] = [];
    const canvas = new StaticCanvas(undefined, { width: 400, height: 300 });
    await reviveThemeEnvelope(canvas, envelopeWith(arc), undefined, {
      onRefusedPaint: (message) => told.push(message),
    });

    const revived = canvas.getObjects()[0] as Arc;
    expect(revived.fill, "the render is refused either way").toBe("");
    expect(told, "revival stays quiet about the pass's arc").toEqual([]);

    // And the pass says it, exactly once.
    const said: string[] = [];
    applyObjectPalettePaints(canvas, globalsForRefusal, {
      onRefusedPaint: (message) => said.push(message),
    });
    expect(said, "the paint pass is the one site that speaks").toHaveLength(1);
  });

  it("says nothing at all for a wedge, whose sector is a region it has", async () => {
    const told: string[] = [];
    const canvas = new StaticCanvas(undefined, { width: 400, height: 300 });
    await reviveThemeEnvelope(
      canvas,
      envelopeWith(
        new Wedge({
          left: 20,
          top: 20,
          radius: 100,
          startAngle: 0,
          endAngle: 90,
          fill: "#4da3ff",
        }),
      ),
      undefined,
      { onRefusedPaint: (message) => told.push(message) },
    );

    expect((canvas.getObjects()[0] as Wedge).fill).toBe("#4da3ff");
    expect(told).toEqual([]);
  });
});

/** The palette the refusal cases resolve against; no token matters but one. */
const globalsForRefusal = {
  palette: { cpu: { name: "CPU", value: { kind: "solid", color: "#4da3ff" } } },
} as never;
