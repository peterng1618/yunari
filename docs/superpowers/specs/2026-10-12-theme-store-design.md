# A theme store for Yunari

- **Status:** revised 2026-10-21 — **phase A has landed** (`2026-10-18-theme-store.md`, closed 2026-10-20); **the pre-planning probes are answered**, and two open questions (3, freshness, and 8, the facet's buckets and tolerance) are settled by measurement rather than left as drafts — see § "Measured 2026-10-21" and § "Open questions"; **ACCEPTED 2026-10-21**, so B–G may be planned; open questions 1, 2 and 8 were decided the same day, and the four still open (4, 5, 6 and 7) are rows rather than gates; **the catalogue's hosting is superseded by [`2026-10-22-r2-store-backend-design.md`](2026-10-22-r2-store-backend-design.md)** — one Worker, D1 and private R2 — so the catalogue repo, the app-opened PR, the `index.json` Action, `validate-item`, jsDelivr and the GitHub raw/release routes below are historical, not current
- **Date:** 2026-10-12, **revised 2026-10-16** after the `hydralauncher/hydra-themes`
  study, **revised again 2026-10-17** after the rulings in the next section
- **Scope:** two subjects that are one shell. **The storefront**, specified
  kind-agnostically — three kinds are in view, dashboard themes, widget presets
  and editor themes, and **v1 ships the dashboard theme only**, because it is the
  only kind with an exchange unit; the other two get an addendum each. And **the
  three-mode shell** the storefront is a mode of. A third subject, **per-display
  theme assignment**, is deliberately not here: it is its own spec and it lands
  first, per ruling 6 below.

## What this is, and is not

A design agreed in conversation, revised. It exists so a future session starts
from the decisions rather than re-deriving them. It is **not** accepted work:
`STATUS.md` alone decides acceptance, and nothing here is the active plan. The
free-tier limits that decide feasibility were probes rather than assumptions, and
**they have now been run**: § "Measured 2026-10-21" carries the answers, and two of
them contradict what this document assumed — the CDN cannot carry a package, and
the re-home's download counter does not obviously survive it. A limit that turns
out false changes the architecture, which is what that section is for.

**Superseded by this revision, and named so the old reading is not resurrected:**
the previous scope line said "the **theme** half only … the widget store is a
later spec that this one must not pre-empt", and `vg-388` said in as many words
that widgets are out of scope. The user ruled on 2026-10-15 that **the store
carries three kinds and the spec is scoped storefront-now, kinds-follow**. The
widget store is still a later piece of work; it is no longer a later *storefront*.

## Rulings taken 2026-10-17

Ten decisions, all the user's, taken across four passes on 2026-10-17 and
2026-10-18. Each one changes a section below rather than adding to it, which is why
they are first.

1. **The store interface shows online themes and local themes together** — the
   catalogue, and the themes made here or imported offline, in one surface. This
   is the requirement the rest of the revision is arranged around.
2. **Import lands in the library.** A package brought in offline is written into
   the host's theme library, so the local list is exactly the library.
3. **The store mode's two halves are tabs** — local and online. A downloaded
   theme *is* a local theme (see "Provenance"), so the two views of one fact are
   never on screen together. That cost is accepted rather than argued.
4. **The third mode is this PC** — devices, display and theme questions, rebuilt
   in the shell. Its Themes section and `library.html`'s activate job move to the
   store mode's local tab, so one surface owns the theme list. `Editor Settings`
   keeps the editor's own chrome, and the two names stop conflicting because the
   subjects are disjoint: the mode owns the machine, the pane owns the editor.
   `settings.html` and `library.html` stay served, so a browser with no editor
   open can still pick and administer.
5. **Activation is per-display from the start.** The local tab assigns a theme to
   a display client, or to a default for unassigned ones. `active-theme.json`'s
   one id for the host becomes a per-display map and `/api/themes/active` changes
   shape with it, so no activation work is built against the single-theme model
   and then reworked.
6. **Per-display assignment is its own spec and lands first.** This document
   consumes its assign action and does not restate its model.
7. **The store is searchable and filterable by author, colour mode, the sensors a
   theme reads, shape (orientation, aspect ratio, pixel size) and author-declared
   style tags** — the five facets of § "Finding a theme: the five facets". Four are
   derived from the document rather than authored; style tags are the one addition
   to the theme format, and they are **picked from the tags that already exist**
   rather than typed, with a new tag proposed only when nothing fits and carried by
   the same submission as its first use. The format validates a tag's shape, not its
   membership, because a tag the vocabulary does not yet know has to be writable
   before the vocabulary can grow to include it.
8. **The store is a gallery grid, paged at the bottom, with a configurable number
   of themes per page** — § "The gallery, and paging". The grid replaces the row
   list in both halves rather than being a second view of it. The grid is
   responsive by CSS rather than by breakpoints, and the pager shows the five pages
   nearest the current one rather than only a step back and a step forward.
9. **An item opens a detail modal** — § "The item's own surface". The gallery shows
   what a theme looks like; the modal is where a theme is *read*: a fixed preview
   stage the theme is contained in, its description, and the facts the grid has no
   room for. (Amended the next day: the first cut sized the stage to the theme's own
   ratio, which makes the modal change height as a person steps between themes.)
10. **The item kind is an extension point, and a second kind is an addition rather
    than a rewrite** — § "Adding a kind, and what keeps it cheap". `kind` is already
    the seam a client reads, and v1 ships one kind, so the ruling fixes what the
    first kind must leave open: a stable wire value distinct from the display word,
    one handler table whose missing row *is* the degradation rule, a store instance
    per kind rather than a `kind` field on the theme store, and a facet set that is
    each kind's own rather than a union. It builds no second kind and designs no
    second format — open question 6 still owns both addenda.

**What ruling 6 supersedes.** The draft said the three-mode top bar "needs its
own spec, not a section of this one"; the user folded it in on 2026-10-17, so
that sentence is superseded and the shell is specified here. Ruling 5's subject
is the queued multi-device objective, which has no register row: it gets one, and
its spec is the first thing this work owes.

## The intent

A store inside the app where authors share items and anyone browses and downloads
them. Open browse and download for anyone, including people with no account.
Submission is gated: an author submits, the owner reviews, and the owner may mark
an author **verified**, after which that author's submissions are automated.

## The three kinds, and which has an exchange unit

| Kind | What it is | Exchange unit today |
|---|---|---|
| Dashboard theme | the persisted envelope: `artboard`, `globals`, `assets`, `bindings`, `scene` | **yes** — ADR-0004/0017, §139/§141, `host/src/themes/store.ts` bounds |
| Widget preset | **the same envelope minus the artboard**: a scene **subtree** plus its `bindings`, `globals` and `assets` | no — §139 defers widget packages until an authoring workflow exists |
| Editor theme | a token set for the editor chrome | no, **and that is a decision rather than a gap** |

**A widget preset is a theme envelope minus the artboard** (user, 2026-10-15).
That is deliberately larger than the cheapest reading — a subtree plus bindings
alone — and it is the *cheaper* one overall: it reuses the envelope's own
sections, and therefore its validator and its bounds, rather than inventing a
second format for a second kind. `card-library.ts`'s insertable cards are the
authoring-side precedent: one Fabric `Group` over its parts, readings in the
envelope's `bindings`, and a `provenance` key.

**An editor theme is a token set, not a scene**, because §35 states that
editor-shell theming is separate from authored dashboard theme globals. Nothing
about the dashboard theme's package answers what this artifact is, so its
addendum has to settle that first. `DESIGN.md` is the design language's contract
and the ratchet in `scripts/design-tokens.mjs` guards the chrome, so an editor
theme is a *token* artifact that those instruments can read — not a stylesheet.

**Each kind's wire identifier is fixed here** — `dashboard-theme`, `widget-preset`,
and the editor theme's once its addendum names the artifact — because
§ "Adding a kind" makes the identifier a value on the wire that a client older than
the kind must still be able to print. What a kind is *called* in the interface is
`uiCopy`'s word for it and can change without a format change.

**Why v1 is one kind.** This document's central leverage claim is that the store
defines no format, no validator and no size policy, because it reuses the ones
that are already contracts. That claim is true only while one exchange unit
exists. Two of the three kinds have none, so building all three now means
designing two formats in the same breath as the storefront.

## What the hydra-themes study contributes, and what it does not

`hydralauncher/hydra-themes` was studied on 2026-10-16 as the reference for this
design. What it actually does, read from its files rather than its README:

- **Unit:** `themes/<ThemeName>-<authorCode>/` holding exactly one `.css` and one
  `screenshot.<ext>`. There is no per-theme manifest: the name is the folder name
  minus its last dash segment, and that segment is the author's account id.
- **Validation** (`src/lib/validate-themes.ts`, run by CI on every PR): a
  stylesheet exists; a file whose lowercased name starts with `screenshot` has an
  allowed extension; the folder yields a non-empty author code **that resolves as
  a real account through their API**; theme names are unique across the repo.
- **Index** (`src/lib/generate-themes.ts`, run at build): derives
  `{name, authorId, hasAchievementsSupport, hasAchievementSoundSupport}`, makes
  webp thumbnails at 340 and 1920 wide, then **POSTs the array to their API**
  rather than committing a manifest. Git is the submission medium; their server
  is the runtime source.
- **Capabilities are inferred from the artifact**: achievements support means the
  CSS contains a class starting `achievement-notification`; sound support means an
  `achievement.{wav,mp3,ogg,m4a}` file exists. That is a workaround for having no
  schema.
- **No versioning, update or deletion semantics anywhere in it.**

**What transfers.** The minimal unit; validation as one script CI runs; author
identity reused from the host account rather than invented; capability flags on
the index so the client renders badges without fetching every item. All four
already match `vg-388`'s agreed shape.

**What does not transfer, and why it matters more than what does.** Hydra's
theming mechanism is **CSS overriding their app's markup**, which is the one thing
this product forbids: a dashboard theme here is a validated Fabric-JSON envelope,
and the editor chrome is tokens under `DESIGN.md` watched by the ratchet. A
stylesheet-shaped editor theme would bypass the design system and the token
instrument entirely. Inferring capability from selectors is likewise unnecessary
when a schema exists — our items **declare** their kind and their features. And
their server as the runtime source is the opposite of this design's premise, which
is that browsing and downloading touch no API at all.

## What already exists, and must not be rebuilt

- `ADR-0004` — `@yunari/theme-package` owns the ZIP layout and validation. A
  validated package is the immutable portable artifact; a local folder may be an
  authoring workspace but never a competing published format.
- `0017` — a theme is a **folder**; a ZIP is **only** what an author exports.
  Folder and package state do not silently synchronize.
- `§139` — the package embeds its declared `assets/` bytes and may carry a
  thumbnail at the package root, so a recipient sees the look without installing.
  It names "a future store" directly.
- `§141` — validation: reject traversal, symlinks, decompression bombs,
  executable content, external SVG resources; fail cleanly without mutating the
  open document.
- `0009`, `0010`, `0023` — asset URLs are base + declared path, served as their
  own type; the code decides what a theme may carry.
- **Bounds already exist and are enforced in both directions** in
  `host/src/themes/store.ts`: `MAX_ASSET_BYTES` 80 MiB, `MAX_ASSET_COUNT` 128,
  `MAX_TOTAL_ASSET_BYTES` 90 MiB, `MAX_THEME_FILE_BYTES` 32 MiB. `assetBounds`
  runs on save and the same refusals run on load.
- **The listing already reads every envelope.** `ThemeStore.list()` validates each
  stored document and `entryFor` takes the envelope, which is where the `author` a
  library cell shows already comes from. The facet record extends that one
  function.
- **The semantic-key vocabulary already has an owner and a label.**
  `describeSemanticKey` in `renderer-core` returns a descriptor with a `label` and
  a `family`, and `host/src/settings/required-devices.ts` already derives from
  `envelope.bindings` — for a different question, which slots to ask about. The
  sensors facet reads the same two things and replaces neither.
- **`metadata` already carries what the authored facets need** —
  `name`, `author`, `description`, `version`, `themeLanguage` — and
  `editor/src/panes/document/metadata-fields.tsx` is where they are authored. Tags
  are a field there, not a surface. **`artboard.width` and `artboard.height` are
  already authored and already bounded**, so the Shape facet's three readings need
  nothing new either.
- **The shell already persists a view preference.** `editor-shell/palette.ts`
  establishes the namespaced `localStorage` key with a read/write/clear trio; the
  page size is the second thing that needs exactly that and nothing more.
- **`PalettePaint` is solid-or-gradient** (`renderer-core/src/theme/document.ts`),
  so colour mode has a total rule rather than a case that was not thought about.

The store therefore does not define a format, a validator or a size policy. It
uses the ones that are already contracts — and it derives its facets from the
document rather than adding a parallel description of it.

## Architecture: GitHub is the whole backend

No server the owner runs, and no recurring cost.

| Concern | Mechanism |
|---|---|
| Catalogue | `catalogue/<id>/item.json` plus thumbnail, in one public repo |
| Identity | the author's GitHub account, reused for everything |
| Submission | **a pull request the app opens on the author's behalf** |
| Review | **the PR diff** — an item is JSON, so the change is readable |
| Listing | merging the PR |
| Verified author | a login in a list file, which makes their PRs auto-merge |
| Media | release assets — 2 GiB per file, 1000 per release, no documented bandwidth limit — **but whose repository they live in is open question 1, and the app-opened PR made it sharper** |
| Delivery to the app | `index.json` and thumbnails over a free CDN, **and never a package**: jsDelivr refuses a single GitHub file over 20 MB, so the CDN is a metadata-and-pictures layer and an item comes from a release asset (§ "Measured 2026-10-21") |
| Counters | `created`/`updated` from git; `downloads` native **if the bytes live on a release the store owns — the re-home's counter restart is the open probe**; `favorites` via reactions, folded into `index.json` on a schedule |

Why the diff matters: the review instrument is the thing that costs the most to
build, and a PR gives it for free. An item is JSON, so a reviewer reads what
changed. An upload form plus a review UI is strictly more app for a worse
instrument.

### The item, and why `kind` is the seam

`item.json` carries a **`kind`** field, and it is the only field the storefront
reads to decide how to present and install an item. Everything else stays as the
draft has it.

**An unknown `kind` must degrade rather than break.** The client renders what the
item declares and refuses what it does not recognise, because the two addenda
will add kinds to a catalogue that already has items in it. This is the one place
v1 pays for kinds it does not ship, and it is cheaper than a migration later: a
client that cannot parse an item must skip it and say so, not fail the listing.

### Adding a kind, and what keeps it cheap

v1 ships one kind and two more are already named, so the question is not whether a
second arrives but whether it arrives as an addition. Five things decide that, and
none of them builds a second kind.

**The wire value and the display word are different things.** `item.json`'s `kind`
is a stable identifier (`dashboard-theme`, `widget-preset`), never a word a person
reads; the badge in a cell and the kind badge in the modal read `uiCopy`'s word for
it. So renaming what a kind is *called* is not a change to what it *is* — and a
build older than a kind still has something true to print, which is why the browse
drawing's skipped-kind line quotes the identifier: a client that does not know a
kind cannot know its name either.

**One table, and the fallback is the row that is missing.** The client resolves a
kind through a table — one handler per kind, supplying how an item is validated,
installed and presented — and the absence of a row *is* the degradation rule above:
skip it, count it, name the kind that was skipped. v1's table has exactly one row
and is written as a table rather than a branch, because the fallback already
exists: a lookup with a default is the shape that grows a second row as data, and a
branch is the shape that grows a second `if` in every surface that reads one.

**A kind gets its own store rather than a field on this one.**
`host/src/themes/store.ts` is the *theme* store: one folder file name
(`theme.json`), one validator (`validateFabricThemeEnvelope`), and
`readStoredOrAbsent` answers a folder that is not a theme envelope as **absent**.
A second kind written under the same root would therefore not degrade — `list()`
would omit it silently, which is worse than a refusal because nothing reports it.
`createThemeStore(directory)` already takes its directory, so the decision is that a
kind is a second call rather than a `kind` field on the first, and that the local
half reads items through the set of registered stores rather than through
`ThemeStore` directly. **That indirection is this ruling's whole cost at phase A**,
and it is one hop: without it the local half is written against one store, and the
second kind rewrites the tab.

**The facets a kind has are its own, and the ones it lacks are absent rather than
defaulted.** A widget preset is the envelope minus the artboard, so it has no
orientation, no aspect ratio and no pixel size, and no background to derive a colour
mode from. Those facets are **not offered** for such an item, and it matches no
selection in them — the rule the sensors facet already carries, that a theme binding
nothing matches no sensor selection. A row showing every kind's facets at once would
be mostly empty controls, and would make "nothing matched" and "not applicable" the
same answer.

**`item.json` splits into a header the storefront owns and a body the kind owns.**
The header is what every cell, every filter and every sort needs, so it is the
storefront's: the id, the kind, the name, the author, the version, the dates, the
counts, the thumbnail, and the derived facet record. The body is the kind's and the
storefront never reads inside it, which is what keeps the absence-of-artboard case a
question about the header rather than a per-kind branch in the UI.

**What this does not do.** It designs no second kind and builds none: open question
6 still owns the two addenda, and each is settled by the document that owns its
format. What it buys is that an addendum's work is a new store, a new handler row
and a new `item.json` body, rather than a second reading of every surface this
document specifies.

### The trust ladder

1. **Unverified author** — submits. Any GitHub account can fork a public repo, so
   this needs no invite and no setup from the owner. The owner reviews and merges,
   or closes.
2. **Verified author** — a GitHub Action auto-merges their own PR once validation
   passes, with no invitation for them to accept.

**The auto-merge rule is a security boundary, not a convenience.** A PR that
auto-merges on the strength of a username will happily carry a diff that edits
`.github/` or another author's item. Auto-merge must require all three of: the PR
author is in the verified list; validation is green; **and the diff touches only
that author's own `catalogue/<id>/` path**.

**A merge must also regenerate `index.json` in the same workflow.** A push made
with `GITHUB_TOKEN` starts no workflow, so the `catalogue/**` trigger never sees
an auto-merge's own commit and the listing silently keeps the item it had before.
Proved on a real repo 2026-10-22: PR #1 merged with `entries: []` still on `main`.

**The app-opened PR adds a fourth requirement.** Because the *client*, not the
person, composes the branch and the PR, the client must not be able to name the
target path: the app commits only to the author's own fork and the path is
derived from the author's identity and the item's id, never taken from input. A
client that can name a path is a store-wide write primitive in a compromised build.

### Identity: the device flow, and the first credential this product stores

Browsing and downloading need **no identity at all** — `index.json` is a static
file and downloads are plain URLs, so neither a token nor an API call is involved.
**Which plain URL is the load-bearing part, and it is measured**: the raw path
that serves `index.json` carries its own ETag and a 5-minute cache, and it is the
same path that serves every `packageUrl` — the package rides in the catalogue
repo beside `item.json` (§ "Open questions", 1, decided 2026-10-21). Favorites and
download counts are baked into `index.json` by the Action, so an anonymous viewer
still sees them; only *casting* a favorite needs a token, and under the decided
hosting there is no asset counter to increment.

**Publishing does need a token, and the previous draft was wrong to imply
otherwise.** "Sign-in is a just-in-time prompt on the heart control and nothing
more" is false once the app opens the pull request: the larger act is now the one
that requires identity. What survives is the property that mattered — a viewer who
never publishes never signs in.

- **The flow is GitHub's device authorization flow.** A locally-run host **cannot
  keep a client secret**, so the web redirect flow is unavailable to it. The app
  shows a code, the author approves it on github.com, and the app receives a
  token with the narrowest scope that can fork and open a PR on a public repo.
- **The token is consumer state**, stored beside the active-theme choice and the
  display settings. It is the **first credential this product stores**, so its
  file, its permissions, whether it is encrypted at rest, and what it does on
  failure or revocation are this design's business rather than an implementation
  detail.
- **Nothing secret ever reaches a fork's workflow.** Fork PRs do not receive the
  repository's secrets, which is why the re-homing job below runs after merge
  rather than during review.

### Views are dropped

GitHub exposes no per-item view count, and its traffic API is owner-only and 14
days deep. Rather than build a write endpoint for the one counter with no free
native source, **"most viewed" is not a sort this store offers.** Sorting is
created, updated, downloads and favorites.

## Submission: the app opens the pull request

The user ruled on 2026-10-15 that the app performs the submission. The sequence,
and the one rule each step exists to keep:

1. The app validates the package locally against the contracts above — the same
   validator, before anything leaves the machine.
2. The app forks the catalogue repo into the author's account, if it has not
   already, and commits `catalogue/<id>/item.json` plus the thumbnail to that fork.
3. The app opens the PR against the catalogue repo.
4. CI validates; the owner reviews the diff, or auto-merge fires under the
   four-part rule above.
5. Merging lists the item.

**The alternative, recorded because it is the one an author may prefer:** the app
exports the package and hands over a prefilled GitHub link the author completes
in a browser. No token reaches the app at all. It is not the ruling; it remains
the fallback if the OAuth app becomes a burden, and the client should be written
so the submission step is one seam rather than a path threaded through the UI.

## The shell: three modes, and what each surface owns

One shell whose top bar switches between **theme store**, **theme editor** and
**host settings**. The store is a sibling of the editor rather than something
inside it, and it is never built inside a shell it will leave.

**The switch is the header, because a second bar is forbidden.** §7.2 says the
rail replaced the horizontal pane bar and "a second horizontal bar under the
header is forbidden", and §10 lists one as a don't. So there is no mode strip
under the header: the header itself gains the mode switch and its action region
becomes per-mode — `File`/`Edit`/`View` and the publish chord in editor mode, the
store's own actions in the store mode, nothing but the switch where a mode has no
action of its own. §7.1 is amended in the same commit, which is what it asks for
when a surface needs something it does not have.

**The switch is a `Segmented`** — §5's "small exclusive choice where both options
must be readable" — not a new control, because §10 forbids inventing one. Its
labels are the modes' names, and **the names are the one thing here that needs
the user's word**: the draft's names are *theme store*, *theme editor* and *host
settings*, and the proposal the drawings carry is **Editor · Themes · This PC**,
which reuses the product's own words for two of the three (`uiCopy.menus`'s
editor, and the host page's `This PC`) and keeps `Editor Settings` for the pane.

**The store's two halves are a `Segmented` in the region's own header row**, not a
second bar: it sits inside the content region beside the filter and the sort, the
way a pane's title bar sits inside its pane. That reading is stated because a
reviewer is right to ask whether it is the forbidden second bar — it is a region's
own control over what the region lists, not navigation between shell surfaces,
and the shell's navigation is the header.

| Surface | Owns | Loses |
|---|---|---|
| Theme store mode | the theme list — the local tab over the host library, the online tab over the catalogue — plus import, export, install, removal and submission | — |
| Host settings mode | this PC: devices, display, and the theme questions **per display** | its Themes section, to the store's local tab |
| Theme editor | the document | — |
| `Editor Settings` pane (its own spec) | the editor's own chrome: appearance, keyboard, about | — |

**The reconciliation the draft asked for, answered.** The mode owns the machine
and what it displays; the pane owns the editor's own chrome. Nothing is owned by
both, so no subject moves twice and neither name is a lie. Themes are the one
list that moves: today `settings.html` lists them, `library.html` chooses the
active one and `ThemeLibraryChooser` opens one, and afterwards the store mode's
local tab is where a theme is listed, opened, activated, exported or removed.

**Per-display assignment reaches the answers, not only the theme.** The user's
words are that each display client holds "their own theme & its theme-specific
settings", so `theme-answers.json` stops being keyed by theme alone: an answer
belongs to a display's use of a theme. That is the per-display spec's model to
define — this document records only that the Host settings mode is where the
answers are given, and that the key change is why the mode's third section is not
the same section it is today.

**`settings.html` and `library.html` are not deleted.** They are served from
`BundleRoots.admin` and are the only surfaces a phone, or a browser with no editor
open, can reach — so a consumer who never opens the editor keeps the path they
have. The shell's mode is the author's path to the same facts.

**One invariant: a mode switch never loses an unsaved document.** The editor's
existing dirty guard is the instrument; a mode switch is not a document
replacement and must not read as one.

**Two costs, named rather than discovered.** The bar restructures
`editor-shell/`'s header and rail, which `vg-269` and `vg-330` are already
touching, and `editor-shell/shell-layout.tsx` is a watched path — a decision note
must claim it before the first write there. And the third mode is a rebuild of
four sections in the shell's own React, not an iframe over the host's page.

## The store mode

Two tabs, and the whole surface is those two galleries.

**Local** — the host's library, exactly: `ThemeStore.list()` plus the origin
record. A cell is a thumbnail, the name, the author and `updatedAt`, with actions
**Open in editor**, **Assign to display**, **Export package** and **Delete**. The
mode carries one action of its own: **Import package**.

**Online** — the catalogue's `index.json`. A cell is a thumbnail, the name, the
author, the item's `kind`, its download and favorite counts and when it changed,
with **Install** — or, when the item is installed, **Installed**, and **Update**
when the catalogue's version is newer. **Removal is not here**: removing an
installed theme is deleting a theme, and the local half's Delete owns it. An act
with two owners is what the ownership map exists to prevent.

The region's own header row carries the search box, the five facets and the sort — §
"Finding a theme: the five facets". A sort per half, because the two share no sort
key: online sorts by created, updated, downloads and favorites (§ "Views are
dropped"), local by name and `updatedAt`.

**Every action here already has an owner.** Open, export, delete and assign are
the library's existing operations, import is § "Import lands in the library" and
install is § "Provenance". The store mode composes them and invents none.

**As landed, two of the four are drawn disabled, and a later phase owns the
wiring.** `Export package` and `Delete` have an owner in the library — removal
still reaches `DELETE /api/themes/:id` through `theme-list.js`'s `deleteTheme` —
but **no task in phase A and no phase in the landing order owns bringing them into
the cell**, so A draws all four, as the checked drawing does, and disables the two
with their reason rather than answering a press with nothing (R164). Naming the
phase that wires them is B's or D's call, not A's.

## Finding a theme: the five facets

A store that only lists is a store you scroll. Five facets — and the first thing
each needs is an answer to *who knows the value*, because four of the five are
already in the document and only one is not.

| Facet | Values | Where the value comes from |
|---|---|---|
| **Author** | `metadata.author` | authored, and already in the format |
| **Colour mode** | light, dark, unclassified | derived from the artboard's resolved background |
| **Sensors** | the `semanticKey` of every binding the theme declares | derived from `bindings` |
| **Shape** | orientation, aspect ratio, pixel size | derived from `artboard.width` and `artboard.height` |
| **Style** | `metadata.tags` | authored, and new — see below |

**One record, one function, two producers.** The values above are computed into a
single facet record, and the function that computes it lives in `renderer-core`,
because that is the only layer both producers can import: the host, for a theme in
the library, and the catalogue's Action, for a theme it has just merged. A theme's
facets are **never authored and never stored in `theme.json`** — they are derived
where they are needed. `index.json` carries the derived record per item, which is
why the Action writes it and the author's `item.json` does not. How the Action
obtains the function — a published package, or the workflow checking out the app
repo at a pinned commit — is the plan's choice, not this document's.

**The host already has the envelope in hand.** `ThemeStore.list()` validates every
stored document and hands the envelope to `entryFor`, which is where the existing
`author` comes from. The facet record is an extension of that one function, not a
second pass over the library and not a cache: a listing that already parses every
theme is the listing that can afford to derive from them.

**Colour mode is derived, and may be absent.** The artboard's `background` token
resolves to a `PalettePaint`, which is a solid or a gradient (`document.ts`), so: a
solid takes its own relative luminance, read as CIE `L*` — the perceptual scale the
middle band below is stated in, which is what puts a mid-grey ground *in* the band
instead of calling it light; a gradient takes the mean of its stops **in that
scale**, which is what makes a black-to-white ground ambiguous rather than light; a
theme with `artboard.backgroundMedia` is **unclassified**, because a picture is its
ground and the token is not what a viewer sees. A lightness in the middle band is
unclassified too — that is the one place the answer is genuinely ambiguous, and a
wrong *light* on a mid-grey theme is worse than no answer at all. **Unclassified
themes are reachable under "any" and under no other value**, so the facet never
hides a theme from someone who did not ask it to.

**Sensors are the keys the theme reads.** Every `bindings[*][*].semanticKey`,
unioned, grouped by the family `describeSemanticKey` already returns and labelled
by the descriptor's own `label` — the same two things `requiredDeviceGroups` reads,
which stays the host's separate answer about which *slots* to ask about (§145). A
theme that binds nothing has no sensor values and matches no sensor selection; that
is a fact about the theme rather than a gap to fill. A key with no descriptor in
this build is still listed, labelled by its key, because the alternative is a theme
that reads something invisible to search.

**Shape is three readings of two numbers.** `artboard.width` and
`artboard.height` are already authored and already validated, and orientation,
aspect ratio and pixel size are what a person can read off them — one source,
three questions, and nothing new to author.

- **Orientation** is landscape, portrait or square, and square is exact equality
  rather than a tolerance band: the two numbers are the author's own, and an
  artboard of 1000×1001 is not square.
- **Aspect ratio is bucketed, and the bucket is published.** An artboard may be any
  size up to 16384, so the exact ratio would be a facet with one value per theme.
  The set is 1:1, 4:3, 3:2, 16:10, 16:9, **19.5:9**, 21:9 and 32:9 together with each
  one's portrait inversion — the seven the facet shipped with plus the one the
  measurement added (§ Open questions 8, `vg-673`) — and the nearest is chosen by
  comparing the artboard's **long edge over its short edge** in log space, which is
  the comparison that treats 16:9 and 9:16 as the same distance and is the one
  `artboard-presets.ts`'s `nearestArtboardPreset` already makes. **A theme further
  from every bucket than the tolerance is `Other`** — never the nearest wrong
  bucket, because a facet that files a 2.35:1 artboard under 21:9 is a facet that
  lies about the thing it exists to filter. **The tolerance is bounded rather than
  picked**: it must stay under 3.2%, the tightest half-gap between two adjacent
  buckets (3:2 against 16:10), and 0.5% is what shipped.
- **Pixel size is exact**, and the facet offers the sizes **more than one theme
  declares**, largest first. A facet of one-off sizes is a list of themes wearing a
  filter's clothes; every other size is reachable under `Other`, and the exact size
  is on the detail modal either way.

**The facet does not reshape the tile, and that is a cost worth naming.** The grid's
boxes stay uniform and the picture is covered, so a portrait theme is cropped in the
grid. Seeing a theme at its own ratio is what the detail modal is for, which is one
of the reasons it exists rather than being a nicety.

**Within a facet the values are OR, across facets they are AND — except Sensors and
Shape, where they are AND.** Two facets ask a question that only *all* of a
selection can answer, and for the same reason: a theme must read every sensor you
asked for, and it must have every shape property you asked for. "Themes that use
CPU **and** GPU" is one selection that must not return a CPU-only theme, and
"landscape 16:9 at 1920×1080" is one shape, not three alternative ones. Inside
Shape, the three groups are therefore AND with each other and OR within themselves,
which is the same rule one level down. Author, colour mode and style take the
ordinary reading, where selecting *nature* and *cityscape* asks for either. This is
the one place the rules differ, and they differ on purpose.

**Style tags are the one thing this adds to the format, and they are picked, not
typed.** An author chooses from the tags that already exist; the field offers the
vocabulary, and **a new tag is proposed only when nothing in it fits**. That
ordering is the whole mechanism, and it is what keeps the facet enumerable without
an enum: free text as the *first* affordance puts *sci-fi*, *scifi* and *science
fiction* into the catalogue as three tags with one theme each, and the browsing
this section exists to serve is what suffers. A proposal is a deliberate act with
a reason behind it; a typo is not.

**So the format validates the shape and the store owns the vocabulary.** A tag is
lowercase — `[a-z0-9-]`, one to twenty-four characters — and a theme declares at
most five. That is what `renderer-core` and `schema/theme-document.schema.json`
enforce, and it is the whole of what they enforce: **there is no enum to mirror
into `envelope-keys.ts`**, because a tag the vocabulary does not yet know has to be
writable before the vocabulary can grow to include it.

**The vocabulary is what exists, and it grows through the same PR as its first
use.** The Style facet enumerates the tags present in the catalogue, so the
vocabulary *is* the catalogue's own content and needs no second file to fall out of
step with. The editor offers the shipped seed list when it is offline and the
catalogue's own tags when it is online. When an author proposes one, the submission
carries the tag and the theme that uses it in a single diff, so the reviewer
approves the word and its first use together — which is the only review that can
catch a near-synonym, and is a person's judgement rather than a schema's.

**What that costs, named rather than discovered.** A theme can carry a tag no other
theme has, and the facet will show it with a count of one. That is the price of not
blocking an author on a vocabulary change, and it is the price the user chose: the
alternative is a closed enum in the format, where a new style waits for a schema
release before anyone can use it.

The authoring surface is `panes/document/metadata-fields.tsx`, which already
carries `name`, `author`, `description` and `themeLanguage`: tags are a field
there, not a new surface.

**This is a change to the published format, and its consequence is named rather
than discovered.** `metadata` is `additionalProperties: false`, so a build older
than this one refuses a tagged theme as an unknown field. Pre-release internal
architecture may break cleanly, so v2 gains the field without a version bump — what
must not happen is a tagged theme reaching a user on an old build and being
reported as corrupt.

**Tags belong in `theme.json` and provenance does not, and the difference is the
test the earlier ruling already used.** Provenance is a fact about *this machine's
copy*, which is why it is consumer state; a tag is a fact about *the theme*,
authored by whoever made it, and it has to travel in the package or the catalogue
cannot be filtered by it.

## The gallery, and paging

The store is a gallery of pictures, so it is a grid and not a list of rows: a
thumbnail, the name, the author and the badges, in a cell sized by the window.

**The grid is CSS, and it is responsive without a breakpoint list.**
`repeat(auto-fill, minmax(<cell>, 1fr))` answers the column count from the
available width, so there is no resize listener, no measured column count, and no
second copy of the window's size to keep in step — and no invented breakpoints
either. §7.8's rule is the one that binds — *measure labels, hit areas and contrast
at the real pane width before changing column count; reduce columns only for an
observed overflow or readability failure* — so the column count is observed rather
than asserted, and the proof is §7.7's own: 1280×720, 1440×900 and 200% browser
zoom. **The phone layout is `vg-172`'s recorded limitation and this design does not
claim to fix it.**

**The cell is one box, and both halves use it.** A person switching tabs must not
watch the grid change shape under them, so the local cell and the online cell are
the same width and the same height, and the anatomy is stated once:

| Band | Height | Holds |
|---|---|---|
| the picture | `aspect-ratio: 2/1` | the thumbnail, or the theme's own ground when it has none |
| the name | 17px | the name, ellipsized, with its full value as the accessible name (§7.7) |
| the author | 15px | the author in mono, or *No author* — an imported package has none |
| the facts | 26px | badges and counts left, actions right |
| the inset | 10px at each end | |

**The minimum comes from the wider of the two halves, which is the online one.** Its
facts band is the busiest — a kind badge, both counts and the longest action label —
and **272px is where that lands** once the inset is counted, rounded up to a multiple
of 8 for the slack §7.8's own measurement will want. A local cell needs less, four
26px icon buttons, and takes the same minimum anyway, because the two grids are one
grid. **That is the reason to derive it rather than pick it**: a minimum chosen for
the local half alone is a grid that overflows the moment the catalogue's cells arrive
in it, and the two halves would then be two sizes, which is the thing this paragraph
exists to prevent. The facts band is also why the badge sits there and not beside the
name: in the name row it would make the two halves' cells different heights, and the
row has only the name's own room.

**What is not automatic is the facet row, and that is the one responsive decision
made here.** It wraps to a second line rather than dropping a control, because a
filter that has silently gone missing is worse than a row one line taller.

**A thumbnail has no known aspect and may be absent.** The store keeps whatever PNG
was captured, inside its byte bound and under no shape rule
(`themes/thumbnails.ts`), so a cell is a fixed-ratio box and the picture is
`object-fit: cover` within it. A theme with no picture is a flat tile of its own
artboard background rather than an empty box: the library already treats a missing
thumbnail as ordinary, and a grid of holes is not a gallery.

**Paging is client-side, and that is not a shortcut.** The local half is a folder on
this machine, and the online half is one static `index.json` fetched whole, so
neither has a page to ask a server for. The upgrade path is named where it would be
needed — sharding `index.json` when the catalogue outgrows a single file.

The pager sits at the bottom of the list, above the status bar, and it is a
**numbered** one: a step back, then the five pages nearest the current page, then a
step forward, with the first and last always reachable and an ellipsis standing for
what is skipped — `1 … 4 5 [6] 7 8 … 12`. Five rather than every page because a
catalogue of four hundred items has thirty-four pages and a row of thirty-four
numerals is not navigation; and a catalogue of seven pages or fewer shows them all
with no ellipsis, because at that size the numbers *are* the list. The current page
carries the same chosen treatment every other chosen thing in this store carries —
a raised background and a `--text` numeral — and never an accent fill (§4). Beside
the numbers, the per-page choice of 12, 24, 48 or All.

**The page size is a view preference and persists; the filter and the sort are a
query and do not.** It is stored the way the shell's own palette choice already is
— a namespaced key in the shell's `localStorage`, with the read/write/clear trio
`editor-shell/palette.ts` establishes — because that is what this is: a preference
about how this viewer sees this surface, not consumer state the host owns and not
theme data.

**Changing a filter returns to page one.** Otherwise a narrower result leaves the
viewer on a page that no longer exists, which reads as an empty store.

**An empty result is a sentence, not an empty grid**, and the two empties are
different sentences because they have different answers. A library with nothing in
it: *"No themes are saved on this PC yet."* with *"Build one in the editor, or
import a package."* below it. A filter that matched nothing: *"No themes match
these filters."* and the way out is clearing them — never the first-run sentence,
which would tell someone with forty themes to go and build one.

**§5 grows one control, and the rest is composition.** A checkbox choice row is
absent from the closed vocabulary — rule 7 describes a radio group — so it is
added to DESIGN.md in the same commit that draws it rather than exempted locally.
Everything else here is made of what §5 already names: the facet button is the well
idiom with a chevron and a count; the cell is a panel; the per-page choice is a
well; and the pager is §5's icon button — whose glyph is a numeral, which is still a
glyph — around the same chosen treatment the facet value and the mode switch item
already use. **The cell's four actions stay visible rather than moving into an
overflow menu**, because §8 puts disclosure on the once-in-a-while and opening and
assigning a theme are the frequent acts of a theme library.

## The item's own surface

The gallery answers *what does this look like*; it cannot answer *what is this*. A
cell has room for a name, an author and a badge, and the facts that decide whether
someone wants a theme — its description, its version, when it changed, which
sensors it reads, its shape, its tags, its counts — do not fit and should not be
crammed into one.

**So a cell opens a modal, and it is one modal for every kind.** The subject is an
item, not a theme: `kind` is already the seam the storefront reads (§ "The item,
and why `kind` is the seam"), so the dashboard theme's modal is the first of three
rather than a surface the widget preset will need its own version of. What changes
with the kind is which sections the modal has, not which modal it is.

It is § "Elevation & Depth"'s level 3, like the settings modal: radius 8, the
`0 24px 60px` shadow over the scrim, dialog padding from §3's 20–24 band. **960px
wide against the settings modal's 560**, because its subject is a picture.

**The preview is a fixed stage, and the theme is contained in it.** The stage is one
height for every theme, and the picture sits inside it at its own ratio, letterboxed
against a ground darker than the modal's own surface. Sizing the stage to the theme's
ratio instead would make the modal change height as a person steps from theme to
theme, which is the one thing a viewer must not do. **This is also where the grid's
crop is paid back**: the cells are uniform and cover the picture, so the stage is the
place a portrait artboard is seen entire.

**The facts are pills, not rows.** A row per sensor spends a 30px line and a label
column to say four words, and the modal has a picture to give that room to. So the
caption band is three groups of pills under §2's eyebrow — **Reads**, **Shape** and
**Style** — and each group is exactly the facet it comes from, which is why its words
are the words the filter offered. A sensor pill carries the descriptor's own label, a
shape pill one reading, and a style pill one tag, with **a proposed tag saying so on
its own pill** rather than being indistinguishable from a settled one.

**Above the band, one line: what the thing is called and who made it.** The name at
§2's `--text-lg`, the author beside it, and the kind as a badge, with the version and
the date it changed pushed to that line's other end — three facts that belong to the
item rather than to any facet, so they take the caption's own line instead of a group.
There is no title bar — the close control floats over the stage's corner the way a
viewer's does, and Escape does the same thing and returns focus to the cell that
opened it.

**Under the groups, one line of provenance**: where the item came from and where it
shows, as a sentence rather than four more rows. This is the origin record's own
surface (§ "Provenance"), and it is the reason the modal is not just a picture with
tags: a cell can say *Installed* and cannot say *installed from where*.

**Below it, the actions**, which are the same commands the cell offers, written in
words rather than glyphs because a footer has the room and the glyph was only ever a
space saving. That is one command reached two ways rather than two owners: the cell
keeps them because they are frequent (§8), and the modal shows them because it is the
surface someone is looking at when they have just read enough to decide.

**Opening it is not a document change and not a mode change.** It does not disturb
the filter, the sort or the page underneath, so closing it puts the viewer back
exactly where they were — the same invariant the mode switch has.

## Import lands in the library

Today a package the author brings in becomes an open *document*
(`editor-main.ts`'s picker → `parseThemePackage`) and reaches the library only if
they then press Save to library. Ruling 2 makes import a library write, so an
imported theme survives the editor closing and appears in the local list.

The host gains one route: package bytes in, `readThemePackage` — the §141 reader
it already depends on — then `ThemeStore.write` and `ThumbnailStore.write`. **The
host validates, not the browser**, because the host owns the folder the bytes land
in and §141 is its contract.

**The id rule.** The envelope's own `id` when it is valid and free; otherwise the
next free id derived from `metadata.name`; otherwise a suffixed one. **Import
never overwrites.** A taken id gets a suffix, so re-importing your own export
makes a second entry rather than replacing the first. Additive is the safe
direction and the duplicate is visible and deletable, where a silent replace is
data loss with no undo.

## Provenance: what makes "Installed" true

Nothing today links a library folder to the catalogue item it came from. Without
that link the surface cannot tell a theme you made from one you downloaded, cannot
offer an update, and cannot say *Installed* at all — which is the whole of what
ruling 1 asks the online tab to show.

**The record is consumer state**, beside `active-theme.json` and
`theme-answers.json`: a `theme-origins.json` keyed by library id, holding the
catalogue id, the version installed and when. It is swept when the theme is
removed, exactly as `ThemeSettingsStore.remove` sweeps answers.

**Why not a stamp inside `theme.json`.** That would change the exchange unit, the
validator and the package — the one thing this design's leverage claim rests on.
Where a theme came from is a fact about *this machine's copy*, the same category
as the per-theme answers already stored that way, and ADR-0017 forbids a silent
folder↔package sync.

**What it answers in v1:** *Installed*, and *Update available* when the
catalogue's version is newer than the recorded one. **What it does not answer
yet, but *can*:** *modified locally*, which needs a content hash stable across a
store round trip — and `contentId` **is** that hash. **Probed 2026-10-21, and it
passes**: a theme written by the store, read back, exported with
`writeThemePackage`, reopened with `readThemePackage` and written again under the
same id produces **byte-identical `theme.json`**, with no assets and with one
(`base` `3443da52c047…` and `bd04fa53d6a1…`, unchanged by the round trip). The
reason is structural rather than lucky: the store persists
`JSON.stringify(validatedEnvelope)` on every write, so whatever form the file
arrived in, the bytes on disk are canonical. **The third state is therefore
possible, and it is its own decision rather than a follow-on**: it needs the
catalogue's package re-derived through the same validator at install time so the
two hashes are comparable, and a rule for how an edited copy is drawn. The row
keeps two states until that decision is taken.

The listing route joins origins onto `/api/themes`, so the client needs one fetch
for the local half. `ThemeStore` itself stays unaware of origins: it owns folders,
not where they came from.

## Media: two of three caps exist, and the third is what makes them reachable

Video is expected to be common, and `§139` puts assets *inside* the package, so
an unbounded video makes package size unbounded — which is the one thing that
breaks a zero-cost host. The normalizing rules below are what turn hosting from a
gamble into a budget.

**Size cap — 80 MiB per asset, 90 MiB of assets in total.** A cap alone refuses
without letting an author predict the outcome, because **bitrate × duration** is
what fills it.

**Duration cap — 30 seconds.** The normalizer's capped-CRF ladder (below) fits a
30-second 4K loop at 20 Mbit/s into roughly 75 MiB. The archive cap is **95 MiB**,
below GitHub's 100 MiB per-file limit, so the item's zip can always be committed
to the catalogue.

**Resolution ceiling — 4096 on the long edge.** A theme may target a 2K or 4K
artboard, so the video cap follows it; the previous 1920 cap would have refused a
4K loop the theme itself renders at full size. The cost is decode work on the
player and a bigger download, both bounded by the rate cap.

### The publish-time normalizer

An author-facing helper resizes and re-encodes a source video into the envelope,
so the store receives a predictable artifact rather than whatever was recorded.
Reuse `§171`'s shape — images are already downscaled on import past a bound — and
apply the same rule to video. It re-encodes at CRF 23 with `maxrate` scaled by
the output's long edge (6 Mbit/s at 1920, 12 at 2560, 20 at 4096, `bufsize` at
twice the cap), so quality tracks resolution while the file stays inside the
asset cap. When audio and/or a missing `+faststart` is the only fault, it copies
the video stream (`-c:v copy -an`) instead: removing a track costs no picture
quality, and a re-encode for it would.

The envelope, each item earning its place:

- **MP4 with `+faststart`**, so playback and seeking start before the whole file
  arrives.
- **H.264 High, `yuv420p`** — 4:2:4 silently fails to decode in some browsers.
- **Even width and height** — H.264 requires it; odd dimensions fail silently.
- **Constant frame rate, ≤ 30fps** — and this one is Yunari-specific:
  `scene-fabric/src/background-media.ts` repaints the scene once per decoded
  frame via `requestVideoFrameCallback`, so a variable cadence becomes a variable
  repaint rate. **Measured 2026-10-20** rather than assumed, on a real screen
  recording: see "Not verified" below for the distribution.
- **No audio track.**
- **Single-pass CRF ~20–23**; 2-pass buys little on a background loop.

Four rules that keep the normalizer honest:

1. **Normalize to a bound declared in the theme, not to the live artboard
   resolution.** Artboard resolution moves — `§53` fit modes and the device-lens
   work were about a theme rendering at different shapes. A crop baked to today's
   artboard is silently wrong after an artboard edit, and re-normalizing costs a
   generation. Preserve the source aspect and let the scene do the framing: the
   background layer covers, crops and zooms the whole frame at render time
   (`decisions/0095`), so the normalizer never bakes a crop. The `cover` / `Fill
   the artboard` press is withdrawn — it threw away the pixels a later pan has to
   move through, and it upscaled small sources to the cap.
2. **Verify by probe; never re-encode to validate.** CI cannot re-encode
   deterministically across ffmpeg versions. The author normalizes locally and
   the store **probes** the result against the envelope, rejecting out-of-bounds
   input before anything is revived — a property check, not a byte derivation.
   These caps are the **store boundary**, not an import-time gate: a locally
   imported or saved theme, and the display publish route, may hold a video the
   store would refuse. The two store doors (the Worker's submit validation,
   install) are where it is refused.
3. **Idempotent pass-through.** A file already inside the envelope is copied
   byte-for-byte. Otherwise every resubmission degrades the loop.
4. **The author previews the normalized asset, not the master.** Write it as an
   explicit derived asset in the theme folder — not a silent folder↔package sync,
   which `0017` forbids.

**How the normalizer gets ffmpeg is an open decision**, and it is a licence
question rather than a footnote: a system `ffmpeg` probed at runtime adds no
shipped dependency but requires the author to install it; a bundled static build
is convenient but carries GPL parts such as x264, which pulls in
`THIRD-PARTY-NOTICES.md` and packaging obligations. Leaning: probe and refuse.

## The rename, which still lands alone

`publish` currently means *editor → host, so the paired phone or display shows
it* (`POST /api/publish`, `/api/published`, `publish.surface`,
`publishableDocument`, `publish-loop.spec.ts`). Two different acts sharing one
word is the problem, and the owner's ruling of 2026-10-12 is that the existing
route is renamed rather than the store finding a second word: **publish** — an
author sends an item to the store; **submission** — a publish from an unverified
author, awaiting review; **listed** — passed review and in the catalogue.

The replacement word is **still not decided**: `activate` collides with
keyboard-activating a focused control in `viewport-manager/navigation.ts`, and
`cast` and `go live` are the clear candidates. The rename is a family — the
route, the `published` store in `server.ts`, its revision accessor, the
`publish.surface` chord and `publish-loop.spec.ts` — and it touches
`host/src/server.ts`, a watched path, so it needs its own decision note.

**It is not on this work's critical path**, which is why it stays a prerequisite
that can land alone rather than a phase below. The one thing it must not do is
land *after* submission ships, because then the store owns a word the route
already uses.

The three-mode top bar was the second prerequisite. The rulings above fold it
into this document, so it is now § "The shell" and the first phase below rather
than a spec of its own.

## Landing order

Per-display assignment first — its own spec and plan, per ruling 6 — then this
document's plan, in phases that are each useful on their own:

| Phase | Lands | Needs |
|---|---|---|
| **A** | the three-mode shell; the store mode's local half as a gallery, with the facet record, the facet row, paging and the item modal; and the Host settings mode absorbing this PC | the per-display spec's assign action; `shell-layout.tsx`'s decision note |
| **B** | the origin record and the *Installed* badge | A |
| **C** | the online tab, read-only: the catalogue repo exists, `index.json` is generated with each item's derived facet record, browse, filter and sort work, and the item modal gains its online facts | a public repo and one Action; the raw path for `index.json` and the CDN for thumbnails (§ "Measured 2026-10-21"); **not** open question 1 |
| **D** | install: download, validate, write to the library, record the origin | C, and **open question 1 decided** — with the `download_count` probe run, since which URL `item.json` records and whether the store can count downloads both fall out of that decision |
| **E** | submission: the device flow, the fork-and-PR client, CI validation and the auto-merge Action | D |
| **F** | the publish-time normalizer and the duration and resolution caps | E, and open question 2 |
| **G** | the style-tag field: the format's shape rule, the editor's pick-or-propose control, and the Style facet | A, and **open question 7** |

**A landed 2026-10-20.** Ten tasks, its boundary's four browser claims, a
whole-branch review and one fix round, closed with rulings R167–R171 in
`.superpowers/sdd/2026-10-18-theme-store/progress.md`. **B and G landed
2026-10-21** under `2026-10-21-theme-store-origin-and-style.md`.

**C's implementation landed 2026-10-21** under
`2026-10-21-theme-store-online-tab.md`: the index's wire shape and its parser in
`renderer-core`, the generator as a command on the host binary, the online source,
the cell's and the modal's catalogue facts, the listing with its join and its
refusal line, and five rendered claims against a routed index. **C is live
end to end**: the Action's first run generated `index.json` from the pinned
generator, and `https://raw.githubusercontent.com/peterng1618/yunari-store/main/index.json`
answers `200` with zero entries — the honest empty catalogue, since items arrive
with E. **E and F landed 2026-10-22.** The acceptance
below still decides whether A is accepted: landing is not acceptance.

**D's implementation landed 2026-10-22** under
`2026-10-21-theme-store-install.md`: the hosting probe and the option B ruling
below, ADR `0089` and the host's `downloadPackage`, `POST /api/themes/install`
with `installCatalogueItem`, the rule that only a **newer** catalogue version is
offered as *Update*, the editor's Install / Update / Installed control with its
announcements, and three rendered claims against routed fixtures. **The host
fetches the package and the browser never does**, because the release asset
sends no `access-control-allow-origin` on either hop — measured, not assumed.
The route is loopback only and now also refuses a `Host` that is not a loopback
name, which is the one check that covers a rebound DNS name. Every browser claim
is against a routed fixture: the real catalogue stays empty until E.

**E's implementation landed 2026-10-22** under `2026-10-22-theme-store-submission.md`:
GitHub's device flow as one client with the token in the settings directory at
`0600` and never in the browser, a hand-rolled fork-then-PR client whose target
path is derived from the store's own validated id, `validate-item` as a command
CI runs, the catalogue repo's `validate` and `auto-merge` workflows, and the
editor's Submit control on a library theme. **A whole-branch review found the
auto-merge gate was not a gate** — an unverified author's PR would have merged —
and the fix round closed it along with the ownership rule and a `packageUrl`
check that accepted any host. **The workflow's refusals are proved on the real
repo; the unverified-author arm is not**, because it needs a second account.

**F's implementation landed 2026-10-22** under `2026-10-22-theme-store-media.md`:
the video envelope as a **property check** — a pure MP4 box parse in
`theme-package` that reads duration, dimensions, frame rate, codec, profile,
chroma, audio and `+faststart` without spawning anything — refused at all three
doors (`validate-item`, install, submit); and the normalizer as a host command
plus one loopback route, spawning the bundled `ffmpeg-static` (decision `0091`),
copying a conforming input byte-for-byte, and refusing a source over the cap
rather than trimming it. The editor offers `Normalize video` and `Fill the
artboard`, and adopts the result only on a second press after previewing it.
**The review's two high findings were bypasses of the caps themselves** — a
zeroed `mdhd` timescale and a doubled `mdhd` duration each let an over-cap video
read as compliant — now derived from the sample table and the larger of the two.
**`ffmpeg-static` is GPL-3.0-or-later**, so a packaged release owes its source
offer; that duty is recorded in `THIRD-PARTY-NOTICES.md` rather than discovered
at release time.

**A is the phase that answers ruling 1**, and it needs no catalogue, no token, no
`index.json` and no hosting decision. **C is the last phase that dodges open
question 1**; everything after it depends on where the bytes live, which is why
that question was D's first step rather than a footnote. It was decided on
2026-10-21, and D landed on that ruling.

**G is the one row out of order.** It needs only A, and it must land before C so
the first `index.json` the Action generates already carries tags, rather than the
record's shape changing inside C's window. It is lettered last because A–F are
already referred to by letter in the acceptance below and in the register.

## Open questions

Each needs a decision before implementation, and each is recorded with the shape
of the decision rather than a placeholder:

1. **Hosting the bytes — and the app-opened PR has made this sharper.**
   *Deferred by the user on 2026-10-15; the candidates and the new constraint are
   recorded here so the deferral is not a silence.* Release assets belong to one
   repository, and an author's app can only upload to **the author's own fork's**
   releases. Left there, every listed item would point into a stranger's fork:
   the author can delete it and break every item, removal cannot be enforced, and
   the store's own asset counter ceases to exist.
   - **A (leaning) — the fork carries the bytes during review; merging re-homes
     them.** The app uploads to the author's fork release, `item.json` references
     it, reviewers download from there, and a post-merge Action in the upstream
     repo downloads it, uploads it as an upstream release asset and rewrites the
     URL in a follow-up commit. Its advertised gain is a native `download_count`
     and store-owned bytes, **and the first of those is doubtful as of
     2026-10-21 — see the paragraph below the options**; what stands is that no
     secret ever reaches a fork PR. Costs one exception to "the PR
     diff is the review instrument" — the merged `item.json` is not byte-identical
     to the submitted one — and a video is downloaded twice (once at merge, once
     per user).
   - **B — the package rides in the catalogue repo beside `item.json`.** No
     releases and no re-homing, and the diff shows everything including the
     bytes. Costs up to 95 MiB per item in git history permanently, and GitHub
     exposes **no download count for repository files**, so "downloads" stops
     being a sort.
   - **C — an object store with signed uploads.** It is a server, which is the
     one premise this design rests on. Recorded only to be dismissed.

   **What the 2026-10-21 measurements do to this comparison, without deciding it.**
   Option A's two advertised properties are the ones that moved. "Keeps native
   `download_count`" is now doubtful rather than likely: the field sits on the
   *asset*, a re-upload creates a new one, and GitHub documents the field with no
   prose at all — so the store's counter would restart at the re-home while the
   fork's counter keeps the pre-merge downloads, and the probe that settles it is
   named in § "Measured 2026-10-21". And "no secret ever reaches a fork PR" is
   true but not sufficient: the upstream Action cannot read the fork with
   `GITHUB_TOKEN` at all, so the download is anonymous HTTPS against a URL the
   *author* controls and can repoint or delete, which is the fork-hosting problem
   arriving one step later rather than being solved. The re-home also has to be
   delete-then-upload (`422` on a name collision) and its follow-up commit starts
   no workflow, so nothing re-validates the rewritten URL. **Option B does not
   have those three problems and has one of its own**: 95 MiB in git history per
   item, against GitHub's own soft guidance of "ideally less than 1 GB" and "less
   than 5 GB is strongly recommended" per repository, and no download count for
   repository files. **Which is cheaper is a question about how big an item really
   is**, and that is now measurable rather than arguable: the caps in phase F
   bound the video, so the number to decide against is F's own bound rather than
   95 MiB. **DECIDED 2026-10-21: deferred to phase D's plan, with A still leaning.** The
   owner's ruling is that D's plan opens with the probe named above — whether `download_count`
   survives a re-home — and the choice is taken against that measurement rather than the doubt.

   **PROBED 2026-10-21, AND THE ANSWER IS B — the package rides in the catalogue
   repo beside `item.json`.** The probe the paragraph above names was run on a
   temporary public release: an asset that had recorded **3** downloads was
   deleted and the same bytes re-uploaded, and the new asset answered
   **`download_count: 0`**. The count lives on the asset row and a re-upload
   creates a new one, so A's counter restarts **at every re-home — that is, at
   every version**, which makes the downloads facet a per-version number at best
   and not the item's. That removes the gain A was leaning on and leaves A
   carrying only its costs: the pre-merge URL is one the author controls, the
   re-home is delete-then-upload with a window in which neither copy is the
   store's, and the follow-up commit that rewrites the URL starts no workflow, so
   nothing re-validates it. **B has none of those, and its one cost is bounded by
   a number this design already owns**: the reader refuses a package past
   `MAX_ARCHIVE_BYTES` (95 MiB), which sits under GitHub's per-file block, so
   **every package this product will accept is a file the catalogue repo can
   store** — no releases, no re-home Action, no LFS. What B gives up is a
   download counter, and under the measured A that is per-version rather than per
   item. **Revisit when the catalogue repo passes about 1 GB** (GitHub's own soft
   guidance), which at a typical 25 MiB item is some forty revisions; the
   `packageUrl` an item carries is then the only thing that moves.

   Two further measurements from the same probe, because they shape phase D:
   **`download_count` is not readable within ten minutes** — four real downloads
   left it at `0` and it answered `1` only nine minutes later — and **a release
   asset sends no `access-control-allow-origin` on either hop** (the `302` to
   `release-assets.githubusercontent.com` and the asset itself), so a browser
   cannot download one at all.
2. **The ffmpeg source** — probe a system binary, or bundle a static build and
   take on the licence obligation. **Measured 2026-10-21: there is no `ffmpeg` on
   `PATH` on the development box at all**, so the probe arm refuses there and the
   normalizer would report "no encoder" to the author who is standing at the
   machine this product is built on. That is the probe arm's own cost rather than
   an argument against it — the refusal is honest and actionable, where a silent
   re-encode is not — but it does mean the fallback has to be designed: an author
   whose machine has no ffmpeg still has to be able to submit an item whose video
   is already inside the caps, and the caps are phase F's. Bundling is the other
   arm, and it owes `THIRD-PARTY-NOTICES.md` and a licence read before it is
   chosen rather than after. **DECIDED 2026-10-21: BUNDLE a static build.** No fallback has to
   be designed for an author whose machine holds no encoder. **The licence read this arm owes
   moves from a precondition of choosing it to a precondition of shipping it**, and it is the
   bundling configuration that decides GPL against LGPL — so phase F's plan carries that read,
   with `THIRD-PARTY-NOTICES.md` and `docs/engineering/dependencies.md`, before the dependency
   lands.
3. **`index.json` freshness — ANSWERED 2026-10-21, and the answer is the route
   rather than the Action.** Through jsDelivr a branch file is 12 hours stale at
   the edge and 7 days in the client's own cache, and purge does not apply to a
   static file at all; from the raw path the same file is 5 minutes old with an
   `ETag` a client can revalidate against. So `index.json` is fetched from the raw
   path and thumbnails from the CDN, and a favorite count is at most five minutes
   behind. The scheduled Action's cadence therefore becomes a cost question
   rather than a freshness one: hourly is already finer than any reader can
   observe, and the only reason to run it more often is a reaction that has to
   appear quickly.
4. **Moderation beyond the review gate** — the owner reading a diff catches a
   broken item; it does not catch objectionable imagery in a thumbnail or a
   background video. Who looks at the pixels, and when.
5. **Removal** — what happens to a listed item later withdrawn, and whether
   download counters survive it. The re-homing choice above changes this: if the
   bytes live on the store's own release, removal is enforceable; if they live on
   a fork, it is not.
6. **The two addenda** — a widget-preset package and an editor-theme artifact,
   each settled before its kind reaches the store. The editor theme's is a design
   question (what a token artifact is), and the widget preset's is a sequencing
   question (§139 waits on an authoring workflow).
7. **The shipped seed vocabulary** — which tags the editor offers before it has
   ever seen the catalogue. The ruling of 2026-10-17 fixed the mechanism and the
   *online* vocabulary (it is the catalogue's own content, so it needs no separate
   list), and the user's own examples (`futuristic`, `retro`, `modern`, `elegant`,
   `classic`, `nature`, `cityscape`) are the seed rather than the answer. It matters
   because an author working offline has nothing else to pick from, and because the
   seed is what the first proposals are measured against. Phase G carries this
   question rather than shipping the field with an empty list.
8. **The aspect-ratio buckets and their tolerance — MEASURED 2026-10-21, and the
   measurement found a defect rather than confirming the draft.** The tolerance is
   no longer unmeasured: the bound is the tightest half-gap between two adjacent
   buckets, which is 3.2% (3:2 against 16:10), and the largest distance any theme
   this product has actually produced sits at is 0.05% (a 1672×941 artboard, 16:9
   to five decimal places). So any tolerance between about 0.1% and 3% behaves
   identically on every theme that exists, and the shipped 0.5% is inside it.
   **The set is the half that is wrong**: 19.5:9 — the ratio this product's own
   chooser offers for the phone workflow, `artboard-presets.ts:14-21`, at
   2340×1080 — is **7.4%** from its nearest published bucket, against a 0.5%
   tolerance, so a phone-shaped dashboard is filed as `other`. No tolerance can
   rescue it, because the tolerance exists to keep a 2.35:1 artboard out of 21:9
   and that artboard is only 0.71% away: any tolerance wide enough to take the
   phone swallows the case the number was chosen for. **So the set gains a
   bucket** rather than the tolerance gaining a digit, and 1920×480 (4:1, the
   TURZX panel's own shape, 11.8% from 32:9) is the second case that has to be
   decided with the work that needs it rather than fallen into. Filed as `vg-673`,
   issue 50, because it changes a published vocabulary and belongs with a
   decision; the shipped set is `facet-record.ts:65-87`, which is where the fix
   lands. **DECIDED 2026-10-21: add BOTH — 19.5:9 and 4:1 — and make the set easy to
   extend.** The phone shape this product's own chooser offers and the panel's 4:1 strip are
   settled together rather than the second waiting on the panel work; and the owner requires a
   ratio to be addable **as an entry beside the others rather than as a revisit of the rule**, so
   the set stays data beside `aspectOf` and adding a bucket is one entry plus its label — not a
   change to the tolerance logic.

## Measured 2026-10-21

Free-tier limits decide feasibility, so each of these was a probe rather than an
assumption. Five are answered — from the platform's own documentation, or from a
header read on this box — and one remains a probe because it needs a repository
and a fork to run against. **Two of the answers contradict what this document
assumed**, and they are the reason option A in open question 1 is no longer the
obvious leaning.

- **The device flow against a public client.** `public_repo` is the scope, and it
  is grantable through the device flow: the request takes a `scope` parameter and
  needs no client secret, which is the property that makes the flow usable by a
  locally-run host at all. An OAuth App's tokens are **non-expiring by default**;
  expiring tokens are opted into per app, and with them on (or with
  `offline_access` asked for) the access token lasts **8 hours** and the refresh
  token **6 months without use**, rotating on every use so the previous pair dies.
  A GitHub App's user tokens *always* expire in 8 hours with the same 6-month
  refresh, which is the heavier credential for the same act — so the OAuth App is
  the fit, and the app has to have the device flow switched on in its settings.
  **What is not documented is the scope-to-endpoint mapping**: that forking a
  public repo and opening a PR need `public_repo` is read off the scope's own
  description, because the REST pages list fine-grained permissions and no OAuth
  scopes at all. The README owes that step, not this document.
- **Release assets, as a ceiling.** 2 GiB per file, 1000 per release, and "no
  limit on the total size of a release, nor bandwidth usage". A 95 MiB item is
  two orders of magnitude inside the file limit, so the reason to doubt release
  assets was never their size.
- **The re-home, which is now option A's weakest link.** Three of its premises are
  documented and none holds as written. (i) `GITHUB_TOKEN`'s "permissions are
  limited to the repository that contains your workflow", so the upstream Action
  **cannot** read the fork with it — the download has to be anonymous HTTPS
  against `browser_download_url`, which the API does document as usable
  unauthenticated for public resources. (ii) A commit made by `GITHUB_TOKEN`
  **does not create a new workflow run**, so the follow-up commit that rewrites
  the URL is re-validated by nothing. (iii) Re-uploading an asset whose file name
  already exists fails `422` until the old asset is deleted, so the re-home is
  delete-then-upload and has a window in which neither copy is the store's.
  **What is still a probe**: whether `download_count` survives the move. The REST
  schema documents the field with no prose at all, and the field sits on the
  *asset*, which a re-upload creates anew — so the honest reading is that the
  store's count restarts at the re-home, and the fork's count is the one holding
  the pre-merge downloads. The probe is a public test repo, one asset, a counted
  download through `browser_download_url`, then a delete and a re-upload of the
  same bytes.
- **The CDN, which cannot carry a package at all.** jsDelivr's GitHub path refuses
  "single files larger than 20 MB", so `index.json` and thumbnails fit and an item
  never does. It also sets the floor on freshness, which is open question 3: a
  branch URL answers `cache-control: public, max-age=604800, s-maxage=43200` —
  read on this box 2026-10-21, with an `Age` of 6.6 hours on the response — so
  **12 hours at the edge and 7 days in the client's own cache**, and purge "will
  not work for static files", needs valid semver and is granted by email. GitHub
  Pages is no better for the job: a published site "may be no larger than 1 GB"
  against a soft 100 GB per month, which is about a thousand downloads of one
  95 MiB item.
- **Actions minutes are not the constraint.** "GitHub Actions usage is free for
  self-hosted runners and for public repositories that use standard GitHub-hosted
  runners" — not the word *unlimited*, but with no public-repo quota stated
  anywhere. What binds instead is plan-independent: 6 hours per job, 35 days per
  workflow run, a 10 GB cache per repository, 20 concurrent jobs on Free, and a
  default 90-day artifact retention that is configurable for a public repo.
- **The raw path is what serves `index.json`, and it is a 5-minute cache.**
  `raw.githubusercontent.com` answers `cache-control: max-age=300` with an `ETag`
  and `access-control-allow-origin: *`, so a client can revalidate conditionally
  and see a regeneration within five minutes — which is *faster* than jsDelivr's
  twelve hours and the reason the two files take two different routes. Its rate
  limit is **not documented** by GitHub at all; the only figure is a staff comment
  on a closed documentation issue. That is a probe if the catalogue ever gets
  popular enough for it to matter, and it is named rather than assumed away.

- ~~Whether `requestVideoFrameCallback` cadence actually suffers under a variable
  frame rate in this renderer, or whether the envelope rule above is defensive
  without a measured reason.~~ **Measured 2026-10-20, and it does.** The clip the
  user reported the glass defect from — 3.533 s, 2340×1080, a screen recording —
  is itself variable: **684 presented frames over 20.0 s carry 189 distinct
  media-time intervals**, from **11 ms to 88 ms**, median 24.9 ms, and the most
  common interval occurs 11 times out of 683, so there is no dominant rate.
  `getVideoPlaybackQuality()` reports **104 of 913 frames dropped** (11%), and
  `presentedFrames` advances in gaps of 1, 2 and 3, so the callback coalesces as
  well as varies. `background-media.ts`'s `followFrames` repaints once per
  callback, so that variance *is* the repaint rate — **the envelope rule is not
  defensive without a reason.** The same clip also sits outside the proposed
  envelope on both counts (≈46 fps against ≤30, 2340 against 1920), which makes it
  the shape the normalizer exists for. Probe: `C:\tmp\glass-proof\cadence.ts`,
  desktop Chromium, outside the repo; the wrap shows as the one negative delta
  (`mediaTime` returning to 0).

## The repo's own gates still apply

- `AGENTS.md`'s reuse gate: all seven rungs (owner, dependencies, platform,
  ecosystem, comparison, probe, build) recorded before the first write, at
  `docs/decisions/NNNN-<slug>.md`. **The hydra-themes study is rung 5's evidence
  for the theme half and only for that** — it is one ecosystem comparison of a
  store over a git host, and it covers a single kind with a CSS mechanism this
  product cannot use. Rungs 4–5 still have to be run for the submission mechanics
  the app-opened PR introduces (OAuth device flow, fork-and-PR from a desktop
  client), which the reference does not exercise at all.
- `host/src/server.ts` is a watched path in `scripts/reuse-gate.mjs`, so a
  decision note must claim it before the first edit there.
- **The facet record and the tag vocabulary land under a watched path too.**
  `renderer-core/src/theme/` is on the same watchlist, so each of them owes its own
  decision note with all seven rungs worked before the first write there — and the
  facet derivation is the one that needs rungs 4–5 honestly, because "derive a
  theme's facets from its envelope" is a shape other products have solved and the
  note has to say what was searched rather than that nothing was found.
- **§5 grows one control, and that is a DESIGN.md change in the same commit.** A
  checkbox choice row is absent from the closed vocabulary — rule 7 describes a
  radio group — so it is added there rather than exempted locally. Nothing else
  this adds is new vocabulary: the facet button, the cell, the pager and the
  per-page well are compositions of what §5 already names.
- **The rename can still land alone.** The top bar no longer can: the rulings
  above fold it into this document, so it is the first phase rather than a
  prerequisite that ships separately.
- **The drawings are part of this design, not decoration.** The store mode, the
  Host settings mode and the bar are new surfaces, so the checked set at
  `docs/design/mockups/current/` gains a file per new view, `shell.html` is
  redrawn because the bar changes its header and rail, and the README's table and
  count move with them. **Rulings 7 to 9 redraw the store mode's two files a second
  time**, from rows to a gallery with the facet row and the pager, because a drawing
  that still shows the list is a drawing of a surface this document no longer
  specifies — and they add two more files, because a popover and a modal are views
  no other file can carry. Four files, one view each. Three rules bind that work rather than being discovered
  during it: **every new drawing is read by something** — the drawings gate walks
  the directory (`currentDrawings()`), so a new file is held to §3's spacing, §2's
  type, the radius table, the elevation levels and the 1px hairline rule the moment
  it exists, without being registered anywhere; `mockup-values.ts`'s path constants
  and `PARITY` rows are the *second*, narrower reading, for a drawing whose values
  must match the built product rather than only obey the scales; **the copy is the
  product's own**, taken string by string
  from `ui-copy.ts`, so a new surface's words are decided here and land in
  `ui-copy.ts` in the same change as its drawing — the facet labels, the pager's
  words and the empty state are this design's own new strings; and **one drawn view
  per file**, because the reader's `[style*="…"]` selector refuses to settle
  between two elements carrying the same declaration. The pending settings-pane
  redraw touches the same set, and neither change may be written as if the other
  does not exist.
- One implementation plan is active at a time. When this is picked up it becomes
  a plan that queues behind whatever `STATUS.md` names that day.

## Acceptance

The spec is accepted when the user says so. **The work is accepted per phase**,
each on its own phase gate, and each item below is something a person can see:

- **A** — the top bar switches between the three modes; the local half is a gallery
  whose cells show a picture, a name and an author; the facet row narrows it by
  author, colour mode, sensors and shape, a theme that binds nothing is matched by no
  sensor, and a theme with no derivable ground or an unbucketed ratio is still
  reachable under "any" and "Other"; paging holds, its numbers show the pages
  nearest the current one, and the page size a viewer chose is still theirs after a
  reload while a filter is not; a cell opens the item's modal, which contains the
  theme in a fixed preview stage and closes back onto the same page, filter and
  sort; a package imported from a file appears in that list and survives closing the
  editor; a theme is assigned to a display from its cell; the local half reads items
  through a kind's own source rather than through `ThemeStore` directly, so a second
  kind is a second source and not a rewrite of the tab; switching modes with an
  unsaved document loses nothing; the grid is checked at 1280×720, 1440×900 and 200%
  zoom with every facet still reachable; and `settings.html` no longer lists themes
  while `/settings` still works in a plain browser — the chooser is `library.html`
  **served at `/`**, not a `/library` route, which is the fact A.10's brief got wrong
  and R161 corrected.
- **B** — a theme installed from a catalogue item reads *Installed*, and the mark
  survives a restart because it is read from the origin record rather than held in
  the session.
- **C** — the online half lists the catalogue's items with their kind, counts and
  dates, and the same facets filter and sort them; an item's facets are the ones
  derived from its merged `theme.json`, not fields an author wrote into
  `item.json`; the modal shows its counts and its installed state; and an item whose
  `kind` this build does not know is skipped with the reason shown rather than
  breaking the listing.
- **D** — Install puts a working theme in the library and records its origin, and
  the item then reads *Installed*; a package that fails §141 is refused with the
  reason and the library is unchanged.
- **E** — an author with a GitHub account submits a theme from the library and the
  PR appears; an unverified author's PR waits for review; a verified author's own
  PR auto-merges only when validation is green *and* the diff touches only their
  own `catalogue/<id>/` path.
- **F** — a video past the duration or resolution bound is refused before
  submission with the bound named, and one inside it is copied byte-for-byte on a
  second run.
- **G** — an author picks a tag from the ones that exist; a tag that is not in the
  vocabulary can only be proposed deliberately, and the submission carries the
  proposal and the theme that uses it in one diff; the tag is lowercase and the
  format refuses one that is not, refuses a sixth, and accepts a tag the vocabulary
  has never seen; the Style facet counts it; and a build older than this one refuses
  a tagged theme as an unknown field rather than reporting it as corrupt.

**What closing `vg-388` means, and the conflict this settles.** Phase 24 of the
backlog drain says `vg-388` closes when the store "carries all three kinds as
specified rather than the theme half alone", and v1 cannot satisfy that: it ships
the dashboard theme, with the widget preset and the editor theme as addenda. So
the row's closure condition is **the storefront plus the dashboard theme**, and
the two addenda become rows of their own. The plan's acceptance line and its
failure-mode line are the text that must move with it; leaving them is how a row
stays open against work that is done.
