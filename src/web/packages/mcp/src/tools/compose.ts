import type { CallToolResult } from "@modelcontextprotocol/server";
import type { Binding } from "@yunari/renderer-core";
import {
  addChartObject,
  addIconObject,
  addImageObject,
  addSceneObject,
  addShapeObject,
  addTextObject,
  CARD_LIBRARY,
  instantiateCard,
  listSceneObjects,
  type ObjectJson,
  type Run,
  removeSceneObject,
  type StarterPaletteId,
  setBindings,
  starterIcons,
  starterPalette,
  updateSceneObject,
} from "@yunari/theme-kit";
import type { Draft, ToolContext } from "../types.js";
import { draftFor } from "./draft.js";
import { jsonAttempt } from "./result.js";

interface SceneRecord {
  readonly version?: unknown;
  readonly objects?: readonly ObjectJson[];
}

function sceneOf(envelope: Draft["envelope"]): {
  readonly scene: SceneRecord;
  readonly objects: readonly ObjectJson[];
} {
  const scene = envelope.scene as unknown as SceneRecord;
  return {
    scene,
    objects: Array.isArray(scene.objects) ? scene.objects : [],
  };
}

function tokenOf(token: string | undefined, fallback: StarterPaletteId) {
  const id = token ?? fallback;
  if (!(id in starterPalette)) {
    throw new Error(
      `"${id}" is not a palette token this build can paint with (${Object.keys(starterPalette).join(", ")}).`,
    );
  }
  return id as StarterPaletteId;
}

function bindingIdsOf(envelope: Draft["envelope"]): string[] {
  return Object.values(envelope.bindings ?? {}).flatMap((list) =>
    list.map((binding) => binding.id),
  );
}

/** The zod-validated shape of a semantic binding, before the kit's own type. */
export interface BindingInput {
  readonly id: string;
  readonly semanticKey: string;
  readonly precision?: number | undefined;
  readonly unitDisplay?: "none" | "short" | "long" | undefined;
  readonly scale?: number | undefined;
  readonly offset?: number | undefined;
  readonly unit?: string | undefined;
  readonly autoScale?: boolean | undefined;
  readonly format?: string | undefined;
  readonly timeZone?: string | undefined;
}

interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

function added(
  draft: Draft,
  object: ObjectJson,
  bindings?: readonly Binding[] | Readonly<Record<string, readonly Binding[]>>,
): { themeId: string; ids: readonly string[] } {
  const result = addSceneObject(draft.envelope, object, bindings);
  draft.envelope = result.envelope;
  return { themeId: draft.id, ids: result.ids };
}

export async function addCard(
  context: ToolContext,
  input: {
    readonly unit: string;
    readonly left: number;
    readonly top: number;
    readonly scale?: number | undefined;
    readonly themeId?: string | undefined;
  },
): Promise<CallToolResult> {
  return await jsonAttempt(() => {
    const unit = CARD_LIBRARY.find((candidate) => candidate.id === input.unit);
    if (unit === undefined) {
      throw new Error(
        `There is no card unit "${input.unit}" (${CARD_LIBRARY.map((candidate) => candidate.id).join(", ")}).`,
      );
    }
    const draft = draftFor(context, input.themeId);
    const copy = instantiateCard({
      unit,
      globals: draft.envelope.globals,
      existingIds: listSceneObjects(draft.envelope).map((entry) => entry.id),
      existingBindingIds: bindingIdsOf(draft.envelope),
      origin: { left: input.left, top: input.top },
    });
    const result = added(draft, copy.card, copy.bindings);
    if (input.scale !== undefined && input.scale !== 1) {
      const rootId = result.ids[0];
      if (rootId !== undefined) {
        draft.envelope = updateSceneObject(draft.envelope, rootId, {
          scaleX: input.scale,
          scaleY: input.scale,
        });
      }
    }
    return {
      ...result,
      issues: copy.issues,
      substitutions: copy.substitutions,
    };
  });
}

