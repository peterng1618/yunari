import type * as React from "react";
import type { HostState } from "../host-state.js";
import { Page } from "../page.js";
import { SourcesSection } from "../sources-section.js";
import { WeatherSection } from "../weather-section.js";

/**
 * The Readings page: the readings the Host fetches, beside the source that
 * supplies them. Custom sources take the wide column because a row carries an
 * address, a health line and its actions; weather is one place and one cadence.
 */
export function ReadingsPage(state: HostState): React.JSX.Element {
  return (
    <Page page="readings">
      <div className="grid gap-[var(--space-24)] xl:grid-cols-[minmax(0,1fr)_minmax(var(--settings-aside-min-width),var(--settings-aside-max-width))]">
        <SourcesSection sources={state.sourcesClient} report={state.report} />
        <WeatherSection settings={state.settingsClient} report={state.report} />
      </div>
    </Page>
  );
}
