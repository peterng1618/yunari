# 0045 — A pairing code can be minted on demand from this PC

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/server.ts`, `src/web/packages/host/src/session/pairing-code.ts`, `src/web/packages/editor/src/hosting-client.ts`, `src/web/packages/editor/src/editor-shell/hosting-store.ts`, `src/web/packages/editor/src/editor-shell/publish-control.tsx`, `src/web/packages/editor/src/editor-shell/editor-shell.css`, `src/web/packages/editor/src/ui-copy.ts`

## Problem

The editor's publishing card read the live code with
`GET /api/pairing/code` and drew only its expiry instant. The host mints one
code at startup (or when the previous window closes), so ten minutes after the
host started the card showed a dead code with no way to renew it short of
restarting the host. The read must keep its no-rotation rule — a second reader
must not move the code out from under the person typing it — while the owner on
this PC needs an explicit action that draws a fresh window.

## Rung 1 — internal owner

Searched: CodeGraph for `PairingCodeStore`, `currentOrMint`, `createPairingCodeStore`;
read `packages/host/src/server.ts`, `session/pairing-code.ts`,
`packages/editor/src/hosting-client.ts`, `editor-shell/hosting-store.ts`,
`editor-shell/publish-control.tsx`.

Found: the pairing block already owns the loopback gate and both code routes:

```ts
if (url.pathname.startsWith("/api/pairing")) {
  …
  if (!isLoopbackRemote(request.socket.remoteAddress)) {
    sendText(response, 403, "Pairing is available on this PC only.");
    return;
  }
  …
  if (url.pathname === "/api/pairing/code" && request.method === "GET") {
    const live = pairingCodes.currentOrMint();
    sendJson(response, 200, { code: live.code, expiresAt: live.expiresAt });
    return;
  }
```

The store already owns replacement and the penalty reset:

```ts
const mint = (): PairingCode => {
  live = {
    code: randomCode(),
    expiresAt: new Date(now() + ttlMs).toISOString(),
  };
  misses.clear();
  return live;
};
```

The editor keeps the host's answer in `HostingStore`, which reads the code once
and never polls; `PublishControl` renders `code.code` and
`uiCopy.publish.expires(...)`. The owner for minting is the same store; the
route must call `mint()`, not spell a second window rule.

## Rung 2 — installed dependencies

Searched: the host's route layer has no router or action library; the editor
uses no data-fetching library. Found: nothing donated for this shape. The
existing `sendJson`/`readPairingCode` helpers already cover request and body.

## Rung 3 — native platform

Searched: Node `http` multiplexes on `request.method`; browsers expose
`setInterval`/`clearInterval` and `fetch`. Found: the platform supplies the
method split and a one-second timer, which is all the card needs; no platform
feature replaces the host-owned window.

## Rung 4 — public solutions

Searched: none needed — this is one in-repo route plus one button, not an
integration with a library or protocol. The comparable rule already in the
repository is 0042 (the store owns "the live code, or a new one"); this change
adds the explicit replacement it did not expose.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Make `GET /api/pairing/code` rotate | Renews by redrawing | Breaks the read-never-rotates rule: the card's redraw would move a code mid-typing | Rejected |
| Editor mints locally | No host change | The editor cannot own the host window or the penalty table | Rejected |
| `POST /api/pairing/code` calling `mint()` | Loopback gate already applies; store keeps one live code and clears misses | None beyond the route and its card action | Chosen |

## Rung 6 — smallest probe

`session/pairing-code.test.ts` mints twice and claims the first code; the
`server.test.ts` pairing describe posts the route and claims the new code. Both
fail if replacement stops invalidating the previous window.

## Decision

Add `POST /api/pairing/code`, inside the existing `/api/pairing` loopback and
same-origin gates, answering `pairingCodes.mint()`. `GET` keeps
`currentOrMint()`. The editor's card adds a one-second countdown from
`expiresAt` and a "New code" action that posts the route; the banner and the
read route never rotate.
