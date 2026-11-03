# Design rules

Judge the theme at its output size on the target display. Sizes are artboard
pixels. A browser preview keeps the artboard aspect with its long edge capped at
1600 px, so a small artboard previews 1:1 and a large one is downscaled; judge
proportions and the real display geometry, not the CSS pixel size.

## Hierarchy and focal reading

- One focal reading: the number a glance catches first, at least 2.5× the next
  reading. On a dense strip with four or more readings, 2.5× can push the second
  tier below its minimum; a value at least 1.8× the next, with a distinct colour
  or weight, still leads. The exception is artwork-as-subject, where the art
  leads and the rule applies among the readings.
- Order every element: focal value, supporting values, labels, decoration. Two
  elements competing for the glance means one is wrong.
- Choose readings as one story, not a sample of every subsystem. Loads with their
  temperatures tell a story; one value each from CPU, GPU, storage and network
  reads as random.
- A panel is read in under a second across a room; a desktop canvas may invite a
  longer look; a phone is closer but smaller.
- Do not centre every object. Choose one alignment spine — left, right or
  centred — and align the rest to it.

## Readings that make a theme specific

The hardware quartet — CPU load, GPU temperature, RAM and network — is the safe
default every monitoring theme shows. When the brief names readings, use exactly
those. When it names none, the machine can say more.

`list_sensors` is the reading manifest: every key, family, value kind and whether
this host measures it, plus a per-family summary with a `contextual` flag.

- Prefer what this machine is doing now over a fourth hardware number: now
  playing (`media.*`), the running game (`game.*`, `fps.current`), the weather
  (`weather.*`), or the device's context (`battery.level`, `wifi.ssid`,
  `audio.volume`).
- Keep one story: title, artist and playback state; game, FPS and frame time;
  condition, temperature and daily high/low. One contextual reading beside the
  focal value is enough.
- A text reading can be the focal element when it carries the subject — track
  title, game name, weather condition. It is not decoration.
- A contextual key this host does not measure is reported as missing, never
  replaced by a measured hardware key. Say which family was unavailable.
- When a whole family is unavailable — no media on a music brief, no game on a
  game brief — recompose around what remains (time, weather, type) and state what
  was dropped. A now-playing brief does not become a sensor panel.
- A contextual group reads as one observation, not a card grid: it answers one
  question first — what is the weather, what is playing — and that answer is the
  focal element; the rest is one supporting tier. A compass or a single pale disc
  can hold the wind instead of a fourth equal card.
- Add a contextual reading only when it changes what the viewer knows; two or
  three are usually the whole answer. If an element is unavailable — an icon
  route, artwork — drop it and recompose in type rather than showing a broken
  picture or an empty slot.
- Never add a contextual reading to a brief that named its readings, or pad a
  grid with one to prove the catalogue was read.

## Visual direction

Decoration-first is the default: a theme usually sits in someone's PC setup, so
compose the picture first and give the readings that belong in it a place.

An information-dense, monitoring-first dashboard is a different brief, allowed
only when the user asked for one or the brief reasonably implies one — a named
monitoring purpose on a dedicated status display (ops or NOC wall, rack readout,
"show every sensor", "status at a glance"), or the user's own reference being a
dense dashboard. One ambiguous screenshot, or any brief that merely mentions a
metric, does not imply it. State the derivation in one line before composing so
the user can correct it.

The bundled starter theme is one reference among many, not the most appealing
one. Do not inherit its heading, card grid, density or layout by default.

Choose one named direction before choosing a layout. "Dashboard" is one
direction, not the default. Patterns, roughly by increasing density:

- **art-led overlay / cinematic showcase** — a character, car, landscape or
  illustration fills the frame; a small reading cluster along one edge, no cards;
- **album sleeve / split poster** — art on one half or across the frame, artist
  and title type at one edge, one rule;
- **editorial poster** — display type, rules, asymmetric columns, paper palette;
- **broadcast desk / game HUD** — oversized clock or numerals, one accent,
  on-air chrome, clipped or angled frame, data in three to five strips;
- **retro terminal / instrument HUD** — mono grid, phosphor colour, rings, arcs
  and ticks carrying values, sparse labels on the instrument;
- **soft ambient / luxury minimal** — low contrast, generous space, one calm
  reading; or one large object and extreme scale contrast;
- **illustrated or playful** — character-led, rounded, saturated.

Across all of them: art or one graphic object is the ground, data is the caption,
and the layout is one composition rather than equal panels. These are patterns,
not identities or a quality bar: take the variety of layout, never copy a game
logo, character art or exact deck.

