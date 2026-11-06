/** Which property a path preset's paint belongs on: an open curve is stroked,
 *  a closed path encloses a region and is filled. */
export type PathPresetPaint = "stroke" | "fill";

/** One custom shape: SVG path data plus which property its paint belongs on. */
export interface PathPreset {
  readonly id: string;
  readonly label: string;
  readonly data: string;
  readonly paint: PathPresetPaint;
}

/** A pack file as an author ships it: one named list of path presets. */
export interface PathPresetPack {
  readonly format: "yunari-path-preset-pack";
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  readonly presets: readonly PathPreset[];
}

/** The presets a host serves: built-ins the author kept, then stored rows. */
export interface PathPresetState {
  readonly version: 1;
  readonly presets: readonly PathPreset[];
  readonly removedBuiltins: readonly string[];
  readonly migrated: boolean;
}

export const MAX_PATH_PRESET_COUNT = 1000;
export const MAX_PATH_PRESET_NAME_LENGTH = 200;
export const MAX_PATH_PRESET_DATA_LENGTH = 200_000;

const FORMAT = "yunari-path-preset-pack";
const VERSION = 1;

/** A pack or preset id is one segment of a stored row (`pack:<pack>:<preset>`),
 *  so no `:` — or any separator a removal prefix could be confused by. */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;

/**
 * The shapes every editor ships, in the order the Add pane offers them.
 *
 * This is the one owner of their data and labels: the editor derives its
 * catalogue and `uiCopy` from here, and the host passes the same list to its
 * store. A second spelling would let the two drift apart silently.
 */
export const BUILTIN_PATH_PRESETS = [
  {
    id: "line",
    label: "Horizontal line",
    data: "M 0 100 L 360 100",
    paint: "stroke",
  },
  {
    id: "arc",
    label: "Arc",
    data: "M 200 0 A 200 200 0 0 1 0 200",
    paint: "stroke",
  },
  {
    id: "wedge",
    label: "Wedge",
    data: "M 0 0 L 200 0 A 200 200 0 0 1 0 200 Z",
    paint: "fill",
  },
] as const satisfies readonly PathPreset[];

export type PathPresetPackResult =
  | { readonly ok: true; readonly pack: PathPresetPack }
  | { readonly ok: false; readonly message: string };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): PathPresetPackResult {
  return { ok: false, message };
}

/**
 * A pack file, read structurally and within bounds.
 *
 * The reader does not parse path data — it has no Fabric dependency, and
 * drawability is `pathPresetGeometry`'s rule. It refuses a document whose
 * format, version, names, preset ids or paint it cannot account for, so a
 * caller can validate before writing anything.
 */
export function readPathPresetPack(value: unknown): PathPresetPackResult {
  if (!isRecord(value)) {
    return fail("A path preset pack must be a JSON object.");
  }
  if (value["format"] !== FORMAT) {
    return fail("Unsupported path preset pack format.");
  }
  if (value["version"] !== VERSION) {
    return fail("Unsupported path preset pack version.");
  }

  const id = readId(value["id"]);
  if (id === undefined) {
    return fail(
      "A path preset pack needs an id of 1-200 letters, digits, - or _.",
    );
  }
  const name = readName(value["name"]);
  if (name === undefined) {
    return fail("A path preset pack needs a name of at most 200 characters.");
  }

  const declared = value["presets"];
  if (!Array.isArray(declared)) {
    return fail("A path preset pack needs a list of presets.");
  }
  if (declared.length > MAX_PATH_PRESET_COUNT) {
    return fail(
      `A path preset pack may hold at most ${MAX_PATH_PRESET_COUNT} presets.`,
    );
  }

  const presets: PathPreset[] = [];
  const seen = new Set<string>();
  for (const entry of declared) {
    if (!isRecord(entry)) {
      return fail("A path preset must be an object.");
    }
    const presetId = readId(entry["id"]);
    if (presetId === undefined) {
      return fail(
        "A path preset needs an id of 1-200 letters, digits, - or _.",
      );
    }
    if (seen.has(presetId)) {
      return fail(
        `The path preset id "${presetId}" appears twice in the pack.`,
      );
    }
    seen.add(presetId);

    const label = readName(entry["label"]);
    if (label === undefined) {
      return fail("A path preset needs a label of at most 200 characters.");
    }
    const data = entry["data"];
    if (
      typeof data !== "string" ||
      data.length > MAX_PATH_PRESET_DATA_LENGTH ||
      data.trim() === ""
    ) {
      return fail(
        "A path preset needs non-empty data of at most 200000 characters.",
      );
    }
    const paint = entry["paint"];
    if (paint !== "stroke" && paint !== "fill") {
      return fail('A path preset paint must be "stroke" or "fill".');
    }

    presets.push({ id: presetId, label, data: data.trim(), paint });
  }

  return {
    ok: true,
    pack: { format: FORMAT, version: VERSION, id, name, presets },
  };
}

/** A trimmed, non-blank, bounded name — or undefined when it is not one. */
function readName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" || trimmed.length > MAX_PATH_PRESET_NAME_LENGTH
    ? undefined
    : trimmed;
}

/** An id that is one safe segment of a stored row id. */
function readId(value: unknown): string | undefined {
  return typeof value === "string" && ID_PATTERN.test(value)
    ? value
    : undefined;
}
