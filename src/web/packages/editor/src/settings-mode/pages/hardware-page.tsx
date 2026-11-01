import type { AssignableGroup } from "@yunari/renderer-core";
import type * as React from "react";
import { ControlSelect } from "../../components/ui/control-select.js";
import { uiCopy } from "../../ui-copy.js";
import { DeviceNameRow } from "../device-name-row.js";
import {
  devicesFor,
  everyDevice,
  groupQuestion,
  type HostState,
  nameOfDevice,
} from "../host-state.js";
import { Page } from "../page.js";
import { Group } from "../section-group.js";

/**
 * The Hardware page: which device each slot reads, and what dashboards call
 * each device. Two columns because the two questions are independent; a PC with
 * many drives fills the names column while the three slot selects stay put.
 */
export function HardwarePage(state: HostState): React.JSX.Element {
  const copy = uiCopy.hostSettings.devices;
  const devices = state.devices;

  return (
    <Page page="hardware">
      {devices === undefined ? null : everyDevice(devices).length === 0 ? (
        // **The empty sentence is the page's own, and it is not a fabricated
        // zero**: no provider reported a device, so there is nothing to choose
        // between and the sentence says what to do.
        <p className="text-xs text-muted">{copy.empty}</p>
      ) : (
        <div className="grid gap-[var(--space-24)] lg:grid-cols-2">
          <Group testId="devices" name={copy.heading} hint={copy.hint}>
            {(["gpu", "system-disk", "data-disk"] as const).map((group) => {
              const options = devicesFor(devices, group);
              // A slot with nothing behind it is not a question: the page draws
              // no row rather than an empty dropdown.
              if (options.length === 0) return null;
              const choices = [
                // The default exists whatever the count, so the control always
                // shows something and a choice can be undone.
                { id: "", name: copy.automatic[group] },
                ...options.map((device) => ({
                  id: device.id,
                  name: nameOfDevice(devices, device),
                })),
              ];
              return (
                <ControlSelect
                  key={group}
                  id={`yunari-host-device-${group}`}
                  label={groupQuestion(devices, group)}
                  shape="headed"
                  data={{ "data-yunari-host-device-group": group }}
                  value={devices.assigned[group] ?? ""}
                  options={choices}
                  onChange={(id) =>
                    state.saveDevices({
                      assigned: { [group]: id } as Partial<
                        Record<AssignableGroup, string>
                      >,
                    })
                  }
                />
              );
            })}
          </Group>

          <Group testId="names" name={copy.namesHeading} hint={copy.namesHint}>
            {everyDevice(devices).map((device) => (
              <DeviceNameRow
                key={device.id}
                device={device}
                value={devices.names[device.id] ?? ""}
                onCommit={(name) =>
                  state.saveDevices({ names: { [device.id]: name } })
                }
              />
            ))}
          </Group>
        </div>
      )}
    </Page>
  );
}
