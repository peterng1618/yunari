# 0024 — The DOM suites run on jsdom 30

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/package.json`, `src/web/tsconfig.e2e.json`, `src/web/packages/editor/package.json`, `src/web/packages/editor/src/editor-shell/settings.dom.test.tsx`, `src/web/packages/editor/src/components/ui/colour-picker.dom.test.tsx`, `src/web/packages/editor/src/components/ui/gradient-editor.dom.test.tsx`

## Problem

jsdom stays at 26.1.0 only because upgrading it broke editor DOM cases, and
whatwg-encoding reaches the tree solely through that version (#218, `vg-729`).
The release plan tried the override, saw failures, and removed it; the
deprecated copy stayed.

## Rung 1 — internal owner

Searched: `vitest.config.ts` (`environment: "jsdom"`), the root
`devDependencies`, fabric 7.4.0's `optionalDependencies`, and every DOM test
that reads computed style.

Found: one declared jsdom (the test environment) plus fabric's optional
`^26.1.0`, which is never imported by the product. The failing assertions are
all reads of `getComputedStyle`/`style`, not product code.

## Rung 2 — installed dependencies

Read: jsdom 30.1.3's manifest. Its engine floor is
`^22.22.2 || ^24.15.0 || >=26.0.0`; it drops whatwg-encoding in favour of
`@exodus/bytes`. Fabric 7.4.0 (latest) still declares `jsdom ^26.1.0` as an
optional dependency, so the override is the only way to one copy.

## Rung 3 — native platform

Searched: npm's override resolution and workspace hoisting.

Found: the override dedupes fabric's optional edge to the root copy. npm marks
that single requester edge `invalid` because 30.1.3 is outside `^26.1.0`; the
installed tree is still one jsdom, and `npm ls jsdom` reports 30.1.3. A fully
clean install is needed for the override to take: removing only the root
`node_modules` leaves the package-level copies in place and silently preserves
the old tree.

## Rung 4 — public solutions

Searched: jsdom's v30.0.0 release notes and its border-width change
(`jsdom/jsdom#4268`), plus the existing override pattern in this repo.

Found: jsdom 30 fixed `getComputedStyle()` to convert lengths to pixels, fixed
CSS function serialisation, and corrected border widths (a borderless element
reported a phantom 16px). Those are exactly the three failure shapes; they are
test-environment corrections, not product regressions. Fabric has not moved its
optional range, so the override remains the reuse-first answer.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Stay on 26.1.0 | known | deprecated whatwg-encoding forever | rejected by the ruling |
| Nested jsdom for tests only | isolates | two DOM implementations, fabric's copy still 26 | rejected: whatwg-encoding stays |
| Override to 30 and adapt the five assertions | one jsdom | re-verify editor DOM suite | chosen |
| Patch fabric's manifest | none | a vendored edit to a dependency | rejected |

## Rung 6 — smallest probe

With 30.1.3 installed, `packages/renderer-core packages/scene-fabric packages/editor`
showed five distinct failing assertions (the two extra reported failures were
cascades of the first: its `picker.close()` never ran, so the next test's
teardown threw `NotFoundError`):

| Case | jsdom 30 behaviour | Test change |
|---|---|---|
| Heading letter-spacing | `0.11em` computed to px against the 16px base | parse the px value and compare to `0.11 * 16` |
| Rebind row grid columns | unset `grid-template-columns` serialises as `none` | expect `none` |
| Colour-track pointer | border width with initial `none` style computes to 0 | draw the edge (`1px solid transparent`) |
| Gradient track paint | `rgb(a b c)` serialises to the legacy comma form | compare against the same value stored by a probe element |
| Gradient mark pointer | same border-width cause | draw the edge |

After the changes: 290 files / 4308 tests green, and the full workspace gate
green.

## Rung 7 — decision

Take jsdom 30.1.3 as the root devDependency and override it for fabric's
optional edge; adapt the five assertions to jsdom 30's corrected CSSOM instead
of asserting values 26 reported wrongly. The tsconfig for the e2e program names
`types: ["node"]` rather than one hoisted path, because the clean install moved
`@types/node` to the root. `lucide-react` stays pinned at 1.61.0: 1.66 removes
the named `__iconData` export the starter icon conversion imports, which is a
separate migration. `systeminformation` moved 5.33.16 → 5.33.19 within its
declared range during the clean install and its notice is updated with it.