Equal metric cards are a dashboard. Use them only in a dense monitoring brief,
and still vary focal element, topology and media, not only colour. When the user
asks for several themes, each must differ in at least three of: driver mix,
direction, media, display type family, layout topology, focal element. Five
palettes over one card grid is one theme.

## Primary driver

Classify before choosing a layout. The driver is the layer the theme collapses
without:

- **Information-driven** — the readings are the subject: monitoring panel, rack
  or status wall. Layout, pairing and ledger rules lead.
- **Media-driven** — a picture or clip is the subject and type is its caption
  system. The default for decorative themes.
- **Type-driven** — the type is the image: clock, wordmark, quote, dial. Bound
  data is carried inside the typography.

The driver is a coherence check, not a template. Name the layer that leads at
this size, then let the others support it. Two or three drivers may combine —
media with type, media with information, all three — when each has its own zone
and no two demand the same focal point. When they compete, one yields or the
composition changes.

A media background does not make a theme media-driven: the starter theme is
information-driven with a picture behind glass, and the readings still organise
the layout. The media-driven workflow applies to decorative themes.

## Expressiveness

Use one deliberate device: an oversized numeral or wordmark breaking the grid; a
full-bleed media frame with a small reading cluster; a vertical or edge-aligned
heading; overlapping type and shape with clear reading order; a silhouette or
masked subject; extreme scale contrast. One device used confidently — three make
noise — and expressiveness never buys back lost legibility.

Do not title the theme by default. A theme name in display type belongs only
when the heading is the composition's device — a poster masthead, an on-air
ident, a wordmark that anchors scale contrast — not page chrome. A display
someone leaves running does not need reminding which theme it shows.

## Genre signatures

When the brief names an artefact, build that artefact. Palette and imagery are
half; the other half is the typographic element that makes the genre
recognisable.

- **Film poster:** a title block — an invented title or the user's own — with one
  tagline or credit line, in display type, integrated with the art. A character
  still with a stats row is not a poster.
- **Album sleeve:** artist and title type at one edge, one image, one rule.
- **Terminal:** a monospaced grid, a prompt or status line, one phosphor accent;
  the type is the interface, not a font applied to cards.
- **Broadcast desk:** an on-air ident or lower third and an oversized clock.
- **Watch dial:** an index ring, chapter ring or signed plate, not numerals
  floating on black.

The signature element is composition, not decoration: it must not cover the
subject and stays below the focal reading. Use the theme's name as the title only
when the user named it and it works; otherwise invent a short title and say so.

- **A title comes from this frame.** Name its subject, setting or action. If the
  title would fit any other clip it is decoration; rewrite it. Do not invent a
  story the image contradicts.
- **Do not fabricate attribution.** No invented studio, byline, festival laurel
  or "a film by" line. Only the media's real source credit belongs, and it
  travels with the imported asset.

If the brief names the artefact as the deliverable ("an anime movie poster"), the
element is required. If it only lends a mood ("poster-like"), it is optional.

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

- One safe margin: 5% of the artboard's short edge, never below 12 px. Text and
  focal values stay inside it; only media may bleed.
- One spacing grid, 4 px or 8 px, for every gap, padding and offset. Do not mix
  an 8 px grid with hand-placed odd offsets.
- Declare one **card padding** (desktop 24–32 px, small panel 12–16 px) and one
  **sibling gap** equal to or larger. Every child starts at least the padding in
  from every edge; every gap between siblings is the same value.
- Measure the sequence, not the intent: edge → content, card → card, card → next
  group. Uneven values read as a mistake even when each pair looks fine alone.
- On a circular artboard, keep content inside 70% of the radius.

## Typography

- Use a **type pairing**: a display face for the focal number, heading or clock;
  a text face for labels and captions. A third face only for one short accent.
- The display face carries personality — condensed, wide, high-contrast serif,
  geometric, monospace, or a packaged face from the finder. Do not default to a
  neutral UI sans for everything.
- Allowed display treatments: vertical or edge-aligned heading, knocked-out type
  over media, a script or italic accent, extreme size contrast, tabular numerals,
  a rule that cuts the type.
- Readability is relative to size. A decorative, script or old-style face is fine
  as large display type and wrong as a small caption: judge it at the size it is
  set. A changing number uses tabular figures.
- A clock, date or changing numeral needs **lining figures**. Old-style faces
  such as Cormorant Garamond drop `1` toward `I`; keep them for words.
- A condensed face can space digits apart at 30–40 px, and a mono face can do the
  same with a degree glyph at 64 px. Test the face at the value's size; put the
  unit in its own run one step down.
