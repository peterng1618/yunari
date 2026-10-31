# 0043 — A host with no key protector serves http only

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/main.ts`, `src/web/packages/host/src/settings/secret-store.ts`

## Problem

The host serves https because a phone at `http://<lan-ip>:<port>` is not a
secure context and can neither hold a wake lock nor install as an app. That
needs a root certificate whose private key is kept in the OS key protector, and
the store refuses to write a secret when no protector exists. A Linux machine
with no Secret Service — a headless box, a CI runner — therefore could not start
the host at all: the launcher reported `Could not prepare a certificate … The
OS key protector is unavailable` and exited 1. The CI browser suite failed at
its first `webServer` because of it, and a headless Linux user had no path.

## Rung 1 — internal owner

Searched: CodeGraph for `createSecureOrigin`, `createSecretStore`,
`KeyProtectorUnavailable`, `HostServerOptions.tls`.
Found: `createHostServer` already accepts `tls` as optional and serves plain
http when it is absent (`server.ts`'s `createPortListener` branch), and every
consumer of the origin in `main.ts` is the server options and the banner. The
secret store already answers `available()`; the failure was only that the
launcher treated every certificate failure as fatal.

## Rung 2 — installed dependencies

Searched: none needed — no package changes and no new dependency.

## Rung 3 — native platform

Searched: Node `https`/`http` server creation, DPAPI, Secret Service.
Found: Node serves http and https on the same port through the existing
handshake sniffing; nothing platform-specific is added. The ruling is that the
host starts on the origin the platform can actually support.

## Rung 4 — public solutions

Searched: none — the decision is which failure is fatal, not which library to
use.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Refuse to start (previous) | Headless Linux unusable | None | Rejected by ruling |
| 0600 file for the CA key | https everywhere | A second secret format, weaker against same-user reads | Rejected |
| http only when no protector | Starts; LAN displays lose wake lock and PWA | None beyond the banner | Chosen |

## Rung 6 — smallest probe

CI's probe step ran the exact webServer command on Ubuntu: it answered
`Could not prepare a certificate … The OS key protector is unavailable`, exit
1 — the same message the local `secret-store.test.ts` refuses to write with.
The new authority case reproduces it through `createSecureOrigin` with an
unavailable protector and asserts the typed error.

## Decision

`SecretStore.write` throws `KeyProtectorUnavailable`, a type rather than a
message. `main.ts` degrades to an http-only host only for that error, prints
what a LAN display loses, and still refuses to start for any other certificate
failure (a directory it cannot write). The keyringless machine keeps every
route; only the origin changes.
