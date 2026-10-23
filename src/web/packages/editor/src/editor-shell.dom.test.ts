// @vitest-environment jsdom

import { createDemoSource } from "@yunari/fake-source";
import {
  type AssetReference,
  type Background,
  objectName,
} from "@yunari/renderer-core";
import { isLocked, serialiseScene } from "@yunari/scene-fabric";
import { FabricImage, type FabricObject, Group, Rect } from "fabric/es";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorDocument } from "./editor-document.js";
import { createEditorShellBridge } from "./editor-shell/bridge.js";
import { mountEditorShell } from "./editor-shell.js";
import { LiveRuntime } from "./live-runtime.js";
import { createNewFabricTheme } from "./new-fabric-theme.js";
import { PersistenceManager } from "./persistence-manager/index.js";

// jsdom cannot drawImage an undecoded img inside Fabric's render pass; a proxy
// over a real context forwards everything, no-ops only drawImage, and swallows
// Fabric's node-canvas-only `patternQuality` writes.
beforeEach(() => {
  const real = document.createElement("canvas").getContext("2d");
  if (real !== null) {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () =>
        new Proxy(real, {
          get(target, property) {
            if (property === "drawImage") return (): void => {};
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
          set(target, property, value) {
            if (property === "patternQuality") return true;
            return Reflect.set(target, property, value);
          },
        }) as unknown as CanvasRenderingContext2D,
    );
  }
});

/** The shell a case mounted, so a case that throws before its own `destroy()`
 *  does not leak it — canvas, listeners and the `window` entry
 *  `mountEditorShell` publishes — into the next case, which then fails on the
 *  previous case's leak rather than on its own subject (`vg-414`). */
let live: Awaited<ReturnType<typeof mountEditorShell>> | null = null;

async function mount(
  options: Parameters<typeof mountEditorShell>[0],
): Promise<Awaited<ReturnType<typeof mountEditorShell>>> {
  const shell = await mountEditorShell(options);
  live = shell;
  return shell;
}

afterEach(() => {
  live?.destroy();
  live = null;
});

/** Fabric objects at any depth: the starter's cards are groups, so a walk that
 *  stops at the canvas sees ten objects and none of the readings. */
function objectsDeep(root: readonly FabricObject[]): readonly FabricObject[] {
  const walk = (list: readonly FabricObject[]): readonly FabricObject[] =>
    list.flatMap((object) =>
      object instanceof Group
        ? [object, ...walk(object.getObjects())]
        : [object],
    );
  return walk(root);
}

function objectDeepById(
  canvas: { getObjects(): FabricObject[] },
  id: string,
): FabricObject | undefined {
  return objectsDeep(canvas.getObjects()).find(
    (object) => object.get("id") === id,
  );
}

/** Every object in a serialised scene, at any depth. */
function sceneNodes(
  objects: readonly Record<string, unknown>[],
): ReadonlyArray<Record<string, unknown>> {
  const walk = (
    list: readonly Record<string, unknown>[],
  ): Record<string, unknown>[] =>
    list.flatMap((object) => [
      object,
      ...walk(
        Array.isArray(object.objects)
          ? (object.objects as Record<string, unknown>[])
          : [],
      ),
    ]);
  return walk(objects);
}

function sceneIds(scene: { objects: readonly unknown[] }): readonly string[] {
  return sceneNodes(scene.objects as readonly Record<string, unknown>[]).map(
    (object) => String(object.id),
  );
}

