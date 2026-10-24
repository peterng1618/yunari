import { expect, type Locator, type Page } from "@playwright/test";
import { chooseIn, chooseLabelIn, openSection } from "./control-set.js";
// The rail's toggle rule has one owner and one guard: this file grew a
// second copy of it while the rebuild was being written, which is F1.28's
// class again.
import { answerDialogIfShown } from "./editor-canvas.js";
import { openPane } from "./editor-rail.js";

/**
 * Driving the editor the way an author does.
 *
 * Every helper here is a pointer or a keystroke against a delivered control.
 * The scene is **read** through the editor handle and never written: if a step
 * needed `page.evaluate` to set a value, that would be a finding about the
 * surface rather than a technique, and the proof of the surface would be void.
 */

export type SceneObject = {
  readonly id: string;
  readonly name: string | undefined;
  readonly type: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

type FabricObjectLike = {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  scaleX?: number;
  scaleY?: number;
  type: string;
  get(name: string): unknown;
};

/** What the scene holds, read through the handle. */
export async function readScene(page: Page): Promise<SceneObject[]> {
  return page.evaluate(() => {
    // The global is `yunari-fabric-editor-N` and **N is per instance**:
    // creating a document tears the editor down and the old name is removed
    // rather than left stale, so a handle cached across a `New` reads as a live
    // document after it is gone. Resolved here, at every use.
    const handle = Object.values(window).find(
      (value) =>
        value !== null &&
        typeof value === "object" &&
        "canvas" in value &&
        "historyManager" in value,
    ) as { canvas: { getObjects(): FabricObjectLike[] } } | undefined;
    if (handle === undefined) return [];
    return handle.canvas.getObjects().map((object) => ({
      id: String(object.get("id") ?? ""),
      name: object.get("name") as string | undefined,
      type: object.type,
      left: Math.round(object.left ?? 0),
      top: Math.round(object.top ?? 0),
      width: Math.round((object.width ?? 0) * (object.scaleX ?? 1)),
      height: Math.round((object.height ?? 0) * (object.scaleY ?? 1)),
    }));
  });
}

/** What one object carries, read through the handle. */
export async function readObject(
  page: Page,
  name: string,
): Promise<Record<string, unknown> | undefined> {
  return page.evaluate((wanted) => {
    const handle = Object.values(window).find(
      (value) =>
        value !== null &&
        typeof value === "object" &&
        "canvas" in value &&
        "historyManager" in value,
    ) as { canvas: { getObjects(): FabricObjectLike[] } } | undefined;
    const object = handle?.canvas
      .getObjects()
      .find((candidate) => candidate.get("name") === wanted);
    if (object === undefined) return undefined;
    return {
      id: object.get("id"),
      name: object.get("name"),
      type: object.type,
      originX: (object as { originX?: string }).originX,
      left: Math.round(object.left ?? 0),
      top: Math.round(object.top ?? 0),
      renderedWidth: Math.round((object.width ?? 0) * (object.scaleX ?? 1)),
      renderedHeight: Math.round((object.height ?? 0) * (object.scaleY ?? 1)),
      text: (object as { text?: string }).text,
      yunariText: object.get("yunariText"),
      yunariPaint: object.get("yunariPaint"),
      yunariGlass: object.get("yunariGlass"),
      settings: object.get("settings"),
    };
  }, name);
}

/**
 * A blank theme at the size the reference composition is drawn at, opened
 * through the real `New` menu and the real chooser.
 *
 * The chooser asks for the display first and keeps the ratio and resolution
 * behind **Custom**, so asking for a particular preset means choosing Custom
 * first — which is also the path an author takes.
 *
 * **Every one of its lists is a `ControlSelect` now**, so each is a trigger to
 * press and an item to click rather than a native `<select>` to set. Measured
 * with this left on `dialog[open]` and `selectOption`: `inspector-sections.spec.ts`
 * 5 failed / 6 passed / 11 skipped, plus the rebuild and display journeys.
 */
export async function openBlank(
  page: Page,
  ratio = "16:9",
  resolution = "1080p",
): Promise<void> {
  await page.getByRole("button", { name: "File", exact: true }).click();
  // `role="menuitem"`, never `[role=menu] button`: a closed menu stays in the
  // DOM and that selector matches a stale menu's items.
  await page.getByRole("menuitem", { name: "New theme" }).click();
  const chooser = page.locator('[role="dialog"]', {
    hasText: "Choose an artboard size",
  });
  await expect(chooser).toBeVisible();
  await chooseIn(page, "[data-yunari-new-document-display]", "");
  await chooseIn(page, "[data-yunari-new-document-ratio]", ratio);
  await chooseIn(page, "[data-yunari-new-document-resolution]", resolution);
  await page.locator("[data-yunari-new-document-create]").click();

  // **This asks nothing on the path every caller takes, and is kept for the
  // ones that do not.** A `PersistenceManager` is built with the document the
  // session opened on, and `New` mounts a fresh session — so the new document
  // *is* the new baseline, and `isDirty` is false. Measured, not reasoned, on a
  // fresh editor: File → New theme → Create left zero `[role="dialog"]` on the
  // page. A caller that reaches here on a document it has already edited is the
  // one this answers for.
  await answerDialogIfShown(page, "Discard");
  await expect.poll(async () => (await readScene(page)).length).toBe(0);
}

/** The Add pane's groups, by the kind of object each holds: the values the pane
 *  writes to `data-yunari-add-group`, which are `insertGroups()`'s `kind`s.
 *
 *  **`"text"` is the one kind the pane draws in no group at all** — a group of
 *  one would say a region exists where there is one thing — so its scope is the
 *  pane itself and every other kind's is its own fieldset. */
export type AddGroup = "card" | "text" | "shape" | "chart";

/** The button in the Add pane that makes an object, by the name it answers to,
 *  in the group the caller names.
 *
 *  Read as the accessible name rather than as the text inside the button: the
 *  pane's shape and chart tiles are glyph-led (DESIGN.md §6), so a `Path` or a
 *  `Gauge` tile draws a glyph and carries its word in its name, not on it. The
 *  cards and Text show their word, and a name is what a reader is told for
 *  either.
 *
 *  **The group is required, and it is what tells two same-named tiles apart**
 *  (`vg-537`): "Line" is a shape and a chart family, and a lookup that resolved
 *  one of them by position answered a question the caller had not asked — the
 *  chart's Line went in where the shape's was meant, and the assertion that
 *  followed grew either way. It is also the scope that keeps a pane-wide name
 *  from matching twice (`vg-211`): the pane holds the file path's controls as
 *  well, so a pane-wide name lookup is one asset button labelled with a shape
 *  word away from matching two — silently, and in this file alone. That is why
 *  every kind but `"text"` is scoped to its own fieldset, and why the one that
 *  is not carries the note below. */
export function addButton(page: Page, label: string, group: AddGroup): Locator {
  // **The `"text"` scope is the pane, and that is a hazard rather than a tidy
  // one.** A card tile renders *inside* the pane's subtree — `insertGroups()`
  // puts the cards in a `card` fieldset that is a descendant of it — so a card
  // ever labelled `Text` would give this lookup two matches. It would then fail
  // **loudly**, as Playwright's strict-mode violation on the click, and not as
  // the silent wrong-kind insert `vg-537` was: a broken driver rather than a
  // lying one. `uiCopy.cardLibrary` carries no `Text` today, which is all that
  // holds it.
  const scope =
    group === "text"
      ? page.locator('[data-yunari-panel="add"]')
      : page.locator(`[data-yunari-add-group="${group}"]`);
  return scope.getByRole("button", { name: label, exact: true });
}

/**
 * Places a Text through the armed gesture: the Add pane's tile arms it, and the
 * next primary press on the canvas creates the object at that point.
 *
 * **The press is a pointer event at scene coordinates, not a locator click**:
 * the canvas is one element, so where the press lands is scene geometry. Fabric
 * puts scene units on the element through `viewportTransform`, and the
 * element's own box puts that on the page. The default is the element's centre,
 * which is where the camera fit puts the artboard's centre too.
 */
export async function placeText(
  page: Page,
  point?: { readonly x: number; readonly y: number },
): Promise<void> {
  await openPane(page, "Add");
  const before = (await readScene(page)).length;
  await addButton(page, "Text", "text").click();
  const target = await page.evaluate((scenePoint) => {
    const handle = Object.values(window).find(
      (value) =>
        value !== null &&
        typeof value === "object" &&
        "canvas" in value &&
        "historyManager" in value,
    ) as
      | {
          canvas: {
            viewportTransform: [number, number, number, number, number, number];
            upperCanvasEl: HTMLCanvasElement;
          };
        }
      | undefined;
    if (handle === undefined)
      throw new Error("the editor handle is not on the page");
    const { canvas } = handle;
    // `[0]` is the scale, `[4]`/`[5]` the translation; the tuple is not rotated
    // in this editor, so `[3]` is the vertical scale.
    const [scaleX, , , scaleY, translateX, translateY] =
      canvas.viewportTransform;
    const rect = canvas.upperCanvasEl.getBoundingClientRect();
    const scene = scenePoint ?? {
      x: (rect.width / 2 - translateX) / scaleX,
      y: (rect.height / 2 - translateY) / scaleY,
    };
    return {
      x: rect.left + translateX + scene.x * scaleX,
      y: rect.top + translateY + scene.y * scaleY,
    };
  }, point ?? null);
  await page.mouse.click(target.x, target.y);
  await expect
    .poll(async () => (await readScene(page)).length)
    .toBe(before + 1);
}

/** Inserts an object from the Add pane, by the word on the control and the group
 *  that carries it — see `addButton`. **The family is the caller's to name and
 *  never the driver's to infer**: the two Lines are told apart by the group they
 *  sit in, and by nothing else (`vg-537`). */
export async function insert(
  page: Page,
  label: string,
  group: AddGroup,
): Promise<void> {
  // Text's tile arms a one-shot placement gesture and creates nothing itself,
  // so the tile press alone is not an insert.
  if (label === "Text" && group === "text") {
    await placeText(page);
    return;
  }
  // The rail shows one pane, and selecting a layer switches it to Composition
  // — so an author comes back to Add the same way this does. The selection's
  // own fields are in the right column, which no pane affects.
  await openPane(page, "Add");
  const before = (await readScene(page)).length;
  await addButton(page, label, group).click();
  await expect
    .poll(async () => (await readScene(page)).length)
    .toBeGreaterThan(before);
}

/**
 * Selects an object by clicking its row in the layer list.
 *
 * **On the name element, not on the row's text.** `hasText` matches anywhere in
 * the row, and a card owns rows that carry its name — `cpu-card` sits beside
 * `cpu-card-icon`, `-title`, `-value` and `-sparkline` — so a substring match
 * returns the first of five, and DOM order puts the card itself *last*. The
 * display pass hung on it: it clicked the sparkline and then waited for a fill
 * control a chart does not have.
 *
 * `.yunari-layer-name` is the one element in a row that holds the name and
 * nothing else; the row also carries a twisty, a visibility toggle and a lock,
 * so matching the row's own text is matching all of those too.
 */
export async function selectLayer(page: Page, name: string): Promise<void> {
  await openPane(page, "Composition");
  await page
    .locator(".yunari-layer-name")
    // Anchored, because `hasText` is a substring match and `cpu-card` would
    // otherwise take `cpu-card-icon` whenever the icon's row came first.
    .filter({
      hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    })
    .first()
    // **The row's left end, not its centre.** `.yunari-layer-name` is
    // `flex: 1 1 auto`, so it fills the row and its centre lands under the
    // attended row's absolutely-positioned state slot (`.yunari-layer-state`,
    // `right: 4px` off the row's own edge, as wide as its controls) — a press
    // there is intercepted, and five of `author-journey-rebuild.spec.ts`'s
    // cases hung on it. The name's own text leads the row, which is where an
    // author presses anyway.
    .click({ position: { x: 6, y: 6 } });
}

/** Types into a control the way an author does, and commits it on blur. */
export async function fill(
  page: Page,
  selector: string,
  value: string | number,
): Promise<void> {
  const control = page.locator(selector).first();
  await control.scrollIntoViewIfNeeded();
  await control.fill(String(value));
  await control.blur();
}

export async function choose(
  page: Page,
  selector: string,
  value: string,
): Promise<void> {
  const control = page.locator(selector).first();
  if ((await control.count()) === 0) {
    throw new Error(`no control matches ${selector} on this selection`);
  }
  // **A token dropdown is only as good as its tokens.** The run-colour and
  // run-preset selects list what the *document* declares, so a value the
  // document does not carry cannot be chosen — and a picker that cannot be
  // chosen from retries that until the test's whole budget is gone. That is what
  // made every one of these nine red on a document nobody had broken: the first
  // error was a 30-second timeout naming a suite rather than a defect.
  //
  // The run editor's pickers are plan 1's select now, not a native `<select>`
  // (`runs.tsx:497-570`), so the two paths are the two controls: the native one
  // is checked against its own `<option>`s and the new one is opened by value.
  if ((await control.evaluate((node) => node.tagName)) === "SELECT") {
    const offered = await control
      .locator("option")
      .evaluateAll((options) =>
        options.map((option) => option.getAttribute("value")),
      );
    if (!offered.includes(value)) {
      throw new Error(
        `${selector} has no option "${value}". It offers: ${
          offered.map((entry) => JSON.stringify(entry)).join(", ") || "(none)"
        }`,
      );
    }
    await control.scrollIntoViewIfNeeded();
    await control.selectOption(value);
    return;
  }
  await chooseIn(page, selector, value);
}

const GEOMETRY = {
  x: "left",
  y: "top",
  w: "width",
  h: "height",
} as const;

/**
 * Opens the Position section.
 *
 * Position used to be the one section closed by default — an author adjusts
 * geometry once and chooses the binding constantly — and the author's item 13
 * reversed that: every question opens, so on a fresh selection this call is a
 * no-op. It stays because a case may have closed the section itself (a reader
 * may, and the column no longer decides that for them), and because a helper
 * that filled a geometry field without opening it would wait on a hidden input,
 * which is a hidden control and not a failing one. `openSection` reads
 * `aria-expanded` and clicks only when the section is closed, so a caller that
 * does not care about the disclosure can call this either way.
 *
 * The disclosure is plan 1's (`InspectorSection`), so the rule lives with the
 * control it is about rather than here.
 */
export async function openPosition(page: Page): Promise<void> {
  await openSection(page, "position");
}

/** Places and sizes the selection, in whole artboard units. */
export async function place(
  page: Page,
  box: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  },
): Promise<void> {
  await openPosition(page);
  for (const [key, value] of [
    [GEOMETRY.x, box.x],
    [GEOMETRY.y, box.y],
    [GEOMETRY.w, box.w],
    [GEOMETRY.h, box.h],
  ] as const) {
    await fill(page, `[data-yunari-geometry="${key}"]`, value);
  }
}

