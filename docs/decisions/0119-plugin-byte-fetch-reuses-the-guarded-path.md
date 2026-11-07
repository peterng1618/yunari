# 0119 — A plugin byte fetch reuses the guarded destination policy

- **Date:** 2026-11-07
- **Status:** accepted
- **Paths:** `src/web/packages/extension-api/src/host-api.ts`, `src/web/packages/extension-api/src/protocol.ts`, `src/web/packages/host/src/extensions/runtime/host-api.ts`, `src/web/packages/host/src/extensions/asset-bytes.ts`

## Problem

A trusted-worker asset source that serves image bytes must not call the global
`fetch`: that would skip the declared-host allowlist, the pinned DNS answer and
the size cap. The host already owns a byte fetch for declarative sources; the
plugin surface had no way to reach it. The boundary is the plugin network
authority, so a wrong integration fails quietly as a widened connection.

## Rung 1 — internal owner

Searched: CodeGraph `guardedFetchBytes`, `guardedFetch`, `runGuarded`,
`HOST_API_METHODS`, `PLUGIN_METHODS`, `dispatchCall`, `allowedPluginMethods`.

Found: `guardedFetchBytes` in `runtime/network.ts` is the one byte path and
already serves `DeclarativeAssetSourceAdapter.bytesOf`. `HOST_API_METHODS` is
the closed method table, `PLUGIN_METHODS` is the plugin-callable half, and
`allowedPluginMethods` derives the child allowlist from both. The only missing
link is a table entry and a dispatcher arm; no new policy is needed.

## Rung 2 — installed dependencies

Searched: `undici`/Node `fetch` behavior used by `createPinnedFetch`, the host's
`readBodyBytes`, and Node's `child_process` serialization modes.

Found: the pinned fetch and byte reader already bound the redirect chain, the
content-type check and the byte count. Node's `child_process` advanced
serialization carries a `Uint8Array` across IPC without JSON coercion; the
supervisor already selects it (and tests that binary survives both directions).

## Rung 3 — native platform

Searched: Node `child_process` `serialization: "advanced"`, `process.send`
structured values.

Found: binary is preserved both ways; the existing supervisor test asserts a
`Uint8Array` reaches the child and returns. No native API supplies the
destination policy, so it stays the host's.

## Rung 4 — public solutions

Searched: the existing guard's design is the public contract here — URL scheme
and userinfo checks, per-hop host re-check, pinned DNS answer, redirect policy
and a byte ceiling. Node's documentation for advanced IPC serialization is the
only new contract this change relies on.

Found: no external library adds anything the host does not already do; adopting
one would introduce a second fetch policy.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Expose `guardedFetchBytes` as `network.fetchBytes` | Same allowlist, pin, redirects and slot as `network.fetch` | None beyond the table entry and IPC binary | Chosen |
| Let the worker call global `fetch` | No policy | Bypasses every check | Rejected |
| Add a second byte-fetch implementation | Duplicates the hop loop | Two policies can drift | Rejected |
| Return base64 over the JSON fetch | Reuses `network.fetch` | Inflates the answer and adds a second decoding rule | Rejected |

## Rung 6 — smallest probe

Behavior was already established by the existing `readBodyBytes` tests and the
supervisor's binary IPC test; the change only routes a call into those paths.
The new dispatcher tests exercise a real `Response` body and assert the returned
`Uint8Array`, so the probe is the regression test itself.

## Decision

Add one closed method, `network.fetchBytes`, to the extension API table and the
worker protocol, and dispatch it to the existing `guardedFetchBytes`. It takes
`{ url }` only: the byte path has no header or body contract today, so no new
authority is granted. The ceiling is `MAX_EXTENSION_ASSET_BYTES` in
`asset-bytes.ts`, the
one owner of "the largest asset byte answer a plugin surface may deliver or
receive"; the declarative artwork fetch, a code source's `asset.bytes` reply and
this method all read it rather than spelling 32 MiB three times. The call takes
one of the host's four fetch slots.
