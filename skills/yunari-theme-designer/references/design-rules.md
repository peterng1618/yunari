# Design rules

The theme is judged at its output size, on the target display. Every size below
is in artboard pixels: a 1:1 preview maps one artboard pixel to one CSS pixel.

## Hierarchy and focal reading

- One focal reading per composition: the number a glance should catch first.
  Make it at least 2.5× the size of the next reading.
- Order every other element by importance: focal value, supporting values,
  labels, decoration. If two elements compete for the glance, one is wrong.
- A panel is read in under a second from across a room. A desktop canvas may
  invite a longer look; a phone is closer but smaller.
- Do not centre every object. Choose one alignment spine (left, right or
  centred) and align the rest to it.

## Density by target display

| Target | Typical size | Readings | Notes |
|---|---|---|---|
| Phone / small browser | ≤ 420 × 900 | 3–4 | one column, large touch-sized type |
| Desktop browser | 1280 × 720 – 1920 × 1080 | 5–8 | two or three zones |
| Square panel (Kraken) | 320 × 320 | 1–3 | focal value plus a caption |
| Small panel (TURZX 5") | 800 × 480 | 3–6 | landscape, one focal number |
| Tall USB panel | 464/480 × 1920 | 4–6 | vertical stack, no wide rows |
| 8.8" / 9.2" panel | 1920 × 480 | 4–6 | horizontal strip, one row of cards |

Use `list_displays` geometry as the truth. When it is absent, the artboard the
user chose decides.

## Minimum type size by viewing distance

| Viewing distance | Body / labels | Secondary captions | Focal value |
|---|---|---|---|
| Under 0.5 m (phone, handheld) | 14 px | 11 px | 48 px+ |
| 0.5–1 m (desk monitor, small panel) | 16 px | 12 px | 64 px+ |
| 1–2 m (wall or shelf panel) | 24 px | 16 px | 96 px+ |
| Over 2 m (TV, far panel) | 36 px | 24 px | 140 px+ |

Never go below 11 px, even for a unit suffix. If a reading does not fit at its
minimum, remove a reading — do not shrink the type.

## Margins and grid

- One safe margin for the whole composition: 5% of the artboard's short edge,
  never below 12 px.
- One spacing grid, 4 px or 8 px, applied to every gap, padding and offset.
  Do not mix an 8 px grid with hand-placed odd offsets.
- Keep text and focal values inside the safe margin. Background media may bleed
  to the edge.
- On a circular artboard, keep all content inside 70% of the radius; corners of
  a square layout are not visible.

## Palette and contrast

- Keep the palette to 5–6 roles: background, surface, primary text, secondary
  text, one or two accents. A seventh colour needs a job.
- Body text contrast against its actual backdrop is at least **4.5:1**; large
  text (24 px+ or 19 px+ bold) is at least **3:1**. Accent colour is not body
  text by default.
- Check contrast against the darkest or lightest part of a media background,
  not the average. If it fails there, add a scrim.
- Use one accent for the focal value and interactive emphasis; a second accent
  is for a second meaning, not decoration.
- Semantic status colours (hot, warning, good) must remain distinguishable to
  someone with red-green colour blindness: pair colour with a label or shape.

## Radius, stroke and spacing consistency

- Choose one radius family, for example 0 / 8 / 16 px, and use only those
  steps. Do not mix a 4 px and a 12 px radius on sibling cards.
- Strokes are 1–2 px at artboard size. A heavier stroke is a deliberate accent.
- Card padding follows the spacing grid on all four sides. A card is not a
  frame for a differently padded inner box.
- Shadows, when used, come from one direction and one blur step.

## Media: scrim and fallback

- Text or readings over an image or video need a scrim: a 35–60% dark or light
  overlay, a gradient, or a blurred band. Judge contrast against the brightest
  frame, not a still.
- A video background needs a declared fallback frame or colour that still
  passes contrast before the first frame plays.
- Never place small body text directly on busy media.
- Media that carries the mood may bleed; media that carries data must stay
  behind a surface.

## Data-centric versus media-centric

- **Data-centric:** media occupies at most 25% of the visual area, usually as a
  background; readings and labels lead.
- **Media-centric:** at most 3–5 readings, set large, over the media with a
  scrim. Labels shrink to captions; decoration stays out.
- State the balance to the user. Do not drift between the two in one theme.

## Light and dark

- A theme is authored for one mode. Pick it from the user's answer, not from a
  default.
- In dark mode, avoid pure `#000` for large surfaces and pure `#fff` for body
  text; keep the palette's contrast ratios.
- In light mode, avoid a pure white media scrim over a bright image; use a
  tinted surface instead.

## Assets

- Prefer the Asset Finder. Every finder import keeps the source's own name,
  licence and URL in the credit.
- A local file is imported only when the user named it, and its licence is the
  one the user stated. Never invent a licence or an author.
- Do not copy a logo, wordmark, mascot or recognisable trademark from a
  reference image, even when the user supplied it. Reproduce composition,
  palette and mood only.

## Data honesty

- Every bound reading names a semantic key the host reports as measured. A key
  the host does not answer stays unbound.
- A missing reading is absent, with its stated reason. Never write zero, a
  dash, a placeholder number or a default gauge for it.
- A decorative value that looks like telemetry must be labelled as decoration
  or replaced; otherwise it is fabricated data.