export async function setName(page: Page, value: string): Promise<void> {
  await page.locator("[data-yunari-subject-name]").dblclick();
  await fill(page, "[data-yunari-name]", value);
}

/** A frosted card: the material the reference composition is built from. */
export async function frost(page: Page, blur: number): Promise<void> {
  const toggle = page.locator("[data-yunari-glass-enabled]").first();
  await toggle.scrollIntoViewIfNeeded();
  if (!(await toggle.isChecked())) await toggle.check();
  await fill(page, "[data-yunari-glass-blur]", blur);
}

/** A palette token: what every colour in the composition resolves through. */
export async function addColour(
  page: Page,
  name: string,
  hex: string,
): Promise<void> {
  // The palette panel is the Tokens pane's, so it lives in the Tokens pane
  // and is hidden until the slot is asked for.
  await openPane(page, "Tokens");
  await page.getByRole("button", { name: "Add colour", exact: true }).click();
  await fill(page, "[data-yunari-palette-name]", name);
  await fill(page, "[data-yunari-palette-color]", hex);
}

/**
 * Picks a token by the name the author gave it.
 *
 * The pickers list tokens by their display name and store `palette.<id>`, and
 * the two are not the same string: a token added through the panel is minted
 * `colour`, `colour-2`, `colour-3`. So the driver resolves the option a person
 * reads and selects the value behind it, exactly as clicking it would.
 */
