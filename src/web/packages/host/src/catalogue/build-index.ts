import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type CatalogueEntry,
  type CatalogueIndex,
  DASHBOARD_THEME_KIND,
  type FacetRecord,
  facetRecordOf,
  isStoreItemKind,
  parseCatalogueIndex,
  parseCatalogueItemFile,
  readFabricThemeEnvelope,
  STORE_ITEM_KINDS,
} from "@yunari/renderer-core";
import { readThemePackage } from "@yunari/theme-package";
import { thumbnailLuminance } from "../themes/thumbnails.js";

/**
 * The catalogue listing's generator, run as a host command.
 *
 * It lives here rather than in `scripts/` because the reader's parser and the
 * facet record are `renderer-core` source, which only the built host can import
 * (`bin/yunari.js`). The output is the one file the editor fetches.
 */

/** One item's documents, as the walk read them — the header not yet validated. */
export interface CatalogueItem {
  readonly id: string;
  readonly item: unknown;
  /** The package's envelope. Only a dashboard theme has one; another kind's
   *  package is not a theme and is not read as one. */
  readonly theme?: unknown;
  /** The facets the authoring input stored for a kind with no envelope to
   *  derive them from. `facets_json` is the store's owner of the same fact. */
  readonly facets?: FacetRecord;
  /** The package picture's mean, measured the same way the library measures a
   *  stored picture, so both halves file a theme by the same reading. */
  readonly thumbnailLuminance?: number;
}

/** `YYYY-MM-DDTHH:MM:SS`, an optional fraction, then `Z` or `±HH:MM`. Presence
 *  is not enough: a value the reader cannot place makes the listing's age wrong. */
const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const USAGE =
  "usage: yunari-dashboard --build-catalogue-index <catalogueDir> --out <file> --generated-at <ISO>";

/**
 * The pure half: both documents validated, unreadable items excluded, entries
 * sorted by id so a regeneration that changed nothing writes identical bytes.
 * The command reports which items this dropped and why.
 */
export function catalogueIndexOf(
  items: readonly CatalogueItem[],
  generatedAt: string,
): CatalogueIndex {
  const entries: CatalogueEntry[] = [];
  for (const item of items) {
    const entry = entryOf(item);
    if (entry !== undefined) entries.push(entry);
  }
  entries.sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  return { generatedAt, entries };
}

/** One entry, or nothing when the header or the input cannot make one. */
function entryOf(item: CatalogueItem): CatalogueEntry | undefined {
  const file = parseCatalogueItemFile(item.item);
  if (!file.ok) return undefined;

  if (file.file.kind === DASHBOARD_THEME_KIND) {
    const validated = readFabricThemeEnvelope(item.theme);
    if (!validated.ok) return undefined;
    return {
      id: item.id,
      ...file.file,
      facets: facetRecordOf(validated.envelope, item.thumbnailLuminance),
    };
  }

  // Only a theme has an envelope to derive facets from; another kind files
  // itself by the record its authoring input stored.
  if (item.facets === undefined) return undefined;
  return { id: item.id, ...file.file, facets: item.facets };
}

/**
 * `undefined` for every command line that is not this one, so `run` falls
 * through to its own parser untouched.
 */
