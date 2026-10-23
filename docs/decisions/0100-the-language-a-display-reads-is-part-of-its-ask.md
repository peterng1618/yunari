# 0100 — A display's language is part of its ask, and the player is the one that knows it

- **Date:** 2026-10-24
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/providers/registry.ts`

## The problem

`weather.condition` is the first sample whose value is prose rather than a
number, and prose has a language. Every provider currently answers from
`(keys, now, assignment)`, one answer per assignment, and the registry merges
every display holding that assignment into one poll. Localizing the condition
means two displays can hold the same devices and need different *text* from one
reading. The non-obvious part is where the language comes from: the host does
not have it, and reading the display's theme to find it would load up to 32 MiB
of `theme.json` per display per tick with no change notification to cache
against.

## Rung 1 — Yunari

Searched: `packages/host/src/providers/` for anything that already varies by
locale, `themeLanguage` across the workspace, and the registry's grouping.

Found: no host-side localization. The player already reads
`theme.metadata?.themeLanguage` (`main.ts`, `declareDocumentLanguage`) and
`renderer-core` formats dates through `Intl.DateTimeFormat` with it
(`scene/datetime/names.ts`). The host's `registry.ts` keys groups on the
assignment's JSON alone, and `SseConnection` carries the keys a display asked
for. So the language exists on one side and the grouping exists on the other;
nothing carries it between them.

## Rung 2 — dependencies

Searched: every `package.json` in the workspace for `i18next`, `react-intl`,
`@formatjs/*`, `intl-*`, and `node_modules` for the same names.

Found: nothing installed. No i18n package is a dependency of any package.

## Rung 3 — platform

Searched: `Intl.Locale`, `Intl.getCanonicalLocales`, and plain string splitting
in the Node 22 runtime this repo requires.

Found: the runtime answers the only question asked — the primary subtag.
Measured: `new Intl.Locale("de-DE").language` is `"de"`, and
`"de-DE".split("-")[0]` is `"de"`. `Intl.Locale` throws `RangeError` on a
malformed tag, so it would turn a stray value into a failed sample; the host
already validates the tag before it reaches the table, and `split` cannot
throw.

## Rung 4 — ecosystem

Searched: `npm view i18next version`, `npm view @formatjs/intl-localematcher
version`, `npm view react-intl version`, and the workspace for message-format
files (`locales/`, `.po`, `.json` message catalogues).

Found: i18next 26.5.7, `@formatjs/intl-localematcher` 0.9.0, react-intl 12.1.5
all exist, and all solve *message catalogues*: they resolve a locale to a
pluralized, namespaced message bundle, with a loader and a fallback chain. The
shape here is one closed 28-row table per language for a sensor value that is
not UI copy, has no interpolation, no plurals and no namespaces. Adopting a
catalogue library would add a dependency, a locale loader and a fallback
policy to replace a `Record<number, string>` lookup.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Host reads the theme record per tick | Language is authoritative | Up to 32 MiB disk read per display per second; no invalidation | Slow host, stale language nobody can see | Rejected |
| i18next / react-intl / FormatJS | Catalogue resolution | New dependency, loader, fallback chain | Over-build for one closed table | Rejected |
| `Intl.Locale(lang).language` | Primary subtag | Throws on malformed input | A stray tag fails the sample | Rejected inside the table |
| Player sends `lang`, host validates, `split("-")[0]` | Language rides the request that already exists | A query parameter and a regex | A hostile client mistranslates only its own display | **Chosen** |

## Rung 6 — probe

- `node -e` on 2026-10-24: `new Intl.Locale("de-DE").language` → `"de"`;
  `Intl.getCanonicalLocales("DE-de")[0]` → `"de-DE"`; `"de-DE".split("-")[0]`
  → `"de"`; `new Intl.Locale("de_DE")` throws `RangeError`.
- The player already constructs the stream URL from the loaded theme's envelope
  (`startHostedTheme`), so the language is in hand before the first sample; no
  fetch or store read is added.

## Decision

**The language is the player's to send, and the registry groups on it.**
`SampleContext` carries `assignment` and `language`; `DisplayAsk` gains
`language`, and `groupByAsk` keys on the assignment JSON plus
`\u0000` plus the language, so equal devices in two languages are two polls.
A display takes the language of its most recently added connection that has
one, and the host accepts a value only when it matches
`^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$` and is at most 35 characters — anything
else is dropped rather than refused, because a bad tag is not a reason to stop
a display. `conditionText` resolves a region tag by its primary subtag and
falls back to the English table; weather's timer, backoff and staleness rules
keep their own owner and never read the context.