describe("a binding cannot outlive its object", () => {
  it("drops the binding when the object is deleted, so saving still works", async () => {
    // The worst defect on the pass: a binding is keyed by its object's id, so a
    // delete left a key naming something the scene no longer had, `snapshot`
    // produced a document the validator refuses, and **every later save in that
    // session threw** — with nothing in the UI saying so. The Starter binds 25
    // of its 52 objects, so deleting one readout disarmed saving for good.
    const host = document.createElement("div");
    Object.defineProperties(host, {
      clientWidth: { value: 800 },
      clientHeight: { value: 600 },
    });
    const authored = createNewFabricTheme();
    const shell = await mount({
      host,
      artboard: authored.artboard,
      envelope: {
        ...authored,
        bindings: { "network-up": [{ id: "b1", semanticKey: "network.up" }] },
      },
    });
    const bound = objectDeepById(shell.editor.canvas, "network-up");
    expect(bound).toBeDefined();

    shell.snapshot({ ...authored });
    // It lives in a card, so it leaves through its group rather than the canvas.
    const owner = bound!.parent;
    if (!(owner instanceof Group))
      throw new Error("the readout is not inside a card group");
    owner.remove(bound!);
    expect(owner.getObjects()).not.toContain(bound);

    // The half that matters: this threw before, and a throw here means the
    // author's save fails for the rest of the session.
    const after = shell.snapshot({ ...authored }) as unknown as {
      bindings?: Record<string, unknown>;
      scene: { objects: readonly unknown[] };
    };
    expect(sceneIds(after.scene)).not.toContain("network-up");
    // Only the deleted one goes. The Starter's other 24 bindings still name
    // objects that are there, and dropping those would take readings with them.
    expect(Object.keys(after.bindings ?? {})).not.toContain("network-up");
    expect(Object.keys(after.bindings ?? {}).length).toBe(
      Object.keys(authored.bindings ?? {}).length - 1,
    );
  });
});

describe("the one walk a reference question reads", () => {
  /** `vg-367`: `dropDanglingBindings` and `assetReferencedBy` answer different
   *  questions about the same scene, and both need every object at any depth.
   *  The second spelling of that walk is what this pins: a copy that stopped at
   *  the canvas, or at the first group, drops this binding on save while the
   *  object it names is still on the canvas. */
  it("keeps a binding whose object sits two groups down", async () => {
    const host = document.createElement("div");
    Object.defineProperties(host, {
      clientWidth: { value: 800 },
      clientHeight: { value: 600 },
    });
    const authored = createNewFabricTheme();
    const shell = await mount({
      host,
      artboard: authored.artboard,
      envelope: authored,
    });
    const deep = new Rect({ left: 0, top: 0, width: 10, height: 10 });
    deep.set("id", "deep-readout");
    const sibling = new Rect({ width: 10, height: 10 });
    sibling.set("id", "deep-sibling");
    const inner = new Group([deep]);
    inner.set("id", "inner-card");
    const outer = new Group([inner, sibling]);
    outer.set("id", "outer-card");
    shell.editor.canvas.add(outer);

    const after = shell.snapshot({
      ...authored,
      bindings: { "deep-readout": [{ id: "b1", semanticKey: "network.up" }] },
    }) as unknown as {
      bindings?: Record<string, unknown>;
      scene: { objects: readonly unknown[] };
    };

    expect(sceneIds(after.scene)).toContain("deep-readout");
    expect(Object.keys(after.bindings ?? {})).toContain("deep-readout");
  });

  /** `vg-365`: eligibility and the two managers that refuse a locked selection
   *  answer one question — is this selection one they accept. Nothing forced
   *  them to agree, so this drives both through their real objects: a
   *  re-spelled lock test on either side, or a manager whose refusal moved,
   *  turns one of these eight assertions red. */
  it("offers no locking action the copying or deleting manager refuses", async () => {
    const host = document.createElement("div");
    Object.defineProperties(host, {
      clientWidth: { value: 800 },
      clientHeight: { value: 600 },
    });
    const authored = createNewFabricTheme();
    const shell = await mount({
      host,
      artboard: authored.artboard,
      envelope: authored,
    });
    const bridge = createEditorShellBridge({
      editor: shell.editor,
      session: { subscribeDocumentChange: () => () => undefined } as never,
      capture: () => undefined,
    });
    const object = new Rect({ left: 0, top: 0, width: 20, height: 20 });
    object.set("id", "eligibility-probe");
    shell.editor.canvas.add(object);
    shell.editor.canvas.setActiveObject(object);
    expect(shell.editor.canvas.getActiveObject()).toBe(object);

    expect(isLocked(object)).toBe(false);
    for (const id of ["copy", "cut", "duplicate", "delete"] as const)
      expect([id, bridge.can(id)]).toEqual([id, true]);
    expect(await shell.editor.clipboardManager.copy()).toBe(true);

    shell.editor.objectLockManager.lockObject();
    expect(isLocked(object)).toBe(true);

    for (const id of ["copy", "cut", "duplicate", "delete"] as const)
      expect([id, bridge.can(id)]).toEqual([id, false]);
    expect(await shell.editor.clipboardManager.copy()).toBe(false);
    expect(shell.editor.deletionManager.deleteActive()).toBe(false);

    bridge.destroy();
  });
});

