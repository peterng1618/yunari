# Yunari status

Updated: 2026-10-26
Branch: `main`

## Current objective

Fix every finding in the 2026-10-25 performance and security audit, plus anything found while implementing: 30 security and 23 performance findings across the host, player, editor, Worker and release path.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-25-performance-security-hardening.md` — Phases 0–6 complete; Phase 7 is next.
- **Spec:** [`2026-10-25-performance-security-hardening-design.md`](docs/superpowers/specs/2026-10-25-performance-security-hardening-design.md) is approved and all findings are marked Fix.
- **Decision notes 0116–0120 are landed** for the request boundary, chart repaint, store upload, provenance checks and secrets at rest.
- **Backlog drain is queued behind this plan:** [`spec`](docs/superpowers/specs/2026-10-12-the-backlog-drain-design.md) and [`plan`](docs/superpowers/plans/2026-10-12-the-backlog-drain.md) start after this closes.
- **No finding is filed to the backlog:** the user's ruling is fix all, file none.

## Last completed change

- **Phase 6 is complete:** an upload reserves a row under a per-author ceiling, a version PUT streams into a conditional R2 put, and finalize settles the version and its reservation in one `db.batch`.
- **Cleanup is a scheduled job,** deleting expired reservations' objects from hour + one tick and pruning their rows after a week, with R2 deletes sliced at the 1000-key cap.
- **One growing reader caps every JSON body** before parse, and the owner gate needs a verified address while `/migrate` compares its token in constant time.
- **Listings are one joined statement each** and `/index.json` is served from `caches.default` under one canonical key; the query-count guard can now see a per-user email read.
- **Gate:** `npm run gate` exit 0 — 413 files / 6170 passed (1 skipped), Worker 13 / 130. Three earlier runs lost load-sensitive host waits first; the waits now carry a 15 s budget and every count is unchanged.

## Next

1. Run Phase 7 (secrets, sessions, TLS): the encrypted secret store, then credentials, the store session and the CA key onto it.
2. Then the HttpOnly session cookie and the printed CA fingerprint, with the Phase 7 gate.
3. Run Phase 8: supply chain, workflows, advisories and the close.
4. Then the final whole-branch review on the most capable model.

## Blockers / unverified

- **The store upload proxy is unverified live:** the Worker tests and the host client are the evidence until a real upload runs.
- **No Linux secret-store probe:** `secret-tool` is absent on this Windows host; the protector must refuse rather than fall back.
- **The CA fingerprint and cookie flow will be unit-tested only:** a real phone pairing needs a live run after Phase 7.
- **Phases 1–2 visible behaviour has no browser proof:** their suites assert objects and geometry; rebuild and inspect before the final review.
- **The host suite's waits are now 15 s:** a genuine hang surfaces later than it would have, and a loaded gate no longer reports a cap or bound breach that did not happen.
