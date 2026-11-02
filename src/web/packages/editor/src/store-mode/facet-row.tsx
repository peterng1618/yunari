import { Checkbox } from "@base-ui/react/checkbox";
import { Popover } from "@base-ui/react/popover";
import type * as React from "react";
import { useState } from "react";
import { optionRuns } from "../components/ui/control-select.js";
import { ControlWell, wellClasses } from "../components/ui/control-well.js";
import { CHECK_GLYPH, Glyph } from "../editor-shell/icons.js";
import { uiCopy } from "../ui-copy.js";
import type { FacetSelection } from "./local-source.js";

/** One value a facet offers: what it is called, how many themes carry it, and
 *  **the group it is filed under**, where the surface draws one. The group is
 *  the same kind of value `ControlOption.group` is, and the runs are read the
 *  same way (`control-select.tsx`). */
export interface FacetOption {
  readonly id: string;
  readonly name: string;
  readonly count: number;
  readonly group?: string;
  /** Whether `name` is a word from `uiCopy` rather than a reading from the
   *  library. The copy net skips facet rows wholesale because most names are
   *  data — an author, a sensor label, a ratio — so a name that *is* copy
   *  declares itself on the span and is read like any other marked word. */
  readonly nameIsCopy?: boolean;
}

/** One facet of the row: its own name, the sentence its popover says above the
 *  options where the surface draws one, and the values it offers.
 *
 *  **`searchable` is the four value facets** — Author, Sensors, Shape and Style.
 *  Colour mode carries at most two values, and a search field over two choices
 *  is a field that can only hide one of them.
 *
 *  **`empty` is the facet's own sentence for a listing that offers it no
 *  values**, where silence would look like a control that failed to load. */
export interface Facet {
  readonly id: string;
  readonly name: string;
  readonly hint?: string;
  readonly searchable?: boolean;
  readonly empty?: string;
  readonly options: readonly FacetOption[];
}

/**
 * The selection with one value toggled in one facet, as a pure function.
 *
 * It is exported rather than living inside the row because the row holds no
 * state: the region owns the selection, and a test that mounts the row alone
 * needs the same rule rather than a second copy of it. An emptied facet keeps
 * its empty list rather than dropping the key, so "nothing chosen here" and "no
 * such facet" are not the same reading — `matchesFacets` treats both as "any",
 * and only one of them is a facet a person can see.
 */
export function toggleFacet(
  chosen: FacetSelection,
  facetId: string,
  optionId: string,
): FacetSelection {
  const picked = chosen[facetId] ?? [];
  return {
    ...chosen,
    [facetId]: picked.includes(optionId)
      ? picked.filter((id) => id !== optionId)
      : [...picked, optionId],
  };
}

/** The ids one facet's controls carry, derived from the facet and the value the
 *  way `useControlIds` derives one from a control — the control-id rule wants every
 *  control to have one, and a facet's values are the record's, so the id cannot
 *  be minted from a counter that would move with the catalogue. */
const facetTriggerId = (facetId: string): string =>
  `yunari-store-facet-${facetId}`;

/**
 * One run of values, and the heading a grouped run takes over its rows.
 *
 * **The spacing belongs to the run and not to the grouping**: a facet whose
 * values are alternatives draws one run and a facet with groups draws three, and
 * a person reads both as the same list. The popup keeps its own gap for the
 * sentence above the runs.
 */
const RUN_CLASSES = "flex flex-col gap-[var(--space-4)]";

/** The eyebrow, over a run's rows. */
const RUN_HEADING_CLASSES =
  "px-[var(--space-8)] pt-[var(--space-6)] pb-[var(--space-4)] text-2xs font-semibold tracking-[0.11em] text-muted uppercase";

const facetOptionId = (facetId: string, optionId: string): string =>
  `${facetTriggerId(facetId)}-${optionId}`;

/**
 * The **well with chevron**, and its count: a facet's trigger says what it
 * filters by and how many values are chosen behind it, so the author reads what
 * the row is doing without opening five popovers.
 *
 * The count is only drawn when there is one. A facet with nothing chosen says
 * nothing rather than `0`, which the refusal rule forbids as a fabricated reading — and a
 * literal zero here would also be indistinguishable from a facet whose count
 * has not been derived yet.
 */
