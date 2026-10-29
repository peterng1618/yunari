import type { PlanBox, PlanNode, ScenePlan } from "@yunari/renderer-core";
import {
  Ellipse,
  FabricImage,
  type FabricObject,
  Group,
  IText,
  Rect,
  type StaticCanvas,
  Textbox,
} from "fabric/es";
import { YunariChart } from "./chart-object.js";
import {
  createNodeObject,
  type NodeContext,
  type UnsupportedReporter,
  updateNodeObject,
} from "./fabric-nodes.js";
import { isTextObject, updateText } from "./fabric-text.js";
import { drawnBox, withinGroup } from "./placement.js";
import { clampRenderScale, DEFAULT_RENDER_SCALE } from "./render-scale.js";

/**
 * Reconcile a pure `ScenePlan` onto existing Fabric objects. Revived scene
 * geometry/order is adopted by id; class changes replace one object, while
 * parent changes rebuild the scene because the object's coordinate space changed.
 */

export interface SceneAdapterOptions {
  /** Player passes `StaticCanvas`; editor may pass interactive `Canvas`. */
  readonly canvas: StaticCanvas;
  readonly renderScale?: number;
  readonly onAssetError?: (nodeId: string, src: string) => void;
  /** Renderer limitations, separate from plan/data issues. */
  readonly onUnsupported?: UnsupportedReporter;
}

export interface SceneAdapter {
  apply(plan: ScenePlan): void;
  setRenderScale(scale: number): void;
  objectFor(nodeId: string): FabricObject | undefined;
  dispose(): void;
}

export function createSceneAdapter(options: SceneAdapterOptions): SceneAdapter {
  const { canvas } = options;
  const objects = new Map<string, FabricObject>();
  const applied = new Map<string, PlanNode>();
  let order: string[] = [];
  /** Undefined until first apply so a revived scene is adopted rather than cleared. */
  let structure: string | undefined;
  /** Last drawn boxes let font loads remeasure text without rebuilding the plan. */
  const boxes = new Map<string, PlanBox>();
  let renderScale = clampRenderScale(
    options.renderScale ?? DEFAULT_RENDER_SCALE,
    1,
    1,
  );

  /**
   * **The party that removes an object disposes it** (`vg-486`).
   *
   * This used to subscribe `canvas.on("object:removed", ({ target }) =>
   * target.dispose())`, because `canvas.remove()` disposes nothing and a chart
   * must release its ECharts instance and backing pixels. **The event carries no
   * intent**, so the listener disposed what *anyone* removed — and
   * `grouping-manager.group()` takes each member off the root with the same
   * `canvas.remove` that a deletion uses, while the member is moving into the new
   * `Group` and the document still holds it. The scene serialized identically
   * either way, which is why the defect was invisible.
   *
   * So disposal is explicit at the three sites below that genuinely remove a
   * node, and every other remover owns its own. `Group.dispose()` cascades into
   * its children, so disposing a root object covers its subtree.
   */

  adoptExisting(canvas, objects);
  const applyArtboard = createApplyArtboard(canvas);

  function context(): NodeContext {
    return {
      renderScale,
      ...(options.onUnsupported === undefined
        ? {}
        : { onUnsupported: options.onUnsupported }),
      ...(options.onAssetError === undefined
        ? {}
        : { onAssetError: options.onAssetError }),
      onDecoded: () => {
        canvas.requestRenderAll();
      },
    };
  }

  function register(nodeId: string, object: FabricObject): void {
    objects.set(nodeId, object);
  }

  /** Restore top-level Fabric z-order to authored plan order. */
  function restack(): void {
    let index = 0;

    for (const nodeId of order) {
      const object = objects.get(nodeId);

      if (object === undefined || object.group !== undefined) {
        continue;
      }

      canvas.moveObjectTo(object, index);
      index += 1;
    }
  }

  function clear(): void {
    // Disposed, not merely removed: this is a rebuild or a teardown, so nothing
    // here is coming back. A root `Group` takes its children with it. The list
    // is copied first because `getObjects()` is the canvas's own array.
    const roots = [...canvas.getObjects()];
    canvas.remove(...roots);
    for (const object of roots) object.dispose();
    objects.clear();
    applied.clear();
    boxes.clear();
  }

  const adapter: SceneAdapter = {
    apply(plan: ScenePlan): void {
      const nodes = [...walk(plan.nodes)];
      const nextStructure = structureKeyFor(nodes);

      if (structure !== undefined && nextStructure !== structure) {
        clear();
      }

      structure = nextStructure;
      order = nodes
        .filter(({ parent }) => parent === undefined)
        .map(({ node }) => node.id);

      applyArtboard(plan);

      for (const { node, parent } of nodes) {
        const existing = reusable(node);
        // Existing grouped children are center-local; `Group.add()` handles this on creation.
        const box =
          parent === undefined
            ? drawnBox(node)
            : withinGroup(drawnBox(node), drawnBox(parent));

        if (existing === undefined) {
          const created = createNodeObject(
            node,
            drawnBox(node),
            context(),
            register,
          );

          if (created !== undefined && parent === undefined) {
            canvas.add(created);
          }
        } else {
          updateNodeObject(
            existing,
            node,
            applied.get(node.id),
            box,
            context(),
          );
        }

        applied.set(node.id, node);
        boxes.set(node.id, box);
      }

      removeStale(nodes);
      restack();
      canvas.requestRenderAll();
    },

    setRenderScale(scale: number): void {
      renderScale = scale;

      for (const object of objects.values()) {
        if (object instanceof YunariChart) {
          object.setRenderScale(scale);
        }
      }

      canvas.requestRenderAll();
    },

    objectFor(nodeId: string): FabricObject | undefined {
      return objects.get(nodeId);
    },

    dispose(): void {
      clear();
      releaseFonts();
      order = [];
      structure = undefined;
    },
  };

  /** Font loads affect text metrics only; avoid replaying charts/the whole plan. */
  function remeasureText(): void {
    for (const [nodeId, object] of objects) {
      const node = applied.get(nodeId);
      const box = boxes.get(nodeId);

      if (node !== undefined && box !== undefined && isTextObject(object)) {
        updateText(object, node, box);
      }
    }

    canvas.requestRenderAll();
  }

  const releaseFonts = watchFontLoads(remeasureText);

  return adapter;

  /** Reuse only when the existing Fabric class still matches the node. */
  function reusable(node: PlanNode): FabricObject | undefined {
    const existing = objects.get(node.id);

    if (existing === undefined || isRightClass(existing, node)) {
      return existing;
    }

    objects.delete(node.id);
    applied.delete(node.id);
    boxes.delete(node.id);

    if (existing.group instanceof Group) {
      existing.group.remove(existing);
      existing.dispose();
    } else {
      canvas.remove(existing);
      existing.dispose();
    }

    return undefined;
  }

  function removeStale(nodes: readonly WalkedNode[]): void {
    const live = new Set(nodes.map(({ node }) => node.id));

    for (const [nodeId, object] of objects) {
      if (live.has(nodeId)) {
        continue;
      }

      objects.delete(nodeId);
      applied.delete(nodeId);
      boxes.delete(nodeId);

      // Group removal does not emit the canvas-level disposal event for children.
      if (object.group instanceof Group) {
        object.group.remove(object);
        object.dispose();
      } else {
        canvas.remove(object);
        object.dispose();
      }
    }
  }
}

