# Questionnaire

Ask one question per gap. When several gaps share one format decision, ask them
as one message; never re-ask what the brief or a tool answer already fixes.
When no one can answer — an unattended run — derive every gap from the brief,
the host and these rules, state each assumption in the report, and proceed.

## 1. Target display and viewing distance

Ask: "Which display is this theme for, and roughly how far away will someone
stand or sit?"

- Derive it when the user named a display id or a device already in
  `list_displays`: use its `kind`, `shape`, rotation and panel geometry.
- Derive the distance when it is obvious from the device: a handheld or desk
  monitor is close; a wall panel, a shelf panel or a TV is far. Type size and
  reading count depend on it.

## 2. Data priorities

Ask: "Which readings matter most, and is there one number that should dominate?"

- Derive candidates from `list_sensors`. Read its `families` summary first: it
  names every family this host catalogs and marks the contextual ones — now
  playing, the running game, weather, battery, Wi-Fi, system.
- When the brief names no readings, propose one contextual reading as well as
  the hardware set, and say which of them this host measures.
- Ask which one is the focal reading. Do not silently pick one.

## 3. Data versus media balance

Ask: "Should this be mostly data, mostly imagery, or an even split?"

- Derive a default from the brief: a monitoring ask is data-centric, a
  wallpaper-led ask is media-centric.
- A media showcase is a full answer: 3–5 readings over a video or still, not a
  data grid with a picture behind it. Do not treat it as a lesser brief.
- When the balance is media-led, ask whether a moving backdrop is wanted; the
  host's Wallpaper Engine library is the first source to search.
- State the chosen balance before composing.

## 4. Style and mood

Ask: "Describe the look in a few words — for example cinematic, editorial,
retro, soft, playful, minimal, or matching a reference."

- Derive it when the user attached a reference image or named a style.
- Ask before inventing a style; the answer changes direction, palette, type and
  layout topology, not only colour.
- Ask for a font lean only when the brief is silent: "Any type personality —
  condensed, serif, script, geometric, mono?" A display face is part of the
  direction, not a detail to pick after the layout.

## 5. Light or dark

Ask: "Light theme, dark theme, or should it follow the room?"

- Derive dark for a panel in a dim room, light for a bright desk, only when the
  user stated the environment.
- Yunari persists one mode per theme; do not promise automatic switching.

## 6. Palette

Ask: "Any brand colours or colours you like, or should I propose one from the
mood?"

- Derive accent colours from a reference image the user supplied, then propose
  the rest.
- Ask before adopting a colour from a logo or trademark: sample the palette,
  not the identity.

## 7. Language and units

Ask: "Which language, and which units — metric, imperial, or the system
default?"

- Derive the host's language when `yunari_status` or the host settings expose
  it; ask when it is ambiguous.
- Units are a display concern. Record the user's choice in the theme metadata
  or the affected labels rather than changing sensor bindings.

## 8. Name and author

Ask: "What should the theme be called, and whose name should it carry?"

- Derive neither. The name is the user's; an author name is a person, not a
  guess. An omitted author stays omitted.

## 9. Consent to open an existing theme

Ask, naming the theme: "Open **<name>** for editing? This replaces its draft in
this session and saves back over the existing theme."

- Never derive this consent. It is required before `open_theme` and before
  saving over a stored theme through `save_theme`.

## One message shape

```
Before I compose, four things:
1. Display and distance: …
2. Focal reading: …
3. Mood and palette: …
4. Light or dark: …
```

Ask only the gaps. A brief that already answers one gets no question for it.
