import { useState, useSyncExternalStore } from "react";
import { ControlIconButton } from "../../components/ui/control-icon-button.js";
import { ControlWell } from "../../components/ui/control-well.js";
import { ACTION_BUTTON } from "../../components/ui/dialog.js";
import { Glyph, MINUS_GLYPH } from "../../editor-shell/icons.js";
import { PATH_PRESET_IDS, PATH_PRESETS } from "../../new-object-defaults.js";
import { PathGlyph } from "../../panes/add/path-glyph.js";
import {
  activeRemovedPathPresetIds,
  activeUserPathPresets,
  clearRemovedPathPresetIds,
  removedPathPresetIdsKey,
  setActiveRemovedPathPresetIds,
  setActiveUserPathPresets,
  subscribeRemovedPathPresetIds,
  subscribeUserPathPresets,
  type UserPathPreset,
  userPathPresetFrom,
  userPathPresetsKey,
  writeRemovedPathPresetIds,
  writeUserPathPresets,
} from "../../path-presets.js";
import { uiCopy } from "../../ui-copy.js";
import { Page } from "../page.js";
import { Group } from "../section-group.js";

/**
 * The Add pane's shapes: the shipped presets and the author's custom ones.
 *
 * **A shipped preset is removable.** It is Add-pane vocabulary rather than
 * authored state, but an author who never draws an arc should not carry it in
 * the menu; the removal is author state of its own. Restore defaults brings
 * back every removed built-in and leaves the author's presets untouched, which
 * is why the two lists are stored under separate keys.
 */
export function PathPresetsPage(props: {
  readonly storage: Storage | undefined;
}): React.JSX.Element {
  return (
    <Page page="path-presets">
      <Group
        testId="path-presets"
        name={uiCopy.settings.pathPresetsHeading}
        hint={uiCopy.settings.pathPresetsHint}
      >
        <PathPresetsSection storage={props.storage} />
      </Group>
    </Page>
  );
}