/** Apply the artboard **clip**; both the viewport transform and the board's
 * paint belong elsewhere.
 *
 * **The paint is deliberately not applied here.** This canvas sits above
 * the media layer, so a fill on it hides the media completely and leaves the
 * reader no letterbox. `scene.ts` owns the paint and applies it only when there
 * is no media layer for it to cover. */
function createApplyArtboard(canvas: StaticCanvas): (plan: ScenePlan) => void {
  return (plan: ScenePlan): void => {
    const { width, height } = plan.artboard;
    const clip = canvas.clipPath;

    if (clip instanceof Rect) {
      clip.set({ width, height, left: width / 2, top: height / 2 });
    } else {
      canvas.clipPath = new Rect({
        width,
        height,
        left: width / 2,
        top: height / 2,
        originX: "center",
        originY: "center",
        absolutePositioned: true,
      });
    }
  };
}

/** Index revived Fabric objects by persisted Yunari id, including group children. */
function adoptExisting(
  canvas: StaticCanvas,
  objects: Map<string, FabricObject>,
): void {
  const visit = (list: readonly FabricObject[]): void => {
    for (const object of list) {
      const id = object.get("id");

      if (typeof id === "string" && id.length > 0) {
        objects.set(id, object);
      }

      if (object instanceof Group) {
        visit(object.getObjects());
      }
    }
  };

  visit(canvas.getObjects());
}

/** Remeasure canvas text when existing or later-loaded fonts finish loading. */
function watchFontLoads(remeasure: () => void): () => void {
  const fonts = typeof document === "undefined" ? undefined : document.fonts;

  if (fonts === undefined) {
    return () => {};
  }

  let live = true;
  const onLoad = (): void => {
    if (live) {
      remeasure();
    }
  };

  fonts.addEventListener("loadingdone", onLoad);
  void fonts.ready.then(onLoad);

  return () => {
    live = false;
    fonts.removeEventListener("loadingdone", onLoad);
  };
}

interface WalkedNode {
  readonly node: PlanNode;
  readonly parent: PlanNode | undefined;
}

function* walk(
  nodes: readonly PlanNode[],
  parent?: PlanNode,
): Generator<WalkedNode> {
  for (const node of nodes) {
    yield {
      node,
      ...(parent === undefined ? { parent: undefined } : { parent }),
    };
    yield* walk(node.children, node);
  }
}

type FabricObjectClass = abstract new (...args: never[]) => FabricObject;

/** Single mapping from plan content to required Fabric class. */
function classFor(node: PlanNode): FabricObjectClass | undefined {
  switch (node.content.kind) {
    case "group":
      return Group;

    case "shape":
      return node.content.shape === "ellipse" ? Ellipse : Rect;

    case "text":
      // The class is the width mode; the plan's `wrap` is derived from it.
      return node.content.layout.wrap ? Textbox : IText;

    case "chart":
      return YunariChart;

    case "image":
      return FabricImage;

    case "video":
      return undefined;
  }
}

/** Exact constructor equality matters because `Textbox` extends `FabricText`. */
function isRightClass(object: FabricObject, node: PlanNode): boolean {
  return object.constructor === classFor(node);
}

/** Parent/id topology only; class changes are handled per node. */
function structureKeyFor(nodes: readonly WalkedNode[]): string {
  return nodes
    .map(({ node, parent }) => `${parent?.id ?? ""}>${node.id}`)
    .join(",");
}
