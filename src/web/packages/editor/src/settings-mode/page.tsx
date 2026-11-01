import type * as React from "react";
import { pageCopy, type SettingsPage } from "./nav.js";

/**
 * One Settings page's frame: its heading, the sentence that says what it is,
 * and its body. The page owns the spacing between sections; a page body decides
 * its own columns.
 *
 * **The page's heading is the only `h2`.** Section eyebrows inside a page are
 * `h3`-shaped text, so a screen reader hears the page first and its sections
 * under it. The heading is not a focus target: entering the surface focuses the
 * active navigation row, which is where the author's next key is answered.
 */
export function Page(props: {
  readonly page: SettingsPage;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const copy = pageCopy(props.page);
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
        <p className="m-0 max-w-[62ch] text-xs text-muted">{copy.hint}</p>
      </header>
      {props.children}
    </section>
  );
}
