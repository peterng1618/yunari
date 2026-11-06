import { Tabs } from "@base-ui/react/tabs";
import type * as React from "react";
import { Fragment, useEffect, useRef, useState } from "react";
import { Glyph } from "../editor-shell/icons.js";
import type { ShellPalette } from "../editor-shell/palette.js";
import type { ShellMode } from "../editor-shell/shell-layout.js";
import { ExtensionsPage } from "../plugin-manager/plugin-manager.js";
import type { ShortcutOverrides } from "../shortcut-manager/bindings.js";
import type { ThemeLibraryClient } from "../theme-library-client.js";
import { uiCopy } from "../ui-copy.js";
import type { HostSettingsClient } from "./client.js";
import { useHostSettings } from "./host-state.js";
import { SETTINGS_GROUPS, SETTINGS_PAGES, type SettingsPage } from "./nav.js";
import { AboutPage } from "./pages/about-page.js";
import { AppearancePage } from "./pages/appearance-page.js";
import { AssetSourcesPage } from "./pages/asset-sources-page.js";
import { DisplaysPage } from "./pages/displays-page.js";
import { HardwarePage } from "./pages/hardware-page.js";
import { KeyboardPage } from "./pages/keyboard-page.js";
import { PathPresetsPage } from "./pages/path-presets-page.js";
import { PreviewsPage } from "./pages/previews-page.js";
import { ReadingsPage } from "./pages/readings-page.js";
import { UnitsPage } from "./pages/units-page.js";
import type { SourcesClient } from "./sources-client.js";

/**
 * The two halves of the strip while Settings is showing: the display count on
 * the left, the last write's answer on the right.
 *
 * **The region owns the content and the shell owns the placement.** The strip
 * is a sibling of every mode's region and is one strip in all three modes, so
 * the region publishes these strings rather than drawing a second bar. The
 * count is published only while **Displays** is the page: a count of screens
 * beside the Keyboard table would be a fact about somewhere else.
 */
export interface SettingsStatusLine {
  /** How many displays the host holds, or `null` when no read answered or the
   *  page is not Displays. A failed read is never a fabricated zero. */
  readonly displays: string | null;
  /** The last write's answer, or the page's resting sentence. */
  readonly status: string;
}

/**
 * The Settings surface, and nothing in any other mode.
 *
 * The shell hands it the mode it is in, the active page and the editor's own
 * preference state. The host reads and writes live in `useHostSettings`; the
 * editor pages own theirs. The navigation column and the page panels both read
 * `SETTINGS_PAGES`, so a destination cannot be drawn without its page.
 */
export function SettingsRegion(props: {
  readonly mode: ShellMode;
  readonly page: SettingsPage;
  readonly onPageChange: (page: SettingsPage) => void;
  readonly client?: ThemeLibraryClient | undefined;
  readonly settings?: HostSettingsClient | undefined;
  readonly sources?: SourcesClient | undefined;
  readonly onStatus?:
    | ((line: SettingsStatusLine | undefined) => void)
    | undefined;
  readonly storage: Storage | undefined;
  readonly palette: ShellPalette;
  readonly following: boolean;
  readonly onPalette: (next: ShellPalette) => void;
  readonly onFollowing: (next: boolean) => void;
  readonly overrides: ShortcutOverrides;
  readonly onOverrides: (next: ShortcutOverrides) => void;
  readonly releaseVersion: string | undefined;
}): React.JSX.Element | null {
  return props.mode === "settings" ? (
    <Settings
      page={props.page}
      onPageChange={props.onPageChange}
      {...(props.client === undefined ? {} : { client: props.client })}
      {...(props.settings === undefined ? {} : { settings: props.settings })}
      {...(props.sources === undefined ? {} : { sources: props.sources })}
      {...(props.onStatus === undefined ? {} : { onStatus: props.onStatus })}
      storage={props.storage}
      palette={props.palette}
      following={props.following}
      onPalette={props.onPalette}
      onFollowing={props.onFollowing}
      overrides={props.overrides}
      onOverrides={props.onOverrides}
      releaseVersion={props.releaseVersion}
    />
  ) : null;
}

