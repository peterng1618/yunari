# Design rules

The theme is judged at its output size, on the target display. Every size below
is in artboard pixels. A browser preview keeps the artboard aspect with its long
edge capped at 1600 px, so a small artboard previews 1:1 and a large one is
downscaled; judge proportions and the real display geometry, not the CSS pixel
size.

## Hierarchy and focal reading

- One focal reading per composition: the number a glance should catch first.
  Make it at least 2.5× the size of the next reading.
- Choose readings as one coherent set, not a sample of every subsystem. "CPU
  load, GPU load, CPU temperature, GPU temperature" tells a story; one value
  each from CPU, GPU, storage and network reads as random. Pick the story the
  theme is about and leave the rest out.
- Order every other element by importance: focal value, supporting values,
  labels, decoration. If two elements compete for the glance, one is wrong.
- A panel is read in under a second from across a room. A desktop canvas may
  invite a longer look; a phone is closer but smaller.
- Do not centre every object. Choose one alignment spine (left, right or
  centred) and align the rest to it.

## Readings that make a theme specific

The hardware quartet — CPU load, GPU temperature, RAM and network — is the safe
default, and it is what every monitoring theme shows. When the brief names its
readings, use exactly those. When it names none, the machine can say more.

`list_sensors` is the reading manifest: every key, its family, value kind and
whether this host measures it, with a per-family summary and a `contextual`
flag. Read the summary before choosing.

- Prefer a reading that says what this machine is doing now over a fourth
  hardware number: now playing (`media.title`, `media.artist`, `media.state`),
  the running game (`game.name`, `game.running`, `fps.current`), the weather
  (`weather.condition`, `weather.temp`, `weather.high`), or the context the
  device sits in (`battery.level`, `wifi.ssid`, `audio.volume`).
- Keep one story: title, artist and playback state belong together; game name,
  FPS and frame time belong together; condition, temperature and daily high/low
  belong together. One contextual reading beside the focal value is enough.
- A text reading can be the focal element when it carries the subject — the
  track title on a music theme, the game's name on a game theme, the condition
  on a weather theme. It is not decoration.
- A contextual key this host does not measure is reported as missing, never
  replaced by a hardware key that happens to be measured. Say which family was
  unavailable.
- When a whole family is unavailable — no media on a music brief, no game on a
  game brief — recompose around what remains (time, weather, type) and state what
  was dropped. A now-playing brief does not become a sensor panel.
- A contextual group reads as one observation, not a card grid. It answers one
  question first — what is the weather, what is playing — and that answer is the
  group's focal element; the rest is one supporting tier. A compass or a single
  pale disc can hold the wind instead of a fourth equal card.
- Add a contextual reading only when it changes what the viewer knows; two or
  three readings are usually the whole answer. Compose from the keys this host
  measures, and when one element of the story is unavailable — an icon route, an
  artwork — drop it and recompose in type rather than showing a broken picture or
  an empty slot.
- Do not add a contextual reading to a brief that named its readings, and never
  pad a grid with one to prove the catalogue was read.

## Visual direction

Decoration-first is the default. A theme most often sits in someone's PC setup,
so compose the picture first and give the few readings that belong in it a
place.