export async function addText(
  context: ToolContext,
  input: {
    readonly box: Box;
    readonly runs: readonly {
      readonly kind?: "literal" | "value" | undefined;
      readonly bindingId?: string | undefined;
      readonly text?: string | undefined;
      readonly token?: string | undefined;
      readonly size: number;
      readonly precision?: number | undefined;
      readonly unitDisplay?: "none" | "short" | "long" | undefined;
    }[];
    readonly align?: "left" | "center" | "right" | undefined;
    readonly verticalAlign?: "top" | "middle" | "bottom" | undefined;
    readonly overflow?: "clip" | "ellipsis" | "visible" | undefined;
    readonly bindings?: readonly BindingInput[] | undefined;
    readonly themeId?: string | undefined;
  },
): Promise<CallToolResult> {
  return await jsonAttempt(() => {
    const draft = draftFor(context, input.themeId);
    const bindings = input.bindings ?? [];
    const bindingIds = new Set(bindings.map((binding) => binding.id));
    const runs: Run[] = input.runs.map((run) => {
      const kind =
        run.kind ?? (run.bindingId === undefined ? "literal" : "value");
      if (kind === "value") {
        if (run.bindingId === undefined || !bindingIds.has(run.bindingId)) {
          throw new Error(
            `A value run reads binding "${run.bindingId ?? ""}", which is not in this tool's bindings.`,
          );
        }
      }
      return {
        kind,
        ...(run.bindingId === undefined ? {} : { bindingId: run.bindingId }),
        ...(run.text === undefined ? {} : { text: run.text }),
        token: tokenOf(run.token, "text"),
        size: run.size,
        ...(run.precision === undefined ? {} : { precision: run.precision }),
        ...(run.unitDisplay === undefined
          ? {}
          : { unitDisplay: run.unitDisplay }),
      } as Run;
    });
    const built = addTextObject({
      id: "text",
      ...input.box,
      runs,
      ...(input.align === undefined ? {} : { align: input.align }),
      ...(input.verticalAlign === undefined
        ? {}
        : { verticalAlign: input.verticalAlign }),
      ...(input.overflow === undefined ? {} : { overflow: input.overflow }),
      ...(bindings.length === 0
        ? {}
        : { bindings: bindings as readonly Binding[] }),
    });
    return added(draft, built.object, built.bindings);
  });
}

export async function addShape(
  context: ToolContext,
  input: {
    readonly kind: "rect" | "ellipse" | "path";
    readonly box: Box;
    readonly token?: string | undefined;
    readonly radius?: number | undefined;
    readonly points?: readonly (readonly (string | number)[])[] | undefined;
    readonly strokeWidth?: number | undefined;
    readonly themeId?: string | undefined;
  },
): Promise<CallToolResult> {
  return await jsonAttempt(() => {
    const draft = draftFor(context, input.themeId);
    if (input.kind === "path" && input.points === undefined) {
      throw new Error("A path shape needs its own commands.");
    }
    const points = input.points?.map((command) => {
      if (typeof command[0] !== "string") {
        throw new Error("Every path command starts with its letter.");
      }
      return command as readonly [string, ...number[]];
    });
    const object = addShapeObject({
      id: "shape",
      kind: input.kind,
      ...input.box,
      ...(input.token === undefined
        ? {}
        : { token: tokenOf(input.token, "panel") }),
      ...(input.radius === undefined ? {} : { radius: input.radius }),
      ...(points === undefined ? {} : { points }),
      ...(input.strokeWidth === undefined
        ? {}
        : { strokeWidth: input.strokeWidth }),
    });
    return added(draft, object);
  });
}

export async function addImage(
  context: ToolContext,
  input: {
    readonly assetId: string;
    readonly box: Box;
    readonly fit?: "cover" | "contain" | undefined;
    readonly themeId?: string | undefined;
  },
): Promise<CallToolResult> {
  return await jsonAttempt(() => {
    const draft = draftFor(context, input.themeId);
    const asset = (draft.envelope.assets ?? []).find(
      (candidate) => candidate.id === input.assetId,
    );
    if (asset === undefined) {
      throw new Error(
        `There is no asset "${input.assetId}" in this theme; import_asset it first.`,
      );
    }
    if (asset.kind === "font") {
      throw new Error(`"${asset.id}" is a font, not an image.`);
    }
    const object = addImageObject({
      id: "image",
      assetId: asset.id,
      kind: asset.kind,
      ...input.box,
    });
    return {
      ...added(draft, object),
      // Fabric stretches an image to its authored box; this build has no
      // persisted fit property, so the note states what the box means.
      ...(input.fit === undefined
        ? {}
        : {
            note: "Images fill their authored box; fit has no scene property.",
          }),
    };
  });
}

export async function addIcon(
  context: ToolContext,
  input: {
    readonly icon: string;
    readonly box: Box;
    readonly token?: string | undefined;
    readonly themeId?: string | undefined;
  },
): Promise<CallToolResult> {
  return await jsonAttempt(() => {
    if (!(input.icon in starterIcons)) {
      throw new Error(
        `There is no icon "${input.icon}" in the shared icon set (${Object.keys(starterIcons).join(", ")}).`,
      );
    }
    const draft = draftFor(context, input.themeId);
    const object = addIconObject({
      id: "icon",
      icon: input.icon as keyof typeof starterIcons,
      left: input.box.left,
      top: input.box.top,
      size: Math.min(input.box.width, input.box.height),
      ...(input.token === undefined
        ? {}
        : { token: tokenOf(input.token, "text") }),
    });
    return added(draft, object);
  });
}

