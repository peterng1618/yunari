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
  it("starts a newly chosen asset at the display bounds", async () => {
    const { ctx } = await themeWithClip();

    await setBackground(ctx, { mediaAssetId: "clip" });

    // The MCP surface reads the same default the editor's switch does; a
    // second literal here is what this assertion keeps from coming back.
    expect(ctx.drafts.current().envelope.background?.media?.bounds).toBe(
      "display",
    );
  });

  it("writes an anchored, faded media", async () => {
    const { ctx } = await themeWithClip();

    const result = await setBackground(ctx, {
      mode: "advanced",
      color: "accent",
      mediaAssetId: "clip",
      anchor: "left",
      extent: 0.65,
      fade: 0.12,
    });
    expect(result.isError).toBeUndefined();

    const background = ctx.drafts.current().envelope.background;
    expect(background?.media?.composition).toEqual({
      anchor: "left",
      extent: 0.65,
      fade: 0.12,
    });
  });

  it("keeps the authored media fields when the same asset is restated", async () => {
    const { ctx } = await themeWithClip();
    await setBackground(ctx, {
      mode: "advanced",
      mediaAssetId: "clip",
      bounds: "display",
      offsetX: 0.25,
      scale: 2,
      flipX: true,
      anchor: "left",
      extent: 0.4,
    });

    const result = await setBackground(ctx, {
      mediaAssetId: "clip",
      fallbackFrame: 12,
    });
    expect(result.isError).toBeUndefined();

    // The blank theme's page paint moves onto the first picture, as the
    // editor's own asset switch does: one owner for the colour.
    expect(ctx.drafts.current().envelope.background?.media).toEqual({
      assetId: "clip",
      color: { ref: "palette.chartTrack" },
      bounds: "display",
      offsetX: 0.25,
      scale: 2,
      flipX: true,
      fallbackFrame: 12,
      composition: { anchor: "left", extent: 0.4 },
    });
  });

  it("keeps the declared media when only composition fields are passed", async () => {
    const { ctx } = await themeWithClip();
    await setBackground(ctx, {
      mode: "advanced",
      mediaAssetId: "clip",
      bounds: "display",
      anchor: "left",
      extent: 0.2,
    });

    await setBackground(ctx, { fade: 0.3 });

    const media = ctx.drafts.current().envelope.background?.media;
    expect(media?.assetId).toBe("clip");
    expect(media?.bounds).toBe("display");
    expect(media?.composition).toEqual({
      anchor: "left",
      extent: 0.2,
      fade: 0.3,
    });
  });

  it("removes the composition when the anchor is full", async () => {
    const { ctx } = await themeWithClip();
    await setBackground(ctx, {
      mode: "advanced",
      mediaAssetId: "clip",
      anchor: "center",
    });

    await setBackground(ctx, { anchor: "full" });

    expect(
      ctx.drafts.current().envelope.background?.media?.composition,
    ).toBeUndefined();
  });

  it("refuses a fade outside the model range", async () => {
    const { ctx } = await themeWithClip();
    await setBackground(ctx, {
      mode: "advanced",
      mediaAssetId: "clip",
      anchor: "left",
    });
    const before = structuredClone(ctx.drafts.current().envelope.background);

    const result = await setBackground(ctx, { fade: 0 });

    expect(result.isError).toBe(true);
    expect(refusalTextOf(result)).toMatch(/fade/i);
    expect(ctx.drafts.current().envelope.background).toEqual(before);
  });

  it("refuses an extent that names no edge", async () => {
    const { ctx } = await themeWithClip();

    const result = await setBackground(ctx, {
      mode: "advanced",
      mediaAssetId: "clip",
      anchor: "center",
      extent: 0.5,
    });

    expect(result.isError).toBe(true);
    expect(refusalTextOf(result)).toMatch(/edge/i);
    expect(ctx.drafts.current().envelope.background?.media).toBeUndefined();
  });

  it("refuses a composition on a background with no media", async () => {
    const { ctx } = await themeWithClip();

    const result = await setBackground(ctx, {
      mode: "advanced",
      anchor: "left",
    });

    expect(result.isError).toBe(true);
    expect(refusalTextOf(result)).toMatch(/media/i);
  });
});

describe("set_background modes", () => {
  it("refuses composition fields until the theme opts into advanced", async () => {
    const { ctx } = await themeWithClip();
    await setBackground(ctx, { color: "accent", mediaAssetId: "clip" });

    for (const input of [{ anchor: "left" as const }, { fade: 0.2 }]) {
      const result = await setBackground(ctx, input);
      expect(result.isError).toBe(true);
      expect(refusalTextOf(result)).toMatch(/advanced/i);
    }
  });

  it("drops the composition keys when the theme returns to simple", async () => {
    const { ctx } = await themeWithClip();
    await setBackground(ctx, {
      mode: "advanced",
      mediaAssetId: "clip",
      anchor: "left",
      extent: 0.2,
      fade: 0.2,
    });

    const result = await setBackground(ctx, { mode: "simple" });
    expect(result.isError).toBeUndefined();

    const background = ctx.drafts.current().envelope.background;
    expect(background?.mode).toBeUndefined();
    expect(background?.media?.composition).toBeUndefined();
  });
});
