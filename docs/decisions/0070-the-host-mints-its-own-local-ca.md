# 0070 — The host mints its own local CA, and re-issues the leaf on every start

- **Date:** 2026-10-18
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/server.ts`

## The problem

`vg-580`: the host is `http.createServer`, so a phone at
`http://<lan-ip>:<port>` is not a secure context and two of the user's rulings
cannot exist there — the keep-awake control in `vg-576` cannot hold a wake lock
and `vg-577`'s PWA cannot register a service worker. The user ruled the fix on
2026-10-18: **a local CA, the mkcert shape**, over plain http and over a
self-signed certificate. The measurement that removed the third option is
already recorded (`progress.md`, Task 25.8): a bypassed self-signed certificate
earns `isSecureContext: true` and a granted `wakeLock.request("screen")` and
still refuses `serviceWorker.register` with `SecurityError`, while the same
certificate made valid registers successfully.

So the host has to *issue* a certificate: a root generated once per machine and
kept, plus a leaf signed by that root whose SANs cover the addresses a display
actually uses. What makes this non-obvious is not TLS — it is that **Node cannot
issue a certificate at all.** Nothing in `node:crypto` turns a keypair into
X.509, so the ASN.1 DER of `TBSCertificate`, its extension set and the outer
signature have to come from somewhere: a platform tool, a library, or code we
write. That is the decision this note records.

## Rung 1 — Yunari

Searched: `grep -rniE "createsecureserver|https\.createServer|node-forge|selfsigned|mkcert|\.crt|BEGIN CERTIFICATE|x509|subjectAltName"`
over `src/web/packages`, `src/web/tests`, `scripts` and `docs`, and
`grep -rniE "\btls\b|certificate|isSecureContext"` over the host, player and
editor sources.

Found: **nothing.** The host is `http.createServer` (`server.ts`), there is no
TLS, no certificate file, no trust handling and no `.gitignore` rule for a key
anywhere in the tree. The only hits are prose: the plan's Step 2, and
`docs/superpowers/specs/2026-10-18-turzx-panel-displays-design.md`, which names
`node-forge` as a candidate for a DES implementation — not for certificates, but
it does record that the project has already weighed the package once.

## Rung 2 — dependencies

Searched: `src/web/package-lock.json` for any package whose name matches
`forge|selfsigned|peculiar|mkcert|devcert|jsrsasign|asn1|rsa`, and again for
`cert|x509|ssl|tls|crypto|asn`.

Found: **nothing**, installed or declared. `@yunari/host`'s manifest carries a
deliberate "ZERO RUNTIME DEPENDENCIES" comment, so the empty result is a
statement about the tree rather than an oversight. Rung 2 is therefore empty,
which is why rung 4 below is real work rather than a formality.

## Rung 3 — platform

Searched: Node 24.13.0's `node:crypto` and `node:https` surface, **from the host
process** rather than from a shell, and the operating system's own tools on that
same process's `PATH`.

Found: **Node can key and sign, and cannot issue.** Measured:
`'createCertificate' in require('node:crypto')` is `false`; the module exposes
`X509Certificate` (parse and verify only), `generateKeyPair(Sync)`,
`createSign`, `createPrivateKey`/`createPublicKey`. `https.createServer`
consumes PEM and nothing in the platform produces it. The platform discharges
*keying* and *signing* and leaves *encoding* to the caller.

The OS is not a substitute, and the measurement is sharper than the brief
expected. Read from the host process's own `PATH`: `certutil` present,
`powershell` present, `dotnet` present, **`mkcert` absent**, and **`openssl`
absent** — where the Task 25.8 measurement recorded `openssl 3.5.7` on the same
machine. The two readings differ because the environment differs, which is
exactly why nothing may depend on a system tool being reachable.

## Rung 4 — ecosystem

**Live web search was unavailable in this session** — the search tool answered
that it could not run a query — so these searches are the npm registry's own
metadata and API, read from this box, plus the packages' own installed files.
Recorded as that rather than presented as a survey.