export async function addChart(
  context: ToolContext,
  input: {
    readonly family: "line" | "bar" | "gauge";
    readonly box: Box;
    readonly binding?: BindingInput | undefined;
    readonly bindings?: readonly BindingInput[] | undefined;
    readonly settings?: unknown;
    readonly themeId?: string | undefined;
  },
): Promise<CallToolResult> {
  return await jsonAttempt(() => {
    const bindings = [
      ...(input.binding === undefined ? [] : [input.binding]),
      ...(input.bindings ?? []),
    ];
    if (bindings.length === 0) {
      throw new Error("A chart needs at least one binding.");
    }
    const draft = draftFor(context, input.themeId);
    const built = addChartObject({
      id: "chart",
      ...input.box,
      family: input.family,
      bindings: bindings as readonly Binding[],
      ...(input.settings === undefined ? {} : { settings: input.settings }),
    });
    return added(draft, built.object, built.bindings);
  });
}

export async function addBinding(
  context: ToolContext,
  objectId: string,
  bindings: readonly BindingInput[],
  themeId?: string | undefined,
): Promise<CallToolResult> {
  return await jsonAttempt(() => {
    const draft = draftFor(context, themeId);
    if (!listSceneObjects(draft.envelope).some((o) => o.id === objectId)) {
      throw new Error(`There is no object "${objectId}" in this scene.`);
    }
    const taken = new Map<string, string>();
    for (const [owner, list] of Object.entries(draft.envelope.bindings ?? {})) {
      for (const binding of list) taken.set(binding.id, owner);
    }
    const incoming = new Set<string>();
    for (const binding of bindings) {
      const owner = taken.get(binding.id);
      if (owner !== undefined && owner !== objectId) {
        throw new Error(
          `Binding id "${binding.id}" already belongs to object "${owner}".`,
        );
      }
      if (incoming.has(binding.id)) {
        throw new Error(`Binding id "${binding.id}" is repeated.`);
      }
      incoming.add(binding.id);
    }
    draft.envelope = setBindings(
      draft.envelope,
      objectId,
      bindings as readonly Binding[],
    );
    return { themeId: draft.id, objectId, bindings };
  });
}

export async function listObjects(
  context: ToolContext,
  themeId?: string,
): Promise<CallToolResult> {
  return await jsonAttempt(() => {
    const draft = draftFor(context, themeId);
    return {
      themeId: draft.id,
      objects: listSceneObjects(draft.envelope),
      bindings: draft.envelope.bindings ?? {},
      assets: (draft.envelope.assets ?? []).map((asset) => ({
        id: asset.id,
        kind: asset.kind,
        path: asset.path,
      })),
    };
  });
}

const RESERVED_PATCH_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export async function updateObject(
  context: ToolContext,
  objectId: string,
  patch: Readonly<Record<string, unknown>>,
  themeId?: string,
): Promise<CallToolResult> {
  return await jsonAttempt(() => {
    for (const key of Object.keys(patch)) {
      if (RESERVED_PATCH_KEYS.has(key)) {
        throw new Error(`"${key}" is not a field an object patch may write.`);
      }
    }
    if (patch["id"] !== undefined && patch["id"] !== objectId) {
      throw new Error("An object patch cannot change the object's id.");
    }
    const draft = draftFor(context, themeId);
    draft.envelope = updateSceneObject(draft.envelope, objectId, patch);
    return { themeId: draft.id, objectId, patch };
  });
}

export async function removeObject(
  context: ToolContext,
  objectId: string,
  themeId?: string,
): Promise<CallToolResult> {
  return await jsonAttempt(() => {
    const draft = draftFor(context, themeId);
    draft.envelope = removeSceneObject(draft.envelope, objectId);
    return { themeId: draft.id, removed: objectId };
  });
}

function boxOf(object: ObjectJson, id: string) {
  const read = (key: "left" | "top" | "width" | "height"): number => {
    const value = object[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`Object "${id}" has no authored ${key} to group by.`);
    }
    return value;
  };
  return {
    left: read("left"),
    top: read("top"),
    width: read("width"),
    height: read("height"),
  };
}

