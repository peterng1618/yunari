import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { createSecretStore, type SecretStore } from "./secret-store.js";

/**
 * The store session the host holds after signing in through the Worker's
 * social flow, beside the other settings as `store-session.bin`.
 *
 * The bytes are encrypted under a key the OS facility wraps: a copy of the file
 * taken to another account or machine, or swept into a backup, no longer yields
 * the token. That is the difference from the mode-0600 plaintext file this
 * replaced, where the file was the secret and its permissions the only control.
 * The token is never logged, never sent to the browser, and goes only to the
 * store and the `Authorization` header.
 */

export interface StoreSession {
  /** The Worker's session token. Never log it. */
  readonly token: string;
  /** Better Auth's `user.id`, as `/api/me` reports it. */
  readonly userId: string;
  readonly email: string;
  /** An ISO instant. */
  readonly obtainedAt: string;
}

export interface StoreSessionStore {
  /** The stored session, or nothing when there is none to use. */
  read(): Promise<StoreSession | undefined>;
  write(session: StoreSession): Promise<void>;
  /** Forget the session, on sign-out or a refused token. */
  clear(): Promise<void>;
}

const SECRET = "store-session";
/** The pre-encryption file, migrated once on first read and then removed. */
const LEGACY_FILE = "store-session.json";
/** The superseded GitHub device-flow token; deleted the first time a store
 *  session is written, since nothing reads it any more. */
const LEGACY_GITHUB_TOKEN = "github-token.json";

/**
 * Four usable strings, or nothing.
 *
 * A token without the account it acts as cannot be reported honestly, so a bad
 * file reads as no session rather than being coerced into one.
 */
function asSession(value: unknown): StoreSession | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const { token, userId, email, obtainedAt } = value as Record<string, unknown>;

  if (
    typeof token !== "string" ||
    token === "" ||
    typeof userId !== "string" ||
    userId === "" ||
    typeof email !== "string" ||
    email === "" ||
    typeof obtainedAt !== "string" ||
    Number.isNaN(Date.parse(obtainedAt))
  ) {
    return undefined;
  }

  return { token, userId, email, obtainedAt };
}

function decode(bytes: Buffer): StoreSession | undefined {
  try {
    return asSession(JSON.parse(bytes.toString("utf8")));
  } catch {
    return undefined;
  }
}

function encode(session: StoreSession): Buffer {
  return Buffer.from(`${JSON.stringify(session, null, 2)}\n`, "utf8");
}

/**
 * The legacy file's session, or nothing when it is absent, unreadable or not
 * four usable strings. Content this reader cannot use is left in place.
 */
async function readLegacy(file: string): Promise<StoreSession | undefined> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return undefined;
  }

  try {
    return asSession(JSON.parse(text));
  } catch {
    return undefined;
  }
}

export function createStoreSessionStore(
  directory: string,
  secrets: SecretStore = createSecretStore(directory),
): StoreSessionStore {
  const legacyFile = path.join(directory, LEGACY_FILE);

  /**
   * The session, migrating the plaintext file on first read.
   *
   * The encrypted write comes first and the removal second: a write that throws
   * (unavailable protector, missing key) leaves the plaintext where a later run
   * can still migrate it. A present `.bin` that cannot be read throws from the
   * secret store rather than answering "no session".
   */
  const readAll = async (): Promise<StoreSession | undefined> => {
    const stored = await secrets.read(SECRET);
    if (stored !== undefined) return decode(stored);

    const legacy = await readLegacy(legacyFile);
    if (legacy === undefined) return undefined;

    await secrets.write(SECRET, encode(legacy));
    await rm(legacyFile, { force: true });
    return legacy;
  };

  let running: Promise<unknown> = Promise.resolve();
  const exclusively = <T>(work: () => Promise<T>): Promise<T> => {
    const next = running.then(work, work);
    running = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  return {
    read: () => exclusively(readAll),

    async write(session) {
      await exclusively(async () => {
        const valid = asSession(session);
        if (valid === undefined) {
          throw new Error(
            "Invalid store session: token, userId and email must be non-empty, and obtainedAt an instant.",
          );
        }

        await secrets.write(SECRET, encode(valid));

        // Only after the ciphertext landed. The pre-encryption file and a
        // failed rename's temporary are plaintext tokens, and the old
        // device-flow token has no migration: a successful store sign-in is
        // the moment its plaintext `public_repo` grant stops being needed.
        await rm(legacyFile, { force: true });
        await rm(`${legacyFile}.tmp`, { force: true });
        await rm(path.join(directory, LEGACY_GITHUB_TOKEN), { force: true });
      });
    },

    async clear() {
      await exclusively(async () => {
        // Both halves: a failed write leaves a temporary beside the target, and
        // signing out has to mean the token is gone.
        await secrets.remove(SECRET);
        await rm(legacyFile, { force: true });
        await rm(`${legacyFile}.tmp`, { force: true });
      });
    },
  };
}
