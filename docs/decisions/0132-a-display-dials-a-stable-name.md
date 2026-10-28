# 0132 — A display dials a stable name, not a dotted quad

- **Date:** 2026-10-28
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/server.ts`, `src/web/packages/host/src/cli/net.ts`,
  `src/web/packages/host/src/cli/hosting.ts`, `src/web/packages/host/src/main.ts`,
  `src/web/packages/editor/src/hosting-client.ts`,
  `src/web/packages/editor/src/editor-shell/publish-control.tsx`,
  `src/web/packages/editor/src/ui-copy.ts`

## The problem

A paired phone stops working when its host's LAN address moves. Nothing about
the credential is at fault — the cookie is 400 days (`sessionCookie`) and no
record carries an expiry — and nothing about the client is at fault either:
`displayFor` authenticates on `tokenFor(request)` alone and never reads
`remoteAddress` for identity, so a phone that changes Wi-Fi is already fine.

The failure is an **origin** problem. A browser scopes `localStorage` and the
cookie to an origin. When DHCP moves the host, the phone's stored pairing and
its cookie are still there but belong to an origin nobody answers on any more.
`host-refind.ts` already mitigates the open-display case by matching a stored
`hostId` and navigating to `?session=`, and it already tries
`<hostName>.local` as its second rung — but that rung is only reached from a
page that is already loaded, and the module's own header states the gap: *"a
display whose host moved while it was closed is back to the one-time code."*

The observed cost is not one re-pair. The only recovery was claiming a new
code, which mints a **new record**; that is how one phone accumulated four
`S26U` records on this host.

## Rung 1 — Yunari

Searched: the whole host and player source for `mdns`, `bonjour`,
`multicast-dns`, `avahi`, `dns-sd`, `zeroconf` (no hits outside `node_modules`);
`os.hostname` and `.local` across `packages/*/src`.

Found: **a discovery-free design that already half-anticipates the name.**
`host-refind.ts:230` builds `originFor(\`${pairing.hostName}.local\`, …)` as the
ladder's second rung. `localNames()` (`cli/net.ts:285`) collects every interface
address, `os.hostname()`, `localhost` and the loopback literals, and feeds the
leaf certificate's SANs via `createSecureOrigin`. `lanAddress()` ranks the
interfaces and is what the editor's QR and the console banner dial.

The gap is exactly one entry: **`hostname.local` is never collected.** A leaf
covering `PN-Thunderjaw` does not validate `PN-Thunderjaw.local`, so dialling the
name the re-find ladder already prefers fails the certificate check — the trap
`0070` exists to remove ("Serving plain http would fail on the display and pass
on this PC"). No other rung of the ladder is broken.

## Rung 2 — dependencies

Searched: `packages/host/package.json` (runtime deps: `@yunari/renderer-core`,
`@yunari/scene-fabric`, `@yunari/theme-package`, `node-forge`,
`systeminformation`), the workspace root, and the candidates `bonjour-service`,
`multicast-dns`, `mdns`.

Found: **nothing installed, and nothing needed.** The host is an mDNS
*consumer-side beneficiary*, not a responder: publishing a service record is
only useful to clients that browse for services, and a display already knows
which host it wants. `os.hostname()` is a platform string, not a dependency.

## Rung 3 — platform

Searched: `os.hostname()`, `os.networkInterfaces()`, `dns.lookup`, and whether
Windows ships a responder.

Found: **Windows mDNS is already running.** `netstat -ano` shows `UDP
0.0.0.0:5353` held by `svchost.exe` (PID 2240, a *Services* process) — the
Windows mDNS responder, which publishes the machine's own name. `dns.lookup`
answered `<hostname>.local` with all six of this box's addresses, including the
IPv4 one on the Wi-Fi LAN. So the name exists at the OS level on this host and
needs no code to create it.

What the platform leaves to us is the part that decides whether this is safe:
which of the resolved addresses a client picks, and whether our own leaf
certificate vouches for the name.

## Rung 4 — ecosystem

Searched: Android's `.local` behaviour (`source.android.com/…/dns-resolver#mdns-local-resolution`,
`android.googlesource.com/…/DnsResolver` — the commit implementing RFC 6762
§5.1 "One-Shot multicast DNS Queries"), `issues.chromium.org/41127207`,
`android.stackexchange.com` ("How to get mDNS working for Chrome on Android?",
"Why can't I browse to my desktop using its .local hostname?"),
`stackoverflow.com/questions/79405699` (2025, `.local` failing on Android with
*Private DNS* / a router that does not proxy DNS), and the Home Assistant
community thread on ESPHome's `.local` documentation.

Found: **the same shape, solved, with two known failure modes.**

- Android supports `.local` in `getaddrinfo` since the **Android 12 era**
  (DnsResolver mainline module, rolled out Nov 2021, not backported to 11), so
  Chrome resolves it without app-side code. iOS/macOS have always resolved it
  natively. Windows resolves it, and this box proves it.
- **Failure mode 1: Private DNS.** With "Private DNS" set to a provider host
  rather than Automatic/Off, Android bypasses the local resolver and `.local`
  returns `NXDOMAIN`. This is a device setting, not something a host can fix.
- **Failure mode 2: A router that proxies DNS but not mDNS.** Multiple reports
  of `.local` working on one router and failing on another; the ESPHome docs
  thread's conclusion is that `.local` mDNS never touches the router at all, so
  a router that *does* resolve the bare hostname is doing plain DNS, not mDNS.

Neither failure mode is worse than today: today's fallback is the one-time code,
which is what `.local` would also fall back to.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Ship an mDNS responder, publish a service record | Only helps a client that *browses* for services; a display already knows its host | A new dependency, a 5353 socket, and a second name to keep in sync with `os.hostname()` | Two responders on one name on one box; the OS already answers | Rejected |
| Sweep harder / remember more addresses client-side | Fits `host-refind.ts`, which already sweeps the /24 | No identity problem solved: the closed-tab case has no page to run a sweep from | The sweep is 253 probes per attempt; doing it more often is hostile to the network | Rejected |
| A permanent pairing link with a rotate action | Recovers any origin change | Storing a recoverable token, or a rotate-and-reveal flow; a new surface | Reintroduces a credential the design deliberately removed from URLs (`0019`) | Rejected for now — see below |
| **Add `hostname.local` to the leaf's SANs and dial it** | The ladder already prefers it; the OS already answers it | One entry in `localNames()` | Android < 12 and Private-DNS devices fall back to the code, which is today's behaviour | **Chosen** |

## Rung 6 — probe

Measured on this box (`PN-Thunderjaw`, Wi-Fi `192.168.2.157`), not reasoned:

1. **The name answers at the OS level.** A hand-built RFC 6762 one-shot query
   (A record, sent twice to `224.0.0.251:5353` after joining the group) got
   `A 172.18.192.1` back — a real answer from the Windows responder.
2. **`dns.lookup` resolves the name to every interface**, including
   `192.168.2.157` and the IPv6 link-locals, so a client that resolves the name
   can reach the LAN address.
3. **The first probe was void and nearly read as success.** Serving on
   `0.0.0.0` and fetching `http://PN-Thunderjaw.local:5299/` returned 200 —
   but so would dialling any of the box's own addresses. Re-running with the
   server bound **only** to `192.168.2.157` and fetching by name still returned
   200, which is the reading that can fail. Note the answer set contains the
   Npcap link-local `169.254.240.162`; ordering across those is the platform's
   concern and `host-refind.ts` already probes rather than trusts.
4. **The certificate gap is real, not theoretical.** `localNames()` does not
   contain the `.local` form, and `issueLeaf` builds `subjectAltName` from
   exactly that list (`authority.ts:346`), so today an https dial by the name
   is a name mismatch.
5. **The fixed leaf, measured against the built host.** Started
   `packages/host/bin/yunari.js --host 0.0.0.0 --port 5399` on a scratch app
   folder and dialled it three ways, trusting nothing but the root it served:
   `/api/host` over **`https://PN-Thunderjaw.local:5399` answered 200**, and the
   same socket asking for `not-this-host.local` answered
   `ERR_TLS_CERT_ALTNAME_INVALID`. **The control is what makes the first reading
   evidence** — the same probe passing both would have proved only that the
   client was not verifying. `/api/hosting` by name answered `403`, which is the
   loopback-only guard and not a certificate result: that is what a phone on the
   LAN sees, and the route it needs (`/api/host`) is the one exempted for the
   re-find sweep.

## Decision

Collect `` `${os.hostname()}.local` `` in `localNames()`, so the leaf covers the
name the re-find ladder already prefers, and dial that name where the owner is
shown an address to pair against.

**The name is carried beside the address, never instead of it.** `HostingState`
and `HostingAnswer` gain a `name`, and three surfaces print both: the console
banner's pairing link, the editor's publish card, and the QR. The address stays
on screen because the two failure modes above are devices that *cannot resolve*
the name, and an address is the only thing that helps them — a card that had
replaced it would trade one stranding for another. `lanAddress()` is unchanged:
it answers "which dotted quad is reachable", which is still a real question, and
the ranking it owns is not this decision's to break.

The reason is not "it was simplest". It is that **the name is the only part of
this that survives a DHCP lease by construction** — the OS publishes it, every
platform the project targets resolves it, and the client already prefers it.
Adding an mDNS responder would duplicate a service the OS provides, and a
permanent link would put a credential back into a URL that `0019` and the
session-cookie design deliberately removed from one.

**What this does not fix, and is recorded rather than hidden:** a display whose
host moves while the tab is closed still needs the one-time code on Android 11
and earlier, and on any device with Private DNS set to a provider. The fallback
is unchanged and correct.
