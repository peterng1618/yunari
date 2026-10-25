# 0120 — Secrets are encrypted with an OS-wrapped key

- **Date:** 2026-10-25
- **Status:** accepted 2026-10-25
- **Paths:** `src/web/packages/host/src/settings/`,
  `src/web/packages/host/src/tls/authority.ts`,
  `src/web/packages/host/src/server.ts`,
  `src/web/packages/player/src/session.ts`

## The problem

The host stored credentials, the store bearer token, literal custom-source
secrets and the CA private key as plaintext JSON or PEM. Mode `0600` is not a
control on Windows, and a copied app folder or a backup exposes every secret.
The CA bootstrap also printed nothing a user could compare, and the display
token travelled in every asset and stream URL, where it leaks through history,
referrers and logs.

The shape is not "encrypt some files". The key has to live somewhere the same
user can reach without a password prompt at every host start, and a wrong key
must refuse rather than silently return empty credentials. That rules out a
key derived from a machine name, a hardcoded password or a plaintext fallback.

## Rung 1 — Yunari

Searched: `settings/credentials.ts`, `settings/store-session.ts`,
`settings/sources.ts`, `tls/authority.ts`, `server.ts`'s token and certificate
routes, `player/src/session.ts`, `cli/net.ts`.

Found:
- Credentials write JSON with `mode: 0o600`; Windows ignores the mode.
- The store session writes the bearer token the same way.
- `sources.json` can hold literal secret fields.
- The CA private key is PEM on disk; the certificate route serves the cert
  without a fingerprint.
- `tokenFor` accepts `Authorization`, `x-yunari-token` and `?session=`.
- `withToken` appends the token to every asset and stream URL.
- The pair page posts the token and redirects to a URL that keeps it.

## Rung 2 — dependencies

Searched: `host/package.json`, the lockfile, npm for `keytar`, `node-dpapi`,
`@primno/dpapi`, `secret-tool`, `keyring`.

Found: `node-forge` is present for the CA; no keyring or DPAPI package is
installed. `keytar` is archived and native; `node-dpapi-prebuilt` and
`@primno/dpapi` are native prebuilds. The host already shells out to PowerShell
for the tray and to `secret-tool`-style commands is available on Linux.

## Rung 3 — platform

Searched: Windows DPAPI `Protect`/`Unprotect` through PowerShell 5.1; Linux
Secret Service `secret-tool`; Node `crypto` AES-256-GCM; Windows ACLs.

Found:
- DPAPI `CurrentUser` encrypts for the logged-in user and needs no stored
  password. PowerShell exposes it as
  `[Security.Cryptography.ProtectedData]::Protect(bytes, null, CurrentUser)`.
- `secret-tool store/lookup` stores a key in GNOME Keyring/KWallet's Secret
  Service. It is not guaranteed present on a headless or minimal Linux install.
- Node's `crypto` gives AES-256-GCM with a random IV and an authentication tag;
  a tampered ciphertext throws.
- DPAPI protects against another user and at-rest disk theft, not against
  another process running as the same user. That is the honest boundary.
- On Windows, `mode: 0o600` is not an ACL; the app folder's inherited user ACL
  is the real file permission.

## Rung 4 — ecosystem

Searched: Electron `safeStorage` docs; MSAL Node persistence extensions;
`node-dpapi` and `@primno/dpapi`; `keytar`; Linux Secret Service docs; common
"encrypt config file with DPAPI" patterns.

Found:
- Electron's `safeStorage` uses DPAPI on Windows and libsecret on Linux, and
  documents the same boundary: same-user processes can decrypt. It also warns
  that Linux may fall back to `basic_text` when no keyring exists. That fallback
  is exactly what this project must not have.
- MSAL's `FilePersistenceWithDataProtection` uses
  `CryptProtectData`/`CryptUnprotectData` with `CurrentUser`; its Linux
  `LibSecretPersistence` stores the key in Secret Service. Both are native
  addons.
