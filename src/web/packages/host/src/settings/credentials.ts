import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { createSecretStore, type SecretStore } from "./secret-store.js";

/**
 * Provider credentials, written beside the host's other settings.
 *
 * The browser is write-only here: a route may store a value, and the read it
 * gets back carries `set` and a four-character hint, never the value. A source
 * receives the value only inside the host process, through `SourceContext`.
 *
 * The bytes live in the encrypted secret store, under `credentials.bin`: the
 * document is the same one the plaintext file held, encrypted with the OS-wrapped
 * key, so a copied folder or backup does not yield the keys.
 */
export interface StoredCredential {
  readonly value: string;
  /** An ISO instant. */
  readonly savedAt: string;
}

export interface CredentialStore {
  /** Every entry, keyed by credential id. A bad entry is dropped, not fatal. */
  read(): Promise<Readonly<Record<string, StoredCredential>>>;
  valueOf(id: string): Promise<string | undefined>;
  write(id: string, value: string, savedAt: Date): Promise<void>;
  clear(id: string): Promise<void>;
}

/** The last four characters, and never more: the only part a browser sees. */
export function hintOf(value: string): string {
  return value.slice(-4);
}

const SECRET = "credentials";
/**
 * The ids the owner cleared, so a leftover legacy file cannot serve them again.
 * Encrypted like the credentials themselves; see `readRetired`.
 */
const RETIRED = "credentials-retired";
/** The newest tombstones kept, counting only clears that retired something. */
const RETIRED_LIMIT = 256;
/**
 * The pre-encryption file. A document that validates whole is migrated and
 * removed on the first read whose removal succeeds; one that does not is kept
 * until its owner repairs it, when the next read migrates and removes it.
 */
const LEGACY_FILE = "credentials.json";
const CREDENTIAL_ID = /^[A-Za-z0-9_-]{1,64}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One entry, or nothing when it is not a non-empty value with a real instant.
 *
 * A hand-edited file must not blank the whole map, so a bad entry is dropped
 * rather than failing the read.
 */
function asCredential(value: unknown): StoredCredential | undefined {
  if (!isObject(value)) return undefined;

  const { value: secret, savedAt } = value;

  if (typeof secret !== "string" || secret === "") return undefined;
  if (typeof savedAt !== "string" || Number.isNaN(Date.parse(savedAt))) {
    return undefined;
  }

  return { value: secret, savedAt };
}

/**
 * The document's contents, with every key held to `CREDENTIAL_ID` and every
 * entry validated. Built through `Object.fromEntries` for the same reason
 * `theme-origins.ts` is: `__proto__` is a legal id, and assignment would reach
 * the map's prototype instead of storing the entry.
 */
function normalizeCredentials(
  input: unknown,
): Record<string, StoredCredential> {
  if (!isObject(input)) return {};

  const pairs: [string, StoredCredential][] = [];

  for (const [id, raw] of Object.entries(input)) {
    if (!CREDENTIAL_ID.test(id)) continue;

    const entry = asCredential(raw);
    if (entry) pairs.push([id, entry]);
  }

  return Object.fromEntries(pairs);
}

function decode(bytes: Buffer): Record<string, StoredCredential> {
  try {
    return normalizeCredentials(JSON.parse(bytes.toString("utf8")));
  } catch {
    // The authenticated bytes are not a document this reader understands; the
    // same read of the plaintext file answered with no credentials.
    return {};
  }
}

function encode(all: Record<string, StoredCredential>): Buffer {
  return Buffer.from(`${JSON.stringify(all, null, 2)}\n`, "utf8");
}

/**
 * The legacy file's parsed document, or undefined when it is absent or is not
 * JSON. Returned whole: the caller decides what validates and whether the
 * document may be migrated.
 */
