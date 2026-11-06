import { createStarterTheme } from "@yunari/theme-kit";
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

/** A pack whose single unit `a` is a group over one bound text part. */
function packBytes(): Uint8Array {
  const { artboard: _artboard, ...document } = createStarterTheme();
  const written = writeWidgetPackage({
    document: {
      ...document,
      scene: {
        version: "7.4.0",
        objects: [
          {
            id: "a-group",
            type: "Group",
            left: 0,
            top: 0,
            width: 100,
            height: 100,
            provenance: { widgetId: "a", widgetName: "Unit A" },
            objects: [
              { id: "a-value", type: "text", left: 0, top: 0, text: "42" },
            ],
          },
        ],
      },
      bindings: {
        "a-value": [{ id: "a-binding", semanticKey: "cpu.load" }],
      },
      assets: [],
    },
    assets: {},
  });
  if (!written.ok) throw new Error(written.message);
  return written.bytes;
}

function summary(): WidgetPackSummary {
  const read = readWidgetPackage(packBytes());
  if (!read.ok) throw new Error(read.message);
  return {
    id: PACK_ID,
    name: read.name ?? PACK_ID,
    version: read.version,
    units: read.units.map((unit) => ({ id: unit.id, label: unit.label })),
  };
}

function packHost() {
  const bytes = packBytes();
  return async (request: { readonly path: string }) => {
    const url = new URL(request.path, "http://127.0.0.1");
    if (url.pathname === "/api/widget-packs") {
      return { body: { packs: [summary()] } };
    }
    if (url.pathname === `/api/widget-packs/${PACK_ID}`) {
      return {
        headers: { "content-type": "application/zip" },
        body: Buffer.from(bytes),
      };
    }
    return undefined;
  };
}

describe("add_card", () => {
  it("inserts a packaged unit with its group and its binding", async () => {
    const host = await startHost(packHost());
    const ctx = context(host);
    await createTheme(ctx, { name: "Mine", width: 1672, height: 941 });

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
});
