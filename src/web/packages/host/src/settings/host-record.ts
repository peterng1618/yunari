import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEVICE_ID_PATTERN } from "./devices.js";

/**
 * Which host this app folder is: the id a display stores so a re-find matches
 * its own host and not another.
 *
 * The id is unique, not secret. `GET /api/host` answers it to anyone who asks,
 * and what it defends is a display attaching to the wrong host on a shared
 * network — a guessable-but-unique id already prevents that, and an id that had
 * to stay secret could not be answered publicly at all.
 *
 * `hosting.json` beside it is the LAN on/off setting, a different owner; the
 * record says which host this is, and the two names are kept apart on purpose.
 */

export interface HostRecord {
  readonly id: string;
  readonly name: string;
}

const FILE = "host-identity.json";
/** A name is displayed rather than used as a key, so it is only length-bounded. */
const MAX_NAME_LENGTH = 64;

/**
 * A name worth showing: trimmed, bounded, and absent when it says nothing.
 *
 * One owner for the rule, because a stored name and this PC's hostname reach the
 * same field: bounding only the stored one lets a long hostname be written whole
 * and then truncated on the next read, so the name a display is served would
 * change between two runs of the same host.
 */
function usableName(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const name = value.trim().slice(0, MAX_NAME_LENGTH);

  return name.length > 0 ? name : undefined;
}

/**
 * The stored half that is usable: an id a display could store, and a name worth
 * showing. Each half stands alone, because the id is what a paired display
 * remembers — re-minting it over a bad name would orphan every display.
 */
function readStored(input: unknown): { id?: string; name?: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {};
  }

  const record = input as Record<string, unknown>;
  const id = record["id"];
  const name = usableName(record["name"]);

  return {
    ...(typeof id === "string" && DEVICE_ID_PATTERN.test(id) ? { id } : {}),
    ...(name === undefined ? {} : { name }),
  };
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    // No file yet, or an unreadable one: the first run, which mints.
    return undefined;
  }
}

/** Reads the folder's host record, minting and persisting one on first run. */
export async function readOrMintHostRecord(
  settingsDir: string,
  options: { readonly hostname?: () => string } = {},
): Promise<HostRecord> {
  const hostname = options.hostname ?? os.hostname;
  const file = path.join(settingsDir, FILE);
  const stored = readStored(await readJson(file));

  if (stored.id !== undefined && stored.name !== undefined) {
    return { id: stored.id, name: stored.name };
  }

  // A half-usable record is written whole, so the file a later run reads is one
  // a display could store and a person could read.
  const record: HostRecord = {
    id: stored.id ?? randomBytes(8).toString("hex"),
    name: stored.name ?? usableName(hostname()) ?? "",
  };

  await mkdir(settingsDir, { recursive: true });
  // Written beside the target and renamed over it, so a crash mid-write leaves
  // the previous record rather than a truncated one.
  const temporary = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await rename(temporary, file);

  return record;
}
