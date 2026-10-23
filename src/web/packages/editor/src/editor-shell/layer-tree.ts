import {
  type Binding,
  CHART_FAMILIES,
  type ChartFamily,
  objectName,
} from "@yunari/renderer-core";
import { isLocked, YunariChart } from "@yunari/scene-fabric";
import { type FabricObject, Group } from "fabric/es";
import type { ShapeKind } from "../new-object-defaults.js";
import { uiCopy } from "../ui-copy.js";

export type LayerKind =
  | "text"
  | "shape"
  | "chart"
  | "group"
  | "image"
  | "background";

/** The background is not a Fabric object, so it has no object id. `$` is
 *  outside `STABLE_ID_PATTERN`, so no object can carry this id and no validator
 *  accepts it as one. */
export const BACKGROUND_LAYER_ID = "$background";

/**
 * What a row draws in place of its name: the kind's glyph, and the one fact a
 * glyph cannot carry.
 *
 * One icon per kind, drawn from the chrome vocabulary (`icons.ts`), so the mark
 * column reads as one family at one weight — a text row is the `T`, an image row
 * the picture mark, a group the stack. Two arms carry a fact the kind alone does
 * not name: a chart says which *family* it is and a shape which primitive,
 * because eight rows all saying "chart" is the one word an author scanning for
 * the ring cannot use. A group carries nothing — §5.1: it is an arbitrary set of
 * elements, so its mark is generic by construction.
 *
 * Nothing here is the object's own data any more. A row that printed the text's
 * words in the text's own face, the shape's paint or the image's own bytes was a
 * 28px column pretending to be a canvas; the name, the role and the bound key are
 * what say those things, and each of them is a column the tree already owns.
 */
export type LayerMark =
  | { readonly kind: "text" }
  | { readonly kind: "chart"; readonly family: ChartFamily | undefined }
  | { readonly kind: "shape"; readonly shape: ShapeKind | undefined }
  | { readonly kind: "image" }
  | { readonly kind: "group" }
  | { readonly kind: "background" };

/**
 * What the document says a row is, in the document's own terms.
 *
 * Raw facts rather than words: the panel renders one of these through
 * `uiCopy.panels.layerRoles`, so the vocabulary has a single owner. Each arm
 * reports what the object carries and **never a neighbour** — the rule
 * `chartMark` already states for a family this build does not know. A chart
 * with an unrecognised family is therefore `family: undefined` rather than the
 * fallback's family, and a group with no stamp carries no unit, which is the
 * document's answer rather than a gap.
 */
export type LayerRole =
  | {
      readonly kind: "chart";
      readonly family: ChartFamily | undefined;
      /** How many readings this chart draws — the length of the same binding
       * list `bound` is projected from, so it cannot disagree with the keys
       * printed beside it. */
      readonly series: number;
    }
  /** The unit the document says the card is, where it names one. A card is
   * stamped where it is assembled, so the starter's own cards say it as readily
   * as a copy does, and a group that names none reads the bare arm. */
  | { readonly kind: "group"; readonly unit: string | undefined }
  | { readonly kind: "text" }
  | { readonly kind: "shape" }
  | { readonly kind: "image" }
  | { readonly kind: "background" };

export interface LayerRow {
  readonly id: string;
  readonly name: string;
  readonly kind: LayerKind;
  readonly mark: LayerMark;
  /** What this row is, in the words the document uses. */
  readonly role: LayerRole;
  /** The semantic keys this node reads, in the order the document declares
   * them. Empty for an object bound to nothing, which is a fact about the
   * document rather than a gap to be filled in. */
  readonly bound: readonly string[];
  readonly depth: number;
  readonly parentId: string | undefined;
  readonly hasChildren: boolean;
  /** Shut, so the twisty offers the other direction. A group with children is
   * shut until the author opens it, so this is the default rather than a mark
   * of an action — and never an authored state (§67). */
  readonly collapsed: boolean;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly selected: boolean;
}

const ANONYMOUS_ID = "unidentified";

