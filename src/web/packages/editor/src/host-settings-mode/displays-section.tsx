import { RadioGroup } from "@base-ui/react/radio-group";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { ControlChoiceRow } from "../components/ui/control-choice-row.js";
import { ControlSelect } from "../components/ui/control-select.js";
import {
  ControlRow,
  ControlWell,
  plainButtonClasses,
  useControlIds,
} from "../components/ui/control-well.js";
import type { ThemedDisplay } from "../theme-library-client.js";
import { uiCopy } from "../ui-copy.js";
import type {
  AutostartAnswer,
  HostMonitor,
  HostSettingsClient,
} from "./client.js";
import { Group } from "./section-group.js";

/**
 * The displays this host holds, and the routes that change that set.
 *
 * **The list is one choice, and the choice is which display the sections below
 * speak for** — never which theme it shows. The set is too large for
 * `Segmented`, so it is a list of choice rows (DESIGN.md rule 7), each a radio
 * in one labelled group. The management commands live beside the row they act
 * on: Remove names the display it would remove, and its confirmation says what
 * goes with it.
 *
 * **Adding is the one thing here that creates a row.** A local display needs
 * the monitor it is on, so the add form is drawn only when the probe answered a
 * list; a probe that failed states its reason instead of offering a choice no
 * route would accept. The name field is a well, and the monitor is the control
 * set's select.
 *
 * The sign-in registration is the host's own entry, not one display's: one
 * entry brings every local display back, including one added later. The route
 * answers the registrar's own sentence, and this section prints it rather than
 * rewording it.
 */

/** The theme a display shows: its own choice, else the default's. Spelled once
 *  because the fallback is the feature's core, and a second copy of it is one
 *  more place to get it wrong. `null` means neither — a display showing nothing,
 *  which is not the same as showing a theme named "nothing". */
export function shownTheme(
  display: ThemedDisplay | undefined,
  fallback: string | null,
): string | null {
  return display?.theme ?? fallback;
}

