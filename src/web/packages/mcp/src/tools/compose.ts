import type { CallToolResult } from "@modelcontextprotocol/server";
import {
  type Binding,
  type FabricPalette,
  isKnownSemanticKey,
} from "@yunari/renderer-core";
import {
  addChartObject,
  addIconObject,
  addImageObject,
  addSceneObject,
  addShapeObject,
  addTextObject,
  adoptPackagedAssets,
  instantiateCard,
  listSceneObjects,
  moveSceneObject,
  type ObjectJson,
  type PackagedWidgetUnit,
  packagedUnits,
  type Run,
  removeSceneObject,
  type SceneStackMove,
  setBindings,
  starterIcons,
  unitAssetDeclarations,
  updateSceneObject,
} from "@yunari/theme-kit";
import {
  readWidgetPackage,
  type WidgetPackageResult,
} from "@yunari/theme-package";
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

/** Every authored id in one subtree, the root included. */
function collectSubtreeIds(object: ObjectJson, into: Set<string>): void {
  const id = object["id"];
  if (typeof id === "string") into.add(id);
  const children = object["objects"];
  if (!Array.isArray(children)) return;
  for (const child of children) {
    if (typeof child === "object" && child !== null && !Array.isArray(child)) {
      collectSubtreeIds(child as ObjectJson, into);
    }
  }
}

function paletteOf(draft: Draft): FabricPalette {
  return draft.envelope.globals?.palette ?? {};
}

function tokenOf(
  token: string | undefined,
  fallback: string,
  palette: FabricPalette,
): string {
  const id = token ?? fallback;
  if (palette[id] === undefined) {
    throw new Error(
      `"${id}" is not a palette token in this theme (${Object.keys(palette).join(", ")}).`,
    );
  }
  return id;
}

/** Refuses a semantic key the renderer's own vocabulary does not declare. */
function checkSemanticKey(key: string): void {
  if (!isKnownSemanticKey(key)) {
    throw new Error(
      `"${key}" is not a semantic key this build knows; call list_sensors to see the keys this host measures.`,
    );
  }
}

function bindingsOf(bindings: readonly BindingInput[]): readonly Binding[] {
  for (const binding of bindings) checkSemanticKey(binding.semanticKey);
  return bindings as readonly Binding[];
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
  envelope: Draft["envelope"] = draft.envelope,
): { themeId: string; ids: readonly string[] } {
  // The caller may hand in an envelope that is not the draft's yet (an insert
  // whose assets must apply with the object). Only a successful build becomes
  // the draft.
  const result = addSceneObject(envelope, object, bindings);
  draft.envelope = result.envelope;
  return { themeId: draft.id, ids: result.ids };
}

/**
 * The unit an insertion names, from the packs the host has installed.
 *
 * **Every listed pack is read**, not only the one whose summary names the id:
 * the summary lists units that may repeat across packs, and `packagedUnits` is
 * the one owner of the duplicate-id rule. A pack that cannot be read is
 * refused rather than skipped, because a skipped pack hides a duplicate.
 */