- Rotate or angle only display text, at most one element, and never a value a
  glance must read. Labels and readings stay on a normal baseline.
- Body text and captions stay in the readable text face. A decorative face must
  still meet contrast and minimum size; if it does not, it is a graphic, not
  text.
- Packaged faces come from the finder: import the face and use the exact family
  the import reports. Never invent a family name.
- Entry typography is not a style: "tech startup" (neutral sans, tracked kicker,
  gradient text) is one direction, not the default.

## Iconography

- Icons identify a reading or group, not wallpaper: one per metric group,
  aligned to its label or focal value, always paired with visible text.
- Use one icon family per theme (Lucide, Lineicons or Font Awesome from the
  finder, or the shared starter glyphs). Never mix filled and outline sets.
- Keep a single size step and ink token. Do not tint each icon unless the colours
  carry meaning.
- An icon smaller than 16 px is decoration. Remove it or make it readable.
- Good uses: processor/storage/network/thermals markers, a play or media glyph,
  weather or status marks, a mark built from the theme's own shapes.
- A weather or status group can carry a **typographic mark** instead of a
  picture — a wind compass, humidity figure, day-range pair. When no reliable
  icon is available, set the reading as the mark; never borrow another
  condition's glyph.

## Palette and contrast

- Keep 5–6 roles: background, surface, primary text, secondary text, one or two
  accents. A seventh colour needs a job.
- Body text contrast against its actual backdrop is at least **4.5:1**; large
  text (24 px+ or 19 px+ bold) at least **3:1**. Accent colour is not body text
  by default.
- Check contrast against the darkest or lightest part of a media background, not
  the average. If it fails there, add a scrim.
- Use one accent for the focal value and emphasis; a second accent is a second
  meaning, not decoration.
- Status colours (hot, warning, good) must stay distinguishable with red-green
  colour blindness: pair colour with a label or shape.

## Radius, stroke and spacing consistency

- Choose one radius family, for example 0 / 8 / 16 px, and use only those steps.
  Do not mix a 4 px and a 12 px radius on sibling cards.
- Strokes are 1–2 px at artboard size. A heavier stroke is a deliberate accent.
- Card padding follows the grid on all four sides. A card is not a frame for a
  differently padded inner box. Shadows come from one direction and one blur.

## Media

A media-showcase theme is a valid brief, not a failure to show enough data. The
media is the subject; the interface is a caption system.

- **Read the media before placing anything.** Across several frames of a clip, on
  the real artboard, find the face or focal point, the body and the quiet area.
  Never cover the face, eyes or focal object — the hard no.
- **A still proves nothing about the crop.** A row's still can be square while the
  clip is wide, and a close aspect can still sit its subject outside the strip.
  Place the media and look before composing; a strip wants a subject that
  survives one half of the frame.
- **A display-scale wordmark may cross the body.** A poster title over a shoulder
  is integration if the face stays clear and the type sits deliberately rather
  than colliding with a gesture or the hero object.
- **Build legibility where data meets a busy area**: a larger value, glass or
  scrim panel, contrasting colour, one strong tier. Judge at real size against
  the busiest frame. Small type goes in the quiet area over low-frequency ground
  — sky, wall, water, shadow — never foliage, crowds or detailed architecture.
  Leaving the quiet area unused while covering the face is the failure.
- Let the media be full-bleed: a character, car, landscape or illustration is the
  ground, with a thin overlay, not a card laid over it. Leave at least 35–50% of
  the frame unobstructed, use 3–5 readings, and keep one cluster rather than four
  corners. A full-frame card grid over video is a data theme with a video behind
  it.
- Text over media needs a scrim: a gradient or blurred band reaching 35–60% at
  its darkest. Dim the **text region** with a gradient running to at least one
  frame edge — a bottom fade under a caption, a left fade behind a column — so no
  boundary shows. Anchor at the edge it serves, fade toward the subject; a
  free-floating rectangle reads as a box and a full-frame sheet turns the theme
  back into a dashboard. If the fade's end line shows at real size, extend it
  past the frame edge or soften the falloff.
- Judge contrast against the brightest or busiest frame, not a still. A video
  needs a declared fallback frame or colour that passes contrast before the first
  frame.
- **Glass is a legibility tool, not a category.** It works in any driver wherever
  text needs contrast over busy media. Use one surface system — same blur, fill
  opacity and radius — in as few, as large panels as needed, checked against the
  brightest frame. A different glass per card reads as noise; in a media-driven
  theme one glass panel can hold the data without carding the picture.
