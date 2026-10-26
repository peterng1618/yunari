import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  X509Certificate,
} from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import forge from "node-forge";
import {
  createSecretStore,
  type SecretStore,
} from "../settings/secret-store.js";

/**
 * The certificates a secure origin needs: one root this machine keeps, and a
 * leaf signed by it for the addresses the machine has now.
 *
 * **Why a CA and not a self-signed leaf** (`vg-580`): a browser will not
 * register a service worker on a certificate it had to warn about, and a
 * self-signed certificate is warned about on every device until it is trusted
 * by hand — where a root is trusted once and every later leaf is free. That is
 * the whole of the arrangement: the root is the thing a device installs, and
 * the leaf is disposable, which is what makes a moved LAN address cheap.
 *
 * The decision, the seven rungs and the advisory carried with `node-forge` are
 * `docs/decisions/0070`.
 */

/** Under the 398-day ceiling browsers apply to a TLS server certificate, so no
 *  client refuses the leaf on that ground alone. It costs nothing: a leaf is
 *  re-issued at every start and never written down. */
const LEAF_DAYS = 397;
/** The root is what a device installs, so it is the thing worth keeping. */
const CA_DAYS = 3_650;
/** Back-dated, so a device whose clock is behind this PC's does not read the
 *  certificate as not-yet-valid. */
const CLOCK_SKEW_MS = 3_600_000;
const DAY_MS = 86_400_000;
const CA_CERT_FILE = "ca.crt";
/** The root's private key, kept encrypted; only the certificate is in the clear. */
const CA_KEY_SECRET = "ca-key";
/** The pre-encryption key file, migrated and removed on the first read whose
 *  removal succeeds; a failed removal is retried by the next read. */
const LEGACY_CA_KEY_FILE = "ca.key";
const CA_COMMON_NAME = "Yunari Local CA";

export interface SecureOrigin {
  /** The root, PEM — what a display installs to trust this host. */
  readonly certificate: string;
  /** Where the root lives, so the console can name a file rather than a shape. */
  readonly certificatePath: string;
  /** The SHA-256 of `certificate`'s DER, lowercase hex. Computed here, once,
   *  because it is printed at startup and published with the served root: two
   *  people compare those two, so they must come from one reading. */
  readonly fingerprint: string;
  /** The leaf's private key, PEM. In memory only, never written. */
  readonly key: string;
  /** The leaf, PEM, covering every name it was asked for. */
  readonly leaf: string;
  /** What the server presents: the leaf and then the root.
   *
   *  **The root is sent, and that is not a trust decision.** A client still
   *  refuses a root it has not installed — presenting one never grants trust —
   *  but a client that has not been given the chain cannot build one at all, and
   *  that is the difference between `ERR_CERT_AUTHORITY_INVALID` and a
   *  certificate a device can be told to accept. Measured: with the leaf alone
   *  Chrome could not verify the chain even with the root allowlisted by SPKI,
   *  because the allowlist is consulted while the chain is built and the root
   *  was nowhere in it. */
  readonly chain: string;
}

/**
 * The root at `directory`, created if this machine does not have one yet, plus
 * a fresh leaf for `names`.
 *
 * A missing root is **regenerated rather than refused**: the host still has a
 * job to do, and the cost of a new root is that each display installs it again,
 * which is a step the owner can take. What it must not do is serve an insecure
 * origin quietly, so the caller reports which of the two happened.
 */
export async function createSecureOrigin(
  directory: string,
  names: readonly string[],
  secrets: SecretStore = createSecretStore(directory),
): Promise<SecureOrigin> {
  const { certificate, key, certificatePath } = await loadOrCreateAuthority(
    directory,
    secrets,
  );
  const leaf = issueLeaf(certificate, key, names);

  return {
    certificate,
    certificatePath,
    fingerprint: certificateFingerprintSha256(certificate),
    chain: leaf.leaf + certificate,
    ...leaf,
  };
}

