import type {
  InstalledExtension,
  PluginContributions,
} from "@yunari/extension-api";
import type * as React from "react";
import { ACTION_BUTTON } from "../components/ui/dialog.js";
import { Page } from "../settings-mode/page.js";
import { Group } from "../settings-mode/section-group.js";
import { uiCopy } from "../ui-copy.js";
import { type EditorProviderOrder, useExtensions } from "./use-extensions.js";

export interface PluginManagerProps {
  readonly extensions: readonly InstalledExtension[];
  readonly providerOrder: EditorProviderOrder;
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly onInstall: (file: File) => void;
  readonly onGrant: (key: string, fingerprint: string) => void;
  readonly onRemove: (key: string) => void;
  readonly onReorderProvider: (key: string, direction: -1 | 1) => void;
}

const CONTRIBUTION_GROUPS = [
  "sensorProviders",
  "assetCategories",
  "assetSources",
  "panelFamilies",
  "settingsPages",
  "customSources",
] as const;

/** Every contribution a plugin names, as `group:id`. Plain strings: a
 *  contribution id is a plugin's own word, never markup. */
export function contributionNames(
  contributions: PluginContributions,
): readonly string[] {
  const names: string[] = [];
  for (const group of CONTRIBUTION_GROUPS) {
    for (const entry of contributions[group] ?? []) {
      const id = (entry as Readonly<Record<string, unknown>>)["id"];
      if (typeof id === "string") names.push(`${group}:${id}`);
    }
  }
  return names;
}

function deviceIds(contributions: PluginContributions): readonly string[] {
  return (contributions.panelFamilies ?? []).map(
    (family) =>
      `${family.vendorId.toString(16).padStart(4, "0")}:${family.productId
        .toString(16)
        .padStart(4, "0")}`,
  );
}

function panelCommands(contributions: PluginContributions): readonly string[] {
  return [
    ...new Set(
      (contributions.panelFamilies ?? []).flatMap((family) => family.commands),
    ),
  ];
}

function ExtensionRow(props: {
  readonly extension: InstalledExtension;
  readonly busy: boolean;
  readonly onGrant: (key: string, fingerprint: string) => void;
  readonly onRemove: (key: string) => void;
}): React.JSX.Element {
  const { extension } = props;
  const names = contributionNames(extension.contributions);
  const devices = deviceIds(extension.contributions);
  const commands = panelCommands(extension.contributions);

  return (
    <div
      data-yunari-extension-row={extension.key}
      className="flex flex-col gap-[var(--space-4)] rounded-md border border-edge bg-panel-2 p-[var(--space-12)]"
    >
      <p className="m-0 text-sm font-semibold text-text">{extension.name}</p>
      <p className="m-0 text-xs text-muted">
        {extension.key} · {extension.version} · {extension.execution}
      </p>
      <p className="m-0 text-xs text-muted">
        {uiCopy.settings.extensions.capabilities}:{" "}
        {extension.capabilities.join(", ")}
      </p>
      <p className="m-0 text-xs text-muted">
        {uiCopy.settings.extensions.contributions}:{" "}
        {names.length === 0 ? "none" : names.join(", ")}
      </p>
      <p className="m-0 text-xs text-muted">
        {uiCopy.settings.extensions.devices}:{" "}
        {devices.length === 0 ? "none declared" : devices.join(", ")}
      </p>
      <p className="m-0 text-xs text-muted">
        {uiCopy.settings.extensions.commands}:{" "}
        {commands.length === 0 ? "none" : commands.join(", ")}
      </p>
      <div className="flex flex-wrap items-center gap-[var(--space-8)]">
        {extension.consent === "missing" ? (
          <button
            type="button"
            disabled={props.busy}
            className={ACTION_BUTTON}
            onClick={() => props.onGrant(extension.key, extension.fingerprint)}
          >
            Approve
          </button>
        ) : (
          <span className="text-xs text-muted">
            {uiCopy.settings.extensions.consent[extension.consent]}
          </span>
        )}
        <button
          type="button"
          disabled={props.busy}
          className={ACTION_BUTTON}
          onClick={() => {
            if (window.confirm(`Remove ${extension.name} (${extension.key})?`))
              props.onRemove(extension.key);
          }}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

/**
 * The Extensions page: install a package, read what each one asks for, and
 * approve or remove it. Everything a plugin supplies is drawn as text; a name
 * is never markup.
 */
export function PluginManager(props: PluginManagerProps): React.JSX.Element {
  const copy = uiCopy.settings.extensions;
  const order = props.providerOrder.pluginOrder;

  return (
    <Page page="extensions">
      {props.error === undefined ? null : (
        <p role="alert" className="m-0 text-xs text-danger">
          {props.error}
        </p>
      )}

      <Group
        testId="extensions-install"
        name={copy.installHeading}
        hint={copy.installHint}
      >
        <label className="flex flex-col gap-[var(--space-4)] text-xs text-muted">
          {copy.installLabel}
          <input
            type="file"
            accept=".zip,application/zip"
            aria-label="Install extension"
            disabled={props.busy}
            className="text-xs text-text"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) props.onInstall(file);
            }}
          />
        </label>
      </Group>

      <Group testId="extensions-installed" name={copy.installedHeading}>
        {props.extensions.length === 0 ? (
          <p className="m-0 text-xs text-muted">{copy.empty}</p>
        ) : (
          props.extensions.map((extension) => (
            <ExtensionRow
              key={extension.key}
              extension={extension}
              busy={props.busy}
              onGrant={props.onGrant}
              onRemove={props.onRemove}
            />
          ))
        )}
      </Group>

      <Group
        testId="extensions-provider-order"
        name={copy.providerHeading}
        hint={copy.providerHint}
      >
        {order.length === 0 ? (
          <p className="m-0 text-xs text-muted">{copy.noProviders}</p>
        ) : (
          order.map((key) => (
            <div
              key={key}
              data-yunari-provider-row={key}
              className="flex flex-wrap items-center gap-[var(--space-8)] text-xs text-text"
            >
              <span>{key}</span>
              <button
                type="button"
                disabled={props.busy}
                aria-label={`Move ${key} up`}
                className={ACTION_BUTTON}
                onClick={() => props.onReorderProvider(key, -1)}
              >
                Move up
              </button>
              <button
                type="button"
                disabled={props.busy}
                aria-label={`Move ${key} down`}
                className={ACTION_BUTTON}
                onClick={() => props.onReorderProvider(key, 1)}
              >
                Move down
              </button>
            </div>
          ))
        )}
      </Group>
    </Page>
  );
}

/** The page the Settings region mounts: the client, its state, and the
 *  presentational manager above. */
export function ExtensionsPage(): React.JSX.Element {
  const state = useExtensions();
  return (
    <PluginManager
      extensions={state.extensions}
      providerOrder={state.providerOrder}
      busy={state.busy}
      error={state.error}
      onInstall={(file) => {
        void state.install(file);
      }}
      onGrant={(key, fingerprint) => {
        void state.grant(key, fingerprint);
      }}
      onRemove={(key) => {
        void state.remove(key);
      }}
      onReorderProvider={(key, direction) => {
        void state.reorderProvider(key, direction);
      }}
    />
  );
}
