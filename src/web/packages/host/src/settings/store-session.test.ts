import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KeyProtector } from "./os-key-protector.js";
import { createSecretStore, type SecretStore } from "./secret-store.js";
import { createStoreSessionStore, type StoreSession } from "./store-session.js";

const NOW = "2026-10-23T10:00:00.000Z";

/** The pre-encryption file. */
const legacyFile = (dir: string) => path.join(dir, "store-session.json");
/** The encrypted secret, `<name>.bin` as the secret store names it. */
const secretFile = (dir: string) => path.join(dir, "store-session.bin");

/**
 * Holds a real Windows share lock on `file`: readers are allowed, deletion is
 * refused. A Node handle cannot express this, and only Windows refuses to
 * unlink a file another handle holds, so callers skip elsewhere rather than
 * mocking the removal.
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

/** A reversible transform, so no case here spawns the OS protector. */
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

const session = (token = "session-token"): StoreSession => ({
  token,
  userId: "user-1",
  email: "a@example.com",
  obtainedAt: NOW,
});

describe("store session", () => {
  let dir: string;
  let secrets: SecretStore;
  let store: ReturnType<typeof createStoreSessionStore>;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "yunari-store-session-"));
    secrets = createSecretStore(dir, createFakeProtector());
    store = createStoreSessionStore(dir, secrets);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads an absent file as no session", async () => {
    expect(await store.read()).toBeUndefined();
  });

  it("round-trips a session and clears the file, its legacy sibling and its temporary", async () => {
    await store.write(session());
    expect(await store.read()).toMatchObject({ token: "session-token" });
    // A mode is a POSIX idea; on Windows the file inherits the profile
    // directory's ACL, which is already this user's alone.
    if (process.platform !== "win32") {
      expect((await stat(secretFile(dir))).mode & 0o777).toBe(0o600);
    }

    await writeFile(
      `${legacyFile(dir)}.tmp`,
      JSON.stringify(session()),
      "utf8",
    );
    await store.clear();

    expect(await store.read()).toBeUndefined();
    await expect(readFile(secretFile(dir))).rejects.toThrow();
    await expect(readFile(legacyFile(dir))).rejects.toThrow();
    await expect(readFile(`${legacyFile(dir)}.tmp`)).rejects.toThrow();
  });

  it("keeps the encrypted session file to its owner", async () => {
    if (process.platform === "win32") return;

    await store.write(session());

    expect((await stat(secretFile(dir))).mode & 0o777).toBe(0o600);
  });

  it("reads a malformed or incomplete file as no session rather than throwing", async () => {
    await writeFile(legacyFile(dir), "{ not json", "utf8");
    expect(await store.read()).toBeUndefined();

    await writeFile(
      legacyFile(dir),
      JSON.stringify({ ...session(), obtainedAt: "yesterday" }),
      "utf8",
    );
    expect(await store.read()).toBeUndefined();

    await writeFile(legacyFile(dir), JSON.stringify({ token: "t" }), "utf8");
    expect(await store.read()).toBeUndefined();
  });

  it("refuses a session that is not four usable strings, and writes nothing", async () => {
    await expect(store.write({ ...session(), token: "" })).rejects.toThrow(
      "Invalid",
    );
    await expect(readFile(legacyFile(dir), "utf8")).rejects.toThrow();
    await expect(readFile(secretFile(dir))).rejects.toThrow();
  });

  it("deletes the superseded GitHub token on a successful write", async () => {
    const legacy = path.join(dir, "github-token.json");
    await writeFile(legacy, JSON.stringify({ token: "gho_old" }), "utf8");

    await store.write(session());

    await expect(readFile(legacy, "utf8")).rejects.toThrow();
  });

  it("keeps the superseded GitHub token when the session write is refused", async () => {
    const legacy = path.join(dir, "github-token.json");
    await writeFile(legacy, JSON.stringify({ token: "gho_old" }), "utf8");

    await expect(store.write({ ...session(), token: "" })).rejects.toThrow(
      "Invalid",
    );

    expect(await readFile(legacy, "utf8")).toContain("gho_old");
  });

  it("answers a read issued during a write with the completed session", async () => {
    const writing = store.write(session("session-token"));
    const reading = store.read();
    const [, read] = await Promise.all([writing, reading]);

    expect(read).toMatchObject({ token: "session-token" });
  });

  describe("migration and encryption", () => {
    it("migrates a legacy plaintext session on first read", async () => {
      await writeFile(
        legacyFile(dir),
        JSON.stringify(session("legacy-token"), null, 2),
        "utf8",
      );

      expect(await store.read()).toEqual(session("legacy-token"));

      await expect(readFile(legacyFile(dir))).rejects.toMatchObject({
        code: "ENOENT",
      });
      const encrypted = await readFile(secretFile(dir));
      expect(encrypted.includes(Buffer.from("legacy-token"))).toBe(false);
    });

    it("reads the same session from a fresh store after a restart", async () => {
      await store.write(session("session-token"));

      const restarted = createStoreSessionStore(
        dir,
        createSecretStore(dir, createFakeProtector()),
      );

      expect(await restarted.read()).toEqual(session("session-token"));
    });

    it("keeps the plaintext session when the protector is unavailable", async () => {
      await writeFile(
        legacyFile(dir),
        JSON.stringify(session("legacy-token")),
        "utf8",
      );
      const refusing = createStoreSessionStore(
        dir,
        createSecretStore(dir, createFakeProtector(false)),
      );

      await expect(refusing.read()).rejects.toThrow(/protector is unavailable/);

      expect(await readFile(legacyFile(dir), "utf8")).toContain("legacy-token");
      await expect(readFile(secretFile(dir))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(
        readFile(path.join(dir, "secret.key"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("retires a plaintext left beside the encrypted copy", async () => {
      await store.write(session("session-token"));

      // A removal that failed after the migration left the plaintext behind;
      // the encrypted copy is the source of truth, so the next read retires it
      // and still answers the same session.
      await writeFile(
        legacyFile(dir),
        JSON.stringify(session("session-token")),
        "utf8",
      );
      expect(await store.read()).toEqual(session("session-token"));
      await expect(readFile(legacyFile(dir))).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(await store.read()).toEqual(session("session-token"));
    });

    it("writes the encrypted session before removing a legacy plaintext", async () => {
      await writeFile(
        legacyFile(dir),
        JSON.stringify(session("legacy-token")),
        "utf8",
      );
      const refusing = createStoreSessionStore(
        dir,
        createSecretStore(dir, createFakeProtector(false)),
      );

      await expect(refusing.write(session("new-token"))).rejects.toThrow(
        /protector is unavailable/,
      );

      // Reversing the order would delete the only copy when the write refuses.
      expect(await readFile(legacyFile(dir), "utf8")).toContain("legacy-token");
      await expect(readFile(secretFile(dir))).rejects.toMatchObject({
        code: "ENOENT",
      });
    });

    it("keeps a malformed legacy session beside the encrypted copy", async () => {
      await store.write(session());
      await writeFile(legacyFile(dir), "{ not json", "utf8");

      // A hand-edit this reader cannot use is not retired by the read retry;
      // the encrypted copy answers meanwhile.
      expect(await store.read()).toEqual(session());
      expect(await readFile(legacyFile(dir), "utf8")).toBe("{ not json");
    });

    it("never promotes a stale locked legacy session over a newer sign-in", async () => {
      if (process.platform !== "win32") return;

      await writeFile(
        legacyFile(dir),
        JSON.stringify(session("older-token")),
        "utf8",
      );
      const release = await holdForReading(legacyFile(dir));

      try {
        // Migrates the older token, but the removal is refused.
        expect(await store.read()).toEqual(session("older-token"));

        await store.write(session("newer-token"));

        // The stored copy wins: the leftover must not roll the sign-in back.
        expect(await store.read()).toEqual(session("newer-token"));
      } finally {
        await release();
      }

      expect(await store.read()).toEqual(session("newer-token"));
      await expect(readFile(legacyFile(dir))).rejects.toMatchObject({
        code: "ENOENT",
      });

      // The newer token is what the encrypted copy itself holds.
      const restarted = createStoreSessionStore(
        dir,
        createSecretStore(dir, createFakeProtector()),
      );
      expect(await restarted.read()).toEqual(session("newer-token"));
    });

    it("answers a successful write when the legacy removal is refused", async () => {
      // A directory at the legacy path makes the non-recursive removal throw
      // on every platform, after the ciphertext has already landed.
      await mkdir(legacyFile(dir));

      await expect(
        store.write(session("session-token")),
      ).resolves.toBeUndefined();

      expect(await store.read()).toEqual(session("session-token"));
    });

    it("throws on a tampered ciphertext rather than answering no session", async () => {
      await store.write(session());
      const raw = await readFile(secretFile(dir));
      raw[28] = (raw[28] as number) ^ 0xff;
      await writeFile(secretFile(dir), raw);

      await expect(store.read()).rejects.toThrow();
    });
  });
});
