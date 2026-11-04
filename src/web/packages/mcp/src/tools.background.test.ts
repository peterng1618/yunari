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
import { createTheme, setBackground, setPalette } from "./tools/draft.js";

afterEach(closeHosts);

/** A draft with one declared video asset the media background can name. */
async function themeWithClip() {
  const host = await startHost(hostHandler());
  const ctx = context(host);
  const created = payload(
    await createTheme(ctx, { name: "Mine", width: 800, height: 480 }),
  );
  const themeId = created.themeId as string;

  const draft = ctx.drafts.current();
  draft.envelope = addAsset(
    draft.envelope,
    {
      id: "clip",
      kind: "video",
      path: "assets/clip.mp4",
      sha256: "0".repeat(64),
    },
    Uint8Array.of(1, 2, 3),
  );

  await setPalette(ctx, [
    { id: "surface", name: "Surface", value: "#101418" },
    { id: "accent", name: "Accent", value: "#c9a227" },
  ]);
  return { host, ctx, themeId };
}

describe("set_background composition", () => {
  it("writes a fill, an inset region and a linear blend", async () => {
    const { ctx } = await themeWithClip();

    const result = await setBackground(ctx, {
      color: "accent",
      mediaAssetId: "clip",
      fill: "surface",
      inset: { left: 0.35 },
      blend: { edge: "left", length: 0.12 },
    });
    expect(result.isError).toBeUndefined();

    const background = ctx.drafts.current().envelope.background;
    expect(background?.fill).toEqual({ ref: "palette.surface" });
    expect(background?.media?.region).toEqual({
      left: 0.35,
      blend: { shape: "linear", edge: "left", length: 0.12 },
    });
  });

  it("keeps the declared media when only composition fields are passed", async () => {
    const { ctx } = await themeWithClip();
    await setBackground(ctx, {
      mediaAssetId: "clip",
      bounds: "display",
      inset: { left: 0.2 },
    });

    await setBackground(ctx, {
      blend: { shape: "radial", length: 0.3 },
    });

    const media = ctx.drafts.current().envelope.background?.media;
    expect(media?.assetId).toBe("clip");
    expect(media?.bounds).toBe("display");
    expect(media?.region).toEqual({
      left: 0.2,
      blend: { shape: "radial", length: 0.3 },
    });
  });

  it("refuses a blend length outside the model range", async () => {
    const { ctx } = await themeWithClip();
    await setBackground(ctx, { mediaAssetId: "clip", inset: { left: 0.2 } });
    const before = structuredClone(ctx.drafts.current().envelope.background);

    const result = await setBackground(ctx, {
      blend: { shape: "radial", length: 0 },
    });

    expect(result.isError).toBe(true);
    expect(refusalTextOf(result)).toMatch(/length/i);
    expect(ctx.drafts.current().envelope.background).toEqual(before);
  });

  it("refuses an inset that leaves no area", async () => {
    const { ctx } = await themeWithClip();

    const result = await setBackground(ctx, {
      mediaAssetId: "clip",
      inset: { left: 0.5, right: 0.5 },
    });

    expect(result.isError).toBe(true);
    expect(ctx.drafts.current().envelope.background?.media).toBeUndefined();
  });

  it("refuses a composition on a background with no media", async () => {
    const { ctx } = await themeWithClip();

    const result = await setBackground(ctx, {
      fill: "surface",
      inset: { left: 0.2 },
    });

    expect(result.isError).toBe(true);
    expect(refusalTextOf(result)).toMatch(/media/i);
  });
});
