// @vitest-environment jsdom
import type { FabricGlobals, TextRun } from "@yunari/renderer-core";
import {
  formatInstant,
  instantIn,
  SEMANTIC_KEYS,
  type SemanticKeyDescriptor,
} from "@yunari/renderer-core";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { uiCopy } from "../ui-copy.js";
import {
  blur,
  choose,
  click,
  mountRunEditor,
  optionsOf,
  pressedLabel,
  segment,
  sourceLabel,
  typeInto,
  valueText,
} from "./runs.test-stage.js";

/**
 * What each run control writes.
 *
 * The editor is React now ([ADR-0039]), so these drive the real controls — a
 * select's trigger, a segmented option, a field's blur — through the same write
 * functions `index.ts`'s port calls. The two cases that need the editor to keep
 * its own state across a re-publish live in `runs.dom.test.tsx`.
 */

const literalClock: readonly TextRun[] = [
  {
    kind: "literal",
    text: "07:24",
    typeToken: "typeTokens.70-300",
    style: { color: { ref: "palette.text" } },
  },
];

const TRACKING_GLOBALS = {
  typeTokens: {
    tracked: {
      name: "Tracked",
      value: { family: "Inter", size: 32, letterSpacing: 4 },
    },
    plain: {
      name: "Plain",
      value: { family: "Inter", size: 32 },
    },
  },
} as unknown as FabricGlobals;

