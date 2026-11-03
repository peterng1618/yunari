import { afterEach, describe, expect, it } from "vitest";
import {
  closeHosts,
  context,
  hostHandler,
  payload,
  startHost,
} from "./testing/tool-fixtures.js";
import {
  addShape,
  addText,
  listObjects,
  reorderObject,
} from "./tools/compose.js";
import { createTheme } from "./tools/draft.js";
import { validateTheme } from "./tools/verify.js";

afterEach(closeHosts);

describe("reorder_object", () => {
  it("restacks a scene object so a scrim can sit behind text", async () => {
    const host = await startHost(hostHandler());
    const ctx = context(host);
    const created = payload(
      await createTheme(ctx, { name: "Mine", width: 800, height: 480 }),
    );
    const themeId = created.themeId as string;
    const box = { left: 0, top: 0, width: 100, height: 100 };

    const text = payload(
      await addText(ctx, { box, runs: [{ text: "Hi", size: 12 }] }),
    );
    const scrim = payload(await addShape(ctx, { kind: "rect", box }));
    const textIds = text.ids as readonly string[];
    const scrimIds = scrim.ids as readonly string[];

    const moved = payload(
      await reorderObject(ctx, scrimIds[0] as string, "back", themeId),
    );
    expect(moved).toMatchObject({ objectId: scrimIds[0], moved: true });

    const listed = payload(await listObjects(ctx, themeId));
    expect(
      (listed.objects as readonly { readonly id: string }[])
        .map((object) => object.id)
        .slice(0, 2),
    ).toEqual([scrimIds[0], textIds[0]]);
    expect(payload(await validateTheme(ctx, themeId))).toMatchObject({
      ok: true,
      issues: [],
    });
  });
});
