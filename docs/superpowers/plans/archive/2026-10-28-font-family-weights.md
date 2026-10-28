# Font family weights on import

Decision: [`docs/decisions/0131`](../decisions/0131-the-catalogue-carries-every-published-weight.md).
Design approved 2026-10-28.

**Outcome.** A curated family's full published weight list is offline data. Solo
family import and trio import both package every weight of the families they
bring, and the type-token weight field offers them. Role tokens still land on
the trio's recommended cut, because that is what `rolePreset` binds.

**Out of scope.** Italic and non-Latin subsets; Google's catalogue (its source
already lists every cut it publishes); a free weight ladder; the retired
id-based `applyFontTrio` picker path.

## Phase 1 — The catalogue emits every published weight

1. **Generator sweeps families.** `generate-font-trios.mjs` emits one face per
   published integer weight of every family the pairings name, not only the
   recommended role cut. `role` and `clamped` move to a `CuratedRoleFace`
   subtype carried only by `CuratedTrio.faces`; `CURATED_FACES` holds plain
   family faces.
   **Acceptance:** the emitted module type-checks, `curated.test.ts`'s shape
   invariants pass against the regenerated file, and no standalone face claims a
   role.
2. **Regenerate and record the size.** Run `npm run fonts:generate`; replace the
   generated header's stale figure with the measured bytes; confirm the file
   still brotli-compresses and that no size gate covers the host.
   **Verification:** regenerated file imported by `npm run typecheck` and the
   host suite.
3. **Shape tests pin the new truth.** `curated.test.ts` asserts the face count,
   that each sampled family's weights are contiguous and sorted, that every
   trio role cut is present in its family's cuts, and that family rows list
   every weight.

## Phase 2 — The host answers a family's cuts

1. **Port and implementation.** `AssetSource` gains optional
   `familyCuts(family)`, answered by the curated source from its family index;
   absent means "this source cannot enumerate".
2. **Route.** `GET /api/assets/family-cuts?source=&family=` answers
   `{ cuts }`, 404 on an unknown source, 400 on missing parameters, empty list
   for a family the source does not know. Loopback-only like its siblings.
   **Verification:** `routes.test.ts` covers the happy path, both refusals, and
   the empty answer.

## Phase 3 — Trio import brings every weight

1. **Client.** `familyCuts(source, family)` in `asset-finder/client.ts`, reading
   the new route and returning `undefined` on any failure, as `assetBytes` does.
2. **Document.** `applyFontTrio(trio)` and `addTypeTokensFromTrio(trio)` resolve
   each role family's cuts from the host, adopt them all (deduped, role stamped
   from the family's role), and fall back to the three role cuts when the source
   cannot answer. Token writes are unchanged: `rolePreset` keeps the bound face
   at the recommended cut. Add 3 adopts only families of roles it creates.
   **Acceptance:** a trio apply declares every weight of all three families; a
   host that answers nothing leaves the theme untouched; an existing role is not
   re-adopted by Add 3.
3. **Browser proof.** Apply a curated trio, open each role token's weight list,
   confirm every published weight is present with the recommended one selected,
   switch weight and confirm the canvas renders; save and reopen.
   **Verification:** focused Playwright spec plus a unit test on the adoption
   decisions.

## Phase 4 — Close

Run `npm run gate` (exit code captured to a file), update `STATUS.md`'s last
completed change, and record the plan complete. Any red outside this scope is
filed as a `Discovered, not fixed:` trailer on the commit, not fixed here.