Searched: `npm view <pkg> version license dependencies time.modified` for
`devcert`, `node-forge`, `selfsigned`, `@peculiar/x509`, `https-localhost` and
`vite-plugin-mkcert`; weekly download counts from
`api.npmjs.org/downloads/point/last-week/<pkg>`; and an `npm install` of the two
finalists into a scratch directory outside the repo, followed by actually
minting a CA and a leaf with each (rung 6).

Found, and what each is:

| Package | Registry says | What it is |
|---|---|---|
| `node-forge` 1.4.0 | `(BSD-3-Clause OR GPL-2.0)`, 23,312,763 weekly, **no dependencies**, published 2026-03-24 | ASN.1/X.509/PKI in pure JS. Can build a CA and sign leaves with it. Carries one advisory — see below. |
| `@peculiar/x509` 2.2.0 | MIT, 8,945,866 weekly, 10 dependencies (21 installed), published 2026-10-15 | WebCrypto-backed X.509. `X509CertificateGenerator.createSelfSigned` and `.create`. Its README has a section headed "⚠️ Reflect Polyfill Required": a `reflect-metadata` import must precede it. |
| `selfsigned` 5.5.0 | MIT, 10,071,415 weekly, depends on `@peculiar/x509` + `pkijs` | A wrapper whose subject is a *self-signed* certificate. v5 no longer wraps `node-forge`. |
| `jsrsasign` 11.1.5 | MIT, **no dependencies**, installs with `npm warn deprecated jsrsasign@11.1.5: This package is no longer maintained` | X.509 plus a whole PKI toolkit. Clean on advisories, and unmaintained. |
| `devcert` 1.2.3 | MIT, 203,752 weekly, 22 dependencies incl. `sudo-prompt` | Creates a CA and installs it into the OS trust store, prompting for elevation. A dev-tool shape. |
| `https-localhost` 4.7.2 | **AGPL-3.0** | Express + spdy server. Licence alone disqualifies it. |
| `vite-plugin-mkcert` 2.1.0 | MIT | Downloads and runs the `mkcert` **binary**. Not a library that mints anything. |

`npm audit` on each scratch install, which is the search that mattered most here:
`@peculiar/x509` **0**, `jsrsasign` **0**, and `node-forge` **1 high** —
[GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv), CVSS 8.7,
CWE-347, "RSA PKCS#1 v1.5 signature verification accepts extra nested
DigestAlgorithm elements". The advisory is scoped to **signature verification**
in `lib/asn1.js` and `lib/rsa.js`; its range is `<= 1.4.0` with **no patched
version published**. It is carried into the decision below rather than
discovered later, and the one thing that makes it acceptable is that this host
never calls forge's verifier — every certificate the host issues is checked with
`node:crypto`'s `X509Certificate.verify()`, and the browser checks it again.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Node's own `crypto` | keys and signs, **cannot encode** | none | none | rejected — no issuance API exists |
| Shell out to `openssl`/`certutil`/PowerShell | works on this box | a system tool that may be absent — and *was* absent here | high: a user's box is only promised Node | rejected |
| `node-forge` 1.4.0 | full CA + leaf control; accepts keys made by `node:crypto` | 1 package, 0 transitive, ~1.5 MB of JS | medium: 1 unpatched high advisory, in a function this host does not call | **chosen** |
| `@peculiar/x509` 2.2.0 | the same, on native WebCrypto, faster | 21 packages incl. a DI container, plus a `reflect-metadata` import in the entry point | low on advisories; the largest dependency graph of any candidate | rejected |
| `jsrsasign` 11.1.5 | would do it, declaratively | 1 package, 0 transitive | medium: **unmaintained** — npm itself prints the deprecation | rejected |
| `selfsigned` 5.5.0 | self-signed only; a CA-signed leaf is not its subject | 13 packages | medium: the shape wanted is the one it does not do | rejected |
| `devcert` 1.2.3 | does the whole job *including* trust-store install | 22 packages, an elevation prompt | high: it installs a root into the OS store, which is the step the user has not been asked for | rejected |
| hand-rolled DER | zero dependencies | ~200 lines of ASN.1 encoding | high: a wrong byte is a silent chain failure | rejected — see rung 7 |

## Rung 6 — probe

