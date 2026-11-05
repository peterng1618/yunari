import type { Background } from "@yunari/renderer-core";
import { describe, expect, it, vi } from "vitest";
import { createBackgroundFunnel } from "./background-edits.js";

const background: Background = { media: { assetId: "a", bounds: "theme" } };

function funnelWith(
  overrides: {
    readonly onBackgroundAssetSelect?: (assetId: string | undefined) => void;
    readonly onBackgroundModeChange?: (mode: string) => void;
  } = {},
) {
  const onBackgroundChange = vi.fn();
  const funnel = createBackgroundFunnel({
    backgroundSelected: () => true,
    background: () => background,
    onBackgroundChange,
    ...overrides,
  });
  return { funnel, onBackgroundChange };
}

describe("the background commit funnel", () => {
  it("routes the media field to the one switch seam", () => {
    const onBackgroundAssetSelect = vi.fn();
    const { funnel, onBackgroundChange } = funnelWith({
      onBackgroundAssetSelect,
    });

    expect(funnel.commit(funnel.beginDescribe(), "background.media", "b")).toBe(
      "ok",
    );
    expect(onBackgroundAssetSelect).toHaveBeenCalledWith("b");
    expect(onBackgroundChange).not.toHaveBeenCalled();

    expect(funnel.commit(funnel.revision, "background.media", "")).toBe("ok");
    expect(onBackgroundAssetSelect).toHaveBeenLastCalledWith(undefined);
  });

  it("routes the mode field to the document's mode seam", () => {
    const onBackgroundModeChange = vi.fn();
    const { funnel, onBackgroundChange } = funnelWith({
      onBackgroundModeChange,
    });

    expect(
      funnel.commit(funnel.beginDescribe(), "background.mode", "advanced"),
    ).toBe("ok");
    expect(onBackgroundModeChange).toHaveBeenCalledWith("advanced");
    expect(onBackgroundChange).not.toHaveBeenCalled();
  });

  it("refuses a seam the mounted build does not have", () => {
    const { funnel } = funnelWith();

    expect(funnel.commit(funnel.beginDescribe(), "background.media", "b")).toBe(
      "invalid",
    );
    expect(funnel.commit(funnel.revision, "background.mode", "advanced")).toBe(
      "invalid",
    );
  });
});
