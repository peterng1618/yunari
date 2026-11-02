import type { SensorKeyStatus } from "../../sensor-key-options.js";

/** A reading's state, in the gutter before its name. The colour is the fast
 *  read; the option's accessible name carries the same state. */
export function SensorKeyDot({
  status,
}: {
  readonly status: SensorKeyStatus;
}): React.JSX.Element {
  return (
    <span
      aria-hidden
      className="editor-shell-sensor-dot"
      data-status={status}
    />
  );
}
