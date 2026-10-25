# Yunari status

Updated: 2026-10-25
Branch: `main`

## Current objective

Fix every finding in the 2026-10-25 performance and security audit, plus anything found while implementing: 30 security and 23 performance findings across the host, player, editor, Worker and release path.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-25-performance-security-hardening.md` — Phase 2 complete; Phase 3 is next.
- **Spec:** [`2026-10-25-performance-security-hardening-design.md`](docs/superpowers/specs/2026-10-25-performance-security-hardening-design.md) is approved and all findings are marked Fix.
- **Decision notes 0116–0120 are landed** for the request boundary, chart repaint, store upload, provenance checks and secrets at rest.
- **Backlog drain is queued behind this plan:** [`spec`](docs/superpowers/specs/2026-10-12-the-backlog-drain-design.md) and [`plan`](docs/superpowers/plans/2026-10-12-the-backlog-drain.md) start after this closes.
- **No finding is filed to the backlog:** the user's ruling is fix all, file none.

## Last completed change

- **Untrusted archives are preflighted:** the ZIP64 end record is read exactly as fflate reads it, with entry and central-directory caps.
- **Theme I/O is contained and bounded:** reads resolve inside the theme folder, thumbnails are dimension-capped, and an oversized save answers 413.
- **Outbound fetches refuse private redirects** and pin each request and redirect hop to the address the policy checked.
- **Direct import enforces the video envelope** before its first write, with install's own check kept as defence in depth.

## Next

1. Run Phase 3 (player): sample revisions, chart render gates, cadence and lifecycle; rebuild bundles before its browser check.
2. Run Phase 4 (host IO) and Phase 5 (editor).
3. Run Phase 6 (store uploads and Worker) and Phase 7 (secrets, sessions, TLS).
4. Run Phase 8 (supply chain and close), then the final whole-branch review.

## Blockers / unverified

- **The store upload proxy is unverified live:** the Worker tests and the host client are the evidence until a real upload runs.
- **No Linux secret-store probe:** `secret-tool` is absent on this Windows host; the protector must refuse rather than fall back.
- **The CA fingerprint and cookie flow are unit-tested only:** a real phone pairing needs a live run after Phase 7.
- **Phase 1 visible behaviour is not yet browser-checked:** `npm run gate` does not build; rebuild before the Phase 3 check.
