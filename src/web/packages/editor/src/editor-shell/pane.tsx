import type * as React from "react";
import { Glyph, type LucideIcon } from "./icons.js";

/**
 * One pane's chrome: a title bar (glyph, title, then a count or
 * a single pane-level action), a body, and an optional footer toolbar.
 *
 * `id` is the pane's DOM name, and it is required: the pane is the one owner of
 * pane identity, so every pane carries `data-yunari-panel` and no panel inside
 * one duplicates it. Two elements under one name is a strict-mode failure in
 * the specs that browse by it, which is what a second writer would buy.
 *
 * The body is the pane's scroller, to the pane contract and `vg-208`: the title bar
 * and the footer sit outside it, so scrolling a long list leaves them still. The
 * shell reads and writes each pane's offset off it through `bodyRef`, which only
 * the showing pane attaches — a `hidden` pane's body is not a scrollable box and
 * has no offset to read.
 */
export function Pane(props: {
  readonly id: string;
  readonly title: string;
  readonly icon: LucideIcon;
  readonly count?: React.ReactNode;
  readonly footer?: React.ReactNode;
  /** Whether this slot's pane is showing. The shell keeps every pane mounted —
   *  the persistent hosts live inside them — so a pane that is not showing is
   *  `hidden`, not unmounted. */
  readonly hidden?: boolean;
  /** The box that scrolls, for `choosePane` to read and write the pane's offset
   *  through. Detached while this pane is `hidden`: a `display: none` box
   *  answers `scrollTop` 0, so a shell holding one would restore the author's
   *  place to the top of the list. */
  readonly bodyRef?: React.Ref<HTMLDivElement>;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const {
    id,
    title,
    icon: Icon,
    count,
    footer,
    hidden = false,
    bodyRef,
    children,
  } = props;
  return (
    <section
      data-yunari-panel={id}
      className="editor-shell-pane"
      hidden={hidden}
    >
      <header className="editor-shell-pane-title">
        <Glyph icon={Icon} size={14} />
        <h2 className="editor-shell-pane-name">{title}</h2>
        {count === undefined ? null : (
          <span className="editor-shell-pane-count">{count}</span>
        )}
      </header>
      <div
        className="editor-shell-pane-body"
        ref={hidden ? undefined : bodyRef}
      >
        {children}
      </div>
      {footer === undefined ? null : footer}
    </section>
  );
}
