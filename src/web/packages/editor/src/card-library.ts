import {
  type Binding,
  createWidgetIdAllocator,
  type FabricGlobals,
  type WidgetIssue,
  type WidgetProvenance,
  YUNARI_NAME_PROPERTY,
} from "@yunari/renderer-core";
import { YUNARI_TEXT_PROPERTY } from "@yunari/scene-fabric";
import { type FabricObject, Group, util } from "fabric/es";
import {
  resolveCardToken,
  type TokenSubstitution,
} from "./card-token-mapping.js";
import type { EditorInteraction } from "./editor-interaction.js";
import { createNewFabricTheme } from "./new-fabric-theme.js";
import {
  clockCard,
  cpuCard,
  gpuCard,
  networkCard,
  ramCard,
  storageCard,
  trendsCard,
  vramCard,
} from "./new-fabric-theme-cards.js";
import { type ObjectJson } from "./new-fabric-theme-objects.js";
import { nextNewObjectPlacement } from "./new-object-defaults.js";
import { uiCopy } from "./ui-copy.js";

/**
 * The card library: the starter's eight cards as **units** an author can insert.
 *
 * A unit is the fast path, not the only path — the Add pane offers primitives
 * beside it and calls neither the fallback (§77, §139). What the library adds is
 * that one click brings the whole composition with its readings, its group and
 * its provenance: **a copy, not a twin**.
 *
 * The document is Fabric JSON (§134), so a card is one Fabric `Group` over its
 * parts and its readings live in the envelope's `bindings`, keyed by object id.
 * One piece of that is not about the scene model at all: identity.
 * `createWidgetIdAllocator` is the rule that decides what a fresh id looks like,
 * and it is shared so a pasted object and an inserted card agree on it.
 *
 * **Scope limit — the copy is faithful in ids, not necessarily in readings.**
 * `cardBindings` reads the *starter's* bindings map, keyed by the starter's own
 * part ids, so only the parts that map declares can carry a reading — eleven
 * across the eight cards, four of them the CPU card's, against its seven parts.
 * Inserted into a document whose part ids differ, or one an author has renamed,
 * every binding comes across as `null` and **no issue is raised** —
 * `unmapped-global` fires only on `palette.*` / `typeTokens.*` string
 * references, never on bindings. "A duplicated card is still a working card"
 * therefore holds for a starter-derived document, and the guarantee narrows to
 * ids everywhere else. The readings are the document's to carry, not this
 * module's to look up by a key it does not have; closing this needs a binding
 * reference that survives being copied, which is a format question, not a
 * lookup.
 */

/**
 * The name of the diagram a card unit's tile draws.
 *
 * A closed union, so the **library** owns the name and a ninth card cannot be
 * added without one; the pane owns the drawing, because it is a React surface
 * and this module is not. Named for the reading the card shows rather than for
 * the card's title, so it is the unit that is identified.
 */
export type CardDiagram =
  | "time"
  | "cpu"
  | "gpu"
  | "ram"
  | "vram"
  | "trends"
  | "storage"
  | "network";

/** One card an author can insert, named as the control that inserts it. */
export interface CardUnit {
  /** §77's `widgetId`: the group id, and what two copies of one card share. */
  readonly id: string;
  /** What the chooser's button says, and what a copy is named in the tree. */
  readonly label: string;
  /** Which diagram the Add pane's tile draws for this unit. */
  readonly diagram: CardDiagram;
  /** The card as the starter authored it — one group over its parts. */
  readonly build: () => ObjectJson;
}

/** The starter's cards, in the order the reference composition reads. */
export const CARD_LIBRARY: readonly CardUnit[] = [
  {
    id: "group-time-card",
    label: uiCopy.cardLibrary.time,
    diagram: "time",
    build: clockCard,
  },
  {
    id: "group-cpu-card",
    label: uiCopy.cardLibrary.cpu,
    diagram: "cpu",
    build: cpuCard,
  },
  {
    id: "group-gpu-card",
    label: uiCopy.cardLibrary.gpu,
    diagram: "gpu",
    build: gpuCard,
  },
  {
    id: "group-ram-card",
    label: uiCopy.cardLibrary.ram,
    diagram: "ram",
    build: ramCard,
  },
  {
    id: "group-vram-card",
    label: uiCopy.cardLibrary.vram,
    diagram: "vram",
    build: vramCard,
  },
  {
    id: "group-trends-card",
    label: uiCopy.cardLibrary.trends,
    diagram: "trends",
    build: trendsCard,
  },
  {
    id: "group-storage-card",
    label: uiCopy.cardLibrary.storage,
    diagram: "storage",
    build: storageCard,
  },
  {
    id: "group-network-card",
    label: uiCopy.cardLibrary.network,
    diagram: "network",
    build: networkCard,
  },
];