/**
 * Whether the panel lists this object at all.
 *
 * An `excludeFromExport` object is the editor's own scaffolding rather than the
 * author's: the artboard plate and clip, and the crop frame a mid-crop session
 * draws over the image. The scene they belong to is defined by what a save
 * writes, and a save writes none of them, so a row for one is a row acting on
 * something that will not be there next time — and the frame carries no id, so
 * it would render as `unidentified` and answer to `findById` under that name.
 *
 * Every walk here asks this, not just the projection. The anonymous fallback id
 * is *positional* (`layerIds` numbers id-less objects in walk order), so a walk
 * that skipped an excluded object and one that did not would hand the same id
 * to different objects — which is the invariant the comment on `layerIds`
 * already depends on.
 */
function isListed(object: FabricObject): boolean {
  return (object as { excludeFromExport?: boolean }).excludeFromExport !== true;
}

/** Ids for id-less objects still have to be distinct, so the first keeps the
 * plain fallback and the rest are suffixed by walk position. That makes the
 * scheme order-dependent: every walk here reverses the same way, and every walk
 * here visits the same objects — a walk that stopped at a shut group would
 * number its rows differently from `findById` and hand the same id to two
 * objects. */
function layerIds(): (object: FabricObject) => string {
  let count = 0;
  return (object) => {
    const raw = (object as { id?: string }).id;
    if (raw !== undefined) return raw;
    count += 1;
    return count === 1 ? ANONYMOUS_ID : `${ANONYMOUS_ID}#${count}`;
  };
}

/** Fabric type tags are lowercase class names; the envelope keeps "YunariChart". */
function kindOf(object: FabricObject): LayerKind {
  if (object instanceof YunariChart) return "chart";
  if (object instanceof Group) return "group";
  const type = (object as { type?: string }).type;
  if (type === "textbox" || type === "i-text" || type === "text") return "text";
  if (type === "image") return "image";
  return "shape";
}

/** The name chain every row prints: authored, else the id, else the kind's own
    word — "empty rows help nobody". One owner, so a second surface cannot grow a
    copy that disagrees about a nameless object with a blank id. */
function composeName(
  object: FabricObject,
  id: string,
  kindWord: string,
): string {
  const authored = objectName(object);
  if (authored !== undefined) return authored;
  return id.trim() !== "" ? id : kindWord;
}

function nameOf(object: FabricObject, id: string, kind: LayerKind): string {
  return composeName(object, id, uiCopy.panels.layerKinds[kind]);
}

/**
 * The name one object's own row carries, for a surface that describes a single
 * object rather than walking a scene — the inspector's subject. The id-less
 * fallback is the tree's first anonymous id and the kind's word is the last
 * resort, so the two print the same thing for the same object.
 */
export function rowNameOf(object: FabricObject, kindWord: string): string {
  return composeName(object, layerIds()(object), kindWord);
}

/**
 * Which primitive a shape object is, in the Add pane's own vocabulary, or
 * `undefined` for a shape this build cannot name.
 *
 * Read off Fabric's own `type` tag, the same way `kindOf` tells one object from
 * another — and it is Fabric's getter rather than the envelope's spelling, so
 * `scene-fabric`'s `Arc` and `Wedge` (whose classes keep the capitals a scene
 * JSON carries, because Fabric 7 ships no sweep and the tag is what keeps an arc
 * from reviving as a full disc) read here as `arc` and `wedge`.
 *
 * `undefined` is an answer rather than a gap — a shape tag a newer build wrote is
 * not a `rect`, and a row that guessed a neighbour would name a kind the document
 * does not hold. `icons.ts` draws that row the generic shape mark.
 */
function shapeKindOf(object: FabricObject): ShapeKind | undefined {
  switch ((object as { type?: string }).type) {
    case "rect":
      return "rect";
    // A `Circle` is an ellipse the author has not stretched: there is no Circle
    // kind, so both classes answer the one primitive.
    case "ellipse":
    case "circle":
      return "ellipse";
    case "polygon":
      return "polygon";
    case "polyline":
      return "polyline";
    case "line":
      return "line";
    case "path":
      return "path";
    case "arc":
      return "arc";
    case "wedge":
      return "wedge";
    default:
      return undefined;
  }
}

/**
 * A chart's family, when the object names one this build knows.
 *
 * An unrecognised family is reported as none rather than defaulted to a
 * neighbour: the row would then claim a chart is a gauge when the document says
 * otherwise, which is the one thing a mark must never do.
 */