describe("binding a text run to a sensor", () => {
  it("turns a literal run into a reading, keeping how it looks", async () => {
    const box = mountRunEditor({ runs: literalClock });

    await choose(
      box.host,
      'data-yunari-run-source="0"',
      sourceLabel("time.now"),
    );

    const [binding] = box.stored();
    expect(binding?.semanticKey).toBe("time.now");
    expect(box.runs()[0]).toMatchObject({
      kind: "value",
      bindingId: binding?.id,
      typeToken: "typeTokens.70-300",
      style: { color: { ref: "palette.text" } },
    });
    return box.dispose();
  });

  it("offers a format and a zone only for a key that is an instant", async () => {
    const box = mountRunEditor({ runs: literalClock });

    await choose(
      box.host,
      'data-yunari-run-source="0"',
      sourceLabel("cpu.load"),
    );
    expect(box.host.querySelector('[data-yunari-run-format="0"]')).toBeNull();
    expect(box.host.querySelector('[data-yunari-run-zone="0"]')).toBeNull();

    await choose(
      box.host,
      'data-yunari-run-source="0"',
      sourceLabel("time.now"),
    );
    expect(
      box.host.querySelector('[data-yunari-run-format="0"]'),
    ).not.toBeNull();
    expect(box.host.querySelector('[data-yunari-run-zone="0"]')).not.toBeNull();
    return box.dispose();
  });

  it("lets the author take the unit off a reading, as the reference theme does", async () => {
    // `cpu-card-value` in the reference is a value run on `cpu.load` with the
    // "%" as a styled literal beside it. Nothing here could author that: the
    // chart panel had this control and the run panel did not, so an author who
    // wanted it got the reading's unit AND their literal, and "45%%" on the
    // display's face.
    const box = mountRunEditor({ runs: literalClock });
    await choose(
      box.host,
      'data-yunari-run-source="0"',
      sourceLabel("cpu.load"),
    );

    // Default is no override: the run says nothing about units.
    expect(box.runs()[0]).not.toHaveProperty("unitDisplay");

    await choose(box.host, 'data-yunari-run-unit-display="0"', "None");
    // On the RUN, not the binding: a run's own unitDisplay wins, so writing the
    // binding would be shadowed by the very theme this control reproduces.
    expect(box.runs()[0]).toMatchObject({ kind: "value", unitDisplay: "none" });
    expect(box.stored()[0]?.unitDisplay).toBeUndefined();

    // Clearing it is not the same as "none" — the default is the reading's own.
    await choose(box.host, 'data-yunari-run-unit-display="0"', "Default");
    expect(box.runs()[0]).not.toHaveProperty("unitDisplay");
    return box.dispose();
  });

  it("previews the tokens as they are typed, and stores what was typed", async () => {
    const box = mountRunEditor({ runs: literalClock });
    await choose(
      box.host,
      'data-yunari-run-source="0"',
      sourceLabel("time.now"),
    );

    const input = box.pick<HTMLInputElement>('[data-yunari-run-format="0"]');
    await typeInto(input, "[It is ]dddd");

    // The same instant the editor's own preview source reads, so the preview is
    // the reading the run will paint rather than an example of one.
    expect(box.pick('[data-yunari-run-format-preview="0"]').textContent).toBe(
      formatInstant(instantIn(Date.now()), "[It is ]dddd"),
    );

    await blur(input);
    expect(box.stored()[0]?.format).toBe("[It is ]dddd");
    return box.dispose();
  });

  it("falls back to the key's own default when the format is cleared", async () => {
    const box = mountRunEditor({ runs: literalClock });
    await choose(
      box.host,
      'data-yunari-run-source="0"',
      sourceLabel("time.now"),
    );

    const placeholder = box.pick<HTMLInputElement>(
      '[data-yunari-run-format="0"]',
    ).placeholder;
    expect(placeholder).toBe("HH:mm");

    await typeInto(
      box.pick<HTMLInputElement>('[data-yunari-run-format="0"]'),
      "dddd",
    );
    await blur(box.pick<HTMLInputElement>('[data-yunari-run-format="0"]'));
    expect(box.stored()[0]?.format).toBe("dddd");

    const cleared = box.pick<HTMLInputElement>('[data-yunari-run-format="0"]');
    await typeInto(cleared, "");
    expect(box.pick('[data-yunari-run-format-preview="0"]').textContent).toBe(
      formatInstant(instantIn(Date.now()), "HH:mm"),
    );

    await blur(cleared);
    expect(box.stored()[0]?.format).toBeUndefined();
    return box.dispose();
  });

  it("drops what described the reading the run no longer reads", async () => {
    const box = mountRunEditor({ runs: literalClock });
    await choose(
      box.host,
      'data-yunari-run-source="0"',
      sourceLabel("time.now"),
    );

    await typeInto(
      box.pick<HTMLInputElement>('[data-yunari-run-format="0"]'),
      "dddd",
    );
    await blur(box.pick<HTMLInputElement>('[data-yunari-run-format="0"]'));
    await choose(box.host, 'data-yunari-run-zone="0"', "Asia/Tokyo");

    await choose(
      box.host,
      'data-yunari-run-source="0"',
      sourceLabel("cpu.load"),
    );

    expect(box.stored()[0]?.semanticKey).toBe("cpu.load");
    expect(box.stored()[0]?.format).toBeUndefined();
    expect(box.stored()[0]?.timeZone).toBeUndefined();
    return box.dispose();
  });

  it("reads the clock in the zone the author pinned to it", async () => {
    // The preview reads Date.now() at render, so two reads straddle a minute
    // boundary about once in sixty runs. Pin the clock so the render and the
    // assertion share one instant; a single read cannot race itself (vg-383).
    const pinned = Date.parse("2026-10-13T04:24:30Z");
    vi.spyOn(Date, "now").mockReturnValue(pinned);
    const box = mountRunEditor({ runs: literalClock });
    await choose(
      box.host,
      'data-yunari-run-source="0"',
      sourceLabel("time.now"),
    );

    // Unpinned is the default: the display reads wherever its consumer is.
    expect(valueText(box.host, 'data-yunari-run-zone="0"')).toBe(
      "Follow the display",
    );

    await choose(box.host, 'data-yunari-run-zone="0"', "Asia/Tokyo");
    expect(box.stored()[0]?.timeZone).toBe("Asia/Tokyo");

    // The preview is the reading the run will paint, so pinning a zone has to
    // change what it says rather than only what is stored.
    expect(box.pick('[data-yunari-run-format-preview="0"]').textContent).toBe(
      formatInstant(instantIn(pinned), "HH:mm", "Asia/Tokyo"),
    );

    await choose(box.host, 'data-yunari-run-zone="0"', "Follow the display");
    expect(box.stored()[0]?.timeZone).toBeUndefined();
    return box.dispose();
  });

  it("previews a format in the document's own language", async () => {
    const box = mountRunEditor({
      runs: [{ kind: "value", bindingId: "clock-date" }],
      locale: "ja",
    });
    await choose(
      box.host,
      'data-yunari-run-source="0"',
      sourceLabel("date.today"),
    );

    await typeInto(
      box.pick<HTMLInputElement>('[data-yunari-run-format="0"]'),
      "dddd",
    );

    const preview = box.pick<HTMLElement>(
      '[data-yunari-run-format-preview="0"]',
    ).textContent;

    // The preview must read the language the paint will, or an author chooses a
    // format against words that never appear on the dashboard. The weekday varies
    // with the day the suite runs, so the week's shape is asserted rather than a
    // fixed string: `ja` and `en` for the same instant must differ, which a
    // preview ignoring the language cannot achieve. One instant, read once: a
    // midnight rollover between the assertions must not make them disagree.
    const instant = instantIn(Date.now());

    expect(preview).toBe(formatInstant(instant, "dddd", undefined, "ja"));
    expect(preview).not.toBe(formatInstant(instant, "dddd", undefined, "en"));

    return box.dispose();
  });

  it("writes alignment and overflow into the object's authored text", async () => {
    const box = mountRunEditor({ runs: literalClock });

    await segment(box.host, "data-yunari-text-align", "Centre");
    await segment(box.host, "data-yunari-text-overflow", "Ellipsis");

    // These are the object's layout, which the renderer already honours; they
    // persist in the same authored content the runs do.
    expect(box.content()["align"]).toBe("center");
    expect(box.content()["overflow"]).toBe("ellipsis");
    return box.dispose();
  });

  it("offers no Wrap control, because the Fabric class is the width mode", async () => {
    // A `Textbox` wraps and an `IText` does not; a control that wrote a flag
    // changed no pixel until a reload, so the control is gone rather than
    // disabled.
    const box = mountRunEditor({ runs: literalClock });

    expect(box.host.querySelector("[data-yunari-text-wrap]")).toBeNull();
    expect(box.host.querySelector("[data-yunari-text-align]")).not.toBeNull();
    return box.dispose();
  });

  it("hides overflow and vertical alignment on a text, which has no box", async () => {
    // A point text has no authored height to clip or place inside, so both
    // controls would accept an edit the renderer never reads.
    const box = mountRunEditor({ runs: literalClock, kind: "text" });

    expect(box.host.querySelector("[data-yunari-text-align]")).not.toBeNull();
    expect(box.host.querySelector("[data-yunari-runs]")).not.toBeNull();
    expect(box.host.querySelector("[data-yunari-run-add]")).not.toBeNull();
    expect(
      box.host.querySelector("[data-yunari-text-vertical-align]"),
    ).toBeNull();
    expect(box.host.querySelector("[data-yunari-text-overflow]")).toBeNull();
    return box.dispose();
  });

  it("keeps overflow and vertical alignment on a text box", async () => {
    // The other class, so the case above cannot pass by hiding the controls
    // from everything.
    const box = mountRunEditor({ runs: literalClock, kind: "textbox" });

    expect(
      box.host.querySelector("[data-yunari-text-vertical-align]"),
    ).not.toBeNull();
    expect(
      box.host.querySelector("[data-yunari-text-overflow]"),
    ).not.toBeNull();
    return box.dispose();
  });

  it("writes vertical alignment into the object's authored text", async () => {
    const box = mountRunEditor({ runs: literalClock });

    // A text box the renderer already places from (`placeInBox`) but nothing in
    // the editor could reach: the Starter ships `verticalAlign` hardcoded, so a
    // shipped theme could carry one and an author could not set one. Horizontal
    // alignment has had a control all along; this is its other axis.
    expect(box.content()["verticalAlign"]).toBeUndefined();

    await segment(box.host, "data-yunari-text-vertical-align", "Middle");

    expect(box.content()["verticalAlign"]).toBe("middle");
    return box.dispose();
  });

  it("shows vertical alignment again from what was stored", async () => {
    const box = mountRunEditor({ runs: literalClock });
    await segment(box.host, "data-yunari-text-vertical-align", "Bottom");

    expect(pressedLabel(box.host, "data-yunari-text-vertical-align")).toBe(
      "Bottom",
    );
    return box.dispose();
  });

  it("reads an unset vertical alignment as top, which is what the renderer assumes", async () => {
    const box = mountRunEditor({ runs: literalClock });

    // `fabric-text.ts` defaults an absent `verticalAlign` to `top`, so a control
    // that showed anything else would offer the author a lie about the current
    // state before they had touched it.
    expect(pressedLabel(box.host, "data-yunari-text-vertical-align")).toBe(
      "Top",
    );
    return box.dispose();
  });

  it("does not offer a text object's own alignment under arrange's vocabulary", async () => {
    const box = mountRunEditor({ runs: literalClock });

    // Two concepts, one word. `align-top` and `align-bottom` are canvas actions
    // that move selected objects; this control moves text inside its box. A
    // shared dataset prefix would make the two indistinguishable to a test, a
    // screenshot and a screen reader alike, so the names have to stay apart.
    expect(
      box.host.querySelector("[data-yunari-text-vertical-align]"),
    ).not.toBe(null);
    for (const arrangeKey of [
      "align-left",
      "align-center-x",
      "align-right",
      "align-top",
      "align-center-y",
      "align-bottom",
    ]) {
      expect(
        box.host.querySelector(`[data-yunari-arrange="${arrangeKey}"]`),
        arrangeKey,
      ).toBeNull();
    }
    return box.dispose();
  });

  it("shows alignment and overflow again from what was stored", async () => {
    const box = mountRunEditor({ runs: literalClock });
    await segment(box.host, "data-yunari-text-align", "Right");

    // Reopening rebuilds the control from the persisted content, so a re-read
    // must show the stored choice rather than a default.
    expect(pressedLabel(box.host, "data-yunari-text-align")).toBe("Right");
    return box.dispose();
  });

  it("returns a run to prose, releasing the binding it named", async () => {
    const box = mountRunEditor({ runs: literalClock });
    await choose(
      box.host,
      'data-yunari-run-source="0"',
      sourceLabel("time.now"),
    );

    await choose(box.host, 'data-yunari-run-source="0"', "Static text");

    expect(box.stored()).toEqual([]);
    expect(box.runs()[0]).toMatchObject({
      kind: "literal",
      typeToken: "typeTokens.70-300",
    });
    return box.dispose();
  });
});