describe("the dirty guard and what the renderer paints", () => {
  /** The instrument that found this: one live pass, then count the non-empty
   *  `styles` tables on the canvas — the snapshot cannot carry them any more,
   *  because `serialiseScene` strips the derived table (`vg-129`). */
  it("is not made dirty by a reading being painted", async () => {
    const host = document.createElement("div");
    Object.defineProperties(host, {
      clientWidth: { value: 800 },
      clientHeight: { value: 600 },
    });
    const authored = createNewFabricTheme();
    const shell = await mount({
      host,
      artboard: authored.artboard,
      envelope: authored,
    });
    shell.setGlobals(authored.globals);

    const objects = ((
      authored.scene as {
        objects?: {
          id?: string;
          objects?: unknown[];
          yunariText?: { runs?: { bindingId?: string }[] };
        }[];
      }
    ).objects ?? []) as ReadonlyArray<{
      id?: string;
      objects?: unknown[];
      yunariText?: { runs?: { bindingId?: string }[] };
    }>;
    const bindings: Record<string, unknown[]> = {};
    const readRuns = (object: (typeof objects)[number]): void => {
      const runs = (object.yunariText?.runs ?? []).filter(
        (run) => run.bindingId,
      );
      if (object.id && runs.length > 0) {
        bindings[object.id] = runs.map((run) => ({
          id: `${object.id}-${run.bindingId}`,
          semanticKey: run.bindingId!,
        }));
      }
      // The readings live inside the card groups, so the harness has to read
      // them there: a walk that stopped at the canvas would find no bound
      // object at all and would be asserting against an empty set.
      for (const child of (object.objects ?? []) as typeof objects) {
        readRuns(child);
      }
    };
    for (const object of objects) readRuns(object);
    expect(
      Object.keys(bindings).length,
      "no bound object was found, so the reading pass proved nothing",
    ).toBeGreaterThan(0);

    const manager = new PersistenceManager(shell.snapshot({ ...authored }), {});

    // The instrument for "the renderer moved" reads the live canvas, not a
    // snapshot: the per-character `styles` table Fabric writes while it paints
    // a run is derived state, and `removeDerivedTextStyles` takes it off on the
    // way into a document, so only the canvas itself still shows it.
    const paintedStyles = (): number =>
      objectsDeep(shell.editor.canvas.getObjects()).filter((object) => {
        const styles = (
          object as unknown as { styles?: Record<string, unknown> }
        ).styles;
        return styles !== undefined && Object.keys(styles).length > 0;
      }).length;
    const beforePass = paintedStyles();

    new LiveRuntime({
      canvas: shell.editor.canvas,
      bindings: bindings as never,
      source: createDemoSource(Date.now()),
      ...(authored.globals === undefined ? {} : { globals: authored.globals }),
    }).refresh();

    // The canvas has genuinely moved — a reading is now painted on it.
    expect(
      paintedStyles(),
      "the pass painted no reading, so the dirty check below proved nothing",
    ).toBeGreaterThan(beforePass);

    // ...and the document has not, because a reading is not an edit. Without
    // this the Starter is reported as edited the moment it opens and every New
    // asks to save work nobody did.
    expect(manager.isDirty(shell.snapshot({ ...authored }), {})).toBe(false);

    // The half that matters: an edit the author made is still an edit.
    const edited = shell.snapshot({ ...authored });
    const moved = (edited.scene as { objects: { left: number }[] }).objects;
    if (moved?.[0] !== undefined) moved[0].left += 5;
    expect(manager.isDirty(edited, {})).toBe(true);
  });
});

