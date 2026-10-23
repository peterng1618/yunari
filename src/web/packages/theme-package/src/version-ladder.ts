import type { FabricThemeEnvelope } from "@yunari/renderer-core";

/**
 * The document's own version shape: three integers, with no prefix,
 * prerelease or build. Semver's wider grammar is not what a theme version
 * means, so a value it can parse but this cannot is not a version here.
 */
const SEMANTIC_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

export type VersionLevel = "initial" | "none" | "patch" | "minor" | "major";

export type ChangeReason =
  | "schema"
  | "canvas"
  | "sensor-removed"
  | "sensor-added"
  | "structure"
  | "backdrop"
  | "metadata"
  | "content";

export interface ThemeChange {
  readonly level: VersionLevel;
  readonly reasons: readonly ChangeReason[];
}

export function isSemanticVersion(text: string): boolean {
  return SEMANTIC_VERSION.test(text);
}

export function bumpVersion(
  previous: string,
  level: "patch" | "minor" | "major",
): string | undefined {
  const match = SEMANTIC_VERSION.exec(previous);
  if (match === null) return undefined;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  // A digit string past the safe-integer range cannot round-trip through
  // numbers, so bumping it would print a version nobody wrote.
  if (
    !Number.isSafeInteger(major) ||
    !Number.isSafeInteger(minor) ||
    !Number.isSafeInteger(patch)
  )
    return undefined;
  if (level === "major") return `${major + 1}.0.0`;
  if (level === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export function versionFor(
  previous: string | undefined,
  change: ThemeChange,
): string | undefined {
  switch (change.level) {
    case "initial":
      // Initial only mints a version. A previous alongside it is a contradic-
      // tion: either this is the first publication or it is not.
      return previous === undefined ? "1.0.0" : undefined;
    case "none":
      return previous !== undefined && isSemanticVersion(previous)
        ? previous
        : undefined;
    case "patch":
    case "minor":
    case "major":
      return previous === undefined
        ? undefined
        : bumpVersion(previous, change.level);
  }
}

type ChangeLevel = Exclude<VersionLevel, "initial">;

type Rule = (before: unknown, after: unknown) => ThemeChange | undefined;

const IGNORED_METADATA_KEYS = ["version", "createdAt", "updatedAt"] as const;

/**
 * A member's own reader. A rule that does not know a field still answers
 * `patch`, because an unknown field inside a member this build reads is content
 * — only an unknown *member* is a format change.
 */
function change(level: ChangeLevel, ...reasons: ChangeReason[]): ThemeChange {
  return { level, reasons };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Two documents that differ only in property order are the same document. */
function stable(value: unknown): string {
  return (
    JSON.stringify(value, (_key, entry: unknown) =>
      isRecord(entry)
        ? Object.fromEntries(
            Object.entries(entry).sort(([a], [b]) =>
              a < b ? -1 : a > b ? 1 : 0,
            ),
          )
        : entry,
    ) ?? ""
  );
}

function withoutKeys(
  value: unknown,
  ignored: readonly string[],
): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !ignored.includes(key)),
  );
}

/** The interface is the sensors bound, not the objects that bind them. */
function sensors(bindings: unknown): ReadonlySet<string> {
  const found = new Set<string>();
  if (!isRecord(bindings)) return found;
  for (const objectBindings of Object.values(bindings)) {
    if (!Array.isArray(objectBindings)) continue;
    for (const binding of objectBindings) {
      const key = isRecord(binding) ? binding["semanticKey"] : undefined;
      if (typeof key === "string") found.add(key);
    }
  }
  return found;
}

function merged(
  changes: readonly (ThemeChange | undefined)[],
): ThemeChange | undefined {
  const fired = new Set<ChangeReason>();
  let level: ChangeLevel = "none";
  for (const result of changes) {
    if (result === undefined) continue;
    if (
      result.level !== "initial" &&
      LEVEL_ORDER[result.level] > LEVEL_ORDER[level]
    )
      level = result.level;
    for (const reason of result.reasons) fired.add(reason);
  }
  if (level === "none") return undefined;
  return { level, reasons: REASON_ORDER.filter((reason) => fired.has(reason)) };
}

