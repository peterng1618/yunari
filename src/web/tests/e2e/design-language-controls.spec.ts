import { expect, test } from "@playwright/test";
import {
  prepareControls,
  ROLES,
  SPACING_STEPS,
} from "./design-language-readers.js";
import { lengthInPx } from "./mockup-comparators.js";
import { PARITY } from "./mockup-parity.js";
import { drawingTexts, mockupDeclared, rowDrawing } from "./mockup-values.js";
import { isDesktopSurface } from "./surface.js";

/** Responsibility: §3 spacing, §4 roles and §5 control-row geometry, drawing columns and hit targets. */
test("the control set renders in the design language", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  test.setTimeout(180_000);
  await prepareControls(page);
});

test("control rows share one geometry (§5)", async ({ page }, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  test.setTimeout(180_000);
  const { geometry, edgeOf } = await prepareControls(page);
  // ── 0. One geometry for a field row ───────────────────────────────────────
  //
  // A field row is **one track**: a fixed label column, and a value cell every
  // control fills. That is what the control set's own drawing declares
  // (`current/controls.html` and its light twin, `current/controls-editorial.html`:
  // the label is `width:74px;flex:0 0 auto` and the value is `flex:1`), and the
  // product declared neither — a number well was as wide as its `<input>`, a
  // select filled the slot and a segmented group hugged its right edge, which is
  // four left edges in one section (`vg-297`). Read here, first, because every
  // section below measures a rendered state and a row that is not one track
  // hands them the wrong box.
  //
  // Three readings, because the defect had three owners and an assertion that
  // reads one of them would have passed twice: the boxes' shared edges (the
  // control set's own geometry), the label against its control's centre and an
  // input drawing a border inside its well (both `editor-shell.css`'s legacy
  // unlayered rules, `vg-298`, which reach only the product's own ancestors —
  // so the last two are what the fixture mounting `.editor-shell-inspector`
  // buys, and they pass without it on a page the product does not render).
  const text = edgeOf("text");
  for (const fixture of ["number", "select", "segmented"]) {
    expect(
      edgeOf(fixture),
      `${fixture}: its box does not share the text row's edges — measured ${JSON.stringify(geometry.edges)}`,
    ).toEqual(text);
  }
  expect(
    geometry.trackLeft,
    `the slider's track does not start on the boxes' left edge (${text.left}); measured ${JSON.stringify(geometry.trackLeft)}`,
  ).toBeCloseTo(text.left, 0);
  expect(
    geometry.wellRight,
    `the slider's well does not end on the boxes' right edge (${text.right}); measured ${JSON.stringify(geometry.wellRight)}`,
  ).toBeCloseTo(text.right, 0);
  for (const [fixture, offset] of Object.entries(geometry.labelOffsets)) {
    expect(offset, `${fixture}: the row is not mounted`).not.toBeNull();
    expect(
      Math.abs(offset ?? Number.NaN),
      `${fixture}: the label sits ${offset}px off its control's centre, and the row centres it`,
    ).toBeLessThanOrEqual(1);
  }
  expect(
    geometry.doubled,
    "a field draws a box of its own inside the well that already draws one",
  ).toEqual([]);
});