export async function buildCatalogueIndexCommand(
  argv: readonly string[],
): Promise<number | undefined> {
  if (argv[0] !== "--build-catalogue-index") return undefined;

  let directory: string | undefined;
  let out: string | undefined;
  let generatedAt: string | undefined;

  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--out" || argument === "--generated-at") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        console.error(`${argument} needs a value.\n${USAGE}`);
        return 1;
      }
      if (argument === "--out") out = value;
      else generatedAt = value;
      index += 1;
    } else if (argument?.startsWith("--") === true) {
      console.error(`Unknown option ${argument}.\n${USAGE}`);
      return 1;
    } else if (argument !== undefined && directory === undefined) {
      directory = argument;
    } else {
      console.error(`Unexpected argument ${argument ?? ""}.\n${USAGE}`);
      return 1;
    }
  }

  if (
    directory === undefined ||
    out === undefined ||
    generatedAt === undefined
  ) {
    console.error(
      `--build-catalogue-index needs <catalogueDir>, --out and --generated-at.\n${USAGE}`,
    );
    return 1;
  }

  if (!ISO_INSTANT.test(generatedAt) || Number.isNaN(Date.parse(generatedAt))) {
    console.error(
      `--generated-at must be an ISO 8601 instant, not "${generatedAt}".\n${USAGE}`,
    );
    return 1;
  }

  const names = await itemDirectories(directory);
  if (names === undefined) return 1;

  const items: CatalogueItem[] = [];
  // A kind this build does not ship is fatal: publishing the rest would leave
  // the item out of every client without anyone noticing.
  let unknownKind = false;
  for (const name of names) {
    try {
      const item = await readJson(path.join(directory, name, "item.json"));
      const declared = fieldOf(item, "kind");
      if (declared !== undefined && !isStoreItemKind(declared)) {
        console.error(
          `Refused catalogue/${name}: kind "${String(declared)}" is not a kind this build ships.`,
        );
        unknownKind = true;
        continue;
      }
      const header = parseCatalogueItemFile(item);
      if (!header.ok || header.file.kind !== DASHBOARD_THEME_KIND) {
        // Another kind's package is not a theme: its facets come from the
        // authoring input, and the index parse below validates them.
        const facets = fieldOf(item, "facets");
        items.push({
          id: name,
          item,
          ...(facets === undefined
            ? {}
            : { facets: facets as FacetRecord }),
        });
        continue;
      }
      // Option B: the package is the theme, beside `item.json`; a loose
      // `theme.json` would be a second copy that can drift.
      const bytes = await readBytes(path.join(directory, name, `${name}.zip`));
      const read = readThemePackage(bytes);
      if (!read.ok) {
        console.error(`Refused catalogue/${name}: ${read.message}`);
        continue;
      }
      // A package without a picture leaves the facet to the document, exactly
      // as a library theme without a capture does.
      const luminance =
        read.thumbnail === undefined
          ? undefined
          : thumbnailLuminance(read.thumbnail);
      items.push({
        id: name,
        item,
        theme: read.envelope,
        ...(luminance === undefined ? {} : { thumbnailLuminance: luminance }),
      });
    } catch (error) {
      console.error(`Refused catalogue/${name}: ${messageOf(error)}`);
    }
  }

  const index = catalogueIndexOf(items, generatedAt);
  const published = new Set(index.entries.map((entry) => entry.id));
  for (const item of items) {
    if (published.has(item.id)) continue;
    console.error(`Refused catalogue/${item.id}: ${refusalOf(item)}`);
  }

  if (unknownKind) return 1;

  // A catalogue that read items and kept none is a defect, not an honest empty
  // catalogue: publishing it would replace a good listing with nothing.
  if (names.length > 0 && index.entries.length === 0) {
    console.error(
      `Refused the generated index: ${names.length} catalogue director${
        names.length === 1 ? "y was" : "ies were"
      } refused.`,
    );
    return 1;
  }

  // The reader's own parser checks the generator's output with every kind this
  // build ships: a mistyped kind would otherwise be skipped by every client.
  const checked = parseCatalogueIndex(index, [...STORE_ITEM_KINDS]);
  if (checked.refused.length > 0) {
    for (const refusal of checked.refused) {
      const named =
        refusal.kind === undefined ? "an entry" : `kind "${refusal.kind}"`;
      console.error(
        `Refused the generated index: ${named} is ${
          refusal.reason === "unknown-kind"
            ? "not a kind this build ships"
            : "not the wire shape"
        } (${refusal.count}).`,
      );
    }
    return 1;
  }

  try {
    await writeFile(out, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  } catch (error) {
    console.error(`Cannot write ${out}: ${messageOf(error)}`);
    return 1;
  }
  return 0;
}

/** A missing or mistyped directory exits non-zero: writing an empty index over a
 *  typo would publish an empty catalogue. An existing empty one is honest. */
async function itemDirectories(
  directory: string,
): Promise<string[] | undefined> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    console.error(
      `Cannot read the catalogue directory ${directory}: ${messageOf(error)}`,
    );
    return undefined;
  }
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`${path.basename(file)}: ${messageOf(error)}`);
  }
}

async function readBytes(file: string): Promise<Uint8Array> {
  try {
    return await readFile(file);
  } catch (error) {
    throw new Error(`${path.basename(file)}: ${messageOf(error)}`);
  }
}

/** Why the pure half dropped this item, resolved only for the items it dropped. */
function refusalOf({ item, theme, facets }: CatalogueItem): string {
  const file = parseCatalogueItemFile(item);
  if (!file.ok) return file.reason;

  if (file.file.kind !== DASHBOARD_THEME_KIND) {
    return facets === undefined
      ? "item.json carries no facets and this kind has no theme to derive them from."
      : "item.json and its facets could not make an entry.";
  }

  const validated = readFabricThemeEnvelope(theme);
  if (validated.ok) {
    return "item.json and the package's theme could not make an entry.";
  }
  const issue = validated.issues[0];
  return issue === undefined
    ? "The package's theme is not a theme this build can read."
    : `${issue.path === "" ? "/" : issue.path} ${issue.message}`;
}

/** A field's own value, never an inherited one. */
function fieldOf(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return Object.hasOwn(value, key)
    ? (value as Readonly<Record<string, unknown>>)[key]
    : undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