function chartMark(object: FabricObject): LayerMark {
  const family: unknown = object.get("family");
  return {
    kind: "chart",
    family: CHART_FAMILIES.find((known) => known === family),
  };
}

/**
 * A chart's role: the family it names, and how many readings it draws.
 *
 * The family is read from the object and matched against the families this
 * build knows, exactly as `chartMark` does — an unrecognised one is `undefined`
 * rather than defaulted to a neighbour. The count is the object's own binding
 * list, the same array `bound` is projected from, so the row's `×n` can never
 * disagree with the keys printed beside it.
 */
function chartRole(object: FabricObject, own: readonly Binding[]): LayerRole {
  const family: unknown = object.get("family");
  return {
    kind: "chart",
    family: CHART_FAMILIES.find((known) => known === family),
    series: own.length,
  };
}

/**
 * A group's role: the unit it was stamped with, where the document says one.
 *
 * A card carries `{ widgetId, widgetName }` on its root, stamped where the card
 * is assembled, so the starter's own cards and a copy both say it. A group that
 * names no unit reads the bare arm, and reading a neighbour's stamp — or a
 * stage's, or a default — claims what the document does not.
 *
 * A stamp that names the unit with a blank says nothing, the same as an absent
 * one, and is reported the same way — the guard `nameOf` already applies to an
 * id. Left as a string, it reaches the row as a role span with no text at all.
 */
function groupRole(object: FabricObject): LayerRole {
  const stamp: unknown = object.get("provenance");
  const unit =
    typeof stamp === "object" && stamp !== null
      ? (stamp as { readonly widgetName?: unknown }).widgetName
      : undefined;
  const named =
    typeof unit === "string" && unit.trim() !== "" ? unit : undefined;
  return { kind: "group", unit: named };
}

function roleOf(
  object: FabricObject,
  kind: LayerKind,
  own: readonly Binding[],
): LayerRole {
  switch (kind) {
    case "chart":
      return chartRole(object, own);
    case "group":
      return groupRole(object);
    case "text":
      return { kind: "text" };
    case "shape":
      return { kind: "shape" };
    case "image":
      return { kind: "image" };
    // A projected object cannot be the background — the row is appended by the
    // bridge — but the arm keeps the switch total over the kind union.
    case "background":
      return { kind: "background" };
  }
}

/** The one glyph a row wears, and the one fact the kind alone does not name:
 *  a chart's family, a shape's primitive. Every other arm is the kind and
 *  nothing else, because a mark that read anything more would be a third column
 *  of the row drawn as an icon. */
function markOf(object: FabricObject, kind: LayerKind): LayerMark {
  switch (kind) {
    case "text":
      return { kind: "text" };
    case "chart":
      return chartMark(object);
    case "shape":
      return { kind: "shape", shape: shapeKindOf(object) };
    case "image":
      return { kind: "image" };
    case "group":
      return { kind: "group" };
    // Unreachable through the projection; see `roleOf`.
    case "background":
      return { kind: "background" };
  }
}

/**
 * The background's own row: the bottom-most layer, and not a Fabric object.
 *
 * The bridge appends it after the projection rather than projecting it, so it
 * is structurally last and no restack or drop path can move it. It carries no
 * authored state, so every field but `selected` is a constant.
 */
export function backgroundRow(input: { readonly selected: boolean }): LayerRow {
  return {
    id: BACKGROUND_LAYER_ID,
    name: uiCopy.panels.layerKinds.background,
    kind: "background",
    mark: { kind: "background" },
    role: { kind: "background" },
    bound: [],
    depth: 0,
    parentId: undefined,
    hasChildren: false,
    collapsed: false,
    visible: true,
    locked: false,
    selected: input.selected,
  };
}

/**
 * Projects Fabric's current hierarchy without maintaining a second scene tree.
 *
 * `expanded` names the groups the author has *opened*, and a group with children
 * is shut until it is in there. That is the whole default: the starter's eight
 * cards would otherwise open as sixty rows, and shut-by-default is a default
 * rather than state to store (§67). Holding the exceptions rather than the rule
 * is also what makes a group created a minute ago shut without anything having
 * to record it — the shell never enumerates groups to keep the set current.
 */
