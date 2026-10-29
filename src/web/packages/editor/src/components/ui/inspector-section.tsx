import type * as React from "react";
import { useState } from "react";
import { hitTargetClasses } from "./control-well.js";

/**
 * One region of a panel: a disclosure whose header is a button, and a body of
 * rows.
 *
 * The header is the button rather than a div that contains one, so its
 * `aria-expanded` reaches the thing that was clicked (the control set, "Section headers are
 * buttons exposing `aria-expanded`"), and collapsing hides the body instead of
 * unmounting it — a section that lost its state on a collapse, or on a
 * publication that redrew the panel, would take a half-typed draft with it
 * (the control set, "stable identity keeps work in place").
 *
 * The header is a target, so it carries the 24×24 through `hitTargetClasses`:
 * a 10px eyebrow on a 12px line is 18px of button.
 *
 * The count is optional and sits in the header rather than the body: a collapsed
 * section that stopped saying how much it holds would be hiding, and the rule
 * is that collapsing is ordering, not removal.
 */
export function InspectorSection(props: {
  readonly id: string;
  readonly title: string;
  readonly defaultOpen?: boolean;
  readonly count?: number;
  /**
   * The section sits directly under an owner that already drew the boundary
   * between them — the column's subject block, whose `border-b` is it — so this
   * one draws none of its own. Two adjacent owners drawing one hairline is what
   * `vg-466` records: the author saw two lines under the header and none between
   * the sections below. The default draws the rule, because every other surface
   * this composes into (the document panes) has nothing
   * above it that does.
   */
  readonly first?: boolean;
  /**
   * Scopes the header and panel ids so two sections with the same `id` in one
   * document do not collide. `id` names the section and is the locator hook, but
   * the aria pair has to be document-unique — two selection columns would
   * otherwise both mint `content-header`, and the second `aria-controls` would
   * resolve to the first column's panel. Empty by default, so a single surface
   * keeps the plain `${id}-header` ids.
   */
  readonly idPrefix?: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const {
    id,
    title,
    defaultOpen = true,
    count,
    first = false,
    idPrefix = "",
    children,
  } = props;
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section
      data-yunari-section={id}
      className={`${first ? "" : "border-t border-edge "}py-[var(--space-12)]`}
    >
      <h2 className="m-0">
        <button
          type="button"
          id={`${idPrefix}${id}-header`}
          aria-expanded={open}
          aria-controls={`${idPrefix}${id}-panel`}
          onClick={() => setOpen((current) => !current)}
          className={`${hitTargetClasses} flex w-full items-center gap-[var(--space-6)] border-0 bg-transparent text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent`}
        >
          <span className="text-2xs font-semibold tracking-[0.11em] text-muted uppercase">
            {title}
          </span>
          {count === undefined ? null : (
            <span
              data-yunari-section-count=""
              className="text-2xs font-mono text-faint tabular-nums"
            >
              {count}
            </span>
          )}
          {/* The header's trailing rule,
              `flex:1;height:1px;background:var(--edge2)`. Nothing in the product
              or in DESIGN.md argued against it. */}
          <span
            aria-hidden
            className="h-px flex-1 bg-edge-2"
            data-yunari-section-rule=""
          />
          <span aria-hidden className="ml-auto text-faint">
            {open ? "▾" : "▸"}
          </span>
        </button>
      </h2>
      <div
        id={`${idPrefix}${id}-panel`}
        hidden={!open}
        className="flex flex-col gap-[var(--space-6)] pt-[var(--space-8)]"
      >
        {children}
      </div>
    </section>
  );
}
