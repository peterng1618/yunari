import { existsSync } from "node:fs";
import {
  HELPER_LINE_CAP,
  type HelperChild,
  type KillTree,
  killProcessTree,
  type SpawnProcess,
  spawnChildProcess,
} from "../helpers/supervisor.js";
import type { FrameAdapter, FrameReading } from "./rtss.js";

/**
 * Frame timing from Intel PresentMon's ETW trace, the fallback after RTSS.
 *
 * PresentMon is a separate console program, not a PowerShell helper: it writes
 * CSV to stdout. Yunari never passes `--restart_as_admin` (which prompts for
 * UAC per launch) or `--stop_existing_session` (which would kill a session the
 * user started); a denied trace session and a name conflict are reported as
 * `unavailable` and retried only at the next demand window.
 */

export const PRESENTMON_ARGS = [
  "--output_stdout",
  "--no_csv",
  "--session_name",
  "Yunari",
] as const;

export const PRESENTMON_MISSING =
  "PresentMon is not vendored. Run `npm run vendor:presentmon -w @yunari/host` to stage it.";

export const PRESENTMON_ACCESS_DENIED =
  "PresentMon access denied: add the account to the Performance Log Users group, or run Yunari elevated.";

export const PRESENTMON_SESSION_BUSY =
  'A PresentMon trace session named "Yunari" is already running. It will be retried at the next demand window.';

/** PresentMon 2.x writes one of these two spellings depending on the metrics. */
const FRAMETIME_COLUMN = "msbetweenpresents";
const APP_COLUMN = "application";
const LIVENESS_TIMEOUT_MS = 15_000;
const STDERR_CAP = 2_000;
const MISSING_APP = "<unknown>";

export interface PresentMonReading {
  readonly frametimeMs: number;
  readonly app: string;
}

/**
 * Splits one CSV line, honouring quoted fields. PresentMon does not quote a
 * module name, but a future metric might, and a wrong split silently shifts a
 * value. An unterminated quote is not a row.
 */
