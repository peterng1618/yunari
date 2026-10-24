/**
 * Windows tray adapter: a hidden PowerShell process hosting a WinForms
 * NotifyIcon. The model is rendered by this process, never mirrored in it —
 * Node owns the items so a click maps back to the action by current index.
 */

import { spawn } from "node:child_process";
import type { TrayAction, TrayMenuItem, TrayView } from "./menu.js";
import { TRAY_ICON_PNG_BASE64 } from "./tray-icon.js";

/** The slice of a spawned child this adapter uses. */
export interface TrayChild {
  readonly stdin: {
    write(chunk: string): boolean;
    on(event: "error", listener: () => void): unknown;
  };
  readonly stdout: {
    on(event: "data", listener: (chunk: Buffer) => void): unknown;
  };
  readonly stderr: {
    on(event: "data", listener: (chunk: Buffer) => void): unknown;
  };
  once(event: "exit", listener: (code: number | null) => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
  unref(): void;
}

export type SpawnTrayProcess = (
  executable: string,
  args: readonly string[],
  options: {
    readonly stdio: ["pipe", "pipe", "pipe"];
    readonly windowsHide: boolean;
  },
) => TrayChild;

export interface WindowsTrayOptions {
  readonly onAction: (action: TrayAction) => void;
  readonly onLost: (reason: string) => void;
  readonly spawnProcess?: SpawnTrayProcess;
  /** How long the tray process may take to report `started`. */
  readonly readyTimeoutMs?: number;
}

/** Windows caps a NotifyIcon tooltip at 63 characters; over that it throws. */
const TOOLTIP_MAX = 63;

/** How long `kill` keeps the tray informative before the process is killed. */
const KILL_GRACE_MS = 300;

/** Kept on a background C# thread: `Console.In` blocks, so reading it on the
 *  UI thread would freeze the menu. `menu`/`tooltip`/`kill` arrive on stdin. */
const CSHARP_TRAY = [
  "using System;",
  "using System.Collections;",
  "using System.Collections.Concurrent;",
  "using System.Collections.Generic;",
  "using System.Drawing;",
  "using System.IO;",
  "using System.Threading;",
  "using System.Web.Script.Serialization;",
  "using System.Windows.Forms;",
  "",
  "public static class YunariTray",
  "{",
  "    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();",
  "    private static readonly ConcurrentQueue<string> Incoming = new ConcurrentQueue<string>();",
  "    private static NotifyIcon notify;",
  "    private static ContextMenuStrip menu;",
  "    private static System.Windows.Forms.Timer timer;",
  "    private static bool quitting;",
  "",
  "    public static void Start(string iconBase64)",
  "    {",
  "        var image = Image.FromStream(new MemoryStream(Convert.FromBase64String(iconBase64)));",
  "        notify = new NotifyIcon();",
  "        notify.Icon = Icon.FromHandle(((Bitmap)image).GetHicon());",
  '        notify.Text = "Yunari";',
  "        notify.Visible = true;",
  "        menu = new ContextMenuStrip();",
  "        notify.MouseDown += delegate(object sender, MouseEventArgs e)",
  "        {",
  "            if (e.Button == MouseButtons.Left || e.Button == MouseButtons.Right)",
  "            {",
  "                menu.Show(Cursor.Position);",
  "            }",
  "        };",
  "        var reader = new Thread(ReadLoop);",
  "        reader.IsBackground = true;",
  "        reader.Start();",
  "        timer = new System.Windows.Forms.Timer();",
  "        timer.Interval = 100;",
  "        timer.Tick += delegate { Drain(); };",
  "        timer.Start();",
  '        Emit(new Dictionary<string, object> { { "type", "started" } });',
  "        Application.Run();",
  "    }",
  "",
  "    private static void ReadLoop()",
  "    {",
  "        string line;",
  "        while ((line = Console.In.ReadLine()) != null)",
  "        {",
  "            Incoming.Enqueue(line);",
  "        }",
  "        // A closed stdin means the host is gone; do not leave an icon behind.",
  '        Incoming.Enqueue("{\\"action\\":\\"kill\\"}");',
  "    }",
  "",
  "    private static void Drain()",
  "    {",
  "        string line;",
  "        while (Incoming.TryDequeue(out line))",
  "        {",
  "            Apply(line);",
  "        }",
  "    }",
  "",
  "    private static void Apply(string line)",
  "    {",
  "        Dictionary<string, object> message;",
  "        try",
  "        {",
  "            message = Json.Deserialize<Dictionary<string, object>>(line);",
  "        }",
  "        catch (Exception error)",
  "        {",
  "            Emit(Failure(error.Message));",
  "            return;",
  "        }",
  '        if (message == null || !message.ContainsKey("action")) return;',
  '        string action = Convert.ToString(message["action"]);',
  '        if (action == "kill")',
  "        {",
  "            Quit();",
  "            return;",
  "        }",
  '        if (action == "tooltip" && message.ContainsKey("text") && notify != null)',
  "        {",
  '            string text = Convert.ToString(message["text"]);',
  "            if (text.Length > 63) text = text.Substring(0, 63);",
  "            notify.Text = text;",
  "            return;",
  "        }",
  '        if (action == "menu" && message.ContainsKey("items"))',
  "        {",
  '            SetMenu(message["items"] as IEnumerable);',
  "        }",
  "    }",
  "",
  "    private static void SetMenu(IEnumerable entries)",
  "    {",
  "        if (menu == null || entries == null) return;",
  "        menu.Items.Clear();",
  "        int index = 0;",
  "        foreach (Dictionary<string, object> item in entries)",
  "        {",
  "            // Every wire item takes an index, separators included; Node maps",
  "            // the click index back onto the same array.",
  "            int captured = index;",
  "            index += 1;",
  '            if (item.ContainsKey("separator") && item["separator"] is bool && (bool)item["separator"])',
  "            {",
  "                menu.Items.Add(new ToolStripSeparator());",
  "                continue;",
  "            }",
  '            string title = item.ContainsKey("title") ? Convert.ToString(item["title"]) : "";',
  '            bool enabled = !item.ContainsKey("enabled") || !(item["enabled"] is bool) || (bool)item["enabled"];',
  '            bool isChecked = item.ContainsKey("checked") && item["checked"] is bool && (bool)item["checked"];',
  "            var entry = new ToolStripMenuItem(title);",
  "            entry.Enabled = enabled;",
  "            entry.Checked = isChecked;",
  "            int clickIndex = captured;",
  "            entry.Click += delegate",
  "            {",
  '                Emit(new Dictionary<string, object> { { "type", "click" }, { "index", clickIndex } });',
  "            };",
  "            menu.Items.Add(entry);",
  "        }",
  "    }",
  "",
  "    private static Dictionary<string, object> Failure(string message)",
  "    {",
  '        return new Dictionary<string, object> { { "type", "error" }, { "message", message } };',
  "    }",
  "",
  "    private static void Emit(Dictionary<string, object> payload)",
  "    {",
  "        Console.Out.WriteLine(Json.Serialize(payload));",
  "        Console.Out.Flush();",
  "    }",
  "",
  "    private static void Quit()",
  "    {",
  "        if (quitting) return;",
  "        quitting = true;",
  "        if (timer != null) timer.Stop();",
  "        if (notify != null)",
  "        {",
  "            notify.Visible = false;",
  "            notify.Dispose();",
  "        }",
  "        Application.Exit();",
  "    }",
  "}",
];

/** Exported so the C# can be compiled once outside the unit suite. */
export const WINDOWS_TRAY_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  // The tray speaks UTF-8 JSON on both pipe directions; the console default is
  // the OEM code page, which would mangle titles such as "Yunari — …".
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
  "[Console]::InputEncoding = [System.Text.Encoding]::UTF8",
  "Add-Type -AssemblyName System.Windows.Forms",
  "Add-Type -AssemblyName System.Drawing",
  "Add-Type -AssemblyName System.Web.Extensions",
  `$iconBase64 = '${TRAY_ICON_PNG_BASE64}'`,
  "$source = @'",
  ...CSHARP_TRAY,
  "'@",
  "Add-Type -TypeDefinition $source -ReferencedAssemblies System.Windows.Forms, System.Drawing, System.Web.Extensions",
  "[YunariTray]::Start($iconBase64)",
].join("\n");