describe("native editor shell", () => {
  it("mounts direct Fabric text mechanics", async () => {
    const host = document.createElement("div");
    Object.defineProperties(host, {
      clientWidth: { value: 400 },
      clientHeight: { value: 300 },
    });

    const shell = await mount({
      host,
      artboard: { width: 100, height: 100 },
    });
    const text = shell.editor.textManager.addText({ text: "Native" });

    expect(host.querySelector("canvas")).not.toBeNull();
    expect(shell.editor.canvas.getActiveObject()).toBe(text);
  });

  it("exposes the mounted editor on window for devtools/e2e access, and removes it on destroy", async () => {
    const host = document.createElement("div");
    Object.defineProperties(host, {
      clientWidth: { value: 400 },
      clientHeight: { value: 300 },
    });

    const shell = await mount({
      host,
      artboard: { width: 100, height: 100 },
    });
    const entry = Object.entries(
      window as unknown as Record<string, unknown>,
    ).find(([key]) => key.startsWith("yunari-fabric-editor-"));

    expect(entry?.[1]).toBe(shell.editor);

    shell.destroy();

    expect(
      entry === undefined
        ? undefined
        : (window as unknown as Record<string, unknown>)[entry[0]],
    ).toBeUndefined();
  });

  it("records a completed drag in history so undo restores the prior position", async () => {
    const host = document.createElement("div");
    Object.defineProperties(host, {
      clientWidth: { value: 400 },
      clientHeight: { value: 300 },
    });

    const shell = await mount({
      host,
      artboard: { width: 100, height: 100 },
    });
    const text = shell.editor.textManager.addText({ text: "Native", left: 5 });

    text.set("left", 90);
    shell.editor.canvas.fire("object:modified", { target: text });
    await shell.editor.historyManager.undo();

    const revived = shell.editor.canvas
      .getObjects()
      .find((object) => object.get("id") === text.get("id"));
    expect(revived?.left).toBe(5);
  });

  it("keeps an open crop frame out of the serialised scene", async () => {
    const host = document.createElement("div");
    Object.defineProperties(host, {
      clientWidth: { value: 400 },
      clientHeight: { value: 300 },
    });
    const shell = await mount({
      host,
      artboard: { width: 400, height: 300 },
    });
    const element = document.createElement("img");
    Object.defineProperty(element, "naturalWidth", { value: 100 });
    Object.defineProperty(element, "naturalHeight", { value: 100 });
    const image = new FabricImage(element, { id: "image-1" });
    image.set({ width: 100, height: 100 });
    shell.editor.canvas.add(image);
    shell.editor.canvas.setActiveObject(image);

    expect(shell.editor.cropManager.begin()).toBe(true);
    const scene = serialiseScene(shell.editor.canvas);

    expect(scene.objects).toHaveLength(1);
    expect(scene.objects[0]?.["id"]).toBe("image-1");

    shell.destroy();
    live = null;
    host.remove();
  });

  it("carries an object's display name in the scene, not in editor metadata", async () => {
    const host = document.createElement("div");
    Object.defineProperties(host, {
      clientWidth: { value: 400 },
      clientHeight: { value: 300 },
    });
    const shell = await mount({
      host,
      artboard: { width: 100, height: 100 },
    });
    const input = {
      id: "theme",
      artboard: { width: 100, height: 100 },
      metadata: { themeLanguage: "en" },
    };
    const panel = new Rect({ id: "header", width: 40, height: 20 });
    panel.set("name", "Header rule");
    shell.editor.canvas.add(panel);

    const saved = shell.snapshot(input);
    // The name is authored document state on the object, so it travels in the
    // scene. An editor-metadata side map would be a second owner of the same
    // label, free to disagree with what the layer list prints.
    expect(saved.editorMetadata).toBeUndefined();
    expect(serialiseScene(shell.editor.canvas).objects[0]?.["name"]).toBe(
      "Header rule",
    );

    shell.destroy();
    live = null;
    host.remove();

    // Reopening the saved envelope is what makes the name durable; keeping it
    // only on the live object would pass every assertion above.
    const reopened = await mount({
      host: document.createElement("div"),
      artboard: { width: 100, height: 100 },
      envelope: saved,
    });
    expect(objectName(reopened.editor.canvas.getObjects()[0] as Rect)).toBe(
      "Header rule",
    );
    reopened.destroy();
  });

  it("exposes a camera over the mounted canvas", async () => {
    const host = document.createElement("div");
    Object.defineProperty(host, "clientWidth", { value: 1000 });
    Object.defineProperty(host, "clientHeight", { value: 400 });
    document.body.append(host);
    const shell = await mount({
      host,
      artboard: { width: 1280, height: 720 },
    });
    expect(shell.editor.viewport.zoom()).toBeGreaterThan(0);
    // The canvas fills the host, not the artboard: a canvas sized to the
    // artboard would be 711 wide at this host's fit scale; it must fill the
    // host instead.
    expect(shell.editor.canvas.getWidth()).toBe(1000);
    expect(shell.editor.canvas.getHeight()).toBe(400);
  });
});

