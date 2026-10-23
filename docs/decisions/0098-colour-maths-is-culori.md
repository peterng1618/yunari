# 0098 — Colour parsing and conversion are culori's, wrapped once

- **Date:** 2026-10-23
- **Status:** accepted
- **Paths:** `src/web/packages/renderer-core/src/charts/fill.ts`

## The problem

The editor and the chart renderer each needed to read a stored colour, get its
channels, and write one back. Each had written its own parser, each accepted a
different subset, and neither could round-trip what the other wrote. Colour
conversion (RGB↔HSV for a picker) is pure but fiddly: greys have no hue, alpha
has two representations, and hex output has a 6- and 8-digit form. Hand-writing
it a third time is the expensive kind of wrong.

## Rung 1 — Yunari

Searched: `parseHex`, `parseColour`, `colour-maths`, `Rgba`, `toHex` across
`src/web`; the editor's `components/ui/colour-maths.ts`; `charts/fill.ts`.

Found: two owners. `charts/fill.ts#parseHex` returned a 3-tuple and refused CSS
names, `rgb()` and `hsl()`. `components/ui/colour-maths.ts` was a ~200-line
hand-rolled parser with its own `Rgba` and `toHex`. Neither covered the other's
inputs, so a stored `rgb(...)` value was paintable in one path and refused in the
other.

## Rung 2 — dependencies

Searched: every `package.json` under `src/web/packages` and `src/web` for a
colour package.

Found: none. `echarts` has colour helpers, but they are reachable only through
the chart runtime and are not a parsing API; depending on ECharts for channel
maths in the editor would invert the ownership `renderer-core` is meant to hold.

## Rung 3 — platform

Searched: `CSS.supports`, `CanvasRenderingContext2D`, `EyeDropper`.

Found: `CSS.supports("color", value)` validates a string but yields no channels.
A canvas can paint a colour and read the pixel back (round-trip only), which
needs a DOM and a canvas per parse. `EyeDropper` samples the screen, not a
string. None of these produce RGBA from `hsl()`, and none format hex.

## Rung 4 — ecosystem

Searched (npm registry metadata and project pages, 2026-10-23): `culori`,
`colorjs.io`, `chroma-js`, `color-convert`, `tinycolor2`; also the ReUI colour
picker this work follows, to see what it uses for maths.

Found: ReUI's picker is interaction only — it reads `hsv` channels from the
consumer and does no conversion, so it could not be the owner either. Of the
libraries: `colorjs.io` is CSS-Color-4 complete but ships a large parser and a
class API; `chroma-js` is ESM-unfriendly in parts and heavier than needed;
`color-convert` converts between spaces but parses no CSS strings;
`tinycolor2` is CommonJS and unmaintained for this purpose. `culori` exposes a
functional API, a `/fn` entry point that tree-shakes to the modes registered,
parses CSS strings including names and `hsl()`/`rgb()` with space or comma
syntax, and formats `#rrggbb`/`#rrggbbaa`.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Keep two hand parsers | Exact current behaviour | Nothing today, two owners forever | Each new input lands twice or not at all | Rejected |
| `CSS.supports` + canvas probe | No extra dep | DOM-bound, still no conversion | Editor-only, unusable in the host | Rejected |
| `colorjs.io` | Complete | Large, class-oriented | Bundle cost for one picker | Rejected |
| `chroma-js` | Parses and converts | Heavier, mixed module shape | Size and interop | Rejected |
| `color-convert` | Good conversion | No CSS parsing | Still needs a parser | Rejected |
| **`culori@4.0.2`** | Parses, converts, formats; functional; `culori/fn` | MIT, zero dependencies, 1 types package | None found in probe | **Accepted** |

## Rung 6 — probe

Ran against the installed package with `node --input-type=module`:

- `parse("#081523d9")` → `{ r: 0.0314, g: 0.0824, b: 0.1373, alpha: 0.8510 }`,
  and `formatHex8` of it returns `#081523d9` — an 8-digit value round-trips.
- `converter("hsv")(grey)` returned `{ s: 0, v: 0.502 }` with **no `h`
  property**, confirming the grey case must normalise a missing hue rather than
  rely on `NaN` alone.
- `formatHex(converter("rgb")({ mode: "hsv", h: 120, s: 1, v: 1 }))` returned
  `#00ff00`.
- The package ships no TypeScript declarations of its own; `@types/culori@4.0.1`
  covers the `/fn` entry, so it is a devDependency beside it.

## Decision

`renderer-core/src/color.ts` becomes the single owner: `parseColor`,
`formatColor`, `toHsv`, `fromHsv` and the `Rgba`/`Hsva` shapes, over
`culori/fn`. `charts/fill.ts#parseHex` and the editor's `colour-maths.ts`
retire, so there is one parser and one answer for every stored colour.