export function projectLayers({
  root,
  selected,
  expanded,
  bindings,
}: {
  readonly root: readonly FabricObject[];
  readonly selected: readonly FabricObject[];
  readonly expanded: ReadonlySet<string>;
  /** The document's semantic bindings, keyed by the same Fabric object ids the
   * rows carry. Envelope state rather than Fabric state, so it arrives as an
   * argument: the projection still reads Fabric in and rows out, and a row's
   * bound key is whatever the document declares rather than a string typed in
   * beside the object. Absent bindings read as none, which is what a document
   * that declares none means. */
  readonly bindings?: Readonly<Record<string, readonly Binding[]>>;
}): readonly LayerRow[] {
  const rows: LayerRow[] = [];
  const idOf = layerIds();
  const bound = bindings ?? {};
  const walk = (
    objects: readonly FabricObject[],
    depth: number,
    ancestors: readonly FabricObject[],
    parentId: string | undefined,
    hidden: boolean,
  ): void => {
    for (const object of [...objects].reverse()) {
      if (!isListed(object)) continue;
      const id = idOf(object);
      const kind = kindOf(object);
      const path = [...ancestors, object];
      const isGroup = object instanceof Group;
      const hasChildren = isGroup && object.getObjects().length > 0;
      const collapsed = hasChildren && !expanded.has(id);
      if (!hidden) {
        const own = bound[id] ?? [];
        rows.push({
          id,
          name: nameOf(object, id, kind),
          kind,
          mark: markOf(object, kind),
          role: roleOf(object, kind, own),
          bound: own.map((entry) => entry.semanticKey),
          depth,
          parentId,
          hasChildren,
          collapsed,
          visible: path.every((entry) => entry.visible),
          locked: path.some((entry) => isLocked(entry)),
          selected: selected.includes(object),
        });
      }
      // Descend into a shut group as well, emitting nothing for what is under
      // it. The fallback id above is *positional* — `layerIds` numbers the
      // id-less by walk order — and `findById`/`ownerOf`/`pathTo` walk the whole
      // document rather than the visible part of it. Stopping at a shut group
      // would hand the same fallback id to two different objects, so a rename
      // or a hide would land on whichever one the panel happened to mean.
      if (isGroup)
        walk(object.getObjects(), depth + 1, path, id, hidden || collapsed);
    }
  };
  walk(root, 0, [], undefined, false);
  return rows;
}

/** The object a row id names, in the same paint-order walk `projectLayers`
 * uses so the anonymous fallback ids resolve to the same objects the panel
 * rendered. */
export function findById(
  root: readonly FabricObject[],
  id: string,
): FabricObject | undefined {
  const idOf = layerIds();
  const search = (
    objects: readonly FabricObject[],
  ): FabricObject | undefined => {
    for (const object of [...objects].reverse()) {
      if (!isListed(object)) continue;
      if (idOf(object) === id) return object;
      if (object instanceof Group) {
        const found = search(object.getObjects());
        if (found !== undefined) return found;
      }
    }
    return undefined;
  };
  return search(root);
}

/** The owning Group of an id, or undefined for a top-level object. Read from
 * the tree rather than Fabric's `object.group`, which an active selection
 * temporarily repoints at the selection itself. */
export function ownerOf(
  root: readonly FabricObject[],
  id: string,
): Group | undefined {
  const path = pathTo(root, id);
  const parent = path[path.length - 2];
  return parent instanceof Group ? parent : undefined;
}

/** Every object from the root down to the id, root first. */
export function pathTo(
  root: readonly FabricObject[],
  id: string,
): readonly FabricObject[] {
  const idOf = layerIds();
  const search = (
    objects: readonly FabricObject[],
    path: readonly FabricObject[],
  ): readonly FabricObject[] | undefined => {
    for (const object of [...objects].reverse()) {
      if (!isListed(object)) continue;
      const next = [...path, object];
      if (idOf(object) === id) return next;
      if (object instanceof Group) {
        const found = search(object.getObjects(), next);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  };
  return search(root, []) ?? [];
}
