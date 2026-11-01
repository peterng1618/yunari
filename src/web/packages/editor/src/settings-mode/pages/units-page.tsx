import type * as React from "react";
import { DEFAULT_UNIT_PREFERENCES } from "@yunari/renderer-core";
import { ControlSelect } from "../../components/ui/control-select.js";
import { uiCopy } from "../../ui-copy.js";
import { type HostState, UNIT_FIELDS } from "../host-state.js";
import { Page } from "../page.js";
import { Group } from "../section-group.js";

/**
 * The Units & time page: the clock's zone and the systems every reading prints
 * in. The two clock-and-temperature choices sit beside the seven unit families:
 * one pairing changes what a reading means, the other changes how its number is
 * written.
 */
export function UnitsPage(state: HostState): React.JSX.Element {
  const copy = uiCopy.hostSettings.display;
  const preferences = state.preferences;

  return (
    <Page page="units">
      {preferences === undefined ? null : (
        <div className="grid gap-[var(--space-24)] lg:grid-cols-2">
          <Group testId="display" name={copy.clockHeading} hint={copy.hint}>
            <ControlSelect
              id="yunari-host-time-zone"
              label={copy.timeZone}
              data={{ "data-yunari-host-time-zone": "" }}
              value={preferences.settings.timeZone ?? ""}
              // The Host's own zone is the default and the most common answer,
              // so it comes first and is the empty value the route reads as the
              // absence of a choice.
              options={[
                { id: "", name: copy.ownZone },
                ...preferences.zones.map((zone) => ({
                  id: zone,
                  name: zone,
                })),
              ]}
              onChange={(zone) =>
                state.saveDisplay(
                  {
                    timeZone: zone,
                    measurement: preferences.settings.measurement ?? "metric",
                    units: preferences.settings.units ?? {},
                  },
                  uiCopy.hostSettings.status.savedZone,
                )
              }
            />
            <ControlSelect
              id="yunari-host-measurement"
              label={copy.measurement}
              data={{ "data-yunari-host-measurement": "" }}
              value={preferences.settings.measurement ?? "metric"}
              options={[
                { id: "metric", name: copy.metric },
                { id: "imperial", name: copy.imperial },
              ]}
              onChange={(measurement) =>
                state.saveDisplay(
                  {
                    timeZone: preferences.settings.timeZone ?? "",
                    measurement,
                    units: preferences.settings.units ?? {},
                  },
                  uiCopy.hostSettings.status.savedUnits,
                )
              }
            />
          </Group>

          <Group testId="units" name={copy.unitsHeading} hint={copy.hint}>
            <div className="grid gap-[var(--space-8)] sm:grid-cols-2">
              {UNIT_FIELDS.map((field) => {
                const unitCopy = copy.units[field];
                return (
                  <ControlSelect
                    key={field}
                    id={`yunari-host-unit-${field}`}
                    label={unitCopy.label}
                    data={{ "data-yunari-host-unit": field }}
                    // An unchosen family shows the value it is already reading
                    // in, so the control prints the effective answer rather than
                    // an empty third state.
                    value={
                      preferences.settings.units?.[field] ??
                      DEFAULT_UNIT_PREFERENCES[field]
                    }
                    options={Object.entries(unitCopy.values).map(
                      ([id, name]) => ({ id, name }),
                    )}
                    onChange={(value) => state.saveUnit(field, value)}
                  />
                );
              })}
            </div>
          </Group>
        </div>
      )}
    </Page>
  );
}