function PathPresetsSection(props: {
  readonly storage: Storage | undefined;
}): React.JSX.Element {
  useSyncExternalStore(subscribeUserPathPresets, userPathPresetsKey);
  useSyncExternalStore(subscribeRemovedPathPresetIds, removedPathPresetIdsKey);
  const presets = activeUserPathPresets();
  const removed = activeRemovedPathPresetIds();
  const builtins = PATH_PRESET_IDS.filter((id) => !removed.includes(id));
  const [name, setName] = useState("");
  const [data, setData] = useState("");
  const [reason, setReason] = useState<string | undefined>(undefined);
  const [persisted, setPersisted] = useState<boolean | undefined>(undefined);

  /** Storage first, then the live list, as the preview catalogue writes: a
   *  failed write still leaves the session's list changed. */
  const commit = (next: readonly UserPathPreset[]): void => {
    setPersisted(writeUserPathPresets(props.storage, next));
    setActiveUserPathPresets(next);
  };

  const add = (): void => {
    const candidate = userPathPresetFrom(name, data);
    if ("reason" in candidate) {
      setReason(
        candidate.reason === "name"
          ? uiCopy.settings.pathPresetNameRequired
          : candidate.reason === "data"
            ? uiCopy.settings.pathPresetDataRequired
            : candidate.reason === "unreadable"
              ? uiCopy.settings.pathPresetUnreadable
              : uiCopy.settings.pathPresetDrawsNothing,
      );
      return;
    }
    setReason(undefined);
    setName("");
    setData("");
    commit([...presets, candidate]);
  };

  const remove = (id: string): void => {
    setReason(undefined);
    commit(presets.filter((preset) => preset.id !== id));
  };

  /** Removing a built-in writes the removals list, not the author's presets. */
  const removeBuiltin = (id: string): void => {
    setReason(undefined);
    const next = [...removed, id];
    setPersisted(writeRemovedPathPresetIds(props.storage, next));
    setActiveRemovedPathPresetIds(next);
  };

  /** Every built-in back, the author's own list as it was. */
  const restoreDefaults = (): void => {
    setReason(undefined);
    setPersisted(clearRemovedPathPresetIds(props.storage));
    setActiveRemovedPathPresetIds([]);
  };

  return (
    <div
      className="flex flex-col gap-[var(--space-8)]"
      data-yunari-path-presets=""
    >
      <div className="flex flex-col gap-[var(--space-4)]">
        {builtins.map((id) => (
          <div
            key={id}
            className="flex items-center gap-[var(--space-8)] rounded-[var(--radius-sm)] border border-edge bg-[var(--panel-2)] px-[var(--space-10)] py-[var(--space-4)]"
            data-yunari-path-preset-builtin={id}
          >
            <span className="flex h-5 w-5 items-center justify-center text-text">
              <PathGlyph
                data={PATH_PRESETS[id].data}
                paint={PATH_PRESETS[id].paint}
              />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm">
              {uiCopy.pathPresets[id]}
            </span>
            <ControlIconButton
              label={`${uiCopy.settings.pathPresetRemoveBuiltin} ${uiCopy.pathPresets[id]}`}
              data={{ "data-yunari-path-preset-builtin-remove": id }}
              onClick={() => removeBuiltin(id)}
            >
              <Glyph icon={MINUS_GLYPH} size={14} />
            </ControlIconButton>
          </div>
        ))}
        {presets.map((preset) => (
          <div
            key={preset.id}
            className="flex items-center gap-[var(--space-8)] rounded-[var(--radius-sm)] border border-edge bg-[var(--panel-2)] px-[var(--space-10)] py-[var(--space-4)]"
            data-yunari-path-preset={preset.id}
          >
            <span className="flex h-5 w-5 items-center justify-center text-text">
              <PathGlyph data={preset.data} paint={preset.paint} />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm">
              {preset.label}
            </span>
            <ControlIconButton
              label={`${uiCopy.settings.pathPresetRemove} ${preset.label}`}
              data={{ "data-yunari-path-preset-remove": preset.id }}
              onClick={() => remove(preset.id)}
            >
              <Glyph icon={MINUS_GLYPH} size={14} />
            </ControlIconButton>
          </div>
        ))}
        {builtins.length === 0 && presets.length === 0 ? (
          <p className="text-sm text-muted">
            {uiCopy.settings.pathPresetEmpty}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-start gap-[var(--space-8)]">
        <ControlWell density="dialog" widthClassName="min-w-[8rem] flex-1">
          <input
            type="text"
            aria-label={uiCopy.settings.pathPresetNameField}
            placeholder={uiCopy.settings.pathPresetNamePlaceholder}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setReason(undefined);
            }}
            data-yunari-path-preset-name=""
            className="h-full w-full min-w-0 bg-transparent text-sm text-text outline-none"
          />
        </ControlWell>
        <ControlWell density="dialog" widthClassName="min-w-[12rem] flex-[2]">
          <textarea
            aria-label={uiCopy.settings.pathPresetDataField}
            placeholder={uiCopy.settings.pathPresetDataPlaceholder}
            value={data}
            rows={2}
            onChange={(event) => {
              setData(event.target.value);
              setReason(undefined);
            }}
            data-yunari-path-preset-data=""
            className="h-full w-full min-w-0 resize-none bg-transparent font-mono text-sm text-text outline-none"
          />
        </ControlWell>
        <button
          type="button"
          onClick={add}
          data-yunari-path-preset-add=""
          className={ACTION_BUTTON}
        >
          {uiCopy.settings.pathPresetAdd}
        </button>
        <button
          type="button"
          disabled={removed.length === 0}
          onClick={restoreDefaults}
          data-yunari-path-preset-restore=""
          className={ACTION_BUTTON}
        >
          {uiCopy.settings.restoreDefaults}
        </button>
      </div>
      {reason === undefined ? null : (
        <p className="text-sm" role="alert" data-yunari-path-preset-reason="">
          {reason}
        </p>
      )}
      {props.storage === undefined || persisted === false ? (
        <p className="text-sm text-muted">
          {uiCopy.settings.pathPresetsSessionOnly}
        </p>
      ) : null}
    </div>
  );
}
