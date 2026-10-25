import { generateKeyPairSync, X509Certificate } from "node:crypto";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import forge from "node-forge";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KeyProtector } from "../settings/os-key-protector.js";
import {
  createSecretStore,
  type SecretStore,
} from "../settings/secret-store.js";
import { createSecureOrigin, serialNumber } from "./authority.js";

/**
 * The chain is checked by **Node's own X.509 verifier**, never by the library
 * that produced it: `node-forge` carries an advisory in its signature
 * *verification* path (GHSA-86w9-cpqp-85rv, `docs/decisions/0070`), and this
 * host's answer to that is that it never calls it. A case that verified with
 * forge would be testing the half of the package the decision excludes.
 */

let directory: string;
let secrets: SecretStore;

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

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "yunari-tls-"));
  secrets = createSecretStore(directory, createFakeProtector());
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

/** The names a host on this box would ask for, loopback included. */
const NAMES = ["localhost", "127.0.0.1", "192.168.2.56"] as const;

/** The origin this machine would create, or re-use, from `directory`. */
const open = (store: SecretStore = secrets) =>
  createSecureOrigin(directory, NAMES, store);

/** A pre-encryption root, for the migration case: a key and a matching cert. */
function legacyAuthority(): {
  readonly certificate: string;
  readonly key: string;
} {
  const { pki, md } = forge;
  const pair = generateKeyPairSync("rsa", { modulusLength: 2_048 });
  const key = pair.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();
  const certificate = pki.createCertificate();
  const subject = [{ name: "commonName", value: "Legacy Test CA" }];

  certificate.publicKey = pki.publicKeyFromPem(
    pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  );
  certificate.serialNumber = "01";
  certificate.validity.notBefore = new Date(Date.now() - 3_600_000);
  certificate.validity.notAfter = new Date(Date.now() + 86_400_000);
  certificate.setSubject(subject);
  certificate.setIssuer(subject);
  certificate.setExtensions([
    { name: "basicConstraints", cA: true, critical: true },
  ]);
  certificate.sign(pki.privateKeyFromPem(key), md.sha256.create());

  return { certificate: pki.certificateToPem(certificate), key };
}