const ARTBOARD = { width: 100, height: 100 } as const;

/** The shell derives its background from the document, so a case about it
 *  authors one rather than the artboard that no longer carries it. The palette
 *  token is what the validator requires a background colour to name. */
function envelopeWith(
  background: Background,
  assets: readonly AssetReference[] = [],
): NonNullable<Parameters<typeof mountEditorShell>[0]["envelope"]> {
  return {
    schemaVersion: 2,
    fabricVersion: "7.4.0",
    id: "background-probe",
    artboard: ARTBOARD,
    background,
    globals: {
      palette: {
        none: { name: "None", value: { kind: "solid", color: "transparent" } },
        ink: { name: "Ink", value: { kind: "solid", color: "#112233" } },
      },
    },
    assets,
    metadata: { themeLanguage: "en" },
    scene: { version: "7.4.0", objects: [] },
  } as unknown as NonNullable<
    Parameters<typeof mountEditorShell>[0]["envelope"]
  >;
}

describe("the background layer", () => {
  it("paints the background colour on the host and sizes the media layer", async () => {
    const host = document.createElement("div");
    Object.defineProperties(host, {
      clientWidth: { value: 400 },
      clientHeight: { value: 300 },
    });
    const assets = [
      { id: "loop", kind: "video" as const, path: "assets/loop.webm" },
    ];
    const shell = await mount({
      host,
      artboard: ARTBOARD,
      envelope: envelopeWith(
        {
          color: { ref: "palette.ink" },
          media: { assetId: "loop", bounds: "theme" },
        },
        assets,
      ),
      resolveAsset: () => ({ url: "blob:loop" }),
    });

    expect(host.style.background).toBe("rgb(17, 34, 51)");
    expect(host.querySelector("[data-yunari-background-media]")).toBeTruthy();
    shell.destroy();
  });

  it("setBackground re-paints without remounting the scene", async () => {
    const host = document.createElement("div");
    Object.defineProperties(host, {
      clientWidth: { value: 400 },
      clientHeight: { value: 300 },
    });
    const shell = await mount({ host, artboard: ARTBOARD });
    const before = host.querySelector("canvas");
    expect(
      before,
      "the scene mounted before the background moved",
    ).not.toBeNull();

    shell.setBackground({ color: { value: "#445566" } });

    expect(host.querySelector("canvas")).toBe(before);
    expect(host.style.background).toBe("rgb(68, 85, 102)");
    shell.destroy();
  });

  it("keeps the media element across a board-size change", async () => {
    // The document used to re-run `refreshBackgroundMedia` on every artboard
    // change, which destroys and remounts the layer — so a background video
    // restarted on a ratio change even though no asset declaration moved. The
    // shell re-places the layer itself now, so what this pins is that the
    // document does not remount it behind the shell's back.
    const host = document.createElement("div");
    Object.defineProperties(host, {
      clientWidth: { value: 400 },
      clientHeight: { value: 300 },
    });
    const assets = [
      { id: "loop", kind: "video" as const, path: "assets/loop.webm" },
    ];
    const envelope = envelopeWith(
      { media: { assetId: "loop", bounds: "theme" } },
      assets,
    );
    const shell = await mount({
      host,
      artboard: ARTBOARD,
      envelope,
      assets,
      resolveAsset: () => ({ url: "blob:loop" }),
    });
    const themeDocument = new EditorDocument({
      source: {
        shell,
        envelope,
        assetManager: {
          assets: {},
          declarations: assets,
          backgroundSource: () => ({ url: "blob:loop" }),
        } as never,
        onNew: async () => undefined,
        onNewFromStarter: async () => undefined,
        onSaved: () => undefined,
      },
      consumers: { artboard: () => ({ render: () => undefined }) } as never,
    });
    const before = host.querySelector("[data-yunari-background-media] video");
    expect(before, "the media layer mounted").not.toBeNull();

    themeDocument.setArtboard({ width: 160, height: 120 });

    expect(
      host.querySelector("[data-yunari-background-media] video"),
      "a board-size change is not a reason to restart the video",
    ).toBe(before);
    themeDocument.destroy();
    shell.destroy();
  });
});

