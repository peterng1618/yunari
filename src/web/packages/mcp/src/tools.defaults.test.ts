import { addAsset } from "@yunari/theme-kit";
import { afterEach, describe, expect, it } from "vitest";
import {
  closeHosts,
  context,
  hostHandler,
  payload,
  refusalTextOf,
  startHost,
} from "./testing/tool-fixtures.js";
import { removeDraftAsset } from "./tools/assets.js";
import { addChart, addImage, addShape, addText } from "./tools/compose.js";
import { createTheme } from "./tools/draft.js";
import { validateTheme } from "./tools/verify.js";

afterEach(closeHosts);

describe("authoring defaults", () => {
  it("keeps an omitted author omitted", async () => {
    const host = await startHost(hostHandler());
    const ctx = context(host);
    const created = payload(
      await createTheme(ctx, { name: "Mine", width: 800, height: 480 }),
    );
    const envelope = created.envelope as {
      readonly metadata?: Readonly<Record<string, unknown>>;
    };
    expect(envelope.metadata).not.toHaveProperty("author");
  });

  it("lets a run choose its type token and adds no implicit tracking", async () => {
    const host = await startHost(hostHandler());
    const ctx = context(host);
    const created = payload(
      await createTheme(ctx, { name: "Mine", width: 800, height: 480 }),
    );
    const themeId = created.themeId as string;

    await addText(ctx, {
      box: { left: 10, top: 10, width: 200, height: 24 },
      runs: [
        {
          kind: "literal",
          text: "SYSTEM",
          token: "text",
          size: 17,
          typeToken: "mono",
        },
      ],
    });

    const object = (
      ctx.drafts.read(themeId).envelope.scene as {
        readonly objects: readonly Record<string, unknown>[];
      }
    ).objects[0] as {
      readonly yunariText?: {
        readonly runs?: readonly {
          readonly typeToken?: string;
          readonly style?: { readonly letterSpacing?: unknown };
        }[];
      };
    };
    expect(object.yunariText?.runs?.[0]?.typeToken).toBe("typeTokens.mono");
    expect(object.yunariText?.runs?.[0]?.style?.letterSpacing).toBeUndefined();
  });

  it("adds a chart whose default paint validates", async () => {
    const host = await startHost(hostHandler());
    const ctx = context(host);
    const created = payload(
      await createTheme(ctx, { name: "Mine", width: 800, height: 480 }),
    );
    const themeId = created.themeId as string;

    await addChart(ctx, {
      family: "line",
      box: { left: 10, top: 10, width: 400, height: 200 },
      binding: { id: "cpu", semanticKey: "cpu.load" },
    });

    expect(payload(await validateTheme(ctx, themeId)).ok).toBe(true);
  });

  it("scales a path's default stroke to the artboard and keeps an explicit one", async () => {
    const host = await startHost(hostHandler());
    const ctx = context(host);
    const created = payload(
      await createTheme(ctx, { name: "Mine", width: 1920, height: 1080 }),
    );
    const themeId = created.themeId as string;
    const line = {
      kind: "path" as const,
      box: { left: 100, top: 500, width: 800, height: 0 },
      points: [
        ["M", 0, 0],
        ["L", 800, 0],
      ],
    };

    await addShape(ctx, line);
    await addShape(ctx, { ...line, strokeWidth: 2 });

    const objects = (
      ctx.drafts.read(themeId).envelope.scene as {
        readonly objects: readonly { readonly strokeWidth?: number }[];
      }
    ).objects;
    // 1920 / 240 = 8 units: about a pixel on a 320 px display.
    expect(objects[0]?.strokeWidth).toBe(8);
    expect(objects[1]?.strokeWidth).toBe(2);
  });

  it("drops an unused declared asset and refuses one a scene still uses", async () => {
    const host = await startHost(hostHandler());
    const ctx = context(host);
    const created = payload(
      await createTheme(ctx, { name: "Mine", width: 800, height: 480 }),
    );
    const themeId = created.themeId as string;
    const bytes = Uint8Array.from([1, 2, 3]);
    const reference = {
      id: "clip-1",
      kind: "video" as const,
      path: "assets/clip-1.mp4",
      sha256: "ab".repeat(32),
      license: { name: "CC0" },
    };

    const declare = () => {
      const draft = ctx.drafts.read(themeId);
      draft.envelope = addAsset(draft.envelope, reference, bytes);
      ctx.drafts.setAsset(themeId, reference.path, bytes);
    };

    declare();
    expect(
      payload(await removeDraftAsset(ctx, "clip-1", themeId)),
    ).toMatchObject({ removed: "clip-1", path: reference.path });
    expect(ctx.drafts.read(themeId).assets).not.toHaveProperty(reference.path);
    expect(ctx.drafts.read(themeId).envelope.assets).toEqual([]);

    declare();
    await addImage(ctx, {
      assetId: "clip-1",
      box: { left: 0, top: 0, width: 100, height: 100 },
    });
    const refused = await removeDraftAsset(ctx, "clip-1", themeId);
    expect(refused.isError).toBe(true);
    expect(refusalTextOf(refused)).toContain("still used");
  });
});