export async function chooseToken(
  page: Page,
  selector: string,
  label: string,
): Promise<void> {
  const control = page.locator(selector).first();
  // Same reasoning as `choose`: a control this shape does not render should say
  // so in one line, rather than spending the budget on a `scrollIntoViewIfNeeded`
  // that is waiting for something that will never arrive. That is the difference
  // between the eight failures this suite had — every one a bare 30 s timeout —
  // and the errors it now reports.
  if ((await control.count()) === 0) {
    throw new Error(`no control matches ${selector} on this selection`);
  }
  await control.scrollIntoViewIfNeeded();
  // The panel's pickers are plan 1's select now: the tokens are `Select.Item`s
  // in a popup, so the label is what a person reads, and `chooseLabelIn` opens
  // the right list before it looks for one. It deliberately does **not** reach
  // for `page.getByRole("option")` here: this file is the one that learned why —
  // a closed popup lingers through its exit animation, so an unscoped lookup
  // resolves to two rows, `.first()` clicks the stale hidden one, and the case
  // spends its budget waiting for an edit that never committed.
  //
  // The `SELECT` branch below is **unreachable today, and kept on purpose.**
  // Every caller's hook rides a Base UI trigger — `panel.ts`'s swatch
  // (`data-yunari-panel-fill`/`-stroke`, :224/:238) and `chart-fields.tsx`'s
  // `ControlSelect` (`data-yunari-chart-paint`, :447) — so `tagName` is always
  // `"BUTTON"` here and the branch never runs. Its sibling in `choose` *is* live,
  // because `choose` is still called with native-select hooks. A driver that
  // silently assumed Base UI would break without saying so the day a native
  // picker returns.
  if ((await control.evaluate((node) => node.tagName)) !== "SELECT") {
    await chooseLabelIn(page, control, label);
    return;
  }
  const value = await control
    .locator("option")
    .filter({ hasText: label })
    .first()
    .getAttribute("value");
  if (value === null || value === "") {
    throw new Error(`no token named "${label}" in ${selector}`);
  }
  await control.selectOption(value);
}

