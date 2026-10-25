# Yunari status

Updated: 2026-10-25
Branch: `main`

## Current objective

Fix every finding in the 2026-10-25 performance and security audit, plus anything found while implementing: 30 security and 23 performance findings across the host, player, editor, Worker and release path.

## Active work

- **Active plan:** `docs/superpowers/plans/2026-10-25-performance-security-hardening.md` — Phases 0–5 complete; Phase 6 is next.
- **Spec:** [`2026-10-25-performance-security-hardening-design.md`](docs/superpowers/specs/2026-10-25-performance-security-hardening-design.md) is approved and all findings are marked Fix.
- **Decision notes 0116–0120 are landed** for the request boundary, chart repaint, store upload, provenance checks and secrets at rest.
- **Backlog drain is queued behind this plan:** [`spec`](docs/superpowers/specs/2026-10-12-the-backlog-drain-design.md) and [`plan`](docs/superpowers/plans/2026-10-12-the-backlog-drain.md) start after this closes.
- **No finding is filed to the backlog:** the user's ruling is fix all, file none.

## Last completed change

- **Phase 5 is complete:** a document change notifies listeners once per microtask batch, and the session's scene-to-document wiring is pinned.
- **History keeps the newest 100 entries** with a per-entry fingerprint, and the dirty marker is computed once per revision and per asset mutation.
- **An idle editor reads no publishable document,** and the layer tree marks selection from an id set with one `getObjects()` per group.
- **Imported images decode and scale with `createImageBitmap`,** keeping the element path for formats it refuses and the object URL as the persisted `src`.
- **Phase gate:** `npm run gate` exit 0 — 414 files / 6168 passed (1 skipped), Worker 12 / 73.

## Next

1. Run Phase 6 (store): upload table and quota reservations, the proxied upload route, finalize and cleanup.
2. Run the rest of Phase 6: bounded Worker input, owner and migrate auth, batched listings and the cached index.
3. Run Phase 7 (secrets, sessions, TLS) and Phase 8 (supply chain and close).
4. Then the final whole-branch review on the most capable model.

## Blockers / unverified

- **The store upload proxy is unverified live:** the Worker tests and the host client are the evidence until a real upload runs.
- **No Linux secret-store probe:** `secret-tool` is absent on this Windows host; the protector must refuse rather than fall back.
- **The CA fingerprint and cookie flow are unit-tested only:** a real phone pairing needs a live run after Phase 7.
- **Phases 1–2 visible behaviour has no browser proof:** their suites assert objects and geometry; rebuild and inspect before the final review.
- **One gate run timed out in a 129-asset fixture** and passed on re-run; treat a single sample of that file as no measurement.
