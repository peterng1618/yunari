import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCredentialStore, hintOf } from "./credentials.js";
import type { KeyProtector } from "./os-key-protector.js";
import { createSecretStore, type SecretStore } from "./secret-store.js";

/** The pre-encryption file a hand-edited install would have. */
const legacyFile = (dir: string) => path.join(dir, "credentials.json");
/** The encrypted secret, `<name>.bin` as the secret store names it. */
const secretFile = (dir: string) => path.join(dir, "credentials.bin");

/**
 * Holds a real Windows share lock on `file`: readers are allowed, deletion is
 * refused. A Node handle cannot express this (every Node open shares delete),
 * and only Windows refuses to unlink a file another handle holds, so callers
 * skip on other platforms rather than mocking the removal.
 */
async function holdForReading(file: string): Promise<() => Promise<void>> {
  const literal = file.replace(/'/g, "''");
  const script =
    `$f=[IO.File]::Open('${literal}','Open','Read','Read');` +
    "[Console]::Out.WriteLine('held');[Console]::In.ReadLine()|Out-Null;" +
    "$f.Dispose()";

  const child = spawn(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { stdio: ["pipe", "pipe", "ignore"], windowsHide: true },
  );

  await new Promise<void>((resolve, reject) => {
    child.stdout.once("data", () => resolve());
    child.once("error", reject);
    child.once("exit", (code) =>
      reject(new Error(`the lock process exited with ${String(code)}`)),
    );
  });

  return () =>
    new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.stdin.end("release\n");
    });
}

/**
 * The store's format is what these cases prove, so the protector is a
 * reversible transform rather than DPAPI; no case here spawns a child.
 */
function createFakeProtector(usable = true): KeyProtector {
  return {
    async available() {
      return usable;
    },
    async wrap(key: Uint8Array) {
      return Uint8Array.from(key, (byte) => byte ^ 0x5a);
    },
    async unwrap(wrapped: Uint8Array) {
      return Uint8Array.from(wrapped, (byte) => byte ^ 0x5a);
    },
  };
}

const savedAt = new Date("2026-10-21T09:00:00.000Z");
const stored = { value: "sk-live-9f2c", savedAt: "2026-10-21T09:00:00.000Z" };