test("boxed and headed rows keep their drawing shapes (§5)", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  test.setTimeout(180_000);
  const { geometry } = await prepareControls(page);
  // The column is a *shape*, and these are the two rows a drawing shapes
  // differently. Read here rather than left to the capture, because a width and
  // a position are what the two drawings declare and what a screenshot cannot
  // assert: the boxed row's label fills its row, and the headed row's control
  // starts where the row starts with the heading above it.
  expect(
    geometry.boxedLabelWidth,
    `the boxed row's label is not mounted, so this is not a reading`,
  ).not.toBeNull();
  expect(
    geometry.boxedLabelWidth ?? 0,
    "the boxed row's label is still in the field row's 74px column, where the settings drawing fills the row with it",
  ).toBeGreaterThan(74);
  expect(
    geometry.headed.rowLeft,
    "the headed row is not mounted, so this is not a reading",
  ).not.toBeNull();
  expect(
    geometry.headed.cellLeft,
    `the headed row's control does not span the row: it starts at ${geometry.headed.cellLeft} and the row at ${geometry.headed.rowLeft}, so it is still inside the field row's column`,
  ).toBe(geometry.headed.rowLeft);
  expect(
    geometry.headed.labelBottom !== null &&
      geometry.headed.cellTop !== null &&
      geometry.headed.labelBottom <= geometry.headed.cellTop,
    `the headed row's label is not above its control: label bottom ${geometry.headed.labelBottom}, control top ${geometry.headed.cellTop}`,
  ).toBe(true);
});

test("paired wells share equal widths (§5)", async ({ page }, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  test.setTimeout(180_000);
  const { geometry } = await prepareControls(page);
  expect(
    geometry.pairWidths.length,
    "the pair row is not mounted with two wells, so this is not a reading",
  ).toBe(2);
  expect(
    geometry.pairWidths[0],
    `the pair's two wells are not equal: ${JSON.stringify(geometry.pairWidths)} — a pair is two flex:1 halves, and 4 against 4000 is what tells a shared width from a sized one`,
  ).toBe(geometry.pairWidths[1]);
});

test("both control drawings own the label column (§5)", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  test.setTimeout(180_000);
  await prepareControls(page);
  // ── 0b. The two control drawings are read, and the column is theirs ───────
  //
  // The drawings are the source, not this file: the row's geometry above is a
  // *relationship*, and the number a person reads is the label column the two
  // files declare. Read through `PARITY`'s `fixture` rows so both drawings are
  // read by something rather than by nothing, and so a drawing that moved under
  // this task's own change reddens here rather than in a later plan's.
  const drawings = PARITY.filter((row) => row.surface === "fixture");
  expect(
    drawings.length,
    "no parity row names the control-set fixture, so the two control drawings are read by nothing",
  ).toBeGreaterThanOrEqual(2);
  /** Every drawing a row may name, read once — and a row naming a file this does
   *  not hold throws (`rowDrawing`) rather than reading the shell's text as if it
   *  were the file it named. */
  const fixtureDrawings = drawingTexts();
  for (const row of drawings) {
    // `$eval` throws when the selector matches nothing, which is the reading
    // this row must not skip over.
    const rendered = await page.$eval(
      row.productSelector,
      (element, property) =>
        getComputedStyle(element).getPropertyValue(property),
      row.mockupProperty,
    );
    const declared = mockupDeclared(
      rowDrawing(row.mockupPath, fixtureDrawings),
      row.mockupSelector ?? "",
      row.mockupProperty,
    );
    expect(
      lengthInPx(rendered),
      `${row.region}: the drawing requires ${declared}; the product renders "${rendered}" on \`${row.productSelector}\``,
    ).toBe(lengthInPx(declared));
  }
});

