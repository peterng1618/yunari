import { Fragment } from "react";
import { ControlTooltip } from "../../editor-shell/controls/tooltip.js";
import {
  CARD_UNIT_FALLBACK_GLYPH,
  CARD_UNIT_GLYPHS,
  Glyph,
  KIND_GLYPHS,
  SHAPE_GLYPHS,
} from "../../editor-shell/icons.js";
import type { InsertableObject, InsertGroup } from "../../new-object-panel.js";
import { chartFamilyGlyph } from "../composition/kind-mark.js";
import { PathGlyph } from "./path-glyph.js";

/**
 * The Add pane's body: `insertGroups()`, drawn as tiles.
 *
 * **The list is not re-derived here.** The pane renders the groups it is given,
 * in the order it is given them, and the shape of the surface follows from that
 * alone: Cards, then Text (which the owner leaves ungrouped), then Basic Shape,
 * Custom Shape, then Charts. A group added to the owner appears here the day it
 * is added, and one this pane invented could not be reached at all — the
 * construction routes back through the owner's own `insertObject`, which is what
 * keeps the eligibility gates and the refusals in one place.
 *
 * **Every tile wears the chrome vocabulary's own glyph** (`icons.ts`), so there
 * is no second drawing anywhere for a tile and a row to drift apart in. A card
 * unit's glyph is keyed by its own id (`CARD_UNIT_GLYPHS`), with one fallback
 * mark for an id this build does not know; a primitive's is its kind. A card on the canvas is still arbitrary, so nothing
 * here licenses a diagram in the layer tree.
 *
 * The element contracts the imperative panel carried are on the tile's own
 * button: `data-yunari-panel-add="<shape>"` and
 * `data-yunari-panel-card="<card id>"`. `data-yunari-panel="add"` is the
 * pane's, written by `Pane`, and is deliberately not written again here.
 *
 * A group is scoped by `data-yunari-add-group="<id>"` — the group's own
 * identity, never the heading above it, which is copy an author reads and a
 * copy change moves. Basic and custom shapes are separate scopes.
 */
export function AddPane({
  groups,
  onInsert,
}: {
  readonly groups: readonly InsertGroup[];
  readonly onInsert: (object: InsertableObject) => void;
}): React.JSX.Element {
  return (
    <>
      {groups.map((group) => {
        const tiles = group.objects.map((object) => (
          <InsertTile
            key={tileKey(object)}
            object={object}
            onInsert={onInsert}
          />
        ));
        // An object that stands on its own keeps its place in the owner's order
        // and carries no heading: it is not a group of one, and an eyebrow over
        // a single row would say a region exists where there is one thing. Its
        // key is derived from the owner's own objects, so two standalone groups
        // could not collide with one another whatever the owner emits.
        if (group.label === undefined) {
          return (
            <Fragment key={group.objects.map(tileKey).join(" ")}>
              {tiles}
            </Fragment>
          );
        }
        return (
          <fieldset
            key={group.label}
            className="yunari-add-group"
            data-yunari-add-group={group.id}
          >
            <legend className="yunari-add-eyebrow">{group.label}</legend>
            <div className="yunari-add-grid">{tiles}</div>
          </fieldset>
        );
      })}
    </>
  );
}

/** One tile: the glyph, the name where a glyph alone would not say it, and the
 *  contract the surface is browsed by. */
function InsertTile({
  object,
  onInsert,
}: {
  readonly object: InsertableObject;
  readonly onInsert: (object: InsertableObject) => void;
}): React.JSX.Element {
  // A card's and Text's names are on the tile; a shape's and a chart family's
  // are not. The *disclosure* follows the surface rather than the label's
  // presence, because a grid tile's label can clip — "Performance trends" is
  // 86px of text in a 41px box — and the tile that truncates is exactly the one
  // that must still be able to say its whole name. The Text row is exempt:
  // it is full width, so its name never clips and a tooltip would repeat a word
  // already on screen.
  const named = object.kind === "card" || object.kind === "text";
  const disclosed = object.kind !== "text";
  const button = (
    <button
      type="button"
      className={object.kind === "text" ? "yunari-add-text" : "yunari-add-tile"}
      aria-label={object.label}
      {...(object.kind === "shape"
        ? { "data-yunari-panel-add": object.shape }
        : {})}
      {...(object.kind === "card"
        ? { "data-yunari-panel-card": object.card }
        : {})}
      onClick={() => onInsert(object)}
    >
      {tileMark(object)}
      {named ? <span className="yunari-add-label">{object.label}</span> : null}
    </button>
  );

  return disclosed ? (
    <ControlTooltip label={object.label}>{button}</ControlTooltip>
  ) : (
    button
  );
}

/** What the tile draws: a unit's glyph, a primitive's kind, a family's glyph.
 *
 * **Every mark is the chrome vocabulary's own** (`icons.ts`), the same map the
 * layer row's mark reads, so a unit's tile and its row agree by construction
 * rather than by being copied — and there is no second drawing anywhere for the
 * two to drift apart in. Lucide has no `wedge` or `arc`, and the approximation
 * each takes lives once, in that map, beside the reason for it.
 */
function tileMark(object: InsertableObject): React.JSX.Element {
  switch (object.kind) {
    case "card":
      return (
        <Glyph
          icon={CARD_UNIT_GLYPHS[object.diagram] ?? CARD_UNIT_FALLBACK_GLYPH}
          size={20}
        />
      );
    case "shape":
      return object.path === undefined ? (
        <Glyph
          icon={SHAPE_GLYPHS[object.shape as keyof typeof SHAPE_GLYPHS]}
          size={20}
        />
      ) : (
        <PathGlyph data={object.path.data} paint={object.path.paint} />
      );
    case "chart":
      return <Glyph icon={chartFamilyGlyph(object.family)} size={20} />;
    case "text":
      return <Glyph icon={KIND_GLYPHS.text} size={20} />;
  }
}

/** Keys are unique within one group's list, which is all React asks: the card
 *  ids, the shape kinds and the chart families never repeat inside a group. */
function tileKey(object: InsertableObject): string {
  switch (object.kind) {
    case "card":
      return `card:${object.card}`;
    case "shape":
      return `shape:${object.shape}`;
    case "chart":
      return `chart:${object.family}`;
    case "text":
      return "text";
  }
}
