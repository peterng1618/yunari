import type * as React from "react";
import { useEffect, useState } from "react";
import {
  ControlWell,
  useComposingGuard,
  useControlIds,
} from "../components/ui/control-well.js";
import { uiCopy } from "../ui-copy.js";
import type { AvailableDevice } from "./client.js";

/**
 * One device's name, as a draft that commits on the way out.
 *
 * **A keystroke writes a draft and not the setting.** The host rewrites the
 * whole settings file on a write, so committing per character would be one
 * rewrite per letter — and `change` is the moment the page this absorbs commits
 * on. Enter commits by leaving the field, which is the same act.
 */
export function DeviceNameRow(props: {
  readonly device: AvailableDevice;
  readonly value: string;
  readonly onCommit: (name: string) => void;
}): React.JSX.Element {
  const ids = useControlIds(`yunari-host-name-${props.device.id}`);
  const [draft, setDraft] = useState(props.value);
  const composing = useComposingGuard();

  // The stored name is what the field shows: the host trims it and caps it at
  // 48 characters, so a save that came back different has to reach the field
  // rather than leave the untrimmed text standing.
  useEffect(() => setDraft(props.value), [props.value]);

  const commit = (): void => {
    if (draft !== props.value) props.onCommit(draft);
  };

  return (
    // **The device's own name is the field's label, above the well.** A
    // reported name is a sentence, not a 74px field heading: stacked, a long
    // card or drive name reads once and the well keeps the full column width.
    <div className="flex min-w-0 flex-col gap-[var(--space-4)]">
      <label
        id={ids.label}
        htmlFor={ids.control}
        className="break-words text-xs text-muted"
      >
        {props.device.name}
      </label>
      <ControlWell>
        <input
          id={ids.control}
          type="text"
          aria-labelledby={ids.label}
          data-yunari-host-name={props.device.id}
          placeholder={uiCopy.hostSettings.devices.namePlaceholder}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onCompositionStart={composing.onCompositionStart}
          onCompositionEnd={composing.onCompositionEnd}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            if (composing.isComposing(event)) return;
            event.preventDefault();
            commit();
          }}
          className="h-full w-full bg-transparent text-sm text-text outline-none"
        />
      </ControlWell>
    </div>
  );
}