/** The prefix every copied id carries, so a copy reads as a copy in the tree. */
const COPY_PREFIX = "card";

/** What one card resolves to: a scene object and the readings it now carries. */
interface CardCopy {
  readonly card: ObjectJson;
  /** Keyed by the copy's own object ids, never the source's. */
  readonly bindings: Readonly<Record<string, readonly Binding[]>>;
  readonly issues: readonly WidgetIssue[];
  /**
   * What the destination theme made the card map onto, for `errorManager` to
   * name. Empty when every reference resolved exactly, which is the
   * starter-derived case and the only one an author is not told about.
   */
  readonly substitutions: readonly TokenSubstitution[];
}

interface InstantiateCardOptions {
  readonly unit: CardUnit;
  readonly globals: FabricGlobals | undefined;
  /** Every id the destination already holds, groups descended. */
  readonly existingIds: Iterable<string>;
  /**
   * Binding ids already in the document, which are **not** on the canvas.
   *
   * Separate from `existingIds` because they are separate ids: a binding is
   * keyed by the object that shows it and lives in the envelope, so a copy that
   * only watched the canvas would mint a second `card-cpu-card-load` and leave
   * the document with one id twice — which the validator refuses, and which
   * turns one more insertion into a save that fails for the rest of the session.
   */
  readonly existingBindingIds?: Iterable<string>;
  /** Artboard coordinates the copy's corner lands on (§67: placement, nothing more). */
  readonly origin: { readonly left: number; readonly top: number };
}

/** Everything one copy needs to know about itself while it is being built. */
interface CopyContext {
  readonly label: string;
  readonly provenance: WidgetProvenance;
  /** How far the root moves; its parts are group-local and stay put (§57). */
  readonly offset: { readonly x: number; readonly y: number };
  /**
   * Every declared object's own id, keyed by **the object** rather than by its
   * authored id: a card may declare one id twice, and each declaration still
   * needs an id of its own.
   */
  readonly objectIds: ReadonlyMap<ObjectJson, string>;
  /**
   * Where an authored id's readings land — its first copy, because a binding id
   * is unique across the document and two copies cannot both carry them.
   */
  readonly firstCopy: ReadonlyMap<string, string>;
  readonly bindingIds: ReadonlyMap<string, string>;
}

/**
 * One card, copied: fresh ids for the group, for every part and for every
 * binding; the **same** semantic keys, because a copy bound to a sensor nobody
 * else names is not a copy of anything; and provenance on the root alone,
 * because stamping every descendant triples a deep card's size to say the same
 * thing (§77, §138).
 *
 * Pure, so the whole copy — including what it could not resolve — is
 * inspectable without a canvas.
 */
