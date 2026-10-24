# 0112 — A previous schema major is migrated in memory on open, through one dispatcher

- **Date:** 2026-10-25
- **Status:** accepted
- **Paths:** `src/web/packages/renderer-core/src/theme/fabric-envelope.ts`
  `src/web/packages/renderer-core/src/theme/fabric-envelope-validate.ts`
  `src/web/packages/renderer-core/src/theme/migrations.ts`
  `src/web/packages/host/src/server.ts`

## The problem

The theme envelope's `schemaVersion` is an integer owned by
`fabric-envelope.ts` (`SUPPORTED_SCHEMA_VERSION = 2`), and every open path calls
`validateFabricThemeEnvelope`, which refuses anything that is not exactly that
integer. The product is about to publish its first release, and the spec's rule
after that boundary is that the previous schema major still opens.

The shape is not "add a migration". It is: **a persisted document's version is
the only thing that says how to read it, and every reader must agree on who
converts it.** A reader that calls the strict validator directly is the defect
the mechanism exists to prevent, and it fails silently — the document simply
does not open, or worse, a writer accepts a document it should have refused.
There is a second, sharper fact: every theme already saved by this build
carries the integer `2`, so the first decision at the release boundary is
whether that existing data opens at all.

## Rung 1 — Yunari

Searched: `git grep -n -E "schemaVersion|migrat|upcast" -- docs src/web/packages`
(excluding `node_modules`; `rg` is not installed in this environment). Read
`docs/decisions/0017`, `0022` and `0041` in full.

Found: **no migration mechanism of any kind exists.** The hits are the refusal
itself and the rulings against building one:

- `fabric-envelope-validate.ts` refuses a non-integer version, a newer one, and
  any other integer, in three separate sentences (lines 65–86).
- `fabric-envelope.ts:17` owns the number; `FabricThemeEnvelope.schemaVersion`
  pins itself to it (`:32`).
- Writers emit the literal: `new-fabric-theme.ts:46`, `item-fixture.ts:56`,
  `scene-fabric/src/persist.ts:112` (which reads the constant).
- `docs/decisions/0017` rejected migrating the old ZIP store — *"rejected by
  the user — start clean"* (`:83`), *"Existing archives are ignored rather than
  migrated"* (`:108`). `0022` closes with *"Clean break, no migration."*
  `0041` states the repo *"has no version-migration mechanism"*, retired schema
  v1 by deletion, and records that the repo *"has twice ruled against
  migration"*.

So the reusable thing is the validator's sentences and its key lists, not a
converter. Any reader that wants an old document must be routed through one new
entry point, because nothing today converts.

## Rung 2 — dependencies

Searched: `git grep -n -E "ajv|json-schema" -- 'src/web/**/package.json'` and
`git grep -n -E '"node_modules/(ajv|json-schema)' -- src/web/package-lock.json`
(both re-run 2026-10-25; both exit 1 with no output, i.e. no direct or
transitive match), then read every workspace manifest's dependency list.

Found: **nothing.** No schema library, no ajv, no `migrate*`/`upcast*` package
in any manifest. Validation is hand-written against hand-maintained key lists
(`envelope-keys.ts`), and 0041's rung 2 reached the same result for the same
reason. There is no dependency whose migration capability could be reused, and
adding one for a dispatcher this small would introduce a second validator
vocabulary beside the existing one.

## Rung 3 — platform

Searched: `schema/theme-document.schema.json` and the loader that reads it.

Found: **JSON Schema can describe a version but cannot dispatch one.**
`schema/theme-document.schema.json:3` names the version in its `$id`
(`…/theme-document/2.json`) and `:10` constrains it (`"schemaVersion": { "const": 2 }`).
That is refusal, not conversion: a schema has no mechanism to load a second
schema and transform a document between them. Dispatch therefore belongs to the
loader, and the loader today is exactly the strict `validateFabricThemeEnvelope`
call. Rung 3 passing does **not** discharge rungs 4–5 — the remaining question
is which conversion shape, and where it sits relative to validation.

## Rung 4 — ecosystem

