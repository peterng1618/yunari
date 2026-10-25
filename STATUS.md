# Yunari status

Updated: 2026-10-25
Branch: `main`

## Current objective

Fix every finding in the 2026-10-25 performance and security audit, plus anything found while implementing: 30 security and 23 performance findings across the host, player, editor, Worker and release path.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-25-performance-security-hardening.md` — Phase 1 complete; Phase 2 is next.
- **Spec:** [`2026-10-25-performance-security-hardening-design.md`](docs/superpowers/specs/2026-10-25-performance-security-hardening-design.md) is approved and all findings are marked Fix.
- **Decision notes 0116–0120 are landed** for the request boundary, chart repaint, store upload, provenance checks and secrets at rest.
- **Backlog drain is queued behind this plan:** [`spec`](docs/superpowers/specs/2026-10-12-the-backlog-drain-design.md) and [`plan`](docs/superpowers/plans/2026-10-12-the-backlog-drain.md) start after this closes.
- **No finding is filed to the backlog:** the user's ruling is fix all, file none.

## Last completed change

- **Host request boundary hardened:** central same-origin guard on loopback API routes, asset MIME from the declared kind, and import, Wallpaper Engine and health gated by surface.
- **Pairing and streams bounded:** a code is consumed by one claim after the penalty wait; stream keys, connections and pre-handshake sockets are capped.
- **Admin I/O contained:** oversized theme bodies share one slot, admin store failures answer fixed sentences with detail logged, bundle serving refuses links and dotfiles and answers ETag/304.
- **Editor font table aligned:** formats the theme format cannot declare are refused instead of offered; the served asset kind stays WOFF2-only.
- **Plan corrected:** 41 tasks, exact watchlist claims, and Task 1.2's table owned by `renderer-core`.

## Next

1. Run Phase 2 (untrusted files and outbound fetches): ZIP preflight, contained reads, private redirects and pinned DNS.
2. Run Phase 3 (player) and rebuild bundles before its browser check.
3. Run Phase 4 (host IO) and Phase 5 (editor).
4. Run Phase 6 (store uploads and Worker) and Phase 7 (secrets, sessions, TLS).
5. Run Phase 8 (supply chain and close), then the final whole-branch review.

## Blockers / unverified

- **The store upload proxy is unverified live:** the Worker tests and the host client are the evidence until a real upload runs.
- **No Linux secret-store probe:** `secret-tool` is absent on this Windows host; the protector must refuse rather than fall back.
- **The CA fingerprint and cookie flow are unit-tested only:** a real phone pairing needs a live run after Phase 7.
- **Phase 1 visible behaviour is not yet browser-checked:** `npm run gate` does not build; rebuild before the Phase 3 check.