export function instantiateCard(options: InstantiateCardOptions): CardCopy {
  const issues: WidgetIssue[] = [];
  const card = options.unit.build();
  const sourceBindings = cardBindings(card);
  // Mapped before any id is claimed, because the id map is keyed by object
  // identity and `mapGlobals` rebuilds every object it touches. Mapping first
  // means one walk rather than two, and the copy below is the only tree an id
  // ever has to be found in.
  const mapping = mapGlobals(card, options.globals);
  for (const ref of mapping.unmappable) {
    issues.push({
      code: "unmapped-global",
      detail:
        `The ${options.unit.label} card is painted with "${ref}", and this theme has no token ` +
        "this could map it onto — a same-named token here may mean something else entirely " +
        "(§77). Add that token, or give the theme one this job, before inserting it.",
    });
  }
  const allocateId = createWidgetIdAllocator(
    COPY_PREFIX,
    [...options.existingIds, ...(options.existingBindingIds ?? [])],
    issues,
  );

  // Every id is claimed before anything is rebuilt, so a run pointing at a
  // binding later in the tree resolves to an id that is already spoken for.
  //
  // The guard is this file's own `claim()`, whose `issued.has` loop refuses an
  // id this copy has already handed out, and it is the check the extraction
  // deliberately left behind: two parts declaring one id is the
  // card's own defect, and without it both copies would sit at the same minted
  // id, which the envelope validator refuses as `duplicate-id` — leaving the
  // author with a canvas that looks right and a save that fails for the rest of
  // the session, told nothing. The duplicate is reported and given an id of its
  // own, so the copy still serialises.
  const objectIds = new Map<ObjectJson, string>();
  const firstCopy = new Map<string, string>();
  const bindingIds = new Map<string, string>();
  const declared = new Map<string, number>();
  // Every id this copy has been given, so a minted value that repeats one —
  // the `-2` key of a repeat colliding with a genuine part of that name — is
  // bumped rather than handed out twice.
  const issued = new Set<string>();
  const claim = (object: ObjectJson): void => {
    const id = readId(object);
    if (id !== undefined) {
      const nth = (declared.get(id) ?? 0) + 1;
      declared.set(id, nth);
      if (nth > 1) {
        issues.push({
          code: "id-collision",
          detail:
            `The ${options.unit.label} card declares "${id}" more than once, so its copies ` +
            "give each declaration an id of its own.",
        });
      }
      // `allocateId` answers the same original with the same id twice over, so
      // a repeated declaration is minted under a numbered key: `…-2` reads as
      // the copy of `…` that a second insertion would have minted anyway.
      //
      // That key is an id an author may already have written, and the allocator
      // memoises **by key**, so a card carrying a genuine `…-2` part gets that
      // part's id back for the repeat — `nth` is 1 there, so no second
      // `id-collision` is reported and the duplicate is silent: the same two
      // objects at one id this guard exists to refuse, one level down. So the
      // minted value is checked against what this copy has already issued and
      // the key keeps bumping.
      let minted = allocateId(nth === 1 ? id : `${id}-${nth}`);
      for (let bump = nth + 1; issued.has(minted); bump += 1) {
        minted = allocateId(`${id}-${bump}`);
      }
      issued.add(minted);
      objectIds.set(object, minted);
      // The first declaration keeps the readings; a binding id is unique across
      // the document, so a second copy of the same declaration cannot have them
      // too without the validator refusing the pair.
      if (nth === 1) {
        firstCopy.set(id, minted);
        for (const binding of sourceBindings[id] ?? []) {
          bindingIds.set(binding.id, allocateId(binding.id));
        }
      }
    }
    for (const child of childrenOf(object)) claim(child);
  };
  claim(mapping.card);

  const context: CopyContext = {
    label: options.unit.label,
    provenance: { widgetId: options.unit.id, widgetName: options.unit.label },
    offset: {
      x: options.origin.left - numberAt(mapping.card, "left"),
      y: options.origin.top - numberAt(mapping.card, "top"),
    },
    objectIds,
    firstCopy,
    bindingIds,
  };

  return {
    card: copyObject(mapping.card, context, true),
    bindings: copiedBindings(sourceBindings, context),
    issues,
    substitutions: mapping.substitutions,
  };
}

/**
 * Inserts one card as a unit: a copy on the canvas, its readings recorded under
 * its own ids, one history entry, left selected.
 *
 * **A card this theme cannot express is refused; a card it can express
 * differently is mapped and named.** The refusal survives for the case that
 * made it necessary — an unresolved reference survives to `snapshot`, which
 * validates and throws, so a card that arrived anyway would leave the author
 * with a canvas that looks right and a save that fails for the rest of the
 * session, told nothing. What changed is that "this theme has no token for
 * `palette.cpu`" no longer *is* the answer when the theme has a CPU colour
 * under another name: `card-token-mapping.ts` resolves the reference first, and
 * what it had to substitute is reported through `errorManager` naming every
 * token. On the host's default two-token palette every card used to refuse; now
 * every card inserts, mapped onto what that theme actually has.
 */
export async function insertCard(
  editor: EditorInteraction,
  cardId: string,
  options: {
    readonly globals: FabricGlobals | undefined;
    /**
     * The readings the document already carries. Read so a copy's binding ids
     * mint past them; the envelope owns them, so this is a copy of a reference
     * and never a second place that decides what a card reads.
     */
    readonly bindings?: Readonly<Record<string, readonly Binding[]>>;
    /**
     * Records the copy's readings under its new ids. The envelope owns them, so
     * the caller writes rather than this module holding a second copy.
     */
    readonly onBindings: (
      bindings: Readonly<Record<string, readonly Binding[]>>,
    ) => void;
  },
): Promise<FabricObject> {
  const unit = cardUnit(cardId);
  const copy = instantiateCard({
    unit,
    globals: options.globals,
    existingIds: sceneIds(editor.canvas),
    existingBindingIds: Object.values(options.bindings ?? {}).flatMap(
      (bindings) => bindings.map((binding) => binding.id),
    ),
    // The one place a new object's position is decided — the same cascade every
    // other insertion takes, rather than a corner this module invented.
    origin: nextNewObjectPlacement(editor),
  });

  const unresolved = copy.issues.filter(
    (issue) => issue.code === "unmapped-global",
  );
  if (unresolved.length > 0) {
    throw new Error(unresolved.map((issue) => issue.detail).join(" "));
  }

  const [object] = await util.enlivenObjects<FabricObject>([copy.card]);
  if (object === undefined) {
    throw new Error(`The ${unit.label} card could not be built.`);
  }

  // Added before its readings are recorded: every pass that resolves them walks
  // the canvas, so an object that arrived ahead of its bindings would paint once
  // blank and wait for a tick nothing had yet asked for.
  editor.canvas.add(object);
  // **Told here, between the two.** Before the readings, because recording them
  // resolves every bound run and a document with no source for one throws —
  // which would swallow the only sentence explaining why the card now looks
  // different. And before `saveState`, because the shell retires a diagnostic on
  // the next committed edit, and the edit that would retire this one is this
  // insert.
  if (copy.substitutions.length > 0)
    reportSubstitutions(editor, unit.label, copy.substitutions);
  options.onBindings(copy.bindings);
  editor.canvas.setActiveObject(object);
  editor.historyManager.saveState();
  editor.canvas.requestRenderAll();
  return object;
}

