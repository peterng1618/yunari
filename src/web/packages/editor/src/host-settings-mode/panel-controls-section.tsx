import type * as React from "react";
import { useRef, useState } from "react";
import {
  plainButtonClasses,
  wellClasses,
} from "../components/ui/control-well.js";
import { ACTION_BUTTON, Dialog } from "../components/ui/dialog.js";
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

/**
 * The commands a display's panel accepts, behind a door.
 *
 * **Nothing renders unless this panel is the one that display drives** and the
 * host says it takes at least one command — the section's own contract, so it
 * can be mounted and tested without the region, and so a picture-only panel
 * draws no controls it could not answer.
 *
 * **A restart is two presses.** It drops the panel for about fifteen seconds,
 * which is not something a stray click should do, so the first press only
 * asks and the warning is the words beside the confirm.
 *
 * **The level is refused here, not sent and refused by the host.** The panel's
 * range is a whole percent, so a value outside it is a typo the person can fix
 * without a round trip; a refusal that does come back — a closing port is a
 * 409 with the host's own sentence — is shown inline in those words and not
 * retried.
 */
export function PanelControlsSection(props: {
  readonly displayId: string;
  readonly panel: PanelHint;
  readonly onCommand: (command: EditorPanelCommand) => Promise<string>;
}): React.JSX.Element | null {
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
  /** True while a command runs. A second press would be a second command, and
   *  two answers settling out of order would leave the earlier one standing. */
  const [inFlight, setInFlight] = useState(false);

  /** The newest command's number. A reply carrying an older number belongs to
   *  a command something has overtaken, or to one this dialog abandoned, and is
   *  dropped rather than shown as the last reply. */
  const latest = useRef(0);
  /** The same guard as `inFlight` in a form an event can read: two clicks in
   *  one frame would both see the state as it was before the first. */
  const busy = useRef(false);

  if (
    props.panel.heldId !== props.displayId ||
    props.panel.commands.length === 0
  ) {
    return null;
  }

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
  };

  const holds = (kind: PanelCommandKind): boolean =>
    props.panel.commands.includes(kind);

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
      {/* The record is a fact about the hardware rather than about a command,
          so it stands beside the door as well as inside it: a firmware the
          driver has not met is what a person needs *before* pressing. */}
      <PanelFacts panel={props.panel} />
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
              <p className="m-0 text-2xs text-faint">{copy.brightnessHint}</p>
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
                    aria-invalid={levelError === undefined ? undefined : true}
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

          {holds("restart") ? (
            confirmingRestart ? (
              <div className="flex flex-col gap-[var(--space-6)]">
                <p className="m-0 text-xs text-muted">{copy.restartWarning}</p>
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
              text announces nothing, and the panel's own answer is the one
              thing here nobody can infer. */}
          <div className="flex flex-col gap-[var(--space-2)]">
            <span className="text-2xs text-faint">{copy.lastReply}</span>
            <p
              data-yunari-panel-reply=""
              aria-live="polite"
              className="m-0 text-xs text-text"
            >
              {reply ?? ""}
            </p>
          </div>

          {failure === undefined ? null : (
            <p role="alert" className="m-0 text-xs text-warn">
              {failure}
            </p>
          )}
        </div>
      </Dialog>
    </Group>
  );
}
