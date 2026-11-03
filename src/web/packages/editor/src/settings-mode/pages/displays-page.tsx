import type * as React from "react";
import { ControlSelect } from "../../components/ui/control-select.js";
import { uiCopy } from "../../ui-copy.js";
import { DisplayPresentationSection } from "../display-presentation-section.js";
import {
  AddDisplaySection,
  AutostartSection,
  DisplaysList,
} from "../displays-section.js";
import { devicesFor, type HostState, nameOfDevice } from "../host-state.js";
import { Page } from "../page.js";
import { PanelControlsSection } from "../panel-controls-section.js";
import { PanelsSection } from "../panels-section.js";
import { Group } from "../section-group.js";

/**
 * The Displays page: the master list on the left, the selected display's own
 * settings in the middle, and the things that create or attach a display on the
 * right. At narrower widths the third column moves below the first two.
 *
 * **The selection is this page's scope.** Name, shape, rotation, panel controls
 * and the theme's questions all speak for the row chosen in the list; no other
 * page reads it.
 */
export function DisplaysPage(state: HostState): React.JSX.Element {
  const display = state.selectedRow;
  const devices = state.devices;
  const selected = state.selected;
  const questions = state.questions;
  const copy = uiCopy.hostSettings;

  return (
    <Page page="displays">
      <div className="grid gap-[var(--space-24)] lg:grid-cols-[minmax(var(--settings-card-min-width),var(--settings-card-max-width))_minmax(0,1.2fr)] xl:grid-cols-[minmax(var(--settings-card-min-width),var(--settings-card-max-width))_minmax(0,1.2fr)_minmax(var(--settings-card-max-width),0.9fr)]">
        <div className="flex min-w-0 flex-col gap-[var(--space-24)]">
          <DisplaysList
            displays={state.displays}
            selected={state.selected}
            fallback={state.fallback}
            unreadable={state.mapUnreadable}
            themeName={state.nameOfTheme}
            onSelect={state.chooseDisplay}
            onRemove={state.removeDisplay}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-[var(--space-24)]">
          <DisplayPresentationSection
            display={display}
            write={state.write}
            save={state.settingsClient.updateDisplayPresentation}
            onSaved={(id, saved) => state.replacePresentation(id, saved)}
            rename={state.settingsClient.renameDisplay}
            onRenamed={(id, label) => state.replaceName(id, label)}
          />

          {/* Drawn from the display record, not from the attached list: a panel
              that is disconnected is exactly the one whose status and reconnect
              are needed. */}
          {selected === undefined ||
          display?.kind !== "panel" ||
          display.panel === undefined ? null : (
            <PanelControlsSection
              key={selected}
              displayId={selected}
              panel={state.selectedPanel}
              connection={display.panel}
              onReconnect={() => state.reconnectPanel(selected)}
              onDisconnect={() => state.disconnectPanel(selected)}
              onCommand={(command) =>
                state.settingsClient.panelCommand(selected, command)
              }
            />
          )}

          {/* **Only the questions the theme on this display raises are drawn**,
              and only the ones nothing has answered: the route derives
              `required` from the theme's own bindings, so a theme that reads
              `cpu.load` raises no GPU row here. A display showing no theme
              raises none. */}
          {state.asked.length === 0 ||
          questions === undefined ||
          state.showing === null ||
          devices === undefined ? null : (
            <Group
              testId="questions"
              name={copy.questions.heading(state.nameOfTheme(state.showing))}
              hint={copy.questions.hint}
            >
              {state.asked.map((group) => (
                <ControlSelect
                  key={group}
                  id={`yunari-host-answer-${group}`}
                  label={copy.devices.groups[group]}
                  data={{ "data-yunari-host-answer": group }}
                  value={questions.answers[group] ?? ""}
                  options={[
                    // The Host's own choice is the default, so most themes need
                    // no answer at all.
                    { id: "", name: copy.questions.inherit },
                    ...devicesFor(devices, group).map((device) => ({
                      id: device.id,
                      name: nameOfDevice(devices, device),
                    })),
                  ]}
                  onChange={(device) => state.answer(group, device)}
                />
              ))}
            </Group>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-[var(--space-24)] lg:col-span-2 xl:col-span-1">
          <AddDisplaySection
            settings={state.settingsClient}
            onAdd={state.addDisplay}
          />

          {/* After the rows, because it *creates* one of them: a section above
              the list it appends to would read as a filter on it. */}
          {state.panels === undefined ? null : (
            <PanelsSection
              attached={state.panels}
              holderLabel={(heldId) =>
                state.displays.find((row) => row.id === heldId)?.label
              }
              adding={state.addingPanel}
              onAdd={state.addPanel}
            />
          )}

          <AutostartSection settings={state.settingsClient} />
        </div>
      </div>
    </Page>
  );
}
