# Font catalog and trio picker

- **Status:** superseded in part by
  [`2026-10-25-fonts-and-assets-design.md`](2026-10-25-fonts-and-assets-design.md):
  the generated catalogue, pinned faces, bound presets and Unbind stand; its face
  picker, facet selects, favourites-only filter, trio select and type-preset
  panel sections do not. Its plan predates the replacement and must not be
  executed for those sections.
- **Supersedes:** the curated-font slice of
  [`2026-09-20-packaged-fonts.md`](../plans/archive/2026-09-20-packaged-fonts.md) <!-- doc-ref-ok: never migrated into plans/; its source at .agents/plans/ is gone (04dc86dd) -->
  Task 3, which was never completed.

## Why

The editor advertises a curated font catalogue and a trio picker. The catalogue
holds one hand-written trio, so the picker offers one choice:

```ts
// editor/src/font-catalog.ts
const TRIOS: readonly FontTrio[] = [{ id: "minimal", /* ... */ }];
```

The plan that introduced the file specified vendoring Fonttrio pairing metadata.
That step was not executed. The one entry that exists borrows the id `minimal`
from upstream, where `minimal` means Geist + Geist + Geist Mono; the shipped
faces are Inter + Inter + JetBrains Mono. The id claims provenance the data does
not have, and `THIRD-PARTY-NOTICES.md` describes pairing data that was never
copied.

Three further gaps make the catalogue unusable at any real size, and all three
must be closed before adding entries is worthwhile:

- The picker is a native `<select>`. Upstream ships 380 pairings; a select is
  not a browser for 380 choices.
- Applying a trio rewrites each role preset's weight to the face's weight
  without saying so, and the picker cannot preview the result.
- A preset carrying an adopted face cannot be edited. Family and Weight look
  editable, but `fabric-envelope-validate.ts` rejects the mismatch and
  `editor-shell.ts` throws at save.

## What upstream provides

Measured against the Fonttrio registry at the revision this design pins. All
380 pairing documents fetched; uniform shape, no errors.

| Field | Use |
|---|---|
| `title` | Display name, e.g. `Dashboard — Manrope + DM Sans + Fira Code` |
| `description` | One-line rationale, 12–216 characters |
| `cssVars.theme` | `--font-heading` / `--font-body` / `--font-mono` to a family |
| `css.@layer.base.h1` | The pairing's own recommended heading weight |
| `categories` | Freeform, 61 distinct values; not usable as a facet directly |
| `meta.mood` | Freeform, 59 distinct values |
| `meta.useCase` | Freeform, 76 distinct values |

All 380 pairings resolve to Fontsource families that publish a `latin` subset,
covering **174 distinct families** and **238 distinct (family, weight) faces**.
Every pinned artifact URL probed returns 200 with a real WOFF2 payload and
`access-control-allow-origin: *`, so the editor can fetch them as it already
does for a single face.

## Design

### The catalogue is generated, and the generation is pinned

`font-catalog.ts` keeps its exported surface — `fontTrio`, `fontTrios`,
`faceForRole`, `applyFontTrio` — and stops holding literal data. The trios come
from a generated module committed alongside it.

The generator resolves three sources at a recorded Fonttrio commit:

1. the registry index, for pairing names, titles, descriptions and tags;
2. each pairing document, for the three role families and the heading weight;
3. `api.fontsource.org/v1/fonts/:id` per family, for `npmVersion`, subsets,
   available weights and licence.

Each role face is emitted with a pinned version, `latin` subset, `woff2`
format, and its OFL-1.1 name and URL. No `latest`, preserving the invariant
`font-catalog.test.ts` already asserts. The 238 faces are deduplicated across
380 trios, so one family appears once however many pairings use it.

**Heading weights are clamped to what the family ships.** Upstream recommends
700 for 238 pairings, 600 for 77, 800 for 45 and 400 for 20, but 49 pairings
recommend a weight their heading family does not publish — 20 families ship no
700 at all (Anton, Abril Fatface, Archivo Black, and others). Every body and
mono family publishes 400, so the clamp only ever affects headings. The
generator
resolves the nearest available cut and records it on the face. The picker
renders the clamped value, so the specimen is what applying produces.

**Drift policy: pinned revision, verified in shape.** The generated module
records the Fonttrio commit it was built from, and a unit test asserts the
catalogue still matches that revision's shape — 380 trios of three roles, 238
unique face ids, every URL pinned, every clamp recorded. Upstream changing
afterwards does not fail a build; refreshing the catalogue is a deliberate act
of running the generator and committing the result.

### The picker is one list, and a trio is a bulk reseed

The font face picker is the primary way to choose type. It lists all 238
curated faces, searchable, each row showing the family name **rendered in that
family's own face** — the Photoshop specimen list the product wants. A trio
picker sits beside it as a bulk operation: choosing a trio seeds all three
role presets at once, and any single role can be re-seeded afterwards from the
same face list. Both are the same operation at different scopes, so there is
one list and one meaning.

This replaces the current three-option dropdown. The existing `Font` and
`Trio` controls, their `data-yunari-*` selectors and their keyboard
behaviour are kept, because the archived plan requires the controls to stay
keyboard-accessible with their current selectors.

The picker is a Base UI island inside the type-preset panel, matching
`editor-shell/canvas-dock.tsx`. It is the first React in that panel, which is
acceptable because `font-catalog.ts` and the preview owner hold no DOM.

**Layout.** A search field, a facet row, a sort control, and a virtualised
result list. Each row shows the trio or face name in its own face, its weight,
and — for trios — the three families it seeds.

