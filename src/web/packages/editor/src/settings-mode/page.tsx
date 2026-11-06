import type * as React from "react";
import { isBuiltinSettingsPage, pageCopy, type SettingsPage } from "./nav.js";

/**
 * One Settings page's frame: its heading, the sentence that says what it is,
 * and its body. The page owns the spacing between sections; a page body decides
 * its own columns.
 *
 * **The page's heading is the only `h2`.** Section eyebrows inside a page are
 * `h3`-shaped text, so a screen reader hears the page first and its sections
 * under it. The heading is not a focus target: entering the surface focuses the
 * active navigation row, which is where the author's next key is answered.
 *
 * A plugin page's words are the manifest's, so they arrive as `title` and
 * `hint`; the built-in pages read their own copy table.
 */
export function Page(props: {
  readonly page: SettingsPage;
  readonly title?: string | undefined;
  readonly hint?: string | undefined;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const copy = isBuiltinSettingsPage(props.page)
    ? pageCopy(props.page)
    : {
        title: props.title ?? props.page,
        hint: props.hint ?? "",
      };
  return (
    <section
      data-yunari-settings-page={props.page}
      aria-labelledby={`yunari-settings-page-${props.page}`}
      className="flex min-h-0 flex-col gap-[var(--space-24)]"
    >
      <header className="flex flex-col gap-[var(--space-6)]">
        <h2
          id={`yunari-settings-page-${props.page}`}
          className="m-0 text-base font-semibold text-text"
        >
          {copy.title}
        </h2>
        {copy.hint === "" ? null : (
          <p className="m-0 max-w-[62ch] text-xs text-muted">{copy.hint}</p>
        )}
      </header>
      {props.children}
    </section>
  );
}