/**
 * What the theme made the card map onto, in one line an author can act on.
 *
 * Every substituted token is named: a mapping that says only "the card was
 * adjusted" leaves the author with a card painted in a colour they did not
 * choose and no way to learn which token to edit. `warn`, not `error`, because
 * nothing failed — the card is on the canvas and the document saves.
 */
function reportSubstitutions(
  editor: EditorInteraction,
  cardLabel: string,
  substitutions: readonly TokenSubstitution[],
): void {
  const named = substitutions
    .map((entry) => `"${entry.from}" → "${entry.to}"`)
    .join(", ");
  editor.errorManager.warn(
    "controls",
    `The ${cardLabel} card was inserted with ${named}, because this theme has no ` +
      "token of its own there — edit the card's paint to change it.",
  );
}

function cardUnit(cardId: string): CardUnit {
  const unit = CARD_LIBRARY.find((candidate) => candidate.id === cardId);
  if (unit === undefined) {
    throw new Error(`There is no "${cardId}" card in the library.`);
  }
  return unit;
}

/**
 * The card's own slice of the **starter's** bindings, read rather than restated.
 *
 * A card and the reference composition are one authoring decision, so a second
 * table of semantic keys here would be a place for the two to drift — and a
 * drifted key is a reading that quietly stops being the one the author meant.
 *
 * **The limit this hardcoding costs, stated where a reader meets it:** the key
 * is the starter's own part id, so only the eleven parts
 * `createNewFabricTheme` declares can ever come back carrying a reading. Any
 * other document — one whose parts carry different ids, or an author's renames
 * — gets bindings of `null` for every part, silently, because
 * `unmapped-global` inspects only `palette.*` and `typeTokens.*` strings and
 * has no view of bindings at all. The document's own bindings are the real
 * source and this function cannot reach them: `insertCard` passes them in to
 * mint *past*, and the copy has to be buildable without them. See the module
 * docblock.
 */
function cardBindings(
  card: ObjectJson,
): Readonly<Record<string, readonly Binding[]>> {
  const declared = createNewFabricTheme().bindings ?? {};
  const carried: Record<string, readonly Binding[]> = {};
  const collect = (object: ObjectJson): void => {
    const id = readId(object);
    if (id !== undefined && declared[id] !== undefined) {
      carried[id] = declared[id];
    }
    for (const child of childrenOf(object)) collect(child);
  };
  collect(card);
  return carried;
}

/** One copied subtree; only the root moves, so no descendant shifts twice (§57). */
function copyObject(
  object: ObjectJson,
  context: CopyContext,
  isRoot: boolean,
): ObjectJson {
  const authored = object[YUNARI_TEXT_PROPERTY];
  const children = childrenOf(object);

  return {
    ...object,
    ...(context.objectIds.has(object)
      ? { id: context.objectIds.get(object) }
      : {}),
    ...(isRoot ? rootOf(object, context) : {}),
    ...(isRecord(authored)
      ? { [YUNARI_TEXT_PROPERTY]: copyText(authored, context) }
      : {}),
    ...(children.length === 0
      ? {}
      : {
          objects: children.map((child) => copyObject(child, context, false)),
        }),
  };
}

/** What a copy is called, where it came from, and where its corner went. */
function rootOf(
  object: ObjectJson,
  context: CopyContext,
): Readonly<Record<string, unknown>> {
  return {
    // The copy answers to the unit's name, so a tree of two CPU cards reads as
    // two CPU cards; the id beside the name is what tells them apart.
    [YUNARI_NAME_PROPERTY]: context.label,
    left: numberAt(object, "left") + context.offset.x,
    top: numberAt(object, "top") + context.offset.y,
    provenance: context.provenance,
  };
}

