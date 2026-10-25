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
/** The pre-encryption file, migrated once on first read and then removed. */
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
 * The legacy file's validated contents, or nothing when it is absent or is not
 * JSON. Unreadable content is left alone: only what this reader understood is
 * ever deleted after its encrypted copy lands.
 */
async function readLegacy(
  file: string,
): Promise<Record<string, StoredCredential> | undefined> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return undefined;
  }

  try {
    return normalizeCredentials(JSON.parse(text));
  } catch {
    return undefined;
  }
}

export function createCredentialStore(
  directory: string,
  secrets: SecretStore = createSecretStore(directory),
): CredentialStore {
  const legacyFile = path.join(directory, LEGACY_FILE);

  /**
   * Every credential, migrating the plaintext file on first read.
   *
   * The encrypted write comes first and the removal second: a write that throws
   * (unavailable protector, missing key) leaves the plaintext where a later run
   * can still migrate it. A present `.bin` that cannot be read throws from the
   * secret store rather than being treated as "no credentials".
   */
  const readAll = async (): Promise<Record<string, StoredCredential>> => {
    const stored = await secrets.read(SECRET);
    if (stored !== undefined) return decode(stored);

    const legacy = await readLegacy(legacyFile);
    if (legacy === undefined) return {};

    await secrets.write(SECRET, encode(legacy));
    await rm(legacyFile, { force: true });
    return legacy;
  };

  const save = async (all: Record<string, StoredCredential>): Promise<void> => {
    await secrets.write(SECRET, encode(all));
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
      });
    },

    async clear(id) {
      await writeExclusively(async () => {
        if (!CREDENTIAL_ID.test(id)) return;

        const all = await readAll();
        // Nothing to remove is no write: a document without the id is already
        // the file that is there, and saving it would rewrite the ciphertext.
        // `Object.hasOwn` because `__proto__` is a legal id and `in` walks
        // the prototype chain.
        if (!Object.hasOwn(all, id)) return;

        delete all[id];
        await save(all);
      });
    },
  };
}
