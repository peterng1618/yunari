# Type token model — implementation plan

> **For agentic workers:** execute with superpowers:subagent-driven-development. Steps are checkboxes for tracking; each task names its outcome, owners, constraints and proof rather than pasting code.

**Goal:** a type token names a face and nothing else; size, line height, spacing and the canvas size of a text object belong to the element; role becomes the token id.

**Architecture:** `globals.typeTokens` replaces `globals.typePresets` at schema major 3. A token is `{family, weight?, face?}`; runs reference `typeTokens.<id>` and carry `fontSize`/`lineHeight`/`letterSpacing` in their existing `style` map, which the renderer already resolves after the token. Defaults come from `renderer-core` so editor and player agree. Declared faces persist their subset and register with `unicodeRange`.

**Tech stack:** TypeScript, React 19, Fabric 7.4, Vitest, Playwright, Biome.

**Spec:** [`docs/superpowers/specs/2026-10-27-type-token-model-design.md`](../../specs/2026-10-27-type-token-model-design.md)

## Global constraints

- `SUPPORTED_SCHEMA_VERSION` = `3.0.0`; a v2 theme is refused by version. No converter, no compatibility branch.
- Token ids: `heading`, `body`, `mono` always present, non-removable; every other id is unroled and deletable.
- A token stores no `name`, `size`, `lineHeight`, `letterSpacing` or `trioRole`.
- Computed name: `[Heading] Manrope 600` / `Manrope 600`, role word capitalised from `uiCopy`, role tokens sort first in `heading, body, mono` order.
- Default sizes: `Math.round(artboard.height × ratio)`, heading `1/15`, body `1/67.5`, mono `1/77`; unroled tokens use the body ratio. Never below 1.
- `renderer-core` stays Fabric/DOM-free.
- Every dropdown in the product lists role tokens first, then unroled tokens by name.
- Both the family dropdown and the token dropdown end with action rows `Import local font…` and `Font finder…`; an action never changes the value.
- A role token is never rewritten by an import; a face that already has a token is adopted, not duplicated.
- Decision note `docs/decisions/0124-*.md` lands before the first write to `renderer-core/src/theme/` or `editor-session.ts`.

---

## Phase 1 — Token shape, validation and resolution

Outcome: a theme speaks `typeTokens`, the validator refuses the old shape by version and by key, and a run's size falls back per role.

### Task 1.1 — `TypeToken` replaces `TypePreset`

**Owners:** `renderer-core/src/theme/document.ts` (`TypeToken`, `Globals`), `renderer-core/src/index.ts` exports.

- `TypeToken` is `{family: string; weight?: string | number; face?: {assetId: string}}`.
- `TextRun.typePreset` becomes `typeToken?: \`typeTokens.${string}\``.
- Export `TYPE_TOKEN_ROLES = ["heading","body","mono"] as const` and `isTypeTokenRole(id)`.
- Every `TypePreset` import across the workspace points at `TypeToken`; a mechanical rename, no behaviour change in this task.

**Acceptance:** typecheck passes with no `TypePreset` symbol left; a run without a token is valid.

### Task 1.2 — Validator, keys and schema version

**Owners:** `renderer-core/src/theme/fabric-envelope-validate.ts`, `envelope-keys.ts`, `envelope-semantics.ts`, `fabric-envelope.ts`.

- `SUPPORTED_SCHEMA_VERSION` becomes `3.0.0`; the existing major comparison refuses v2 with the version message.
- A `typeTokens` entry admits only `family`, `weight`, `face`; `size`, `lineHeight`, `letterSpacing`, `trioRole` and `name` are refused as unknown keys, each with the field named.
- A theme whose `typeTokens` lacks any of the three role ids is refused.
- A run's `style` accepts `fontSize`, `lineHeight`, `letterSpacing` alongside its existing keys; `fontSize` must be finite and > 0.

**Acceptance:** focused tests refuse a v2 envelope, a token with `size`, and a token set missing `mono`; a v3 envelope with the five starter tokens validates.

### Task 1.3 — Resolution and default size

**Owners:** `renderer-core/src/scene/plan.ts` (`resolveTypePreset` → `resolveTypeToken`, `isTypePreset` → `isTypeToken`), a new `renderer-core/src/theme/type-size.ts` (`defaultTypeSize(roleOrTokenId, artboardHeight)`).

- The token contributes `fontFamily`, `fontWeight` and the face; it contributes no size or spacing.
- `defaultTypeSize` returns the rounded ratio; it takes the token id so an unroled id falls to the body ratio.
- The run's `style` still spreads after the token, so an authored value wins.

**Acceptance:** plan tests show a heading run at a 1080 artboard resolving to 72 with no authored size, an authored 40 winning, and a 2160 artboard defaulting to 144.

### Task 1.4 — Published schema

**Owners:** `schema/theme-document.schema.json`, the schema sync test.

- `schemaVersion` const becomes 3; `typeTokens` replaces `typePresets`; token properties are the three allowed keys; `fontSize`/`lineHeight`/`letterSpacing` appear in a run's style.
- Sync tests compare the schema with the code's own key lists rather than a copy.