An information-dense, monitoring-first dashboard is a different brief, allowed
only when the user asked for one or the brief reasonably implies one. It is
implied by a named monitoring purpose on a dedicated status display — an ops or
NOC wall, a rack or server readout, "show every sensor", "status at a glance" —
or by the user's own reference theme being a dense dashboard. One ambiguous
screenshot, or any brief that merely mentions a metric, does not imply it.
State the derivation in one line before composing ("dense monitoring: the
brief asks for every sensor at a glance") so the user can correct it.

The bundled starter theme is one reference among many, and not the most
visually appealing one. Do not inherit its heading, card grid, density or
layout by default; start from the named direction below and use the starter
only when the user asks for that style.

Choose one named direction before choosing a layout. "Dashboard" is one
direction, not the default:

- cinematic media showcase — video or still carries the frame; readings are captions;
- editorial poster — display type, rules, asymmetric columns, paper or print palette;
- retro terminal — mono grid, phosphor colour, instrument-like gauges;
- soft ambient — low contrast, generous space, one calm reading, muted palette;
- illustrated or playful — character/illustration-led, rounded, saturated;
- luxury minimal — one large object, extreme scale contrast, restrained palette;
- broadcast desk — oversized clock, on-air chrome, lower-third structure.

A composition of equal metric cards is a dashboard. Use it only in a dense
monitoring brief, and still vary focal element, layout topology and media
within it, not only colour.

When the user asks for several themes, each one must differ in at least three
of: driver mix, direction, media, display type family, layout topology, focal
element. Five palettes over one card grid is one theme, not five.

## Primary driver

Classify the brief before choosing a layout. The driver is the layer the theme
collapses without:

- **Information-driven** — the readings are the subject: a monitoring panel,
  rack or status wall. Layout, pairing and ledger rules lead.
- **Media-driven** — a picture or clip is the subject and type is its caption
  system. The default for decorative themes.
- **Type-driven** — the type is the image: a clock, a wordmark, a quote, a dial.
  Bound data is carried inside the typography.

The driver is a coherence check, not a template. Name the layer that leads at
this size, then let the others support it. A theme may carry two or three
drivers — media with type, media with information, or all three — when the
artboard has room for each in its own zone and no two demand the same focal
point. When they compete, one yields or the composition changes.

A media background does not make a theme media-driven: the bundled starter theme
is information-driven with a picture behind glass, and the readings still
organise the layout. Use the classification to check hierarchy, never to force
the same layout twice. The media-driven workflow applies to decorative themes.

## Reference vocabulary

These are the shapes small-screen themes take across a wide range of quality.
They are composition patterns, not identities, and not a quality bar: some of
the reference decks are primitive. Take the variety of layout, not their
craft. Never copy a game logo, character art or exact deck.

- art-led overlay — a character, car, landscape or illustration fills the
  screen; 3–5 readings sit along one edge in plain type, no cards;
- game HUD — a clipped or angled frame, one accent colour, large numerals and
  small caps labels; data in three to five horizontal strips;
- clock piece — one oversized time or date, nothing else, or a single caption;
- colour-block type — each metric is a flat block with a huge numeral and a
  tiny label; no container borders, no chart;
- instrument HUD — rings, arcs and tick marks carry the values; labels are
  sparse and sit on the instrument;
- editorial/terminal type — no containers at all, only rules, columns and
  type hierarchy (a dense terminal is a type choice, not a card grid);
- split poster — art on one half, data column on the other, one shared frame.

Across all of them: art or a single graphic object is the ground, data is the
caption, and the layout is one composition rather than a set of equal panels.

## Expressiveness

Use one deliberate expressive device per theme, for example:

- an oversized numeral or wordmark that breaks the grid;
- a full-bleed media frame with a small reading cluster;
- a vertical or edge-aligned heading;
- overlapping type and shape with a clear reading order;
- a silhouette, cut-out or masked subject;
- scale contrast between a huge focal value and tiny captions.

One device, used confidently. Three devices make noise. Expressiveness never
buys back lost legibility: every reading still passes the type-size and
contrast rules.

Do not title the theme by default. A theme name as a large heading is one
possible device, not page chrome: add it only when it does real compositional
work — a poster masthead, an on-air ident, a wordmark that anchors scale
contrast. A display someone leaves running does not need reminding which theme
it shows; drop the heading when its only job is naming the theme.

## Genre signatures

When the brief names an artefact, build that artefact. Palette and imagery are
half of it; the other half is the typographic element that makes the genre
recognisable.

- **Film poster:** a title block — an invented title or the user's own — with one
  tagline or credit line, set in display type and integrated with the art. A
  character still with a stats row is not a poster.
- **Album sleeve:** artist and title typography at one edge, one image, one rule;
  the image is the subject.
- **Terminal:** a monospaced grid, a prompt or status line, one phosphor accent;
  the type is the interface, not a font applied to cards.
- **Broadcast desk:** an on-air ident or lower third and an oversized clock.
- **Watch dial:** an index ring, chapter ring or signed plate, not only numerals
  floating on black.

The signature element is composition, not decoration: it must not cover the
subject and it stays below the focal reading in hierarchy. Use the theme's name
as the title only when the user named it and the name works; otherwise invent a
short title and say so. A title block is a poster's device, not page chrome
naming the theme.

- **A title comes from this frame.** Name something the media shows — its
  subject, setting or action. If the same title would fit any other clip, it is
  decoration, not a title; rewrite it. Do not invent a story the image
  contradicts.
- **Do not fabricate attribution.** No invented studio, byline, festival laurel
  or "a film by" line. The only credit that belongs is the media's real source
  credit, and it travels with the imported asset.

If the brief names the artefact as the deliverable ("an anime movie poster"),
the element is required. If it only lends a mood ("poster-like"), it is optional.

## Density by target display

| Target | Typical size | Readings | Notes |
|---|---|---|---|
| Phone / small browser | ≤ 420 × 900 | 3–4 | one column, large touch-sized type |
| Desktop browser | 1280 × 720 – 1920 × 1080 | 5–8 | two or three zones |
| Square panel (Kraken) | 320 × 320 | 1–3 | focal value plus a caption |
| Small panel (TURZX 5") | 800 × 480 | 3–6 | landscape, one focal number |
| Lian Li 9.2" strip | 1920 × 464 | 3–6 | landscape; one focal + columns |
| Lian Li 8.8" strip | 1920 × 480 | 4–6 | landscape; one focal + columns |
| Tall USB panel | 464/480 × 1920 | 4–6 | vertical stack, no wide rows |

Use `list_displays` geometry as the truth. When it is absent, the artboard the
user chose decides; a brief that names a panel by inches uses the row above.

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
- Declare one **card padding** (desktop 24–32 px, small panel 12–16 px) and one
  **sibling gap**. Every child inside a panel starts at least the padding in
  from every edge; every gap between sibling panels or groups is the same
  value. Use a gap equal to or larger than the padding.
- Measure the sequence, not the intent: edge → content, card → card, card →
  next group. Uneven values read as a mistake even when each pair looks fine
  in isolation.
- Text and focal values stay inside the safe margin. Only media may bleed.
- On a circular artboard, keep all content inside 70% of the radius; corners of
  a square layout are not visible.

## Typography

- Use a **type pairing**, not one family everywhere: a display face for the
  focal number, heading or clock; a text face for labels and captions. A third
  face only for one short accent.
- The display face carries personality: condensed, wide, high-contrast serif,
  geometric, monospace or a packaged face from the Asset Finder. Do not default
  to a neutral UI sans for everything.
- Allowed display treatments: vertical or edge-aligned heading, knocked-out
  type over media, a single script or italic accent, extreme size contrast,
  tabular numerals, a rule or underline that cuts the type.
- Readability is relative to size. A decorative, script or old-style face is
  fine as large display type and wrong as a small caption: judge the face at
  the size it is set, not by its style alone. A changing number uses tabular
  figures when it updates, but a clock piece may carry the time in a
  high-contrast display face if its numerals read at that size.
- A clock, date or changing numeral needs **lining figures**. Old-style faces
  such as Cormorant Garamond drop `1` toward an `I`; keep them for words, not
  time.
- A condensed display face can space digits apart at 30–40 px. Test the face at
  the size the value will set before choosing it for readings.
- Rotate or angle only display text, at most one element, and never the value
  a glance must read. Keep labels and readings on a normal baseline.
- Body text and captions stay in the readable text face. A decorative face must
  still meet the contrast rules and minimum size; if it does not, it is a
  graphic, not text.
- Packaged faces come from the Asset Finder: import the face and use the exact
  family the import reports. Never invent a family name.
- Entry typography is not a style: "tech startup" (one neutral sans, tracked
  kicker, gradient text) is one direction and must not be the default.

## Iconography

- Icons identify a reading or a group; they are not wallpaper. One icon per
  metric group, aligned to its label or focal value.
- Use one icon family per theme (Lucide, Lineicons or Font Awesome from the
  finder, or the shared starter glyphs). Never mix filled and outline sets.
- Keep a single size step and a single ink token. Do not tint each icon
  differently unless the colours carry meaning.
- Pair every icon with visible text; the icon alone is not the label.
- An icon smaller than 16 px is decoration, not information. Remove it or make
  it readable.
- Good uses: processor/storage/network/thermals group markers, a play or media
  glyph in a media theme, weather or status marks, a small brand-esque mark
  built from the theme's own shapes.
- A weather or status group can carry a **typographic mark** instead of a
  picture — a wind compass, a humidity figure, a day-range pair. When no
  reliable icon is available, set the reading as the mark; never borrow a
  different condition's glyph.

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

- Text or readings over an image or video need a scrim: a gradient or blurred
  band that reaches 35–60% at its darkest. Judge contrast against the brightest
  frame, not a still.
- Dim the **text region** with a gradient that runs to at least one frame edge —
  a bottom fade beneath a lower caption, a left fade behind a left column — so
  no boundary is visible. A free-floating rectangle of overlay reads as a box; a
  full-frame sheet turns a media theme back into a dashboard with a picture
  behind it.
- Anchor the gradient at the edge it serves and fade toward the subject. Inspect
  the boundary at real size; if the fade's end line shows, extend the gradient
  past the frame edge or soften the falloff.
- Check the preview frame the reader actually sees. If the face, eyes or focal
  object is under the text, move it — that is the hard no. A display wordmark
  over the body may stay; supporting text moves to the quiet area. If neither is
  possible, pan or crop the media, or choose another clip.
- Place small type over low-frequency areas — sky, wall, water, shadow — never
  over foliage, crowds or detailed architecture. A large value or wordmark may
  sit over a busier area when contrast is built, not left to thin type over detail.
- A video background needs a declared fallback frame or colour that still
  passes contrast before the first frame plays.
- Never place small body text directly on busy media.
- **Glass is a legibility tool, not a category.** It works in any driver wherever
  text or data needs contrast over busy media. Use one surface system — the same
  blur, fill opacity and radius — in as few, as large panels as the layout needs,
  and check it against the brightest frame. A different glass per card reads as
  noise; in a media-driven theme one glass panel can hold the data without
  carding the picture.
- Media that carries the mood may bleed; media that carries data must stay
  behind a surface.

## Design workflows

The primary driver selects the starting workflow. These are coherence checks,
not required layouts: a theme may combine drivers when the artboard has space,
so start from the workflow of the layer that leads and borrow the step that keeps
the others honest. Vary the mix across a set; two themes with the same driver and
the same form are one design with a palette swap.

### Media-driven

For a decoration-first, media-centric theme:

1. **Name the feeling first.** One sentence: what should the screen feel like —
   quiet rain at night, sunlit adventure, a cold machine room. The feeling
   decides palette, media and type.
2. **Find media that carries that feeling.** Search by the mood, then look at
   the still and the crop on the real artboard. Reject a clip that does not look
   like the feeling, even when its tags match.
3. **Let the media anchor everything else.** The chosen media drives the rest:
   take the palette from its colours and its light, pick faces that match its
   era, genre and tone, and let decorative shapes echo its forms. Do not bring a
   palette, type system or decoration that fights the picture.
4. **Compose around the face and focal point.** Read several frames of the
   media and find the face or focal object, the body and the quiet area. Never
   cover the face or focal object. A display-scale wordmark may cross the body
   by design, and a data cluster may sit on a busier area when contrast is built
   (larger type, a glass or scrim panel, a contrasting colour). Supporting text
   goes in the quiet area; leaving that area unused while covering the face is
   the failure. Name the face and the quiet area before composing, and check the
   face after each preview.

### Information-driven

For a monitoring display, a status wall or any brief whose readings are the
subject:

1. **Name the decision the screen supports.** What is the person acting on —
   load, temperature, capacity, throughput, a fault? The decision picks the
   focal reading, not the sensor list.
2. **Choose the instrument form.** A ledger, a column set, a gauge, a trend
   line, a status row. The form follows the decision: a rate needs a trend, a
   threshold needs a gauge or a state word, a comparison needs aligned columns.
   A card is a container, not a form.
3. **Set the reading hierarchy and order.** One focal value, one supporting tier
   sharing a scale and a baseline, each label paired with its value. Remove every
   reading the decision does not use; never pad to fill.
4. **Compose and verify at distance.** Fill the frame's height; rules separate
   regions instead of containers. Glass where a region needs contrast over media.
   Check every value at the stated distance, against the brightest frame.

### Type-driven

For a clock, a wordmark, a quote, a dial — the type is the image:

1. **Name the typographic idea and its one reading.** A clock, a wordmark, a
   quote, a dial, and the single value it carries: time, date, track, a phrase.
   The type is the subject; there is no second subject.
2. **Choose the face for the job.** Display at the size the value needs, with
   the right figure style — lining figures for a clock, a face that holds at the
   smallest value size — and one expressive device (a rule, a ring, a mark) that
   belongs to the idea.
3. **Compose type as image.** Extreme scale contrast, one alignment spine, and
   negative space treated as part of the composition. Every ornament is either
   that one device or removed.
4. **Verify the real value at real size.** Preview the live binding at the target
   geometry (a circle's safe area included), confirm the face renders figures and
   unit correctly, and check that nothing competes with the type.

## Media showcase

A media-showcase theme is a valid brief, not a failure to show enough data.

- Prefer a video from the host's Wallpaper Engine library when motion suits the
  brief. Search that source first, preview the still, and import the clip; the
  host normalises it and derives the panel still.
- **A still proves nothing about the crop.** A video row's still can be square
  while the clip is wide, and a source whose aspect is close to the artboard can
  still sit its subject outside the strip. Place the media on the real artboard
  and look before building around it; re-importing after the composition exists
  costs the layout. A strip wants a subject that survives one half of the frame.
- **Read the media before placing anything.** On the real artboard, find the
  face or focal point, the subject's body and the quiet area — across several
  frames of a clip, not only the first still. The face, eyes and focal object are
  never covered. Supporting text, small labels and a data cluster go in the quiet
  area first; that is what the empty region is for.
- **A display-scale wordmark may cross the body.** A poster title over a
  shoulder or torso is integration, not a mistake, provided the face and focal
  object stay clear and the type sits deliberately rather than colliding with a
  gesture or the hero object.
- **Data may sit on a busier area when legibility is built.** Use a larger
  value, a glass or scrim panel, a contrasting colour, or one strong tier, and
  judge it at real size against the busiest frame — not a thin label over detail.
- Leave at least 35–50% of the frame unobstructed. The media is the subject;
  the interface is a caption system.
- Let the media be full-bleed. A character, car, landscape or illustration is
  the ground; data is a thin overlay on it, not a card laid over it.
- Use 3–5 readings at most, set large. One focal reading, two or three
  supporting values, labels as small caps or captions.
- Keep one cluster, not four corners. Anchor it to a quiet region and let the
  rest of the frame breathe.
- A full-frame card grid over video is a data theme with a video behind it;
  choose the media direction and commit to it.
- Icons earn their place here: a play/pause mark, a media or device glyph, a
  small status cluster.

## Data-centric versus media-centric

- **Data-centric:** media occupies at most 25% of the visual area, usually as a
  background; readings and labels lead.
- **Media-centric:** at most 3–5 readings, set large, over the media with a
  scrim. Labels shrink to captions; decoration stays out.
- State the balance to the user. Do not drift between the two in one theme.

## Dense monitoring, when the brief asks for it

Information-first is an exception to decoration-first, never to composition.

- Compose the whole panel the brief asked for. One focal reading, then one or
  two aligned zones for the rest; rules, spacing and type replace cards. An
  empty third of the frame is not calm, it is missing composition.
- Use the readings the brief named. Do not add an unrequested reading to balance
  a grid; remove a reading rather than pad one.
- On a wide strip, divide the width: one focal zone plus two or three columns
  sharing one baseline, not two rows floating in the top half.
- Keep the monitoring display's reading hierarchy: the focal value at least
  2.5× the supporting values, labels at the distance minimum.
- Pair each label with its value: at most one column gap between them, and the
  value column ends on a margin inside the frame, never against its edge. A
  value at the edge reads as detached from its label.
- One row is one reading story. A sub-label such as `DOWN` sits beside its value
  or under its parent (`NETWORK`), not in a third column of its own. Rules
  separate rows; they do not replace the pairing.
- Fill the frame's height: share it across rows or let one focal column span it.
  A wide quiet band under four thin rows reads as an unfinished panel.

## Hierarchy when the artwork is the subject

Hierarchy is relative to the subject. When the brief makes the artwork or
character the focal element and asks for small stats, the art is the top of the
hierarchy; the readings may form one quiet tier. The 2.5× focal-number rule
applies to the readings, not to the art.

## Light and dark

- A theme is authored for one mode. Pick it from the user's answer, not from a
  default.
- In dark mode, avoid pure `#000` for large surfaces and pure `#fff` for body
  text; keep the palette's contrast ratios.
- In light mode, avoid a pure white media scrim over a bright image; use a
  tinted surface instead.

## Legibility checks

Run these against the preview, at the display's real size:

1. **Squint test.** Blur your view: the focal value must still lead; labels may
   vanish but must not compete. If two elements tie, one is wrong.
2. **Distance test.** Step back to the stated viewing distance. Any label that
   cannot be read is removed, not shrunk below its minimum.
3. **Brightest-frame test.** For media, find the brightest or busiest frame.
   Text contrast is judged there, not on the first still.
4. **Squash test.** Shrink the preview to phone width. If the reading order
   collapses or text overlaps, the layout depends on one size only.
5. **Removal test.** Cover each element. If removing it changes nothing the
   reader needs, remove it.

## Assets

- Prefer the Asset Finder. Every finder import keeps the source's own name,
  licence and URL in the credit.
- Search actively for media, icons and fonts before composing. A theme built
  without looking at the finder is a theme that ignored its resources.
- Wallpaper Engine rows are local video wallpapers. Import the clip through the
  finder so the host normalises it; never point a theme at a Steam file path.
- Packaged fonts are imported from the finder like any other asset. Set the
  role's family, weight and the import's `assetId` as its `face`; the family
  alone does not load the file.
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