describe("what a run cannot carry", () => {
  const mixedRuns: readonly TextRun[] = [
    { kind: "literal", text: "CPU ", typeToken: "typeTokens.plain" },
    { kind: "literal", text: "42%", typeToken: "typeTokens.tracked" },
  ];

  it("says a second run's tracking is not shown separately", async () => {
    // The defect this covers is a control that does nothing: the author picks a
    // tracked preset for the value run, and the object keeps the first run's
    // tracking with nothing on screen to say so.
    const box = mountRunEditor({ runs: mixedRuns, globals: TRACKING_GLOBALS });

    expect(box.notes()).toHaveLength(1);
    expect(box.notes()[0]).toContain("typeTokens.tracked");
    expect(box.notes()[0]).toContain("one tracking value");
    return box.dispose();
  });

  it("says nothing when only the first run tracks", async () => {
    // The counter-case: a single-run object carries its preset's tracking, so a
    // note here would train the author to ignore the ones that matter.
    const box = mountRunEditor({
      runs: [
        { kind: "literal", text: "YUNARI", typeToken: "typeTokens.tracked" },
      ],
      globals: TRACKING_GLOBALS,
    });

    expect(box.notes()).toEqual([]);
    return box.dispose();
  });

  it("says nothing when a later run tracks the same as the first", async () => {
    // The panel has to match the model, which reports on *inequality*. A second
    // run asking for the value the object already carries loses nothing, and
    // warning about it would teach the author to ignore the note.
    const same = {
      typeTokens: {
        tracked: {
          name: "Tracked",
          value: { family: "Inter", size: 32, letterSpacing: 4 },
        },
      },
    } as unknown as FabricGlobals;
    const box = mountRunEditor({
      runs: [
        { kind: "literal", text: "CPU ", typeToken: "typeTokens.tracked" },
        { kind: "literal", text: "42%", typeToken: "typeTokens.tracked" },
      ],
      globals: same,
    });

    expect(box.notes()).toEqual([]);
    return box.dispose();
  });

  it("still reports when the first run is untracked and a later one tracks", async () => {
    // The object takes the first run's value, which here is none, so a later
    // run asking for tracking is a gap like any other. Distinct from the first
    // case above only in what the object ends up painting, and the note is the
    // same one.
    const box = mountRunEditor({ runs: mixedRuns, globals: TRACKING_GLOBALS });

    expect(box.notes()).toHaveLength(1);
    expect(box.notes()[0]).toContain("typeTokens.tracked");
    return box.dispose();
  });

  it("reports a mismatching preset once however many runs share it", async () => {
    // The round that removed a duplicate in scene-fabric added one here, so the
    // three-run shape is now covered once, in the place that renders it.
    const box = mountRunEditor({
      runs: [
        { kind: "literal", text: "CPU ", typeToken: "typeTokens.plain" },
        { kind: "literal", text: "48", typeToken: "typeTokens.tracked" },
        { kind: "literal", text: " %", typeToken: "typeTokens.tracked" },
      ],
      globals: TRACKING_GLOBALS,
    });

    // Two runs name the same mismatching preset, so one note says it once.
    expect(box.notes()).toHaveLength(1);
    return box.dispose();
  });

  it("says nothing when no run tracks", async () => {
    const box = mountRunEditor({
      runs: [
        { kind: "literal", text: "CPU ", typeToken: "typeTokens.plain" },
        { kind: "literal", text: "42%", typeToken: "typeTokens.plain" },
      ],
      globals: TRACKING_GLOBALS,
    });

    expect(box.notes()).toEqual([]);
    return box.dispose();
  });
});