/** A scene node is identifiable when it carries `id`; a collection of them is
 *  matched by that id rather than by position, at any depth. */
function hasId(value: unknown): value is Readonly<Record<string, unknown>> & {
  readonly id: string;
} {
  return isRecord(value) && typeof value["id"] === "string";
}

function compareValues(
  before: unknown,
  after: unknown,
): ThemeChange | undefined {
  if (stable(before) === stable(after)) return undefined;
  if (Array.isArray(before) && Array.isArray(after))
    return compareArrays(before, after);
  if (isRecord(before) && isRecord(after)) return compareRecords(before, after);
  return change("patch", "content");
}

function addedOrRemoved(present: unknown): ThemeChange {
  if (hasId(present)) return change("minor", "structure");
  if (Array.isArray(present) && present.some(hasId))
    return change("minor", "structure");
  return change("patch", "content");
}

function compareRecords(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): ThemeChange | undefined {
  const changes: (ThemeChange | undefined)[] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const inBefore = Object.hasOwn(before, key);
    const inAfter = Object.hasOwn(after, key);
    if (!inBefore || !inAfter) {
      changes.push(addedOrRemoved(inBefore ? before[key] : after[key]));
      continue;
    }
    changes.push(compareValues(before[key], after[key]));
  }
  return merged(changes);
}

function compareArrays(before: readonly unknown[], after: readonly unknown[]) {
  const identifiable =
    (before.length === 0 || before.every(hasId)) &&
    (after.length === 0 || after.every(hasId));
  if (identifiable && (before.length > 0 || after.length > 0))
    return compareById(before, after, true);
  return compareByIndex(before, after);
}

/** `orderMatters` is z-order for a scene object list; an asset collection has
 *  no order, so moving one around is no change at all. */
function compareById(
  before: readonly unknown[],
  after: readonly unknown[],
  orderMatters: boolean,
): ThemeChange | undefined {
  const beforeById = new Map(
    before.map((node) => [(node as { id: string }).id, node]),
  );
  const afterById = new Map(
    after.map((node) => [(node as { id: string }).id, node]),
  );
  const changes: (ThemeChange | undefined)[] = [];
  for (const [id, node] of beforeById) {
    const next = afterById.get(id);
    if (next === undefined) changes.push(change("minor", "structure"));
    else changes.push(compareValues(node, next));
  }
  for (const id of afterById.keys()) {
    if (!beforeById.has(id)) changes.push(change("minor", "structure"));
  }
  if (orderMatters) {
    const beforeOrder = before
      .map((node) => (node as { id: string }).id)
      .filter((id) => afterById.has(id));
    const afterOrder = after
      .map((node) => (node as { id: string }).id)
      .filter((id) => beforeById.has(id));
    if (
      beforeOrder.length === afterOrder.length &&
      beforeOrder.some((id, index) => id !== afterOrder[index])
    )
      changes.push(change("patch", "content"));
  }
  return merged(changes);
}

function compareByIndex(
  before: readonly unknown[],
  after: readonly unknown[],
): ThemeChange | undefined {
  const changes: (ThemeChange | undefined)[] = [];
  const common = Math.min(before.length, after.length);
  for (let index = 0; index < common; index += 1)
    changes.push(compareValues(before[index], after[index]));
  if (before.length !== after.length) {
    const extra =
      before.length > after.length ? before.slice(common) : after.slice(common);
    changes.push(addedOrRemoved(extra.find(hasId) ?? extra[0]));
  }
  return merged(changes);
}

/** A scene object is an element of an `objects` array at any depth. Its id is
 *  unique across the document, so a re-parent keeps the same identity. */
interface SceneObject {
  readonly node: unknown;
  readonly parent: string | undefined;
}

