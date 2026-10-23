import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CATALOGUE_ID_PATTERN } from "./catalogue-index.js";
import {
  BACKGROUND_MEDIA_BOUNDS,
  MAX_BACKGROUND_OFFSET,
  MAX_TAGS,
  MIN_BACKGROUND_OFFSET,
  TAG_PATTERN,
} from "./document.js";
import { SUPPORTED_SCHEMA_VERSION } from "./fabric-envelope.js";
import { GLASS_TYPES, MAX_GLASS_BLUR_RADIUS } from "./glass.js";
import { MAX_OBJECT_NAME_LENGTH } from "./object-name.js";

const SCHEMA_PATH = fileURLToPath(
  new URL(
    "../../../../../../schema/theme-document.schema.json",
    import.meta.url,
  ),
);

interface SchemaShape {
  readonly $id: string;
  readonly required: readonly string[];
  readonly properties: Record<string, Record<string, unknown>>;
  readonly $defs: Record<string, Record<string, unknown>>;
}

function schema(): SchemaShape {
  return JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as SchemaShape;
}

describe("published Fabric theme schema", () => {
  it("publishes the v2 envelope rather than the obsolete node tree", () => {
    const document = schema();

    expect(document.$id).toContain("/2.json");
    // The version is stated twice — here and in `SUPPORTED_SCHEMA_VERSION` —
    // and the About row reports the code's copy, so a theme published under
    // one and opened under the other would be refused for no reason.
    expect(document.properties["schemaVersion"]).toEqual({
      const: SUPPORTED_SCHEMA_VERSION,
    });
    expect(document.required).toEqual([
      "schemaVersion",
      "fabricVersion",
      "id",
      "artboard",
      "scene",
    ]);
    expect(document.properties["nodes"]).toBeUndefined();
    expect(document.properties["scene"]).toBeDefined();
  });

  it("keeps envelope bindings and assets explicit while dropping GIF assets", () => {
    const document = schema();
    const asset = document.$defs["nonFontAssetReference"]![
      "properties"
    ] as Record<string, Record<string, unknown>>;
    const binding = document.$defs["binding"]!;

    expect(asset["kind"]!["enum"]).toEqual(["image", "svg", "video"]);
    expect(binding["required"]).toContain("id");
    expect(document.properties["bindings"]).toBeDefined();
  });

  it("publishes structured palette paints while allowing CSS-compatible colours", () => {
    const document = schema();
    const palette = document.$defs["paletteGroup"]!;
    const paint = document.$defs["palettePaint"]!;

    expect(palette["required"]).toEqual(["none"]);
    expect(palette["additionalProperties"]).toMatchObject({
      properties: { value: { $ref: "#/$defs/palettePaint" } },
    });
    expect(paint["oneOf"]).toHaveLength(2);
  });

  it("publishes only v2 globals and the background layer's own paint", () => {
    const document = schema();
    const globals = document.$defs["globals"]!["properties"] as Record<
      string,
      Record<string, unknown>
    >;
    const preset = document.$defs["typePreset"]!;
    const artboard = document.$defs["artboard"]!["properties"] as Record<
      string,
      Record<string, unknown>
    >;

    expect(Object.keys(globals)).toEqual(["palette", "typePresets"]);
    expect(globals["typePresets"]).toEqual({ $ref: "#/$defs/typePresetGroup" });
    expect(preset["required"]).toEqual(["family", "size", "face"]);
    expect(preset["properties"]).toMatchObject({
      face: { $ref: "#/$defs/fontFaceReference" },
      trioRole: { enum: ["heading", "body", "mono"] },
    });
    expect(artboard["background"]).toBeUndefined();
    expect(artboard["backgroundMedia"]).toBeUndefined();
    expect(artboard["barColor"]).toBeUndefined();
    expect(document.properties["background"]).toEqual({
      $ref: "#/$defs/background",
    });
    expect(document.$defs["background"]).toMatchObject({
      additionalProperties: false,
      properties: {
        color: { $ref: "#/$defs/paletteReference" },
        media: { $ref: "#/$defs/backgroundMedia" },
      },
    });
    expect(document.$defs["metadata"]?.["properties"]).toMatchObject({
      version: { type: "string", pattern: "^\\d+\\.\\d+\\.\\d+$" },
    });
    expect(document.$defs["styleValue"]).toBeUndefined();
    expect(document.$defs["globalGroup"]).toBeUndefined();
  });

  it("publishes the artboard's own fit under a name that says what it fits", () => {
    // The artboard's fit and the background media's fit were both called "fit"
    // in one panel and one document, meaning two different things — an author
    // reading them together could not tell which was which. The published key is
    // half the fix and the half a tool reads, so it moves with the code.
    const artboard = schema().$defs["artboard"]!["properties"] as Record<
      string,
      Record<string, unknown>
    >;

    expect(artboard["contentFit"]).toEqual({ enum: ["contain", "cover"] });
    expect(artboard["fitMode"]).toBeUndefined();
  });

  it("publishes the background media's bounds, flips and ranges the validator accepts", () => {
    // The media is always `cover`, so `fit` and `scale` are not published at
    // all: a stored document carrying either is refused by the unknown-key
    // check. Bounds, flips and the offset ranges are the whole authored bag.
    const media = schema().$defs["backgroundMedia"]!["properties"] as Record<
      string,
      Record<string, unknown>
    >;

    expect(media["assetId"]).toEqual({ $ref: "#/$defs/stableId" });
    expect(media["bounds"]).toEqual({ enum: [...BACKGROUND_MEDIA_BOUNDS] });
    expect(media["fit"]).toBeUndefined();
    expect(media["scale"]).toBeUndefined();
    expect(media["flipX"]).toEqual({ type: "boolean" });
    expect(media["flipY"]).toEqual({ type: "boolean" });
    expect(media["offsetX"]).toEqual({
      type: "number",
      minimum: MIN_BACKGROUND_OFFSET,
      maximum: MAX_BACKGROUND_OFFSET,
    });
    expect(media["offsetY"]).toEqual({
      type: "number",
      minimum: MIN_BACKGROUND_OFFSET,
      maximum: MAX_BACKGROUND_OFFSET,
    });
    expect(schema().$defs["backgroundMedia"]!["required"]).toEqual([
      "assetId",
      "bounds",
    ]);
  });

  it("publishes the glass treatment at the bound the runtime enforces", () => {
    // The measured cap is a renderer budget, so the published maximum is
    // compared against the same constant the validator refuses against. A
    // copied literal here would let the two drift silently, and a theme
    // accepted by one would be rejected by the other.
    const document = schema();
    const treatment = document.$defs["glassTreatment"]!;
    const radius = (
      treatment["properties"] as Record<string, Record<string, unknown>>
    )["blurRadius"]!;

    expect(treatment["required"]).toEqual(["blurRadius"]);
    expect(treatment["additionalProperties"]).toBe(false);
    expect(radius).toEqual({
      type: "number",
      minimum: 0,
      maximum: MAX_GLASS_BLUR_RADIUS,
    });
    expect(
      (
        document.$defs["fabricObject"]!["properties"] as Record<
          string,
          Record<string, unknown>
        >
      )["yunariGlass"],
    ).toEqual({ $ref: "#/$defs/glassTreatment" });
  });

  it("publishes the same object-kind restriction the validator refuses", () => {
    // The kind rule is the part most likely to drift: the validator refuses
    // glass on anything but a measured kind, and a schema that stayed silent
    // would let a tool author a treatment the editor then refuses to open.
    // Compared against the exported set, not a copied list, so widening one
    // side without the other fails here.
    const published = (
      schema().$defs["fabricObject"]!["allOf"] as Record<string, unknown>[]
    )[0] as Record<string, Record<string, unknown>>;
    const types = (
      published["then"]!["properties"] as Record<
        string,
        Record<string, unknown>
      >
    )["type"]!;

    expect(published["if"]).toEqual({ required: ["yunariGlass"] });
    expect(types["enum"]).toEqual(GLASS_TYPES);
  });

  it("publishes the object name at the bound the validator refuses", () => {
    // Same reason as the glass bound above: a copied literal here would let a
    // name the editor accepts be rejected by the schema, or the reverse.
    const document = schema();
    const name = document.$defs["objectName"]!;

    expect(name["type"]).toBe("string");
    expect(name["maxLength"]).toBe(MAX_OBJECT_NAME_LENGTH);
    expect(
      (
        document.$defs["fabricObject"]!["properties"] as Record<
          string,
          Record<string, unknown>
        >
      )["name"],
    ).toEqual({ $ref: "#/$defs/objectName" });
  });

  it("refuses an empty theme name, which the loader migrates rather than relaxing", () => {
    // `vg-221`. The schema is the only refusal, and deliberately so: the
    // Document pane drops an emptied name rather than writing `""` (`compact`),
    // and the envelope validator never read the name — so this is the half a
    // tool outside this repo sees, and the loader's `namedEnvelope` is the half
    // that keeps a stored document loading. Both bounds are pinned here because
    // the disagreement test compares key sets alone and would not notice either
    // one moving.
    const name = (
      schema().$defs["metadata"]!["properties"] as Record<
        string,
        Record<string, unknown>
      >
    )["name"]!;

    expect(name).toEqual({ type: "string", minLength: 1, maxLength: 200 });
  });

  it("publishes the tag shape the validator enforces, and no vocabulary with it", () => {
    // The pattern and the cap are stated twice — in `document.ts` and in
    // `schema/theme-document.schema.json` — and this file is the comparison
    // between them, so they are read from the constants rather than from copied
    // literals, for the reason the glass and object-name bounds above give: a
    // theme accepted by one side and refused by the other is silent.
    const tags = (
      schema().$defs["metadata"]!["properties"] as Record<
        string,
        Record<string, unknown>
      >
    )["tags"]!;
    const items = tags["items"] as Record<string, unknown>;

    expect(tags["type"]).toBe("array");
    expect(tags["maxItems"]).toBe(MAX_TAGS);
    expect(items["pattern"]).toBe(TAG_PATTERN.source);
    // The source alone would leave a stray flag unpinned: `i` accepts `Retro`
    // here while the schema, which has no flags to give, keeps refusing it.
    expect(TAG_PATTERN.flags).toBe("");
    // And no vocabulary in the format, on either level. This is the decision's
    // whole content (docs/decisions/0087): an enum here would make a style the
    // catalogue does not yet have wait for a schema release.
    expect(tags["enum"]).toBeUndefined();
    expect(items["enum"]).toBeUndefined();
  });

  it("publishes the remix credit the validator refuses, with the same id shape", () => {
    // `metadata` is closed on both sides, so a credit the editor writes must be
    // a member the published schema declares — and its patterns are stated
    // twice, so they are compared against the constants rather than copies.
    const document = schema();
    const metadata = document.$defs["metadata"]!;
    const remix = document.$defs["remix"]!;
    const properties = remix["properties"] as Record<
      string,
      Record<string, unknown>
    >;

    expect(metadata["properties"]).toMatchObject({
      remixOf: { $ref: "#/$defs/remix" },
    });
    expect(remix["additionalProperties"]).toBe(false);
    expect(remix["required"]).toEqual(["catalogueId", "name", "version"]);
    expect(properties["catalogueId"]).toEqual({
      type: "string",
      pattern: CATALOGUE_ID_PATTERN.source,
    });
    expect(properties["name"]).toEqual({ type: "string", minLength: 1 });
    expect(properties["version"]).toEqual({
      type: "string",
      pattern: "^\\d+\\.\\d+\\.\\d+$",
    });
  });

  it("discriminates fully declared WOFF2 font assets from other assets", () => {
    const document = schema();
    const asset = document.$defs["assetReference"]!;
    const font = document.$defs["fontAssetReference"]!;

    expect(asset["oneOf"]).toHaveLength(2);
    expect(font["required"]).toEqual([
      "id",
      "kind",
      "path",
      "family",
      "weight",
      "style",
      "format",
      "sourceUrl",
      "license",
    ]);
    expect(font["properties"]).toMatchObject({
      kind: { const: "font" },
      format: { const: "woff2" },
    });
  });
});