**Facets are derived, not invented.** Mood and use-case take the highest-
frequency tags by count, superfamily comes from Fontsource's own `category`
field. A facet **narrows** — it keeps the entries that carry its tag and drops
the rest, so a trio with no matching tag leaves the list: keeping the tagged and
the untagged alike is the whole list, and a control that never filters anything
is not a facet. "Reachable by search" is the narrower guarantee, and it applies
where it literally can: a face carries no tag of its own, so it stays reachable
while any trio that seeds it carries the chosen tag. `font-catalog-query.ts` is
the owner — `matchesFacet` drops an untagged trio and `queryFaces` keeps a face
through any seeding trio. Facet chips whose count is one are not shown.

**Faces load progressively.** `font-preview.ts` currently holds exactly one
face and releases the previous on entry, which cannot back a list where many
rows are visible at once. The preview owner gains a multi-face set: an
`IntersectionObserver` over the virtualised rows requests a face as its row
approaches the viewport, deduplicates by face id, and caches for the session.
A row renders in the system face until its own arrives. Closing the picker
releases the resident set.

The cost is real and the design accounts for it: a face averages 17 KB, so all
238 is roughly 4 MB. A virtualised list shows about fifteen rows, so opening
the picker costs roughly 255 KB and scrolling fetches more. Rows show their own
loading state rather than blocking the list.

### Favourites are a machine setting, not theme content

A favourite is a statement by the author about this PC. It is not authored
theme state and never enters a `.yunari-theme` package, so the player does not
receive it and the document schema gains no field.

It is stored by a new host settings owner beside `display.ts`, following that
file's shape exactly: normalise the unknown input, refuse what cannot be
stored, read with a fallback that never fails a load, write atomically. It is
served over the host's existing `/api` pattern and read by the editor through
the same client shape as `theme-library-client.ts`. An unknown trio id in the
stored list is dropped on read rather than rendered as a dead favourite.

### Applying a face sets the weight, and a bound preset says so

**Trio apply** sets each role preset's `family` and `weight` to the chosen
face's, from the generated, clamped weights. Size, line-height, letter-spacing
and every preset without a `trioRole` are untouched. Applying `dashboard`
therefore turns the `70-300` Clock into Manrope 700; the picker showed that
weight before the author applied it, so the change is a consequence they chose
rather than a surprise.

**A preset carrying a face is bound.** While `face` is present, Family and
Weight render disabled with a visible hint naming the packaged face, and an
explicit **Unbind** control. Unbind drops the face reference and returns the
preset to a normal free-text token — a deliberate action, not a side effect of
typing. The document can therefore never disagree with its assets through the
UI, while `fabric-envelope-validate.ts` keeps enforcing that invariant for
hand-edited packages.

**Single-face apply** keeps its current behaviour: it preserves `trioRole` and
the preset's whole treatment, which is what lets a later trio apply re-seed a
preset the author has partly overridden.

## Non-goals

- Variable-font axes, `font-variation-settings`, or automatic scale
  substitution.
- Arbitrary font upload or user-supplied URLs. The catalogue stays curated.
- Shipping all 238 faces in a package. Only faces actually applied are adopted;
  browsing a specimen is transient and persists nothing.
- Fonttrio as a runtime dependency. It is copied data, attributed as MIT.
- Replacing the imperative type-preset panel. The picker is an island in it.
- Changing the theme document schema. Favourites and the catalogue are both
  outside it.

## Verification

**Unit.** The generated catalogue is internally consistent: 380 trios of three
roles each, 238 unique face ids, every URL version-pinned with no `latest`,
every weight clamp recorded, every family publishing `latin`. `applyFontTrio`
on a real non-`minimal` trio preserves size, line-height, letter-spacing and
non-role presets while setting the role weights. The clamp test fails when the
clamp is disabled, since a silent clamp regression is exactly the failure that
shows a specimen the apply will not reproduce. Unbind drops the face and leaves
a valid envelope. The bound preset renders Family and Weight disabled.

**Host.** The favourites store normalises, refuses unknown values, reads with
the empty fallback, and writes through, matching `display.test.ts`.

**Browser.** The picker opens; search narrows; a facet filters the list to the
entries that carry its tag — a trio with no matching tag leaves the list, and
a face leaves it only when none of the trios that seed it carries the tag; a row
previews in its own face; apply seeds all three roles;
a single face overrides one role; a later trio apply re-seeds it; unbind leaves
a preset editable and saveable; favourites survive an editor reload. Screenshot
capture follows `docs/evidence/screenshots/README.md`.

**Gate.** `format:check`, `lint`, `typecheck`, unit, `build`, `size` and the
browser suite at the plan boundary.

## Risks

- **Catalogue weight.** 238 faces is roughly 4 MB of CDN traffic across a full
  scroll. Virtualisation and a session cache keep the common path near 255 KB,
  but browsing is not free and per-row loading state is required, not optional.
- **Upstream churn.** Fonttrio is a third-party registry. The pinned revision
  makes today's data reproducible; it does not make tomorrow's. Refreshing is
  a deliberate regeneration, and the shape test is what catches a bad refresh.
- **Clamped specimens.** 49 pairings get a heading weight their author did not
  recommend. The clamp is correct — a weight the family does not ship cannot be
  applied — but the picker must label it rather than present it as upstream's
  choice.

## Open questions

None outstanding. The decisions taken during design: ship all 380 rather than a
curated subset; facet on derived vocabulary; favourites in host settings rather
than the theme package or `localStorage`; a trio declares its role weights and
apply adopts them; a bound preset stays bound with an explicit unbind; the face
list is primary and trios are a bulk reseed over it.
