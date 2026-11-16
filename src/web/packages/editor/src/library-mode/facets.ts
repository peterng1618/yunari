import {
  type SemanticFamily,
  semanticKeysByFamily,
} from "@yunari/renderer-core";
import type { StoreItem } from "../store-mode/local-source.js";
import { uiCopy } from "../ui-copy.js";
import type { Facet, FacetOption } from "./facet-row.js";

/**
 * The five facets, read off the rows' own records.
 *
 * One builder serves every Library page: a row's record carries the author,
 * colour mode, sensors, shape and tags, and a page whose rows carry none of a
 * reading is simply offered no value in that facet. Nothing here reads which
 * page is drawn, so the toolbar cannot answer one page differently from
 * another.
 */

/**
 * One facet's options, read off the items rather than invented here: each item
 * contributes the readings it carries, an option's count is how many items carry
 * it, and the value a person chooses is the reading itself — the author string,
 * the colour mode, the sensor's `key`, the ratio, the size.
 *
 * **Ordered by how much is behind each value, then by name**, so the biggest
 * group is where a person looks first and the order does not move while the
 * listing does not. The order is derived from the whole listing and never from
 * the filtered one: an option that vanished as it was chosen could not be
 * unchosen.
 *
 * **A reading may name the group it belongs to**, and this keeps it: the
 * grouping is the caller's, because only the caller knows what the values are
 * grouped *by*. Runs of one group are the caller's to keep together — the sort
 * here is within what it is handed, and the sensor and shape builders each call
 * it once per group so the count order cannot interleave two headings.
 */
