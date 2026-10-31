import type * as React from "react";
import { plainButtonClasses } from "../components/ui/control-well.js";
import { uiCopy } from "../ui-copy.js";
import type { PanelHardware, PanelHint } from "./client.js";
import { Group } from "./section-group.js";

/**
 * The hardware record a driver states for one panel, and the warning when the
 * device answers a firmware that record does not name. Nothing is drawn for a
 * device no driver claims: an empty record is not a fact about the panel.
 *
 * Exported because the controls section states the same record beside its own
 * commands: a second copy of this rule is a second place the warning can go
 * missing.
 */
export function PanelFacts(props: {
  readonly panel: PanelHint;
}): React.JSX.Element | null {
  const copy = uiCopy.hostSettings.panels;
  const support = props.panel.support;

  if (support === undefined) return null;

  const detected = props.panel.firmware;
  const mismatch =
    detected !== undefined &&
    support.supportedFirmware.length > 0 &&
    !support.supportedFirmware.includes(detected);

  return (
    <span
      data-yunari-panel-facts=""
      className="flex flex-col gap-[var(--space-4)] text-2xs text-muted"
    >
      <span>
        {[
          copy.maker(support.maker),
          copy.revision(support.hardwareRevision),
        ].join(" · ")}
      </span>
      <span>
        {[
          detected === undefined ? undefined : copy.detectedFirmware(detected),
          copy.supportedFirmware(support.supportedFirmware),
          copy.updated(support.updatedAt),
        ]
          .filter((part): part is string => part !== undefined)
          .join(" · ")}
      </span>
      {mismatch ? (
        <span data-yunari-panel-mismatch="" className="text-warn">
          {copy.mismatch(detected, support.supportedFirmware)}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The USB panels attached to this PC, and the button that adds one.
 *
 * **A panel is found, not paired.** It has no URL and no credential, so there is
 * nothing to admit: the host enumerates what the hardware reports and writes a
 * record for the one the owner picks. That makes this the only section of the
 * Host mode that *creates* a display rather than editing one, which is why it
 * carries its own select and its own action rather than reusing the rows above.
 *
 * A panel that is already a display is left out of the offer: the route refuses
 * a second record for one device, so an add button would be a choice whose only
 * outcome is a refusal. The row stays, though — a device the owner can see
 * plugged in is worth a line, and it is where its hardware record belongs. The
 * set is compared by the device's ids, which is what the record keys it by.
 */
export function PanelsSection(props: {
  readonly attached: readonly PanelHint[];
  /** What the display driving a held device is called, when this region knows
   *  that display. Absent falls back to the sentence that it is one. */
  readonly holderLabel?: ((heldId: string) => string | undefined) | undefined;
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
      {/* **Every attached panel gets a row**, held or free: the hardware record
          is a fact about the device, not about whether it can be added. */}
      {free.length === 0 ? (
        <p className="text-xs text-muted">{copy.allAdded}</p>
      ) : null}
      <div className="flex flex-col gap-[var(--space-6)]">
        {props.attached.map((panel) => {
          const key = `${panel.vendorId}:${panel.productId}:${panel.serial}`;
          const holder =
            panel.heldId === undefined
              ? undefined
              : props.holderLabel?.(panel.heldId);

          return (
            <div
              key={key}
              data-yunari-panel={key}
              className="flex items-center gap-[var(--space-12)] rounded-lg border border-edge bg-panel-2 px-[var(--space-10)] py-[var(--space-8)]"
            >
              <span className="flex min-w-0 flex-1 flex-col text-xs text-text">
                {panel.label}
                <PanelFacts panel={panel} />
              </span>
              {/* A held device says which display drives it instead of offering
                  a second claim the route would refuse. */}
              {panel.held ? (
                <span
                  data-yunari-panel-held={panel.heldId ?? ""}
                  className="flex-none text-2xs text-faint"
                >
                  {holder === undefined ? copy.held : copy.heldBy(holder)}
                </span>
              ) : (
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
              )}
            </div>
          );
        })}
      </div>
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
