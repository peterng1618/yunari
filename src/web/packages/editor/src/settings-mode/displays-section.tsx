import { RadioGroup } from "@base-ui/react/radio-group";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { ControlChoiceRow } from "../components/ui/control-choice-row.js";
import { ControlSelect } from "../components/ui/control-select.js";
import { controlStateAttributes } from "../components/ui/control-state.js";
import { ControlToggle } from "../components/ui/control-toggle.js";
import {
  ControlRow,
  ControlWell,
  plainButtonClasses,
  useControlIds,
} from "../components/ui/control-well.js";
import {
  DEFAULT_DISPLAY_KEY,
  type ThemedDisplay,
} from "../theme-library-client.js";
import { uiCopy } from "../ui-copy.js";
import type {
  AutostartAnswer,
  HostMonitor,
  HostSettingsClient,
} from "./client.js";
import { Group } from "./section-group.js";

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

/**
 * The displays this host holds. **The list is one choice, and the choice is
 * which display the detail column speaks for** — never which theme it shows.
 * The set is too large for `Segmented`, so it is a list of choice rows
 * (DESIGN.md rule 7), each a radio in one labelled group. The management
 * commands live beside the row they act on: Remove names the display it would
 * remove, and its confirmation says what goes with it.
 */
export function DisplaysList(props: {
  readonly displays: readonly ThemedDisplay[];
  readonly selected: string | undefined;
  readonly fallback: string | null;
  /** True when the host's display file is there and unusable: the list is empty
   *  because it could not be read, not because no display exists. */
  readonly unreadable: boolean;
  readonly themeName: (id: string) => string;
  readonly onSelect: (id: string) => void;
  /** Removes one display. Answers whether the host accepted it, so the
   *  confirmation closes only on a removal that landed. */
  readonly onRemove: (display: ThemedDisplay) => Promise<boolean>;
}): React.JSX.Element {
  const copy = uiCopy.hostSettings.displays;
  /** The row whose confirmation is showing. */
  const [confirming, setConfirming] = useState<string | undefined>(undefined);
  /** The row a removal is in flight for, so its button cannot be pressed twice. */
  const [removing, setRemoving] = useState<string | undefined>(undefined);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const remove = async (display: ThemedDisplay): Promise<void> => {
    if (removing !== undefined) return;
    setRemoving(display.id);
    const removed = await props.onRemove(display);
    if (mounted.current) {
      setRemoving(undefined);
      if (removed) setConfirming(undefined);
    }
  };

  return (
    <Group testId="displays" name={copy.listHeading}>
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
          // The default is a key rather than a record, so it has no record
          // a removal route could delete; the row keeps its assignment and
          // draws no command it would refuse.
          const removable = display.id !== DEFAULT_DISPLAY_KEY;

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
                          className={`min-w-0 truncate text-xs ${own === null ? "text-faint" : "text-muted"}`}
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
                    {/* The removal's answer is the page's own status; this
                          control keeps the busy state it can show. */}
                    <button
                      type="button"
                      data-yunari-host-display-confirm-remove={display.id}
                      className={plainButtonClasses}
                      disabled={removing === display.id}
                      {...controlStateAttributes(
                        removing === display.id ? "busy" : undefined,
                      )}
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
    </Group>
  );
}

/**
 * Adding a local display: the one thing here that creates a row. It needs the
 * monitor it is on, so the form is drawn only when the probe answered a list; a
 * probe that failed states its reason instead of offering a choice no route
 * would accept.
 */
export /**
 * The smallest whole-number ratio a pixel size describes.
 *
 * Two screens that read as the same shape report different pixel counts —
 * 2048×1152 and 1920×1080 are both 16:9 — so the ratio is what the label names
 * before the count, and an unusual count stops looking like a broken probe. A
 * size that is not a positive whole number has no ratio to name; absent is
 * honest, and the count still shows.
 */
function aspectRatioOf(width: number, height: number): string | undefined {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined;
  }

  const divisorOf = (a: number, b: number): number =>
    b === 0 ? a : divisorOf(b, a % b);
  const divisor = divisorOf(width, height);
  return `${width / divisor}:${height / divisor}`;
}

export function AddDisplaySection(props: {
  readonly settings: Pick<HostSettingsClient, "listMonitors">;
  /** Adds one local display. Answers whether the host accepted it, so the form
   *  clears only when the row it created exists. */
  readonly onAdd: (label: string, monitor: HostMonitor) => Promise<boolean>;
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

  return (
    <Group testId="add-display" name={copy.addHeading} hint={copy.addNameHint}>
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
                aspectRatioOf(monitor.currentResX, monitor.currentResY),
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
    </Group>
  );
}

/**
 * The host starts at sign-in so every local display comes back after a reboot.
 * The route registers the host, not one display, which is why this sits beside
 * the add form rather than on a display's own detail.
 *
 * **It is a toggle, because the setting is a standing boolean**: the row reads
 * what the OS holds on mount and the write turns that entry on or off. The
 * toggle's answer is the registrar's own message, so a refusal says why the
 * state did not move and the switch keeps the state the OS reports.
 */
export function AutostartSection(props: {
  readonly settings: Pick<HostSettingsClient, "readAutostart" | "setAutostart">;
}): React.JSX.Element {
  const copy = uiCopy.hostSettings.displays;
  const [enabled, setEnabled] = useState<boolean | undefined>(undefined);
  const [working, setWorking] = useState(false);
  const [answer, setAnswer] = useState<AutostartAnswer | undefined>(undefined);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const read = props.settings.readAutostart;
  useEffect(() => {
    let live = true;
    read()
      .then((held) => {
        if (live) setEnabled(held);
      })
      .catch((error: unknown) => {
        if (live)
          setAnswer({ ok: false, message: reason(error), enabled: false });
      });
    return () => {
      live = false;
    };
  }, [read]);

  const write = async (next: boolean): Promise<void> => {
    if (working || enabled === undefined) return;
    setWorking(true);
    try {
      const settled = await props.settings.setAutostart(next);
      if (!mounted.current) return;
      setEnabled(settled.enabled);
      setAnswer(settled);
    } catch (error: unknown) {
      if (mounted.current) {
        setAnswer({ ok: false, message: reason(error), enabled });
      }
    } finally {
      if (mounted.current) setWorking(false);
    }
  };

  return (
    <Group testId="autostart" name={copy.autostartHeading}>
      <ControlToggle
        shape="boxed"
        label={copy.autostart}
        hint={copy.autostartHint}
        data={{ "data-yunari-host-autostart": "" }}
        checked={enabled === true}
        disabled={enabled === undefined || working}
        onChange={(next) => void write(next)}
      />
      {answer === undefined ? null : (
        <p
          role={answer.ok ? "status" : "alert"}
          data-yunari-host-autostart-result={answer.ok ? "ok" : "failed"}
          className={`m-0 text-xs ${answer.ok ? "text-muted" : "text-warn"}`}
        >
          {answer.message}
        </p>
      )}
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
