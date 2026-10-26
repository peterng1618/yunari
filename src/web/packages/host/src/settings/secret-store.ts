import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createOsKeyProtector, type KeyProtector } from "./os-key-protector.js";

/**
 * Secrets at rest, encrypted with one random data key per directory.
 *
 * The data key is wrapped by the OS protector (DPAPI or the Linux Secret
 * Service) and never written in the clear; each secret is AES-256-GCM with a
 * fresh IV, so a wrong key or a tampered byte refuses instead of yielding
 * empty credentials. There is no plaintext fallback: when the protector is
 * unavailable, a write throws.
 */
export interface SecretStore {
  available(): Promise<boolean>;
  read(name: string): Promise<Buffer | undefined>;
  write(name: string, bytes: Uint8Array): Promise<void>;
  remove(name: string): Promise<void>;
}

const KEY_FILE = "secret.key";
const KEY_VERSION = 1;
/** The name becomes a path component, so nothing else is accepted. */
const NAME = /^[A-Za-z0-9_-]{1,64}$/;
const DATA_KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MODE = 0o600;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readIfExists(file: string): Promise<Buffer | undefined> {
  try {
    return await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * The wrapped key's bytes, or nothing when the file is absent.
 *
 * An empty file wraps no key, so no secret can depend on it; it reads as
 * absent and the writer recreates it. A non-empty file that cannot be read as
 * `{ version: 1, wrapped }` throws: it may be a key every stored secret needs,
 * so it is not the same fact as "no key yet", and regenerating it would discard
 * those secrets.
 */
async function readWrappedKey(file: string): Promise<Buffer | undefined> {
  const raw = await readIfExists(file);
  if (raw === undefined || raw.length === 0) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    parsed = undefined;
  }

  if (isObject(parsed)) {
    const { version, wrapped } = parsed;
    if (version === KEY_VERSION && typeof wrapped === "string") {
      return Buffer.from(wrapped, "base64");
    }
  }

  throw new Error("The secret key file is unreadable.");
}

export function createSecretStore(
  directory: string,
  protector: KeyProtector = createOsKeyProtector(directory),
): SecretStore {
  const keyFile = path.join(directory, KEY_FILE);
  const fileFor = (name: string): string => path.join(directory, `${name}.bin`);
  const temporaryFor = (name: string): string =>
    `${fileFor(name)}.${randomBytes(6).toString("hex")}.tmp`;

  let cachedKey: Buffer | undefined;

  const unwrapKey = async (wrapped: Buffer): Promise<Buffer> => {
    const key = Buffer.from(await protector.unwrap(wrapped));
    if (key.length !== DATA_KEY_BYTES) {
      throw new Error("The OS key protector returned an unusable key.");
    }
    return key;
  };

  /**
   * The key this directory uses, creating `secret.key` when there is none.
   *
   * Creation is exclusive: a concurrent creator's file wins, and is unwrapped
   * rather than replaced, so two stores cannot end up with different keys.
   */
  const storeKey = async (): Promise<Buffer> => {
    if (cachedKey !== undefined) return cachedKey;

    const stored = await readWrappedKey(keyFile);
    if (stored !== undefined) {
      cachedKey = await unwrapKey(stored);
      return cachedKey;
    }

    const created = randomBytes(DATA_KEY_BYTES);
    const wrapped = Buffer.from(await protector.wrap(created));
    const body = `${JSON.stringify(
      { version: KEY_VERSION, wrapped: wrapped.toString("base64") },
      null,
      2,
    )}\n`;

    await mkdir(directory, { recursive: true });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await writeFile(keyFile, body, {
          encoding: "utf8",
          mode: MODE,
          flag: "wx",
        });
        cachedKey = created;
        return cachedKey;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;

        // A concurrent creator won, or the file that is there is the empty one
        // that wraps no key. Only the empty case may be replaced.
        const winner = await readWrappedKey(keyFile);
        if (winner !== undefined) {
          cachedKey = await unwrapKey(winner);
          return cachedKey;
        }

        await rm(keyFile, { force: true });
      }
    }

    throw new Error("The secret key file could not be created.");
  };

  // Reads and writes queue rather than overlap: on Windows a rename over a
  // file another handle holds open fails with EPERM instead of waiting. The
  // pattern is the one the other settings stores use.
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
    async available() {
      // The protector may reject a transient failure. Its own cache is already
      // cleared, so answering false keeps the `Promise<boolean>` contract and
      // lets the next call retry.
      if (!(await protector.available().catch(() => false))) return false;

      try {
        const wrapped = await readWrappedKey(keyFile);
        if (wrapped === undefined) return true;
        // An existing key that cannot be unwrapped makes the store unusable;
        // this call must not create one.
        if (cachedKey === undefined) cachedKey = await unwrapKey(wrapped);
        return true;
      } catch {
        return false;
      }
    },

    async read(name) {
      return exclusively(async () => {
        if (!NAME.test(name)) return undefined;

        const payload = await readIfExists(fileFor(name));
        if (payload === undefined) return undefined;

        const wrapped = await readWrappedKey(keyFile);
        if (wrapped === undefined) {
          // A stored secret without its key would otherwise read as "no
          // credentials" and silently sign the user out or mint a new CA.
          throw new Error(
            `Stored secret "${name}" exists but its secret key is missing.`,
          );
        }

        if (!(await protector.available())) {
          throw new Error(
            "The OS key protector is unavailable; cannot read a stored secret.",
          );
        }

        const key = cachedKey ?? (await unwrapKey(wrapped));
        cachedKey = key;

        if (payload.length < IV_BYTES + TAG_BYTES) {
          throw new Error(`Stored secret "${name}" is incomplete.`);
        }

        const iv = payload.subarray(0, IV_BYTES);
        const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
        const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES);

        try {
          const decipher = createDecipheriv("aes-256-gcm", key, iv);
          decipher.setAuthTag(tag);
          return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        } catch {
          // The error text never carries key or secret bytes.
          throw new Error(`Stored secret "${name}" failed authentication.`);
        }
      });
    },

    /**
     * Two instances writing the same name at once race at the rename on
     * Windows; each store owns its own names (Task 7.2), so that case is out
     * of scope here.
     */
    async write(name, bytes) {
      await exclusively(async () => {
        if (!NAME.test(name)) {
          throw new Error(`Invalid secret name "${name}".`);
        }

        if (!(await protector.available())) {
          throw new Error(
            "The OS key protector is unavailable; refusing to store a secret.",
          );
        }

        // A cached key is only good while the file that produced it is there:
        // read() would throw for an existing secret, and a write must not
        // succeed under a key the folder no longer holds.
        if (cachedKey !== undefined) {
          const wrapped = await readWrappedKey(keyFile);
          if (wrapped === undefined) {
            throw new Error(
              "The secret key file is missing; refusing to write with a stale key.",
            );
          }
        }

        const key = await storeKey();

        const iv = randomBytes(IV_BYTES);
        const cipher = createCipheriv("aes-256-gcm", key, iv);
        const ciphertext = Buffer.concat([
          cipher.update(bytes),
          cipher.final(),
        ]);
        const tag = cipher.getAuthTag();

        await mkdir(directory, { recursive: true });

        const temporary = temporaryFor(name);
        // A failed rename earlier leaves the previous body in the temporary
        // file; clear it rather than appending to it.
        await rm(temporary, { force: true });
        await writeFile(temporary, Buffer.concat([iv, tag, ciphertext]), {
          mode: MODE,
        });
        await rename(temporary, fileFor(name));
      });
    },

    async remove(name) {
      await exclusively(async () => {
        if (!NAME.test(name)) {
          throw new Error(`Invalid secret name "${name}".`);
        }

        // Missing is a no-op; an unwritable directory still raises.
        await rm(fileFor(name), { force: true });
      });
    },
  };
}
