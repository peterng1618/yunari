import {
  expect,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";

export type ArtboardRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** What the page-side reader can be asked for off a scene object. */
export type SceneRead = "center" | "rect" | "coords";

/** Viewport offsets are canvas-relative, not page coordinates. */
async function artboardRect(page: Page): Promise<ArtboardRect> {
  return page.evaluate(() =>
    (
      window as unknown as {
        yunariEditorBridge: {
          editor: { viewport: { artboardScreenRect(): ArtboardRect } };
        };
      }
    ).yunariEditorBridge.editor.viewport.artboardScreenRect(),
  );
}

export async function sceneToClient(
  page: Page,
  sceneWidth: number,
  x: number,
  y: number,
): Promise<{ x: number; y: number }> {
  const rect = await artboardRect(page);
  const box = (await page
    .locator("#yunari-fabric-editor canvas.upper-canvas")
    .boundingBox())!;
  const scale = rect.width / sceneWidth;
  return { x: box.x + rect.left + x * scale, y: box.y + rect.top + y * scale };
}

/**
 * One named object, read from wherever in the document it lives.
 *
 * **The one search, in one place.** A card's parts are not in
 * `canvas.getObjects()` — they live inside the group, and the starter is eight
 * groups over fifty parts — so a helper that searched only the root reported
 * `no object with id time-card` for an object the author can see on the canvas,
 * and eleven specs failed on it. `glass-probe.ts` already carried this search
 * for the same reason.
 *
 * Every read is **world** rather than group-local: `getBoundingRect` and
 * `getCenterPoint` compose the ancestor transform, which is what a pointer
 * gesture needs. Reading `.left` off a part returns its position *inside* its
 * card, and the click lands somewhere the author never put anything — a test
 * that then fails for a reason that names neither grouping nor the bug.
 *
 * `read` is named rather than a callback because `page.evaluate` serializes the
 * function and cannot close over one; a switch inside the page is the honest
 * spelling of that constraint.
 */
export async function readSceneObject<T>(
  page: Page,
  id: string,
  read: SceneRead,
): Promise<T> {
  return page.evaluate(
    ([objectId, what]) => {
      type SceneObject = {
        readonly id?: string;
        readonly getObjects?: () => readonly SceneObject[];
        readonly getCenterPoint: () => { x: number; y: number };
        readonly getBoundingRect: () => {
          left: number;
          top: number;
          width: number;
          height: number;
        };
        readonly getCoords: () => Array<{ x: number; y: number }>;
      };
      const objects = (
        window as unknown as {
          yunariEditorBridge: {
            editor: { canvas: { getObjects(): readonly SceneObject[] } };
          };
        }
      ).yunariEditorBridge.editor.canvas.getObjects();

      const find = (
        candidates: readonly SceneObject[],
      ): SceneObject | undefined => {
        for (const candidate of candidates) {
          if (candidate.id === objectId) return candidate;
          const found = find(candidate.getObjects?.() ?? []);
          if (found !== undefined) return found;
        }
        return undefined;
      };
      const object = find(objects);
      if (object === undefined)
        throw new Error(`no object with id ${objectId}`);
      if (what === "center") return object.getCenterPoint();
      if (what === "coords") return object.getCoords();
      return object.getBoundingRect();
    },
    [id, read] as const,
  ) as Promise<T>;
}

/** Fabric's centre handles every origin; left + width / 2 does not. */
export async function clientOfScene(
  page: Page,
  id: string,
  sceneWidth = 1280,
): Promise<{ x: number; y: number }> {
  const centre = await readSceneObject<{ x: number; y: number }>(
    page,
    id,
    "center",
  );
  return sceneToClient(page, sceneWidth, centre.x, centre.y);
}

export type HandleKey = "tl" | "tr" | "br" | "bl" | "ml" | "mr" | "mt" | "mb";

/**
 * The scene point of a named object's resize handle, read from the object's own
 * corner coordinates: Fabric draws and hit-tests `ml`/`mr` at the midpoint of
 * the two corners on that side, and the corner controls sit on the corners
 * themselves. Reading it rather than restating fixture numbers keeps the grab
 * on the handle after any fixture tweak, and the corners already carry the
 * object's stroke and scale.
 */
export async function objectHandleScenePoint(
  page: Page,
  id: string,
  key: HandleKey,
): Promise<{ x: number; y: number }> {
  const corners = await readSceneObject<Array<{ x: number; y: number }>>(
    page,
    id,
    "coords",
  );
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  if (!topLeft || !topRight || !bottomRight || !bottomLeft)
    throw new Error(`${id} has no corner coordinates`);
  const midpoint = (
    first: { x: number; y: number },
    second: { x: number; y: number },
  ) => ({ x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 });
  if (key === "tl") return topLeft;
  if (key === "tr") return topRight;
  if (key === "br") return bottomRight;
  if (key === "bl") return bottomLeft;
  if (key === "ml") return midpoint(topLeft, bottomLeft);
  if (key === "mr") return midpoint(topRight, bottomRight);
  if (key === "mt") return midpoint(topLeft, topRight);
  return midpoint(bottomLeft, bottomRight);
}

/**
 * Opens a group row in the layer tree, the way an author does.
 *
 * **A group's parts are rows only while it is open**, and a document starts
 * with every group shut — so a spec that names a part's row without this waits
 * out its whole budget on a locator that never matches, and reports a broken
 * click rather than a shut tree.
 *
 * `button[aria-expanded]` rather than a label prefix: an attended group row
 * carries four buttons — the twisty, Hide, Lock and the entry control — so
 * `button[aria-label]` is a strict-mode violation, and only the twisty declares
 * expansion at all. (It was five until `vg-462` took the rename pen off the
 * row; the reason the twisty is needed has not changed.)
 */
export async function expandLayer(page: Page, groupId: string): Promise<void> {
  const twisty = page.locator(
    `[data-yunari-layer="${groupId}"] button[aria-expanded]`,
  );
  if ((await twisty.getAttribute("aria-expanded")) === "true") return;
  await twisty.click();
  await expect(twisty).toHaveAttribute("aria-expanded", "true");
}

/**
 * Enters a group from its own row, the way an author does.
 *
 * **Entering and expanding are two acts**, and this is the entry one: the
 * twisty opens a group's rows, while entering makes its parts *selectable*.
 * `bridge.selectLayer` takes `owner ?? target`, so with the group merely open a
 * click on a part's row hands back the group. Hover is required rather than
 * decorative — the control is drawn on an attended row only, so it is not in
 * the DOM until the pointer is on the row, and entering expands the group on
 * the way.
 *
 * **Waits on the bridge's `groupContext()` naming the id**, not on the button
 * and not on the row's own attribute: the click repaints the row before the
 * panel has re-projected the tree around the new context, so a helper that
 * resolved on the DOM would leave the next action in the same spec racing the
 * re-projection. Returns immediately when the group is already entered, also
 * read from the bridge rather than from the row's label.
 */
export async function enterLayer(page: Page, groupId: string): Promise<void> {
  const entered = (): Promise<readonly string[]> =>
    page.evaluate(() =>
      (
        window as unknown as {
          yunariEditorBridge: { groupContext(): readonly string[] };
        }
      ).yunariEditorBridge.groupContext(),
    );
  if ((await entered()).includes(groupId)) return;
  const row = page.locator(`[data-yunari-layer="${groupId}"]`);
  // **Leave before arriving.** A hover to the point the pointer already rests
  // on is a no-op: Chromium fires no `mouseover` when the hit target does not
  // change, so the row never becomes the attended one and the entry control is
  // never rendered. A preceding action leaves the pointer wherever its own last
  // click put it — a menu item near the tree's first row, in this file's own
  // specs — and `hover()` then lands on the row the pointer is already over,
  // which is why this is not a cosmetic wait. Moving off the tree first makes
  // the arrival a real transition, which is what a pointer does.
  await page.mouse.move(0, 0);
  await row.hover();
  await row.locator("[data-yunari-layer-entry]").click();
  await expect.poll(entered).toContain(groupId);
}

/**
 * A named object's world-space bounding rect, read from the object itself so a
 * fixture tweak cannot leave a test clicking at a stale point.
 */
export async function objectRect(
  page: Page,
  id: string,
): Promise<ArtboardRect> {
  return readSceneObject<ArtboardRect>(page, id, "rect");
}

/** A named object's world-space left edge, the snap line a neighbour offers. */
export async function worldLeftOf(page: Page, id: string): Promise<number> {
  return (await objectRect(page, id)).left;
}

/** A named object's world-space right edge, the snap line a neighbour offers. */
export async function worldRightOf(page: Page, id: string): Promise<number> {
  const rect = await objectRect(page, id);
  return rect.left + rect.width;
}

/**
 * The scene x in `[from, to]` furthest from every x-line the other objects and
 * the artboard offer, with that distance. A resize aimed at this x is clear of
 * every snap candidate, so "the raw landing survived" is a real no-snap
 * assertion — a guide drawn there would be a snap with no line to snap to.
 *
 * **The lines read here are the product's own candidate set**, because a set
 * narrower than the one the gesture snaps against is a helper that lies:
 * `collectSnapSources` walks every root *and* each group's parts since
 * `vg-123`, and a part's box is not its group's. A part's box carries its own
 * stroke, so a card's panel offers edges the card's declared box does not
 * (probed on the starter's shape: the card's 360×200 against its panel's
 * 362×202), and a card's labels and charts offer lines inside it that no root
 * object has. Read roots alone (`vg-123`'s first pass) and the aim can sit
 * clear of all of them while a part line is inside the acquire threshold —
 * which is exactly the no-snap control that then snapped.
 *
 * The dragged object's own subtree and its ancestors are left out, as
 * `collectExcludedObjects` excludes them; they are not candidates of its own
 * gesture, and an aim chosen around lines it cannot reach would be further
 * from a real one than it needs to be.
 */
export async function clearSceneX(
  page: Page,
  excludeId: string,
  from: number,
  to: number,
  artboardWidth: number,
): Promise<{ x: number; distance: number }> {
  return page.evaluate(
    ([objectId, start, end, artboard]: readonly [
      string,
      number,
      number,
      number,
    ]) => {
      type SceneObject = {
        id?: string;
        parent?: SceneObject;
        getObjects?: () => SceneObject[];
        getBoundingRect(): { left: number; width: number };
      };
      const bridge = (
        window as unknown as {
          yunariEditorBridge: {
            editor: { canvas: { getObjects(): SceneObject[] } };
          };
        }
      ).yunariEditorBridge;
      const canvas = bridge.editor.canvas;

      // Every root and its parts, in the order `collectSnapSources` offers them.
      const all: SceneObject[] = [];
      const walk = (object: SceneObject): void => {
        all.push(object);
        for (const part of object.getObjects?.() ?? []) walk(part);
      };
      for (const object of canvas.getObjects()) walk(object);

      const excluded = new Set<SceneObject>();
      const target = all.find((object) => object.id === objectId);
      if (target) {
        excluded.add(target);
        for (
          let ancestor = target.parent;
          ancestor !== undefined;
          ancestor = ancestor.parent
        ) {
          excluded.add(ancestor);
        }
        const collect = (object: SceneObject): void => {
          for (const part of object.getObjects?.() ?? []) {
            excluded.add(part);
            collect(part);
          }
        };
        collect(target);
      }

      // The artboard is a snap source too; every test in this file treats the
      // scene as the starter's artboard wide, so its edges and centre belong
      // here. Passed in rather than closed over: this runs in the page. The
      // product reads the artboard object's own bounds instead, so this residual
      // can read narrower than the gesture's set and it agrees only while the
      // artboard starts at the origin, which every fixture here does.
      const lines = [0, artboard / 2, artboard];
      for (const object of all) {
        if (excluded.has(object)) continue;
        const rect = object.getBoundingRect();
        lines.push(
          rect.left,
          rect.left + rect.width / 2,
          rect.left + rect.width,
        );
      }
      let best = { x: start, distance: -1 };
      for (let x = start; x <= end; x += 0.5) {
        const distance = Math.min(...lines.map((line) => Math.abs(line - x)));
        if (distance > best.distance) best = { x, distance };
      }
      return best;
    },
    [excludeId, from, to, artboardWidth] as const,
  );
}

/**
 * A visual-review capture, written only under `YUNARI_CAPTURE=1`.
 *
 * **An optional `scope` photographs one element rather than the viewport.** The
 * inspector column is taller than a 1280×720 fold and its own scroller clips the
 * rest, so a viewport shot of it stops at whatever fits — the last section never
 * reaches the frame. Passing the column element captures the whole column. With
 * no scope the output is the viewport shot every existing caller already produced.
 *
 * **An optional `ground` names the palette the frame must be on, and is asserted
 * before the shot.** `page.screenshot` does not wait for the OS listener's
 * re-render, so an assertion taken after the shot can pass while the PNG is a
 * lighter frame; asserting here, after the emulation and before the shot, is what
 * ties the claim to the pixels. A capture that chose through the Appearance tab
 * needs no `ground` — its stored choice disarms the listener — and one taken on
 * the parity fixture does, because the fixture sets the attribute with no stored
 * choice and so has nothing holding it across a re-render.
 */
export async function captureVisualReview(
  page: Page,
  testInfo: TestInfo,
  name: string,
  scope?: Locator,
  ground?: string,
): Promise<void> {
  if (process.env["YUNARI_CAPTURE"] === undefined) return;
  // The shipping default, not whatever Playwright's `colorScheme` happens to be,
  // and the same move `design-language.spec.ts`'s "The drawing's own ground"
  // capture already makes to pin graphite. A capture that chose through the
  // Appearance tab keeps its ground: the stored choice disarms the OS listener,
  // so the emulation re-renders nothing. A palette set as a bare attribute — the
  // parity fixture's `setPalette`, which writes no storage — has no such
  // protection and survives only while nothing re-renders, so a capture on that
  // route passes `ground` and is proven rather than assumed.
  await page.emulateMedia({ colorScheme: "dark" });
  if (ground !== undefined) {
    await expect(page.locator("html")).toHaveAttribute(
      "data-shell-palette",
      ground,
    );
  }
  const directory =
    process.env["YUNARI_CAPTURE_DIR"] ?? "../../test-results/captures";
  const filename = `${name}-${testInfo.project.name}.png`;
  const path = `${directory}/${filename}`;
  const screenshot =
    scope === undefined
      ? await page.screenshot({ path })
      : await scope.screenshot({ path });
  await testInfo.attach(filename, {
    body: screenshot,
    contentType: "image/png",
  });
  expect(screenshot.byteLength).toBeGreaterThan(1000);
}

/** A local file the chooser offers, in the shape both chooser paths accept. */
export type LocalFile = {
  name: string;
  mimeType: string;
  buffer: Buffer;
};

/**
 * Chooses a local file the way an author does: press the button, then answer
 * the file chooser it opened.
 *
 * `setInputFiles` against the hidden input proves a route the product does not
 * offer — it drives a control no one can reach, so it stays green while the
 * feature is unreachable. Going through the button and the chooser event is
 * what a click actually produces, and it fails the moment the button is gone.
 */
export async function chooseAssetFile(
  page: Page,
  control: "import" | "replace",
  file: LocalFile,
): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.locator(`[data-yunari-asset-${control}]`).click();
  await (await chooser).setFiles(file);
}

/**
 * Answers a modal if it turns up, and reports whether it did.
 *
 * `isVisible()` answers about *now*, and these prompts are not up *now*: the
 * dirty guard resolves before it asks, so a test that checks immediately sees
 * nothing and skips the click — then hangs somewhere downstream waiting for a
 * button it decided did not exist. It reads as a product timeout and is a test
 * defect, which is exactly how issue #7 presented.
 *
 * Bounded so that "no prompt" stays a real outcome rather than a long wait: the
 * dirty guard is genuinely not settled on a just-saved document, and some
 * rounds ask and some do not.
 */
export async function answerDialogIfShown(
  page: Page,
  button: string,
  timeout = 3_000,
): Promise<boolean> {
  const dialog = page.locator('[role="dialog"]');
  const shown = await dialog
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);
  if (!shown) return false;
  await dialog.getByRole("button", { name: button, exact: true }).click();
  // Deliberately no "and wait for it to close". New asks in two steps — the
  // chooser, then the replacement prompt — and each is a `Dialog` of its own, so
  // calling this twice in a row answers both.
  return true;
}