function collectSceneObjects(
  value: unknown,
  parent: string | undefined,
  into: Map<string, SceneObject>,
): void {
  if (!isRecord(value)) return;
  const children = value["objects"];
  if (!Array.isArray(children)) return;
  for (const child of children) {
    if (!hasId(child)) continue;
    into.set(child.id, { node: child, parent });
    collectSceneObjects(child, child.id, into);
  }
}

/** Z-order among the ids that stay in this same array; an object that moved to
 *  another parent is compared where it landed, not reordered here. */
function objectOrderChange(
  before: unknown,
  after: unknown,
): ThemeChange | undefined {
  if (!Array.isArray(before) || !Array.isArray(after)) return undefined;
  const beforeIds = before.filter(hasId).map((node) => node.id);
  const afterIds = after.filter(hasId).map((node) => node.id);
  const beforeSet = new Set(beforeIds);
  const afterSet = new Set(afterIds);
  const stayedBefore = beforeIds.filter((id) => afterSet.has(id));
  const stayedAfter = afterIds.filter((id) => beforeSet.has(id));
  return stayedBefore.length === stayedAfter.length &&
    stayedBefore.some((id, index) => id !== stayedAfter[index])
    ? change("patch", "content")
    : undefined;
}

/** Ids are usable only when every element carries one; otherwise the array is
 *  compared by position, as a document without ids requires. */
function fullyIdentified(value: unknown): boolean {
  return Array.isArray(value) && value.every(hasId);
}

/** An id-less `objects` array has no identity to match on: matched indexes are
 *  content, and a length change is objects joining or leaving — structure, not
 *  content as the generic primitive-array path would grade it. */
function compareIndexedObjects(
  before: readonly unknown[],
  after: readonly unknown[],
): ThemeChange | undefined {
  const changes: (ThemeChange | undefined)[] = [];
  const common = Math.min(before.length, after.length);
  for (let index = 0; index < common; index += 1)
    changes.push(compareValues(before[index], after[index]));
  if (before.length !== after.length)
    changes.push(change("minor", "structure"));
  return merged(changes);
}

/** A scene object's own members; its `objects` children are matched
 *  document-wide, so only their order is compared here. */
function compareSceneNode(
  before: unknown,
  after: unknown,
): ThemeChange | undefined {
  if (!isRecord(before) || !isRecord(after))
    return stable(before) === stable(after)
      ? undefined
      : change("patch", "content");
  const changes: (ThemeChange | undefined)[] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const inBefore = Object.hasOwn(before, key);
    const inAfter = Object.hasOwn(after, key);
    if (key === "objects" && inBefore && inAfter) {
      const a = before[key];
      const b = after[key];
      changes.push(
        fullyIdentified(a) && fullyIdentified(b)
          ? objectOrderChange(a, b)
          : compareIndexedObjects(
              Array.isArray(a) ? a : [],
              Array.isArray(b) ? b : [],
            ),
      );
      continue;
    }
    if (!inBefore || !inAfter) {
      // Only `objects` holds scene objects; any other member joining or
      // leaving a known object is content, even when its value carries an id.
      changes.push(change("patch", "content"));
      continue;
    }
    changes.push(compareValues(before[key], after[key]));
  }
  return merged(changes);
}

const ARTBOARD_VOLATILE_KEYS = ["width", "height"] as const;

function artboardChange(
  before: unknown,
  after: unknown,
): ThemeChange | undefined {
  const a = isRecord(before) ? before : {};
  const b = isRecord(after) ? after : {};
  const canvas = a["width"] !== b["width"] || a["height"] !== b["height"];
  const content =
    stable(withoutKeys(a, ARTBOARD_VOLATILE_KEYS)) !==
    stable(withoutKeys(b, ARTBOARD_VOLATILE_KEYS));
  const reasons: ChangeReason[] = [];
  if (canvas) reasons.push("canvas");
  if (content) reasons.push("content");
  return reasons.length === 0
    ? undefined
    : change(canvas ? "major" : "patch", ...reasons);
}