/** A text object, placed, with its first run's words. */
export async function addText(
  page: Page,
  object: {
    readonly name: string;
    readonly text: string;
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly preset?: string;
    readonly colour?: string;
  },
): Promise<void> {
  await insert(page, "Text", "text");
  await setName(page, object.name);
  await place(page, object);
  await fill(page, '[data-yunari-run-text="0"]', object.text);
  if (object.preset !== undefined)
    await choose(page, '[data-yunari-run-preset="0"]', object.preset);
  if (object.colour !== undefined)
    await choose(page, '[data-yunari-run-colour="0"]', object.colour);
}

/** A card: a rectangle, named, placed, frosted and outlined. */
export async function addCard(
  page: Page,
  card: {
    readonly name: string;
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly blur?: number;
    readonly radius?: number;
    readonly stroke?: string;
  },
): Promise<void> {
  await insert(page, "Rectangle", "shape");
  await setName(page, card.name);
  await place(page, card);
  if (card.radius !== undefined)
    await fill(page, "[data-yunari-panel-radius]", card.radius);
  if (card.stroke !== undefined)
    await chooseToken(page, "[data-yunari-panel-stroke]", card.stroke);
  if (card.blur !== undefined) await frost(page, card.blur);
}

/** A chart, bound to one or more sensors, with its own paint. */
export async function addChart(
  page: Page,
  chart: {
    readonly family: string;
    readonly name: string;
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly series: readonly string[];
    readonly paint?: ReadonlyArray<string | undefined>;
  },
): Promise<void> {
  await insert(page, chart.family, "chart");
  await setName(page, chart.name);
  await place(page, chart);
  for (const key of chart.series) {
    // Scrolled first: the chart's fields sit in a scrolling inspector, and
    // `selectOption` waits for visibility rather than scrolling to it.
    const chooser = page.locator("[data-yunari-chart-binding-add]");
    // The last of the three waits that spent this suite's whole budget saying
    // nothing. `scrollIntoViewIfNeeded` on a control that is not there waits for
    // the test timeout, and the test that reports it names neither the selector
    // nor the state — which is how a product defect (vg-139) hid behind four
    // suites' worth of 30-second timeouts.
    if ((await chooser.count()) === 0) {
      throw new Error(
        "the chart panel has no series chooser, so no series can be bound",
      );
    }
    // The chooser is plan 1's select. Its options are the document's own
    // semantic keys, and each carries its key as `data-yunari-option`, so the series is
    // named the way the object stores it rather than by a label copied here.
    await chooseIn(page, "[data-yunari-chart-binding-add]", key);
  }
  for (const [index, token] of (chart.paint ?? []).entries()) {
    if (token === undefined) continue;
    // A line's data colour is its *series* paint, one entry per series; a
    // gauge's and a bar's is a single field. `chartPaintFieldsFor` is what says
    // which, and the panel's own attribute is what the author clicks.
    const family = chart.family.toLowerCase();
    const key =
      family === "line" || family === "pie"
        ? `palette.${index}`
        : PAINT_KEY[family];
    await chooseToken(page, `[data-yunari-chart-paint="${key}"]`, token);
  }
}

/**
 * The paint field each family paints its data through, as
 * `chartPaintFieldsFor` declares it. A family's *series* palette is the one
 * that repeats, so its key is the base and the index is the slot.
 *
 * **Keyed by the family's own name, which is lower case.** `CHART_FAMILIES` is
 * `["gauge", "line", "bar", "pie"]` and `chart.family` carries one of those —
 * measured live as `line` on the object whose fields the inspector shows. The Add pane's
 * button is the capitalised *label*, and `insert` matches on the label, so this
 * driver was holding the label in `family` and comparing it against a value that
 * is never the label. The lookup missed, so `PAINT_KEY[family]` was `undefined`
 * and the selector it built matched nothing.
 *
 * So the family is normalised to its own spelling before it is used as a key,
 * which is what lets the spec keep naming charts the way an author reads them
 * ("Line") without the driver mistaking that for the stored value.
 */
const PAINT_KEY: Readonly<Record<string, string>> = {
  gauge: "progress",
  bar: "fill",
};