describe("how many runs a text object has", () => {
  const globals = {
    typeTokens: {
      "60-600": { name: "Reading", value: { family: "Inter", size: 60 } },
      "20-400": { name: "Unit", value: { family: "Inter", size: 20 } },
    },
    palette: {
      text: { name: "Text", value: { kind: "solid", color: "#fff" } },
    },
  } as unknown as FabricGlobals;

  const readingAndUnit: readonly TextRun[] = [
    { kind: "value", bindingId: "load", typeToken: "typeTokens.60-600" },
    { kind: "literal", text: "%", typeToken: "typeTokens.20-400" },
  ];

  it("appends a run that looks the way the one before it does", async () => {
    // "32" and "%" are one card, not two objects: the number is a reading and
    // the sign is prose, and only a second run on the same object can say so.
    const box = mountRunEditor({ runs: literalClock, globals });

    await box.pick<HTMLButtonElement>("[data-yunari-run-add]").click();

    expect(box.runs()).toHaveLength(2);
    expect(box.runs()[1]).toMatchObject({
      kind: "literal",
      text: "",
      typeToken: "typeTokens.70-300",
    });
    return box.dispose();
  });

  it("carries the text a prose run says, and offers none for a reading", async () => {
    const box = mountRunEditor({
      runs: readingAndUnit,
      globals,
      arrived: ["cpu.load"],
      declared: [{ id: "load", semanticKey: "cpu.load" }],
    });

    // A value run has no words of its own, so a field over one would accept an
    // edit and persist nothing.
    expect(box.host.querySelector('[data-yunari-run-text="0"]')).toBeNull();
    // The second run is behind its tab now; pick it before reading a field.
    await click(box.pick<HTMLElement>('[data-yunari-run-tab="2"]'));
    const field = box.pick<HTMLInputElement>('[data-yunari-run-text="1"]');
    expect(field.value).toBe("%");
    await typeInto(field, " %");
    await blur(field);

    expect(box.runs()[1]).toMatchObject({ kind: "literal", text: " %" });
    return box.dispose();
  });

  it("removes a run, and the reading only it was bound to", async () => {
    const box = mountRunEditor({
      runs: readingAndUnit,
      globals,
      arrived: ["cpu.load"],
      declared: [{ id: "load", semanticKey: "cpu.load" }],
    });

    await box.pick<HTMLButtonElement>('[data-yunari-run-remove="0"]').click();

    expect(box.runs()).toHaveLength(1);
    // Nothing else can be reading it, and a binding no run can paint is one
    // the document declares and no reader resolves.
    expect(box.stored()).toEqual([]);
    return box.dispose();
  });

  it("will not offer to remove the last run", async () => {
    // A text object with no runs paints nothing at all, so the control that
    // could reach that state is the control that empties the canvas.
    const box = mountRunEditor({ runs: literalClock, globals });
    expect(box.host.querySelector("[data-yunari-run-remove]")).toBeNull();
    return box.dispose();
  });

  it("numbers the remove action for the run it removes", async () => {
    const box = mountRunEditor({
      runs: [
        ...readingAndUnit,
        { kind: "literal", text: " of 4", typeToken: "typeTokens.20-400" },
      ],
      globals,
      arrived: ["cpu.load"],
      declared: [{ id: "load", semanticKey: "cpu.load" }],
    });

    const visible = (): readonly HTMLElement[] => [
      ...box.host.querySelectorAll<HTMLElement>("[data-yunari-run-remove]"),
    ];
    // One panel at a time, so one remove action — and its number is the run's
    // own position, not a constant "run 1".
    expect(visible()).toHaveLength(1);
    expect(visible()[0]?.textContent).toBe("Remove run 1");

    await click(box.pick<HTMLElement>('[data-yunari-run-tab="3"]'));
    expect(visible()).toHaveLength(1);
    expect(visible()[0]?.textContent).toBe("Remove run 3");
    return box.dispose();
  });
});