export function powershellEncodedCommand(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

/** Serialises only what the tray renders; actions stay in this process. */
export function windowsMenuMessage(items: readonly TrayMenuItem[]): string {
  const wire = items.map((item) => {
    const entry: Record<string, unknown> = {
      title: item.title,
      enabled: item.enabled,
    };
    if (item.checked !== undefined) entry["checked"] = item.checked;
    if (item.separator !== undefined) entry["separator"] = item.separator;
    return entry;
  });
  return JSON.stringify({ action: "menu", items: wire });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const defaultSpawn: SpawnTrayProcess = (executable, args, options) =>
  spawn(executable, args, options) as unknown as TrayChild;

interface TrayLine {
  readonly type?: unknown;
  readonly index?: unknown;
  readonly message?: unknown;
}

export function startWindowsTray(
  options: WindowsTrayOptions,
): Promise<TrayView> {
  const spawnProcess = options.spawnProcess ?? defaultSpawn;
  const readyTimeoutMs = options.readyTimeoutMs ?? 10_000;
  const onAction = options.onAction;
  const onLost = options.onLost;

  return new Promise<TrayView>((resolve, reject) => {
    let child: TrayChild;
    try {
      child = spawnProcess(
        "powershell.exe",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-WindowStyle",
          "Hidden",
          "-EncodedCommand",
          powershellEncodedCommand(WINDOWS_TRAY_SCRIPT),
        ],
        { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
      );
    } catch (error) {
      reject(new Error(`could not start the tray: ${messageOf(error)}`));
      return;
    }

    let items: readonly TrayMenuItem[] = [];
    let started = false;
    let failed = false;
    let closing = false;
    let buffer = "";
    let killTimer: NodeJS.Timeout | undefined;

    function send(line: string): void {
      try {
        child.stdin.write(`${line}\n`);
      } catch {
        // The pipe is gone; exit handling is what reports that.
      }
    }

    function setMenu(next: readonly TrayMenuItem[]): void {
      items = next;
      send(windowsMenuMessage(next));
    }

    function setTooltip(text: string): void {
      send(
        JSON.stringify({ action: "tooltip", text: text.slice(0, TOOLTIP_MAX) }),
      );
    }

    function close(): void {
      if (closing) return;
      closing = true;
      send(JSON.stringify({ action: "kill" }));
      killTimer = setTimeout(() => child.kill(), KILL_GRACE_MS);
      killTimer.unref();
    }

    const view: TrayView = { setMenu, setTooltip, close };

    const quitTimers = (): void => {
      clearTimeout(readyTimer);
      if (killTimer !== undefined) {
        clearTimeout(killTimer);
        killTimer = undefined;
      }
    };

    const failStartup = (reason: string): void => {
      failed = true;
      quitTimers();
      child.kill();
      reject(new Error(reason));
    };

    const readyTimer = setTimeout(() => {
      if (started || failed) return;
      failStartup(`the tray did not start within ${readyTimeoutMs} ms`);
    }, readyTimeoutMs);

    function handleLine(line: string): void {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return;
      }
      if (typeof parsed !== "object" || parsed === null) return;
      const message = parsed as TrayLine;

      if (message.type === "started") {
        if (started || failed) return;
        started = true;
        clearTimeout(readyTimer);
        resolve(view);
        return;
      }

      if (message.type === "click") {
        if (typeof message.index !== "number") return;
        const item = items[message.index];
        if (item === undefined || !item.enabled || item.action === undefined) {
          return;
        }
        onAction(item.action);
        return;
      }

      if (message.type === "error") {
        const reason =
          typeof message.message === "string"
            ? message.message
            : "the tray failed";
        if (!started && !failed) {
          failStartup(reason);
        } else if (!closing) {
          onLost(reason);
        }
      }
    }

    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let end = buffer.indexOf("\n");
      while (end !== -1) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        if (line !== "") handleLine(line);
        end = buffer.indexOf("\n");
      }
    });
    child.stderr.on("data", () => undefined);
    child.stdin.on("error", () => undefined);

    child.once("exit", (code) => {
      quitTimers();
      const detail = code === null ? "unknown" : String(code);
      if (!started && !failed) {
        failed = true;
        reject(
          new Error(`the tray exited with code ${detail} before it started`),
        );
        return;
      }
      if (!closing) onLost(`the tray exited with code ${detail}`);
    });

    child.once("error", (error) => {
      quitTimers();
      if (!started && !failed) {
        failed = true;
        reject(new Error(`the tray failed to start: ${messageOf(error)}`));
        return;
      }
      if (!closing) onLost(`the tray failed: ${messageOf(error)}`);
    });
  });
}