async function readLegacy(file: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * The document when every part of it would survive normalization, else nothing.
 *
 * Migrating a partly valid document would delete the rejected entries from the
 * only place their values exist, so such a file is left for its owner to repair
 * and the next read retries. A valid JSON non-object validates nothing whole.
 */
function wholeDocument(
  input: unknown,
): Record<string, StoredCredential> | undefined {
  if (!isObject(input)) return undefined;

  for (const [id, raw] of Object.entries(input)) {
    if (!CREDENTIAL_ID.test(id) || asCredential(raw) === undefined) {
      return undefined;
    }
  }

  return normalizeCredentials(input);
}

/** The entries whose id is not in `retired`, as a fresh document. */
function without(
  all: Record<string, StoredCredential>,
  retired: ReadonlySet<string>,
): Record<string, StoredCredential> {
  return Object.fromEntries(
    Object.entries(all).filter(([id]) => !retired.has(id)),
  );
}

/** `stored` wins a shared id; `legacy` contributes only the ids it alone holds. */
function merge(
  legacy: Record<string, StoredCredential>,
  stored: Record<string, StoredCredential>,
): Record<string, StoredCredential> {
  return Object.fromEntries([
    ...Object.entries(legacy),
    ...Object.entries(stored),
  ]);
}

export function createCredentialStore(
  directory: string,
  secrets: SecretStore = createSecretStore(directory),
): CredentialStore {
  const legacyFile = path.join(directory, LEGACY_FILE);

  /** The legacy document when it would migrate whole, and nothing otherwise. */
  const wholeLegacy = async (): Promise<
    Record<string, StoredCredential> | undefined
  > => {
    const legacy = await readLegacy(legacyFile);
    return legacy === undefined ? undefined : wholeDocument(legacy);
  };

  /**
   * The ids the owner cleared, oldest first.
   *
   * An absent set is the empty set. A set that has bytes but will not decrypt
   * throws out of `secrets.read`, as a credential's would: "I cannot read which
   * ids were retired" is not "nothing was retired". Decrypted bytes that are
   * not a list of credential ids read as the empty set, the same lenient rule
   * `decode` applies to the stored document.
   */
  const readRetired = async (): Promise<string[]> => {
    const bytes = await secrets.read(RETIRED);
    if (bytes === undefined) return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];

    const seen = new Set<string>();
    const ids: string[] = [];
    for (const id of parsed) {
      if (typeof id === "string" && CREDENTIAL_ID.test(id) && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
    return ids.slice(-RETIRED_LIMIT);
  };

  const writeRetired = async (ids: readonly string[]): Promise<void> => {
    await secrets.write(
      RETIRED,
      Buffer.from(`${JSON.stringify(ids)}\n`, "utf8"),
    );
  };

  /**
   * Whether `id` could still come back, so its clear needs a tombstone.
   *
   * True when the stored credentials still hold it, when the legacy file names
   * it, and when the legacy file exists but cannot be read — there is no way to
   * rule it out, and an unreadable file is exactly what the tombstone guards.
   * A file that reads as a document this reader would never merge cannot serve
   * the id again, so it does not count.
   */
  const couldReturn = async (id: string): Promise<boolean> => {
    const stored = await secrets.read(SECRET);
    if (stored !== undefined && Object.hasOwn(decode(stored), id)) return true;

    let text: string;
    try {
      text = await readFile(legacyFile, "utf8");
    } catch (error) {
      // Absent is the one answer that rules it out.
      return (error as NodeJS.ErrnoException).code !== "ENOENT";
    }

    try {
      const parsed = JSON.parse(text);
      return isObject(parsed) ? Object.hasOwn(parsed, id) : false;
    } catch {
      return false;
    }
  };

  /**
   * Record `id` as cleared, newest last.
   *
   * Only the newest `RETIRED_LIMIT` tombstones are kept, dropping the oldest
   * first. `clear` checks `couldReturn` first, so the cap counts clears that
   * retired something and a run of no-op clears cannot evict a real tombstone.
   * Dropping the oldest can only let a leftover legacy file re-add an id that
   * has already been gone for that many real clears.
   */
  const retire = async (id: string): Promise<void> => {
    const ids = (await readRetired()).filter((other) => other !== id);
    ids.push(id);
    await writeRetired(ids.slice(-RETIRED_LIMIT));
  };

  /** An explicit save re-authorizes the id; this is the only way back. */
  const unretire = async (id: string): Promise<void> => {
    const ids = await readRetired();
    if (!ids.includes(id)) return;
    await writeRetired(ids.filter((other) => other !== id));
  };

  /**
   * Every credential: the encrypted copy, plus a merge of any legacy file.
   *
   * The stored document is authoritative. A whole legacy document found beside
   * it contributes only the ids the store does not already hold, so a repaired
   * entry migrates while a newer saved value or a clear is never undone;
   * retired ids are excluded from the merge and from the answer. The merged
   * write comes first and the removal second: a write that throws (unavailable
   * protector, missing key) leaves the plaintext where a later run can still
   * merge it, and a removal that fails is retried next read. A document that
   * does not validate whole is kept for its owner to repair. A present `.bin`
   * that cannot be read throws from the secret store rather than being treated
   * as "no credentials".
   */
  const readAll = async (): Promise<Record<string, StoredCredential>> => {
    const retired = new Set(await readRetired());
    const stored = await secrets.read(SECRET);
    if (stored !== undefined) {
      const current = decode(stored);
      const whole = await wholeLegacy();
      const live = without(
        whole === undefined ? current : merge(whole, current),
        retired,
      );

      // One write covers both a repaired legacy id merged in and a clear a
      // crash left recorded only by its tombstone.
      if (JSON.stringify(current) !== JSON.stringify(live)) {
        await secrets.write(SECRET, encode(live));
      }
      if (whole !== undefined) {
        await rm(legacyFile, { force: true }).catch(() => undefined);
      }
      return live;
    }

    const legacy = await readLegacy(legacyFile);
    if (legacy === undefined) return {};

    const answer = without(normalizeCredentials(legacy), retired);
    const whole = wholeDocument(legacy);
    if (whole === undefined) return answer;

    await secrets.write(SECRET, encode(without(whole, retired)));
    // The same retry rule as above; the encrypted write already succeeded.
    await rm(legacyFile, { force: true }).catch(() => undefined);
    return answer;
  };

  const save = async (all: Record<string, StoredCredential>): Promise<void> => {
    await secrets.write(SECRET, encode(all));
    // The write path's retirement uses the read path's predicate: a broken
    // hand-edit is never the thing a save destroys. A removal that fails here
    // is retried by the next read, so it does not fail the save.
    if ((await wholeLegacy()) !== undefined) {
      await rm(legacyFile, { force: true }).catch(() => undefined);
    }
  };

  let writing: Promise<unknown> = Promise.resolve();
  const writeExclusively = <T>(work: () => Promise<T>): Promise<T> => {
    const next = writing.then(work, work);
    writing = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  return {
    async read() {
      return writeExclusively(readAll);
    },

    async valueOf(id) {
      return writeExclusively(async () => {
        if (!CREDENTIAL_ID.test(id)) return undefined;

        return (await readAll())[id]?.value;
      });
    },

    async write(id, value, savedAt) {
      await writeExclusively(async () => {
        if (!CREDENTIAL_ID.test(id)) {
          throw new Error(`Invalid credential id "${id}".`);
        }

        const all = await readAll();
        await save(
          normalizeCredentials({
            ...all,
            [id]: { value, savedAt: savedAt.toISOString() },
          }),
        );
        // After the stored write: a save whose tombstone removal fails is still
        // persisted, and retrying the save finishes the re-authorization.
        await unretire(id);
      });
    },

    async clear(id) {
      await writeExclusively(async () => {
        if (!CREDENTIAL_ID.test(id)) return;

        // Only an id that could come back earns a tombstone: a no-op clear
        // that wrote one could push a real tombstone out of the cap. The
        // tombstone still lands before the stored removal, so a crash between
        // the two leaves the id retired.
        if (!(await couldReturn(id))) return;

        await retire(id);
        // The read hides it and purges it from `.bin` when it was still there.
        await readAll();
      });
    },
  };
}
