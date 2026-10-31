import type * as React from "react";
import { useRef, useState } from "react";
import {
  plainButtonClasses,
  wellClasses,
} from "../components/ui/control-well.js";
import { ACTION_BUTTON, Dialog } from "../components/ui/dialog.js";
import { Glyph, PANEL_STATUS_GLYPHS } from "../editor-shell/icons.js";
import type { PanelConnectionStatus } from "../theme-library-client.js";
import { uiCopy } from "../ui-copy.js";
import type {
  EditorPanelCommand,
  PanelCommandKind,
  PanelHint,
} from "./client.js";
import { PanelFacts } from "./panels-section.js";
import { Group } from "./section-group.js";

/** The input's id, spelled here because the label's `htmlFor` and the field's
 *  `id` are one decision and two literals drift. */
const BRIGHTNESS_ID = "yunari-panel-brightness";

/** Where the field's own refusal lives, for `aria-describedby` to name. */
const LEVEL_ERROR_ID = "yunari-panel-brightness-error";

/** The stored settings' three fields, each named once for its label and id. */
const START_MODE_ID = "yunari-panel-start-mode";
const FLIP_ID = "yunari-panel-flip";
const SLEEP_DELAY_ID = "yunari-panel-sleep-delay";

/**
 * One panel display's connection and commands.
 *
 * **The status and the reconnect are drawn whether or not the device is
 * attached.** A panel that lost power, was restarted, or was taken by the
 * vendor app is exactly the one whose owner needs the state and the retake, and
 * the host reports both from the display record rather than from the attached
 * list.
 *
 * **The commands stay behind a door, and only while connected.** A restart is
 * two presses because it drops the panel for about fifteen seconds; a command
 * to a device the host does not hold would be a refusal for a press that could
 * not have worked.
 */