describe("editor background media", () => {
  /** `requestVideoFrameCallback` is the media's frame cadence, and the editor
   *  has to ride it: the video is a DOM sibling Fabric never sees. Counting the
   *  schedules is how a *remount* that lost the subscription shows up - the
   *  session performs one during mount, so an update-only test never sees it. */
  function trackVideoFrames(): { count: number; restore: () => void } {
    const proto = HTMLVideoElement.prototype as unknown as {
      requestVideoFrameCallback: (cb: () => void) => number;
      cancelVideoFrameCallback: (handle: number) => void;
    };
    const had = "requestVideoFrameCallback" in proto;
    const tracker = { count: 0 };
    proto.requestVideoFrameCallback = () => {
      tracker.count += 1;
      return tracker.count;
    };
    proto.cancelVideoFrameCallback = () => {};
    return {
      get count() {
        return tracker.count;
      },
      restore() {
        if (!had) {
          delete (proto as Record<string, unknown>)[
            "requestVideoFrameCallback"
          ];
          delete (proto as Record<string, unknown>)["cancelVideoFrameCallback"];
        }
      },
    };
  }

  it("keeps following video frames across the remount the session performs at start", async () => {
    const frames = trackVideoFrames();
    const host = document.createElement("div");
    Object.defineProperties(host, {
      clientWidth: { value: 400 },
      clientHeight: { value: 300 },
    });
    const video = [
      { id: "loop", kind: "video" as const, path: "assets/loop.webm" },
    ];

    try {
      const shell = await mount({
        host,
        artboard: ARTBOARD,
        envelope: envelopeWith(
          { media: { assetId: "loop", bounds: "theme" } },
          video,
        ),
        assets: video,
        resolveAsset: () => ({ url: "blob:loop" }),
      });
      expect(frames.count, "the first mount follows frames").toBe(1);

      // What the session does during mount: a remount, not an update.
      shell.setBackgroundMedia(video, () => ({ url: "blob:loop" }));
      expect(frames.count, "the remounted layer still follows frames").toBe(2);

      // And an image background, which must start no loop.
      shell.setBackgroundMedia(
        [{ id: "hero", kind: "image", path: "assets/hero.png" }],
        () => ({ url: "blob:hero" }),
      );
      expect(frames.count, "an image starts no loop").toBe(2);
      shell.destroy();
    } finally {
      frames.restore();
    }
  });

  it("repaints when a swapped background image decodes", async () => {
    // The editor's whole reason for the media frame subscription: the layer is
    // a DOM sibling, so a background that arrives after the first paint is
    // invisible to Fabric. A glass panel sampling it keeps an empty backdrop
    // until something asks for a repaint, and nothing else in the scene
    // changes to do it.
    const host = document.createElement("div");
    Object.defineProperties(host, {
      clientWidth: { value: 400 },
      clientHeight: { value: 300 },
    });
    const hero = [
      { id: "hero", kind: "image" as const, path: "assets/hero.png" },
    ];

    const shell = await mount({
      host,
      artboard: ARTBOARD,
      envelope: envelopeWith(
        { media: { assetId: "hero", bounds: "theme" } },
        hero,
      ),
      assets: hero,
      resolveAsset: () => ({ url: "blob:hero" }),
    });
    const canvas = shell.editor.canvas;
    // `requestRenderAll` defers to a rAF, so the request is what is counted,
    // not the render it eventually produces.
    let asked = 0;
    const original = canvas.requestRenderAll.bind(canvas);
    canvas.requestRenderAll = (): void => {
      asked += 1;
      original();
    };

    const image = host.querySelector<HTMLImageElement>(
      "[data-yunari-background-media] img",
    );
    expect(image, "the editor mounted a background image").not.toBeNull();
    expect(asked, "mounting alone asks for nothing").toBe(0);

    image?.dispatchEvent(new Event("load"));
    expect(asked, "the decode reaches the editor's canvas").toBe(1);

    // Once, not a loop: a still image is not a moving thing.
    image?.dispatchEvent(new Event("load"));
    expect(asked, "and it is not a loop").toBe(1);
  });

  it("stops asking for a repaint once the editor is destroyed", async () => {
    // A decode that lands after teardown would ask a canvas the shell has
    // already released to repaint. The listener is on the image element, which
    // outlives `destroy()`, so what is under test is that the repaint stops -
    // not merely that nothing throws, which the DOM reports rather than
    // propagating through `dispatchEvent` and so proves nothing.
    const host = document.createElement("div");
    Object.defineProperties(host, {
      clientWidth: { value: 400 },
      clientHeight: { value: 300 },
    });
    const shell = await mount({
      host,
      artboard: ARTBOARD,
      envelope: envelopeWith({ media: { assetId: "hero", bounds: "theme" } }, [
        { id: "hero", kind: "image", path: "assets/hero.png" },
      ]),
      assets: [{ id: "hero", kind: "image", path: "assets/hero.png" }],
      resolveAsset: () => ({ url: "blob:hero" }),
    });
    const canvas = shell.editor.canvas;
    const image = host.querySelector<HTMLImageElement>(
      "[data-yunari-background-media] img",
    );
    expect(image, "the editor mounted a background image").not.toBeNull();
    let asked = 0;
    const original = canvas.requestRenderAll.bind(canvas);
    canvas.requestRenderAll = (): void => {
      asked += 1;
      original();
    };

    shell.destroy();
    live = null;
    expect(asked, "teardown itself asks for nothing").toBe(0);
    image?.dispatchEvent(new Event("load"));
    expect(asked, "and a decode afterwards asks for nothing").toBe(0);
  });
});