/** A run's binding id is remapped; its semantic key is not, because it has none. */
function copyText(
  authored: Readonly<Record<string, unknown>>,
  context: CopyContext,
): Readonly<Record<string, unknown>> {
  const runs = authored["runs"];
  if (!Array.isArray(runs)) return authored;

  return {
    ...authored,
    runs: runs.map((run) =>
      isRecord(run) && typeof run["bindingId"] === "string"
        ? {
            ...run,
            bindingId:
              context.bindingIds.get(run["bindingId"]) ?? run["bindingId"],
          }
        : run,
    ),
  };
}

/**
 * The copy's readings under its own object ids, each with a fresh binding id
 * and the semantic key it already had — §93: a widget bound to `cpu.load` must
 * still be bound to `cpu.load`, or it arrives showing nothing.
 */
function copiedBindings(
  source: Readonly<Record<string, readonly Binding[]>>,
  context: CopyContext,
): Readonly<Record<string, readonly Binding[]>> {
  const carried: Record<string, readonly Binding[]> = {};
  for (const [objectId, bindings] of Object.entries(source)) {
    const copied = context.firstCopy.get(objectId);
    if (copied === undefined) continue;
    carried[copied] = bindings.map((binding) => ({
      ...binding,
      id: context.bindingIds.get(binding.id) ?? binding.id,
    }));
  }
  return carried;
}

interface MappedCard {
  /** The card with every reference resolved against the destination theme. */
  readonly card: ObjectJson;
  /** What was swapped, for `errorManager` to name to the author. */
  readonly substitutions: readonly TokenSubstitution[];
  /** References this theme cannot express at all, so the card is refused. */
  readonly unmappable: readonly string[];
}

/**
 * The card, with every global it names resolved against the document it is
 * being inserted into.
 *
 * One walk, not a collect-then-rewrite pair: a card that named a reference in
 * a field this module had not been taught about would be caught by the same
 * recursion that finds the fields it knows, rather than by a second traversal
 * that has to be kept in step with the first.
 *
 * **The invariant this exists to protect: no unresolved `palette.*` or
 * `typeTokens.*` reference ever reaches the document.** An unresolved
 * reference survives to `snapshot`, which validates and throws, so a card that
 * arrived anyway would leave the author with a canvas that looks right and a
 * save that fails for the rest of the session.
 */
function mapGlobals(
  card: ObjectJson,
  globals: FabricGlobals | undefined,
): MappedCard {
  const substitutions: TokenSubstitution[] = [];
  const unmappable: string[] = [];
  const resolve = (value: unknown): unknown => {
    if (typeof value === "string") {
      if (!/^(?:palette|typeTokens)\.[A-Za-z0-9_-]+$/.test(value)) return value;
      const resolved = resolveCardToken(value, globals);
      if (resolved.ref !== undefined) {
        if (resolved.substitutedFor !== undefined) {
          substitutions.push({
            from: resolved.substitutedFor,
            to: resolved.ref,
          });
        }
        return resolved.ref;
      }
      unmappable.push(value);
      return value;
    }
    if (Array.isArray(value)) return value.map(resolve);
    if (!isRecord(value)) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, resolve(entry)]),
    );
  };
  return {
    card: resolve(card) as ObjectJson,
    substitutions,
    unmappable,
  };
}

/** Every id the canvas already holds, descending into groups. */
function sceneIds(canvas: {
  getObjects(): readonly FabricObject[];
}): Set<string> {
  const ids = new Set<string>();
  const visit = (objects: readonly FabricObject[]): void => {
    for (const object of objects) {
      const id = object.get("id");
      if (typeof id === "string") ids.add(id);
      if (object instanceof Group) visit(object.getObjects());
    }
  };
  visit(canvas.getObjects());
  return ids;
}

function readId(object: ObjectJson): string | undefined {
  const id = object["id"];
  return typeof id === "string" ? id : undefined;
}

function childrenOf(object: ObjectJson): readonly ObjectJson[] {
  const children = object["objects"];
  return Array.isArray(children) ? children.filter(isRecord) : [];
}

/** An authored number, or a refusal: a card part with no box has no place. */
function numberAt(object: ObjectJson, key: "left" | "top"): number {
  const value = object[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(
      `Card part "${readId(object) ?? "(unnamed)"}" has no authored ${key}.`,
    );
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