test("authored control spacing stays on §3’s scale", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  test.setTimeout(180_000);
  await prepareControls(page);
  // ── 1. Authored spacing is on DESIGN.md §3's scale ────────────────────────────
  //
  // Scoped to the *authored* layout properties — padding, margin and gap — and
  // read through the typed OM, which is the only reading that keeps `auto` a
  // keyword instead of resolving it to whatever the layout produced. Percentages
  // are skipped: they are relative, not off-scale. Row rhythms (`26px`), glyph
  // bounds (`10px`) and borders are not spacing and are not read here.
  //
  // A hidden form-integration input (a 1×1 off-screen box, which §2.2 already
  // says is not a second control) is not a surface and is skipped, the same way
  // the hit test skips it; and only `type=text` is read, because the fixture
  // authors only text fields — a primitive's own checkbox or `input[type=range]`
  // geometry is base-ui plumbing, not a spacing decision this language made.
  const offScale = await page.evaluate((steps) => {
    const allowed = new Set(steps);
    const properties = [
      "padding-top",
      "padding-right",
      "padding-bottom",
      "padding-left",
      "margin-top",
      "margin-right",
      "margin-bottom",
      "margin-left",
      "row-gap",
      "column-gap",
    ];
    const rootFont = Number.parseFloat(
      getComputedStyle(document.documentElement).fontSize,
    );
    const found: string[] = [];
    const elements = document.querySelectorAll("[data-fixture-root] *");
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      if (element instanceof HTMLInputElement && element.type !== "text") {
        continue;
      }
      const computed = element.computedStyleMap();
      for (const property of properties) {
        const value = computed.get(property);
        if (value === undefined) continue;
        // A keyword (`auto`, `normal`) is not a length and owns no scale.
        if (!(value instanceof CSSUnitValue)) continue;
        if (value.unit === "percent") continue;
        const px =
          value.unit === "rem"
            ? value.value * rootFont
            : value.unit === "px"
              ? value.value
              : Number.NaN;
        if (!Number.isFinite(px) || px === 0) continue;
        if (!allowed.has(px)) {
          found.push(
            `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 24)} ${property}=${px}px`,
          );
        }
      }
    }
    return found;
  }, SPACING_STEPS);
  expect(
    offScale,
    "an authored spacing value is not on DESIGN.md §3's scale",
  ).toEqual([]);
});

test("control colours resolve to §4’s roles", async ({ page }, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  test.setTimeout(180_000);
  await prepareControls(page);
  // ── 2. No colour resolves outside DESIGN.md §4's roles ────────────────────────
  //
  // Every role is resolved *the way a surface paints it* — a probe set to
  // `background: var(--role)` and read back — so `color-mix()` and alpha are
  // resolved by the browser rather than by this file. A gradient role resolves
  // to transparent here, which is what painting it as a colour really does.
  // `box-shadow` is deliberately not read: DESIGN.md §5.4 makes the halo decoration,
  // and a shadow colour is not a surface.
  const literals = await page.evaluate((roles) => {
    const allowed = new Set(["rgba(0, 0, 0, 0)"]);
    const probe = document.createElement("div");
    probe.style.position = "absolute";
    // One viewport to the left: the probe exists only long enough to resolve a
    // role to its computed colour, and a length that cannot be mistaken for a
    // design value keeps it off every pixel this run samples.
    probe.style.left = "-100vw";
    document.body.append(probe);
    for (const role of roles) {
      probe.style.background = `var(--${role})`;
      allowed.add(getComputedStyle(probe).backgroundColor);
    }
    probe.remove();

    const found: string[] = [];
    for (const element of document.querySelectorAll("[data-fixture-root] *")) {
      const rect = element.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      const style = getComputedStyle(element);
      const readings: [string, string][] = [["color", style.color]];
      if (style.backgroundColor !== "rgba(0, 0, 0, 0)") {
        readings.push(["background-color", style.backgroundColor]);
      }
      for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
        const painter =
          side === "Top"
            ? style.borderTopStyle
            : side === "Right"
              ? style.borderRightStyle
              : side === "Bottom"
                ? style.borderBottomStyle
                : style.borderLeftStyle;
        if (painter === "none") continue;
        const value =
          side === "Top"
            ? style.borderTopColor
            : side === "Right"
              ? style.borderRightColor
              : side === "Bottom"
                ? style.borderBottomColor
                : style.borderLeftColor;
        readings.push([`border-${side.toLowerCase()}-color`, value]);
      }
      if (style.outlineStyle !== "none") {
        readings.push(["outline-color", style.outlineColor]);
      }
      for (const [property, value] of readings) {
        if (allowed.has(value)) continue;
        found.push(
          `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 24)} ${property}=${value}`,
        );
      }
    }
    return found;
  }, ROLES);
  expect(
    literals,
    "a gated element paints a colour no DESIGN.md §4 role resolves to",
  ).toEqual([]);
});