- Media that carries the mood may bleed; media that carries data stays behind a
  surface.

State the balance and do not drift between modes:

- **Data-centric:** media occupies at most 25% of the visual area, usually as a
  background; readings and labels lead.
- **Media-centric:** 3–5 readings at most, set large over the media with a
  scrim; labels shrink to captions, decoration stays out.

When the artwork is the focal element and the brief asks for small stats, the art
is the top of the hierarchy; the readings form one quiet tier. The 2.5× rule
applies among the readings, not to the art.

## Design workflows

The primary driver selects the starting workflow. These are coherence checks,
not layouts: start from the layer that leads and borrow the step that keeps the
others honest. Vary the mix across a set; two themes with the same driver and
form are one design with a palette swap.

### Media-driven

For a decoration-first, media-centric theme:

1. **Name the feeling first.** One sentence — quiet rain at night, sunlit
   adventure, a cold machine room. It decides palette, media and type.
2. **Find media that carries it.** Search by mood, then look at the still and
   crop on the real artboard. Reject a clip that does not look like the feeling,
   even when its tags match.
3. **Let the media anchor everything else.** Palette from its colours and light,
   faces matching its era, genre and tone, decorative shapes echoing its forms.
   Do not bring a palette, type system or decoration that fights the picture.
4. **Compose around the face and focal point**, following the media rules above.

### Information-driven

For a monitoring display, status wall or any brief whose readings are the
subject:

1. **Name the decision the screen supports.** What is the person acting on —
   load, temperature, capacity, throughput, a fault? The decision picks the focal
   reading, not the sensor list.
2. **Choose the instrument form.** Ledger, column set, gauge, trend line, status
   row. A rate needs a trend, a threshold a gauge or state word, a comparison
   aligned columns. A card is a container, not a form.
3. **Set the hierarchy and order.** One focal value, one supporting tier sharing
   a scale and baseline, each label paired with its value: at most one column
   gap, and the value column ends on a margin inside the frame, never against
   its edge. One row is one reading story; a sub-label such as `DOWN` sits beside
   its value or under its parent (`NETWORK`), not in a third column. Remove every
   reading the decision does not use; never pad.
4. **Compose and verify at distance.** Fill the frame's height: share it across
   rows or let a focal column span it. Rules separate regions and rows instead of
   containers. On a wide strip, divide the width into one focal zone plus two or
   three columns on one baseline, not two rows floating in the top half. Glass
   where a region needs contrast over media. Check every value at the stated
   distance against the brightest frame. An empty third of the frame is not calm,
   it is missing composition.

### Type-driven

For a clock, wordmark, quote or dial — the type is the image:

1. **Name the typographic idea and its one reading.** Clock, wordmark, quote or
   dial, and the single value it carries: time, date, track, a phrase. There is
   no second subject.
2. **Choose the face for the job.** Display at the value's size, the right figure
   style — lining figures for a clock, a face that holds at the smallest value
   size — and one expressive device (rule, ring, mark) that belongs to the idea.
3. **Compose type as image.** Extreme scale contrast, one alignment spine, and
   negative space as part of the composition. Every ornament is that device or
   removed.
4. **Verify the real value at real size.** Preview the live binding at the target
   geometry (a circle's safe area included), confirm figures and unit render
   correctly, and check that nothing competes with the type. On a ring or chapter
   ring, check the indices against the longest text line — they share a radius.

## Light and dark

- A theme is authored for one mode, from the user's answer, not a default.
- In dark mode, avoid pure `#000` for large surfaces and pure `#fff` for body
  text; keep the contrast ratios.
- In light mode, avoid a pure white media scrim over a bright image; use a tinted
  surface.

## Legibility checks

Run these against the preview at the display's real size:

1. **Squint test.** Blur your view: the focal value must still lead; labels may
   vanish but must not compete. If two elements tie, one is wrong.
2. **Distance test.** At the stated viewing distance, an unreadable label is
   removed, not shrunk below its minimum.
3. **Brightest-frame test.** For media, judge text contrast on the brightest or
   busiest frame, not the first still.
4. **Squash test.** At phone width, reading order must not collapse and text must
   not overlap.
5. **Removal test.** Cover each element; if removing it changes nothing the
   reader needs, remove it.

## Data honesty

- Every bound reading names a semantic key the host reports as measured. A key
  the host does not answer stays unbound.
- A missing reading is absent, with its stated reason. Never write zero, a dash,
  a placeholder number or a default gauge.
- A decorative value that looks like telemetry must be labelled as decoration or
  replaced; otherwise it is fabricated data.