function Settings(props: {
  readonly page: SettingsPage;
  readonly onPageChange: (page: SettingsPage) => void;
  readonly client?: ThemeLibraryClient | undefined;
  readonly settings?: HostSettingsClient | undefined;
  readonly sources?: SourcesClient | undefined;
  readonly onStatus?:
    | ((line: SettingsStatusLine | undefined) => void)
    | undefined;
  readonly storage: Storage | undefined;
  readonly palette: ShellPalette;
  readonly following: boolean;
  readonly onPalette: (next: ShellPalette) => void;
  readonly onFollowing: (next: boolean) => void;
  readonly overrides: ShortcutOverrides;
  readonly onOverrides: (next: ShortcutOverrides) => void;
  readonly releaseVersion: string | undefined;
}): React.JSX.Element {
  const host = useHostSettings({
    ...(props.client === undefined ? {} : { client: props.client }),
    ...(props.settings === undefined ? {} : { settings: props.settings }),
    ...(props.sources === undefined ? {} : { sources: props.sources }),
  });

  /** The mode's status line is published, not drawn. A count no read answered
   *  is `null` rather than `0`, which is the same refusal the pages make. The
   *  count belongs to Displays only; every other page leaves that half empty. */
  const publish = props.onStatus;
  const displayCount = props.page === "displays" ? host.displayCount : null;
  const status = host.status ?? uiCopy.hostSettings.status.ready;
  useEffect(() => {
    publish?.({ displays: displayCount, status });
  }, [publish, displayCount, status]);

  /** **Leaving the mode takes the line with it.** The region exists only while
   *  Settings is showing, so its unmount is the mode moving: withdrawing here
   *  is the same reset the shell would have to watch `mode` for. */
  useEffect(() => () => publish?.(undefined), [publish]);

  /** Entering the surface moves focus into the navigation, so a keyboard author
   *  is in the surface they just opened rather than on the hidden rail. */
  const nav = useRef<HTMLDivElement>(null);
  useEffect(() => {
    nav.current
      ?.querySelector<HTMLElement>(
        '[data-yunari-settings-nav-item][aria-selected="true"]',
      )
      ?.focus();
  }, []);

  /** The pages whose content has been mounted at least once. **The host pages
   *  are all mounted from the start** because they share one controller and one
   *  set of reads; the editor pages mount on first visit, so the asset-key read
   *  does not happen for an author who never opens that page. A visited page
   *  stays mounted and hidden, which is what preserves a draft across a page
   *  switch. */
  const [visited, setVisited] = useState<ReadonlySet<SettingsPage>>(
    () =>
      new Set<SettingsPage>([
        ...SETTINGS_PAGES.filter((page) => page.group === "this-pc").map(
          (page) => page.id,
        ),
        props.page,
      ]),
  );
  useEffect(() => {
    setVisited((current) => {
      if (current.has(props.page)) return current;
      const next = new Set(current);
      next.add(props.page);
      return next;
    });
  }, [props.page]);

  return (
    <div
      data-yunari-settings-region=""
      className="flex min-h-0 flex-1 flex-col"
    >
      <Tabs.Root
        value={props.page}
        onValueChange={(value) => props.onPageChange(value as SettingsPage)}
        orientation="vertical"
        className="settings-mode"
      >
        <div className="settings-mode-nav" ref={nav}>
          <Tabs.List
            aria-label={uiCopy.settings.title}
            className="settings-mode-nav-list"
          >
            {SETTINGS_GROUPS.map((group) => (
              <Fragment key={group.id}>
                <div className="settings-mode-nav-group" role="presentation">
                  {group.label}
                </div>
                {SETTINGS_PAGES.filter((page) => page.group === group.id).map(
                  (page) => (
                    <Tabs.Tab
                      key={page.id}
                      value={page.id}
                      data-yunari-settings-nav-item={page.id}
                      className="settings-mode-nav-item"
                    >
                      <Glyph icon={page.glyph} size={14} />
                      {page.label}
                    </Tabs.Tab>
                  ),
                )}
              </Fragment>
            ))}
          </Tabs.List>
        </div>

        <div className="settings-mode-content">
          {SETTINGS_PAGES.map((page) => (
            <Tabs.Panel
              key={page.id}
              value={page.id}
              keepMounted
              data-yunari-settings-panel={page.id}
              className="settings-mode-page"
            >
              {visited.has(page.id) ? (
                <>
                  {page.id === "displays" ? <DisplaysPage {...host} /> : null}
                  {page.id === "hardware" ? <HardwarePage {...host} /> : null}
                  {page.id === "units" ? <UnitsPage {...host} /> : null}
                  {page.id === "readings" ? <ReadingsPage {...host} /> : null}
                  {page.id === "appearance" ? (
                    <AppearancePage
                      storage={props.storage}
                      palette={props.palette}
                      following={props.following}
                      onPalette={props.onPalette}
                      onFollowing={props.onFollowing}
                    />
                  ) : null}
                  {page.id === "previews" ? (
                    <PreviewsPage storage={props.storage} />
                  ) : null}
                  {page.id === "path-presets" ? <PathPresetsPage /> : null}
                  {page.id === "keyboard" ? (
                    <KeyboardPage
                      storage={props.storage}
                      overrides={props.overrides}
                      onOverrides={props.onOverrides}
                    />
                  ) : null}
                  {page.id === "asset-sources" ? <AssetSourcesPage /> : null}
                  {page.id === "extensions" ? <ExtensionsPage /> : null}
                  {page.id === "about" ? (
                    <AboutPage releaseVersion={props.releaseVersion} />
                  ) : null}
                </>
              ) : null}
            </Tabs.Panel>
          ))}
        </div>
      </Tabs.Root>
    </div>
  );
}