/** The background layer's media is the ground a viewer sees, so swapping it is
 *  a minor change; its colour alone is content. */
function backgroundChange(
  before: unknown,
  after: unknown,
): ThemeChange | undefined {
  const a = isRecord(before) ? before : {};
  const b = isRecord(after) ? after : {};
  const backdrop = stable(a["media"]) !== stable(b["media"]);
  const content = stable(a["color"]) !== stable(b["color"]);
  const reasons: ChangeReason[] = [];
  if (backdrop) reasons.push("backdrop");
  if (content) reasons.push("content");
  return reasons.length === 0
    ? undefined
    : change(backdrop ? "minor" : "patch", ...reasons);
}

function bindingsChange(
  before: unknown,
  after: unknown,
): ThemeChange | undefined {
  const beforeSensors = sensors(before);
  const afterSensors = sensors(after);
  const removed = [...beforeSensors].some((key) => !afterSensors.has(key));
  const added = [...afterSensors].some((key) => !beforeSensors.has(key));
  if (removed || added) {
    const reasons: ChangeReason[] = [];
    if (removed) reasons.push("sensor-removed");
    if (added) reasons.push("sensor-added");
    return change(removed ? "major" : "minor", ...reasons);
  }
  return stable(before) === stable(after)
    ? undefined
    : change("patch", "content");
}

function tagSet(value: unknown): ReadonlySet<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.filter((tag): tag is string => typeof tag === "string"));
}

function metadataChange(
  before: unknown,
  after: unknown,
): ThemeChange | undefined {
  const a = withoutKeys(before, IGNORED_METADATA_KEYS);
  const b = withoutKeys(after, IGNORED_METADATA_KEYS);
  const tags = tagSet(a["tags"]);
  const nextTags = tagSet(b["tags"]);
  // Tags are a set: reordering them is no change, joining or leaving is minor.
  const membershipMoved =
    tags.size !== nextTags.size || [...tags].some((tag) => !nextTags.has(tag));
  const rest =
    stable(withoutKeys(a, ["tags"])) !== stable(withoutKeys(b, ["tags"]));
  const reasons: ChangeReason[] = [];
  if (membershipMoved) reasons.push("metadata");
  if (rest) reasons.push("metadata");
  if (reasons.length === 0) return undefined;
  return change(membershipMoved ? "minor" : "patch", ...reasons);
}

/** `scene.version` moves when the editor upgrades, not when the theme does. */
function sceneChange(before: unknown, after: unknown): ThemeChange | undefined {
  const a = withoutKeys(before, ["version"]);
  const b = withoutKeys(after, ["version"]);
  const beforeIds = new Map<string, SceneObject>();
  const afterIds = new Map<string, SceneObject>();
  collectSceneObjects(a, undefined, beforeIds);
  collectSceneObjects(b, undefined, afterIds);
  const changes: (ThemeChange | undefined)[] = [];
  const removed = [...beforeIds.keys()].some((id) => !afterIds.has(id));
  const added = [...afterIds.keys()].some((id) => !beforeIds.has(id));
  if (removed || added) changes.push(change("minor", "structure"));
  for (const [id, entry] of beforeIds) {
    const next = afterIds.get(id);
    if (next === undefined) continue;
    if (entry.parent !== next.parent) changes.push(change("patch", "content"));
    changes.push(compareSceneNode(entry.node, next.node));
  }
  changes.push(compareSceneNode(a, b));
  return merged(changes);
}

function assetsChange(
  before: unknown,
  after: unknown,
): ThemeChange | undefined {
  const a = Array.isArray(before) ? before : [];
  const b = Array.isArray(after) ? after : [];
  // Assets are referenced by id and have no order of their own.
  return a.every(hasId) && b.every(hasId)
    ? compareById(a, b, false)
    : compareByIndex(a, b);
}

