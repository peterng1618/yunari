import { describe, expect, it } from "vitest";
import { uiCopy } from "../ui-copy.js";
import { LIBRARY_GROUPS, LIBRARY_PAGES } from "./nav.js";

/**
 * The Library's destinations are one list, read by the navigation column and by
 * the panel that draws the chosen page. A page added without a word or a glyph
 * fails here rather than drawing a nameless row.
 */
describe("the Library navigation", () => {
  it("lists the eight browse destinations and My submissions in order", () => {
    expect(LIBRARY_PAGES.map((page) => page.id)).toEqual([
      "dashboard-themes",
      "app-themes",
      "widgets",
      "shapes",
      "sensor-providers",
      "asset-sources",
      "panel-drivers",
      "collections",
      "submissions",
    ]);
  });

  it("groups the destinations as Browse and Publish", () => {
    expect(LIBRARY_GROUPS.map((group) => group.id)).toEqual([
      "browse",
      "publish",
    ]);
    expect(
      LIBRARY_PAGES.filter((page) => page.group === "browse").map(
        (page) => page.id,
      ),
    ).toEqual([
      "dashboard-themes",
      "app-themes",
      "widgets",
      "shapes",
      "sensor-providers",
      "asset-sources",
      "panel-drivers",
      "collections",
    ]);
    expect(
      LIBRARY_PAGES.filter((page) => page.group === "publish").map(
        (page) => page.id,
      ),
    ).toEqual(["submissions"]);
  });

  it("gives every page a label from uiCopy", () => {
    expect(LIBRARY_PAGES.map((page) => page.label)).toEqual([
      uiCopy.library.pages.dashboardThemes,
      uiCopy.library.pages.appThemes,
      uiCopy.library.pages.widgets,
      uiCopy.library.pages.shapes,
      uiCopy.library.pages.sensorProviders,
      uiCopy.library.pages.assetSources,
      uiCopy.library.pages.panelDrivers,
      uiCopy.library.pages.collections,
      uiCopy.library.pages.submissions,
    ]);
    expect(LIBRARY_GROUPS.map((group) => group.label)).toEqual([
      uiCopy.library.groups.browse,
      uiCopy.library.groups.publish,
    ]);
  });

  it("gives every page a mark", () => {
    for (const page of LIBRARY_PAGES) {
      expect(page.glyph, `${page.id} has no glyph`).toBeDefined();
    }
  });
});
