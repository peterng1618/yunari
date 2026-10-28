import type * as React from "react";
import { plainButtonClasses } from "../components/ui/control-well.js";
import { uiCopy } from "../ui-copy.js";
import type { PanelHardware, PanelHint } from "./client.js";
import { Group } from "./section-group.js";

/**
 * The USB panels attached to this PC, and the button that adds one.
 *
 * **A panel is found, not paired.** It has no URL and no credential, so there is
 * nothing to admit: the host enumerates what the hardware reports and writes a
 * record for the one the owner picks. That makes this the only section of the
 * Host mode that *creates* a display rather than editing one, which is why it
 * carries its own select and its own action rather than reusing the rows above.
 *
 * A panel that is already a display is left out: the route refuses a second
 * record for one device, so offering it would be a choice whose only outcome is
 * a refusal. The set is compared by the device's ids, which is what the record
 * keys it by.
 */
export function PanelsSection(props: {
  readonly attached: readonly PanelHint[];
  readonly adding: boolean;
  readonly onAdd: (panel: PanelHint) => void;
}): React.JSX.Element {
  const copy = uiCopy.hostSettings.panels;
  const free = props.attached.filter((panel) => !panel.held);

  // **Nothing attached says nothing.** A desktop with no panel is the ordinary
  // case, not an error, and a section that read "no panels" on every machine
  // without one would be a fault message for a normal machine.
  if (props.attached.length === 0) {
    return (
      <Group testId="panels" name={copy.heading} hint={copy.none}>
        {null}
      </Group>
    );
  }

  return (
    <Group testId="panels" name={copy.heading} hint={copy.hint}>
      {free.length === 0 ? (
        <p className="text-xs text-muted">{copy.allAdded}</p>
      ) : (
        <div className="flex flex-col gap-[var(--space-6)]">
          {free.map((panel) => {
            const key = `${panel.vendorId}:${panel.productId}:${panel.serial}`;

            return (
              <div
                key={key}
                data-yunari-panel={key}
                className="flex items-center gap-[var(--space-12)] rounded-lg border border-edge bg-panel-2 px-[var(--space-10)] py-[var(--space-8)]"
              >
                <span className="min-w-0 flex-1 text-xs text-text">
                  {panel.label}
                </span>
                <button
                  type="button"
                  data-yunari-panel-add={key}
                  aria-label={copy.addPanel(panel.label)}
                  className={plainButtonClasses}
                  disabled={props.adding}
                  onClick={() => props.onAdd(panel)}
                >
                  {props.adding ? copy.adding : copy.add}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Group>
  );
}

/** The hardware fields an add sends. `model` is the host's to write, from its
 *  own family table, so this never names one. */
export function hardwareOf(panel: PanelHint): PanelHardware {
  return {
    vendorId: panel.vendorId,
    productId: panel.productId,
    serial: panel.serial,
  };
}