describe("the host's own certificate authority", () => {
  it("writes a serial that is minimal DER, over thousands of draws", () => {
    // Twenty thousand, because the fault this replaced was a draw of about one
    // in a hundred and no single certificate would have shown it. A first byte
    // of `00` is a non-minimal INTEGER, and one of `80` or above reads as
    // negative; `X509Certificate.serialNumber` strips the first byte, so a
    // certificate cannot be asked about either.
    const bad = Array.from({ length: 20_000 }, serialNumber).filter(
      (serial) => {
        const first = Number.parseInt(serial.slice(0, 2), 16);
        return serial.length !== 32 || first === 0 || first >= 0x80;
      },
    );

    expect(bad).toEqual([]);
  });

  it("signs a leaf that Node accepts as coming from the root", async () => {
    const origin = await open();
    const authority = new X509Certificate(origin.certificate);
    const leaf = new X509Certificate(origin.leaf);

    // The reading the whole task turns on: a browser registers a service worker
    // on a certificate it can build a chain to a trusted root from, and refuses
    // one it had to warn about. `verify` is that question, asked of the root.
    expect(leaf.verify(authority.publicKey)).toBe(true);
    expect(authority.verify(authority.publicKey)).toBe(true);
  });

  it("presents the leaf and the root, in that order", async () => {
    const origin = await open();

    // What the server hands a client. A leaf alone cannot be chained by a
    // client that was never given the root, and a chain in the wrong order is
    // read as a leaf that issued itself — measured as
    // `ERR_CERT_AUTHORITY_INVALID` against the LAN address.
    expect(origin.chain).toBe(origin.leaf + origin.certificate);
    expect(origin.chain.startsWith("-----BEGIN CERTIFICATE-----")).toBe(true);
    expect(origin.chain.match(/BEGIN CERTIFICATE/g)).toHaveLength(2);
  });

  it("issues a root that is a root and a leaf that is not", async () => {
    const origin = await open();

    // A leaf that said `CA: TRUE` could sign for any name this machine chose,
    // and a root that did not could sign for nothing at all.
    expect(new X509Certificate(origin.certificate).ca).toBe(true);
    expect(new X509Certificate(origin.leaf).ca).toBe(false);
  });

  it("covers every name it was asked for, hostnames and addresses alike", async () => {
    const origin = await open();
    const leaf = new X509Certificate(origin.leaf);

    expect(leaf.checkHost("localhost")).toBe("localhost");
    expect(leaf.checkIP("127.0.0.1")).toBe("127.0.0.1");
    // The address a display actually uses, and the one a leaf covering only
    // loopback would fail on — as a name mismatch the owner cannot tell from a
    // root they had not installed.
    expect(leaf.checkIP("192.168.2.56")).toBe("192.168.2.56");
  });

  it("keeps the root and re-issues the leaf on the next start", async () => {
    const first = await open();
    const second = await open();

    // The root is what a display installs. If it changed between starts, every
    // device would have to install it again — which is the self-signed
    // certificate's cost under another name.
    expect(second.certificate).toBe(first.certificate);
    // The leaf is disposable, and a new one per start is what makes a moved
    // LAN address cost a restart rather than a re-install.
    expect(second.leaf).not.toBe(first.leaf);
  });

  it("keeps the root across a restart with a fresh secret store", async () => {
    const first = await open();

    const restarted = createSecretStore(directory, createFakeProtector());
    const second = await open(restarted);

    expect(second.certificate).toBe(first.certificate);
  });

  it("regenerates a root that is missing, and one whose key does not match it", async () => {
    const first = await open();
    await rm(path.join(directory, "ca.crt"));

    const second = await open();
    expect(second.certificate).not.toBe(first.certificate);
    expect(
      new X509Certificate(second.leaf).verify(
        new X509Certificate(second.certificate).publicKey,
      ),
    ).toBe(true);

    // The half-state a read cannot see, and the one a crash between the two
    // writes actually produces: a certificate and a key that are both readable
    // and do not belong together. Signed with that key, every leaf would fail
    // to chain to the root the devices already trust.
    await writeFile(path.join(directory, "ca.crt"), first.certificate, "utf8");
    const third = await open();
    expect(
      new X509Certificate(third.leaf).verify(
        new X509Certificate(third.certificate).publicKey,
      ),
    ).toBe(true);
    expect(third.certificate).not.toBe(first.certificate);
  });

  it("writes the root and its encrypted key, and nothing plaintext", async () => {
    const origin = await open();

    expect((await readdir(directory)).sort()).toEqual([
      "ca-key.bin",
      "ca.crt",
      "secret.key",
    ]);
    expect(origin.certificatePath).toBe(path.join(directory, "ca.crt"));

    // The leaf's key is never written: a leaf is re-issued at every start, so
    // there is nothing for a file to save.
    expect(origin.leaf).not.toContain("PRIVATE KEY");
  });

  it("never writes the root's private key in PEM form", async () => {
    await open();

    for (const file of await readdir(directory)) {
      const bytes = await readFile(path.join(directory, file));
      expect(bytes.includes(Buffer.from("BEGIN PRIVATE KEY"))).toBe(false);
      expect(bytes.includes(Buffer.from("BEGIN RSA PRIVATE KEY"))).toBe(false);
    }
  });

  it("keeps the encrypted root key to its owner", async () => {
    // A mode is a POSIX idea; on Windows the file inherits the profile
    // directory's ACL, which is already this user's alone, and `stat` reports
    // the mode it would have on a POSIX filesystem rather than the one in
    // force. Asserted where it means something rather than asserted everywhere
    // and true nowhere.
    if (process.platform === "win32") return;

    await open();
    const key = await stat(path.join(directory, "ca-key.bin"));
    expect(key.mode & 0o777).toBe(0o600);
  });

  describe("migration and encryption", () => {
    it("migrates a legacy ca.key on first read", async () => {
      const legacy = legacyAuthority();
      await writeFile(path.join(directory, "ca.key"), legacy.key, "utf8");
      await writeFile(
        path.join(directory, "ca.crt"),
        legacy.certificate,
        "utf8",
      );

      const origin = await open();

      // The migrated key is the one in use, not a freshly minted root.
      expect(origin.certificate).toBe(legacy.certificate);
      await expect(
        readFile(path.join(directory, "ca.key"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
      const encrypted = await readFile(path.join(directory, "ca-key.bin"));
      expect(encrypted.includes(Buffer.from("BEGIN PRIVATE KEY"))).toBe(false);
    });

    it("keeps a legacy ca.key when the protector is unavailable", async () => {
      const legacy = legacyAuthority();
      await writeFile(path.join(directory, "ca.key"), legacy.key, "utf8");
      await writeFile(
        path.join(directory, "ca.crt"),
        legacy.certificate,
        "utf8",
      );

      const refusing = createSecretStore(directory, createFakeProtector(false));

      await expect(open(refusing)).rejects.toThrow(/protector is unavailable/);

      expect(await readFile(path.join(directory, "ca.key"), "utf8")).toContain(
        "BEGIN PRIVATE KEY",
      );
      await expect(
        readFile(path.join(directory, "ca-key.bin")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("throws on a tampered key rather than minting a new root", async () => {
      const first = await open();
      const file = path.join(directory, "ca-key.bin");
      const raw = await readFile(file);
      raw[28] = (raw[28] as number) ^ 0xff;
      await writeFile(file, raw);

      await expect(open()).rejects.toThrow();
      // The certificate the devices installed is still the one on disk.
      expect(await readFile(path.join(directory, "ca.crt"), "utf8")).toBe(
        first.certificate,
      );
    });
  });
});