/**
 * The SHA-256 of the certificate's DER, lowercase hex — 64 characters a person
 * can read out and compare on a phone before trusting the root.
 *
 * Of the DER rather than of the PEM text: whitespace and line wrapping are a
 * spelling of the same certificate, and a client stores the DER.
 */
export function certificateFingerprintSha256(pem: string): string {
  return createHash("sha256")
    .update(new X509Certificate(pem).raw)
    .digest("hex");
}

/**
 * Sixteen random bytes whose first is in `0x01..0x7f`.
 *
 * Two constraints, and both are about the DER rather than about the value. The
 * top bit of the first byte has to be clear, or the INTEGER reads as negative
 * and Node reports the serial with a leading `-`. The first byte also has to be
 * non-zero: a leading `00` is a non-minimal encoding unless the byte after it
 * has its own top bit set, and the expression that only cleared the top bit
 * emitted one in 169 of 20,000 serials — half of those non-minimal, and none of
 * it visible through `X509Certificate.serialNumber`, which strips the byte.
 *
 * Exported for its own case: the fault is a one-in-a-hundred draw, so the check
 * has to be thousands of draws rather than one certificate.
 */
export function serialNumber(): string {
  const leading = (randomBytes(1)[0] ?? 0) & 0x7f || 1;

  return (
    leading.toString(16).padStart(2, "0") + randomBytes(15).toString("hex")
  );
}

/** A keypair made by `node:crypto`, not by forge: the pure-JS generator is
 *  orders of magnitude slower and this one is native. */
