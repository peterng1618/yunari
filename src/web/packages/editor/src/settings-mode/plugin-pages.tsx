import type {
  FrameInit,
  FrameRequest,
  InstalledExtension,
  SettingsField,
} from "@yunari/extension-api";
import { useEffect, useMemo, useState } from "react";
import { ControlSelect } from "../components/ui/control-select.js";
import {
  type ControlState,
  controlStateAttributes,
} from "../components/ui/control-state.js";
import { ControlToggle } from "../components/ui/control-toggle.js";
import { ControlWell } from "../components/ui/control-well.js";
import { ACTION_BUTTON } from "../components/ui/dialog.js";
import { PluginFrame } from "../plugin-frame/plugin-frame.js";
import { keyPath } from "../plugin-manager/use-extensions.js";
import { Page } from "./page.js";
import { Group } from "./section-group.js";

/**
 * One installed plugin's settings destination.
 *
 * A declarative page carries the closed field set the host validates against;
 * a sandboxed page carries the entry its own frame is served from. The two are
 * exclusive, which is what the manifest reader enforces.
 */
export interface PluginSettingsPage {
  readonly id: `plugin:${string}`;
  readonly pluginKey: string;
  readonly label: string;
  readonly section: string | undefined;
  readonly fields: readonly SettingsField[] | undefined;
  readonly ui: string | undefined;
}

/** Every settings page the installed plugins declare, in install order. */
export function pluginSettingsPages(
  extensions: readonly InstalledExtension[],
): readonly PluginSettingsPage[] {
  const pages: PluginSettingsPage[] = [];
  for (const extension of extensions) {
    for (const page of extension.contributions.settingsPages ?? []) {
      pages.push({
        id: `plugin:${extension.key}/${page.id}`,
        pluginKey: extension.key,
        label: page.label,
        section: page.section,
        fields: "fields" in page ? page.fields : undefined,
        ui: "ui" in page ? page.ui : undefined,
      });
    }
  }
  return pages;
}

/** The editor's read/write pair for one plugin's declarative settings. */
export interface PluginSettingsClient {
  read(pluginKey: string): Promise<Readonly<Record<string, unknown>>>;
  write(
    pluginKey: string,
    values: Readonly<Record<string, unknown>>,
  ): Promise<{ readonly ok: boolean; readonly message?: string }>;
}

export function createPluginSettingsClient(options?: {
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
}): PluginSettingsClient {
  const fetcher = options?.fetch ?? globalThis.fetch.bind(globalThis);
  const url = (path: string): string => `${options?.baseUrl ?? ""}${path}`;

  return {
    async read(pluginKey) {
      const response = await fetcher(
        url(`/api/extensions/${keyPath(pluginKey)}/settings`),
        { credentials: "same-origin" },
      );
      if (!response.ok)
        throw new Error(`The host answered ${response.status}.`);
      const body = (await response.json()) as { settings?: unknown };
      return typeof body.settings === "object" &&
        body.settings !== null &&
        !Array.isArray(body.settings)
        ? (body.settings as Readonly<Record<string, unknown>>)
        : {};
    },

    async write(pluginKey, values) {
      const response = await fetcher(
        url(`/api/extensions/${keyPath(pluginKey)}/settings`),
        {
          method: "PUT",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(values),
        },
      );
      const body = (await response.json().catch(() => undefined)) as
        | { ok?: unknown; message?: unknown }
        | undefined;
      if (response.ok && body?.ok !== false) return { ok: true };
      return {
        ok: false,
        message:
          typeof body?.message === "string"
            ? body.message
            : `The host answered ${response.status}.`,
      };
    },
  };
}

function initialValues(
  fields: readonly SettingsField[],
  stored: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = stored[field.key];
    if (field.type === "boolean") {
      values[field.key] =
        typeof raw === "boolean" ? raw : (field.default ?? false);
    } else if (field.type === "number") {
      values[field.key] =
        typeof raw === "number"
          ? String(raw)
          : field.default === undefined
            ? ""
            : String(field.default);
    } else {
      values[field.key] = typeof raw === "string" ? raw : (field.default ?? "");
    }
  }
  return values;
}

function payloadOf(
  fields: readonly SettingsField[],
  values: Readonly<Record<string, unknown>>,
):
  | { readonly ok: true; readonly values: Record<string, unknown> }
  | {
      readonly ok: false;
      readonly message: string;
    } {
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    const current = values[field.key];

    if (field.type === "boolean") {
      payload[field.key] = current === true;
      continue;
    }

    const text = typeof current === "string" ? current : "";
    if (field.type === "number") {
      if (text.trim() === "") continue;
      const parsed = Number(text);
      if (!Number.isFinite(parsed))
        return {
          ok: false,
          message: `The field ${JSON.stringify(field.key)} must be a number.`,
        };
      payload[field.key] = parsed;
      continue;
    }

    // A secret that was never typed is not written: saving the rest of the
    // page must not clear a stored secret the author did not see.
    if (field.type === "secret" && text === "") continue;
    payload[field.key] = text;
  }
  return { ok: true, values: payload };
}

