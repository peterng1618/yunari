# Yunari status

Updated: 2026-10-26
Branch: `main`

## Current objective

Fix every finding in the 2026-10-25 performance and security audit, plus anything found while implementing: 30 security and 23 performance findings across the host, player, editor, Worker and release path.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-25-performance-security-hardening.md` — Phases 0–7 complete; Phase 8 is next.
- **Spec:** [`2026-10-25-performance-security-hardening-design.md`](docs/superpowers/specs/2026-10-25-performance-security-hardening-design.md) is approved and all findings are marked Fix.
- **Decision notes 0116–0120 are landed** for the request boundary, chart repaint, store upload, provenance checks and secrets at rest.
- **Backlog drain is queued behind this plan:** [`spec`](docs/superpowers/specs/2026-10-12-the-backlog-drain-design.md) and [`plan`](docs/superpowers/plans/2026-10-12-the-backlog-drain.md) start after this closes.
- **No finding is filed to the backlog:** the user's ruling is fix all, file none.

## Last completed change

- **Phase 7 is complete:** one OS-wrapped key encrypts credentials, the store session and the CA key, each migrated off its plaintext file once and only when the whole legacy document validated.
- **A cleared credential stays cleared** through a `credentials-retired` tombstone set, which the legacy merge honours and an explicit save lifts.
- **The display token left the URL:** `POST /api/session` sets an `HttpOnly; SameSite=Strict` cookie with a 400-day lifetime, the root exchanges a `?session=` once, and every other route refuses a query token.
- **The host prints its CA's SHA-256 fingerprint** and serves the same value on the certificate route, from the certificate itself rather than a copy beside it.
- **Gate:** `npm run gate` exit 0 — 416 files / 6250 passed (1 skipped), Worker 13 / 130; two host waits that assumed the newest frame or a 20 s budget were wrong, and both were fixed at the premise.

## Next

1. Run Phase 8: staged-version pinning and notice checks, least-privilege SHA-pinned workflows, advisories, and the ffmpeg hash check.
2. Then the Phase 8 close: full gate, browser set, red-proof audit, STATUS and spec closure, plan archived.
3. Then the final whole-branch review on the most capable model.
4. Then `superpowers:finishing-a-development-branch`.

## Blockers / unverified

- **No live pairing run:** the cookie exchange and the printed fingerprint are covered by unit and e2e tests, not by a real phone installing the root and comparing the value.
- **The store upload proxy is unverified live:** Worker tests and the host client are the evidence until a real upload runs.
- **No Linux secret-store probe:** `secret-tool` is absent on this Windows host; the keyring branch is exercised against a mocked child process only.
- **Phases 1–2 visible behaviour has no browser proof:** their suites assert objects and geometry; rebuild and inspect before the final review.
- **The launcher's startup print is unexecuted by any test:** the value it prints is proven at the authority, not through `run()`.