describe("which type preset a run is set in", () => {
  const globals = {
    typeTokens: {
      "24-400": { family: "Inter", weight: 400 },
      "46-600": { family: "Inter", weight: 600 },
      mono: { family: "Fira Code" },
    },
    palette: {
      text: { name: "Text", value: { kind: "solid", color: "#fff" } },
    },
  } as unknown as FabricGlobals;

  it("lists each token under the name the token inspector shows", async () => {
    // Two dropdowns, thirteen presets, one document — and the run editor printed
    // the ids (`24-400`) where every other reference picker in the editor prints
    // the token's own name (`Inter 400`). A role token carries its role in that
    // name, which is why `mono` here reads `[Mono] Fira Code` and sorts first.
    const box = mountRunEditor({
      runs: [{ kind: "literal", text: "Hi", typeToken: "typeTokens.24-400" }],
      globals,
    });

    expect(await optionsOf(box.host, 'data-yunari-run-preset="0"')).toEqual([
      "[Mono] Fira Code",
      "Inter 400",
      "Inter 600",
    ]);
    return box.dispose();
  });

  it("stores the reference, not the name it shows", async () => {
    const box = mountRunEditor({
      runs: [{ kind: "literal", text: "Hi", typeToken: "typeTokens.24-400" }],
      globals,
    });

    await choose(box.host, 'data-yunari-run-preset="0"', "Inter 600");

    // The label is display; the value is what persists. Changing the first must
    // not change the second.
    expect(box.runs()[0]?.typeToken).toBe("typeTokens.46-600");
    return box.dispose();
  });

  it("shows the preset the run is actually set in", async () => {
    const box = mountRunEditor({
      runs: [{ kind: "literal", text: "Hi", typeToken: "typeTokens.46-600" }],
      globals,
    });

    // The control was never mis-bound — it holds the stored reference, which is
    // what the run carries. What an author could not do was read the option it
    // had landed on and match it against the list beside it.
    expect(valueText(box.host, 'data-yunari-run-preset="0"')).toBe("Inter 600");
    return box.dispose();
  });
});