describe("one resize path on the host", () => {
  /** Records every observer the shell builds, so the count of registrations on
   * the host is observable rather than inferred. jsdom has no ResizeObserver, so
   * without this the code takes its `typeof === "undefined"` branch and the
   * whole subject of the test would silently not exist. */
  function recordObservers(): {
    onHost: (host: HTMLElement) => number;
    notifyHost: (host: HTMLElement) => void;
    restore: () => void;
  } {
    const registrations: { target: Element; notify: () => void }[] = [];
    const original = globalThis.ResizeObserver;
    class RecordingResizeObserver {
      constructor(private readonly callback: () => void) {}
      observe(target: Element): void {
        registrations.push({ target, notify: this.callback });
      }
      unobserve(): void {}
      disconnect(): void {}
    }
    globalThis.ResizeObserver =
      RecordingResizeObserver as unknown as typeof ResizeObserver;
    return {
      onHost: (host) => registrations.filter((r) => r.target === host).length,
      notifyHost: (host) => {
        for (const registration of registrations.filter(
          (r) => r.target === host,
        ))
          registration.notify();
      },
      restore: () => {
        globalThis.ResizeObserver = original as typeof ResizeObserver;
      },
    };
  }

  it("observes the host once, and one host resize is one camera change", async () => {
    // Two `ResizeObserver`s were registered on the same host, each calling the
    // same `viewport.resize()`. It was invisible because the refit is derived
    // and idempotent: the second call reads the box the first one had already
    // written, decides "still fitted", and fits again to the same place. So the
    // count, not the canvas, is what has to be asserted.
    const host = document.createElement("div");
    const size = { width: 800, height: 600 };
    Object.defineProperties(host, {
      clientWidth: { get: () => size.width },
      clientHeight: { get: () => size.height },
    });
    const observers = recordObservers();
    const shell = await mount({
      host,
      artboard: { width: 1280, height: 720 },
    });
    observers.restore();

    const changed = vi.fn();
    const off = shell.editor.viewport.onChange(changed);
    size.width = 600;
    observers.notifyHost(host);
    off();

    expect(observers.onHost(host), "resize paths on the host").toBe(1);
    expect(changed, "camera changes per host resize").toHaveBeenCalledTimes(1);
  });

  it("still refits a fitted camera when the host resizes", async () => {
    // The half that must not be lost with the duplicate: the observer that
    // stays is the one that decides whether a resize refits, and it decides it
    // from the box the camera was framed in rather than the new one.
    const host = document.createElement("div");
    const size = { width: 1600, height: 900 };
    Object.defineProperties(host, {
      clientWidth: { get: () => size.width },
      clientHeight: { get: () => size.height },
    });
    const observers = recordObservers();
    const shell = await mount({
      host,
      artboard: { width: 1280, height: 720 },
    });
    observers.restore();

    const fitted = shell.editor.viewport.zoom();
    size.width = 800;
    observers.notifyHost(host);

    expect(
      shell.editor.viewport.zoom(),
      "a fitted camera follows its host",
    ).toBeLessThan(fitted);
    expect(
      shell.editor.canvas.getWidth(),
      "and the canvas took the host' new box",
    ).toBe(800);
  });
});