function FacetButton(props: {
  readonly facet: Facet;
  readonly chosen: readonly string[];
  readonly onToggle: (optionId: string) => void;
}): React.JSX.Element {
  const { facet, chosen, onToggle } = props;
  const count = chosen.length;
  const [query, setQuery] = useState("");
  const wanted = query.trim().toLowerCase();
  // **A chosen value stays reachable under any query.** A search that hid the
  // value a person already chose would leave it filtering the list with no way
  // to see or clear it from the popover it was chosen in.
  const visible = facet.options.filter(
    (option) =>
      wanted === "" ||
      chosen.includes(option.id) ||
      option.name.toLowerCase().includes(wanted),
  );
  const empty =
    facet.options.length === 0
      ? (facet.empty ?? uiCopy.store.facets.empty)
      : uiCopy.store.facets.noSearchMatches;

  return (
    <Popover.Root
      onOpenChange={(open) => {
        // The query belongs to one opening: reopening the popover is a fresh
        // look at the values, not the last search still narrowing them.
        if (!open) setQuery("");
      }}
    >
      {/* The trigger is the well the control set already draws, with the
          chevron `ControlSelect` puts in its own: one idiom for "opens a list".
          The open state raises the resting `--edge` to `--muted`, which is the control set
          rule 6's hover treatment on a control that carries a border — a
          pointer and a keyboard user see the same mark. */}
      <Popover.Trigger
        type="button"
        id={facetTriggerId(facet.id)}
        data-yunari-facet={facet.id}
        className={`${wellClasses("panel")} w-auto flex-none gap-[var(--space-6)] text-xs text-muted data-[popup-open]:border-muted data-[popup-open]:text-text`}
      >
        <span data-yunari-facet-name="">{facet.name}</span>
        {count === 0 ? null : (
          <span
            data-yunari-facet-count=""
            className="font-mono text-2xs text-muted"
          >
            {count}
          </span>
        )}
        <span aria-hidden className="flex-none text-2xs text-faint">
          ▼
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start" className="z-50">
          <Popover.Popup
            aria-label={facet.name}
            data-yunari-facet-popup={facet.id}
            className="flex max-h-[var(--available-height)] w-[16rem] flex-col gap-[var(--space-4)] overflow-y-auto rounded-xl border border-edge bg-[var(--shell-popover)] p-[var(--space-8)] shadow-[var(--elev-2)]"
          >
            {/* The sentence the surface puts above the groups, where the facet
                has one. It is the facet's own data rather than a Shape special
                case: what makes Shape's groups worth labelling is that every one
                of them has to hold, and a facet whose values are alternatives
                would say something else. */}
            {facet.hint === undefined ? null : (
              <p
                data-yunari-facet-hint=""
                className="px-[var(--space-8)] pt-[var(--space-4)] pb-[var(--space-8)] text-xs text-muted"
              >
                {facet.hint}
              </p>
            )}
            {/* The four value facets carry their own search. It narrows by the
                option's name and by nothing else: a query that reached a
                count or an id would hide values by facts the popover does not
                print. */}
            {facet.searchable === true ? (
              <ControlWell widthClassName="w-full flex-none">
                <input
                  type="search"
                  data-yunari-facet-search={facet.id}
                  aria-label={uiCopy.store.facets.search}
                  placeholder={uiCopy.store.facets.searchPlaceholder}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="h-full w-full bg-transparent text-sm text-text outline-none"
                />
              </ControlWell>
            ) : null}
            {/* **The groups are drawn, not flattened**: each run of values
                sharing a group takes the eyebrow as its
                heading, and a value filed under nothing — a sensor whose key
                this build does not know — is drawn under no heading rather than
                under an invented one. The runs come from the select's own
                rule, so the two lists cannot group differently.

                **One wrapper for both branches, so grouping adds a heading and
                not a gap.** The rows were direct children of the popup before
                the groups landed, which is where their spacing came from; two
                branches each carrying their own would disagree the moment one
                of them changed — as they did, drawing an ungrouped facet's rows
                flush against a grouped one's 4px.

                **A search filters the runs, it does not flatten them**: the
                groups that remain keep their headings, so a narrowed Shape
                still says its values are ANDed. */}
            {visible.length === 0 ? (
              <p
                data-yunari-facet-empty=""
                className="px-[var(--space-8)] py-[var(--space-4)] text-xs text-muted"
              >
                {empty}
              </p>
            ) : (
              optionRuns(visible).map((run) => (
                <span
                  key={run.group ?? "ungrouped"}
                  {...(run.group === undefined
                    ? {}
                    : {
                        role: "group" as const,
                        "aria-label": run.group,
                        "data-yunari-facet-group": run.group,
                      })}
                  className={RUN_CLASSES}
                >
                  {run.group === undefined ? null : (
                    <span className={RUN_HEADING_CLASSES}>{run.group}</span>
                  )}
                  {run.options.map((option) => (
                    <FacetOptionRow
                      key={option.id}
                      facet={facet}
                      option={option}
                      checked={chosen.includes(option.id)}
                      onToggle={() => onToggle(option.id)}
                    />
                  ))}
                </span>
              ))
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * The design's **checkbox choice row**: the choice row's geometry and its
 * chosen treatment, with a checkbox in place of the radio and no group owning
 * one checked bit — a facet is a set you may choose *several* of, which is why
 * The rule 7 (a radio in one labelled `radiogroup`) is not this control's shape.
 *
 * The row is the whole target, the box is decoration beside its own name, and
 * the count is the number of themes behind the value: the author chooses by how
 * much is there, which is the one thing a facet popover can say that a list of
 * names cannot.
 */
function FacetOptionRow(props: {
  readonly facet: Facet;
  readonly option: FacetOption;
  readonly checked: boolean;
  readonly onToggle: () => void;
}): React.JSX.Element {
  const { facet, option, checked, onToggle } = props;

  return (
    <Checkbox.Root
      nativeButton
      render={<button type="button" />}
      id={facetOptionId(facet.id, option.id)}
      data-yunari-facet-option={option.id}
      checked={checked}
      onCheckedChange={() => onToggle()}
      className="group flex min-h-[32px] w-full items-center gap-[var(--space-8)] rounded-md border border-edge bg-panel-2 px-[var(--space-10)] py-[var(--space-6)] text-left text-xs text-muted hover:border-muted data-[checked]:border-accent data-[checked]:text-text data-[checked]:[background:var(--stage)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
    >
      <span
        aria-hidden
        className="flex size-[14px] flex-none items-center justify-center rounded-sm border border-edge group-data-[checked]:border-muted"
      >
        <Checkbox.Indicator className="flex text-text">
          <Glyph icon={CHECK_GLYPH} size={10} />
        </Checkbox.Indicator>
      </span>
      <span
        data-yunari-facet-option-name=""
        className="flex-1"
        {...(option.nameIsCopy === true ? { "data-yunari-copy": "" } : {})}
      >
        {option.name}
      </span>
      <span className="flex-none font-mono text-2xs text-faint">
        {option.count}
      </span>
    </Checkbox.Root>
  );
}

/**
 * The store's facet row: one well-with-chevron per facet, each opening a
 * popover of the checkbox choice rows.
 *
 * **It draws the values it is given and derives none.** The values come from
 * the items — A.3's record is what a theme's facets are read off — so this row
 * takes them as props and knows nothing about a theme, a binding or an artboard.
 *
 * **The chosen values are the region's, not the row's.** What is chosen filters
 * the list and returns the pager to page one, and both of those belong to
 * whoever holds the items (Task A.6) — so the row reports a toggle and holds no
 * state of its own. Two copies of one selection is the state that drifts: the
 * trigger's count would read from one and the filter from the other.
 */
export function FacetRow(props: {
  readonly facets: readonly Facet[];
  readonly chosen: FacetSelection;
  readonly onToggle: (facetId: string, optionId: string) => void;
}): React.JSX.Element {
  return (
    <div
      // `flex-wrap` is the whole of "a wrapped line, never a dropped control":
      // the five are always rendered, and a region too narrow for one line puts
      // the rest on the next rather than clipping them out of reach.
      className="flex min-w-0 flex-wrap items-center gap-[var(--space-8)]"
      data-yunari-facet-row=""
      role="group"
      aria-label={uiCopy.store.facets.label}
    >
      {props.facets.map((facet) => (
        <FacetButton
          key={facet.id}
          facet={facet}
          chosen={props.chosen[facet.id] ?? []}
          onToggle={(optionId) => props.onToggle(facet.id, optionId)}
        />
      ))}
    </div>
  );
}