export function PanelControlsSection(props: {
  readonly displayId: string;
  /** The attached device's hint, when it is attached now: the hardware record
   *  beside the controls. Absent for a panel the host is retrying. */
  readonly panel: PanelHint | undefined;
  /** What the host says this display's device is doing, and what it accepts. */
  readonly connection: {
    readonly status: PanelConnectionStatus;
    readonly commands: readonly string[];
  };
  /** Stops and opens the device again. The caller re-reads the map afterwards. */
  readonly onReconnect: () => Promise<void>;
  readonly onCommand: (command: EditorPanelCommand) => Promise<string>;
}): React.JSX.Element {
  const copy = uiCopy.hostSettings.panels.controls;
  const [open, setOpen] = useState(false);
  /** The field's draft rather than a parsed value: an empty field and a typed
   *  non-number are both states the person is in, and neither is zero. */
  const [level, setLevel] = useState("");
  const [reply, setReply] = useState<string | undefined>(undefined);
  /** The field's own refusal, drawn beside the field it is about. */
  const [levelError, setLevelError] = useState<string | undefined>(undefined);
  /** The host's or the panel's own words, drawn at the dialog's foot. */
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [confirmingRestart, setConfirmingRestart] = useState(false);
  /** The panel's stored settings. The panel has no read-back, so the form opens
   *  at the defaults rather than at what the device is holding. */
  const [startMode, setStartMode] = useState<0 | 1 | 2>(0);
  const [flip, setFlip] = useState(false);
  const [sleepDelay, setSleepDelay] = useState(0);
  /** True while a command runs. A second press would be a second command, and
   *  two answers settling out of order would leave the earlier one standing. */
  const [inFlight, setInFlight] = useState(false);
  /** True while this surface's own reconnect is in flight. The poll's
   *  `connecting` state catches the retry loop's attempts; this one covers the
   *  press before the host answers. */
  const [reconnecting, setReconnecting] = useState(false);

  /** The newest command's number. A reply carrying an older number belongs to
   *  a command something has overtaken, or to one this dialog abandoned, and is
   *  dropped rather than shown as the last reply. */
  const latest = useRef(0);
  /** The same guard as `inFlight` in a form an event can read: two clicks in
   *  one frame would both see the state as it was before the first. */
  const busy = useRef(false);

  const status = props.connection.status;
  const connected = status === "connected";

  /** **Closing abandons what the visit showed.** The draft, the last reply and
   *  a refusal are this dialog's, not the panel's, so the door must not reopen
   *  holding an answer some other visit asked for. A command still in flight is
   *  orphaned by bumping `latest`. */
  const changeOpen = (next: boolean): void => {
    setOpen(next);
    if (next) return;
    latest.current += 1;
    busy.current = false;
    setInFlight(false);
    setLevel("");
    setLevelError(undefined);
    setFailure(undefined);
    setReply(undefined);
    setConfirmingRestart(false);
    setStartMode(0);
    setFlip(false);
    setSleepDelay(0);
  };

  const holds = (kind: PanelCommandKind): boolean =>
    props.connection.commands.includes(kind);

  const reconnect = (): void => {
    if (reconnecting) return;
    setReconnecting(true);
    setFailure(undefined);
    void props.onReconnect().then(
      () => setReconnecting(false),
      (reason: unknown) => {
        setReconnecting(false);
        setFailure(
          copy.reconnectFailed(
            reason instanceof Error ? reason.message : String(reason),
          ),
        );
      },
    );
  };

  const send = (command: EditorPanelCommand): void => {
    if (busy.current) return;
    busy.current = true;
    const ticket = ++latest.current;
    setInFlight(true);
    setFailure(undefined);
    setReply(undefined);
    void props.onCommand(command).then(
      (answer) => {
        if (ticket !== latest.current) return;
        busy.current = false;
        setInFlight(false);
        setReply(answer);
      },
      (reason: unknown) => {
        if (ticket !== latest.current) return;
        busy.current = false;
        setInFlight(false);
        setFailure(
          copy.failed(
            reason instanceof Error ? reason.message : String(reason),
          ),
        );
      },
    );
  };

  const applyLevel = (): void => {
    const trimmed = level.trim();
    const parsed = Number(trimmed);
    if (
      trimmed === "" ||
      !Number.isInteger(parsed) ||
      parsed < 0 ||
      parsed > 100
    ) {
      setLevelError(copy.brightnessRange);
      return;
    }
    setLevelError(undefined);
    send({ kind: "brightness", level: parsed });
  };

  return (
    <Group testId="panel-controls" name={copy.heading} hint={copy.hint}>
      <div className="flex items-center gap-[var(--space-8)]">
        <span
          data-yunari-panel-status={status}
          className={`flex items-center gap-[var(--space-4)] text-xs ${
            connected
              ? "text-text"
              : status === "connecting"
                ? "text-muted"
                : "text-warn"
          }`}
        >
          <span
            className={`flex-none ${status === "connecting" ? "animate-spin" : ""}`}
          >
            <Glyph icon={PANEL_STATUS_GLYPHS[status]} size={14} />
          </span>
          {copy.connection[status]}
        </span>
        <button
          type="button"
          data-yunari-panel-reconnect={props.displayId}
          className={plainButtonClasses}
          disabled={reconnecting || status === "connecting"}
          onClick={reconnect}
        >
          {reconnecting || status === "connecting"
            ? copy.reconnecting
            : copy.reconnect}
        </button>
      </div>
      {status === "disconnected" ? (
        <p className="m-0 text-2xs text-faint">{copy.disconnectedHint}</p>
      ) : null}

      {/* The record is a fact about the hardware rather than about a command,
          so it stands beside the door as well as inside it: a firmware the
          driver has not met is what a person needs *before* pressing. */}
      {props.panel === undefined ? null : <PanelFacts panel={props.panel} />}

      {connected &&
      props.panel !== undefined &&
      props.connection.commands.length > 0 ? (
        <>
          <button
            type="button"
            data-yunari-panel-controls={props.displayId}
            aria-expanded={open}
            className={plainButtonClasses}
            onClick={() => changeOpen(true)}
          >
            {copy.open}
          </button>
          <Dialog
            open={open}
            onOpenChange={changeOpen}
            label={copy.dialogTitle(props.panel.label)}
            closeLabel={copy.close}
          >
            <div className="flex flex-col gap-[var(--space-12)]">
              {holds("brightness") ? (
                <div className="flex flex-col gap-[var(--space-6)]">
                  <label htmlFor={BRIGHTNESS_ID} className="text-xs text-muted">
                    {copy.brightness}
                  </label>
                  <p className="m-0 text-2xs text-faint">
                    {copy.brightnessHint}
                  </p>
                  <div className="flex items-center gap-[var(--space-6)]">
                    <div className={wellClasses("dialog")}>
                      <input
                        id={BRIGHTNESS_ID}
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={level}
                        onChange={(event) => {
                          setLevel(event.target.value);
                          setLevelError(undefined);
                        }}
                        aria-invalid={
                          levelError === undefined ? undefined : true
                        }
                        {...(levelError === undefined
                          ? {}
                          : { "aria-describedby": LEVEL_ERROR_ID })}
                        className="h-full w-full min-w-0 bg-transparent text-xs text-text outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      className={ACTION_BUTTON}
                      disabled={inFlight}
                      onClick={applyLevel}
                    >
                      {copy.apply}
                    </button>
                  </div>
                  {/* Beside the field, because the refusal is about the value
                  typed in it: a sentence at the dialog's foot would be read
                  after every other control. */}
                  {levelError === undefined ? null : (
                    <p
                      id={LEVEL_ERROR_ID}
                      role="alert"
                      className="m-0 text-xs text-warn"
                    >
                      {levelError}
                    </p>
                  )}
                </div>
              ) : null}

              {holds("screen") ? (
                <div className="flex gap-[var(--space-6)]">
                  <button
                    type="button"
                    className={ACTION_BUTTON}
                    disabled={inFlight}
                    onClick={() => send({ kind: "screen", on: true })}
                  >
                    {copy.screenOn}
                  </button>
                  <button
                    type="button"
                    className={ACTION_BUTTON}
                    disabled={inFlight}
                    onClick={() => send({ kind: "screen", on: false })}
                  >
                    {copy.screenOff}
                  </button>
                </div>
              ) : null}

              {holds("panel-settings") ? (
                <div className="flex flex-col gap-[var(--space-6)]">
                  <div className="flex flex-col gap-[var(--space-4)]">
                    <span className="text-xs text-muted">
                      {copy.settingsHeading}
                    </span>
                    <p className="m-0 text-2xs text-faint">
                      {copy.settingsHint}
                    </p>
                  </div>
                  <div className="flex flex-col gap-[var(--space-4)]">
                    <label
                      htmlFor={START_MODE_ID}
                      className="text-xs text-muted"
                    >
                      {copy.startMode}
                    </label>
                    <select
                      id={START_MODE_ID}
                      data-yunari-panel-start-mode=""
                      value={String(startMode)}
                      onChange={(event) =>
                        setStartMode(Number(event.target.value) as 0 | 1 | 2)
                      }
                      className="h-[26px] rounded-md border border-edge bg-panel-1 px-[var(--space-6)] text-sm text-text"
                    >
                      {copy.startModeOptions.map((label, mode) => (
                        <option key={label} value={String(mode)}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-[var(--space-4)]">
                    <label
                      htmlFor={SLEEP_DELAY_ID}
                      className="text-xs text-muted"
                    >
                      {copy.sleepDelay}
                    </label>
                    <select
                      id={SLEEP_DELAY_ID}
                      data-yunari-panel-sleep-delay=""
                      value={String(sleepDelay)}
                      onChange={(event) =>
                        setSleepDelay(Number(event.target.value))
                      }
                      className="h-[26px] rounded-md border border-edge bg-panel-1 px-[var(--space-6)] text-sm text-text"
                    >
                      {copy.sleepDelayOptions.map((label, step) => (
                        <option key={label} value={String(step)}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label
                    htmlFor={FLIP_ID}
                    className="flex items-center gap-[var(--space-8)]"
                  >
                    <input
                      id={FLIP_ID}
                      type="checkbox"
                      checked={flip}
                      data-yunari-panel-flip=""
                      onChange={(event) => setFlip(event.target.checked)}
                      className="size-4 flex-none accent-accent"
                    />
                    <span className="text-xs text-text">{copy.flip}</span>
                  </label>
                  <button
                    type="button"
                    className={ACTION_BUTTON}
                    disabled={inFlight}
                    onClick={() =>
                      send({
                        kind: "panel-settings",
                        startMode,
                        flip,
                        sleepDelay,
                      })
                    }
                  >
                    {copy.applySettings}
                  </button>
                </div>
              ) : null}

              {holds("restart") ? (
                confirmingRestart ? (
                  <div className="flex flex-col gap-[var(--space-6)]">
                    <p className="m-0 text-xs text-muted">
                      {copy.restartWarning}
                    </p>
                    <div className="flex gap-[var(--space-6)]">
                      <button
                        type="button"
                        className={ACTION_BUTTON}
                        disabled={inFlight}
                        onClick={() => {
                          setConfirmingRestart(false);
                          send({ kind: "restart" });
                        }}
                      >
                        {copy.confirmRestart}
                      </button>
                      <button
                        type="button"
                        className={ACTION_BUTTON}
                        onClick={() => setConfirmingRestart(false)}
                      >
                        {copy.cancel}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={ACTION_BUTTON}
                    onClick={() => setConfirmingRestart(true)}
                  >
                    {copy.restart}
                  </button>
                )
              ) : null}

              {holds("status") || holds("hello") ? (
                <div className="flex gap-[var(--space-6)]">
                  {holds("status") ? (
                    <button
                      type="button"
                      className={ACTION_BUTTON}
                      disabled={inFlight}
                      onClick={() => send({ kind: "status" })}
                    >
                      {copy.status}
                    </button>
                  ) : null}
                  {holds("hello") ? (
                    <button
                      type="button"
                      className={ACTION_BUTTON}
                      disabled={inFlight}
                      onClick={() => send({ kind: "hello" })}
                    >
                      {copy.hello}
                    </button>
                  ) : null}
                </div>
              ) : null}

              {/* One live region that is always mounted: a node inserted with its
              text announces nothing, and what the device says back is the one
              thing here nobody can infer. A write-only command has no reply —
              "Sent" is the host confirming the bytes went, not the panel
              talking — so the label names which of the two is showing. */}
              <div className="flex flex-col gap-[var(--space-4)]">
                <span className="text-2xs text-faint">
                  {reply === undefined || reply === ""
                    ? copy.commandLabel
                    : copy.replyLabel}
                </span>
                <p
                  data-yunari-panel-reply=""
                  aria-live="polite"
                  className="m-0 text-xs text-text"
                >
                  {reply === undefined ? "" : reply === "" ? copy.sent : reply}
                </p>
              </div>

              {failure === undefined ? null : (
                <p role="alert" className="m-0 text-xs text-warn">
                  {failure}
                </p>
              )}
            </div>
          </Dialog>
        </>
      ) : null}

      {/* A reconnect failure is drawn outside the door, because the door does
          not exist while disconnected — the state this press is about. */}
      {connected || failure === undefined ? null : (
        <p role="alert" className="m-0 text-xs text-warn">
          {failure}
        </p>
      )}
    </Group>
  );
}