function newKeyPair(): {
  readonly privateKey: string;
  readonly publicKey: string;
} {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });

  return {
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

/**
 * The root's private key, migrating a legacy `ca.key` and retiring it on the
 * first read whose removal succeeds; a failed removal is retried next read.
 *
 * `undefined` means there is no key to use, which is an ordinary first run. A
 * present encrypted key that cannot be read throws: that is not the same fact
 * as having none, and treating it as one would mint a new root and invalidate
 * every display's install.
 */
async function readAuthorityKey(
  directory: string,
  secrets: SecretStore,
): Promise<string | undefined> {
  const legacyFile = path.join(directory, LEGACY_CA_KEY_FILE);
  const stored = await secrets.read(CA_KEY_SECRET);
  if (stored !== undefined) {
    // The encrypted copy is the source of truth. A plaintext an earlier
    // removal failed to delete is retired here; a failure now is retried on
    // the next read rather than failing this one.
    await rm(legacyFile, { force: true }).catch(() => undefined);
    return Buffer.from(stored.toString("utf8"), "base64").toString("utf8");
  }

  let legacy: string;
  try {
    legacy = await readFile(legacyFile, "utf8");
  } catch {
    return undefined;
  }

  // Base64 of the PEM text: the stored bytes never read as a private key.
  await secrets.write(
    CA_KEY_SECRET,
    Buffer.from(Buffer.from(legacy, "utf8").toString("base64"), "utf8"),
  );
  // Only after the encrypted copy succeeded; a failed write leaves the
  // plaintext for a later run to migrate. A failed removal is retried by the
  // next read rather than failing this one.
  await rm(legacyFile, { force: true }).catch(() => undefined);
  return legacy;
}

async function loadOrCreateAuthority(
  directory: string,
  secrets: SecretStore,
): Promise<{
  readonly certificate: string;
  readonly key: string;
  readonly certificatePath: string;
}> {
  const certificatePath = path.join(directory, CA_CERT_FILE);

  // Outside the pair check below: a key that exists but cannot be decrypted is
  // a throw, never "no key", so it must not land in a regeneration branch.
  const key = await readAuthorityKey(directory, secrets);

  let existingCertificate: string | undefined;
  try {
    existingCertificate = await readFile(certificatePath, "utf8");
  } catch {
    existingCertificate = undefined;
  }

  if (existingCertificate !== undefined && key !== undefined) {
    try {
      // **Present but not a pair is the one half-state a read cannot see.** The
      // key is written first and the certificate second, so a crash between the
      // two leaves a new key beside the old certificate; every leaf signed with
      // that key would then fail to chain to the root the devices installed, and
      // the owner would get a certificate warning with nothing to explain it.
      // One verification costs nothing and is the only way to tell.
      if (
        new X509Certificate(existingCertificate).verify(createPublicKey(key))
      ) {
        return {
          certificate: existingCertificate,
          key,
          certificatePath,
        };
      }
    } catch {
      // Absent, unreadable, or not a matching pair. A root this machine cannot
      // use is a root it does not have: generating a new one costs every display
      // one re-install, and refusing to start costs the owner their host.
    }
  }

  const { pki, md } = forge;
  const keys = newKeyPair();
  const root = pki.createCertificate();
  const subject = [
    { name: "commonName", value: CA_COMMON_NAME },
    { name: "organizationName", value: "Yunari" },
  ];

  root.publicKey = pki.publicKeyFromPem(keys.publicKey);
  root.serialNumber = serialNumber();
  root.validity.notBefore = new Date(Date.now() - CLOCK_SKEW_MS);
  root.validity.notAfter = new Date(Date.now() + CA_DAYS * DAY_MS);
  root.setSubject(subject);
  root.setIssuer(subject);
  root.setExtensions([
    { name: "basicConstraints", cA: true, critical: true },
    { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true },
  ]);
  root.sign(pki.privateKeyFromPem(keys.privateKey), md.sha256.create());

  const certificate = pki.certificateToPem(root);

  await mkdir(directory, { recursive: true });
  // The key first, and readable, before the certificate: a certificate written
  // without its key is the one half-state that would look usable and is not.
  const encodedKey = Buffer.from(keys.privateKey, "utf8").toString("base64");
  await secrets.write(CA_KEY_SECRET, Buffer.from(encodedKey, "utf8"));

  const persisted = await secrets.read(CA_KEY_SECRET);
  if (persisted === undefined || persisted.toString("utf8") !== encodedKey) {
    throw new Error("The CA private key could not be read back after writing.");
  }

  await writeFile(certificatePath, certificate, "utf8");

  return { certificate, key: keys.privateKey, certificatePath };
}

function issueLeaf(
  authorityCertificate: string,
  authorityKey: string,
  names: readonly string[],
): { readonly key: string; readonly leaf: string } {
  const { pki, md } = forge;
  const authority = pki.certificateFromPem(authorityCertificate);
  const keys = newKeyPair();
  const leaf = pki.createCertificate();

  leaf.publicKey = pki.publicKeyFromPem(keys.publicKey);
  leaf.serialNumber = serialNumber();
  leaf.validity.notBefore = new Date(Date.now() - CLOCK_SKEW_MS);
  leaf.validity.notAfter = new Date(Date.now() + LEAF_DAYS * DAY_MS);
  // The first name, whatever it is: a subject is required and a modern client
  // reads the SANs instead, so this only has to be non-empty and honest.
  leaf.setSubject([{ name: "commonName", value: names[0] ?? "yunari" }]);
  leaf.setIssuer(authority.subject.attributes);
  leaf.setExtensions([
    { name: "basicConstraints", cA: false, critical: true },
    {
      name: "keyUsage",
      digitalSignature: true,
      keyEncipherment: true,
      critical: true,
    },
    { name: "extKeyUsage", serverAuth: true },
    {
      name: "subjectAltName",
      altNames: names.map((name) =>
        net.isIP(name) === 0 ? { type: 2, value: name } : { type: 7, ip: name },
      ),
    },
  ]);
  leaf.sign(pki.privateKeyFromPem(authorityKey), md.sha256.create());

  return { key: keys.privateKey, leaf: pki.certificateToPem(leaf) };
}
