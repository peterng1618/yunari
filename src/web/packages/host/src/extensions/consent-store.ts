import type { ConsentFile, ConsentRecord } from "@yunari/extension-api";
import { createJsonFile } from "../settings/json-file.js";

/**
 * The grants this PC's owner has given, keyed by qualified plugin key.
 *
 * `grantedAt` is part of the record rather than a clock read here: a caller
 * that already showed the user the grant is what knows when it was accepted,
 * and deterministic callers (tests, a clock the host controls) must not have a
 * second time source. The store only records what it is told.
 */
export interface ConsentStore {
  read(): Promise<ConsentFile>;
  grant(record: ConsentRecord): Promise<ConsentFile>;
  revoke(pluginKey: string): Promise<ConsentFile>;
}

const FILE = "extension-consent.json";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(key: string, value: unknown): ConsentRecord {
  const matter = `entry ${JSON.stringify(key)}`;

  if (!isRecord(value)) {
    throw new Error(`Consent file refused: ${matter} is not an object.`);
  }

  const { pluginKey, version, fingerprint, grantedAt } = value;

  if (
    typeof pluginKey !== "string" ||
    typeof version !== "string" ||
    typeof fingerprint !== "string" ||
    typeof grantedAt !== "string"
  ) {
    throw new Error(
      `Consent file refused: ${matter} does not name a plugin, version, fingerprint and grant time.`,
    );
  }

  return { pluginKey, version, fingerprint, grantedAt };
}

/**
 * Refuses a file this store did not write. A grant is a security decision, so
 * an unreadable shape is an error a mutator surfaces rather than a file it
 * rewrites on the user's behalf.
 */
export function normalizeConsentFile(parsed: unknown): ConsentFile {
  if (!isRecord(parsed) || parsed["version"] !== 1) {
    throw new Error("Consent file refused: it is not version 1.");
  }

  const plugins = parsed["plugins"];

  if (!isRecord(plugins)) {
    throw new Error("Consent file refused: plugins is not a record.");
  }

  const records: Record<string, ConsentRecord> = {};

  for (const [key, value] of Object.entries(plugins)) {
    records[key] = readRecord(key, value);
  }

  return { version: 1, plugins: records };
}

export function createConsentStore(directory: string): ConsentStore {
  const stored = createJsonFile<ConsentFile>(directory, FILE, {
    normalize: normalizeConsentFile,
    empty: () => ({ version: 1, plugins: {} }),
  });

  return {
    read() {
      return stored.read();
    },

    grant(record) {
      return stored.mutate((current) => {
        const next: ConsentFile = {
          version: 1,
          plugins: { ...current.plugins, [record.pluginKey]: record },
        };
        return { next, result: next };
      });
    },

    revoke(pluginKey) {
      return stored.mutate((current) => {
        const plugins = { ...current.plugins };
        delete plugins[pluginKey];
        const next: ConsentFile = { version: 1, plugins };
        return { next, result: next };
      });
    },
  };
}
