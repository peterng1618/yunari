import type { AssetReference, Binding } from "@yunari/renderer-core";
import {
  addImageObject,
  createStarterTheme,
  type ObjectJson,
} from "@yunari/theme-kit";
import {
  readWidgetPackage,
  type WidgetPackSummary,
  writeWidgetPackage,
} from "@yunari/theme-package";
import { afterEach, describe, expect, it } from "vitest";
import {
  closeHosts,
  context,
  payload,
  sceneObjects,
  startHost,
} from "../testing/tool-fixtures.js";
import { addCard } from "./compose.js";
import { createTheme } from "./draft.js";

afterEach(closeHosts);

const PACK_ID = "pack-a";
const PNG_BYTES = new Uint8Array([137, 80, 78, 71]);
/** The lowercase SHA-256 of `PNG_BYTES`. */
const PNG_SHA =
  "0f4636c78f65d3639ece5a064b5ae753e3408614a14fb18ab4d7540d2c248543";

interface FixtureUnit {
  readonly id: string;
  readonly label: string;
  readonly objects: readonly ObjectJson[];
  readonly declarations?: readonly AssetReference[];
  readonly assets?: Readonly<Record<string, Uint8Array>>;
  readonly bindings?: Readonly<Record<string, readonly Binding[]>>;
}

/** One pack's bytes from units whose top-level objects already carry
 *  provenance. The writer validates the document, so a fixture cannot describe
 *  a package the reader would refuse. */
function packBytes(units: readonly FixtureUnit[]): Uint8Array {
  const { artboard: _artboard, ...document } = createStarterTheme();
  const written = writeWidgetPackage({
    document: {
      ...document,
      scene: {
        version: "7.4.0",
        objects: units.flatMap((unit) => unit.objects),
      },
      bindings: Object.assign({}, ...units.map((unit) => unit.bindings ?? {})),
      assets: units.flatMap((unit) => unit.declarations ?? []),
    },
    assets: Object.assign({}, ...units.map((unit) => unit.assets ?? {})),
  });
  if (!written.ok) throw new Error(written.message);
  return written.bytes;
}

/** A unit that is a group over one bound text part. */
function boundUnit(id = "a", label = "Unit A"): FixtureUnit {
  return {
    id,
    label,
    bindings: {
      [`${id}-value`]: [{ id: `${id}-binding`, semanticKey: "cpu.load" }],
    },
    objects: [
      {
        id: `${id}-group`,
        type: "Group",
        left: 0,
        top: 0,
        width: 100,
        height: 100,
        provenance: { widgetId: id, widgetName: label },
        objects: [
          { id: `${id}-value`, type: "text", left: 0, top: 0, text: "42" },
        ],
      },
    ],
  };
}

/** A unit whose subtree draws one declared picture. */
function imageUnit(
  id: string,
  declarations: readonly AssetReference[],
  assets: Readonly<Record<string, Uint8Array>>,
): FixtureUnit {
  return {
    id,
    label: "Picture",
    objects: [
      {
        ...addImageObject({
          id: `${id}-image`,
          assetId: declarations[0]?.id ?? "missing",
          kind: "image",
          left: 0,
          top: 0,
          width: 20,
          height: 20,
        }),
        provenance: { widgetId: id, widgetName: "Picture" },
      },
    ],
    declarations,
    assets,
  };
}

/** A unit whose subtree draws two declared pictures. */
function twoImageUnit(
  id: string,
  declarations: readonly AssetReference[],
  assets: Readonly<Record<string, Uint8Array>>,
): FixtureUnit {
  const image = (index: number, assetId: string): ObjectJson =>
    addImageObject({
      id: `${id}-image-${index}`,
      assetId,
      kind: "image",
      left: index * 30,
      top: 0,
      width: 20,
      height: 20,
    });
  return {
    id,
    label: "Two pictures",
    objects: [
      {
        id: `${id}-group`,
        type: "Group",
        left: 0,
        top: 0,
        width: 50,
        height: 20,
        provenance: { widgetId: id, widgetName: "Two pictures" },
        objects: declarations.map((declaration, index) =>
          image(index, declaration.id),
        ),
      },
    ],
    declarations,
    assets,
  };
}

function summaryOf(id: string, bytes: Uint8Array): WidgetPackSummary {
  const read = readWidgetPackage(bytes);
  if (!read.ok) throw new Error(read.message);
  return {
    id,
    name: read.name ?? id,
    version: read.version,
    units: read.units.map((unit) => ({ id: unit.id, label: unit.label })),
  };
}

/** A fake host serving the given packs. */
async function packHost(
  packs: readonly { readonly id: string; readonly bytes: Uint8Array }[],
) {
  return await startHost((request) => {
    const url = new URL(request.path, "http://127.0.0.1");
    if (url.pathname === "/api/widget-packs") {
      return {
        body: {
          packs: packs.map((pack) => summaryOf(pack.id, pack.bytes)),
        },
      };
    }
    const pack = packs.find(
      (candidate) => url.pathname === `/api/widget-packs/${candidate.id}`,
    );
    return pack === undefined
      ? undefined
      : {
          headers: { "content-type": "application/zip" },
          body: Buffer.from(pack.bytes),
        };
  });
}