**Acceptance:** `npm run design:check` and the schema sync test pass; a v2 JSON is refused by `$schema` inspection.

---

## Phase 2 — Faces, subsets and import scope

Outcome: a declared face remembers its subset, registration selects by `unicode-range`, and one apply brings the whole family.

### Task 2.1 — Persist the subset

**Owners:** `editor/src/asset-manager/index.ts` (`LocalAssetReference` font arm, `adoptFont`), `editor/src/font-catalog.ts` (`CuratedFontFace`), package schema for asset references.

- A packaged face's declaration gains `subset?: string`; a local import omits it.
- `adoptFont` writes `subset` from the catalogue face.
- The validator accepts `subset` on a font reference and rejects it on other kinds.

**Acceptance:** declaring a provider face writes the subset into the package JSON; a local import round-trips without one.

### Task 2.2 — Register faces by range

**Owners:** new `scene-fabric/src/subset-unicode-range.ts`, `scene-fabric/src/font-assets.ts`.

- A table maps the Google subset names we import (`latin`, `latin-ext`, `vietnamese`, `cyrillic`, `cyrillic-ext`, `greek`, `greek-ext`, …) to their `unicode-range` strings.
- `loadFontAssets` passes `unicodeRange` in the `FontFace` descriptors when the declaration has a subset the table knows; an unknown subset registers without one.
- **Ordering is load-bearing** (ADR 0124, rung 3): a face without a range covers everything and shadows the ranged faces of the same family, and manually added faces are matched in insertion order. Register ranged faces first and the rangeless one last, and never register more than one rangeless face per family.
- The registration key already includes the path, so two subsets of one family coexist.

**Acceptance:** a test registers a family twice (latin + vietnamese) and shows two faces, each with its range; an unknown subset yields a face with no `unicodeRange`.

### Task 2.3 — One apply brings the family

**Owners:** `editor/src/editor-document.ts` (`#adoptCuts` callers), `editor/src/asset-finder/font-preview-panel.tsx` (`familyCutsOf`).

- Applying a cut imports every weight and every subset of that family, subject to the existing already-declared skip.
- `familyCutsOf` returns the family's whole cut list, not the lead subset's.
- A failure still leaves the theme untouched: every read completes before the first adoption.

**Acceptance:** a document test applies one cut of a three-weight × two-subset family and asks the host for six faces once, none on a second apply.

### Task 2.4 — Weight dropdown source

**Owners:** `editor/src/editor-session.ts` (`facesOf`), `editor/src/panes/tokens/token-inspector.tsx`.

- The list is the family's declared faces, lightest first, `italic` named where a style differs, and it excludes duplicate weights only when the style repeats.
- Choosing one writes `weight` and `face.assetId` together (already implemented; keep it under the new shape).

**Acceptance:** existing token-inspector tests pass against `typeTokens`; a family with 400/700 plus 700 italic lists three entries.

---

## Phase 3 — Starter theme, cards and fixtures

Outcome: every shipped theme is v3 and its runs carry their own size.

### Task 3.1 — Starter tokens

**Owners:** `editor/src/new-fabric-theme-globals.ts`.

- Tokens: `heading` (Segoe UI 600), `body` (Segoe UI 400), `mono` (Consolas 400), unroled `segoe-ui-300`, `segoe-ui-500`.
- Ids are stable slugs; names are computed, so no `name` field is written.

**Acceptance:** a new theme contains exactly five tokens, the three roles present, and `starterTypePresets` is gone.

### Task 3.2 — Starter runs carry their size

**Owners:** `editor/src/new-fabric-theme-objects.ts`, `editor/src/new-object-defaults.ts`.

- Each run writes `typeToken` plus `fontSize`, `lineHeight` and `letterSpacing` from the preset it used to point at.
- New text objects write no size and take `defaultTypeSize`.

**Acceptance:** the starter scene's clock text resolves to 108 / 300-weight token; a newly created text resolves to its role default.

### Task 3.3 — Card library and token mapping

**Owners:** `editor/src/card-library.ts`, `editor/src/card-token-mapping.ts`, `editor/src/selection-inspector/run-edits.ts`.

- Cards reference `typeTokens.<id>` and write per-run style where a card used distinct sizes.
- The mapping that derived a token id from `size-weight` is deleted, not ported.

**Acceptance:** inserting a starter card produces runs with the card's own sizes and a role or unroled token reference, and no `size-weight` id remains.

### Task 3.4 — Fixtures and e2e themes

**Owners:** `src/web/.e2e-host-app/themes/*/theme.json`, `src/web/tests/e2e/**`, any v2 fixture in tests.

- Every theme JSON is rewritten to `schemaVersion: "3.0.0"` and `typeTokens`; runs gain their style values where the old preset carried them.
- A test keeps one deliberately v2 theme to prove the refusal message.

**Acceptance:** the full e2e suite passes; the retained v2 fixture shows the version refusal and is not rendered.

