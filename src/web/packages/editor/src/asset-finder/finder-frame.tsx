import { Tabs } from "@base-ui/react/tabs";
import type { ListingCategory } from "@yunari/renderer-core";
import type * as React from "react";
import { Dialog } from "../components/ui/dialog.js";
import { FinderSearch } from "./finder-controls.js";

/**
 * The finder's one window: a tab rail, a toolbar, a content region and a
 * footer, in that order, whatever the tab inside draws.
 *
 * A body that owns its own search (the font catalogue, the Wallpaper Engine
 * pane) passes no `query`, and the toolbar draws none: two search fields in
 * one window would be two answers to "where do I type". A footer with neither
 * a status nor an action is not drawn at all.
 */
export function FinderFrame(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly label: string;
  readonly closeLabel: string;
  readonly className?: string;
  readonly tabs: readonly {
    readonly id: ListingCategory;
    readonly label: string;
    readonly icon?: React.ReactNode;
  }[];
  readonly active: ListingCategory;
  readonly onTabChange: (id: ListingCategory) => void;
  readonly query?: string;
  readonly searchPlaceholder?: string;
  readonly onQueryChange?: (value: string) => void;
  readonly filters?: React.ReactNode;
  readonly sources?: React.ReactNode;
  readonly tools?: React.ReactNode;
  readonly status?: React.ReactNode;
  readonly statusTone?: "ok" | "failed";
  readonly actions?: React.ReactNode;
  readonly detail?: React.ReactNode;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const showFooter = props.status !== undefined || props.actions !== undefined;
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      label={props.label}
      closeLabel={props.closeLabel}
      closeIcon
      {...(props.className === undefined ? {} : { className: props.className })}
    >
      <Tabs.Root
        value={props.active}
        onValueChange={(value) => {
          props.onTabChange(value as ListingCategory);
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div
          data-yunari-asset-frame=""
          className="flex min-h-0 flex-1 flex-col"
        >
          {/* The rail is the window's title bar: the tabs take its left, the
              corner keeps room for the way out. */}
          <div className="flex h-12 flex-none items-center border-b border-edge px-[var(--space-16)] pr-[calc(var(--space-32)+var(--space-4))]">
            <Tabs.List className="flex gap-[var(--space-4)]">
              {props.tabs.map((tab) => (
                <Tabs.Tab
                  key={tab.id}
                  value={tab.id}
                  data-yunari-asset-tab={tab.id}
                  className="flex h-full items-center gap-[var(--space-6)] border-b-2 border-transparent px-[var(--space-12)] text-sm text-muted hover:text-text data-[active]:border-accent data-[active]:bg-[var(--panel-2)] data-[active]:text-text"
                >
                  {tab.icon}
                  {tab.label}
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </div>

          <div
            data-yunari-asset-toolbar=""
            className="flex min-h-12 flex-none flex-wrap items-center gap-[var(--space-8)] border-b border-edge px-[var(--space-16)] py-[var(--space-8)]"
          >
            {props.query === undefined ||
            props.onQueryChange === undefined ||
            props.searchPlaceholder === undefined ? null : (
              <FinderSearch
                value={props.query}
                placeholder={props.searchPlaceholder}
                onChange={props.onQueryChange}
              />
            )}
            {props.filters}
            {props.sources}
            <span className="flex-1" />
            {/* The tools are glyph buttons at DESIGN.md's fixed 26px, while the
                fields beside them scale with the root font. Their own height
                would therefore set the row and make one tab's toolbar taller
                than the next; the row's height is the field height. */}
            {props.tools === undefined ? null : (
              <div className="flex h-7 flex-none items-center">
                {props.tools}
              </div>
            )}
          </div>

          <Tabs.Panel
            value={props.active}
            className="flex min-h-0 flex-1 overflow-hidden"
          >
            <div
              data-yunari-asset-content=""
              className="flex min-h-0 flex-1 flex-col gap-[var(--space-8)] p-[var(--space-16)]"
            >
              {props.children}
            </div>
            {props.detail === undefined ? null : (
              <aside className="flex-none border-l border-edge p-[var(--space-16)]">
                {props.detail}
              </aside>
            )}
          </Tabs.Panel>

          {showFooter ? (
            <footer
              data-yunari-asset-footer=""
              className="flex min-h-[var(--finder-footer-height)] flex-none items-center gap-[var(--space-12)] border-t border-edge px-[var(--space-16)] py-[var(--space-12)]"
            >
              <p
                role="status"
                data-yunari-asset-status=""
                data-tone={props.statusTone}
                className={`m-0 text-xs ${
                  props.statusTone === "failed"
                    ? "text-[var(--hot)]"
                    : "text-muted"
                }`}
              >
                {props.status}
              </p>
              <span className="flex-1" />
              <div
                data-yunari-asset-actions=""
                className="flex items-center gap-[var(--space-8)]"
              >
                {props.actions}
              </div>
            </footer>
          ) : null}
        </div>
      </Tabs.Root>
    </Dialog>
  );
}