describe("the token list's roles and action rows", () => {
  const trio = {
    typeTokens: {
      mono: { family: "Fira Code" },
      "24-400": { family: "Inter", weight: 400 },
      heading: { family: "Manrope", weight: 600 },
      "20-300": { family: "IBM Plex Sans", weight: 300 },
      body: { family: "Inter", weight: 400 },
    },
  } as unknown as FabricGlobals;

  const onHeading: readonly TextRun[] = [
    { kind: "literal", text: "Hi", typeToken: "typeTokens.heading" },
  ];

  it("offers the roles first, then the unroled tokens, then the two actions", async () => {
    const box = mountRunEditor({
      runs: onHeading,
      globals: trio,
      openFontFinder: () => {},
      importLocalFont: () => {},
    });

    expect(await optionsOf(box.host, 'data-yunari-run-preset="0"')).toEqual([
      "[Heading] Manrope 600",
      "[Body] Inter 400",
      "[Mono] Fira Code",
      "IBM Plex Sans 300",
      "Inter 400",
      uiCopy.panels.importLocalFont,
      uiCopy.panels.fontFinder,
    ]);
    return box.dispose();
  });

  it("rewrites only the run's token, leaving the token records alone", async () => {
    const before = JSON.stringify(trio);
    const box = mountRunEditor({ runs: onHeading, globals: trio });

    await choose(box.host, 'data-yunari-run-preset="0"', "IBM Plex Sans 300");

    // The reference is the run's own; the token table it names is not edited.
    expect(box.runs()[0]?.typeToken).toBe("typeTokens.20-300");
    expect(box.runs()[0]).toMatchObject({ kind: "literal", text: "Hi" });
    expect(JSON.stringify(trio)).toBe(before);
    return box.dispose();
  });

  it("opens the finder once and changes no token", async () => {
    const openFontFinder = vi.fn();
    const box = mountRunEditor({
      runs: onHeading,
      globals: trio,
      openFontFinder,
    });

    await choose(
      box.host,
      'data-yunari-run-preset="0"',
      uiCopy.panels.fontFinder,
    );

    expect(openFontFinder).toHaveBeenCalledTimes(1);
    expect(box.runs()[0]?.typeToken).toBe("typeTokens.heading");
    return box.dispose();
  });

  it("points the run at the token an import reports", async () => {
    let imported: ((tokenId: string) => void) | undefined;
    const box = mountRunEditor({
      runs: onHeading,
      globals: trio,
      importLocalFont: (onImported) => {
        imported = onImported;
      },
    });

    await choose(
      box.host,
      'data-yunari-run-preset="0"',
      uiCopy.panels.importLocalFont,
    );
    // Choosing the row asks for the import; it does not move the run itself.
    expect(box.runs()[0]?.typeToken).toBe("typeTokens.heading");

    await act(async () => {
      imported?.("20-300");
    });
    expect(box.runs()[0]?.typeToken).toBe("typeTokens.20-300");
    return box.dispose();
  });

  it("leaves the run alone when the import reports no token", async () => {
    const box = mountRunEditor({
      runs: onHeading,
      globals: trio,
      // The commit that answers with no token — a cancelled import — calls
      // nothing, so the run keeps the reference it had.
      importLocalFont: () => {},
    });

    await choose(
      box.host,
      'data-yunari-run-preset="0"',
      uiCopy.panels.importLocalFont,
    );

    expect(box.runs()[0]?.typeToken).toBe("typeTokens.heading");
    return box.dispose();
  });
});

