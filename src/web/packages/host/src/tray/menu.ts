/** Platform-neutral tray menu. The Windows and Linux adapters only render
 *  these items; every label and enabled/checked decision is made here. */

export type TrayAction =
  | "autostart"
  | "pair"
  | "editor"
  | "themes"
  | "settings"
  | "lhm"
  | "rtss"
  | "folder"
  | "exit";

export interface ExternalAppState {
  readonly installed: boolean;
  readonly running: boolean;
  /** Why a running program is not readable, such as "web server off". */
  readonly detail?: string;
}

export interface TraySnapshot {
  readonly port: number;
  readonly lan: boolean;
  readonly lanAddress?: string;
  readonly autostart: boolean;
  readonly notice?: string;
  readonly lhm?: ExternalAppState;
  readonly rtss?: ExternalAppState;
}

export interface TrayMenuItem {
  readonly title: string;
  readonly enabled: boolean;
  readonly checked?: boolean;
  readonly separator?: boolean;
  readonly action?: TrayAction;
}

/** Windows caps a NotifyIcon tooltip at 63 characters. */
const TOOLTIP_MAX = 63;

/** `notice` replaces the address line for its lifetime. */
function statusTitle(snapshot: TraySnapshot): string {
  return (
    snapshot.notice ??
    `Yunari — localhost:${snapshot.port} · ${snapshot.lan ? "LAN on" : "local only"}`
  );
}

/** One label rule for both external programs; absent is hidden, not disabled. */
function externalRow(
  name: string,
  action: TrayAction,
  state: ExternalAppState | undefined,
): TrayMenuItem | undefined {
  if (state?.installed !== true) return undefined;
  if (state.running) {
    const detail = state.detail === undefined ? "" : ` (${state.detail})`;
    return { title: `${name} — running${detail}`, enabled: false, action };
  }
  return { title: `Start ${name}`, enabled: true, action };
}

export function buildTrayMenu(snapshot: TraySnapshot): readonly TrayMenuItem[] {
  const groups: TrayMenuItem[][] = [
    [
      { title: statusTitle(snapshot), enabled: false },
      {
        title: "Auto start",
        enabled: true,
        checked: snapshot.autostart,
        action: "autostart",
      },
      { title: "Pair display", enabled: true, action: "pair" },
      { title: "Theme Editor", enabled: true, action: "editor" },
      { title: "Theme Store", enabled: true, action: "themes" },
      { title: "Host Settings", enabled: true, action: "settings" },
    ],
    [
      externalRow("LibreHardwareMonitor", "lhm", snapshot.lhm),
      externalRow("RivaTuner Statistics Server", "rtss", snapshot.rtss),
    ].filter((item): item is TrayMenuItem => item !== undefined),
    [
      { title: "Open Yunari folder", enabled: true, action: "folder" },
      { title: "Exit", enabled: true, action: "exit" },
    ],
  ];

  const menu: TrayMenuItem[] = [];
  for (const group of groups) {
    if (group.length === 0) continue;
    if (menu.length > 0) {
      menu.push({ title: "", enabled: false, separator: true });
    }
    menu.push(...group);
  }
  return menu;
}

export function trayTooltip(snapshot: TraySnapshot): string {
  const title = statusTitle(snapshot);
  return title.length > TOOLTIP_MAX
    ? `${title.slice(0, TOOLTIP_MAX - 1)}…`
    : title;
}
