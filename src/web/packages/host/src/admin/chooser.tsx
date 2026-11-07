import type * as React from "react";
import { useEffect, useState } from "react";
import { themeForDisplay } from "../../public/theme-fallback.js";
import {
  type ChooserClient,
  type ChooserData,
  type ChooserDisplay,
  type ChooserTemplate,
  createChooserClient,
} from "./client.js";
import { ThemeRow } from "./theme-row.js";

/** The key the route gives the default a display with no choice of its own
 *  falls to. */
const DEFAULT_KEY = "default";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What a display row says it holds. A display with no entry of its own is
 *  served the default, so "nothing" would be a lie about the screen; the
 *  default row is the fallback itself and is the one that holds nothing. */
function heldText(
  theme: string | null,
  isDefault: boolean,
  nameOf: (id: string) => string,
): string {
  if (theme === null) {
    return isDefault ? "Nothing chosen" : "Uses the default";
  }
  return nameOf(theme);
}

function GroupLabel({
  children,
}: {
  readonly children: string;
}): React.JSX.Element {
  return <p className="theme-group-label">{children}</p>;
}

function TemplateRow({
  template,
}: {
  readonly template: ChooserTemplate;
}): React.JSX.Element {
  return (
    // A template has no stored package, so the thumbnail route cannot answer
    // for it and the reserved space is drawn directly — asking would be a 404.
    <a
      className="theme-option"
      data-template={template.id}
      href={`/editor/?template=${encodeURIComponent(template.id)}`}
    >
      <div className="theme-shot" data-placeholder="" />
      <span className="theme-text">
        {template.name}
        <span className="by">Opens in the editor</span>
      </span>
    </a>
  );
}

/**
 * The chooser the host serves at `/` while nothing is chosen for the caller and
 * the store holds several themes.
 *
 * **One column of choices and no navigation.** A theme is given *to a display*,
 * so the display is selected above the rows that offer one; the default leads
 * because it is what every display with no choice of its own already gets.
 * Choosing writes `/api/themes/active` and reloads, which is how the host
 * resolves the caller to the dashboard it asked for.
 */
export function Chooser({
  client: provided,
  reload = () => window.location.reload(),
}: {
  readonly client?: ChooserClient;
  readonly reload?: () => void;
}): React.JSX.Element {
  // Created once. A client rebuilt on every render would give the read effect a
  // new dependency each time, and its `setData` would re-run it forever.
  const [client] = useState<ChooserClient>(
    () => provided ?? createChooserClient(),
  );
  const [data, setData] = useState<ChooserData | undefined>(undefined);
  const [selected, setSelected] = useState(DEFAULT_KEY);
  const [status, setStatus] = useState<string | undefined>(undefined);

  useEffect(() => {
    let live = true;
    client.read().then(
      (read) => {
        if (live) setData(read);
      },
      (error: unknown) => {
        if (live) {
          setStatus("The saved themes could not be read. Reload to try again.");
          console.warn(message(error));
        }
      },
    );
    return () => {
      live = false;
    };
  }, [client]);

  const themes = data?.themes ?? [];
  const templates = data?.templates ?? [];
  const displays = data?.displays ?? [];
  const fallback = data?.default ?? null;
  const nameOf = (id: string): string =>
    themes.find((theme) => theme.id === id)?.name ?? id;

  const selectedDisplay: ChooserDisplay | undefined =
    selected === DEFAULT_KEY
      ? undefined
      : displays.find((display) => display.id === selected);
  const own =
    selected === DEFAULT_KEY ? fallback : (selectedDisplay?.theme ?? null);
  const showing = themeForDisplay(own, fallback) ?? null;
  const assignedKind = selectedDisplay?.kind ?? "default";

  const choose = async (id: string): Promise<void> => {
    setStatus("Saving…");
    try {
      await client.choose(selected, id);
      // The host now resolves this display to the theme just chosen, so the
      // reload lands on the dashboard the consumer asked for.
      reload();
    } catch (error) {
      setStatus(`Could not save: ${message(error)}`);
    }
  };

  const remove = async (id: string): Promise<void> => {
    await client.remove(id);
    // Gone from the listing, because the host has it no more and the row would
    // otherwise offer to choose what is not there.
    setData((current) =>
      current === undefined
        ? current
        : {
            ...current,
            themes: current.themes.filter((theme) => theme.id !== id),
          },
    );
  };

  const editorHref =
    showing === null
      ? "/editor/"
      : `/editor/?theme=${encodeURIComponent(showing)}`;

  return (
    <main>
      <h1>Choose a theme</h1>
      <p className="lead">
        The Host has several saved themes. Pick the theme a display should show,
        or start from the template the product ships.
      </p>

      <div id="themes">
        <GroupLabel>Displays</GroupLabel>
        <div className="theme-list">
          <button
            type="button"
            className="theme-option"
            data-display={DEFAULT_KEY}
            aria-pressed={selected === DEFAULT_KEY}
            onClick={() => setSelected(DEFAULT_KEY)}
          >
            <span className="theme-text">
              Default
              <span className="by">{heldText(fallback, true, nameOf)}</span>
            </span>
          </button>
          {displays.map((display) => (
            <button
              key={display.id}
              type="button"
              className="theme-option"
              data-display={display.id}
              aria-pressed={selected === display.id}
              onClick={() => setSelected(display.id)}
            >
              <span className="theme-text">
                {display.label}
                <span className="by">
                  {heldText(display.theme, false, nameOf)}
                </span>
              </span>
            </button>
          ))}
        </div>

        {templates.length > 0 ? <GroupLabel>Templates</GroupLabel> : null}
        {templates.map((template) => (
          <TemplateRow key={template.id} template={template} />
        ))}

        {/* The label separates the choices from the display column above them,
            and with nothing saved the empty group would be a heading over no
            rows. */}
        {themes.length > 0 ? <GroupLabel>Your themes</GroupLabel> : null}
        {themes.map((theme) => {
          const named = theme.name ?? theme.id;
          const shared =
            themes.filter((other) => (other.name ?? other.id) === named)
              .length > 1;
          return (
            <ThemeRow
              key={theme.id}
              theme={theme}
              showing={showing}
              kind={assignedKind}
              shared={shared}
              onChoose={() => void choose(theme.id)}
              onRemove={() => remove(theme.id)}
            />
          );
        })}
      </div>

      <p className="elsewhere">
        Building a theme, or changing one?{" "}
        <a id="editor-link" href={editorHref}>
          Open the editor
        </a>
        .
      </p>
      <div id="status" role="status">
        {status ?? null}
      </div>
    </main>
  );
}