---

## Phase 4 — Token inspector

Outcome: the token surface edits a face only, opens the two import flows, and cannot delete a role.

### Task 4.1 — Names, order and delete rules

**Owners:** new `editor/src/type-token-manager/name.ts` (computed name + ordering), `editor/src/panes/tokens/preset-list.tsx` (renamed to `token-list`), `token-inspector.tsx`.

- `tokenName(id, token)` returns `[Heading] Family Weight` or `Family Weight`.
- `orderedTokens(globals)` returns role ids first, then the rest by name.
- Role tokens draw no delete, no rename field; an unroled token keeps the existing reassign-on-delete flow.
- Copy in `ui-copy.ts` says "type token" everywhere and the strings listing presets move with the rename.

**Acceptance:** unit tests pin the three names, the order, and the absence of a delete control on a role token; `ui-copy` surface tests pass.

### Task 4.2 — Family dropdown with action rows

**Owners:** `token-inspector.tsx`, `editor-session.ts`.

- Family options are the package's declared families plus the token's current family marked as not in the package.
- Two trailing action rows dispatch `importLocalFont` / `openFontFinder`; neither changes the token.

**Acceptance:** the dropdown lists declared families then the two actions; choosing an action calls its port exactly once and the token is unchanged.

### Task 4.3 — Weight dropdown writes the face

**Owners:** `token-inspector.tsx`, `editor-session.ts` (`facesOf`).

- Options come from `facesOf(family)`; an empty list leaves the weight read-only.
- Choosing writes `weight` and `face.assetId` together in one document write.

**Acceptance:** choosing 700 records one history entry with both fields (already the shape; re-pin under `typeTokens`).

### Task 4.4 — One import surface for both entry points

**Owners:** `editor-session.ts`, a session-owned dialog for `FontMetadataForm`, the finder modal's target.

- Importing a face that already has a token adopts it; otherwise creates an unroled token for that family+weight.
- A role token is never rewritten by an import.
- "Font finder…" opens the finder with the requesting surface recorded as the apply target.

**Acceptance:** importing a new face from the token inspector creates one unroled token and leaves all three roles' faces untouched; the same face imported twice reuses the token.

---

## Phase 5 — Element inspector and canvas

Outcome: size, line height and spacing are element properties, and the canvas agrees with the rows.

### Task 5.1 — Element token dropdown

**Owners:** `editor/src/selection-inspector/runs.tsx` (`presetOptions` → `tokenOptions`), `per-kind-column.ts`, `appearance.ts`.

- The dropdown uses `orderedTokens` and refs `typeTokens.<id>`; the two action rows act on the selected run.
- The appearance line reads the token's face and the run's own size.

**Acceptance:** a selection with a heading run lists the three roles first; choosing another token rewrites only the ref.

### Task 5.2 — Size, line height, tracking rows

**Owners:** `editor/src/selection-inspector/per-kind-column.ts`, `run-edits.ts`, `editor-document.ts` (run style write).

- Rows read the selected run's `style` and fall back to `defaultTypeSize` for display.
- Writing sets `style.fontSize` / `style.lineHeight` / `style.letterSpacing`; clearing removes the key and falls back to the default.
- Values are rounded and refused when ≤ 0.

**Acceptance:** setting 40 on a run writes one history entry and no token changes; clearing returns the row to the role default.

### Task 5.3 — Canvas resize writes the size

**Owners:** the scaling commit path (`snap-manager/scaling/*`, the session's post-transform write), `editor-document.ts`.

- On a text object's transform commit, `fontSize` becomes `Math.round(fontSize × scaleY)` on every run lacking its own size relative to the object, and `scaleX`/`scaleY` reset to 1.
- A sibling text sharing the same token is untouched.

**Acceptance:** a browser or dom test scales a text object and shows only that object's run size changing; the undo restores both size and scale.

### Task 5.4 — New text defaults

**Owners:** `new-object-defaults.ts`, `editor-document.ts`.

- A new text object writes no `fontSize`; the renderer supplies the role default, so editor and player show the same size.

**Acceptance:** creating a heading text at a 1080 artboard shows 72 in the inspector without any size being written.

---

## Phase 6 — Close-out

### Task 6.1 — Docs and decision note

**Owners:** `docs/decisions/0124-*.md`, `docs/DESIGN.md` (§ markers stable; a new or amended § cites the model), `docs/architecture/ownership.md`, `docs/README.md` if the map moves.

**Acceptance:** `npm run docs:check` and `npm run design:check` pass; no doc still says type preset as the persisted noun.

### Task 6.2 — Full gate and proof

- `npm run gate`, `npm run typecheck`, `npm run design:check`, `npm run status:check` from `src/web/`.
- Browser proof: 72 at 1080; resize isolation; token swap keeps size; dropdown order and both action rows; v2 theme refused.
- STATUS.md rewritten to the five-bullet shape; anything found but not fixed filed through a commit trailer.

**Acceptance:** every command above exits 0 and its code is recorded; the browser evidence is described in STATUS.md.