Searched: the three published shapes for evolving a persisted document format
— an **upcaster chain** (N→N+1 functions composed into a path, the
event-sourcing pattern), **version dispatch at the loader** (read the version,
route to a matching reader), and a **dual reader with write-forward** (accept
old and new, always write new). Also checked the registry for the release
tooling in 0113's sibling note, and ran a web search for upcaster prior art.

Found: **all three exist, and two of them are already refused in writing here.**
0017 (`:83`, `:108`) and 0022 (`:126`) rejected migration *before* the release,
and 0041 (`:45`) names the same three shapes and records that adopting the
upcaster chain then would have contradicted both. The reason those rulings held
is stated there and is the opposite of today's: **nothing was published, so
there was no data whose owner needed it kept readable.** The web search returned
no results on 2026-10-25 (the design's risk note already records the same
unavailability), so the ecosystem evidence is the repo's own prior research
plus the registry.

The comparison that matters is therefore not "library versus native" but
"refusal versus conversion, at a boundary that just moved".

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Keep strict refusal (delete-only) | Works today; consistent with 0017/0022 | None now | Every theme already on disk carries integer `2`, so after the first release the product refuses its own users' data | **Rejected** — the release boundary is what changes the answer |
| A migration per reader, in place | Local and obvious | One conversion written N times, per reader | A reader missed is silent, and a writer could accept an old document | **Rejected** — the mechanism-boundary failure |
| **One dispatcher, migration before validation, strict writers** | One entry point every reader routes through; strictness preserved where it protects data | One new module and a routing change per reader | A new major without a migration must fail at test time, which an invariant test covers | **Chosen** |
| Dual reader, write forward | Accepts old and new without a chain | Two readers forever, and the old one never dies | Second truth in every reader; no single place to enforce the major rule | **Rejected** — 0022 already refused the equivalent glue |

The dispatcher wins on the release-boundary reason: before the release a break
is clean because there is no data to strand; after it, a published document is
data someone owns, and the cheapest durable answer is one conversion point in
front of the validator that still refuses everything else.

## Rung 6 — probe

A probe outside the repository
(`C:\Users\peter\AppData\Local\Temp\yunari-a1-probe\migration-probe.mjs`) ran
the exact shape Task A3 ships: a synthetic `MIGRATIONS` table keyed by the
major being migrated **from**, a `1 → 2 → 3` chain, the legacy-integer
normalisation, and numeric major parsing. Measured output:

```json
{
  "chainOk": true,
  "steps": ["1->2", "2->3"],
  "migrationsInvoked": [1, 2],
  "invocationsPerStep": { "1": 1, "2": 1 },
  "finalVersion": "3.0.0",
  "fieldsCarried": ["addedIn2", "addedIn3", "id", "schemaVersion"],
  "legacy": {
    "integer2": "2.0.0",
    "integer2Minor": 2,
    "integer3": 3,
    "integer1": 1,
    "string200": "2.0.0",
    "major10": 10,
    "major2": 2,
    "stringCompareWouldSay10IsOlder": true
  },
  "medianMicroseconds": 0.3
}
```

Read: each step runs exactly once, in ascending order; the target major is
verified after the chain; a field added by an earlier step survives the later
one; the legacy integer equal to the supported major becomes `"2.0.0"` while
every other integer and every non-string is left for the validator to refuse;
`"10.0.0"` parses as major `10`, which a string comparison would read as older
(`"10.0.0" < "2.0.0"` is `true`). A two-step chain cost 0.3 µs median over
10,000 runs — the dispatch is not a cost argument.

## Rung 7 — build

The plan's Phase A: A2 makes the version a semver string and refuses the
integer at the write path, A3 lands `migrations.ts` with an injected table and
the invariant that every accepted older major has a migration, A4 routes each
open path through `readFabricThemeEnvelope` while save, snapshot and publish
write paths stay on the strict validator. The note claims
`host/src/server.ts` because the publish route migrates before publishing.

## Decision

**One dispatcher in `renderer-core/src/theme/migrations.ts` migrates a document
in memory before validation; open paths call `readFabricThemeEnvelope`, write
paths keep calling the strict validator.**

The specific reason: the first release turns saved themes into data their
owners keep, and the single conversion point is the only shape that both keeps
that data readable and keeps one strictness boundary where a wrong write is
refused. The legacy integer `2` is normalised because it is the exact value
every existing document carries; any other integer is refused rather than
guessed at.