function splitCsvLine(line: string): string[] | undefined {
  const fields: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (quoted) {
      if (character !== '"') {
        field += character;
      } else if (line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = false;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      fields.push(field);
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) return undefined;

  fields.push(field);
  return fields;
}

/** Column positions for the header this process last printed. */
interface CsvColumns {
  readonly frametime: number;
  readonly app: number | undefined;
}

/**
 * One line parser owns its header, because a data row carries values rather
 * than names. The adapter gives each process its own parser so two captures
 * cannot share column positions.
 */
function createCsvLineParser(): (
  line: string,
) => PresentMonReading | undefined {
  let columns: CsvColumns | undefined;

  return (line) => {
    const fields = splitCsvLine(line.replace(/^﻿/, ""));
    if (fields === undefined) return undefined;

    const names = fields.map((field) => field.trim().toLowerCase());
    const frametime = names.indexOf(FRAMETIME_COLUMN);

    if (frametime !== -1) {
      columns = {
        frametime,
        app: names.indexOf(APP_COLUMN),
      };
      return undefined;
    }

    const known = columns;
    if (known === undefined) return undefined;

    const rawFrametime = fields[known.frametime]?.trim();
    const rawApp = known.app === undefined ? "" : fields[known.app]?.trim();

    if (
      rawFrametime === undefined ||
      rawFrametime === "" ||
      rawFrametime.toUpperCase() === "NA"
    ) {
      return undefined;
    }

    const frametimeMs = Number(rawFrametime);
    if (!Number.isFinite(frametimeMs) || frametimeMs <= 0) return undefined;

    const app =
      rawApp === undefined ||
      rawApp === "" ||
      rawApp.toUpperCase() === "NA" ||
      rawApp.toLowerCase() === MISSING_APP
        ? ""
        : rawApp;

    return { frametimeMs, app };
  };
}

/** The module's default parser, so a one-line call still knows the header. */
const defaultParser = createCsvLineParser();

/**
 * One PresentMon CSV line. A header line establishes the column names and
 * returns undefined; without one a data row cannot be positioned, and
 * malformed rows are not readings.
 */
export function parsePresentMonCsv(
  line: string,
): PresentMonReading | undefined {
  return defaultParser(line);
}

function parse(frame: PresentMonReading): FrameReading {
  return { ...frame, fps: 1000 / frame.frametimeMs };
}

export interface PresentMonAdapterOptions {
  readonly executable: string;
  readonly nowMs: () => number;
  readonly spawnProcess?: SpawnProcess;
  readonly killTree?: KillTree;
  readonly pathExists?: (file: string) => boolean;
  readonly livenessTimeoutMs?: number;
}

function stderrReason(stderr: string, code: number | null): string {
  if (/access (?:is )?denied|performance log users/i.test(stderr)) {
    return PRESENTMON_ACCESS_DENIED;
  }

  if (/trace session named .* already running/i.test(stderr)) {
    return PRESENTMON_SESSION_BUSY;
  }

  const tail = stderr.trim().slice(-STDERR_CAP);
  return (
    `PresentMon exited with code ${String(code)}` +
    (tail === "" ? "." : `: ${tail}`)
  );
}

/**
 * Opens and closes the PresentMon process; the provider owns when that happens
 * and which adapter runs first.
 */
export function presentMonAdapter(
  options: PresentMonAdapterOptions,
): FrameAdapter {
  const spawnProcess = options.spawnProcess ?? spawnChildProcess;
  const killTree = options.killTree ?? killProcessTree;
  const pathExists = options.pathExists ?? existsSync;
  const livenessTimeoutMs = Math.max(
    1,
    options.livenessTimeoutMs ?? LIVENESS_TIMEOUT_MS,
  );

  return {
    id: "presentmon",
    start(onReading, onUnavailable) {
      if (!pathExists(options.executable)) {
        onUnavailable(PRESENTMON_MISSING);
        return () => undefined;
      }

      let stopped = false;
      let child: HelperChild | undefined;
      let buffer = "";
      let stderr = "";
      let liveness: ReturnType<typeof setTimeout> | undefined;
      const parser = createCsvLineParser();
      const startedAt = options.nowMs();

      const clearLiveness = (): void => {
        if (liveness !== undefined) {
          clearTimeout(liveness);
          liveness = undefined;
        }
      };

      const stop = (): void => {
        if (stopped) return;
        stopped = true;
        clearLiveness();
        const current = child;
        child = undefined;
        if (current !== undefined) killTree(current);
      };

      let spawned: HelperChild;

      try {
        spawned = spawnProcess(options.executable, [...PRESENTMON_ARGS], {
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        onUnavailable(`PresentMon could not be started: ${message}`);
        return () => undefined;
      }

      child = spawned;

      const consume = (text: string): void => {
        if (stopped) return;
        buffer += text;

        while (true) {
          const match = /\r?\n/.exec(buffer);
          if (match === null) break;
          const line = buffer.slice(0, match.index);
          buffer = buffer.slice(match.index + match[0].length);

          const reading = parser(line);
          if (reading !== undefined) {
            clearLiveness();
            onReading(parse(reading));
          }
        }

        if (buffer.length > HELPER_LINE_CAP) buffer = "";
      };

      spawned.once("error", (error) => {
        if (stopped) return;
        stopped = true;
        clearLiveness();
        child = undefined;
        onUnavailable(`PresentMon could not be started: ${error.message}`);
      });

      spawned.once("exit", (code) => {
        if (stopped) return;
        stopped = true;
        clearLiveness();
        child = undefined;
        onUnavailable(stderrReason(stderr, code));
      });

      spawned.stdout?.on("data", (chunk) => {
        consume(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      });
      spawned.stderr?.on("data", (chunk) => {
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        stderr = `${stderr}${text}`.slice(-STDERR_CAP);
      });

      // A process that never writes its CSV header is wedged; a live trace
      // session with no game still prints the header, so only that is required.
      liveness = setTimeout(() => {
        if (stopped || options.nowMs() - startedAt < livenessTimeoutMs) return;
        stop();
        onUnavailable(
          `PresentMon did not write its CSV header within ${livenessTimeoutMs} ms.`,
        );
      }, livenessTimeoutMs);
      (liveness as { unref?: () => void }).unref?.();

      return stop;
    },
  };
}
