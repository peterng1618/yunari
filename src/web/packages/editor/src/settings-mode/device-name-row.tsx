import type * as React from "react";
import { useEffect, useState } from "react";
import {
  ControlRow,
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
    <ControlRow ids={ids} label={props.device.name} labelFor={ids.control}>
      <ControlWell>
        <input
          id={ids.control}
          type="text"
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
    </ControlRow>
  );
}