/** A message a person can act on: the host's own words where it sent any. */
function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function DisplaysSection(props: {
  readonly displays: readonly ThemedDisplay[];
  readonly selected: string | undefined;
  readonly fallback: string | null;
  /** True when the host's display file is there and unusable: the list is empty
   *  because it could not be read, not because no display exists. */
  readonly unreadable: boolean;
  readonly themeName: (id: string) => string;
  readonly settings: Pick<
    HostSettingsClient,
    "listMonitors" | "registerAutostart"
  >;
  readonly onSelect: (id: string) => void;
  /** Adds one local display. Answers whether the host accepted it, so the form
   *  clears only when the row it created exists. */
  readonly onAdd: (label: string, monitor: HostMonitor) => Promise<boolean>;
  /** Removes one display. Answers whether the host accepted it, so the
   *  confirmation closes only on a removal that landed. */
  readonly onRemove: (display: ThemedDisplay) => Promise<boolean>;
}): React.JSX.Element {
  const copy = uiCopy.hostSettings.displays;
  const [monitors, setMonitors] = useState<readonly HostMonitor[] | undefined>(
    undefined,
  );
  /** A probe that failed is not a machine with no monitors: the reason gets its
   *  own sentence, and the add form stays out because it has no monitor to put
   *  on a display. */
  const [monitorError, setMonitorError] = useState<string | undefined>(
    undefined,
  );
  const [monitorIndex, setMonitorIndex] = useState(0);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  /** The row whose confirmation is showing. */
  const [confirming, setConfirming] = useState<string | undefined>(undefined);
  /** The row a removal is in flight for, so its button cannot be pressed twice. */
  const [removing, setRemoving] = useState<string | undefined>(undefined);
  const [autostart, setAutostart] = useState<
    AutostartAnswer | "working" | undefined
  >(undefined);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    props.settings.listMonitors().then(
      (found) => {
        if (!live) return;
        setMonitors(found);
        setMonitorError(undefined);
      },
      (error: unknown) => {
        if (live) {
          setMonitors(undefined);
          setMonitorError(reason(error));
        }
      },
    );
    return () => {
      live = false;
    };
  }, [props.settings]);

  const chosenMonitor = monitors?.[monitorIndex] ?? monitors?.[0];

  const add = async (): Promise<void> => {
    const label = name.trim();
    if (adding || label === "" || chosenMonitor === undefined) return;
    setAdding(true);
    const added = await props.onAdd(label, chosenMonitor);
    if (mounted.current) {
      setAdding(false);
      if (added) {
        setName("");
        setMonitorIndex(0);
      }
    }
  };

  const remove = async (display: ThemedDisplay): Promise<void> => {
    if (removing !== undefined) return;
    setRemoving(display.id);
    const removed = await props.onRemove(display);
    if (mounted.current) {
      setRemoving(undefined);
      if (removed) setConfirming(undefined);
    }
  };

  const registerAutostart = async (): Promise<void> => {
    if (autostart === "working") return;
    setAutostart("working");
    try {
      const answer = await props.settings.registerAutostart();
      if (mounted.current) setAutostart(answer);
    } catch (error: unknown) {
      if (mounted.current) {
        setAutostart({ ok: false, message: reason(error) });
      }
    }
  };

  return (
    <Group testId="displays" name={copy.heading} hint={copy.hint}>
      {/* **An unreadable file is not an empty one.** The host fails closed and
          answers no displays either way, so this is the only word that tells
          the person the list is missing rather than empty — and it names the
          file every write will refuse to touch. */}
      {props.unreadable ? (
        <p
          role="alert"
          data-yunari-host-displays-unreadable=""
          className="m-0 text-xs text-warn"
        >
          {copy.unreadable}
        </p>
      ) : null}

      {/* **The rows are a choice, and the choice is which display the sections
          below speak for.** The set is too large for Segmented, so it is the
          control set's choice row: each display is one radio in one labelled
          group, and the chosen row lifts to `--stage` behind an accent border
          (DESIGN.md rule 7). The theme it shows is a fact about the choice,
          drawn at the row's right edge. */}
      {props.displays.length === 0 ? null : (
        <RadioGroup
          value={props.selected ?? ""}
          aria-label={copy.label}
          onValueChange={(next) => {
            if (next !== null) props.onSelect(next);
          }}
          className="flex flex-col gap-[var(--space-6)]"
        >
          {props.displays.map((display) => {
            const own = display.theme;
            const shown = shownTheme(display, props.fallback);
            // The Host is the machine rather than a record, so it has no
            // record a removal route could delete; the row keeps its choice
            // and draws no command it would refuse.
            const removable = display.id !== "this-pc";

            return (
              <div
                key={display.id}
                className="flex flex-col gap-[var(--space-4)]"
              >
                <div className="flex items-center gap-[var(--space-6)]">
                  <div className="min-w-0 flex-1">
                    <ControlChoiceRow
                      value={display.id}
                      label={display.label}
                      data={{
                        "data-yunari-host-display": display.id,
                        "data-shape": display.shape,
                        "data-rotation": String(display.rotation),
                      }}
                      detail={
                        <>
                          <span
                            data-yunari-host-display-theme=""
                            className={`text-xs ${own === null ? "text-faint" : "text-muted"}`}
                          >
                            {shown === null
                              ? copy.nothing
                              : props.themeName(shown)}
                          </span>
                          {/* A display with no theme of its own is served the
                              default, so the row names the theme it shows *and*
                              says where that answer came from: a name alone
                              would read as a choice this display made. */}
                          {own === null && shown !== null ? (
                            <span
                              data-yunari-host-display-follows=""
                              className="flex-none text-2xs text-faint"
                            >
                              {copy.follows}
                            </span>
                          ) : null}
                        </>
                      }
                    />
                  </div>
                  {removable ? (
                    <button
                      type="button"
                      data-yunari-host-display-remove={display.id}
                      aria-label={copy.removeDisplay(display.label)}
                      className={plainButtonClasses}
                      onClick={() =>
                        setConfirming((current) =>
                          current === display.id ? undefined : display.id,
                        )
                      }
                    >
                      {copy.remove}
                    </button>
                  ) : null}
                </div>

                {confirming === display.id ? (
                  <div
                    data-yunari-host-display-confirm={display.id}
                    className="flex flex-col gap-[var(--space-6)] rounded-md border border-edge p-[var(--space-8)]"
                  >
                    <p className="m-0 text-2xs text-muted">
                      {copy.removeAsk(display.label)}
                    </p>
                    <div className="flex gap-[var(--space-6)]">
                      <button
                        type="button"
                        data-yunari-host-display-confirm-remove={display.id}
                        className={plainButtonClasses}
                        disabled={removing === display.id}
                        onClick={() => void remove(display)}
                      >
                        {removing === display.id
                          ? uiCopy.hostSettings.status.saving
                          : copy.confirmRemove}
                      </button>
                      <button
                        type="button"
                        data-yunari-host-display-confirm-cancel={display.id}
                        className={plainButtonClasses}
                        onClick={() => setConfirming(undefined)}
                      >
                        {copy.keep}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </RadioGroup>
      )}

      <h3 className="m-0 pt-[var(--space-6)] text-2xs font-semibold tracking-[0.11em] text-muted uppercase">
        {copy.addHeading}
      </h3>

      {/* A failed probe is the host's own sentence, and no form is drawn: the
          route needs a monitor, and a monitor list nobody read is not one. */}
      {monitorError === undefined ? null : (
        <p
          role="alert"
          data-yunari-host-displays-monitor-error=""
          className="m-0 text-xs text-muted"
        >
          {monitorError}
        </p>
      )}

      {monitors === undefined ? null : monitors.length === 0 ? (
        <p className="text-xs text-muted">{copy.noMonitors}</p>
      ) : (
        <>
          <ControlSelect
            id="yunari-host-display-monitor"
            label={copy.addMonitor}
            density="settings"
            data={{ "data-yunari-host-display-monitor": "" }}
            value={String(monitorIndex)}
            options={monitors.map((monitor, index) => ({
              id: String(index),
              name: copy.monitorOption(
                monitor.deviceName,
                monitor.currentResX,
                monitor.currentResY,
                monitor.main,
              ),
            }))}
            onChange={(next) => setMonitorIndex(Number(next))}
          />
          <DisplayNameField value={name} onChange={setName} />
          <button
            type="button"
            data-yunari-host-display-add=""
            className={plainButtonClasses}
            disabled={adding || name.trim() === ""}
            onClick={() => void add()}
          >
            {adding ? copy.adding : copy.add}
          </button>
        </>
      )}

      <div className="flex flex-col gap-[var(--space-6)] pt-[var(--space-6)]">
        <p className="m-0 text-xs text-muted">{copy.autostartHint}</p>
        <button
          type="button"
          data-yunari-host-autostart=""
          className={plainButtonClasses}
          disabled={autostart === "working"}
          onClick={() => void registerAutostart()}
        >
          {autostart === "working" ? copy.autostartBusy : copy.autostart}
        </button>
        {autostart === undefined || autostart === "working" ? null : (
          <p
            role={autostart.ok ? "status" : "alert"}
            data-yunari-host-autostart-result={autostart.ok ? "ok" : "failed"}
            className={`m-0 text-xs ${autostart.ok ? "text-muted" : "text-warn"}`}
          >
            {autostart.message}
          </p>
        )}
      </div>
    </Group>
  );
}

/**
 * The name a local display is added under.
 *
 * A controlled well rather than `ControlText`, for the reason the source form
 * gives: the add form commits whole, and `ControlText` holds the authored value
 * until blur — a name typed and then submitted would be read as the draft it
 * has not committed yet.
 */
function DisplayNameField(props: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}): React.JSX.Element {
  const copy = uiCopy.hostSettings.displays;
  const ids = useControlIds("yunari-host-display-add-name");

  return (
    <ControlRow
      ids={ids}
      label={copy.addName}
      labelFor={ids.control}
      density="settings"
      hint={copy.addNameHint}
    >
      <ControlWell density="settings">
        <input
          id={ids.control}
          data-yunari-host-display-add-name=""
          type="text"
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          className="h-full w-full bg-transparent text-sm text-text outline-none"
        />
      </ControlWell>
    </ControlRow>
  );
}