async function installedUnit(
  context: ToolContext,
  id: string,
): Promise<PackagedWidgetUnit> {
  const packs = await context.host.listWidgetPacks();
  const results: {
    readonly packId: string;
    readonly result: WidgetPackageResult;
  }[] = [];
  for (const pack of packs) {
    const bytes = await context.host.readWidgetPack(pack.id);
    const result = readWidgetPackage(bytes);
    if (!result.ok) {
      throw new Error(
        `The widget pack "${pack.id}" is not readable: ${result.message}`,
      );
    }
    results.push({ packId: pack.id, result });
  }

  const units = packagedUnits(results);
  const unit = units.find((candidate) => candidate.id === id);
  if (unit === undefined) {
    const known = units.map((candidate) => candidate.id);
    throw new Error(
      `There is no card unit "${id}" in the installed packs${
        known.length === 0 ? "" : ` (${known.join(", ")})`
      }.`,
    );
  }
  return unit;
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
  return await jsonAttempt(async () => {
    const installed = await installedUnit(context, input.unit);
    const draft = draftFor(context, input.themeId);
    const existing = draft.envelope.assets ?? [];

    // Pure: every declaration is verified before anything is returned, and the
    // draft is not touched until the copy has been built on the next envelope.
    // Only what the unit's own subtree draws is adopted; the rest of the
    // package's declarations are globals faces a copy cannot reference.
    const adopted = await adoptPackagedAssets(
      { declarations: existing, assets: draft.assets },
      {
        declarations: unitAssetDeclarations(
          installed.unit,
          installed.declarations,
        ),
        assets: installed.assets,
      },
    );
    const next = { ...draft.envelope, assets: adopted.declarations };
    const copy = instantiateCard({
      unit: installed.unit,
      globals: next.globals,
      existingIds: listSceneObjects(next).map((entry) => entry.id),
      existingBindingIds: bindingIdsOf(next),
      assetIds: adopted.assetIds,
      origin: { left: input.left, top: input.top },
    });
    const result = added(draft, copy.card, copy.bindings, next);
    // The object landed, so the bytes its declarations name are the draft's.
    for (const declaration of adopted.declarations.slice(existing.length)) {
      const bytes = adopted.assets[declaration.path];
      if (bytes !== undefined) {
        context.drafts.setAsset(draft.id, declaration.path, bytes);
      }
    }
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
    readonly name?: string | undefined;
    readonly runs: readonly {
      readonly kind?: "literal" | "value" | undefined;
      readonly bindingId?: string | undefined;
      readonly text?: string | undefined;
      readonly token?: string | undefined;
      readonly size: number;
      readonly typeToken?: "heading" | "body" | "mono" | undefined;
      readonly precision?: number | undefined;
      readonly unitDisplay?: "none" | "short" | "long" | undefined;
    }[];
    readonly align?: "left" | "center" | "right" | undefined;
    readonly verticalAlign?: "top" | "middle" | "bottom" | undefined;
    readonly overflow?: "clip" | "ellipsis" | "visible" | undefined;
    /** Upright characters, one per line. */
    readonly vertical?: boolean | undefined;
    readonly bindings?: readonly BindingInput[] | undefined;
    readonly themeId?: string | undefined;
  },
): Promise<CallToolResult> {
  return await jsonAttempt(() => {
    const draft = draftFor(context, input.themeId);
    const palette = paletteOf(draft);
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
      if (
        run.typeToken !== undefined &&
        draft.envelope.globals?.typeTokens?.[run.typeToken] === undefined
      ) {
        throw new Error(
          `This theme has no "${run.typeToken}" type token (${Object.keys(
            draft.envelope.globals?.typeTokens ?? {},
          ).join(", ")}).`,
        );
      }
      return {
        kind,
        ...(run.bindingId === undefined ? {} : { bindingId: run.bindingId }),
        ...(run.text === undefined ? {} : { text: run.text }),
        token: tokenOf(run.token, "text", palette),
        size: run.size,
        ...(run.typeToken === undefined ? {} : { typeToken: run.typeToken }),
        ...(run.precision === undefined ? {} : { precision: run.precision }),
        ...(run.unitDisplay === undefined
          ? {}
          : { unitDisplay: run.unitDisplay }),
      } as Run;
    });
    const built = addTextObject({
      id: "text",
      ...(input.name === undefined ? {} : { name: input.name }),
      ...input.box,
      runs,
      ...(input.align === undefined ? {} : { align: input.align }),
      ...(input.verticalAlign === undefined
        ? {}
        : { verticalAlign: input.verticalAlign }),
      ...(input.overflow === undefined ? {} : { overflow: input.overflow }),
      ...(input.vertical === undefined ? {} : { vertical: input.vertical }),
      ...(bindings.length === 0 ? {} : { bindings: bindingsOf(bindings) }),
      palette,
    });
    return added(draft, built.object, built.bindings);
  });
}

export async function addShape(
  context: ToolContext,
  input: {
    readonly kind: "rect" | "ellipse" | "path";
    readonly box: Box;
    readonly name?: string | undefined;
    readonly token?: string | undefined;
    readonly radius?: number | undefined;
    readonly points?: readonly (readonly (string | number)[])[] | undefined;
    readonly strokeWidth?: number | undefined;
    readonly themeId?: string | undefined;
  },
): Promise<CallToolResult> {
  return await jsonAttempt(() => {
    const draft = draftFor(context, input.themeId);
    const palette = paletteOf(draft);
    if (input.kind === "path" && input.points === undefined) {
      throw new Error("A path shape needs its own commands.");
    }
    // A field this kind cannot express is a mistake in the call, not a value
    // to drop: the author would never see it in the scene and would not know.
    if (input.kind !== "path") {
      for (const field of ["points", "strokeWidth"] as const) {
        if (input[field] !== undefined) {
          throw new Error(
            `"${field}" is only for a path shape, not a "${input.kind}".`,
          );
        }
      }
    }
    if (input.kind !== "rect" && input.radius !== undefined) {
      throw new Error(
        `"radius" is only for a rect shape, not a "${input.kind}".`,
      );
    }
    const points = input.points?.map((command) => {
      if (typeof command[0] !== "string") {
        throw new Error("Every path command starts with its letter.");
      }
      return command as readonly [string, ...number[]];
    });
    // A stroke is authored in artboard units, so a bare 2-unit line is a third
    // of a pixel on a 320 px display and reads as absent. The default scales
    // with the artboard's width; an explicit width, however thin, is kept.
    const strokeWidth =
      input.kind === "path"
        ? (input.strokeWidth ??
          Math.max(2, Math.round(draft.envelope.artboard.width / 240)))
        : undefined;
    const object = addShapeObject({
      id: "shape",
      ...(input.name === undefined ? {} : { name: input.name }),
      kind: input.kind,
      ...input.box,
      ...(input.token === undefined
        ? {}
        : { token: tokenOf(input.token, "panel", palette) }),
      ...(input.radius === undefined ? {} : { radius: input.radius }),
      ...(points === undefined ? {} : { points }),
      ...(strokeWidth === undefined ? {} : { strokeWidth }),
      palette,
    });
    return added(draft, object);
  });
}