Two scratch directories outside the repo, each with the library installed and a
script that mints a CA (RSA-2048, SHA-256, `basicConstraints` CA:TRUE,
`keyUsage` keyCertSign) and a leaf signed by it with
`SAN = DNS:localhost, IP:127.0.0.1, IP:192.168.2.56`. Each result is verified by
**Node's own X.509 verifier**, not by the library that produced it.

`node-forge` 1.4.0 — worked on the first run:

- CA keygen + self-sign **91 ms**, leaf keygen + sign **54 ms**
- CA PEM 1108 bytes, leaf PEM 1174 bytes
- `new X509Certificate(caPem).verify(ca.publicKey)` → `true`
- `new X509Certificate(leafPem).verify(ca.publicKey)` → `true`
- `checkIP("192.168.2.56")`, `checkIP("127.0.0.1")`, `checkHost("localhost")` → all resolve
- `subjectAltName` → `DNS:localhost, IP Address:127.0.0.1, IP Address:192.168.2.56`
- `npm install` → **1 package**

`@peculiar/x509` 2.2.0 — ran, once the polyfill its README requires was added:

- without it, import throws `Error: tsyringe requires a reflect polyfill. Please
  add 'import "reflect-metadata"'`, raised from
  `node_modules/tsyringe/dist/cjs/index.js` through
  `@peculiar/x509/build/x509.cjs.js`. This is documented rather than undeclared —
  the README has a section headed "⚠️ Reflect Polyfill Required" — so it is a
  cost, not a defect.
- with `reflect-metadata`: CA **53 ms**, leaf **19 ms** — faster, as native
  WebCrypto should be — CA PEM 1089 bytes, leaf PEM 1154 bytes, and the same
  three verifications `true`
- `npm install` → **21 packages**

Both produce a chain Node's verifier accepts, and neither is wrong. The numbers
that separated them are `npm install`'s count and `npm audit`'s: one package
against twenty-one, and one advisory confined to a function this host does not
call.

## Rung 7 — build

What writing it ourselves would have been, measured by what the two libraries
actually had to do: DER encoders for `SEQUENCE`, `SET`, `INTEGER`, `BIT STRING`,
`OCTET STRING`, `OID`, `UTF8String`, `UTCTime`, `BOOLEAN` and the explicit
context tags `[0]` and `[3]`; a `TBSCertificate` for each of the two
certificates; the extension encodings for `basicConstraints`, `keyUsage`,
`extendedKeyUsage` and `subjectAltName`, each with its own criticality and
`GeneralName` tag; and PEM framing. Roughly 200 lines with no parser in the
tree to check them against.

It is not impossible and the verification story is good — Node's own verifier
would reject a wrong byte — but it is a fresh ASN.1 encoder written to avoid one
dependency, and it is the exact shape `AGENTS.md`'s reuse gate names as the
expensive kind of wrong. Rejected on that ground, not on size.

## Decision

**`node-forge` 1.4.0, with the keypairs generated by `node:crypto` and `forge`
used only to encode and sign.** It is the candidate that solves this shape in
one package with no transitive graph, in a tree where the host's dependency list
is a deliberate statement. Key generation stays on `node:crypto`'s native path;
the probe's 91 ms and 54 ms are with that arrangement, and
`forge.pki.rsa.generateKeyPair` — the pure-JS generator the older recipes use —
is deliberately not on the path.

**The advisory is accepted, and the reason is narrow enough to check.** It is
CWE-347, a *verification* weakness: `forge.pki.rsa.verify` accepts a signature
it should reject. This host generates and signs; it never verifies with forge.
Every certificate is verified with `node:crypto`'s `X509Certificate.verify()`,
and then by a browser that has to accept the chain before a display will hold a
wake lock. So the affected function is not merely unused — it is outside the
path a certificate takes through this host, and the claim is checkable by
grepping the package for `forge.pki.rsa` and for any call to `.verify(`.

The two alternatives were weighed on that and rejected for reasons of their own
rather than for the advisory: `@peculiar/x509` is maintained and clean, and
brings twenty-one packages including a dependency-injection container plus a
global `reflect-metadata` import into a host whose whole dependency argument is
that it has almost none; `jsrsasign` is a single package with no advisory at
all, and is unmaintained — the registry itself says so on install, which for a
cryptography library is the worse risk of the two.

