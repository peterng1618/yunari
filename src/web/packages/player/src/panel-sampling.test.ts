import { describe, expect, it } from "vitest";
import { panelGlassSampling } from "./panel-sampling.js";

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