test("control targets have non-overlapping 24×24 hit areas (§5)", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  test.setTimeout(180_000);
  await prepareControls(page);
  // ── 3. Every target has DESIGN.md §5's 24×24 hit area, and none overlaps ──────
  //
  // Hit-tested rather than measured, because a target's *box* is not its hit
  // area: the toggle's pill is 26×14 and its target is a centred 24×24 carried
  // by `hitTargetClasses` (`control-well.tsx`). A point over that pseudo-element
  // resolves to the control it expands, so hit-testing is the only reading that
  // measures the rule DESIGN.md states. A point that lands on a neighbour is how
  // "adjacent targets must not overlap" fails.
  //
  // The samples live in a 24×24 box one pixel inside its edge, so a rounded
  // corner is not read as a miss. Two kinds of element are out of scope and are
  // named rather than silently skipped: a hidden form-integration input (an
  // off-screen 1×1 box, which §2.2 already says is not a second control), and
  // the slider's nested `input[type=range]`, whose pointer target is the
  // Base UI `Control` around it — asserted separately, below.
  const hitArea = await page.evaluate(() => {
    const failures: string[] = [];
    const offsets = [-11, -5.5, 0, 5.5, 11];
    const targets = [
      ...document.querySelectorAll<HTMLElement>(
        "[data-fixture-root] button, [data-fixture-root] input, [data-fixture-root] textarea",
      ),
    ];
    for (const target of targets) {
      // **Scroll it in before reading its box.** A target straddling the fold
      // cannot be hit-tested: `elementFromPoint` answers `null` for the part
      // below the window, so the bottom row of samples reads as "misses ->
      // nothing". The fixture has no fixed chrome to scroll under, and the
      // sample box is centred on the target's own box, so a person reaching
      // this control scrolls exactly the same way.
      target.scrollIntoView({ block: "center", inline: "nearest" });
      const rect = target.getBoundingClientRect();
      const visible =
        rect.width >= 2 &&
        rect.height >= 2 &&
        rect.right > 0 &&
        rect.bottom > 0 &&
        rect.left < window.innerWidth &&
        rect.top < window.innerHeight;
      if (!visible) continue;
      if (target instanceof HTMLInputElement && target.type === "range")
        continue;
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      for (const dx of offsets) {
        for (const dy of offsets) {
          const hit = document.elementFromPoint(cx + dx, cy + dy);
          if (hit !== null && (hit === target || target.contains(hit)))
            continue;
          failures.push(
            `${target.tagName.toLowerCase()}.${String(target.className).slice(0, 20)} @${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)} misses at ${dx},${dy} -> ${hit === null ? "nothing" : `${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 30)}`}`,
          );
        }
      }
    }

    // The slider's own target: the Control that surrounds the thumb input.
    const range = document.querySelector<HTMLInputElement>(
      "[data-fixture='slider'] input[type=range]",
    );
    const chain: string[] = [];
    let node: HTMLElement | null = range;
    for (; node !== null && chain.length < 5; ) {
      const rect = node.getBoundingClientRect();
      chain.push(
        `${node.tagName.toLowerCase()}.${String(node.className).slice(0, 20)} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
      );
      node = node.parentElement;
    }
    const control = range?.parentElement?.parentElement ?? null;
    if (control === null) {
      failures.push(
        `the slider has no target to measure: ${chain.join(" < ")}`,
      );
    } else {
      const rect = control.getBoundingClientRect();
      if (rect.width < 24 || rect.height < 24) {
        failures.push(
          `the slider's target is ${Math.round(rect.width)}×${Math.round(rect.height)}: ${chain.join(" < ")}`,
        );
      }
    }
    return failures;
  });
  expect(
    hitArea,
    "a target is smaller than 24×24, or overlaps a neighbour",
  ).toEqual([]);
});