async function draftWithTheme() {
  const ctx = context(
    await packHost([{ id: PACK_ID, bytes: packBytes([boundUnit()]) }]),
  );
  await createTheme(ctx, { name: "Mine", width: 1672, height: 941 });
  return ctx;
}

describe("add_card", () => {
  it("inserts a packaged unit with its group and its binding", async () => {
    const ctx = await draftWithTheme();

    const inserted = payload(
      await addCard(ctx, { unit: "a", left: 10, top: 20 }),
    );

    expect((inserted.ids as string[]).length).toBeGreaterThan(1);
    const group = sceneObjects(ctx).find(
      (object) => object["provenance"] !== undefined,
    );
    expect(group).toMatchObject({ type: "Group" });

    const bindings = Object.values(
      ctx.drafts.current().envelope.bindings ?? {},
    ).flat();
    expect(bindings.map((binding) => binding.semanticKey)).toContain(
      "cpu.load",
    );
  });

  it("refuses an unknown unit id, naming the installed ones", async () => {
    const ctx = await draftWithTheme();

    const result = await addCard(ctx, { unit: "missing", left: 0, top: 0 });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining('no card unit "missing"'),
    });
  });

  it("refuses a unit id offered by more than one installed pack", async () => {
    const first = packBytes([boundUnit("a", "First")]);
    const second = packBytes([boundUnit("a", "Second")]);
    const ctx = context(
      await packHost([
        { id: "pack-first", bytes: first },
        { id: "pack-second", bytes: second },
      ]),
    );
    await createTheme(ctx, { name: "Mine", width: 1672, height: 941 });

    const result = await addCard(ctx, { unit: "a", left: 0, top: 0 });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("more than one installed pack"),
    });
  });

  it("inserts an asset-bearing unit twice under fresh ids and paths", async () => {
    const declaration: AssetReference = {
      id: "pack-image",
      kind: "image",
      path: "assets/pack.png",
      sha256: PNG_SHA,
    };
    const unit = imageUnit("picture", [declaration], {
      "assets/pack.png": PNG_BYTES,
    });
    const ctx = context(
      await packHost([{ id: PACK_ID, bytes: packBytes([unit]) }]),
    );
    await createTheme(ctx, { name: "Mine", width: 800, height: 480 });

    await addCard(ctx, { unit: "picture", left: 0, top: 0 });
    await addCard(ctx, { unit: "picture", left: 100, top: 0 });

    const declared = ctx.drafts.current().envelope.assets ?? [];
    expect(declared.map((asset) => asset.path)).toEqual([
      "assets/pack.png",
      "assets/pack-2.png",
    ]);
    const references = sceneObjects(ctx).flatMap((object) => {
      const asset = object["yunariAsset"];
      return typeof asset === "object" && asset !== null
        ? [(asset as { readonly assetId?: unknown }).assetId]
        : [];
    });
    expect(new Set(references).size).toBe(2);
    expect(ctx.drafts.current().assets["assets/pack-2.png"]).toEqual(PNG_BYTES);
  });

  it("refuses bytes that disagree with the digest and leaves the draft untouched", async () => {
    const declaration: AssetReference = {
      id: "pack-image",
      kind: "image",
      path: "assets/pack.png",
      sha256: "f".repeat(64),
    };
    const unit = imageUnit("picture", [declaration], {
      "assets/pack.png": PNG_BYTES,
    });
    const ctx = context(
      await packHost([{ id: PACK_ID, bytes: packBytes([unit]) }]),
    );
    await createTheme(ctx, { name: "Mine", width: 800, height: 480 });
    const before = JSON.stringify(ctx.drafts.current().envelope);
    const beforeAssets = { ...ctx.drafts.current().assets };

    const result = await addCard(ctx, { unit: "picture", left: 0, top: 0 });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("does not match"),
    });
    expect(JSON.stringify(ctx.drafts.current().envelope)).toBe(before);
    expect(ctx.drafts.current().assets).toEqual(beforeAssets);
  });

  it("adopts nothing when a later declaration in the unit is invalid", async () => {
    const good: AssetReference = {
      id: "pack-image",
      kind: "image",
      path: "assets/pack.png",
      sha256: PNG_SHA,
    };
    const bad: AssetReference = {
      id: "second-image",
      kind: "image",
      path: "assets/second.png",
      sha256: "f".repeat(64),
    };
    const unit = twoImageUnit("pair", [good, bad], {
      "assets/pack.png": PNG_BYTES,
      "assets/second.png": PNG_BYTES,
    });
    const ctx = context(
      await packHost([{ id: PACK_ID, bytes: packBytes([unit]) }]),
    );
    await createTheme(ctx, { name: "Mine", width: 800, height: 480 });
    const before = JSON.stringify(ctx.drafts.current().envelope);

    const result = await addCard(ctx, { unit: "pair", left: 0, top: 0 });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(ctx.drafts.current().envelope)).toBe(before);
    expect(ctx.drafts.current().assets["assets/pack.png"]).toBeUndefined();
  });
});