export async function addImage(
  context: ToolContext,
  input: {
    readonly assetId: string;
    readonly box: Box;
    readonly name?: string | undefined;
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
    // A video is the background's media. Placing it as an Image object leaves a
    // black box: FabricImage has no frame to paint from that reference.
    if (asset.kind !== "image" && asset.kind !== "svg") {
      throw new Error(
        `"${asset.id}" is a ${asset.kind}, not a picture the scene can place. Set a video as the background instead.`,
      );
    }
    const object = addImageObject({
      id: "image",
      ...(input.name === undefined ? {} : { name: input.name }),
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
    readonly name?: string | undefined;
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
    const palette = paletteOf(draft);
    const object = addIconObject({
      id: "icon",
      ...(input.name === undefined ? {} : { name: input.name }),
      icon: input.icon as keyof typeof starterIcons,
      left: input.box.left,
      top: input.box.top,
      size: Math.min(input.box.width, input.box.height),
      ...(input.token === undefined
        ? {}
        : { token: tokenOf(input.token, "text", palette) }),
      palette,
    });
    return added(draft, object);
  });
}

export async function addChart(
  context: ToolContext,
  input: {
    readonly family: "line" | "bar" | "gauge";
    readonly box: Box;
    readonly name?: string | undefined;
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
      ...(input.name === undefined ? {} : { name: input.name }),
      ...input.box,
      family: input.family,
      bindings: bindingsOf(bindings),
      palette: paletteOf(draft),
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
      bindingsOf(bindings),
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

export async function reorderObject(
  context: ToolContext,
  objectId: string,
  move: SceneStackMove,
  themeId?: string,
): Promise<CallToolResult> {
  return await jsonAttempt(() => {
    const draft = draftFor(context, themeId);
    const result = moveSceneObject(draft.envelope, objectId, move);
    draft.envelope = result.envelope;
    return { themeId: draft.id, objectId, moved: result.moved };
  });
}

/** The fraction of the box that sits left of / above the authored anchor. */
function anchorFraction(origin: unknown, axis: "x" | "y"): number {
  if (axis === "x") {
    if (origin === "center") return 0.5;
    if (origin === "right") return 1;
  } else {
    if (origin === "center") return 0.5;
    if (origin === "bottom") return 1;
  }
  return 0;
}

/**
 * Fabric scales an object around its anchor, so the authored anchor stays put
 * and the drawn box grows with the scale.
 */
function scaleOf(object: ObjectJson, key: "scaleX" | "scaleY"): number {
  const value = object[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 1;
}

/**
 * An object's true bounding box in artboard coordinates.
 *
 * Fabric places an object by its anchor, so a group must read the authored
 * origin rather than assuming every box starts at `left`/`top`. A text object
 * authors no top-level height — Fabric measures it on load — so its box height
 * comes from `yunariText.box`, the box the text pass restores.
 */
function boxOf(object: ObjectJson, id: string): Box {
  const record = (value: unknown): Record<string, unknown> | undefined =>
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  const authoredHeight = (): number | undefined => {
    const value = record(record(object["yunariText"])?.["box"])?.["height"];
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : undefined;
  };
  const read = (key: "left" | "top" | "width" | "height"): number => {
    const value = object[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (key === "height") {
      const measured = authoredHeight();
      if (measured !== undefined) return measured;
    }
    throw new Error(`Object "${id}" has no authored ${key} to group by.`);
  };
  const width = read("width") * scaleOf(object, "scaleX");
  const height = read("height") * scaleOf(object, "scaleY");
  return {
    left: read("left") - width * anchorFraction(object["originX"], "x"),
    top: read("top") - height * anchorFraction(object["originY"], "y"),
    width,
    height,
  };
}

export async function groupObjects(
  context: ToolContext,
  objectIds: readonly string[],
  themeId?: string | undefined,
  name?: string | undefined,
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
    // Every binding under a requested root travels with it: `addSceneObject`
    // mints new ids for nested children, and its `minted` map only remaps an
    // entry whose authored id is in this record.
    const carried = new Set<string>();
    for (const object of roots.values()) collectSubtreeIds(object, carried);
    const bindings: Record<string, readonly Binding[]> = {};
    for (const [id, list] of Object.entries(draft.envelope.bindings ?? {})) {
      if (carried.has(id)) bindings[id] = list;
    }
    const remainingBindings = Object.fromEntries(
      Object.entries(draft.envelope.bindings ?? {}).filter(
        ([key]) => !carried.has(key),
      ),
    );

    const group: ObjectJson = {
      type: "Group",
      id: "group",
      name: name ?? "group",
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
