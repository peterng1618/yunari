import { describe, expect, it } from "vitest";
import { panelBackgroundSource, panelGlassSampling } from "./panel-sampling.js";

/**
 * The host serves a hardware panel the same player page a browser display gets,
 * adding `panel=1` (`packages/host/src/panels/panel-page.ts`). This is the one
 * place that flag is read, so it is tested here rather than through the page.
 */
describe("the panel page's glass default", () => {
  it("samples the still on a page the host marked as a panel", () => {
    expect(panelGlassSampling("?display=turzx&panel=1")).toBe("static");
  });

  it("leaves a browser display on the live default", () => {
    expect(panelGlassSampling("?display=this-pc")).toBeUndefined();
    expect(panelGlassSampling("?panel=0")).toBeUndefined();
    expect(panelGlassSampling("")).toBeUndefined();
  });
});

describe("the panel page's background source", () => {
  const viewport = { width: 320, height: 320 } as const;

  it("stands a clip-playing panel on the host's poster frame", () => {
    expect(
      panelBackgroundSource("?panel=1&clip=1", "theme one", viewport),
    ).toEqual({
      url: "/api/themes/theme%20one/poster",
      kind: "image",
    });
  });

  it("asks for a clip scaled to a still panel's own pixels", () => {
    expect(
      panelBackgroundSource("?panel=1", "theme", { width: 464, height: 1920 }),
    ).toEqual({
      url: "/api/themes/theme/panel-video?width=464&height=1920",
      kind: "video",
    });
  });

  it("asks for the pixels the page's fit, pan and zoom will paint", () => {
    expect(
      panelBackgroundSource(
        "?panel=1",
        "theme",
        { width: 320, height: 320 },
        { offsetX: 0.25, offsetY: -0.5, scale: 2 },
      ),
    ).toEqual({
      url: "/api/themes/theme/panel-video?width=960&height=1280",
      kind: "video",
    });
  });

  it("clamps a viewport that is not a panel size", () => {
    expect(
      panelBackgroundSource("?panel=1", "theme", {
        width: 0,
        height: 10_000,
      })?.url,
    ).toBe("/api/themes/theme/panel-video?width=1&height=4096");
  });

  it("answers nothing for a browser display", () => {
    expect(panelBackgroundSource("?display=this-pc", "theme", viewport)).toBe(
      undefined,
    );
  });
});