describe("credentials", () => {
  let dir: string;
  let secrets: SecretStore;
  let store: ReturnType<typeof createCredentialStore>;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "yunari-credentials-"));
    secrets = createSecretStore(dir, createFakeProtector());
    store = createCredentialStore(dir, secrets);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function seed(contents: string): Promise<void> {
    await writeFile(legacyFile(dir), contents, "utf8");
  }

  it("reads an absent file as no credentials", async () => {
    expect(await store.read()).toEqual({});
  });

  it("writes the encrypted file owner-only wherever the platform honours a mode", async () => {
    // Windows has no POSIX mode; on the platforms that do, a file holding
    // provider keys must not be group- or world-readable.
    if (process.platform === "win32") return;

    await store.write("fontawesome", "sk-live-9f2c", savedAt);

    expect((await stat(secretFile(dir))).mode & 0o077).toBe(0);
  });

  it("writes one credential and reads it back with its ISO instant", async () => {
    await store.write("fontawesome", "sk-live-9f2c", savedAt);

    expect(await store.read()).toEqual({ fontawesome: stored });
    expect(await store.valueOf("fontawesome")).toBe("sk-live-9f2c");
  });

  it("answers undefined for a credential it has not stored", async () => {
    expect(await store.valueOf("fontawesome")).toBeUndefined();
  });

  it("clears one credential and leaves the others", async () => {
    await store.write("one", "value-one", savedAt);
    await store.write("two", "value-two", savedAt);

    await store.clear("one");

    expect(await store.read()).toEqual({
      two: { value: "value-two", savedAt: "2026-10-21T09:00:00.000Z" },
    });
  });

  it("serializes overlapping writes so neither credential is lost", async () => {
    await Promise.all([
      store.write("left", "value-left", savedAt),
      store.write("right", "value-right", savedAt),
    ]);

    expect(Object.keys(await store.read()).sort()).toEqual(["left", "right"]);
  });

  it("drops bad entries and keeps a __proto__ key as an entry", async () => {
    await seed(
      JSON.stringify(
        Object.fromEntries([
          ["good", stored],
          ["__proto__", stored],
          ["numbered", { value: 7, savedAt: "2026-10-21T09:00:00.000Z" }],
          ["empty", { value: "", savedAt: "2026-10-21T09:00:00.000Z" }],
          ["undated", { value: "value", savedAt: "not a date" }],
          ["nulled", null],
        ]),
      ),
    );

    const read = await store.read();

    expect(read.good).toEqual(stored);
    expect(Object.hasOwn(read, "__proto__")).toBe(true);
    expect(read["__proto__"]).toEqual(stored);
    expect(Object.getPrototypeOf(read)).toBe(Object.prototype);
    expect(Object.keys(read).sort()).toEqual(["__proto__", "good"]);

    // A document with a rejected entry is not migrated and not deleted: the
    // rejected value exists nowhere else, so the owner has to repair it.
    expect(await readFile(legacyFile(dir), "utf8")).toContain("sk-live-9f2c");
    await expect(readFile(secretFile(dir))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("migrates a broken document once the rejected entry is repaired", async () => {
    await seed(
      JSON.stringify({
        good: stored,
        empty: { value: "", savedAt: savedAt.toISOString() },
      }),
    );

    expect(await store.read()).toEqual({ good: stored });
    await expect(readFile(secretFile(dir))).rejects.toMatchObject({
      code: "ENOENT",
    });

    await seed(JSON.stringify({ good: stored }));

    expect(await store.read()).toEqual({ good: stored });
    await expect(readFile(legacyFile(dir))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await store.read()).toEqual({ good: stored });
  });

  it("keeps an un-migrated legacy document through a save", async () => {
    await seed(
      JSON.stringify({
        good: stored,
        bad: { value: "sk-live-bad", savedAt: "not a date" },
      }),
    );
    expect(await store.read()).toEqual({ good: stored });

    await store.write("other", "value-other", savedAt);

    // The save wrote the encrypted copy and did not retire the document it
    // could not migrate: the rejected entry's value exists only here.
    expect(await readFile(legacyFile(dir), "utf8")).toContain("sk-live-bad");
    expect(await store.read()).toEqual({
      good: stored,
      other: { value: "value-other", savedAt: "2026-10-21T09:00:00.000Z" },
    });

    // Repairing it lets the next read migrate the whole document and remove it.
    await seed(
      JSON.stringify({
        good: stored,
        other: { value: "value-other", savedAt: savedAt.toISOString() },
        bad: { value: "sk-live-bad", savedAt: savedAt.toISOString() },
      }),
    );

    expect(await store.read()).toEqual({
      good: stored,
      other: { value: "value-other", savedAt: "2026-10-21T09:00:00.000Z" },
      bad: { value: "sk-live-bad", savedAt: "2026-10-21T09:00:00.000Z" },
    });
    await expect(readFile(legacyFile(dir))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("merges a locked legacy document instead of promoting it", async () => {
    if (process.platform !== "win32") return;

    const first = { value: "first-value", savedAt: savedAt.toISOString() };
    await seed(JSON.stringify({ first }));
    const release = await holdForReading(legacyFile(dir));

    try {
      // Migrates, but the removal is refused, so the plaintext survives.
      expect(await store.read()).toEqual({ first });
      expect(await readFile(legacyFile(dir), "utf8")).toContain("first-value");

      await store.write("second", "second-value", savedAt);

      // The stored copy is authoritative: the merge adds nothing, and the key
      // saved after the leftover was made is not overwritten by it.
      expect(await store.read()).toEqual({
        first,
        second: { value: "second-value", savedAt: "2026-10-21T09:00:00.000Z" },
      });
    } finally {
      await release();
    }

    // Once the lock is gone the leftover is retired and the answer is the same.
    const both = {
      first,
      second: { value: "second-value", savedAt: "2026-10-21T09:00:00.000Z" },
    };
    expect(await store.read()).toEqual(both);
    await expect(readFile(legacyFile(dir))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await store.read()).toEqual(both);

    // A cleared id stays cleared; the leftover cannot put it back.
    await store.clear("first");
    expect(await store.read()).toEqual({ second: both.second });
  });

  it("keeps a credential retired when it is cleared while its legacy file is locked", async () => {
    if (process.platform !== "win32") return;

    const first = { value: "first-value", savedAt: savedAt.toISOString() };
    await seed(JSON.stringify({ first }));
    const release = await holdForReading(legacyFile(dir));

    try {
      // Migrates, but the removal is refused, so the leftover survives.
      expect(await store.read()).toEqual({ first });

      await store.clear("first");
      expect(await store.read()).toEqual({});
      expect(await readFile(legacyFile(dir), "utf8")).toContain("first-value");
    } finally {
      await release();
    }

    // Past the lock window the leftover is retired and the clear still holds.
    expect(await store.read()).toEqual({});
    await expect(readFile(legacyFile(dir), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await store.read()).toEqual({});

    // An explicit save is the only way back.
    await store.write("first", "first-value-2", savedAt);
    expect(await store.read()).toEqual({
      first: { value: "first-value-2", savedAt: "2026-10-21T09:00:00.000Z" },
    });
  });

  it("leaves a legacy entry alone when a different id is retired", async () => {
    await store.write("cleared", "value-cleared", savedAt);
    await seed(JSON.stringify({ legacy: stored }));

    await store.clear("cleared");

    expect(await store.read()).toEqual({ legacy: stored });
  });

  it("caps the retired set at the newest 256 ids", async () => {
    for (let index = 0; index < 260; index += 1) {
      await store.write(`id${index}`, "value", savedAt);
    }
    for (let index = 0; index < 260; index += 1) {
      await store.clear(`id${index}`);
    }

    const raw = await secrets.read("credentials-retired");
    const ids = JSON.parse((raw as Buffer).toString("utf8")) as string[];

    expect(ids).toHaveLength(256);
    expect(ids[0]).toBe("id4");
    expect(ids.at(-1)).toBe("id259");
  });

  it("throws when the retired set will not decrypt", async () => {
    await store.write("one", "value-one", savedAt);
    await store.clear("one");

    const retiredFile = path.join(dir, "credentials-retired.bin");
    const raw = await readFile(retiredFile);
    // Past the 12-byte IV and 16-byte tag: the ciphertext's first byte.
    raw[28] = (raw[28] as number) ^ 0xff;
    await writeFile(retiredFile, raw);

    await expect(store.read()).rejects.toThrow();
  });

  it("treats a non-object file as no credentials and does not migrate it", async () => {
    await seed("[]");

    expect(await store.read()).toEqual({});
    expect(await readFile(legacyFile(dir), "utf8")).toBe("[]");
    await expect(readFile(secretFile(dir))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("refuses an id that is not a credential id, on write", async () => {
    await expect(store.write("../escape", "value", savedAt)).rejects.toThrow(
      "Invalid",
    );

    // A refused write is no write at all, so there is nothing on disk to read
    // back — the assertion that can go red, where `read()` answering `{}` on a
    // directory that was never written to cannot.
    await expect(readFile(legacyFile(dir), "utf8")).rejects.toThrow();
    await expect(readFile(secretFile(dir))).rejects.toThrow();
  });

  describe("migration and encryption", () => {
    it("migrates a legacy plaintext file on first read", async () => {
      await seed(JSON.stringify({ fontawesome: stored }, null, 2));

      expect(await store.read()).toEqual({ fontawesome: stored });

      // The plaintext is gone only after the encrypted copy landed, and the
      // ciphertext does not carry the provider key in the clear.
      await expect(readFile(legacyFile(dir))).rejects.toMatchObject({
        code: "ENOENT",
      });
      const encrypted = await readFile(secretFile(dir));
      expect(encrypted.includes(Buffer.from("sk-live-9f2c"))).toBe(false);
    });

    it("reads the same credentials from a fresh store after a restart", async () => {
      await store.write("fontawesome", "sk-live-9f2c", savedAt);

      const restarted = createCredentialStore(
        dir,
        createSecretStore(dir, createFakeProtector()),
      );

      expect(await restarted.read()).toEqual({ fontawesome: stored });
    });

    it("keeps the plaintext file when the protector is unavailable", async () => {
      await seed(JSON.stringify({ fontawesome: stored }));
      const refusing = createCredentialStore(
        dir,
        createSecretStore(dir, createFakeProtector(false)),
      );

      await expect(refusing.read()).rejects.toThrow(/protector is unavailable/);

      // A later run with a working protector must still find it, so neither
      // the plaintext nor its replacement was touched.
      expect(await readFile(legacyFile(dir), "utf8")).toContain("sk-live-9f2c");
      await expect(readFile(secretFile(dir))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(
        readFile(path.join(dir, "secret.key"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("retires a plaintext left beside the encrypted copy", async () => {
      await seed(JSON.stringify({ fontawesome: stored }));
      await store.read();

      // A removal that failed after the migration left the plaintext behind;
      // the encrypted copy is the source of truth, so the next read retires it
      // and still answers the same values.
      await seed(JSON.stringify({ fontawesome: stored }));
      expect(await store.read()).toEqual({ fontawesome: stored });
      await expect(readFile(legacyFile(dir))).rejects.toMatchObject({
        code: "ENOENT",
      });

      // A read whose only job was the retry, once the file is gone.
      expect(await store.read()).toEqual({ fontawesome: stored });
    });

    it("throws on a tampered ciphertext rather than answering no credentials", async () => {
      await store.write("fontawesome", "sk-live-9f2c", savedAt);
      const raw = await readFile(secretFile(dir));
      // Past the 12-byte IV and 16-byte tag: the ciphertext's first byte.
      raw[28] = (raw[28] as number) ^ 0xff;
      await writeFile(secretFile(dir), raw);

      await expect(store.read()).rejects.toThrow();
    });
  });
});

describe("hintOf", () => {
  it("answers the last four characters", () => {
    expect(hintOf("sk-live-9f2c")).toBe("9f2c");
  });

  it("answers a shorter value whole rather than padded", () => {
    expect(hintOf("ab")).toBe("ab");
    expect(hintOf("")).toBe("");
  });
});