Licence is `(BSD-3-Clause OR GPL-2.0)` and BSD-3-Clause is the one taken, which
is permissive and needs no source obligation. `THIRD-PARTY-NOTICES.md` and
`docs/engineering/dependencies.md` are updated in the same change, as
`AGENTS.md` requires.

The shape of what is issued, and why:

- **One CA per machine**, the certificate at `<settingsDir>/tls/ca.crt` with its
  private key in the settings secret store as the `ca-key` secret
  (`<settingsDir>/tls/ca-key.bin`, encrypted under the OS-wrapped key). It is
  the thing a device installs, so it must outlive restarts — a CA regenerated on
  every start would mean re-installing on every device every time, which is the
  self-signed certificate's cost under another name.
- **The leaf is re-issued on every start**, in memory, never written. Nothing
  depends on it surviving: it is signed by the CA the device already trusts, so
  a new one costs nothing. This is what makes a moved LAN address cheap.
- **SANs cover every address the machine has at start**, not only the one it is
  bound to — `localhost`, `127.0.0.1`, `::1`, the hostname, and every
  non-internal interface address. The host can be moved onto the LAN after it
  has started (`createHostBinding`), and a leaf that covered only loopback would
  then present a name mismatch to the first phone that connected.

**One port, both protocols.** The secure origin and the pairing link the host
already prints (`http://<lan-ip>:<port>`) have to be the same port: §145 asks
for one listener, and a second port would be a second thing for an owner to
find. So the first byte on a socket decides who owns it — `0x16` is a TLS
ClientHello and no HTTP request method begins with it — and `server.ts`'s
`createPortListener` hands the socket to `http.Server` or `https.Server`
accordingly.

**The server sends the leaf and then the root.** A client refuses a root it has
not installed — presenting one never grants trust — but a client that is not
given the chain cannot build one at all, and the root's SPKI is read while that
chain is built. Measured: with the leaf alone, Chrome refused the origin with
`ERR_CERT_AUTHORITY_INVALID` even with the root allowlisted by
`--ignore-certificate-errors-spki-list`; with the chain, the same run read
`isSecureContext: true`, a granted wake lock and a registered service worker.

**The port owns connection pruning, because the inner servers cannot.** A server
handed sockets by `emit("connection")` never builds the connection registry its
own `closeIdleConnections()` reads — that registry is made when a server
*listens*, and neither inner server ever does. Measured, and it is the second
half of this decision's cost: with the pruning delegated to them, a browser's
kept connection was invisible, `server.close()` waited on it for ever, and the
editor's host switch stayed off — `vg-173`'s shape arrived at from the other end.
So the port closes the sockets it accepted, and learns which are mid-response
from the inner servers' `request` events rather than from a private field.

**And identity across that handover is the connection's four-tuple, not the
object.** An https server reports its `request` event's socket as a
`tls.TLSSocket` wrapping the one the port accepted, so a set of accepted sockets
never matches one of those: the mid-response guard silently does nothing over
TLS and the port prunes a response in flight — which is the LAN toggle resetting
a display mid-fetch. Found by review, after the first cut of this note had
claimed the guard worked. Measured over a real TLS socket: the two objects
differ and their `remoteAddress`, `remotePort`, `localAddress` and `localPort`
are equal, and over plain http they are the same object. `TLSSocket#_parent`
would answer it too and is deliberately not used — a private field is not a
contract, and this is a transport path.

Keeping plain http is **a cost accepted under a scoping ruling, not a feature.**
On a LAN it is an origin with no wake lock and no service worker, which is the
state `vg-580` exists to remove, and the alternative — serving https alone —
would leave the pairing link the host prints pointing at a protocol it no longer
answers. That link, the editor's `displayUrl`, the phone address in the publish
control and the console's own URLs belong to the per-display-themes spec, which
owns pairing and connection management; this note records that they were left
alone deliberately rather than missed. Until that spec decides what the link
carries, a display reaches the secure origin by typing `https` in front of the
address the console prints — and the console prints that origin, with the
address to install the root from, on every run.