export async function groupObjects(
  context: ToolContext,
  objectIds: readonly string[],
  themeId?: string,
): Promise<CallToolResult> {
  return await jsonAttempt(() => {
    if (objectIds.length === 0) {
      throw new Error("Grouping needs at least one object id.");
    }
    const draft = draftFor(context, themeId);
    const { scene, objects } = sceneOf(draft.envelope);
    const wanted = new Set(objectIds);
    const roots = new Map(
      objects.flatMap((object) =>
        typeof object["id"] === "string" && wanted.has(object["id"])
          ? [[object["id"], object] as const]
          : [],
      ),
    );
    const nested = new Set(
      listSceneObjects(draft.envelope)
        .map((entry) => entry.id)
        .filter((id) => wanted.has(id) && !roots.has(id)),
    );
    for (const id of wanted) {
      if (roots.has(id)) continue;
      if (nested.has(id)) {
        throw new Error(
          `Object "${id}" is inside another group; ungroup it first.`,
        );
      }
      throw new Error(`There is no object "${id}" in this scene.`);
    }

    const boxes = [...roots].map(([id, object]) => ({
      id,
      box: boxOf(object, id),
    }));
    const minX = Math.min(...boxes.map((entry) => entry.box.left));
    const minY = Math.min(...boxes.map((entry) => entry.box.top));
    const maxX = Math.max(
      ...boxes.map((entry) => entry.box.left + entry.box.width),
    );
    const maxY = Math.max(
      ...boxes.map((entry) => entry.box.top + entry.box.height),
    );
    const centre = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };

    const keep = objects.filter(
      (object) => typeof object["id"] !== "string" || !wanted.has(object["id"]),
    );
    const bindings: Record<string, readonly Binding[]> = {};
    for (const [id, list] of Object.entries(draft.envelope.bindings ?? {})) {
      if (wanted.has(id)) bindings[id] = list;
    }
    const remainingBindings = Object.fromEntries(
      Object.entries(draft.envelope.bindings ?? {}).filter(
        ([key]) => !wanted.has(key),
      ),
    );

    const group: ObjectJson = {
      type: "Group",
      id: "group",
      name: "group",
      left: minX,
      top: minY,
      width: maxX - minX,
      height: maxY - minY,
      originX: "left",
      originY: "top",
      objects: [...roots.values()].map((object) => ({
        ...object,
        left: (object["left"] as number) - centre.x,
        top: (object["top"] as number) - centre.y,
      })),
    };

    const result = addSceneObject(
      {
        ...draft.envelope,
        scene: { ...scene, objects: keep },
        bindings: remainingBindings,
      },
      group,
      bindings,
    );
    draft.envelope = result.envelope;
    return {
      themeId: draft.id,
      groupId: result.ids[0] ?? null,
      ids: result.ids.slice(1),
    };
  });
}

export async function ungroupObjects(
  context: ToolContext,
  groupId: string,
  themeId?: string,
): Promise<CallToolResult> {
  return await jsonAttempt(() => {
    const draft = draftFor(context, themeId);
    const { scene, objects } = sceneOf(draft.envelope);
    const group = objects.find((object) => object["id"] === groupId);
    if (group === undefined) {
      if (listSceneObjects(draft.envelope).some((e) => e.id === groupId)) {
        throw new Error(
          `Object "${groupId}" is not a root group; ungroup its parent first.`,
        );
      }
      throw new Error(`There is no object "${groupId}" in this scene.`);
    }
    if (group["type"] !== "Group") {
      throw new Error(
        `Object "${groupId}" is a ${String(group["type"])}, not a group.`,
      );
    }
    if (
      (group["scaleX"] !== undefined && group["scaleX"] !== 1) ||
      (group["scaleY"] !== undefined && group["scaleY"] !== 1) ||
      (group["angle"] !== undefined && group["angle"] !== 0)
    ) {
      throw new Error(
        `Group "${groupId}" is scaled or rotated; this build only ungroups an untransformed group.`,
      );
    }

    const box = boxOf(group, groupId);
    const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const children = Array.isArray(group["objects"])
      ? (group["objects"] as readonly ObjectJson[])
      : [];
    const lifted: ObjectJson[] = children.map((child) => {
      const left = child["left"];
      const top = child["top"];
      if (typeof left !== "number" || typeof top !== "number") {
        throw new Error(`A child of group "${groupId}" has no authored box.`);
      }
      return {
        ...child,
        left: left + centre.x,
        top: top + centre.y,
      };
    });

    const bindings = Object.fromEntries(
      Object.entries(draft.envelope.bindings ?? {}).filter(
        ([key]) => key !== groupId,
      ),
    );
    const droppedBindings = draft.envelope.bindings?.[groupId]?.length ?? 0;

    draft.envelope = {
      ...draft.envelope,
      scene: {
        ...scene,
        objects: [
          ...objects.filter((object) => object["id"] !== groupId),
          ...lifted,
        ],
      },
      bindings,
    };
    return {
      themeId: draft.id,
      groupId,
      ids: lifted.flatMap((child) =>
        typeof child["id"] === "string" ? [child["id"]] : [],
      ),
      ...(droppedBindings === 0 ? {} : { droppedBindings }),
    };
  });
}
