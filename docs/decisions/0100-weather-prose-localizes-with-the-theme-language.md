# 0100 — Weather prose localizes with the theme language

- **Date:** 2026-11-03
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/providers/weather/conditions.ts`,
  `src/web/packages/host/src/providers/weather/provider.ts`

## Problem

A display reports its theme's language on the stream connection, and the host
groups samples by assignment and language so one poll answers a display in its
own words. The weather provider already localizes `weather.condition` through a
closed code table, but the table carries only English and German. A Vietnamese
theme therefore renders its bound date in Vietnamese and its condition in
English. `weather.location` has two sources: a place the author chose in
Settings, and the host's own synthetic label when Windows supplied the fix. The
second is a host word and also stayed English.

A wrong choice fails quietly: falling back to English looks like a complete
translation; translating an author's chosen place name would rewrite their
data; a network translation service would make a reading depend on an
unrelated outage.

## Rung 1 — internal owner

Searched: CodeGraph for `conditionText`, `locationText`, `SampleContext`,
`WeatherProvider.sample`, `#readingSample`, and the stream's language grouping.

Found: `conditions.ts` is the owner of the condition vocabulary and already
holds parallel English and German tables keyed by the WMO codes. `provider.ts`
receives `context.language` from `registry.groupByAsk` and passes it to
`#readingSample`, which calls `conditionText(code, language)`. The location
branch used a single English constant (`WINDOWS_LOCATION_LABEL`) or
`settings.label`. No second localization mechanism exists.

## Rung 2 — installed dependencies

Searched: `src/web/package.json` for i18n/locale/format packages, and the
weather tests.

Found: none installed. The host deliberately keeps its runtime dependency list
small, and the existing German table shows the accepted shape: a hand-checked
table beside the source vocabulary. A translation package would add a data
source and a loading policy for 28 fixed codes.

## Rung 3 — native platform

Searched: `Intl` (`Intl.DisplayNames(["vi"]).of("VN")`, `Intl.Locale`,
`Intl.supportedValuesOf`).

Found: `Intl` localizes region and language names (`Việt Nam`) but has no
weather-condition vocabulary and no WMO code table. `Intl.Locale` only parses
and validates the tag the display already sends.

## Rung 4 — public solutions

Searched: WMO code table 4677 and Open-Meteo's documented WMO subset
(`open-meteo.com/en/docs`), plus repository history for the existing German
table. Live web search was unavailable in this session, so this rung records the
standard and the repository's precedent rather than a fetched page.

Found: the codes are a fixed, closed list; Open-Meteo publishes English names
only, and comparable clients that localize them hand-author a table per
language. No official Vietnamese mapping exists to reuse.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Machine-translate at sample time | Covers any language | Network dependency, nondeterministic text, latency in the sampling path | Rejected |
| Add an i18n dependency | Reusable catalogue | New runtime dependency, loading policy, still needs the Vietnamese strings | Rejected for 28 fixed words |
| Extend the existing closed table | Same owner, same shape, reviewable | The Vietnamese words themselves | Accepted |
| Do nothing | none | The reported mixed-language theme remains | Rejected |

## Rung 6 — smallest probe

The new `conditions.test.ts` cases assert all three tables share the English
key set, that every code reads its Vietnamese word (including `vi-VN`), and
that `locationText` resolves `vi`/`de-DE`/unknown. The provider test samples one
cached reading under `en`, `de` and `vi` and asserts the numbers are identical
while the condition differs; the Windows-location test asserts the synthetic
label reads `Vị trí Windows` while an author-chosen `Berlin, Berlin, DE` is
returned unchanged.

## Decision

Add `VI_CONDITIONS` to the existing code table and route `vi` through
`CONDITION_TEXT`, using the primary subtag as German does. Add a small
`LOCATION_TEXT` table for the host's synthetic Windows label and read it at
sample time. A place the author chose in Settings stays exactly as authored:
it is their data, not a host string. The provider drops its stored
`#placeLabel`; the current settings already say whether the place is authored
or located.

Skipped: translating author-chosen place names and weather attribution text.
Add neither unless the product decides place names are labels rather than data;
attribution belongs to the backend that requires it.