- `node-dpapi` and `@primno/dpapi` expose the same Win32 calls as prebuilt
  native modules. They add a native binary and an AV surface to a Windows app
  that currently has no native addon.
- `keytar` is archived and also native.
- The common pattern is one random data key, wrapped by the OS, with the data
  encrypted by a fast AEAD. Encrypting each secret directly with DPAPI is also
  possible but makes rotation and multi-secret files awkward.
- Nobody supplies a no-native, shell-out-to-the-OS protector for Node on both
  platforms; the adapter is small and the decision is ours.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Plaintext with mode 0600 | No work | Zero | No protection on Windows; backups expose secrets | Rejected |
| `keytar` / native DPAPI addon | Direct API | New native dependency and prebuild | Archived or native surface; install failures | Rejected |
| Electron `safeStorage` | Proven semantics | Requires Electron | The host is not Electron | Rejected |
| Encrypt every secret directly with DPAPI | No data key | One OS call per read/write | Rotation and multi-secret files are clumsy; Linux still needs a second path | Rejected |
| One random data key, DPAPI/secret-tool wrapped, AES-256-GCM data | No native addon; one adapter per OS; authenticated files | A PowerShell/secret-tool child at first read | Protector unavailable must refuse, not fall back | Chosen |
| Derive a key from a machine id or hardcoded password | No OS dependency | Zero | Obfuscation, not encryption; the key ships with the app | Rejected |
| Keep the token in the URL but shorten its life | Small change | Token still leaks in logs/history | Referrer and log exposure remains | Rejected |
| HttpOnly SameSite=Strict cookie, one-time query bootstrap | Browser-native; no token in asset URLs | Cookie parsing and a pair-page POST | A cookie on plain HTTP is not `Secure` | Chosen |

## Rung 6 — probe

Windows 11 probe, 2026-10-25, PowerShell 5.1:

```text
[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes('yunari-probe'), $null, CurrentUser)
-> 230 bytes
Unprotect -> "yunari-probe"
```

The 12-byte input became 230 bytes: DPAPI adds its own header and integrity
data, so the wrapped key file is small and opaque. `secret-tool` is not present
on this Windows machine; the Linux path is therefore unverified here and must
refuse when the protector is absent. The AES-GCM round trip and tamper refusal
are pinned by Task 7.1's tests.

## Rung 7 — build

`settings/secret-store.ts` writes `secret.key` (the wrapped 32-byte data key,
base64 in `{ "version": 1, "wrapped": "…" }`) and one `<name>.bin` per
secret: a 12-byte IV, the 16-byte GCM tag, then the ciphertext. The protector spawns
`powershell -NoProfile -NonInteractive -Command` on Windows and `secret-tool`
on Linux; no shell interpolation of secret bytes. The host bundle gains the
module; no native addon and no generated asset. Legacy plaintext files are read
once, re-encrypted and removed; the CA key is moved into the same store.

## Decision

1. One random 32-byte data key per app folder, wrapped by DPAPI `CurrentUser`
   on Windows or `secret-tool` on Linux, stored in `secret.key`.
2. Credentials, the store session and the CA private key are AES-256-GCM
   encrypted with that key; each file carries a random 12-byte IV, a 16-byte
   tag and the ciphertext. `sources.json` is not encrypted: it holds a
   `credentialId` reference, never a literal secret.
3. No plaintext fallback. If the protector is unavailable, saving refuses and
   says why; reading a legacy plaintext file migrates it once and removes the
   plaintext.
4. The display token becomes an `HttpOnly; SameSite=Strict` cookie after a
   one-time `POST /api/session`; `?session=` is exchanged at the root and
   refused everywhere else; `withToken` stops appending it to asset/stream
   URLs.
5. The host prints the CA SHA-256 fingerprint and serves it on the certificate
   route; pairing requires comparing them before installing the root.

The reason for the two-layer design is rotation and scope: the data key can be
rewrapped without re-encrypting every secret, and AES-GCM authenticates each
file so a wrong key or a tampered byte refuses instead of returning empty
credentials.