function optionsFrom(
  items: readonly StoreItem[],
  readings: (item: StoreItem) => readonly {
    readonly id: string;
    readonly name: string;
    readonly group?: string;
    /** Set where the name is a `uiCopy` word rather than a listing reading. */
    readonly nameIsCopy?: boolean;
  }[],
): readonly FacetOption[] {
  const found = new Map<
    string,
    { name: string; count: number; group?: string; nameIsCopy?: boolean }
  >();
  for (const item of items) {
    for (const reading of readings(item)) {
      const seen = found.get(reading.id);
      if (seen === undefined) {
        found.set(reading.id, {
          name: reading.name,
          count: 1,
          ...(reading.group === undefined ? {} : { group: reading.group }),
          ...(reading.nameIsCopy === true ? { nameIsCopy: true } : {}),
        });
      } else {
        seen.count += 1;
      }
    }
  }
  return [...found.entries()]
    .map(([id, { name, count, group, nameIsCopy }]) => ({
      id,
      name,
      count,
      ...(group === undefined ? {} : { group }),
      ...(nameIsCopy === true ? { nameIsCopy: true } : {}),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** The two colour modes a person can ask for. `unclassified` is not one of them
 *  (R117, R122): a row that carries it is reachable under "any" and under no
 *  other value, so a chip for it would be a selection that matches nothing. */
function colourModeOptions(
  items: readonly StoreItem[],
): readonly FacetOption[] {
  return optionsFrom(
    items.filter((item) => item.facets.colourMode !== "unclassified"),
    (item) => {
      const mode = item.facets.colourMode;
      return mode === "unclassified"
        ? []
        : [
            {
              id: mode,
              name: uiCopy.store.colourModes[mode],
              nameIsCopy: true,
            },
          ];
    },
  );
}

/** The sensors the rows bind, labelled by the record's own `label` — the
 *  descriptor's word and not the `key` the selection carries — and **grouped by
 *  the family the vocabulary already files each key under**, which is one
 *  grouping rather than a second reading of the key here.
 *
 *  **One pass per family, so the count order cannot interleave two headings**,
 *  and the families come in the vocabulary's own order
 *  (`semanticKeysByFamily`) rather than in a list of their own that would have
 *  to be kept in step with it.
 *
 *  A key this build does not know carries no family, so it is offered under no
 *  heading and last: an invented heading would be a word for something nothing
 *  declared. */
const familyWord = (family: string): string | undefined =>
  (uiCopy.store.facets.sensorFamilies as Readonly<Record<string, string>>)[
    family
  ];

function sensorOptions(items: readonly StoreItem[]): readonly FacetOption[] {
  const readingsOf =
    (family: SemanticFamily | undefined) =>
    (
      item: StoreItem,
    ): readonly {
      readonly id: string;
      readonly name: string;
      readonly group?: string;
    }[] =>
      item.facets.sensors
        .filter((sensor) => sensor.family === family)
        .map((sensor) => {
          // `family` is an open string now, so a provider-contributed family has
          // no word here yet; it is drawn under no heading rather than invented.
          const group = family === undefined ? undefined : familyWord(family);

          return {
            id: sensor.key,
            name: sensor.label,
            ...(group === undefined ? {} : { group }),
          };
        });

  return [
    ...[...semanticKeysByFamily().keys()].flatMap((family) =>
      optionsFrom(items, readingsOf(family)),
    ),
    ...optionsFrom(items, readingsOf(undefined)),
  ];
}

/** The three shape groups the Shape popover offers, in its own order: the
 *  orientation words, the aspect buckets, and the exact sizes — each run under
 *  its own heading, because the three are AND with each other (R115) and a flat
 *  list is what hides it. */
function shapeOptions(items: readonly StoreItem[]): readonly FacetOption[] {
  const headings = uiCopy.store.facets.shapeGroups;
  const orientations = optionsFrom(items, (item) => [
    {
      id: item.facets.orientation,
      name: uiCopy.store.orientations[item.facets.orientation],
      group: headings.orientation,
      nameIsCopy: true,
    },
  ]);
  const buckets = optionsFrom(items, (item) => [
    {
      id: item.facets.aspect,
      name:
        item.facets.aspect === "other"
          ? uiCopy.store.otherShape
          : item.facets.aspect,
      group: headings.aspect,
      // A ratio is the record's reading; only the word standing in for the
      // shapes no bucket names is the table's.
      ...(item.facets.aspect === "other" ? { nameIsCopy: true } : {}),
    },
  ]);
  return [...orientations, ...buckets, ...sizeOptions(items)];
}

/**
 * The style tags the rows carry, **each offered however few carry it**: a tag
 * one row declares is still a value, where a size one row declares is not — an
 * item nothing can filter to is the item the facet exists to find.
 *
 * `optionsFrom` counts them in a `Map`, which is what makes a tag that names a
 * prototype member (`constructor` is well-formed) read as itself.
 */
function styleOptions(items: readonly StoreItem[]): readonly FacetOption[] {
  return optionsFrom(items, (item) =>
    item.facets.tags.map((tag) => ({ id: tag, name: tag })),
  );
}

/**
 * The sizes the facet offers: **those more than one row declares**, largest
 * first. A size exactly one row declares is an item wearing a filter's clothes,
 * and every other size is reachable under `Other`; the exact size is on the
 * item's own modal either way, which is what makes that acceptable.
 */
function sizeOptions(items: readonly StoreItem[]): readonly FacetOption[] {
  const counts = new Map<
    string,
    { width: number; height: number; count: number }
  >();
  for (const item of items) {
    const { width, height } = item.facets;
    const id = `${width}x${height}`;
    const seen = counts.get(id);
    if (seen === undefined) counts.set(id, { width, height, count: 1 });
    else seen.count += 1;
  }
  return [...counts.entries()]
    .filter(([, size]) => size.count > 1)
    .map(([id, size]) => ({
      id,
      name: uiCopy.store.size(size.width, size.height),
      count: size.count,
      group: uiCopy.store.facets.shapeGroups.size,
      area: size.width * size.height,
      width: size.width,
    }))
    .sort((a, b) => b.area - a.area || b.width - a.width)
    .map(({ id, name, count, group }) => ({ id, name, count, group }));
}

/**
 * The five facets, in the toolbar's order, with the values the rows carry.
 *
 * **Style's values are the documents' own tags**, and its facet is drawn with
 * none where no row declares one — which is what a library of untagged themes
 * looks like rather than a facet that cannot filter.
 *
 * **The four value facets are searchable; Colour mode is not.** At most two
 * modes exist, so a field over them can only hide a choice. Colour mode instead
 * carries the sentence a listing with no classified ground says in place of the
 * values it cannot offer.
 */
export function listingFacets(items: readonly StoreItem[]): readonly Facet[] {
  return [
    {
      id: "author",
      name: uiCopy.store.facets.author,
      searchable: true,
      options: optionsFrom(items, (item) =>
        item.author === undefined
          ? []
          : [{ id: item.author, name: item.author }],
      ),
    },
    {
      id: "colour-mode",
      name: uiCopy.store.facets.colourMode,
      empty: uiCopy.store.facets.colourModeEmpty,
      options: colourModeOptions(items),
    },
    {
      id: "sensors",
      name: uiCopy.store.facets.sensors,
      searchable: true,
      options: sensorOptions(items),
    },
    {
      id: "shape",
      name: uiCopy.store.facets.shape,
      // Its own sentence, above the three groups it explains: a listing must
      // match every group, which is what makes the headings worth drawing.
      hint: uiCopy.store.facets.shapeHint,
      searchable: true,
      options: shapeOptions(items),
    },
    {
      id: "style",
      name: uiCopy.store.facets.style,
      searchable: true,
      options: styleOptions(items),
    },
  ];
}
