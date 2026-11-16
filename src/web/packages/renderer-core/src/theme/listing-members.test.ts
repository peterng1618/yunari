import { describe, expect, it } from "vitest";
import { listingMemberRecords } from "./listing-members.js";

/** The refusal channel: an empty list alone cannot say whether the listing
    carries none or the input was unreadable. */
describe("listingMemberRecords", () => {
  it("reads a widget pack's units and a preset pack's presets", () => {
    const units = [
      { id: "clock", label: "Clock" },
      { id: "gauge", label: "Gauge" },
    ];

    const read = listingMemberRecords("widget-pack", { named: units });

    expect([...read]).toStrictEqual([
      { id: "clock", kind: "widget", name: "Clock" },
      { id: "gauge", kind: "widget", name: "Gauge" },
    ]);
    expect(read.unreadable).toBe(false);
    expect(
      [...listingMemberRecords("path-preset-pack", { named: units })].map(
        (member) => member.kind,
      ),
    ).toStrictEqual(["shape", "shape"]);
  });

  it("refuses named input that is not a list instead of yielding none", () => {
    for (const named of [undefined, null, "clock", { id: "clock" }]) {
      const read = listingMemberRecords("widget-pack", { named });
      expect([...read], String(named)).toStrictEqual([]);
      expect(read.unreadable, String(named)).toBe(true);
    }
  });

  it("refuses a named entry without a usable id rather than dropping it", () => {
    const read = listingMemberRecords("widget-pack", {
      named: [{ id: "clock", label: "Clock" }, { label: "No id" }],
    });

    expect([...read]).toStrictEqual([]);
    expect(read.unreadable).toBe(true);
  });

  it("marks a theme or editor theme with no readable document unreadable", () => {
    expect(listingMemberRecords("dashboard-theme", {}).unreadable).toBe(true);
    expect(
      listingMemberRecords("editor-theme", { editorThemeName: "  " })
        .unreadable,
    ).toBe(true);
  });

  it("answers no members for a kind that carries none, without refusing it", () => {
    const collection = listingMemberRecords("collection", {});
    expect([...collection]).toStrictEqual([]);
    expect(collection.unreadable).toBe(false);

    const unknown = listingMemberRecords("sprite-pack", {});
    expect([...unknown]).toStrictEqual([]);
    expect(unknown.unreadable).toBe(false);

    // A plugin with no browseable contributions carries no members.
    const plugin = listingMemberRecords("plugin", {});
    expect([...plugin]).toStrictEqual([]);
    expect(plugin.unreadable).toBe(false);
  });
});