describe("which palette token a run's colour is set in", () => {
  const globals = {
    palette: {
      ink: { name: "Ink", value: { kind: "solid", color: "#e8ecf3" } },
      bars: { name: "Letterbox bars", value: { kind: "solid", color: "#000" } },
      none: { name: "None", value: { kind: "solid", color: "#fff" } },
    },
  } as unknown as FabricGlobals;

  const inBars: readonly TextRun[] = [
    { kind: "literal", text: "42", style: { color: { ref: "palette.bars" } } },
  ];

  it("lists each token under the name its own owner gives it", async () => {
    // The preset dropdown above this one was fixed for exactly this reason, and
    // the colour dropdown beside it still printed the token's id: the author read
    // `bars` here and `Letterbox bars` in the palette panel, a field apart.
    const box = mountRunEditor({ runs: inBars, globals });

    expect(await optionsOf(box.host, 'data-yunari-run-colour="0"')).toEqual([
      "Ink",
      "Letterbox bars",
    ]);
    return box.dispose();
  });

  it("stores the reference, not the name it shows", async () => {
    const box = mountRunEditor({ runs: inBars, globals });

    await choose(box.host, 'data-yunari-run-colour="0"', "Ink");

    // What persists is the stored reference; what the author reads is the label.
    // Changing the first to make the second prettier would break every theme.
    expect(box.runs()[0]?.style?.["color"]).toEqual({ ref: "palette.ink" });
    return box.dispose();
  });

  it("shows the token the run is actually set in", async () => {
    const box = mountRunEditor({ runs: inBars, globals });

    expect(valueText(box.host, 'data-yunari-run-colour="0"')).toBe(
      "Letterbox bars",
    );
    return box.dispose();
  });
});

describe("which binding a value run carries", () => {
  const bound: readonly TextRun[] = [
    { kind: "value", bindingId: "load", typeToken: "typeTokens.60-600" },
  ];

  it("names the key, and says nothing is missing, when a reading has arrived", async () => {
    const box = mountRunEditor({
      runs: bound,
      arrived: ["ram.used.percent"],
      declared: [{ id: "load", semanticKey: "ram.used.percent" }],
    });

    // The canvas paints the reading, so the key is only visible here.
    expect(box.binding().text).toContain("ram.used.percent");
    expect(box.binding().problem).toBeUndefined();
    return box.dispose();
  });

  it("marks a declared binding with no reading, which needs a sensor not an edit", async () => {
    const box = mountRunEditor({
      runs: bound,
      declared: [{ id: "load", semanticKey: "ram.used.percent" }],
    });

    expect(box.binding().problem).toBe("unmapped");
    return box.dispose();
  });

  it("marks a run that names a binding this object never declared", async () => {
    const box = mountRunEditor({
      runs: [{ kind: "value", bindingId: "ghost" }],
    });

    expect(box.binding().problem).toBe("undeclared");
    return box.dispose();
  });

  it("puts the binding on the note, and the row's ordinal on the row", async () => {
    // The note's `data-yunari-run-binding` is the binding the run names — the
    // key `run.bindingId` carried before the column was React, and what
    // `reference-theme.spec.ts` reads in its undeclared case. The ordinal is the
    // row's own `data-yunari-run`, so the two cannot be confused once a run
    // that is not the first carries a binding.
    const box = mountRunEditor({
      runs: [
        {
          kind: "literal",
          text: "Free space",
          typeToken: "typeTokens.60-600",
        },
        { kind: "value", bindingId: "disk.free" },
      ],
    });
    await click(box.pick<HTMLElement>('[data-yunari-run-tab="2"]'));

    const note = box.pick<HTMLElement>("[data-yunari-run-binding]");
    expect(note.getAttribute("data-yunari-run-binding")).toBe("disk.free");
    expect(
      note.closest("[data-yunari-run]")?.getAttribute("data-yunari-run"),
    ).toBe("1");
    return box.dispose();
  });
});