/** One declarative page: the declared controls and one Save. */
export function PluginSettingsForm(props: {
  readonly page: PluginSettingsPage;
  readonly client?: PluginSettingsClient | undefined;
}): React.JSX.Element {
  const api = useMemo(
    () => props.client ?? createPluginSettingsClient(),
    [props.client],
  );
  const fields = props.page.fields ?? [];
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  /** The last write's outcome, kept beside its sentence: a read failure fills
   *  `message` before any press, so the button cannot infer its state from it. */
  const [controlState, setControlState] = useState<ControlState | undefined>(
    undefined,
  );

  useEffect(() => {
    let live = true;
    void api
      .read(props.page.pluginKey)
      .then((stored) => {
        if (live) setValues(initialValues(fields, stored));
      })
      .catch((failure: unknown) => {
        if (live)
          setMessage(
            failure instanceof Error ? failure.message : String(failure),
          );
      });
    return () => {
      live = false;
    };
  }, [api, props.page.pluginKey, fields]);

  const save = async (): Promise<void> => {
    const payload = payloadOf(fields, values);
    if (!payload.ok) {
      setMessage(payload.message);
      setControlState("failure");
      return;
    }

    setBusy(true);
    setControlState("busy");
    try {
      const result = await api.write(props.page.pluginKey, payload.values);
      setMessage(result.ok ? "Saved." : (result.message ?? "Not saved."));
      setControlState(result.ok ? "success" : "failure");
    } catch (failure: unknown) {
      setMessage(failure instanceof Error ? failure.message : String(failure));
      setControlState("failure");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page page={props.page.id} title={props.page.label}>
      <Group
        testId={`plugin-settings-${props.page.id}`}
        name={props.page.label}
      >
        {fields.map((field) => (
          <Field
            key={field.key}
            field={field}
            value={values[field.key]}
            onChange={(next) =>
              setValues((current) => ({ ...current, [field.key]: next }))
            }
          />
        ))}
        <div className="flex items-center gap-[var(--space-8)]">
          <button
            type="button"
            className={ACTION_BUTTON}
            disabled={busy}
            {...controlStateAttributes(controlState)}
            onClick={() => {
              void save();
            }}
          >
            Save
          </button>
          {message === undefined ? null : (
            <p role="status" className="m-0 text-xs text-muted">
              {message}
            </p>
          )}
        </div>
      </Group>
    </Page>
  );
}

function Field(props: {
  readonly field: SettingsField;
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
}): React.JSX.Element {
  const { field, value, onChange } = props;

  if (field.type === "boolean")
    return (
      <ControlToggle
        id={`plugin-field-${field.key}`}
        label={field.label}
        density="settings"
        checked={value === true}
        onChange={onChange}
      />
    );

  if (field.type === "select")
    return (
      <ControlSelect
        id={`plugin-field-${field.key}`}
        label={field.label}
        density="settings"
        value={typeof value === "string" ? value : ""}
        options={field.options.map((option) => ({
          id: option.value,
          name: option.label,
        }))}
        onChange={onChange}
      />
    );

  return (
    <label className="flex flex-col gap-[var(--space-4)]">
      <span className="text-xs text-muted">{field.label}</span>
      <ControlWell density="settings">
        <input
          aria-label={field.label}
          type={
            field.type === "secret"
              ? "password"
              : field.type === "number"
                ? "number"
                : "text"
          }
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          className="h-full w-full bg-transparent text-sm text-text outline-none"
        />
      </ControlWell>
    </label>
  );
}

/** A plugin page: its declarative form, or its sandboxed frame. */
export function PluginSettingsView(props: {
  readonly page: PluginSettingsPage;
  readonly theme: FrameInit["theme"];
  readonly onRequest: (
    request: FrameRequest,
    gestureToken: string | undefined,
  ) => Promise<unknown>;
}): React.JSX.Element {
  if (props.page.fields !== undefined)
    return <PluginSettingsForm page={props.page} />;

  if (props.page.ui !== undefined)
    return (
      <PluginFrame
        pluginKey={props.page.pluginKey}
        entry={props.page.ui}
        title={props.page.label}
        settings={{}}
        theme={props.theme}
        onRequest={props.onRequest}
        allowWrites
      />
    );

  return (
    <p className="text-xs text-muted">
      This settings page declares neither a form nor a frame.
    </p>
  );
}