/** A palette token or type preset is named by its map key, so one leaving or
 *  joining the map is structural while a kept one's value is content. */
function tokenGroupChange(
  before: unknown,
  after: unknown,
): ThemeChange | undefined {
  const a = isRecord(before) ? before : {};
  const b = isRecord(after) ? after : {};
  const changes: (ThemeChange | undefined)[] = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const inBefore = Object.hasOwn(a, key);
    const inAfter = Object.hasOwn(b, key);
    if (!inBefore || !inAfter) changes.push(change("minor", "structure"));
    else changes.push(compareValues(a[key], b[key]));
  }
  return merged(changes);
}

const TOKEN_GROUPS = new Set(["palette", "typePresets"]);

function globalsChange(
  before: unknown,
  after: unknown,
): ThemeChange | undefined {
  const a = isRecord(before) ? before : {};
  const b = isRecord(after) ? after : {};
  const changes: (ThemeChange | undefined)[] = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const inBefore = Object.hasOwn(a, key);
    const inAfter = Object.hasOwn(b, key);
    if (TOKEN_GROUPS.has(key)) {
      // The group itself may be absent on one side; `tokenGroupChange` reads
      // that as an empty map, so its tokens are still additions/removals.
      changes.push(tokenGroupChange(a[key], b[key]));
    } else if (!inBefore || !inAfter) {
      // Only tokens and presets are interface; another group joining the
      // member is a change inside a known member, so it errs no higher than
      // content.
      changes.push(change("patch", "content"));
    } else {
      changes.push(compareValues(a[key], b[key]));
    }
  }
  return merged(changes);
}

const RULES: Readonly<Record<string, Rule>> = {
  schemaVersion: (before, after) =>
    before === after ? undefined : change("major", "schema"),
  artboard: artboardChange,
  background: backgroundChange,
  globals: globalsChange,
  assets: assetsChange,
  bindings: bindingsChange,
  metadata: metadataChange,
  scene: sceneChange,
};

export const CLASSIFIED_ENVELOPE_KEYS: readonly string[] = Object.keys(RULES);

/**
 * `id` is ignored because the diff only runs between documents already proven
 * to be the same item; an editor upgrade and a save move the other two.
 */
export const IGNORED_ENVELOPE_KEYS: readonly string[] = [
  "fabricVersion",
  "editorMetadata",
  "id",
];

const KNOWN_ENVELOPE_KEYS = new Set([
  ...CLASSIFIED_ENVELOPE_KEYS,
  ...IGNORED_ENVELOPE_KEYS,
]);

const LEVEL_ORDER: Readonly<Record<VersionLevel, number>> = {
  initial: 0,
  none: 0,
  patch: 1,
  minor: 2,
  major: 3,
};

/** The editor renders these in one fixed order; the classifier never writes prose. */
const REASON_ORDER: readonly ChangeReason[] = [
  "schema",
  "canvas",
  "sensor-removed",
  "sensor-added",
  "structure",
  "backdrop",
  "metadata",
  "content",
];

export function classifyThemeChange(
  previous: FabricThemeEnvelope | undefined,
  next: FabricThemeEnvelope,
): ThemeChange {
  if (previous === undefined) return { level: "initial", reasons: [] };
  const before = previous as unknown as Readonly<Record<string, unknown>>;
  const after = next as unknown as Readonly<Record<string, unknown>>;
  const fired = new Set<ChangeReason>();
  let level: VersionLevel = "none";
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    // A member this build does not know is a format change, so it errs upward.
    if (!KNOWN_ENVELOPE_KEYS.has(key)) {
      fired.add("schema");
      level = "major";
      continue;
    }
    const result = RULES[key]?.(before[key], after[key]);
    if (result === undefined) continue;
    if (LEVEL_ORDER[result.level] > LEVEL_ORDER[level]) level = result.level;
    for (const reason of result.reasons) fired.add(reason);
  }
  return { level, reasons: REASON_ORDER.filter((reason) => fired.has(reason)) };
}