describe("which format tokens a clock can be given", () => {
  it("names the vocabulary beside the field", async () => {
    // The formatter's rule is that an unrecognised token renders literally "so
    // a typo is visible" — which makes it visible on a display, where the
    // author is not. Drawn during the rebuild: a date authored as
    // `EEE, MMM d, yyyy` painted exactly that, because the vocabulary is
    // `ddd`, `D` and `YYYY`.
    const box = mountRunEditor({ runs: literalClock });
    await choose(
      box.host,
      'data-yunari-run-source="0"',
      sourceLabel("date.today"),
    );

    const hint = box.pick('[data-yunari-run-format-hint="0"]').textContent;
    for (const token of ["YYYY", "MMM", "ddd", "DD", "HH", "mm", "A"])
      expect(hint).toContain(token);
    return box.dispose();
  });
});

describe("which readings a run may name", () => {
  const fan: SemanticKeyDescriptor = {
    key: "custom.fan",
    family: "cpu",
    label: "Fan speed",
    expectedTier: "extended",
  };

  it("groups the built-ins by family and puts a discovered key in its family", () => {
    // The catalogue is the host's answer rather than a second table, so a key a
    // provider reports sits under the same heading as the built-ins it belongs
    // with instead of at the end of one flat list.
    const box = mountRunEditor({
      runs: literalClock,
      descriptors: () => [...SEMANTIC_KEYS, fan],
    });
    const sources = box.sources();

    expect(sources.find((source) => source.id === "cpu.load")?.group).toBe(
      "cpu",
    );
    expect(sources.find((source) => source.id === "custom.fan")).toEqual({
      id: "custom.fan",
      name: "Fan speed",
      group: "cpu",
    });
    const cpu = sources
      .map((source, index) => ({ ...source, index }))
      .filter((source) => source.group === "cpu");
    const at = cpu.findIndex((source) => source.id === "custom.fan");
    expect(at).toBeGreaterThan(0);
    expect(cpu[at]?.index).toBe((cpu[at - 1]?.index ?? -2) + 1);
    return box.dispose();
  });

  it("keeps a saved key the catalogue no longer lists, still selected", () => {
    // A theme may name a key this host stopped reporting. Dropping it from the
    // options would show the run as reading nothing and leave no way back to
    // the key the document holds.
    const box = mountRunEditor({
      runs: [{ kind: "value", bindingId: "saved" }],
      declared: [{ id: "saved", semanticKey: "retired.key" }],
      descriptors: () => [fan],
    });

    expect(box.sources()).toContainEqual({
      id: "retired.key",
      name: "retired.key",
    });
    expect(valueText(box.host, 'data-yunari-run-source="0"')).toBe(
      "retired.key",
    );
    return box.dispose();
  });
});

/**
 * How each control here is named.
 *
 * The run editor's labels wrap their control, which the platform reads as an
 * association — but only while the label wraps nothing else. `formatField` puts
 * the live preview and the token vocabulary inside the label, so the browser
 * read its control as
 *
 *   "Format 04:38 Tokens: YYYY YY · MMMM … Words in [square brackets]."
 *
 * which is the whole hint and a ticking clock read as the field's name. The id
 * is what makes the association explicit, and an explicit association is what
 * stops a sibling appended inside the label later from reaching the name.
 */
describe("how a run's controls are named", () => {
  it("gives every control an id its own label names", async () => {
    const box = mountRunEditor({ runs: literalClock, locale: "en-GB" });
    await choose(
      box.host,
      'data-yunari-run-source="0"',
      sourceLabel("date.today"),
    );

    const unnamed = [
      ...box.host.querySelectorAll<HTMLElement>('input, [role="combobox"]'),
    ]
      .filter((control) => control.id === "")
      .map(
        (control) =>
          control.dataset[Object.keys(control.dataset)[0] ?? ""] ??
          control.tagName,
      );

    expect(unnamed).toEqual([]);
    return box.dispose();
  });

  it("names the format field by its own words, not by its preview or its hint", async () => {
    // Measured on the live control in a browser's own accessibility tree:
    // `textbox "Format 04:38 Tokens: YYYY YY · MMMM MMM MM M · dddd ddd ·
    // DD D · HH H hh h · mm ss · A a. Words in [square brackets]."` The name
    // changed every minute, because the preview it swallowed was a clock.
    const box = mountRunEditor({ runs: literalClock, locale: "en-GB" });
    await choose(
      box.host,
      'data-yunari-run-source="0"',
      sourceLabel("date.today"),
    );

    const field = box.pick<HTMLInputElement>('[data-yunari-run-format="0"]');
    const label = box.host.querySelector<HTMLLabelElement>(
      `label[for="${field.id}"]`,
    );
    expect(label?.textContent).toBe("Format");
    return box.dispose();
  });
});
